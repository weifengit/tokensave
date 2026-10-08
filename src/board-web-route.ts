/**
 * tokensave 控制室 Web 路由
 *  - /plugins/dsh-tokensave/board  按工作区过滤的黑板条目（中文标签）
 *  - /plugins/dsh-tokensave/fs     目录浏览（供「添加项目」选择项目文件夹）
 *  - /plugins/dsh-tokensave/mkdir  新建 / 重命名文件夹（供「添加项目」直接开新项目目录）
 *
 * 宿主 WebServer 注册的是 Node 风格 handler(req, res)；原始路由不继承
 * Connection 鉴权栅栏，因此每个请求先过 connection.requestRejection（与
 * dsh-call-session web-telemetry-route 的 authenticatedWebRoutes 同款闸门）。
 * 读接口只读（GET-only）；/scope、/projects、/mkdir 是写通道，各自鉴权 + 方法判定。
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

export const BOARD_ROUTE_PATH = '/plugins/dsh-tokensave/board'
export const FS_ROUTE_PATH = '/plugins/dsh-tokensave/fs'
export const EXPLORERS_ROUTE_PATH = '/plugins/dsh-tokensave/explorers'
export const SCOPE_ROUTE_PATH = '/plugins/dsh-tokensave/scope'
export const PROJECT_INFO_ROUTE_PATH = '/plugins/dsh-tokensave/project-info'
export const MKDIR_ROUTE_PATH = '/plugins/dsh-tokensave/mkdir'

// —— 当前「打开的工作台项目」（探索者归属的真相）————————————
//
// 背景：session_create 没有 cwd 参数，它的工作区取自「调用方 agent 的
// session.header.cwd」。所以探索者默认落在**发起会话所在的项目**——若在一个项目里
// 发起却期望探索者归属另一个项目，就会错位（黑板/探索者路由按工作区过滤，于是
// 两边互相看不见）。
//
// 这里维护一份进程内的「当前打开的工作台项目」，由客户端在进入/切换项目时 POST 发布；
// 探索者创建时读它作为 cwd，使探索者**强制跟随当前打开的工作台项目**。
// 进程内即可：它表达的是「此刻 UI 在看哪个项目」，重启后由客户端重新发布。
let projectScope: { workspace: string; updatedAt: number } = { workspace: '', updatedAt: 0 }

/** 读当前项目作用域（探索者创建时消费）。 */
export function readProjectScope(): { workspace: string; updatedAt: number } {
  return projectScope
}

/** 写当前项目作用域（客户端发布）。传空串表示清除。 */
export function writeProjectScope(workspace: string): { workspace: string; updatedAt: number } {
  projectScope = { workspace: normalizeWorkspace(workspace), updatedAt: Date.now() }
  return projectScope
}
const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
})

// 中文主题标签映射（黑板四个业务主题）
const TOPIC_LABELS_ZH: Record<string, string> = {
  requirement: '需求',
  pitfall: '坑',
  solution: '方案',
  brief: '简报'
}
// 主题排序：需求 → 坑 → 方案 → 简报
const TOPIC_ORDER = ['requirement', 'pitfall', 'solution', 'brief']

// 与 src/types.ts PROJECT_MARKERS 一致（内联避免类型模块的运行时依赖）
const PROJECT_MARKERS = [
  'package.json', 'Cargo.toml', 'pyproject.toml',
  'go.mod', 'pom.xml', 'build.gradle', '.git'
]

/** 工作区路径规范化：统一正斜杠、盘符小写、去尾斜杠（与 board-store 规则一致）。 */
function normalizeWorkspace(rawPath?: string | null): string {
  if (!rawPath || typeof rawPath !== 'string') return ''
  let p = rawPath.trim()
  p = p.replace(/\\+/g, '/')
  p = p.replace(/^([a-zA-Z]):/, (_, drive) => `${drive.toLowerCase()}:`)
  p = p.replace(/\/+$/, '')
  return p
}

function writeJson(res: any, status: number, body: unknown): void {
  try {
    res.writeHead(status, JSON_HEADERS)
    res.end(JSON.stringify(body))
  } catch {
    /* 客户端可能已断开 */
  }
}

function methodNotAllowed(res: any): void {
  writeJson(res, 405, { error: 'method not allowed' })
}

// —— 鉴权栅栏 ————————————————————————————————————————

