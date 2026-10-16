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
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  buildCatalog, defaultSelection, EXPLORER_GROUPS, KNOWN_MODELS, sanitizeSelection,
  type ExplorerSelection, type ModelEntry, type ProviderEntry,
} from './explorer-catalog.ts'
import { getBoardStore, extractTitle } from './blackboard/store.ts'
import { currentRun } from './blackboard/runs.ts'

export const BOARD_ROUTE_PATH = '/plugins/dsh-tokensave/board'
export const FS_ROUTE_PATH = '/plugins/dsh-tokensave/fs'
export const EXPLORERS_ROUTE_PATH = '/plugins/dsh-tokensave/explorers'
export const SCOPE_ROUTE_PATH = '/plugins/dsh-tokensave/scope'
export const PROJECT_INFO_ROUTE_PATH = '/plugins/dsh-tokensave/project-info'
export const MKDIR_ROUTE_PATH = '/plugins/dsh-tokensave/mkdir'
export const EXPLORER_SETTINGS_ROUTE_PATH = '/plugins/dsh-tokensave/explorer-settings'
export const CLONE_ROUTE_PATH = '/plugins/dsh-tokensave/clone'
export const CLONE_STATUS_ROUTE_PATH = '/plugins/dsh-tokensave/clone-status'

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

// —— 探索者选择（用户自行控制探索者：默认 / 免费 / 收费 三组开关）————
//
// 面板可逐个（或整组）开关探索者，至少保留 1 个选中。选择持久化到
// ~/.dsh/tokensave/explorers.json（与项目注册表同款：跨来源 / 跨重启都保留），
// 由 parallelExplore 消费。null = 从未配置 → 保持旧行为（内置预设按 explorer_count 截取）。
let explorerSelectionCache: ExplorerSelection[] | null | undefined

function explorerSettingsFilePath(): string {
  return path.join(dshHomeDir(), 'tokensave', 'explorers.json')
}

/** 读用户选择；从未配置返回 null。 */
export function readExplorerSelection(): ExplorerSelection[] | null {
  if (explorerSelectionCache !== undefined) return explorerSelectionCache
  try {
    const data = JSON.parse(fs.readFileSync(explorerSettingsFilePath(), 'utf8'))
    const list = Array.isArray(data?.selected) ? data.selected : []
    const sel = list.map(sanitizeSelection).filter(Boolean) as ExplorerSelection[]
    explorerSelectionCache = sel.length ? sel : null
  } catch {
    explorerSelectionCache = null
  }
  return explorerSelectionCache
}

/** 写用户选择（调用方保证非空）。返回归一化后的列表。 */
export function writeExplorerSelection(raw: unknown): ExplorerSelection[] {
  const list = Array.isArray(raw) ? raw : []
  const sel = list.map(sanitizeSelection).filter(Boolean) as ExplorerSelection[]
  if (!sel.length) throw new Error('至少保留 1 个探索者')
  const file = explorerSettingsFilePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: Date.now(), selected: sel }, null, 2), 'utf8')
  fs.renameSync(tmp, file) // 原子替换
  explorerSelectionCache = sel
  return sel
}

// —— 模型目录发现（provider 广告的模型）——————————————
//
// 用户要求把「our-free-model 里很多可用的免费模型」都列出来，所以不再依赖手写清单：
// 对**已注册**的 provider 调 ctx.llm.listModels()（我们的 adapter 会返回它当下的目录）。
// 该调用是异步的、可能打到网络，因此：① 每 provider 4s 超时；② 结果缓存 60s；
// ③ 失败/为空时回退 KNOWN_MODELS。休眠 provider 无 adapter，直接用 KNOWN_MODELS。
let explorerModelCache: { at: number; byProvider: Record<string, ModelEntry[]> } | null = null
const EXPLORER_MODEL_TTL_MS = 60_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('model discovery timed out')), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

