/**
 * 项目活跃度（项目卡片/列表上的 ①②③ 序号点）
 *
 * 数据源全部是宿主客户端服务，不经 ctx.get() 之外的路径、不发网络请求：
 *   ctx.sessions.list.getSnapshot()
 *     → byId[id].updatedAt / cwd …（会话目录）
 *     → projectionsBySession[id].values.sessionListMetadata.lastPromptAt
 *       （**最后一次人发消息的时间**，排序用它）
 *   ctx.uiSession.sessionStatus.getSnapshot()
 *     → ReadonlyMap<id, { running, pendingInteraction, completionUnread }>
 *       （宿主侧边栏同款状态：running = 模型正在跑；pendingInteraction 见下）
 *
 * 规则（与用户约定一致）：
 *   - **活跃**：`running === true`，或存在待用户处理的弹窗（pendingInteraction）。
 *     待确认时模型虽然不在跑，但这条对话正卡在用户这边，必须让人看见，因此也算活跃。
 *   - 绿点 = 活跃；黄点 = 有弹窗待确认（覆盖绿）。
 *   - **非活跃的对话完全不显示**（不占号、不给空位）。
 *   - 编号只对活跃对话做**紧凑编号** ①②③…：按用户最后一次发言时间**倒序**，
 *     最新发言的那条 = ①；新开的对话一发言就顶到 ①。
 *   - 没有活跃对话 → 一个点都不显示。
 */
import { useEffect, useState } from 'react'
import { getClientContext, readService } from '../session-subscribe'
import { readProjectSessions } from './sessions'
import type { ProjectRecord } from './store'

/** 一个活跃对话的状态：绿（活跃） / 黄（待用户确认） */
export type ActivityState = 'active' | 'pending'

/** 一个项目里某条活跃对话的序号点 */
export interface SessionActivity {
  sessionId: string
  /** 会话标题（悬停提示用） */
  title: string
  /** 紧凑序号，1 = ① */
  order: number
  state: ActivityState
  /** 用户最后一次发言时间（Unix ms）：排序时已解析的投影值，调用方直接用作 lastPromptAt */
  updatedAt: number
}

/** 宿主会话状态行（uiSession.sessionStatus 的值） */
interface SessionStatusRow {
  running?: boolean
  pendingInteraction?: unknown
  completionUnread?: boolean
}
type SessionStatusMap = ReadonlyMap<string, SessionStatusRow> | Map<string, SessionStatusRow> | undefined

/** 读 uiSession.sessionStatus 的当前快照（服务不可用时返回 undefined）。 */
export function statusSnapshot(ctx: any): SessionStatusMap {
  try {
    const svc = readService<any>(ctx, 'uiSession')
    const src = svc?.sessionStatus
    return src && typeof src.getSnapshot === 'function' ? src.getSnapshot() : undefined
  } catch {
    return undefined
  }
}

/**
 * 该会话「用户最后一次发言」的时间（Unix ms）。
 *
 * 优先用宿主投影 sessionListMetadata.lastPromptAt（字面就是最近一条人发的消息）；
 * 投影缺失（冷会话/未加载）时退回列表行的 updatedAt，保证顺序仍然可用。
 */
export function lastPromptMs(ctx: any, sessionId: string, fallbackMs: number): number {
  try {
    const list = readService<any>(ctx, 'sessions')?.list
    const snapshot = list && typeof list.getSnapshot === 'function' ? list.getSnapshot() : undefined
    const at = snapshot?.projectionsBySession?.[sessionId]?.values?.sessionListMetadata?.lastPromptAt
    // 投影只在出现过人发的 user/message 后才有值；null/缺失都退回列表行 updatedAt
    if (typeof at === 'number' && at > 0) return at
  } catch {
    /* 投影缺失（冷会话/未加载）→ 退回调用方传入的 updatedAt，保证顺序仍然可用 */
  }
  return fallbackMs
}
/**
 * 读一个项目的活跃对话列表（已按约定排序并完成紧凑编号）。
 *
 * 非活跃对话直接跳过——调用方只需渲染返回的序号点；空数组表示「不显示任何点」。
 * @param ctx - 客户端上下文
 * @param projectPath - 项目工作区路径（与会话 cwd 同口径比较，见 readProjectSessions）
 * @returns 活跃对话（order 从 1 开始、按最近发言倒序）
 */