function rejectionFor(ctx: Context, req: any): number | undefined {
  try {
    const gate = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    if (gate === undefined) return 503
    if (typeof gate.requestRejection === 'function') return gate.requestRejection(req)
    return undefined
  } catch {
    return 503
  }
}

// —— 黑板条目 ————————————————————————————————————————

interface BoardRouteEntry {
  id: string
  topic: string
  topicLabel: string
  title: string
  content: string
  metadata: Record<string, unknown>
  createdAtMs: number
  expiresAtMs: number | null
  status: 'active' | 'archived' | 'expired' | 'dismissed'
  workspace: string
}

function extractTitle(post: any): string {
  if (typeof post?.metadata?.title === 'string' && post.metadata.title.trim()) {
    return post.metadata.title.trim()
  }
  if (typeof post?.content === 'string' && post.content.trim()) {
    const lines = post.content.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean)
    if (lines.length > 0) {
      let first = lines[0]
      first = first.replace(/^#+\s*/, '').replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').trim()
      if (first) return first.slice(0, 60)
    }
  }
  return '(无标题内容)'
}

function fetchBoardEntries(ctx: Context, workspace: string): BoardRouteEntry[] {
  // boardStore 由 dsh-call-session 提供，本插件未声明 inject，故：
  //   - 不能直接读 ctx.boardStore（代理会抛 without inject）；
  //   - 必须走 ctx.get()（reflect 层，无需 inject），并兜住未就绪/未提供的异常。
  let boardStore: any = null
  try {
    boardStore = typeof ctx?.get === 'function'
      ? ctx.get('boardStore')
      : (ctx as any)?.boardStore
  } catch {
    boardStore = null
  }
  if (!boardStore || typeof boardStore.list !== 'function') return []

  const listRes = boardStore.list({
    callerWorkspace: workspace,
    crossWorkspace: false,
    status: 'all',
    titlesOnly: false,
    limit: 200
  })
  const rawPosts = Array.isArray(listRes) ? listRes : (listRes?.posts || [])
  const now = Date.now()
  const entries: BoardRouteEntry[] = []

  for (const post of rawPosts) {
    if (!post || !post.id) continue
    const createdAtMs = post.createdAtMs
      || (post.createdAt ? new Date(post.createdAt).getTime() : now)
    const expiresAtMs = post.expiresAtMs
      || (post.expiresAt ? new Date(post.expiresAt).getTime() : null)

    let status: BoardRouteEntry['status'] = 'active'
    if (post.status === 'archived' || post.status === 'dismissed') status = 'archived'
    else if (post.status === 'expired' || (expiresAtMs && now >= expiresAtMs)) status = 'expired'
    else if (post.status !== 'active') status = 'archived'

    entries.push({
      id: post.id,
      topic: post.topic,
      topicLabel: TOPIC_LABELS_ZH[post.topic] || post.topic,
      title: extractTitle(post),
      content: post.content || '',
      metadata: post.metadata || {},
      createdAtMs,
      expiresAtMs,
      status,
      workspace: post.workspace || workspace
    })
  }

  entries.sort((a, b) => {
    const oa = TOPIC_ORDER.indexOf(a.topic)
    const ob = TOPIC_ORDER.indexOf(b.topic)
    if (oa !== ob) return oa - ob
    return b.createdAtMs - a.createdAtMs
  })
  return entries
}

function handleBoard(ctx: Context, req: any, res: any): void {
  let params: URLSearchParams
  try {
    params = new URL(req.url ?? '/', 'http://localhost').searchParams
  } catch {
    params = new URLSearchParams()
  }
  const workspace = normalizeWorkspace(params.get('workspace')) || normalizeWorkspace(process.cwd())
  try {
    const entries = fetchBoardEntries(ctx, workspace)
    writeJson(res, 200, { workspace, timestamp: Date.now(), entries })
  } catch (error) {
    console.error('[dsh-tokensave] board route failed:', error)
    writeJson(res, 500, { error: 'board unavailable' })
  }
}

// —— 目录浏览（选择项目文件夹）————————————————————————

interface FsEntry {
  name: string
  path: string
  isProject: boolean
}