async function discoverProviderModels(llm: any, providers: string[]): Promise<Record<string, ModelEntry[]>> {
  if (explorerModelCache && Date.now() - explorerModelCache.at < EXPLORER_MODEL_TTL_MS) {
    return explorerModelCache.byProvider
  }
  const byProvider: Record<string, ModelEntry[]> = {}
  await Promise.all(providers.map(async (provider) => {
    let list: ModelEntry[] = []
    try {
      if (typeof llm?.listModels === 'function') {
        const models = await withTimeout(Promise.resolve(llm.listModels(provider)), 4_000)
        list = (Array.isArray(models) ? models : [])
          .map((m: any) => ({
            id: String(m?.id ?? ''),
            name: m?.name ? String(m.name) : undefined,
            description: m?.description ? String(m.description) : undefined,
          }))
          .filter((m: ModelEntry) => Boolean(m.id))
      }
    } catch { /* 探测失败 → 回退 */ }
    if (!list.length) list = (KNOWN_MODELS[provider] ?? []).map((id) => ({ id }))
    byProvider[provider] = list
  }))
  explorerModelCache = { at: Date.now(), byProvider }
  return byProvider
}

/** 组装设置面板要的目录 + 当前选择（provider 目录来自 ctx.llm，含休眠项）。 */
async function buildExplorerSettings(ctx: Context): Promise<Record<string, unknown>> {
  const entries: ProviderEntry[] = []
  const seenProvider = new Set<string>()
  const liveProviders: string[] = []
  let llm: any
  try { llm = (ctx as any).get?.('llm') } catch { llm = undefined }
  // ① 已注册（live）的 provider —— 真正当下可用的，逐个发现其模型
  try {
    for (const p of llm?.listProviders?.() ?? []) {
      if (!p?.id || seenProvider.has(p.id)) continue
      seenProvider.add(p.id)
      liveProviders.push(p.id)
      entries.push({ provider: p.id, displayName: p.name, available: true })
    }
  } catch { /* llm 未就绪 */ }
  // ② 已声明的 provider（含休眠）—— 让「收费」等分组即使未配置凭据也能列出
  try {
    for (const p of llm?.listConfigurableProviders?.() ?? []) {
      if (!p?.provider || seenProvider.has(p.provider)) continue
      seenProvider.add(p.provider)
      entries.push({ provider: p.provider, displayName: p.displayName, available: false })
    }
  } catch { /* 无 provider 目录 */ }

  let modelsByProvider: Record<string, ModelEntry[]> = {}
  try {
    modelsByProvider = await discoverProviderModels(llm, liveProviders)
  } catch { /* 发现整体失败 → 逐个回退 */ }
  for (const entry of entries) {
    entry.models = modelsByProvider[entry.provider] ?? (KNOWN_MODELS[entry.provider] ?? []).map((id) => ({ id }))
  }

  const candidates = buildCatalog(entries)
  const groups = EXPLORER_GROUPS.map((g) => ({ ...g, items: candidates.filter((c) => c.group === g.id) }))
  const configured = readExplorerSelection()
  const selected = (configured ?? defaultSelection()).map((s) => s.model)
  return { timestamp: Date.now(), configured: configured !== null, groups, selected }
}

function handleExplorerSettingsRead(ctx: Context, res: any): void {
  buildExplorerSettings(ctx).then(
    (payload) => writeJson(res, 200, payload),
    (error) => {
      console.error('[dsh-tokensave] explorer-settings 读取失败:', error)
      writeJson(res, 500, { error: 'explorer settings unavailable' })
    },
  )
}

