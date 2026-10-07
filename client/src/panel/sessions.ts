/**
 * 项目会话访问层（「项目中心」/ H 型工作台顶部会话条）
 *
 * 数据源全部是宿主客户端服务，不走 HTTP：
 *   ctx.sessions.list    ObservableSnapshot<SessionListState>   会话目录
 *   ctx.workspaces.list  ObservableSnapshot<WorkspaceSnapshot>  工作区路径 + 归档集
 *   ctx.uiWorkspace      openSession / openWorkspace            会话导航
 *
 * 服务一律经 ctx.get()（reflect 层）取得并兜住异常——宿主对未 inject 的
 * 属性代理会抛错（与 src/board-web-route.ts 的 boardStore 同款处理）。
 */
import { useEffect, useState } from 'react'
import { getClientContext, readService } from '../session-subscribe'
import { rememberOpenedProject, loadProjects } from './store'

/** 「项目中心」tab 的 conversation.view 条目 id（宿主按 id 存视图偏好，不可改） */
export const VIEW_ID = 'tokensave-control-room'

/** 宿主会话视图偏好的持久化键（dsh-client-ui-conversation 的 CONVERSATION_STORE_KEY） */
const CONVERSATION_STORE_KEY = 'dsh.conversation'

export interface ProjectSession {
  id: string
  title: string
  updatedAt: number
  running: boolean
  blank: boolean
  /** tokensave 探索者会话（标题带 tokensave- 前缀） */
  explorer: boolean
}

/** 取一个宿主服务：统一走 session-subscribe 的 readService（reflect 层）。 */
function svc(ctx: any, name: string): any {
  return readService(ctx, name)
}

