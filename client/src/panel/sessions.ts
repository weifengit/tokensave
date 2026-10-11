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
import { rememberOpenedProject, loadProjects, touchProject, addProject } from './store'
import type { ProjectRecord } from './store'

/**
 * 「工作台」tab 的 conversation.view 条目 id。
 *
 * 注意：宿主按 id 存视图偏好（localStorage `dsh.conversation.<sessionId>`），
 * 改 id 会让已有偏好悬空回落——因此本 tab 从「项目中心」改名为「工作台」时
 * **只改 label、不改 id**。
 */
export const VIEW_ID = 'tokensave-control-room'
/** 「工作台」tab 的显示名（宿主 tab 文案 = 注册时的 label；切 tab 时按它匹配）。 */
export const WORKBENCH_LABEL = '工作台'
/** 「项目中心」（真正的项目列表）tab 的 id 与显示名。 */
export const PROJECT_CENTER_VIEW_ID = 'tokensave-project-center'
export const PROJECT_CENTER_LABEL = '项目中心'

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
 * 直接给**指定会话**发一条消息（黄灯清单里的「继续」按钮用，免去跳转页面操作）。
 *
 * 走宿主 scoped conversation 面（与 dsh-client-ui-conversation 内部同一配方）：
 *   `sessions.scope(id).get('conversation').send(text)`
 * 会话还没 materialize scope 时先 retain 一把（retain 即 materialize），发完释放；
 * scope 已存在则直接发。发送成功宿主会把它排成一轮 turn —— 该会话随即变“进行中”，
 * 黄灯自动消（无需再标已读）。
 * @param sessionId - 目标会话
 * @param text - 原样作为一条文本块发送
 * @throws 服务不可用 / 作用域不可用 / 宿主业务失败（原样抛给调用方展示）
 */
export async function sendToSession(sessionId: string, text: string): Promise<void> {
  const ctx: any = getClientContext()
  if (!ctx) throw new Error('客户端上下文不可用')
  if (!text || !text.trim()) throw new Error('消息内容为空')
  const sessions = svc(ctx, 'sessions')
  if (!sessions || typeof sessions.scope !== 'function') throw new Error('sessions 服务不可用')

  const deliver = async () => {
    const scoped = sessions.scope(sessionId)
    if (!scoped) throw new Error('会话作用域不可用')
    const conversation = typeof scoped.get === 'function' ? scoped.get('conversation') : undefined
    if (!conversation || typeof conversation.send !== 'function') throw new Error('conversation 服务不可用')
    await conversation.send(text)
  }

  if (sessions.scope(sessionId)) {
    await deliver()
    return
  }
  if (typeof sessions.using === 'function') {
    await sessions.using(sessionId, { source: 'tokensave' }, deliver)
    return
  }
  await deliver()
}

/**
 * 归档一个会话（宿主 uiWorkspace.archiveSession）。
 *
 * 镜像原生左侧边栏的流程：先不带 stopActivity 试一次；宿主对**正在运行**的会话会
 * 拒绝（错误码 workspace/session-active），此时返回 active=true，由调用方弹确认后再用
 * stopActivity=true 重试（宿主会先停掉它的工作再归档）。
 *
 * 归档后该会话从工作区的会话列表里消失（readProjectSessions 已过滤 archivedSessionIds），
 * 若它正好是当前选中会话，宿主会同时清掉选中。
 * @param sessionId - 要归档的会话
 * @param stopActivity - 是否先停止它的运行中工作再归档
 * @returns ok 或失败原因（active 标记“因正在运行被拒”）
 */
export async function archiveSession(
  sessionId: string,
  stopActivity = false,
): Promise<{ ok: true } | { ok: false; active: boolean; error: string }> {
  if (!sessionId) return { ok: false, active: false, error: '缺少会话 id' }
  const ctx: any = getClientContext()
  const ui = ctx ? svc(ctx, 'uiWorkspace') : undefined
  if (!ui || typeof ui.archiveSession !== 'function') {
    return { ok: false, active: false, error: '归档服务不可用' }
  }
  try {
    await ui.archiveSession(sessionId, stopActivity ? { stopActivity: true } : undefined)
    return { ok: true }
  } catch (e: any) {
    const code = String(e?.code ?? e?.data?.code ?? '')
    const text = `${code} ${String(e?.message ?? e ?? '')}`
    const active = code.includes('session-active') || /session-active|running work/i.test(text)
    return { ok: false, active, error: String(e?.message ?? e ?? '归档被拒绝') }
  }
}

/**
 * 取消归档（宿主 uiWorkspace.unarchiveSession）：把会话恢复回它原来的工作区位置。
 * @param sessionId - 要恢复的会话
 * @returns 是否成功
 */
export async function unarchiveSession(sessionId: string): Promise<boolean> {
  const ctx: any = getClientContext()
  const ui = ctx ? svc(ctx, 'uiWorkspace') : undefined
  if (!sessionId || !ui || typeof ui.unarchiveSession !== 'function') return false
  try {
    await ui.unarchiveSession(sessionId)
    return true
  } catch (e) {
    console.warn('[tokensave] 取消归档失败', e)
    return false
  }
}

/** 置顶一个会话（宿主 uiWorkspace.pinSession）。 */
export async function pinSession(sessionId: string): Promise<boolean> {
  const ctx: any = getClientContext()
  const ui = ctx ? svc(ctx, 'uiWorkspace') : undefined
  if (!sessionId || !ui || typeof ui.pinSession !== 'function') return false
  try {
    await ui.pinSession(sessionId)
    return true
  } catch (e) {
    console.warn('[tokensave] 置顶会话失败', e)
    return false
  }
}

/** 取消置顶（宿主 uiWorkspace.unpinSession）。 */
export async function unpinSession(sessionId: string): Promise<boolean> {
  const ctx: any = getClientContext()
  const ui = ctx ? svc(ctx, 'uiWorkspace') : undefined
  if (!sessionId || !ui || typeof ui.unpinSession !== 'function') return false
  try {
    await ui.unpinSession(sessionId)
    return true
  } catch (e) {
    console.warn('[tokensave] 取消置顶失败', e)
    return false
  }
}

/**
 * 重命名一个会话（写会话标题）。
 *
 * 与原生侧边栏同口径：经 `sessions.using(id, { source }, ref => ref.binding.session.rename(title))`
 * —— using 会自行 retain / 释放引用，不依赖本插件已经订阅过该会话。
 * @returns ok 或失败原因
 */
