/**
 * 侧边栏「项目中心」入口的**呼吸灯**（小圆点）。
 *
 * 语义（用户约定）：
 *   - 任何**已登记项目**下只要有对话「活着」（正在跑 / 弹着选择框 / 上一轮没正常结束），
 *     就显示小圆点；全都完成（没有存活对话）时**一个点都不显示**，入口回落成原来的图标；
 *   - 正常使用（模型正在跑）= 绿色；弹选择框 / 被故障中断 = 黄色（黄覆盖绿）；
 *   - 有对话正在跑 → 圆点**依次闪烁**（跑马灯）；只有待确认 / 失败时 → 同相呼吸。
 *
 * 数据源（全部是宿主客户端服务，不发网络请求）：
 *   - `running` / `pendingInteraction`：`uiSession.sessionStatus`，与项目卡片上的 ①②③
 *     同源（见 activity.ts）；
 *   - 「上一轮是否正常结束」：宿主客户端**没有**这个字段（SessionSummary 只有
 *     running/blank/updatedAt，sessionListStatus 只有 running/pendingInteraction/
 *     completionUnread），只能读会话事件窗口里最后一条 `turn/end` 的
 *     `reason.kind`（completed/forked/aborted 之外 = error/interrupted/blocked/max-tokens）。
 *     读窗口要 retain 会话（`sessions.using`），**有成本**，因此这里限量 + 节流 + 按
 *     updatedAt 缓存：只在最近 1 小时内有活动、且已经停下来的会话里取最近几个，
 *     每个会话每 10 秒最多重新判定一次。
 */
import { useEffect, useState } from 'react'
import { getClientContext, readService } from '../session-subscribe'
import { readProjectActivity, statusSnapshot } from './activity'
import { readProjectSessions } from './sessions'
import { loadProjects } from './store'
import type { ProjectRecord } from './store'

/** 圆点颜色：ok = 绿（正常使用） / warn = 黄（待确认或上一轮没正常结束） */
export type PulseTone = 'ok' | 'warn'

export interface PulseState {
  /** 存活对话数：正在跑 + 待确认 + 上一轮失败 */
  alive: number
  /** 需要用户注意的数量（待确认 / 上一轮没正常结束） */
  warn: number
  /** 正在跑的对话数 */
  running: number
  /** 悬停说明（逐条列出存活对话） */
  tip: string
}

const EMPTY: PulseState = { alive: 0, warn: 0, running: 0, tip: '' }

// —— 「上一轮是否正常结束」的判定（限量 / 节流 / 缓存）——
/** 两次失败扫描之间的最小间隔 */
const SCAN_INTERVAL_MS = 10_000
/** 只看最近这段时间内有活动的会话（更旧的失败不再扫描，但仍保留缓存结论） */
const SCAN_WINDOW_MS = 60 * 60 * 1000
/** 一次扫描最多 retain 几个会话（成本上限） */
const SCAN_LIMIT = 5
/** sessionId → 最近一次判定（按 updatedAt 缓存，避免反复 retain 同一个会话） */
const outcomeCache = new Map<string, { at: number; failed: boolean; title: string }>()
let lastScanAt = 0
let scanning = false

/** 算作「被故障中断」的 turn/end reason。completed / forked / aborted（用户主动停止）不算。 */
const FAILED_TURN_KINDS = new Set(['error', 'interrupted', 'blocked', 'max-tokens'])

/**
 * 读一个会话事件窗口的最后结局：`turn/end.reason.kind`（或 agent/error）。
 * @returns true=上一轮没正常结束；false=正常；null=读不到（服务/窗口不可用，不参与判定）
 */