/** 路径规范化：统一正斜杠、去尾斜杠、盘符小写（与黑板路由同口径）。 */
export function normalizePath(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return ''
  return raw
    .trim()
    .replace(/\\+/g, '/')
    .replace(/^([a-zA-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`)
    .replace(/\/+$/, '')
}

/**
 * 目录等价判定：先比规范化全等，再退化为「尾部路径段逐段相等」，
 * 以容忍 /tmp/x 与 /private/tmp/x 这类同一目录的不同写法（macOS 常见）。
 * 至少要求两段相同，避免 /a/bc 与 /abc 误判。
 */
function sameDir(a?: string | null, b?: string | null): boolean {
  const x = normalizePath(a)
  const y = normalizePath(b)
  if (!x || !y) return false
  if (x === y) return true
  const xs = x.split('/').filter(Boolean)
  const ys = y.split('/').filter(Boolean)
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return false
  for (let i = 1; i <= n; i++) {
    if (xs[xs.length - i] !== ys[ys.length - i]) return false
  }
  return true
}

function readWorkspaceSnapshot(ctx: any): any {
  try {
    return svc(ctx, 'workspaces')?.list?.getSnapshot?.()
  } catch {
    return undefined
  }
}

function readWorkspaceItems(ctx: any): any[] {
  const snap = readWorkspaceSnapshot(ctx)
  return snap && Array.isArray(snap.items) ? snap.items : []
}

/** 已归档会话集合：归档的会话不出现在历史列表里。 */
function readArchived(ctx: any): Set<string> {
  const snap = readWorkspaceSnapshot(ctx)
  const ids = snap && Array.isArray(snap.archivedSessionIds) ? snap.archivedSessionIds : []
  return new Set(ids.map((x: any) => String(x)))
}

/** 会话目录行 → 展示用会话记录。 */
function toSession(row: any, id: string): ProjectSession {
  const title = String(row?.displayTitle || row?.title || '').trim() || String(id).slice(0, 8)
  return {
    id: String(id),
    title,
    updatedAt: Number(row?.updatedAt) || 0,
    running: !!row?.running,
    blank: !!row?.blank,
    explorer: title.startsWith('tokensave-'),
  }
}

/** 按给定 id 序列从会话目录取行（跳过子代理与已归档），按最近活动倒序。 */
function collect(ctx: any, ids: readonly any[], archived: Set<string>): ProjectSession[] {
  const list = svc(ctx, 'sessions')?.list?.getSnapshot?.()
  if (!list || !list.byId) return []
  const out: ProjectSession[] = []
  for (const rawId of ids) {
    const id = String(rawId)
    const row = list.byId[rawId] ?? list.byId[id]
    if (!row) continue
    if (row.origin === 'subagent') continue
    if (archived.has(id)) continue
    out.push(toSession(row, id))
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt)
  return out
}

/** 该项目（工作区目录）下的全部历史会话。 */
export function readProjectSessions(ctx: any, projectPath: string): ProjectSession[] {
  const list = svc(ctx, 'sessions')?.list?.getSnapshot?.()
  if (!list || !Array.isArray(list.ids)) return []
  const archived = readArchived(ctx)
  const matched = collect(
    ctx,
    list.ids.filter((id: any) => sameDir(list.byId?.[id]?.cwd, projectPath)),
    archived,
  )
  if (matched.length > 0) return matched
  // 兜底：会话行没有 cwd（或写法差异过大）时，用工作区登记里的会话成员
  const workspaceId = readProjectWorkspaceId(ctx, projectPath)
  if (!workspaceId) return []
  const ws = readWorkspaceItems(ctx).find((w: any) => String(w?.workspaceId) === workspaceId)
  return ws && Array.isArray(ws.sessionIds) ? collect(ctx, ws.sessionIds, archived) : []
}

/** 该项目目录对应的宿主工作区 id（不存在时返回空串）。 */
export function readProjectWorkspaceId(ctx: any, projectPath: string): string {
  const hit = readWorkspaceItems(ctx).find((w: any) => sameDir(w?.path, projectPath))
  return hit ? String(hit.workspaceId) : ''
}

/** 切换宿主当前会话（conversation.view 会随之把新 sessionId 注入本工作台）。 */
export function openSession(sessionId: string): boolean {
  const ctx: any = getClientContext()
  const ui = ctx ? svc(ctx, 'uiWorkspace') : undefined
  if (!ui || typeof ui.openSession !== 'function') return false
  try {
    ui.openSession(sessionId)
    return true
  } catch {
    return false
  }
}

/**
 * 为该项目开一个新对话。
 *
 * 与宿主 uiWorkspace.startSession 同款语义：先复用该项目下已有的空白会话，
 * 没有再创建（有工作区登记时按 workspaceId 建，否则按 cwd 建），随后导航过去。
 *
 * 新建会话是空白会话，宿主在空白期不渲染任何 conversation.view（Hero 界面），
 * 因此这里预写该会话的视图偏好，让它发出第一条消息后直接落在「项目中心」。
 */
export async function startProjectSession(
  projectPath: string,
  projectId?: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx: any = getClientContext()
  if (!ctx) return { ok: false, error: '客户端上下文不可用' }
  const sessions = svc(ctx, 'sessions')
  const ui = svc(ctx, 'uiWorkspace')
  if (!sessions || typeof sessions.create !== 'function') {
    return { ok: false, error: '会话服务不可用' }
  }
  try {
    const workspaceId = readProjectWorkspaceId(ctx, projectPath)
    const reuse = readProjectSessions(ctx, projectPath).find((s) => s.blank)
    const id = reuse?.id
      ?? String(await sessions.create(workspaceId ? { workspaceId } : { cwd: projectPath }))
    // 顺序很关键：先写好「视图偏好 + 项目记忆」，再导航。
    // 导航会让宿主动用新会话的 binding，ControlRoom 随之重挂并立即读这两项；
    // 若先导航后写，重挂时读到的还是空值 → 落到项目列表（即用户看到的「脱离工作台」）。
    primeViewPreference(id)
    if (projectId) rememberOpenedProject(id, projectId)
    if (ui && typeof ui.openSession === 'function') ui.openSession(id)
    else if (workspaceId && typeof ui?.openWorkspace === 'function') await ui.openWorkspace(workspaceId)
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '新建会话失败' }
  }
}
/** 读某个会话当前的视图偏好（无则 null）。 */
export function recallViewPreference(sessionId: string): string | null {
  if (!sessionId || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(`${CONVERSATION_STORE_KEY}.${sessionId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && typeof parsed.view === 'string'
      ? parsed.view
      : null
  } catch {
    return null
  }
}

/** 预写某个会话的视图偏好（保留其它字段，隐私模式下静默忽略）。 */
export function primeViewPreference(sessionId: string): boolean {
  if (!sessionId || typeof localStorage === 'undefined') return false
  // 已绑定过就不重复写（sweep 会被频繁调用，避免无谓的 localStorage 写与事件）
  if (recallViewPreference(sessionId) === VIEW_ID) return false
  const key = `${CONVERSATION_STORE_KEY}.${sessionId}`
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : null
    const next = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...parsed, view: VIEW_ID }
      : { draft: '', view: VIEW_ID, viewRequest: null }
    localStorage.setItem(key, JSON.stringify(next))
    return true
  } catch {
    /* 隐私模式等：忽略，仅影响新会话首次落点 */
    return false
  }
}

// —— 会话 ↔ 项目绑定（隔离）——————————————
// 隔离的唯一真相是**工作区路径**，不是 localStorage 里的记忆（那只是 UI 偏好，
// 可能因切会话/换设备/手改而变陈旧）。凡要拿某个会话去驱动某个项目的视图，
// 一律先用这两个函数校验归属，不一致就不展示该项目的视图。

/** 读某个会话的工作目录（无此会话/无 cwd 时返回空串）。 */
export function sessionCwd(ctx: any, sessionId: string): string {
  if (!sessionId) return ''
  try {
    const list = svc(ctx, 'sessions')?.list?.getSnapshot?.()
    const row = list?.byId?.[sessionId]
    return String(row?.cwd || '')
  } catch {
    return ''
  }
}

/**
 * 会话是否属于该项目（同一工作区目录）。
 * 用与列表同口径的 sameDir（含尾部路径段容差），避免 /tmp/x 与 /private/tmp/x 误判。
 * 读不到 cwd 时返回 false——宁可退回项目列表，也不把会话错配到无关项目。
 */
export function sessionBelongsToProject(ctx: any, sessionId: string, projectPath: string): boolean {
  const cwd = sessionCwd(ctx, sessionId)
  if (!cwd) return false
  return sameDir(cwd, projectPath)
}

/**
 * 该项目自己的会话（默认取最近活动的一个）。
 *
 * 工作台的主对话必须关联**本项目**的会话：优先最近活动的非空白会话（真正有内容的那个），
 * 没有非空白会话时退回空白会话（可用于开新对话），都没有返回 null。
 */
export function latestProjectSession(ctx: any, projectPath: string): ProjectSession | null {
  const all = readProjectSessions(ctx, projectPath)
  if (all.length === 0) return null
  return all.find((s) => !s.blank) ?? all[0]
}

// —— 会话 → 工作台 自动绑定（#2）————————————
//
// 用户期望：不论从左侧边栏点会话/新建会话，还是从工作台顶部选择历史会话/新建会话，
// 只要该会话属于某个已登记项目，就落到那个项目的**工作台**，而不是宿主默认的纯对话窗口。
//
// 机制：宿主按**会话作用域**从 localStorage 读视图偏好（键 `dsh.conversation.<id>`，
// 见 ui-conversation 的 readConversationViewPreference）。只要在会话被绑定前写进去，
// 宿主就会激活我们的 conversation.view。因此这里扫描「所有属于已登记项目的会话」
// 预先写入，并在会话列表变化时重跑——新建会话一出现就绑好，不等用户点进来。

/**
 * 把「属于已登记项目的会话」全部绑到工作台。
 * 幂等且便宜：只读写 localStorage + 内存 Map，不建会话、不发网络请求。
 * @returns 本次真正改了视图偏好或项目记忆的会话数
 */
export function sweepProjectSessionBindings(ctx: any): number {
  if (!ctx) return 0
  let changed = 0
  for (const project of loadProjects()) {
    for (const s of readProjectSessions(ctx, project.path)) {
      if (primeViewPreference(s.id)) changed++
      // 项目记忆也补上：宿主重挂时 ControlRoom 能直接恢复对应工作台
      rememberOpenedProject(s.id, project.id)
    }
  }
  return changed
}

/**
 * 把**单个**会话绑到它所属项目的工作台（命中已登记项目才生效）。
 *
 * 这是 #2 的确定性入口：在宿主导航到某个会话**之前**调用（见 client/src/index.ts
 * 对 uiWorkspace.openSession 的包装），因此不依赖轮询/竞态——用户从左侧边栏点会话
 * 或新建会话时，宿主激活的一定是本插件的工作台视图。
 * @returns 是否命中某个已登记项目
 */
export function bindSessionToItsProject(sessionId: string): boolean {
  const ctx: any = getClientContext()
  if (!ctx || !sessionId) return false
  const cwd = sessionCwd(ctx, sessionId)
  if (!cwd) return false
  const project = loadProjects().find((p) => sameDir(cwd, p.path))
  if (!project) return false
  return bindToProject(sessionId, project.id)
}

// —— 当前会话通道（侧边栏按钮用）——————————————
//
// 侧边栏槽位是 **root 作用域**，拿不到 sessionId（sessionId 由宿主动态注入
// conversation.* 槽）。而 Probe 挂在会话头部、**始终挂载**且知道当前会话，
// 于是让它把 id 写到这个模块级变量，侧边栏按钮读它即可。
let currentSessionId = ''

/** Probe 每次挂载/切会话时上报当前会话 id。 */
export function setCurrentSessionId(id: string): void {
  currentSessionId = id ? String(id) : ''
}

/** 当前会话 id（无则空串）。 */
export function getCurrentSessionId(): string {
  return currentSessionId
}

/**
 * 打开「项目中心」（侧边栏按钮的入口）。
 *
 * 三级降级，保证点下去一定有反应：
 *   1. 当前会话属于某已登记项目 → 绑到该项目（落工作台）；
 *   2. 当前会话不属于任何项目 → 仍然激活本插件视图（落项目列表）；
 *   3. 没有当前会话（如刚开应用）→ 打开第一个项目的最新会话。
 * @returns 是否成功发起导航
 */
export function openControlRoom(): boolean {
  const ctx: any = getClientContext()
  if (!ctx) return false
  const current = getCurrentSessionId()
  if (current) {
    if (bindSessionToItsProject(current)) return true
    // 非项目会话：写偏好 + 激活，落到项目列表态
    primeViewPreference(current)
    scheduleActivate(current)
    return true
  }
  // 没有当前会话：挑第一个项目的最新会话打开
  for (const p of loadProjects()) {
    const s = latestProjectSession(ctx, p.path)
    if (!s) continue
    bindToProject(s.id, p.id)
    return openSession(s.id)
  }
  return false
}

/** 把会话绑到指定项目（写偏好 + 项目记忆 + 已物化 binding 的视图切换）。 */
export function bindToProject(sessionId: string, projectId: string): boolean {
  if (!sessionId || !projectId) return false
  primeViewPreference(sessionId)
  rememberOpenedProject(sessionId, projectId)
  // 关键：若该会话的 binding 已经物化（例如复用了已存在的空白会话，其视图已按
  // 偏好定成 chat），只写 localStorage 不会重激活——必须显式把视图切回来。
  // 延后多次尝试激活（见 scheduleActivate 注释：新建的空白会话 binding 尚未物化）。
  scheduleActivate(sessionId)
  return true
}

/**
 * 把某个会话的当前视图切到「项目中心」（binding 已物化时生效；未物化时靠偏好）。
 *
 * 宿主在 restoreView 时会读 localStorage 偏好，但**已物化**的 binding 不会再读；
 * 侧边栏「新建会话」恰好是「复用空白会话 → 导航」，复用时视图可能已是 chat。
 * 因此需要主动调 uiConversation.binding(id).activate(VIEW_ID)。
 */
function activateView(sessionId: string): void {
  const ctx: any = getClientContext()
  if (!ctx) return
  try {
    const conv = readService<any>(ctx, 'uiConversation')
    const binding = conv?.binding?.(sessionId)
    if (binding && typeof binding.activate === 'function') binding.activate(VIEW_ID)
  } catch (e) {
    // binding 未物化/会话尚未注册：静默，偏好已写好，激活时自会生效
  }
}

/**
 * 多次尝试把视图切到「项目中心」。
 *
 * 为什么要重试：新建会话刚返回时，`uiConversation.binding(id)` 可能还没物化（抛错），
 * 只试一次会静默失败。而**空白会话**下宿主 `DefaultConversationViews` 会直接返回 null
 * （`session.blank && phase==='blank'`）——一个 view 都不渲染；只有把我们的 view
 * 加入 activeTargets，`conversationPhase` 才会变 'active'，工作台才显示出来。
 * 所以必须在一小段时间内多试几次，覆盖 binding 物化的时机。
 */
const ACTIVATE_DELAYS = [0, 60, 200, 600, 1500]
function scheduleActivate(sessionId: string): void {
  if (!sessionId) return
  for (const d of ACTIVATE_DELAYS) {
    if (d === 0) {
      activateView(sessionId)
    } else if (typeof window !== 'undefined') {
      window.setTimeout(() => activateView(sessionId), d)
    }
  }
}

/**
 * 包装宿主 sessions.create：新建会话一旦创建就把视图偏好写好。
 *
 * 必要原因：侧边栏/其它入口的新建流程是 create → openSession，而我们包装的
 * openSession 在调用时会话可能还没出现在 sessions.list 里（cwd 读不到）→ 绑定失败。
 * 在 create 返回时立刻绑定（此时 cwd 已由宿主写入），就不依赖列表刷新时机。
 */
export function wrapSessionCreate(): void {
  const ctx: any = getClientContext()
  if (!ctx) return
  const attempt = () => {
    const sessions = readService<any>(ctx, 'sessions')
    if (!sessions || typeof sessions.create !== 'function') return false
    if ((sessions.create as any).__tokensaveWrapped) return true
    const original = sessions.create.bind(sessions)
    const wrapped = async (opts?: any) => {
      const id = await original(opts)
      try {
        if (id) {
          // 优先用 create 的入参定位项目——刚创建的会话还不在 sessions.list 快照里，
          // 靠 sessionCwd 查不到（这正是侧边栏「新建会话」绑定失败的原因）。
          const bound = bindByCreateOptions(String(id), opts)
          // 入参不足以判定时（例如未传 workspaceId），再退回按已写入的 cwd 查
          if (!bound) bindSessionToItsProject(String(id))
        }
      } catch (e) {
        console.warn('[tokensave] 新建会话绑定失败', e)
      }
      return id
    }
    ;(wrapped as any).__tokensaveWrapped = true
    try {
      sessions.create = wrapped
      console.log('[tokensave] 已接管 sessions.create（新建会话即绑定工作台）')
      return true
    } catch (e) {
      console.warn('[tokensave] 无法包装 sessions.create', e)
      return false
    }
  }
  if (attempt()) return
  try {
    ctx.inject?.(['sessions'], () => { attempt() })
  } catch (e) {
    console.warn('[tokensave] 等待 sessions 失败', e)
  }
}

/**
 * 用 sessions.create 的入参把新会话绑到对应项目。
 *
 * 宿主侧边栏「新建会话」= uiWorkspace.startSession → reuseOrCreateBlank →
 * sessions.create({ workspaceId })。刚返回的会话尚未进入 sessions.list 快照，
 * 因此读不到 cwd；但**入参里的 workspaceId / cwd 足以定位项目**，不必等列表刷新。
 * @returns 是否命中某个已登记项目
 */
function bindByCreateOptions(sessionId: string, opts: any): boolean {
  const ctx: any = getClientContext()
  if (!ctx) return false
  const projects = loadProjects()
  if (projects.length === 0) return false
  const workspaceId = opts?.workspaceId === undefined ? '' : String(opts.workspaceId)
  const cwd = typeof opts?.cwd === 'string' ? opts.cwd : ''
  for (const project of projects) {
    const sameWorkspace = workspaceId !== '' && readProjectWorkspaceId(ctx, project.path) === workspaceId
    const sameCwd = cwd !== '' && sameDir(cwd, project.path)
    if (!sameWorkspace && !sameCwd) continue
    bindToProject(sessionId, project.id)
    return true
  }
  return false
}

/**
 * 订阅该项目的历史会话列表（会话目录 + 工作区登记任一变化即重读）。
 * 读失败时给出空列表，由调用方显示空态。
 */
export function useProjectSessions(projectPath: string): ProjectSession[] {
  const [sessions, setSessions] = useState<ProjectSession[]>([])

  useEffect(() => {
    const ctx: any = getClientContext()
    if (!ctx || !projectPath) {
      setSessions([])
      return
    }
    const read = () => {
      try {
        setSessions(readProjectSessions(ctx, projectPath))
      } catch (e) {
        console.warn('[tokensave] 读取项目会话列表失败', e)
        setSessions([])
      }
    }
    read()
    const unsubs: Array<() => void> = []
    for (const src of [svc(ctx, 'sessions')?.list, svc(ctx, 'workspaces')?.list]) {
      if (src && typeof src.subscribe === 'function') {
        try {
          unsubs.push(src.subscribe(read))
        } catch {
          /* 源不可订阅时退化为一次性读取 */
        }
      }
    }
    return () => {
      for (const u of unsubs) {
        try {
          u()
        } catch {
          /* noop */
        }
      }
    }
  }, [projectPath])

  return sessions
}