function listDirectories(rawPath?: string | null): {
  path: string
  entries: FsEntry[]
} {
  const fallback = process.env.HOME || process.cwd()
  const target = normalizeWorkspace(rawPath) || normalizeWorkspace(fallback)

  let stat: fs.Stats
  try {
    stat = fs.statSync(target)
  } catch {
    throw Object.assign(new Error('path not found'), { code: 'ENOENT' })
  }
  if (!stat.isDirectory()) {
    throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' })
  }

  const dirents = fs.readdirSync(target, { withFileTypes: true, encoding: 'utf8' })
  const out: FsEntry[] = []
  for (const d of dirents) {
    if (d.name.startsWith('.')) continue // 隐藏目录不列出
    const full = path.join(target, d.name)
    let isDir = d.isDirectory()
    if (d.isSymbolicLink()) {
      try { isDir = fs.statSync(full).isDirectory() } catch { continue }
    }
    if (!isDir) continue
    let isProject = false
    try {
      isProject = PROJECT_MARKERS.some((m) => fs.existsSync(path.join(full, m)))
    } catch { /* noop */ }
    out.push({ name: d.name, path: normalizeWorkspace(full), isProject })
  }
  out.sort((a, b) => Number(b.isProject) - Number(a.isProject) || a.name.localeCompare(b.name, 'zh'))
  return { path: target, entries: out.slice(0, 500) }
}

function handleFs(req: any, res: any): void {
  let params: URLSearchParams
  try {
    params = new URL(req.url ?? '/', 'http://localhost').searchParams
  } catch {
    params = new URLSearchParams()
  }
  try {
    const result = listDirectories(params.get('path'))
    writeJson(res, 200, { timestamp: Date.now(), ...result })
  } catch (error: any) {
    if (error?.code === 'ENOENT') writeJson(res, 404, { error: '目录不存在' })
    else if (error?.code === 'ENOTDIR') writeJson(res, 400, { error: '不是目录' })
    else {
      console.error('[dsh-tokensave] fs route failed:', error)
      writeJson(res, 500, { error: '目录读取失败' })
    }
  }
}

// —— 新建 / 重命名文件夹（「添加项目」里直接开一个新项目目录）—————

/** 目录名合法性：单段（不含路径分隔符、控制字符、Windows 保留字符），不是 . 或 .. */
const FOLDER_NAME_RE = /^[^/\\:*?"<>|\u0000-\u001f]{1,64}$/

/**
 * 新建或重命名一个文件夹。
 *
 * 请求体：{ parent: string, name: string, from?: string }
 *   - 不带 from：在 parent 下新建 name 目录；
 *   - 带 from：把 parent/from 重命名为 parent/name。
 * 只接受**单层**目录名（禁止路径分隔符与 ..），parent 必须是已存在的目录；
 * 目标已存在时报 409，绝不覆盖。
 * 成功返回 { path }（新目录的绝对路径，客户端拿它直接当项目路径）。
 */
export function handleMkdir(req: any, res: any): void {
  if (typeof req.on !== 'function') {
    writeJson(res, 501, { error: 'request stream unavailable' })
    return
  }
  let body = ''
  req.on('data', (c: any) => { body += String(c) })
  req.on('end', () => {
    let parsed: any = null
    try {
      parsed = body ? JSON.parse(body) : {}
    } catch {
      writeJson(res, 400, { error: 'invalid json' })
      return
    }
    try {
      const parentRaw = String(parsed?.parent ?? '').trim()
      const name = String(parsed?.name ?? '').trim()
      const from = parsed?.from === undefined || parsed?.from === null ? '' : String(parsed.from).trim()
      if (!parentRaw || !path.isAbsolute(parentRaw)) {
        writeJson(res, 400, { error: '父目录必须是绝对路径' })
        return
      }
      if (name === '' || name === '.' || name === '..' || !FOLDER_NAME_RE.test(name)) {
        writeJson(res, 400, { error: '文件夹名不合法（不能包含路径分隔符）' })
        return
      }
      const parent = path.resolve(parentRaw)
      let parentStat: fs.Stats
      try {
        parentStat = fs.statSync(parent)
      } catch {
        writeJson(res, 404, { error: '父目录不存在' })
        return
      }
      if (!parentStat.isDirectory()) {
        writeJson(res, 400, { error: '父路径不是目录' })
        return
      }
      const target = path.join(parent, name)
      if (from !== '') {
        if (from === '.' || from === '..' || !FOLDER_NAME_RE.test(from)) {
          writeJson(res, 400, { error: '原文件夹名不合法' })
          return
        }
        const source = path.join(parent, from)
        try {
          if (!fs.statSync(source).isDirectory()) {
            writeJson(res, 400, { error: '原路径不是文件夹' })
            return
          }
        } catch {
          writeJson(res, 404, { error: '原文件夹不存在' })
          return
        }
        if (fs.existsSync(target)) {
          writeJson(res, 409, { error: '同名文件夹已存在' })
          return
        }
        fs.renameSync(source, target)
        console.log(`[dsh-tokensave] 文件夹已重命名: ${source} → ${target}`)
        writeJson(res, 200, { timestamp: Date.now(), path: normalizeWorkspace(target), name, renamedFrom: normalizeWorkspace(source) })
        return
      }
      if (fs.existsSync(target)) {
        writeJson(res, 409, { error: '同名文件夹已存在' })
        return
      }
      fs.mkdirSync(target, { recursive: false })
      console.log(`[dsh-tokensave] 文件夹已创建: ${target}`)
      writeJson(res, 200, { timestamp: Date.now(), path: normalizeWorkspace(target), name })
    } catch (error: any) {
      if (error?.code === 'EACCES' || error?.code === 'EPERM') {
        writeJson(res, 403, { error: '没有权限在此处创建文件夹' })
      } else {
        console.error('[dsh-tokensave] mkdir route failed:', error)
        writeJson(res, 500, { error: '文件夹操作失败' })
      }
    }
  })
}

// —— 项目信息：文件修改时间（真实 mtime）+ 开发服务器地址 —————
//
// 「上次更新」用户要求以**内部文件最后一次修改**为准（不是我们记的使用时间）。
// 这里递归扫一遍项目目录，取最大 mtime；忽略 node_modules/.git/dist 等噪声目录，
// 也不跟随符号链接（避免大目录卡死）。
//
// 同时尝试从 package.json 的 scripts 里推断开发服务器端口，给出「展示」用的 URL。

/** 扫描时忽略的目录（体积大、与“项目代码改动”无关）。 */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', '.next', '.nuxt',
  '.cache', 'coverage', '.venv', 'venv', '__pycache__', '.idea', '.vscode',
  'vendor', '.turbo', '.parcel-cache', 'tmp', 'logs',
])

