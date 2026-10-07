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
import { getClientContext } from '../session-subscribe'

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

/** 取一个宿主服务：优先 ctx.get（reflect 层，无需 inject），失败一律当不可用。 */
function svc(ctx: any, name: string): any {
  if (!ctx) return undefined
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]
  } catch {
    return undefined
  }
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
    primeViewPreference(id)
    if (ui && typeof ui.openSession === 'function') ui.openSession(id)
    else if (workspaceId && typeof ui?.openWorkspace === 'function') await ui.openWorkspace(workspaceId)
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '新建会话失败' }
  }
}

/** 预写某个会话的视图偏好（保留其它字段，隐私模式下静默忽略）。 */
export function primeViewPreference(sessionId: string): void {
  if (!sessionId || typeof localStorage === 'undefined') return
  const key = `${CONVERSATION_STORE_KEY}.${sessionId}`
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : null
    const next = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...parsed, view: VIEW_ID }
      : { draft: '', view: VIEW_ID, viewRequest: null }
    localStorage.setItem(key, JSON.stringify(next))
  } catch {
    /* 隐私模式等：忽略，仅影响新会话首次落点 */
  }
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