export async function renameSession(
  sessionId: string,
  title: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const next = String(title ?? '').trim()
  if (!sessionId || !next) return { ok: false, error: '标题不能为空' }
  const ctx: any = getClientContext()
  const sessions = ctx ? svc(ctx, 'sessions') : undefined
  if (!sessions) return { ok: false, error: '会话服务不可用' }
  try {
    if (typeof sessions.using === 'function') {
      const result: any = await sessions.using(sessionId, { source: 'tokensave' }, (ref: any) =>
        ref?.binding?.session?.rename(next),
      )
      if (result && result.ok === false) {
        return { ok: false, error: String(result.error?.message ?? '重命名被拒绝') }
      }
      return { ok: true }
    }
    // 降级：已物化 binding 直接改
    const face: any = sessions.binding?.(sessionId)?.session
    if (face && typeof face.rename === 'function') {
      const result: any = await face.rename(next)
      if (result && result.ok === false) return { ok: false, error: String(result.error?.message ?? '重命名被拒绝') }
      return { ok: true }
    }
    return { ok: false, error: '重命名服务不可用' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '重命名失败' }
  }
}

/**
 * 分叉一个会话（宿主 uiWorkspace.forkSession）：不改当前选中，只生成一个子会话。
 * @returns 子会话 id（失败返回 null）
 */
export async function forkSession(sessionId: string): Promise<string | null> {
  const ctx: any = getClientContext()
  const ui = ctx ? svc(ctx, 'uiWorkspace') : undefined
  if (!sessionId || !ui || typeof ui.forkSession !== 'function') return null
  try {
    const child = await ui.forkSession(sessionId)
    return child ? String(child) : null
  } catch (e) {
    console.warn('[tokensave] 分叉会话失败', e)
    return null
  }
}

/** 已置顶会话 id 集合（宿主 workspaces.list 的 pinnedSessionIds）。 */
export function readPinnedSessionIds(ctx: any): string[] {
  const snap = readWorkspaceSnapshot(ctx)
  const ids = snap && Array.isArray(snap.pinnedSessionIds) ? snap.pinnedSessionIds : []
  return ids.map((x: any) => String(x))
}

/**
 * 订阅“已置顶会话”集合（置顶/取消置顶后自动刷新）。
 * @returns 当前置顶的会话 id 集合
 */
export function usePinnedSessions(): Set<string> {
  const [pinned, setPinned] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    const ctx: any = getClientContext()
    const read = () => {
      try {
        setPinned(new Set(readPinnedSessionIds(ctx)))
      } catch {
        setPinned(new Set())
      }
    }
    read()
    const src = ctx ? svc(ctx, 'workspaces')?.list : undefined
    if (src && typeof src.subscribe === 'function') {
      try {
        return src.subscribe(read)
      } catch {
        return
      }
    }
    return
  }, [])
  return pinned
}

/**
 * 「展示」：跳到该项目的**宿主 UI 界面**（DSH 默认对话窗口，带左侧工作区）。
 *
 * 与「进入工作台」的区别：工作台是本插件视图；展示是把宿主拉回它自己的界面，
 * 用于“我就想看看这个项目的原生 DSH 界面”。
 *
 * 做法（三级降级，保证一定有反应）：
 *   1. 若该项目已有会话 → 直接 openSession 打开它（并清掉本插件的视图偏好，
 *      使宿主回落默认 chat 视图）；
 *   2. 否则若已有工作区登记 → openWorkspace（宿主会复用/新建空白会话）；
 *   3. 都没有 → 先 workspaces.create({path}) 登记工作区，再 openWorkspace。
 * @returns 是否成功发起导航
 */