/**
 * 扫一遍项目目录，同时取**最新**与**最老**的文件修改时间。
 *
 * 「上次更新」= 最新（项目是否还在动）；「创建于」= 最老（项目里第一个文件是什么时候写的，
 * 比“加入项目中心的时间”更接近“项目创建时间”——用户要求两者同口径）。
 * 忽略同一组噪声目录（node_modules/.git/dist…）与点文件，不跟随符号链接，
 * 20000 条上限防止在大目录上卡死。
 * @param root - 项目根目录
 * @returns newest / oldest（mtimeMs，毫秒）；扫不到时两者均为 0
 */
function scanProjectMtimes(root: string): { newest: number; oldest: number } {
  let newest = 0
  let oldest = 0
  const stack: string[] = [root]
  let guard = 0
  while (stack.length > 0 && guard < 20000) {
    const dir = stack.pop() as string
    let items: fs.Dirent[]
    try {
      items = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const it of items) {
      guard++
      if (guard > 20000) break
      const name = it.name
      if (name.startsWith('.')) continue
      if (IGNORE_DIRS.has(name)) continue
      const full = path.join(dir, name)
      if (it.isSymbolicLink()) continue
      if (it.isDirectory()) {
        stack.push(full)
        continue
      }
      try {
        const st = fs.statSync(full)
        if (st.mtimeMs > newest) newest = st.mtimeMs
        if (oldest === 0 || st.mtimeMs < oldest) oldest = st.mtimeMs
      } catch {
        /* 单个文件读不到：跳过 */
      }
    }
  }
  return { newest, oldest }
}

/** 只取最新（保留原入口，供其它调用点使用）。 */
function latestMtimeMs(root: string): number {
  return scanProjectMtimes(root).newest
}

/**
 * 项目的「展示」地址。
 *
 * 优先读 package.json 的 `previewUrl`（项目自带的显式声明）：可为完整 URL，
 * 也可为宿主自身的相对路径（如 `/api/intel/site/console/`）——后者由 DSH 自己
 * 托管，宿主换端口也不会失效。
 *
 * 没声明时回退到**显式**端口推断（`--port 3000` / `-p 5173` / `PORT=3000`）——
 * 不猜默认端口：猜错会让「展示」打开一个不相干的地址。
 */
