/**
 * tokensave 控制室 Web 路由
 *  - /plugins/dsh-tokensave/board  按工作区过滤的黑板条目（中文标签）
 *  - /plugins/dsh-tokensave/fs     目录浏览（供「添加项目」选择项目文件夹）
 *
 * 宿主 WebServer 注册的是 Node 风格 handler(req, res)；原始路由不继承
 * Connection 鉴权栅栏，因此每个请求先过 connection.requestRejection（与
 * dsh-call-session web-telemetry-route 的 authenticatedWebRoutes 同款闸门）。
 * GET-only：两个路由都是纯只读观测面，不暴露写通道。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

export const BOARD_ROUTE_PATH = '/plugins/dsh-tokensave/board'
export const FS_ROUTE_PATH = '/plugins/dsh-tokensave/fs'
export const EXPLORERS_ROUTE_PATH = '/plugins/dsh-tokensave/explorers'
export const SCOPE_ROUTE_PATH = '/plugins/dsh-tokensave/scope'

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

  const mount = (server: any): { server: any; dispose: () => void } => {
    const routes: Array<[string, (req: any, res: any) => void]> = [
      [BOARD_ROUTE_PATH, (req, res) => handleBoard(ctx, req, res)],
      [FS_ROUTE_PATH, (req, res) => handleFs(req, res)],
      [EXPLORERS_ROUTE_PATH, (req, res) => handleExplorers(ctx, req, res)],
      [SCOPE_ROUTE_PATH, scopeGuard]
    ]
    const offs: Array<(() => void) | undefined> = []
    for (const [path, handler] of routes) {
      try {
        offs.push(server.register({ kind: 'exact', path, handler: makeGuard(handler) }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/duplicate exact route/i.test(message)) throw error
        console.warn(`[dsh-tokensave] 路由已存在，跳过重复注册: ${path}`)
      }
    }
    console.log(`[dsh-tokensave] 路由已挂载: ${BOARD_ROUTE_PATH}, ${FS_ROUTE_PATH}, ${EXPLORERS_ROUTE_PATH}`)
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