function handleExplorerSettingsWrite(ctx: Context, req: any, res: any): void {
  if (typeof req.on !== 'function') {
    writeJson(res, 501, { error: 'request stream unavailable' })
    return
  }
  let body = ''
  req.on('data', (c: any) => { body += String(c) })
  req.on('end', () => {
    try {
      const parsed = body ? JSON.parse(body) : {}
      const sel = writeExplorerSelection(parsed?.selected)
      console.log(`[dsh-tokensave] 探索者选择已保存（${sel.length} 个）: ${sel.map((s) => s.model).join(', ')}`)
      buildExplorerSettings(ctx).then(
        (payload) => writeJson(res, 200, payload),
        () => writeJson(res, 500, { error: 'explorer settings unavailable' }),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid explorer settings payload'
      console.warn('[dsh-tokensave] explorer-settings 保存失败:', message)
      writeJson(res, 400, { error: message })
    }
  })
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

// —— 文件系统路径工具（目录浏览专用）———————————————————————
//
// 注意：normalizeWorkspace 是「工作区标识」规范化（正斜杠 + 盘符小写 + 去尾斜杠），
// 它会把根目录 "/" 归一成空串、把 Windows 盘符根 "C:\" 归一成 "c:"，直接拿它当
// 文件系统路径用是错的——于是 Mac 上点「根目录」会掉回 HOME（顶端永远停在 /Users），
// Windows 上又会拼出根本不存在的 "/c:/Users"。目录浏览另用下面这组：保留根、保留盘符，
// 只做展示层规整，真正的解析交给 path.resolve。

const IS_WINDOWS = process.platform === 'win32'

/** 文件系统根列表：Windows 上是所有真实存在的盘符，类 Unix 上是 "/"。 */
function fsRoots(): string[] {
  if (!IS_WINDOWS) return ['/']
  const roots: string[] = []
  for (let c = 65; c <= 90; c += 1) {
    const drive = `${String.fromCharCode(c)}:/`
    try {
      if (fs.statSync(drive).isDirectory()) roots.push(drive)
    } catch { /* 该盘符不存在 */ }
  }
  return roots.length > 0 ? roots : ['C:/']
}

/** 把请求参数解析成可被 fs 使用的绝对路径；空值 / 无效值回落到默认起点（HOME，再不行根）。 */
function fsResolve(rawPath?: string | null): string {
  const raw = typeof rawPath === 'string' ? rawPath.trim() : ''
  if (!raw) {
    const home = process.env.HOME || process.env.USERPROFILE || ''
    if (home) {
      try { if (fs.statSync(home).isDirectory()) return home } catch { /* 回落 */ }
    }
    return IS_WINDOWS ? fsRoots()[0] : '/'
  }
  // 纯盘符（"c:" / "C:/" / "C:\\"）→ 该盘根目录。path.resolve('c:') 在 Windows 上会落到
  // 「C 盘当前目录」而不是根，必须单独识别。
  if (/^[a-zA-Z]:[\\/]*$/.test(raw)) return `${raw[0].toUpperCase()}:/`
  return path.resolve(raw.replace(/\\+/g, '/'))
}

/** 展示用路径：统一正斜杠、盘符大写、根保留尾斜杠，其余去尾斜杠。 */
function fsDisplay(p: string): string {
  const s = p.replace(/\\+/g, '/').replace(/^([a-zA-Z]):/, (_, d: string) => `${d.toUpperCase()}:`)
  if (s === '/') return '/'
  if (/^[A-Za-z]:\/+$/.test(s)) return `${s[0].toUpperCase()}:/`
  return s.replace(/\/+$/, '')
}

/** 上级目录；已在文件系统根上时返回 null。 */
function fsParent(displayPath: string): string | null {
  const parent = fsDisplay(path.dirname(displayPath))
  return parent === displayPath ? null : parent
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

// extractTitle 已统一到 src/blackboard/store.ts（剥 markdown 记号 + 跳过 <!-- 标记行），
// 本路由直接导入使用——标题规则只有一份，工具应答与 H 台列表永远一致。

function fetchBoardEntries(_ctx: Context, workspace: string): BoardRouteEntry[] {
  // 2026-10-09 去 dsh-call-session 化：直读自建存储（原经 ctx.get('boardStore') 读第三方）。
  // status:'all' + 工作区隔离由存储负责：带 authorWorkspace 且不匹配的条目被过滤，
  // global 条目（authorWorkspace 空，tokensave 引擎自产简报/需求）全工作区可见。
  const listRes = getBoardStore().list({
    callerWorkspace: workspace,
    crossWorkspace: false,
    status: 'all',
    titlesOnly: false,
    limit: 200,
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
  parent: string | null
  roots: string[]
  entries: FsEntry[]
} {
  const target = fsResolve(rawPath)

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
    out.push({ name: d.name, path: fsDisplay(full), isProject })
  }
  out.sort((a, b) => Number(b.isProject) - Number(a.isProject) || a.name.localeCompare(b.name, 'zh'))
  const display = fsDisplay(target)
  // 把 parent / roots 一并返回：客户端不必再靠字符串切片猜父目录（Windows 盘符根
  // "C:/" 的字符串切法会切出 "/c:" 这种不存在的路径）。
  return { path: display, parent: fsParent(display), roots: fsRoots(), entries: out.slice(0, 500) }
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

// —— 从 GitHub 克隆项目（「添加项目」里直接拉一个仓库下来）————
//
// 与 mkdir 同为写通道（各自鉴权 + 方法判定），但它要跑一个可能数十秒的子进程，
// 所以拆成「启动」与「查进度」两个端点，避免长连接挂在 HTTP 上：
//   POST /clone         { parent, url, name? }  → { taskId }，子进程忘后台跑
//   GET  /clone-status  ?taskId=xxx              → { state, percent, phase, ... }
//
// 安全约定（都是硬要求，不要图省事改写）：
//   1. **参数数组传参、绝不经 shell**（spawn 第二参是数组）；URL 另做白名单校验；
//   2. URL 必须带 `--` 分隔符之前的位置——git 会把它当选项；我们只放行
//      https://、 http://、 git@host:path 三种形态，且拒绝 - 开头的字符串；
//   3. **凭据不进 argv**：私有仓的 token 经 GIT_CONFIG_COUNT/KEY/VALUE 环境变量
//      注入 http.extraheader，ps 看不到、也不会写进 .git/config；
//   4. 目标目录必须**不存在或为空**（避免把已有项目打工），且用 --depth=1 浅克隆；
//   5. 超时（默认 10 分钟）与取消都要杀掉**整个进程组**（git 会 fork remote-https）；
//   6. 任务状态只在内存（进程重启后丢弃，客户端轮询也自然结束）。

/** 克隆进度（内存态，客户端轮询）。 */
interface CloneTask {
  id: string
  state: 'running' | 'done' | 'error' | 'cancelled'
  phase: string
  percent: number
  message: string
  dir: string
  startedAt: number
  endedAt: number | null
  child: ChildProcess | null
  /** 已收但尚未被轮询走的输出行（客户每次 GET 取完即清）。 */
  pending: string[]
}

const cloneTasks = new Map<string, CloneTask>()
/** 只保留最近几个已完成任务，避免长时间运行后内存无限增长。 */
const CLONE_TASK_KEEP = 20
const CLONE_TIMEOUT_MS = 10 * 60_000

/**
 * 允许的仓库地址形态。
 *   - https://host/path  或  http://host/path
 *   - git@host:path（SSH 形态，要求 host 里有 . 且 path 非空）
 * 一律拒绝以 '-' 开头的字符串（否则会被 git 当成选项）。
 */
function normalizeCloneUrl(raw: unknown): { url: string; display: string } | { error: string } {
  const url = String(raw ?? '').trim()
  if (!url) return { error: '仓库地址不能为空' }
  if (url.length > 2048) return { error: '仓库地址太长' }
  if (url.startsWith('-')) return { error: '仓库地址不合法' }
  if (/^https?:\/\/[^\s/]+\/.+/.test(url)) return { url, display: url }
  if (/^git@[^\s/:]+:\S+$/.test(url)) return { url, display: url }
  return { error: '只支持 https:// 或 git@host:path 形式的仓库地址' }
}

/** 从仓库地址推导默认目录名（去 .git 后缀、取最后一段）。 */
function deriveRepoName(url: string): string {
  const cleaned = url.replace(/[#?].*$/, '').replace(/\/+$/, '')
  const tail = cleaned.split(/[/:]/).filter(Boolean).pop() || 'repo'
  return tail.replace(/\.git$/i, '') || 'repo'
}

/**
 * 取一份 GitHub token 用于私有仓（不进 argv）。
 * 优先环境变量（用户可在 shell 里导出），否则读 `gh auth token`。
 * 拿不到就当公开仓处理（克隆失败时用户会看到 git 的鉴权报错）。
 */
function githubToken(): string {
  for (const key of ['GITHUB_TOKEN', 'GH_TOKEN', 'TOKENS_SAVE_GITHUB_TOKEN']) {
    const v = String(process.env[key] || '').trim()
    if (v) return v
  }
  try {
    const out = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
    return String(out || '').trim()
  } catch {
    return ''
  }
}

/**
 * 把 git 的输出行翻译成人话 + 进度百分比。
 * 只认识几个关键阶段，其余原样返回（git 输出本身就是很好的进度信息）。
 */
function translateGitLine(line: string): { phase: string; percent: number } | null {
  const percentMatch = /(\d+)%/.exec(line)
  const pct = percentMatch ? Math.min(100, Number(percentMatch[1])) : -1
  if (/^Cloning into/.test(line)) return { phase: '正在准备', percent: 0 }
  if (/remote: (Counting|Compressing|Enumerating)/.test(line)) return { phase: '服务端打包', percent: pct }
  if (/^remote: Total/.test(line)) return { phase: '服务端打包', percent: 100 }
  if (/Receiving objects/.test(line)) return { phase: '接收对象', percent: pct }
  if (/Resolving deltas/.test(line)) return { phase: '解析差异', percent: pct }
  if (/Updating files/.test(line)) return { phase: '检出文件', percent: pct }
  if (/Cloning into/.test(line)) return { phase: '开始克隆', percent: 0 }
  return null
}

/** 完成后回收：把状态留存（供客户端最后一次轮询）但与子进程解绑。 */
function retireCloneTask(task: CloneTask): void {
  task.child = null
  const finished = [...cloneTasks.values()].filter((t) => t.state !== 'running')
  if (finished.length <= CLONE_TASK_KEEP) return
  finished
    .sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0))
    .slice(0, finished.length - CLONE_TASK_KEEP)
    .forEach((t) => cloneTasks.delete(t.id))
}

/** 把一个任务标记为失败/取消，并把子进程杀干净（含 fork 出去的 remote-https）。 */
function failCloneTask(task: CloneTask, message: string, state: 'error' | 'cancelled' = 'error'): void {
  if (task.state !== 'running') return
  task.state = state
  task.message = message
  task.endedAt = Date.now()
  try {
    if (task.child?.pid) process.kill(-task.child.pid, 'SIGTERM')
  } catch {
    try { task.child?.kill('SIGTERM') } catch { /* 已退出 */ }
  }
  retireCloneTask(task)
}

export function handleClone(req: any, res: any): void {
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
    const parentRaw = String(parsed?.parent ?? '').trim()
    if (!parentRaw || !path.isAbsolute(parentRaw)) {
      writeJson(res, 400, { error: '父目录必须是绝对路径' })
      return
    }
    const parent = path.resolve(parentRaw)
    try {
      if (!fs.statSync(parent).isDirectory()) {
        writeJson(res, 400, { error: '父路径不是目录' })
        return
      }
    } catch {
      writeJson(res, 404, { error: '父目录不存在' })
      return
    }
    const normalized = normalizeCloneUrl(parsed?.url)
    if ('error' in normalized) {
      writeJson(res, 400, { error: normalized.error })
      return
    }
    const name = String(parsed?.name ?? '').trim() || deriveRepoName(normalized.url)
    if (name === '' || name === '.' || name === '..' || !FOLDER_NAME_RE.test(name)) {
      writeJson(res, 400, { error: '目标文件夹名不合法' })
      return
    }
    const target = path.join(parent, name)
    // 目标必须不存在或为空：不把已有项目目录当场覆盖掉。
    if (fs.existsSync(target)) {
      let empty = false
      try { empty = fs.statSync(target).isDirectory() && fs.readdirSync(target).length === 0 } catch { empty = false }
      if (!empty) {
        writeJson(res, 409, { error: `目标目录已存在且不为空：${target}` })
        return
      }
    }
    // 已有任务在跑就拒绝，避免两个 clone 抢同一个目录。
    for (const t of cloneTasks.values()) {
      if (t.state === 'running' && t.dir === target) {
        writeJson(res, 409, { error: '该目录已有克隆任务在进行中' })
        return
      }
    }

    const taskId = `clone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    // token 只给 GitHub 的 https 地址：① 它是 GitHub 凭据，发别处没用且是泄露；
    // ② ssh 形态（git@）走本机 key，不经 HTTP 头。
    const token = /^https:\/\/(www\.)?github\.com\//i.test(normalized.url) ? githubToken() : ''
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    if (token) {
      // 走环境变量而不是 argv：ps 看不到 token，也不会落到 .git/config。
      //
      // ⚠ KEY 必须带 URL 限定（http.<url>.extraheader）：裸的 http.extraheader 是
      // **不分 host** 的，会把 token 发给任何我们请求的站点——克隆一个非 GitHub 的
      // 地址（http:// 也在白名单里）就等于把 GitHub token 送给它。已实测：裸写法对
      // example.com 也发 Authorization，加 URL 限定后只对 github.com 发。
      //
      // 限定到 origin（scheme://host）而不是整条仓库 URL：git 的 URL 匹配是前缀式，
      // 用 origin 可接受 github.com 上的重定向与 /info/refs 子路径。
      env.GIT_CONFIG_COUNT = '1'
      env.GIT_CONFIG_KEY_0 = `http.${new URL(normalized.url).origin}/.extraheader`
      env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
    }
    const args = ['clone', '--depth', '1', '--progress', '--', normalized.url, target]
    let child: ChildProcess
    try {
      child = spawn('git', args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error: any) {
      console.error('[dsh-tokensave] clone spawn failed:', error)
      writeJson(res, 500, { error: '无法启动 git（请确认已安装）' })
      return
    }

    const task: CloneTask = {
      id: taskId,
      state: 'running',
      phase: '正在准备',
      percent: 0,
      message: '',
      dir: target,
      startedAt: Date.now(),
      endedAt: null,
      child,
      pending: [],
    }
    cloneTasks.set(taskId, task)

    const onLine = (chunk: unknown) => {
      const text = String(chunk)
      // git 的进度行以 \r 刷新、错误以 \n 分行，两种分隔符都要切。
      for (const rawLine of text.split(/[\r\n]+/)) {
        const line = rawLine.replace(/\s+$/, '')
        if (!line) continue
        const translated = translateGitLine(line)
        if (translated) {
          task.phase = translated.phase
          if (translated.percent >= 0) task.percent = translated.percent
        }
        task.pending.push(line)
        if (task.pending.length > 200) task.pending.shift()
      }
    }
    child.stdout?.on('data', onLine)
    child.stderr?.on('data', onLine)

    const timer = setTimeout(() => failCloneTask(task, '克隆超时（超过 10 分钟）'), CLONE_TIMEOUT_MS)
    if (typeof timer.unref === 'function') timer.unref()

    child.on('error', (error: any) => {
      clearTimeout(timer)
      const message = error?.code === 'ENOENT' ? '找不到 git 命令' : (error?.message || '克隆失败')
      failCloneTask(task, message)
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      if (task.state !== 'running') return
      if (code === 0) {
        task.state = 'done'
        task.phase = '完成'
        task.percent = 100
        task.message = ''
        console.log(`[dsh-tokensave] 仓已克隆: ${normalized.display} → ${target}`)
      } else {
        const tail = task.pending.slice(-5).join(' / ')
        failCloneTask(task, `克隆失败（git 退出码 ${code ?? '未知'}）${tail ? `：${tail}` : ''}`)
      }
      task.endedAt = task.endedAt ?? Date.now()
      retireCloneTask(task)
    })

    console.log(`[dsh-tokensave] 开始克隆: ${normalized.display} → ${target}（任务 ${taskId}）`)
    writeJson(res, 200, { taskId, path: normalizeWorkspace(target), name, url: normalized.display })
  })
}

/** 查进度（GET ?taskId=xxx）；不带 taskId 则返回当前所有任务（便于诊断）。 */
export function handleCloneStatus(req: any, res: any): void {
  let taskId = ''
  try {
    const url = new URL(String(req?.url || ''), 'http://localhost')
    taskId = String(url.searchParams.get('taskId') || '').trim()
  } catch {
    taskId = ''
  }
  if (!taskId) {
    const all = [...cloneTasks.values()].map((t) => ({
      id: t.id, state: t.state, phase: t.phase, percent: t.percent, message: t.message, dir: t.dir,
    }))
    writeJson(res, 200, { tasks: all })
    return
  }
  const task = cloneTasks.get(taskId)
  if (!task) {
    writeJson(res, 404, { error: '任务不存在（可能已过期）' })
    return
  }
  // 取走本次新增的输出行（客户端只展示增量，不重复刷屏）。
  const lines = task.pending.slice()
  task.pending.length = 0
  writeJson(res, 200, {
    taskId: task.id,
    state: task.state,
    phase: task.phase,
    percent: task.percent,
    message: task.message,
    dir: task.dir,
    path: normalizeWorkspace(task.dir),
    lines,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
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
    // 轮次过滤（BUG-1）：只返回当前轮登记的探索者——旧轮窗口在 H 台 8s 轮询内自动消失；
    // 无登记（首次/记录缺失）→ 不过滤，保持旧行为。
    const run = wanted ? currentRun(wanted) : null
    const runIds = run && run.sessions.length > 0
      ? new Set(run.sessions.map((s: { sessionId: string }) => s.sessionId))
      : null
    const sessions: any[] = []
    for (const agent of live) {
      if (!agent) continue
      const id = String(agent?.id || agent?.session?.id || '')
      if (!id) continue
      if (runIds && !runIds.has(id)) continue // 不属于本轮委派 → 不展示（BUG-1）
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
    writeJson(res, 200, { timestamp: Date.now(), workspace: wanted, runId: run?.runId ?? null, sessions })
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

/**
 * 注册表备份目录与保留份数。
 *
 * 为什么必须备份：`POST /projects` 是**整表覆盖**语义。只要有一个来源（另一个
 * 浏览器 / 另一个 origin / 一次探测脚本）拿着残缺或陈旧的缓存回推，整张注册表
 * 就会被它那一份覆盖——历史上有过两次事故，第二次丢了 6 个项目。
 * 因此每次真正落盘前先存一份快照，事后总能找回。
 */
const PROJECTS_BACKUP_DIR = 'projects-backups'
const PROJECTS_BACKUP_KEEP = 40

function projectsBackupDir(): string {
  return path.join(dshHomeDir(), 'tokensave', PROJECTS_BACKUP_DIR)
}

/**
 * 落盘前把当前文件复制一份到备份目录（按时间戳命名，只保留最近 N 份）。
 *
 * 只在内容**确实要变**时调用（调用方已判重），避免每 8s 轮询都写一份。
 * 失败不抛：备份是兼底手段，不应阻断正常写入。
 * @param previous - 即将被覆盖的注册表内容
 */
function backupProjectsFile(previous: StoredProject[]): void {
  if (previous.length === 0) return // 空表无可备份（首启或已丢，备份它没意义）
  try {
    const dir = projectsBackupDir()
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.writeFileSync(
      path.join(dir, `projects-${stamp}.json`),
      JSON.stringify({ version: PROJECTS_FILE_VERSION, updatedAt: Date.now(), projects: previous }, null, 2),
      'utf8',
    )
    // 只留最近 N 份，防止无限增长
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('projects-') && f.endsWith('.json')).sort()
    for (const old of files.slice(0, Math.max(0, files.length - PROJECTS_BACKUP_KEEP))) {
      try { fs.unlinkSync(path.join(dir, old)) } catch { /* 兼底：删不掉就留着 */ }
    }
  } catch (e) {
    console.warn('[dsh-tokensave] 注册表备份失败（不影响写入）:', e)
  }
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

/**
 * 两份项目列表是否等价（按 id → 关键字段比较，忽略顺序）。
 *
 * 只用于「内容真的变了吗」的判断，因此不比较 updatedAt（touch 会改它，
 * 但那种改动不需要留备份）。
 */
function sameProjects(a: StoredProject[], b: StoredProject[]): boolean {
  if (a.length !== b.length) return false
  const key = (p: StoredProject) => `${p.id}|${p.path}|${p.name}|${p.description}`
  const setA = new Set(a.map(key))
  return b.every((p) => setA.has(key(p)))
}

/**
 * 把「客户端提交的列表」与「服务端现有列表」合并（并集）。
 *
 * 这是防止「残缺缓存冲掉整库」的关键：`POST /projects` 以前是整表覆盖，
 * 只要某个来源的缓存不全（另一个 origin、被清过 localStorage 的浏览器、
 * 探测脚本），一次同步就能把服务端清成它那一份。现在改为：
 *   - 服务端已有的项目，只要提交里没**显式删除**，一律保留；
 *   - 提交里的新项目照常新增；
 *   - 同一路径以提交的版本为准（用户刚改的名字/介绍生效）。
 *
 * @param current - 服务端现有列表
 * @param incoming - 客户端提交的列表
 * @param removed - 客户端显式删除的 id 列表（真正的删除必须走这里）
 */
function mergeProjects(
  current: StoredProject[],
  incoming: StoredProject[],
  removed: Set<string>,
): StoredProject[] {
  const byPath = new Map<string, StoredProject>()
  // 先放服务端现有（删除名单里的排除）
  for (const p of current) {
    if (removed.has(p.id)) continue
    byPath.set(p.path, p)
  }
  // 再用提交的覆盖 / 新增（同 id 或同路径都算同一条）
  for (const p of incoming) {
    if (removed.has(p.id)) continue
    byPath.set(p.path, p)
  }
  return [...byPath.values()]
}

function writeProjectsFile(projects: StoredProject[]): StoredProject[] {
  // 同一路径只留一条（后写覆盖），与客户端 addProject 的去重语义一致
  const byPath = new Map<string, StoredProject>()
  for (const p of projects) byPath.set(p.path, p)
  const deduped = [...byPath.values()]
  const file = projectsFilePath()
  // 落盘前先备份即将被覆盖的内容（内容不变时跳过，避免无意义备份）
  const before = readProjectsFile()
  if (before.initialized && !sameProjects(before.projects, deduped)) {
    backupProjectsFile(before.projects)
  }
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
      // 防御：请求体缺 projects 数组一律 400——曾因一次探测性 POST（body 里没有
      // projects 字段）把整表写空。
      if (!parsed || !Array.isArray(parsed.projects)) {
        writeJson(res, 400, { error: 'payload must contain a projects array' })
        return
      }
      const incoming = parsed.projects.map(sanitizeProject).filter(Boolean) as StoredProject[]
      // 显式删除名单：真正的删除只能走这里，且必须点名 id。
      // 没有它就无法区分「用户删了项目」与「这个来源的缓存本来就不全」——
      // 后者以前会被当成前者，于是把整张注册表覆盖成残缺的一份。
      const removed = new Set<string>(
        Array.isArray(parsed.removed)
          ? parsed.removed.filter((x: any) => typeof x === 'string').map((x: string) => x.trim()).filter(Boolean)
          : [],
      )
      const current = readProjectsFile().projects
      // 并集合并：服务端已有的一律保留（除非被显式删除），提交里的新增/修改生效。
      // 这样即使某个来源的缓存残缺，也无法再把别人的项目“顺手删掉”。
      const merged = mergeProjects(current, incoming, removed)
      const saved = writeProjectsFile(merged)
      writeJson(res, 200, {
        timestamp: Date.now(),
        initialized: true,
        projects: saved,
        // 回显本次真正被删除的条数，方便客户端/排查确认删除生效
        removed: current.filter((p) => removed.has(p.id)).map((p) => p.id),
      })
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

  // 探索者设置：GET 读目录 / POST 写选择（同一路由两方法；同样自行鉴权）。
  const explorerSettingsGuard = (req: any, res: any) => {
    const rejection = rejectionFor(ctx, req)
    if (rejection !== undefined) {
      writeJson(res, rejection, {
        error: rejection === 503 ? 'authentication unavailable' : 'unauthorized'
      })
      return
    }
    if (req.method === 'GET') return handleExplorerSettingsRead(ctx, res)
    if (req.method !== 'POST') return methodNotAllowed(res)
    handleExplorerSettingsWrite(ctx, req, res)
  }

  // 从 GitHub 克隆：POST /clone 启动（长任务，立即返回 taskId），GET /clone-status 查进度。
  // 与 mkdir 同形：自行鉴权 + 方法判定（不套 makeGuard，否则非 GET 全 405）。
  // 两条路径各用各的 guard——否则 GET /clone 也能查进度、POST /clone-status 竟能起克隆。
  const authed = (req: any, res: any): boolean => {
    const rejection = rejectionFor(ctx, req)
    if (rejection !== undefined) {
      writeJson(res, rejection, {
        error: rejection === 503 ? 'authentication unavailable' : 'unauthorized'
      })
      return false
    }
    return true
  }
  const cloneStartGuard = (req: any, res: any) => {
    if (!authed(req, res)) return
    if (req.method !== 'POST') return methodNotAllowed(res)
    handleClone(req, res)
  }
  const cloneStatusGuard = (req: any, res: any) => {
    if (!authed(req, res)) return
    if (req.method !== 'GET') return methodNotAllowed(res)
    handleCloneStatus(req, res)
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
      [EXPLORER_SETTINGS_ROUTE_PATH, explorerSettingsGuard],
      [CLONE_ROUTE_PATH, cloneStartGuard],
      [CLONE_STATUS_ROUTE_PATH, cloneStatusGuard],
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
    console.log(`[dsh-tokensave] 路由已挂载: ${BOARD_ROUTE_PATH}, ${FS_ROUTE_PATH}, ${EXPLORERS_ROUTE_PATH}, ${PROJECT_INFO_ROUTE_PATH}, ${PROJECTS_ROUTE_PATH}, ${EXPLORER_SETTINGS_ROUTE_PATH}, ${CLONE_ROUTE_PATH}`)
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