function guessDevUrl(root: string): string {
  try {
    const pkgPath = path.join(root, 'package.json')
    if (!fs.existsSync(pkgPath)) return ''
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const declared = pkg && typeof pkg.previewUrl === 'string' ? pkg.previewUrl.trim() : ''
    if (declared) return declared
    const scripts = pkg && typeof pkg.scripts === 'object' ? pkg.scripts : {}
    const text = ['dev', 'start', 'serve', 'preview']
      .map((k) => (typeof scripts[k] === 'string' ? scripts[k] : ''))
      .join(' ')
    const m = /(?:--port[= ]|-p\s+|PORT=)(\d{2,5})/.exec(text)
    if (!m) return ''
    return `http://localhost:${m[1]}`
  } catch {
    return ''
  }
}

/**
 * 探测该 URL 是否真的有人在监听（“项目已启动”的诚实判定）。
 * 用 net.connect 而不是 fetch：只关心端口通不通，不等 HTTP 响应；
 * 超时 400ms，避免列表渲染被拖慢。
 */
function probeUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(false)
      return
    }
    let host = '127.0.0.1'
    let port = 0
    try {
      const u = new URL(url)
      host = u.hostname || host
      port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
    } catch {
      resolve(false)
      return
    }
    if (!port) {
      resolve(false)
      return
    }
    const socket = new net.Socket()
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      try { socket.destroy() } catch { /* noop */ }
      resolve(ok)
    }
    socket.setTimeout(400)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    try {
      socket.connect(port, host)
    } catch {
      finish(false)
    }
  })
}

export async function handleProjectInfo(req: any, res: any): Promise<void> {
  let params: URLSearchParams
  try {
    params = new URL(req.url ?? '/', 'http://localhost').searchParams
  } catch {
    params = new URLSearchParams()
  }
  const target = normalizeWorkspace(params.get('path'))
  if (!target) {
    writeJson(res, 400, { error: '缺少 path' })
    return
  }
  try {
    const st = fs.statSync(target)
    if (!st.isDirectory()) {
      writeJson(res, 400, { error: '不是目录' })
      return
    }
  } catch {
    writeJson(res, 404, { error: '目录不存在' })
    return
  }
  try {
    const devUrl = guessDevUrl(target)
    // 真实探测端口是否有人在听：这才是「项目已启动」的诚实判定。
    // 未启动时 devUrl 仍返回（供 UI 提示“地址是 X，但当前未启动”）。
    // 相对路径（/…）由宿主 DSH 自己托管：本页能打开就说明宿主在跑，没有可探
    // 的独立端口，直接视为可用。
    const devRunning = devUrl.startsWith('/') ? true : await probeUrl(devUrl)
    // 一次扫描同时得到「最新」（更新于）与「最老」（创建于）文件时间。
    const mtimes = scanProjectMtimes(target)
    writeJson(res, 200, {
      timestamp: Date.now(),
      path: target,
      mtimeMs: mtimes.newest,
      oldestMtimeMs: mtimes.oldest,
      devUrl,
      devRunning,
    })
  } catch (error) {
    console.error('[dsh-tokensave] project-info 失败:', error)
    writeJson(res, 500, { error: '读取项目信息失败' })
  }
}

// —— 探索者探测（直读 agents 服务，不依赖第三方 telemetry 路由）———————

/** 解析 agents 服务（与 dsh-call-session 同款降级链） */
function resolveAgents(ctx: Context): any {
  if (typeof ctx?.get === 'function') {
    try {
      const s = ctx.get('agents', false)
      if (s) return s
    } catch { /* 未就绪 */ }
  }
  try { return (ctx as any)?.agents || null } catch { return null }
}