export function readProjectActivity(ctx: any, projectPath: string): SessionActivity[] {
  if (!ctx || !projectPath) return []
  const statuses = statusSnapshot(ctx)
  // 内部行用 at 排序后再映射成 SessionActivity（updatedAt 在映射时取 at），此处不需要 updatedAt 字段
  const rows: Array<Omit<SessionActivity, 'updatedAt'> & { at: number }> = []
  for (const s of readProjectSessions(ctx, projectPath)) {
    // 探索者是 worker 会话（BUG-2）：不进项目活动点、不进跑马灯——
    // 它们不是用户对话，混入会让「主对话窗口」出现探索者条目。
    if (s.explorer) continue
    const st = statuses?.get(s.id)
    const pending = st?.pendingInteraction != null
    const running = st?.running === true
    // 既不跑、也没等用户处理 → 非活跃，不显示
    if (!pending && !running) continue
    rows.push({
      sessionId: s.id,
      title: s.title,
      order: 0,
      state: pending ? 'pending' : 'active',
      at: lastPromptMs(ctx, s.id, s.updatedAt),
    })
  }
  rows.sort((a, b) => b.at - a.at)
  return rows.map((r, i) => ({
    sessionId: r.sessionId,
    title: r.title,
    order: i + 1,
    state: r.state,
    updatedAt: r.at,
  }))
}

/**
 * 批量读多个项目的活跃度，并在会话目录 / 会话状态变化时自动刷新。
 *
 * 订阅两个 ObservableSnapshot（sessions.list、uiSession.sessionStatus）；
 * 另有 4s 兜底轮询——这两个源在宿主版本里都带 subscribe，但订阅失败时不能
 * 让界面永远停在旧状态（与 sessions.ts 里 useProjectSessions 同款思路）。
 * @param projects - 已登记项目列表
 * @returns projectId → 活跃对话（无活跃则空数组）
 */
export function useProjectsActivity(projects: ProjectRecord[]): Record<string, SessionActivity[]> {
  const [byProject, setByProject] = useState<Record<string, SessionActivity[]>>({})
  // 只依赖项目身份集合：数组引用每次渲染都新，直接进依赖会导致无限重订阅
  const key = projects.map((p) => `${p.id}:${p.path}`).join('|')

  useEffect(() => {
    const ctx: any = getClientContext()
    if (!ctx || projects.length === 0) {
      setByProject({})
      return
    }
    const read = () => {
      const next: Record<string, SessionActivity[]> = {}
      for (const p of projects) {
        try {
          next[p.id] = readProjectActivity(ctx, p.path)
        } catch (e) {
          console.warn('[tokensave] 读取项目活跃度失败', e)
          next[p.id] = []
        }
      }
      setByProject(next)
    }
    read()
    const unsubs: Array<() => void> = []
    for (const src of [
      readService<any>(ctx, 'sessions')?.list,
      readService<any>(ctx, 'uiSession')?.sessionStatus,
    ]) {
      if (src && typeof src.subscribe === 'function') {
        try {
          unsubs.push(src.subscribe(read))
        } catch {
          /* 源不可订阅时退化为轮询 */
        }
      }
    }
    const timer = window.setInterval(read, 4_000)
    return () => {
      for (const u of unsubs) {
        try {
          u()
        } catch {
          /* noop */
        }
      }
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return byProject
}

/**
 * 每个项目最近一次对话活动时间（Unix ms）：该项目下**全部**对话的 lastPromptAt/updatedAt 最大值。
 *
 * 与 useProjectsActivity（只看「活跃」对话）不同，这里扫全部会话列表——
 * 「切换项目」列表按它排序：对话更新越近的项目排越前（用户要求）。
 * 数据源与 readProjectSessions 同一份宿主快照，订阅 + 4s 兜底轮询，思路同 useProjectsActivity。
 */
export function useProjectLastActivity(projects: ProjectRecord[]): Record<string, number> {
  const [byProject, setByProject] = useState<Record<string, number>>({})
  const key = projects.map((p) => `${p.id}:${p.path}`).join('|')

  useEffect(() => {
    const ctx: any = getClientContext()
    if (!ctx || projects.length === 0) {
      setByProject({})
      return
    }
    const read = () => {
      const next: Record<string, number> = {}
      for (const p of projects) {
        let best = 0
        try {
          for (const s of readProjectSessions(ctx, p.path)) {
            const at = lastPromptMs(ctx, s.id, s.updatedAt)
            if (at > best) best = at
          }
        } catch (e) {
          console.warn('[tokensave] failed to read project conversation time', e)
        }
        next[p.id] = best
      }
      setByProject(next)
    }
    read()
    const unsubs: Array<() => void> = []
    for (const src of [
      readService<any>(ctx, 'sessions')?.list,
      readService<any>(ctx, 'uiSession')?.sessionStatus,
    ]) {
      if (src && typeof src.subscribe === 'function') {
        try {
          unsubs.push(src.subscribe(read))
        } catch {
          /* if the source is not subscribable, degrade to polling */
        }
      }
    }
    const timer = window.setInterval(read, 4_000)
    return () => {
      for (const u of unsubs) {
        try {
          u()
        } catch {
          /* noop */
        }
      }
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return byProject
}