export async function revealProject(projectPath: string): Promise<boolean> {
  const ctx: any = getClientContext()
  if (!ctx || !projectPath) return false
  const ui = svc(ctx, 'uiWorkspace')
  if (!ui) return false
  // ① 已有会话：直接打开
  const existing = latestProjectSession(ctx, projectPath)
  if (existing) {
    // 清掉本插件视图偏好，让宿主回落它自己的默认对话视图
    clearViewPreference(existing.id)
    if (typeof ui.openSession === 'function') {
      try {
        ui.openSession(existing.id)
        return true
      } catch (e) {
        console.warn('[tokensave] 展示：openSession 失败', e)
      }
    }
  }
  // ② 已有工作区登记：直接打开工作区
  let workspaceId = readProjectWorkspaceId(ctx, projectPath)
  // ③ 没有则先登记
  if (!workspaceId) {
    try {
      const ws = await svc(ctx, 'workspaces')?.create?.({ path: projectPath })
      workspaceId = ws && ws.workspaceId ? String(ws.workspaceId) : ''
    } catch (e) {
      console.warn('[tokensave] 展示：登记工作区失败', e)
    }
  }
  if (workspaceId && typeof ui.openWorkspace === 'function') {
    try {
      await ui.openWorkspace(workspaceId)
      return true
    } catch (e) {
      console.warn('[tokensave] 展示：openWorkspace 失败', e)
    }
  }
  return false
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
  /** 刚被归档、需显式排除的会话 id（归档集快照可能还没刷新，见 stayInProjectAfterArchive） */
  excludeSessionId?: string,
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
    const reuse = readProjectSessions(ctx, projectPath).find((s) => s.blank && s.id !== excludeSessionId)
    const id = reuse?.id
      ?? String(await sessions.create(workspaceId ? { workspaceId } : { cwd: projectPath }))
    // 顺序很关键：先写好「视图偏好 + 项目记忆 + 立即激活工作台视图」，再导航。
    // 导航会让宿主动用新会话的 binding，ControlRoom 随之重挂并立即读这两项；
    // 若先导航后写，重挂时读到的还是空值 → 落到项目列表（即用户看到的「脱离工作台」）。
    //
    // 用 bindToProject 而不是只写偏好：**复用的空白会话**的 binding 往往早已物化
    // （例如上次停在「对话」tab），那种情况下宿主不会再读偏好，必须显式激活视图。
    if (projectId) bindToProject(id, projectId)
    else primeViewPreference(id)
    if (ui && typeof ui.openSession === 'function') ui.openSession(id)
    else if (workspaceId && typeof ui?.openWorkspace === 'function') await ui.openWorkspace(workspaceId)
    // 兜底：刚创建的会话可能还没进会话列表快照（cwd 读不到）→ 等它就绪后再绑一次
    bindSessionEventually(id)
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

/**
 * 清除某个会话的视图偏好，让宿主回落它自己的默认视图（chat）。
 *
 * 用于「展示」：我们想让宿主显示**它自己的**界面，而不是本插件的工作台。
 * 只把 view 置为 null（保留 draft 等其它字段）。
 */
export function clearViewPreference(sessionId: string): void {
  if (!sessionId || typeof localStorage === 'undefined') return
  try {
    const key = `${CONVERSATION_STORE_KEY}.${sessionId}`
    const raw = localStorage.getItem(key)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    localStorage.setItem(key, JSON.stringify({ ...parsed, view: null, viewRequest: null }))
  } catch {
    /* 隐私模式：忽略 */
  }
}

/**
 * 预写某个会话的视图偏好（保留其它字段，隐私模式下静默忽略）。
 * @param sessionId - 目标会话
 * @param viewId - 要激活的 conversation.view id（默认「工作台」）
 */
export function primeViewPreference(sessionId: string, viewId: string = VIEW_ID): boolean {
  if (!sessionId || typeof localStorage === 'undefined') return false
  // 已绑定过就不重复写（sweep 会被频繁调用，避免无谓的 localStorage 写与事件）
  if (recallViewPreference(sessionId) === viewId) return false
  const key = `${CONVERSATION_STORE_KEY}.${sessionId}`
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : null
    const next = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...parsed, view: viewId }
      : { draft: '', view: viewId, viewRequest: null }
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
 *
 * **探索者会话不算『自己的会话』**：它们是本项目的 root 会话（cwd = 项目路径，
 * 侧边栏可见），而且刚跑完时 updatedAt 往往最新——若不排除，自动选会话就会选中某条
 * tokensave-* 探索者，工作台的「主对话」被悄悄切到探索者身上（用户看到的「对话 ID
 * 不匹配」）；归档后挑下一条会话也会踩同一个坑。
 */
/** 从一批项目会话里挑「用户自己的那条」：跳过探索者，优先非空白。 */
function pickOwnSession(list: ProjectSession[]): ProjectSession | null {
  const own = list.filter((s) => !s.explorer)
  if (own.length === 0) return null
  return own.find((s) => !s.blank) ?? own[0]
}

export function latestProjectSession(ctx: any, projectPath: string): ProjectSession | null {
  return pickOwnSession(readProjectSessions(ctx, projectPath))
}

/**
 * 该会话是否为 tokensave 探索者（标题 tokensave- 前缀）。
 * BUG-2：探索者严禁出现在「DSH 主对话」卡——用户在侧边栏点到探索者时，
 * 宿主会把工作台视图绑到这条会话，MainChat 若直接渲染它就等于探索者混进主对话。
 * H 台用本函数把主对话卡回退到项目自己的会话。
 */
export function isExplorerSessionId(sessionId: string): boolean {
  if (!sessionId) return false
  const ctx: any = getClientContext()
  const list = svc(ctx, 'sessions')?.list?.getSnapshot?.()
  const row = list?.byId?.[sessionId]
  const title = String(row?.displayTitle || row?.title || '')
  return title.startsWith('tokensave-')
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
 * 一次性「徽标新会话 → 项目中心列表」豁免标记。
 *
 * 走列表这条路时我们会先打开某个会话以取得视图上下文；但自动绑定
 * （bindSessionToItsProject / 重试链）会把属于项目的会话改写成「工作台」，
 * 于是界面又被拉回工作台。命中该会话时跳过绑定；带 TTL，避免长期误伤。
 */
let skipBindFor = ''
let skipBindUntil = 0

/** 让接下来针对该会话的自动绑定暂时跳过（用于「新会话 → 项目中心」）。 */
export function skipNextBindFor(sessionId: string, ttlMs = 4000): void {
  skipBindFor = sessionId ? String(sessionId) : ''
  skipBindUntil = Date.now() + (ttlMs > 0 ? ttlMs : 4000)
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
  // 「新会话 → 项目中心」路径的豁免：本次导航不要把该会话绑到工作台
  if (skipBindFor && skipBindFor === sessionId && Date.now() < skipBindUntil) return false
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

// —— 「项目中心」当前处于哪一屏（列表 / 工作台）+ 切换信号 ————
//
// 侧边栏按钮是**切换**语义（用户要求）：
//   当前在工作台 → 点一下回项目列表；
//   当前在项目列表 → 点一下回**上次那个**工作台。
//
// 关键设计：切到列表时**不能清掉“上次打开的项目”记忆**，否则再点回来就不知道
// 回哪个项目（会退化成第一个项目——已用模拟测出这个 bug）。
// 因此用独立的 `forceList` 标记：它只控制“挂载时不要自动恢复工作台”，
// 而工作台记忆原封不动地留着，供切回时使用。
//
// 为何用订阅而非一次性标记：用户可能**已经**在本视图内（不会重挂），
// 只在挂载时读标记的写法收不到信号，界面不动。
type Screen = 'list' | 'desk'
let controlRoomScreen: Screen = 'list'
let forceList = false

/** ControlRoom 上报当前屏（供侧边栏按钮决定切换方向）。 */
export function setControlRoomScreen(s: Screen): void {
  controlRoomScreen = s
}

/** 当前屏（未上报过时视为列表）。 */
export function getControlRoomScreen(): Screen {
  return controlRoomScreen
}

/**
 * 宿主当前正选中的 conversation.view tab 文案（宿主自己维护的即时真值）。
 *
 * 为何要读 DOM：`controlRoomScreen` 由视图**挂载时**上报，而宿主切 tab 是异步的——
 * 用户连点时它会滞后一整拍，切换方向就会算反（点两次却同向、或该去列表却去了工作台）。
 * `aria-selected` 是宿主即时维护的，用它兜一层，连点也能得到确定的方向。
 * @returns 命中 `WORKBENCH_LABEL` / `PROJECT_CENTER_LABEL`，读不到返回 null
 */
function currentHostViewLabel(): string | null {
  if (typeof document === 'undefined') return null
  const tabs = document.querySelectorAll<HTMLElement>('[data-conversation-tabs] button[role="tab"]')
  for (const el of Array.from(tabs)) {
    if (el.getAttribute('aria-selected') !== 'true') continue
    const text = (el.textContent || '').trim()
    if (text === WORKBENCH_LABEL || text.includes(WORKBENCH_LABEL)) return WORKBENCH_LABEL
    if (text === PROJECT_CENTER_LABEL || text.includes(PROJECT_CENTER_LABEL)) return PROJECT_CENTER_LABEL
  }
  return null
}

/**
 * 导航意图的生效窗口：宿主把 tab 真正切过去需要一拍（实测 ~150ms）。
 * 这段时间里 DOM 上的 `aria-selected` 还是**旧值**，若拿它当真值会把
 * 刚发起的意图顶回去 —— 正是「点一下先闪到工作台、又立即跳回列表」的成因。
 */
const NAV_SETTLE_MS = 700
let navSettleUntil = 0

/**
 * 当前**实际**所处的屏（列表 / 工作台）。
 *
 * 优先级：导航刚发起的一小段时间内以「意图」（`controlRoomScreen`，由 request* 同步写入）
 * 为准；窗口过后以宿主 DOM 的即时真值兜底（用户直接点宿主自己的 tab 条时，
 * 视图不重挂、也不经 request*，只有 DOM 知道真实屏幕）。
 */
export function getLiveScreen(): Screen {
  if (Date.now() < navSettleUntil) return controlRoomScreen
  const label = currentHostViewLabel()
  if (label === WORKBENCH_LABEL) return 'desk'
  if (label === PROJECT_CENTER_LABEL) return 'list'
  return getControlRoomScreen()
}

// —— 导航代次：让「最后一次点击」胜出，杜绝尾随定时器把界面拨回去 ————
//
// 切 tab 靠一串延迟点击（0/120/400/900ms…）。若不作废，上一个动作的尾随点击会在新动作
// **之后**触发，表现为「点一下，界面闪到工作台又立刻跳回项目中心，然后才定住」（用户反馈）。
// 每次发起导航把代次 +1，所有延迟回调都带上发起时的代次，过期即自废。
let navEpoch = 0

/** 开启一次新导航：作废此前所有延迟动作，返回本次代次。 */
function beginNavigation(): number {
  navSettleUntil = Date.now() + NAV_SETTLE_MS
  return ++navEpoch
}

/** 代次未过期才执行（过期 = 已被更新的导航取代）。 */
function runIfCurrent(epoch: number, fn: () => void): void {
  if (epoch !== navEpoch) return
  try {
    fn()
  } catch (e) {
    console.warn('[tokensave] 过期导航回调失败', e)
  }
}

/**
 * 延迟点宿主 tab（带代次守卫）。
 * @param label - 目标 tab 文案
 * @param delays - 依次尝试的延迟（ms）
 * @param epoch - 发起时的导航代次；若已被更新的导航取代则整个回调自废
 */
function scheduleSelectHostView(label: string, delays: number[], epoch: number): void {
  if (typeof window === 'undefined') return
  for (const d of delays) {
    if (d === 0) runIfCurrent(epoch, () => selectHostView(label))
    else window.setTimeout(() => runIfCurrent(epoch, () => selectHostView(label)), d)
  }
}

/** 是否处于“强制列表”态（挂载时不要自动恢复工作台）。 */
export function isForceList(): boolean {
  return forceList
}

const listListeners = new Set<() => void>()
/** 工作台恢复监听；可带目标会话 id（跨会话切换时 ControlRoom 会忽略，等 prop 更新后自己恢复）。 */
const deskListeners = new Set<(sessionId?: string) => void>()

/**
 * 本次导航的意图（进入工作台时一并带上）。
 *   - 不传 / 其它值：默认布局（有预览的项目默认只呈现预览，主对话收进「已关闭」chip）；
 *   - 'debug'：用户点的是项目卡片上的「去调试」——预览与 DSH 主对话必须**同时呈现**。
 */
export type WorkbenchIntent = 'debug'

/**
 * 意图的留存（带 TTL，按项目记）。
 *
 * 为何要跨模块存、又要带 TTL：点「去调试」时宿主的 conversation.view 不一定重挂，
 * 而 HDesk 自己的绑定 effect 会把会话换成**本项目自己的**会话——那一步会让 ControlRoom
 * 整个重建。于是「一次性、读完即清」在这个流程里一定会丢：第一次读走意图的那个实例
 * 随后就被卸载了，真正渲染出来的那个实例什么也读不到（实测：卡片点了但主对话没出来）。
 *
 * 因此改成**按项目留一段时间**：每个挂载的实例都带自己的项目来问，命中才返回 debug。
 * 普通导航（侧边栏 / 点卡片 / 点会话）不带 intent，会把整份留存清掉；
 * 即使用户再也不点别的，TTL 也保证它不会永久粘着。
 */
const INTENT_TTL_MS = 15_000
let workbenchIntent: WorkbenchIntent | undefined
let workbenchIntentAt = 0
let workbenchIntentProject = ''

function emit(set: Set<() => void>, what: string): void {
  for (const fn of Array.from(set)) {
    try {
      fn()
    } catch (e) {
      console.warn(`[tokensave] ${what}信号回调失败`, e)
    }
  }
}

function emitDesk(sessionId?: string): void {
  for (const fn of Array.from(deskListeners)) {
    try {
      fn(sessionId)
    } catch (e) {
      console.warn('[tokensave] 工作台信号回调失败', e)
    }
  }
}

/**
 * 看本次导航意图（**不清除**，带 TTL 与项目过滤）。
 *
 * 为何不清除：点「去调试」后 HDesk 的绑定 effect 会打开本项目自己的会话，那一步会让
 * ControlRoom 整个重建——若第一个实例把意图读走（一次性），真正渲染出来的那个实例
 * 就什么也读不到（实测：卡片点了但主对话没出来）。清除交给**下一次进入工作台**：
 * enterProjectWorkbench 每次都调 requestWorkbench（普通进入不带 intent → 当场清空），
 * 所以上一个项目的「去调试」不会粘到下一次。
 * @param projectId - 当前正在渲染的项目；只有它的「去调试」才算数（防串台）
 */
export function peekWorkbenchIntent(projectId?: string): WorkbenchIntent | undefined {
  const fresh = workbenchIntent !== undefined
    && Date.now() - workbenchIntentAt < INTENT_TTL_MS
    && (!projectId || projectId === workbenchIntentProject)
  return fresh ? workbenchIntent : undefined
}

/** 请求「项目中心」显示项目列表（而非工作台）。保留工作台记忆，供切回时用。 */
export function requestProjectList(): void {
  forceList = true
  // 同步意图：目标屏当场落定，别等视图挂载才上报（否则连点会读回旧的屏幕，
  // 切换方向算反——见 getLiveScreen 的说明）。
  controlRoomScreen = 'list'
  emit(listListeners, '项目列表')
}

/**
 * 请求「项目中心」回到**上次那个**工作台。可带目标会话 id（导航中已知）；
 * intent 会一并发给已挂载的 ControlRoom（「去调试」要求预览与主对话两窗并存），
 * 并**按项目**留存一段时间（见上方 workbenchIntent 的说明）。
 * @param projectId - 意图归属的项目；只有它才吃得到这次 intent
 */
export function requestWorkbench(
  sessionId?: string,
  intent?: WorkbenchIntent,
  projectId?: string,
): void {
  forceList = false
  // 同上：意图即真值，让下一次点击读到的方向是刚切过去的那个屏。
  controlRoomScreen = 'desk'
  // 先存意图再广播：已挂载的 ControlRoom 当场接住，重建的那个实例（HDesk 绑定本项目
  // 会话时 ControlRoom 会重挂）靠 peekWorkbenchIntent(projectId) 补齐。
  // 注意：**每次进入工作台都要写**（不带 intent 就写 undefined）——这就是「去调试」的清除点。
  workbenchIntent = intent
  workbenchIntentAt = Date.now()
  workbenchIntentProject = intent ? String(projectId || '') : ''
  emitDesk(sessionId)
}
/** 订阅「显示项目列表」信号；返回取消订阅函数。 */
export function onRequestProjectList(fn: () => void): () => void {
  listListeners.add(fn)
  return () => { listListeners.delete(fn) }
}

/** 订阅「回到工作台」信号；回调可拿到导航的目标会话 id。 */
export function onRequestWorkbench(fn: (sessionId?: string) => void): () => void {
  deskListeners.add(fn)
  return () => { deskListeners.delete(fn) }
}


/**
 * 点宿主自己的视图 tab（按 tab 文案匹配）。
 *
 * 宿主只渲染 store.view 指向的那个视图，而 store.view 只在会话首次绑定时从偏好读；
 * 已在会话中时必须点它自己的 tab 才能把界面切过去。宿主没导出这个 action，
 * 因此从 DOM 上点：tab 渲染为 `[data-conversation-tabs] button[role=tab]`，
 * 文案就是注册时的 label（本插件现在是「项目中心」与「工作台」两个 tab）。
 * @param label - 目标 tab 的文案
 * @returns 是否找到并点击了对应 tab
 */
function selectHostView(label: string): boolean {
  if (typeof document === 'undefined') return false
  const tabs = document.querySelectorAll<HTMLElement>(
    '[data-conversation-tabs] button[role="tab"]'
  )
  if (tabs.length === 0) return false
  // 先精确匹配文案，再退化为包含匹配（tab 文案可能带省略/装饰）
  let target: HTMLElement | null = null
  for (const el of Array.from(tabs)) {
    const text = (el.textContent || '').trim()
    if (text === label) { target = el; break }
    if (target === null && text.includes(label)) target = el
  }
  if (!target) return false
  // 已经在这个视图上就不重复点（aria-selected 由宿主维护）
  if (target.getAttribute('aria-selected') === 'true') return true
  try {
    target.click()
    return true
  } catch (e) {
    console.warn('[tokensave] 切换视图 tab 失败', e)
    return false
  }
}
/**
 * 把当前会话的视图切到指定的 conversation.view（数据层激活 + 点宿主 tab）。
 *
 * 「项目中心」与「工作台」是两个独立 tab，两者之间跳转靠这里：
 *   - 数据层：写偏好 + activate，让视图参与组装（空白会话才会渲染）；
 *   - UI 层：点宿主 tab，把它自己的 store.view 切过去。
 * @param viewId - 目标视图 id
 * @param label - 目标 tab 文案（用于 DOM 点击）
 * @returns 是否至少发起了一次导航
 */
export function switchToView(
  viewId: string,
  label: string,
  epoch: number = beginNavigation(),
): boolean {
  const sid = getCurrentSessionId()
  if (sid) {
    primeViewPreference(sid, viewId)
    scheduleActivate(sid, viewId, label, epoch)
    return true
  }
  if (epoch !== navEpoch) return false
  return selectHostView(label)
}

/**
 * 进入某个项目的工作台（「项目中心」里点卡片/记录行/「进入工作台」按钮的统一入口）。
 *
 * @param projectId - 目标项目
 * @param targetSessionId - 可选：直接落到该会话（序号点点击 = 快速进入对应对话的工作台）
 * @param intent - 可选：本次导航的意图；'debug' = 卡片上的「去调试」（预览 + 主对话两窗并存）
 * @returns 是否发起了导航
 */
export function enterProjectWorkbench(
  projectId: string,
  targetSessionId?: string,
  intent?: WorkbenchIntent,
): boolean {
  if (!projectId) return false
  // 进入工作台 = 使用过这个项目 → 刷新「上次更新时间」
  touchProject(projectId)
  const current = getCurrentSessionId()
  // 本次导航的意图以这里为准：先广播（已挂载的 ControlRoom 当场接住），再按项目留存
  // 一段时间（因本项目会话绑定而重建的那个实例靠 peekWorkbenchIntent 补齐）。
  // **不带 intent 的进入也要调用**：它把上一项目的「去调试」当场清掉（见 peekWorkbenchIntent）。
  requestWorkbench(undefined, intent, projectId)
  if (current) rememberOpenedProject(current, projectId)
  if (targetSessionId) {
    rememberOpenedProject(targetSessionId, projectId)
    if (targetSessionId !== current) {
      // 切到那个对话：先写好它的视图偏好再导航（宿主会在激活前读偏好）；
      // 宿主导航是异步的，因此延后多点几次 tab，等它真正切过去。
      primeViewPreference(targetSessionId, VIEW_ID)
      const ok = openSession(targetSessionId)
      // 代次在 openSession 之后再取：宿主导航可能触发自动绑定（那会开启新代次），
      // 若先取代次，我们的「点工作台 tab」会被绑定当场作废。
      scheduleSelectHostView(WORKBENCH_LABEL, [0, 120, 400, 900], beginNavigation())
      return ok
    }
  }
  return switchToView(VIEW_ID, WORKBENCH_LABEL)
}

/**
 * 归档后**留在本项目工作台**（不跳进「新建会话」）。
 *
 * 为什么必须由本插件接手：宿主 `uiWorkspace.archiveSession` 归档的若是**当前**会话，
 * 会顺手 `clearMain()`（mainReference=undefined + selection.set({}) + selectPanel(null)），
 * 界面于是掉回「新建会话」Hero —— 用户看到的就是「点归档后直接跳进一个全新会话」。
 * 宿主不会自己回来（watchNavigation 的 reconcile 只在 initial==='waiting' 时恢复，
 * 归档发生时它早已是 'done'），因此归档成功后必须显式再导航一次：
 *   ① 本项目还有别的会话 → 打开最近活动的那个（优先非空白，与 latestProjectSession 同口径）；
 *   ② 一个都不剩 → 在本项目下复用/新建一个空白会话，仍然落在它的工作台
 *      （没有会话时 ControlRoom 只会显示「会话上下文不可用」，那是更差的落点）。
 * @param projectPath - 被归档会话所属的项目目录
 * @param projectId - 该项目 id（写「上次打开的项目」记忆用）
 * @param archivedId - 刚被归档的会话 id（显式排除：归档集快照可能还没刷新）
 * @returns 是否发起了导航
 */
export function stayInProjectAfterArchive(
  projectPath: string,
  projectId: string,
  archivedId: string,
): boolean {
  const ctx: any = getClientContext()
  if (!ctx || !projectPath || !projectId) return false
  const remaining = readProjectSessions(ctx, projectPath).filter((s) => s.id !== archivedId)
  const next = pickOwnSession(remaining)
  if (next) return enterProjectWorkbench(projectId, next.id)
  void startProjectSession(projectPath, projectId, archivedId)
  return true
}

/**
 * 侧边栏「项目中心」入口：在**项目列表**与**工作台**两个 tab 之间切换。
 *
 * 语义（用户要求保留切换）：
 *   当前在「项目中心」（项目列表）→ 点一下回「工作台」；
 *   当前在「工作台」→ 点一下回「项目中心」。
 *
 * 当前在哪一屏由 getControlRoomScreen() 给出：ControlRoom（工作台）上报 'desk'，
 * ProjectCenter（项目列表）上报 'list'。两个方向都要保证：
 *   - 本插件视图被激活（空白会话也要能渲染）；
 *   - 点宿主 tab 真正切过去（宿主只渲染 store.view 指向的视图）。
 * @returns 是否成功发起导航
 */
export function openControlRoom(): boolean {
  const ctx: any = getClientContext()
  if (!ctx) return false
  const epoch = beginNavigation()
  const toDesk = getLiveScreen() === 'list'
  const current = getCurrentSessionId()
  if (current) {
    if (toDesk) {
      // 回工作台：先发信号让已挂载的 ControlRoom 恢复「上次打开的项目」，
      // 再切 tab（未挂载时 ControlRoom 挂载后自己从记忆恢复）
      requestWorkbench()
      switchToView(VIEW_ID, WORKBENCH_LABEL, epoch)
    } else {
      // 回项目列表：保留工作台记忆（切回来要知道回哪个项目），只置强制列表标记
      requestProjectList()
      switchToView(PROJECT_CENTER_VIEW_ID, PROJECT_CENTER_LABEL, epoch)
    }
    return true
  }
  // 没有当前会话：挑第一个项目的最新会话打开（打开后 ControlRoom 会显示工作台/引导页）
  for (const p of loadProjects()) {
    const s = latestProjectSession(ctx, p.path)
    if (!s) continue
    primeViewPreference(s.id)
    const ok = openSession(s.id)
    if (typeof window !== 'undefined') {
      // 代次同样在 openSession 之后再取（见 enterProjectWorkbench 的说明）
      const epoch = beginNavigation()
      window.setTimeout(() => {
        const back = getLiveScreen() === 'list'
        switchToView(
          back ? VIEW_ID : PROJECT_CENTER_VIEW_ID,
          back ? WORKBENCH_LABEL : PROJECT_CENTER_LABEL,
          epoch,
        )
      }, 150)
    }
    return ok
  }
  return false
}

/**
 * 把会话绑到指定项目（写偏好 + 项目记忆 + 已物化 binding 的视图切换）。
 *
 * 副作用：清掉「强制列表」标记并发工作台信号。
 * 绑定发生在真实导航（侧边栏点会话 → replaceMain 包装 / Probe 随会话切换）时，
 * 此时用户的意图就是看该项目的工作台——若不清 forceList，用户点过一次侧边栏
 * 「项目中心」后它会永久为 true，之后点任何会话都会被恢复逻辑短路停在列表。
 */
export function bindToProject(sessionId: string, projectId: string): boolean {
  if (!sessionId || !projectId) return false
  primeViewPreference(sessionId)
  rememberOpenedProject(sessionId, projectId)
  // 清粘性标记 + 通知已挂载的 ControlRoom（跨会话时它会跳过，
  // 等 sessionId prop 更新后由 [sessionId] 恢复 effect 接手——两条路互为兼底）
  if (forceList) {
    forceList = false
    emitDesk(sessionId)
  }
  // 关键：若该会话的 binding 已经物化（例如复用了已存在的空白会话，其视图已按
  // 偏好定成 chat），只写 localStorage 不会重激活——必须显式把视图切回来。
  // 延后多次尝试激活（见 scheduleActivate 注释：新建的空白会话 binding 尚未物化）。
  scheduleActivate(sessionId)
  // 记下“已绑过”：重试链见到它就不再重复激活/点 tab
  boundSessions.add(sessionId)
  if (boundSessions.size > 500) boundSessions.clear()
  return true
}

/** 已成功绑到工作台的会话（防止重试链反复激活/点 tab） */
const boundSessions = new Set<string>()

/**
 * 尽力把一个会话绑到它所属项目的工作台（幂等，可多次调用）。
 *
 * 为什么需要“等一等”：`sessions.create` 返回时，新会话往往**还没进**
 * sessions.list 快照，`sessionCwd` 读不到 cwd，绑定会当场失败（于是宿主只能
 * 回落到默认的「对话」tab）。入参不足以定位项目时，就靠这串重试等列表刷新。
 * @param sessionId - 目标会话
 * @returns 是否当场绑定成功（false 表示已排好重试）
 */
export function bindSessionEventually(sessionId: string): boolean {
  if (!sessionId) return false
  const attempt = (): boolean => {
    if (boundSessions.has(sessionId)) return true
    try {
      return bindSessionToItsProject(sessionId)
    } catch {
      return false
    }
  }
  if (attempt()) return true
  if (typeof window === 'undefined') return false
  for (const d of [120, 300, 700, 1500, 3000]) window.setTimeout(attempt, d)
  return false
}

/**
 * 把某个会话的当前视图切到指定 conversation.view（binding 已物化时生效；未物化时靠偏好）。
 *
 * 宿主在 restoreView 时会读 localStorage 偏好，但**已物化**的 binding 不会再读；
 * 侧边栏「新建会话」恰好是「复用空白会话 → 导航」，复用时视图可能已是 chat。
 * 因此需要主动调 uiConversation.binding(id).activate(viewId)。
 * @param sessionId - 目标会话
 * @param viewId - 要激活的视图 id（默认「工作台」）
 */
function activateView(sessionId: string, viewId: string = VIEW_ID): void {
  const ctx: any = getClientContext()
  if (!ctx) return
  try {
    const conv = readService<any>(ctx, 'uiConversation')
    const binding = conv?.binding?.(sessionId)
    if (binding && typeof binding.activate === 'function') binding.activate(viewId)
  } catch (e) {
    // binding 未物化/会话尚未注册：静默，偏好已写好，激活时自会生效
  }
}

/**
 * 多次尝试把视图切到指定 conversation.view（默认「工作台」）。
 *
 * 为什么要重试：新建会话刚返回时，`uiConversation.binding(id)` 可能还没物化（抛错），
 * 只试一次会静默失败。而**空白会话**下宿主 `DefaultConversationViews` 会直接返回 null
 * （`session.blank && phase==='blank'`）——一个 view 都不渲染；只有把我们的 view
 * 加入 activeTargets，`conversationPhase` 才会变 'active'，视图才显示出来。
 * 所以必须在一小段时间内多试几次，覆盖 binding 物化的时机。
 * @param sessionId - 目标会话
 * @param viewId - 要激活的视图 id
 * @param label - 对应 tab 文案（用于 DOM 点击；不传则不点 tab）
 */
const ACTIVATE_DELAYS = [0, 60, 200, 600, 1500]
function scheduleActivate(
  sessionId: string,
  viewId: string = VIEW_ID,
  label: string = WORKBENCH_LABEL,
  epoch: number = beginNavigation(),
): void {
  if (!sessionId) return
  // 数据层激活（让 view 参与组装，空白会话才会渲染出我们的视图）
  for (const d of ACTIVATE_DELAYS) {
    if (d === 0) {
      runIfCurrent(epoch, () => activateView(sessionId, viewId))
    } else if (typeof window !== 'undefined') {
      window.setTimeout(() => runIfCurrent(epoch, () => activateView(sessionId, viewId)), d)
    }
  }
  // UI 层激活：宿主只渲染 store.view 指向的那个视图，而 store.view 只在
  // 会话首次绑定时从偏好读一次。因此**必须点它自己的 tab**才能真把界面切过去。
  // 延迟几次是因为新会话切过去后 tab 列表才渲染出来。
  scheduleSelectHostView(label, [0, 120, 400, 900], epoch)
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
          // 入参不足以判定时（例如未传 workspaceId），再退回按 cwd 查；
          // 刚创建的会话可能还没进列表快照，交给 bindSessionEventually 重试。
          if (!bound) bindSessionEventually(String(id))
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

// —— 宿主「新会话」入口接管 ———————————————
/**
 * 宿主侧边栏「新会话」的**总入口**（uiWorkspace.startSession）——tokensave 接管。
 *
 * 宿主的全部「新会话」按钮最终都汇到这里（已核对 ui-sidebar / ui-workspace 客户端源码）：
 *   - 徽标下的「新会话」、收起态 rail 的新建图标、快捷键 Mod+N：`startSession()`（无 workspaceId）；
 *   - 项目文件夹行悬浮出现的「新会话」：`startSession(workspaceId)`。
 *
 * 用户要求的分流：
 *   - **无 workspaceId** → 不新建会话，直接把当前视图切到「项目中心」（项目列表），
 *     由用户在列表里选一个项目（或添加项目）后再进入它的工作台；
 *   - **带 workspaceId** → 该工作区对应的 tokensave 项目（未登记则自动登记）下
 *     新建（或复用空白）会话，并直接进入其工作台；
 *   - 没有项目、没有会话上下文等异常 → 原样交回宿主，绝不阻断原生能力。
 */
export function wrapSessionStart(): void {
  const ctx: any = getClientContext()
  if (!ctx) return
  const attempt = (): boolean => {
    const ui = svc(ctx, 'uiWorkspace')
    if (!ui || typeof ui.startSession !== 'function') return false
    if ((ui.startSession as any).__tokensaveWrapped) return true
    const original = ui.startSession.bind(ui)
    const wrapped = (workspaceId?: any) => {
      const explicit = workspaceId !== undefined && workspaceId !== null && workspaceId !== ''
      if (!explicit) {
        // 徽标下的「新会话」→ 项目中心（项目列表）
        try {
          if (openProjectCenterList()) return
        } catch (e) {
          console.warn('[tokensave] 引导到项目中心失败，回落宿主原生行为', e)
        }
        return original(workspaceId)
      }
      // 项目文件夹悬浮的「新会话」→ 该项目的工作台
      let handled = false
      try {
        const project = ensureProjectForWorkspace(ctx, String(workspaceId))
        if (project) {
          handled = true
          void startProjectSession(project.path, project.id).then((res) => {
            if (!res.ok) {
              console.warn('[tokensave] 新会话进工作台失败，回落宿主原生行为', res.error)
              try { original(workspaceId) } catch (e) { console.warn('[tokensave] 回落失败', e) }
            }
          })
        }
      } catch (e) {
        console.warn('[tokensave] 「新会话」接管失败，回落宿主原生行为', e)
      }
      if (handled) return
      return original(workspaceId)
    }
    ;(wrapped as any).__tokensaveWrapped = true
    try {
      ui.startSession = wrapped
      console.log('[tokensave] 已接管 uiWorkspace.startSession（新会话 → 项目中心 / 工作台）')
      return true
    } catch (e) {
      console.warn('[tokensave] 无法替换 uiWorkspace.startSession（只读？）', e)
      return false
    }
  }
  if (attempt()) return
  try {
    ctx.inject?.(['uiWorkspace'], () => { attempt() })
  } catch (e) {
    console.warn('[tokensave] 等待 uiWorkspace 失败（新会话接管退化为原生）', e)
  }
}

/** 工作区 id → 已登记项目（未登记返回 undefined）。 */
export function projectByWorkspaceId(ctx: any, workspaceId: string): ProjectRecord | undefined {
  if (!ctx || !workspaceId) return undefined
  return loadProjects().find((p) => readProjectWorkspaceId(ctx, p.path) === workspaceId)
}

/** 宿主工作区行（侧栏的「项目文件夹」）的路径与标题。 */
function workspaceRowById(ctx: any, workspaceId: string): { path: string; title: string } | null {
  if (!ctx || !workspaceId) return null
  const hit = readWorkspaceItems(ctx).find((w: any) => String(w?.workspaceId) === workspaceId)
  const path = typeof hit?.path === 'string' ? hit.path : ''
  if (!path) return null
  return { path, title: String(hit?.title || '') }
}

/**
 * 工作区 → tokensave 项目：已登记直接返回；未登记则按工作区路径/标题**自动登记**。
 *
 * 用户选择「自动登记」，让侧边栏每一个「新会话」按钮都落到 tokensave 工作台；
 * 自动登记的项目在「项目中心」里可见、可移除。
 * @returns 对应项目（拿不到工作区路径时返回 undefined，调用方回落宿主原生行为）
 */
export function ensureProjectForWorkspace(ctx: any, workspaceId: string): ProjectRecord | undefined {
  const existing = projectByWorkspaceId(ctx, workspaceId)
  if (existing) return existing
  const row = workspaceRowById(ctx, workspaceId)
  if (!row) return undefined
  const name = row.title || row.path.split('/').pop() || row.path
  return addProject(name, row.path)
}

/**
 * 把当前视图切到「项目中心」的**项目列表**屏（不新建会话）。
 *
 * 有当前会话时：写该会话的视图偏好 + 点宿主 tab，即可落到列表。
 * 没有当前会话（应用刚启动、停在 New Session 纯视图）时：先打开一个已登记项目的
 * 最新会话以取得会话上下文，再切列表（这次导航不做工作台绑定，见 skipNextBindFor）。
 * @returns 是否发起了导航（false 表示应回落宿主原生的「新会话」）
 */
export function openProjectCenterList(): boolean {
  const ctx: any = getClientContext()
  if (!ctx) return false
  const current = getCurrentSessionId()
  if (current) {
    const epoch = beginNavigation()
    requestProjectList()
    return switchToView(PROJECT_CENTER_VIEW_ID, PROJECT_CENTER_LABEL, epoch)
  }
  const ordered = loadProjects().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  for (const project of ordered) {
    const s = latestProjectSession(ctx, project.path)
    if (!s) continue
    // 这次导航只为了拿会话上下文，随后切到项目列表；不绑工作台（否则又被拉回去）
    skipNextBindFor(s.id)
    primeViewPreference(s.id, PROJECT_CENTER_VIEW_ID)
    rememberOpenedProject(s.id, null)
    const ok = openSession(s.id)
    // 代次在 openSession 之后取：即便这次导航意外触发绑定，我们的目标也仍是最新意图
    const epoch = beginNavigation()
    scheduleSelectHostView(PROJECT_CENTER_LABEL, [0, 150, 500, 1200], epoch)
    return ok
  }
  return false
}

// —— conversation.view target 注册（空白会话可渲染的钥匙）——————
/**
 * 为 tokensave 的两个 `conversation.view` 注册**视图 target**，让它们在「空白会话」下也能显示。
 *
 * 宿主 `conversationPhase()` 对空白会话（`session.blank` 且还没发过首轮）只在
 * `conversation.activeTargets.size > 0` 时才返回 `'active'`，否则 ConversationRoot
 * 直接 `return null`（显示 Hero「选择一个工作区」）。而 activeTargets 只装
 * **注册过 target 且 `isActive()` 为真**的视图（ui-chat 的 `'chat'`、ui-trajectory 的
 * `'trajectory'` 都自带定义）；只用 slot 注册的视图没有 target，
 * `binding(sessionId).activate(viewId)` 是空操作 → 空白会话永远不渲染我们的视图。
 *
 * 这就是「点新建会话/新会话后进不了工作台、只看到『选择一个工作区』」的根因：
 * 新建出来的是**空白会话**。补上 target 后，宿主自己的 `restoreView`（读视图偏好）
 * 与本插件的 `scheduleActivate` 就能把会话拉成 'active'，工作台/项目中心随即渲染。
 */
export function registerViewTargets(ctx: any): void {
  if (!ctx) return
  const install = (): boolean => {
    const uiConv = readService<any>(ctx, 'uiConversation')
    if (!uiConv || typeof uiConv.views?.register !== 'function') return false
    // 视图本体由 slot 渲染；target 只参与 activeTargets/phase 计算，
    // 因此给一个最小快照构造器（replace/apply 返回空快照即可）。
    const definitions = [VIEW_ID, PROJECT_CENTER_VIEW_ID].map((target) => ({
      target,
      create: () => ({
        replace: () => ({ order: [], nodes: new Map() }),
        apply: () => ({ order: [], nodes: new Map() }),
      }),
      // 只要被 activate 就计为“有可见活动”（空白会话由此进入 active 阶段）
      isActive: () => true,
    }))
    const registerAll = () => {
      const disposers: Array<() => void> = []
      for (const definition of definitions) {
        try {
          disposers.push(uiConv.views.register(definition))
        } catch (e) {
          // 已注册（HMR / 重入）：不重复注册，也不影响其它定义
          console.warn(`[tokensave] 视图 target "${definition.target}" 注册跳过`, e)
        }
      }
      return () => {
        for (const off of disposers) {
          try { off() } catch { /* noop */ }
        }
      }
    }
    try {
      // 挂在 fiber 生命周期上：dsh-hmr full reload 时先注销再重装，避免“已注册”残留
      if (typeof ctx.effect === 'function') ctx.effect(registerAll, 'tokensave: conversation view targets')
      else registerAll()
      console.log('[tokensave] 已注册工作台 / 项目中心视图 target（空白会话也能显示）')
      return true
    } catch (e) {
      console.warn('[tokensave] 注册视图 target 失败（空白会话可能只看到 Hero）', e)
      return false
    }
  }
  if (install()) return
  try {
    ctx.inject?.(['uiConversation'], () => { install() })
  } catch (e) {
    console.warn('[tokensave] 等待 uiConversation 失败（视图 target 未注册）', e)
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