function handleExplorers(ctx: Context, req: any, res: any): void {
  try {
    const agents = resolveAgents(ctx)
    const live = typeof agents?.list === 'function' ? agents.list() : []
    // 工作区过滤：?workspace= 或 ?sessionId=（与 board 路由同口径），缺省不过滤
    let wanted = ''
    try {
      const url = new URL(String(req?.url ?? ''), 'http://localhost')
      const rawWs = url.searchParams.get('workspace')
      if (rawWs) wanted = normalizeWorkspace(rawWs)
    } catch { /* req.url 不可用时按全量 */ }
    const sessions: any[] = []
    for (const agent of live) {
      if (!agent) continue
      const id = String(agent?.id || agent?.session?.id || '')
      if (!id) continue
      // 标题解析（与 call-session resolveSessionTitle 同链）
      const title =
        (typeof agent?.session?.title === 'string' && agent.session.title) ||
        (typeof agent?.title === 'string' && agent.title) ||
        (typeof agent?.session?.header?.title === 'string' && agent.session.header.title) ||
        ''
      if (!title.startsWith('tokensave-')) continue
      const cwd = agent?.session?.header?.cwd || agent?.session?.cwd || ''
      const workspace = normalizeWorkspace(cwd)
      if (wanted && workspace !== wanted) continue
      sessions.push({
        id,
        shortId: id.slice(0, 8),
        title,
        workspace,
        state: agent?.status === 'running' ? 'running' : 'idle'
      })
    }
    writeJson(res, 200, { timestamp: Date.now(), workspace: wanted, sessions })
  } catch (error) {
    console.error('[dsh-tokensave] explorers route failed:', error)
    writeJson(res, 500, { error: 'explorers unavailable' })
  }
}
// —— 项目注册表（跨来源 / 跨设备共享）——————————————————————
//
// 背景：项目列表原先是「浏览器 localStorage」单一存储，而 localStorage 按
// **来源（origin）** 隔离。桌面端以 http://127.0.0.1:3080 打开，手机经
// dsh-remote-mobile 网关以 http://<局域网/Tailscale IP>:3080 打开——同一个服务、
// 同一份代码，却是两个 origin，于是手机读到空列表（项目中心空白、工作台无项目可开）。
// 把注册表落到**服务端文件**（~/.dsh/tokensave/projects.json）即可让所有来源共享同
// 一份数据；localStorage 退化为本机缓存，仅用于离线兜底与首次启动播种。
export const PROJECTS_ROUTE_PATH = '/plugins/dsh-tokensave/projects'

const PROJECTS_FILE_VERSION = 1

interface StoredProject {
  id: string
  name: string
  path: string
  description: string
  layout: string
  createdAt: number
  updatedAt: number
}

/** DSH 主目录（与 dsh-remote-mobile 的 ~/.dsh/<plugin> 落库约定一致）。 */
function dshHomeDir(): string {
  const fromEnv = process.env.DSH_HOME || process.env.DSH_HOME_DIR
  if (fromEnv) return fromEnv
  return path.join(process.env.HOME || process.cwd(), '.dsh')
}

function projectsFilePath(): string {
  return path.join(dshHomeDir(), 'tokensave', 'projects.json')
}

/** 逐字段校验并归一化一条项目记录；不合法返回 null（丢弃）。 */
function sanitizeProject(raw: any): StoredProject | null {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const target = normalizeWorkspace(typeof raw.path === 'string' ? raw.path : '')
  if (!id || !target) return null
  const createdAt = Number(raw.createdAt) || Date.now()
  const name = typeof raw.name === 'string' && raw.name.trim()
    ? raw.name.trim()
    : (target.split('/').filter(Boolean).pop() || target)
  return {
    id,
    name,
    path: target,
    description: typeof raw.description === 'string' ? raw.description : '',
    layout: raw.layout === 'h-desk' ? 'h-desk' : 'h-desk',
    createdAt,
    updatedAt: Number(raw.updatedAt) || createdAt,
  }
}

function readProjectsFile(): { initialized: boolean; projects: StoredProject[] } {
  let raw: string
  try {
    raw = fs.readFileSync(projectsFilePath(), 'utf8')
  } catch {
    // 文件不存在 = 首次运行：客户端据此以本地缓存播种，而非误判为空表
    return { initialized: false, projects: [] }
  }
  try {
    const data = JSON.parse(raw)
    const list = Array.isArray(data) ? data : data?.projects
    const projects = Array.isArray(list)
      ? (list.map(sanitizeProject).filter(Boolean) as StoredProject[])
      : []
    return { initialized: true, projects }
  } catch {
    return { initialized: true, projects: [] }
  }
}

function writeProjectsFile(projects: StoredProject[]): StoredProject[] {
  // 同一路径只留一条（后写覆盖），与客户端 addProject 的去重语义一致
  const byPath = new Map<string, StoredProject>()
  for (const p of projects) byPath.set(p.path, p)
  const deduped = [...byPath.values()]
  const file = projectsFilePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(
    tmp,
    JSON.stringify({ version: PROJECTS_FILE_VERSION, updatedAt: Date.now(), projects: deduped }, null, 2),
    'utf8'
  )
  fs.renameSync(tmp, file) // 原子替换：读方永远看到完整 JSON
  return deduped
}