async function sessionTurnFailed(ctx: any, sessionId: string): Promise<boolean | null> {
  const sessions = readService<any>(ctx, 'sessions')
  if (!sessions || typeof sessions.using !== 'function') return null
  try {
    return await sessions.using(sessionId, { source: 'gateway' }, async (reference: any) => {
      const binding = await reference.ready
      const snap = binding?.eventSource?.getSnapshot?.()
      const entries: any[] = Array.isArray(snap?.entries) ? snap.entries : []
      let last: any = null
      for (const entry of entries) {
        const ev = entry?.type === 'transient' ? entry.event : entry?.event
        if (!ev || typeof ev.type !== 'string') continue
        if (ev.type === 'turn/end' || ev.type === 'agent/error') last = ev
      }
      if (!last) return false
      if (last.type === 'agent/error') return true
      const kind = String(last?.data?.reason?.kind || '')
      return kind !== '' && FAILED_TURN_KINDS.has(kind)
    })
  } catch (e) {
    // 未就绪 / 会话不存在 / 窗口读不到：不下结论（下次再试）
    return null
  }
}

/** 扫描「已停下来、但上一轮没正常结束」的会话，结果进 outcomeCache。 */
async function scanOutcomes(ctx: any, projects: ProjectRecord[]): Promise<void> {
  const now = Date.now()
  if (scanning || now - lastScanAt < SCAN_INTERVAL_MS) return
  lastScanAt = now
  scanning = true
  try {
    const statuses = statusSnapshot(ctx)
    const candidates: Array<{ id: string; title: string; at: number }> = []
    for (const project of projects) {
      for (const s of readProjectSessions(ctx, project.path)) {
        if (s.blank) continue
        const st = statuses?.get(s.id)
        // 正在跑 / 弹着选择框的会话不参与「失败」判定（它们已经由状态源覆盖）
        if (st?.running === true || st?.pendingInteraction != null) continue
        if (now - (s.updatedAt || 0) > SCAN_WINDOW_MS) continue
        const hit = outcomeCache.get(s.id)
        if (hit && hit.at === s.updatedAt) continue
        candidates.push({ id: s.id, title: s.title, at: s.updatedAt })
      }
    }
    candidates.sort((a, b) => b.at - a.at)
    for (const c of candidates.slice(0, SCAN_LIMIT)) {
      const failed = await sessionTurnFailed(ctx, c.id)
      if (failed === null) continue
      outcomeCache.set(c.id, { at: c.at, failed, title: c.title })
    }
    // 防御性清理（缓存只增不减时会随会话数缓慢膨胀）
    if (outcomeCache.size > 400) outcomeCache.clear()
  } catch (e) {
    console.warn('[tokensave] 扫描会话结局失败', e)
  } finally {
    scanning = false
  }
}

/**
 * 订阅全局存活状态（侧边栏呼吸灯用）。
 *
 * 订阅 `sessions.list` 与 `uiSession.sessionStatus`，并有 4s 兜底轮询
 * （与 activity.ts 的 useProjectsActivity 同款思路）。
 */
export function useActivityPulse(): PulseState {
  const [state, setState] = useState<PulseState>(EMPTY)

  useEffect(() => {
    const ctx: any = getClientContext()
    if (!ctx) return
    let live = true

    const read = () => {
      const projects = loadProjects()
      const statuses = statusSnapshot(ctx)
      let running = 0
      let warn = 0
      const tips: string[] = []
      for (const project of projects) {
        for (const a of readProjectActivity(ctx, project.path)) {
          if (a.state === 'pending') {
            warn++
            tips.push(`⏳ 待你确认：${a.title}`)
          } else {
            running++
            tips.push(`● 进行中：${a.title}`)
          }
        }
      }
      for (const [id, hit] of outcomeCache) {
        if (!hit.failed) continue
        const st = statuses?.get(id)
        if (st?.running === true || st?.pendingInteraction != null) continue
        warn++
        tips.push(`⚠️ 上一轮未正常结束：${hit.title}`)
      }
      if (!live) return
      setState(tips.length > 0
        ? { alive: running + warn, warn, running, tip: tips.slice(0, 12).join('\n') }
        : EMPTY)
      // 顺带推进「失败」扫描（自带节流；结论会在下一次 read 时反映出来）
      void scanOutcomes(ctx, projects)
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
      live = false
      for (const u of unsubs) {
        try {
          u()
        } catch {
          /* noop */
        }
      }
      window.clearInterval(timer)
    }
  }, [])

  return state
}