function handleProjectsRead(res: any): void {
  const state = readProjectsFile()
  writeJson(res, 200, { timestamp: Date.now(), ...state })
}

function handleProjectsWrite(req: any, res: any): void {
  // 防挂死：拿不到请求流就明确报错，而不是既不读也不回应
  if (typeof req.on !== 'function') {
    writeJson(res, 501, { error: 'request stream unavailable' })
    return
  }
  let body = ''
  req.on('data', (c: any) => { body += String(c) })
  req.on('end', () => {
    try {
      const parsed = body ? JSON.parse(body) : {}
      const list = Array.isArray(parsed?.projects) ? parsed.projects : []
      const projects = list.map(sanitizeProject).filter(Boolean) as StoredProject[]
      const saved = writeProjectsFile(projects)
      writeJson(res, 200, { timestamp: Date.now(), initialized: true, projects: saved })
    } catch (error) {
      console.error('[dsh-tokensave] projects route failed:', error)
      writeJson(res, 400, { error: 'invalid projects payload' })
    }
  })
}
// —— 挂载 ————————————————————————————————————————

const WEB_SERVER_KEYS = Object.freeze(['webServer', 'httpServer'])

function resolveWebServer(ctx: Context): any {
  if (typeof ctx?.get !== 'function') return undefined
  for (const key of WEB_SERVER_KEYS) {
    try {
      const service = ctx.get(key)
      if (service && typeof service.register === 'function') return service
    } catch { /* 未就绪 */ }
  }
  try {
    const conn = ctx.get('connection')
    const s = conn?.server
    if (s && typeof s.register === 'function') return s
  } catch { /* noop */ }
  return undefined
}

export function mountTokensaveWebRoutes(ctx: Context): void {
  // 身份制注册 + 门面切换处理。
  //
  // dsh 里同一张 exact 路由表可能被两条解析路径暴露成两个不同对象：
  //   ctx.get('webServer') / ctx.get('httpServer') 与 ctx.get('connection').server
  // 它们实例身份不同，但 register() 写的是同一张路由表。旧实现只比较对象身份
  // （身份不等就重挂），于是第二次挂载撞 "duplicate exact route"，并被 cordis
  // 升级为 fatal load failure —— 即本次启动崩溃的根因。
  //
  // 现在：① 解析到不同门面时先注销旧注册再挂新的，保证只留一份路由；
  //       ② 单条 register 兜底捕获 duplicate（说明本插件已挂过该路由）→ 告警
  //          跳过，不再让整棵插件树 fatal；
  //       ③ 每个 effect 只注销自己那一次注册，fiber 卸载 / HMR full reload 后
  //          重新 apply 可重新挂载。
  let current: { server: any; dispose: () => void } | null = null

  const makeGuard = (handler: (req: any, res: any) => void) => (req: any, res: any) => {
    const rejection = rejectionFor(ctx, req)
    if (rejection !== undefined) {
      writeJson(res, rejection, {
        error: rejection === 503 ? 'authentication unavailable' : 'unauthorized'
      })
      return
    }
    if (req.method !== undefined && req.method !== 'GET') return methodNotAllowed(res)
    handler(req, res)
  }

  // 项目作用域路由：GET 读、POST 写（客户端发布当前打开的工作台项目）。
  // 其余路由仍走 GET-only 闸门；这里单独开写通道，但同样过鉴权。
  const scopeGuard = (req: any, res: any) => {
    const rejection = rejectionFor(ctx, req)
    if (rejection !== undefined) {
      writeJson(res, rejection, {
        error: rejection === 503 ? 'authentication unavailable' : 'unauthorized'
      })
      return
    }
    if (req.method === 'GET') {
      writeJson(res, 200, { timestamp: Date.now(), ...readProjectScope() })
      return
    }
    if (req.method !== 'POST') return methodNotAllowed(res)
    // 防挂死：拿不到请求流就明确报错，而不是既不读也不回应
    if (typeof req.on !== 'function') {
      writeJson(res, 501, { error: 'request stream unavailable' })
      return
    }
    let body = ''
    req.on?.('data', (c: any) => { body += String(c) })
    req.on?.('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {}
        const next = writeProjectScope(String(parsed?.workspace ?? ''))
        console.log(`[dsh-tokensave] 项目作用域已发布: ${next.workspace || '(清除)'}`)
        writeJson(res, 200, { timestamp: Date.now(), ...next })
      } catch (error) {
        writeJson(res, 400, { error: 'invalid scope payload' })
      }
    })
  }

  // 项目注册表路由：GET 读、POST 整表写（跨来源 / 跨设备共享；同样过鉴权）。
  const projectsGuard = (req: any, res: any) => {
    const rejection = rejectionFor(ctx, req)
    if (rejection !== undefined) {
      writeJson(res, rejection, {
        error: rejection === 503 ? 'authentication unavailable' : 'unauthorized'
      })
      return
    }
    if (req.method === 'GET') return handleProjectsRead(res)
    if (req.method !== 'POST') return methodNotAllowed(res)
    handleProjectsWrite(req, res)
  }

  // 文件夹写通道（新建 / 重命名）：同样自行鉴权 + 方法判定，
  // 不能套 makeGuard——它会把所有非 GET 请求 405 掉。
  const mkdirGuard = (req: any, res: any) => {
    const rejection = rejectionFor(ctx, req)
    if (rejection !== undefined) {
      writeJson(res, rejection, {
        error: rejection === 503 ? 'authentication unavailable' : 'unauthorized'
      })
      return
    }
    if (req.method !== 'POST') return methodNotAllowed(res)
    handleMkdir(req, res)
  }

  const mount = (server: any): { server: any; dispose: () => void } => {
    // 只读观测面：统一走 GET-only 闸门（makeGuard）。
    const readRoutes: Array<[string, (req: any, res: any) => void]> = [
      [BOARD_ROUTE_PATH, (req, res) => handleBoard(ctx, req, res)],
      [FS_ROUTE_PATH, (req, res) => handleFs(req, res)],
      [EXPLORERS_ROUTE_PATH, (req, res) => handleExplorers(ctx, req, res)],
      [PROJECT_INFO_ROUTE_PATH, (req, res) => { void handleProjectInfo(req, res) }],
    ]
    // 写通道：**不能**再套 makeGuard——它把所有非 GET 请求 405 掉，会让
    // POST /scope（项目作用域发布）与 POST /projects（注册表写入）永远不可达。
    // 这两条由各自的 guard 自行鉴权 + 方法判定。
    const writeRoutes: Array<[string, (req: any, res: any) => void]> = [
      [SCOPE_ROUTE_PATH, scopeGuard],
      [PROJECTS_ROUTE_PATH, projectsGuard],
      [MKDIR_ROUTE_PATH, mkdirGuard],
    ]
    const offs: Array<(() => void) | undefined> = []
    const registerAll = (
      list: Array<[string, (req: any, res: any) => void]>,
      wrapWithGate: boolean
    ) => {
      for (const [path, handler] of list) {
        try {
          offs.push(server.register({ kind: 'exact', path, handler: wrapWithGate ? makeGuard(handler) : handler }))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (!/duplicate exact route/i.test(message)) throw error
          console.warn(`[dsh-tokensave] 路由已存在，跳过重复注册: ${path}`)
        }
      }
    }
    registerAll(readRoutes, true)
    registerAll(writeRoutes, false)
    console.log(`[dsh-tokensave] 路由已挂载: ${BOARD_ROUTE_PATH}, ${FS_ROUTE_PATH}, ${EXPLORERS_ROUTE_PATH}, ${PROJECT_INFO_ROUTE_PATH}, ${PROJECTS_ROUTE_PATH}`)
    const registration = {
      server,
      dispose: () => {
        for (const off of offs) {
          try { off?.() } catch { /* noop */ }
        }
        if (current === registration) current = null
      }
    }
    current = registration
    return registration
  }

  const tryRegister = (): boolean => {
    const server = resolveWebServer(ctx)
    if (server === undefined) return false
    if (current?.server === server) return true
    // 门面切换：先注销旧注册，避免同一路由表里出现重复 exact route
    current?.dispose()
    if (typeof ctx.effect === 'function') {
      let mounted: { server: any; dispose: () => void } | null = null
      ctx.effect(() => {
        mounted = mount(server)
        return () => {
          mounted?.dispose()
          mounted = null
        }
      }, 'dsh-tokensave: web routes')
    } else {
      mount(server)
    }
    return true
  }

  tryRegister()
  if (typeof ctx.on === 'function') {
    ctx.on('internal/service', (name: string) => {
      if (WEB_SERVER_KEYS.includes(name) || name === 'connection') tryRegister()
    })
  }
}
