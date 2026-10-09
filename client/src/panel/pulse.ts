/**
 * 侧边栏「项目中心」入口的**呼吸灯**（小圆点）。
 *
 * 语义（用户约定）：
 *   - 任何**已登记项目**下只要有对话「活着」（正在跑 / 弹着选择框 / 上一轮没正常结束），
 *     就显示小圆点；全都完成（没有存活对话）时**一个点都不显示**，入口回落成原来的图标；
 *   - 正常使用（模型正在跑）= 绿色；弹选择框 / 被故障中断（含**输出被截断**）= 黄色（黄覆盖绿）；
 *   - 有对话正在跑 → 圆点**依次闪烁**（跑马灯）；只有待确认 / 失败时 → 同相呼吸。
 *
 * 数据源（全部是宿主客户端服务，不发网络请求）：
 *   - `running` / `pendingInteraction`：`uiSession.sessionStatus`，与项目卡片上的 ①②③
 *     同源（见 activity.ts）；
 *   - 「上一轮是否正常结束」：宿主客户端**没有**这个字段（SessionSummary 只有
 *     running/blank/updatedAt，sessionListStatus 只有 running/pendingInteraction/
 *     completionUnread），只能读会话事件窗口里最后一条 `turn/end` 的
 *     `reason.kind`（completed/forked/aborted-user 之外 = error/interrupted/blocked/max-tokens）。
 *     读窗口要 retain 会话（`sessions.using`），**有成本**，因此限量 + 节流 + 按
 *     updatedAt 缓存：只在最近 1 小时内有活动、且已经停下来的会话里取最近几个，
 *     每个会话每 10 秒最多重新判定一次。
 *
 * 结局判定有两条路（2026-10-09 修正：「输出被截断」后黄灯不亮 / 亮得太慢）：
 *
 *   1. **即时路（新增）**：`sessionStatus` 里任一会话 `running true → false`
 *      （宿主推来的「这轮停了」信号）→ 等 0.9s 让事件窗口写进刚结束的 `turn/end`
 *      → 立刻 retain 读一次结局并**立即重算**呼吸灯。
 *      原先只有节流扫描：≤10s 节流 + ≤4s 轮询 ≈ 最多 14~18s 才亮黄，
 *      而用户往往十几秒内就发了下一条消息——黄灯要么没出现、要么一闪而过
 *      （实测：06:19:12 被截断，06:19:28 就发了下一条，间隔仅 16s）。
 *   2. **兜底节流扫描**：仍是 10s 间隔、一次最多 5 个、按 updatedAt 缓存；这次加固了三处：
 *      单次读 8s 超时（一次卡住的 retain 不再把 `scanning` 永久顶死）、
 *      **负结论要「新鲜」**（结局时间早于停止时刻 = 窗口还没写进刚结束的轮次，不落缓存，稍后重读）、
 *      连读 3 次空窗口才落负缓存（读不到 ≠ 正常结束）。
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
/** 两次扫描之间的最小间隔 */
const SCAN_INTERVAL_MS = 10_000
/** 只看最近这段时间内有活动的会话（更旧的失败不再扫描，但仍保留缓存结论） */
const SCAN_WINDOW_MS = 60 * 60 * 1000
/** 一次扫描最多 retain 几个会话（成本上限） */
const SCAN_LIMIT = 5
/** 单次 retain 读结局的超时（超过就放弃这一次，绝不能把 scanning 永久顶住） */
const READ_TIMEOUT_MS = 8_000
/** 扫描卡死的兜底：超过这时长还没结束，强制复位 scanning */
const SCAN_STUCK_MS = 60_000
/** sessionId → 最近一次判定（按 updatedAt 缓存，避免反复 retain 同一个会话） */
const outcomeCache = new Map<string, { at: number; failed: boolean; title: string }>()
/** sessionId → 连续几次读不到结局（连读 3 次就按「无异常」落缓存，停止无谓的 retain） */
const missCounts = new Map<string, number>()
let lastScanAt = 0
let scanStartedAt = 0
let scanning = false

/** 算作「被故障中断」的 turn/end reason。completed / forked / aborted（用户主动停止）不算。 */
const FAILED_TURN_KINDS = new Set(['error', 'interrupted', 'blocked', 'max-tokens'])

// —— 即时判定（停止信号 → 立刻读结局）——
/** 结局缓存一变就通知 useActivityPulse 立刻重算，不必等 4s 轮询 */
const outcomeListeners = new Set<() => void>()
function notifyOutcome(): void {
  for (const fn of [...outcomeListeners]) {
    try {
      fn()
    } catch {
      /* 单个订阅者出错不影响其它订阅者 */
    }
  }
}
/** sessionId → 观察到「停止」的本地时刻（负结论新鲜度判定用） */
const stoppedAt = new Map<string, number>()
/** 正在即时判定中的会话（防重入） */
const inflight = new Set<string>()
/** 停止后等多久再读窗口（让宿主把刚结束的 turn/end 写进快照） */
const STOP_CHECK_DELAY_MS = 900
/** 负结论「不新鲜」时的重读间隔与次数 */
const STOP_CHECK_RETRY_MS = 2_600
const STOP_CHECK_RETRIES = 2
/** 结局时间落后停止时刻超过此值 → 视为窗口还没更新，负结论暂不落缓存 */
const TURN_FRESH_SLACK_MS = 5_000
/** 停止已超过这时长还读到旧结局 → 不再较真，直接落缓存（避免每轮扫描反复 retain） */
const STALE_NEGATIVE_GRACE_MS = 30_000

interface TurnOutcome {
  /** 上一轮是否没正常结束 */
  failed: boolean
  /** 该结局事件的时间（宿主 ms 时钟；判定新鲜度用） */
  turnAt: number
}

/** 给任意 promise 加超时；超时按读不到处理（null），绝不让调用方永久挂起。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false
    const timer = window.setTimeout(() => {
      if (!done) {
        done = true
        resolve(null)
      }
    }, ms)
    promise.then(
      (value) => {
        if (!done) {
          done = true
          window.clearTimeout(timer)
          resolve(value)
        }
      },
      () => {
        if (!done) {
          done = true
          window.clearTimeout(timer)
          resolve(null)
        }
      },
    )
  })
}

/** 读会话目录行（标题 / updatedAt 即时判定落缓存时用）。 */
function sessionRow(ctx: any, sessionId: string): any {
  try {
    return readService<any>(ctx, 'sessions')?.list?.getSnapshot?.()?.byId?.[sessionId]
  } catch {
    return undefined
  }
}

/**
 * 该会话是否属于某个已登记项目（且非空白）——与节流扫描的取数口径一致。
 * 即时路只对这些会话下结论：子代理 / 其它目录的对话不进呼吸灯，
 * 否则探索者一报错黄灯就常亮（原有语义是「已登记项目下的对话」）。
 */
function belongsToRegisteredProject(ctx: any, sessionId: string): boolean {
  const row = sessionRow(ctx, sessionId)
  if (!row || row.blank) return false
  try {
    for (const project of loadProjects()) {
      for (const s of readProjectSessions(ctx, project.path)) {
        if (s.id === sessionId) return true
      }
    }
  } catch {
    /* 项目表不可读：不即时下结论，交给节流扫描 */
  }
  return false
}

/**
 * 读一个会话事件窗口的最后结局：`turn/end.reason.kind`（或 agent/error）。
 * @returns 读到结局时返回 { failed, turnAt }；读不到（服务/窗口不可用/窗口里没有结局事件）
 *          返回 null —— 「读不到」不等于「正常结束」，不参与缓存。
 */
async function readTurnOutcome(ctx: any, sessionId: string): Promise<TurnOutcome | null> {
  const sessions = readService<any>(ctx, 'sessions')
  if (!sessions || typeof sessions.using !== 'function') return null
  try {
    const raw = await sessions.using(sessionId, { source: 'gateway' }, async (reference: any) => {
      const binding = await reference.ready
      const snap = binding?.eventSource?.getSnapshot?.()
      const entries: any[] = Array.isArray(snap?.entries) ? snap.entries : []
      let last: any = null
      for (const entry of entries) {
        const ev = entry?.type === 'transient' ? entry.event : entry?.event
        if (!ev || typeof ev.type !== 'string') continue
        if (ev.type === 'turn/end' || ev.type === 'agent/error') last = ev
      }
      if (!last) return null
      const turnAt = Number(last.time) || 0
      if (last.type === 'agent/error') return { failed: true, turnAt }
      const kind = String(last?.data?.reason?.kind || '')
      if (kind === '') return null
      if (kind === 'aborted') {
        // 用户主动按的停止不算故障；登出/钩子等异常中止与工作台提示同一口径
        const sub = String(last?.data?.reason?.reason?.kind || '')
        return { failed: sub !== 'user', turnAt }
      }
      return { failed: FAILED_TURN_KINDS.has(kind), turnAt }
    })
    return raw ?? null
  } catch {
    // 未就绪 / 会话不存在 / 窗口读不到：不下结论（下次再试）
    return null
  }
}

/**
 * 把一次判定写进结局缓存。
 * @returns 是否写入。读不到、或负结论「不新鲜」（窗口还没写进刚结束的轮次）时不写，
 *          交给下一次重读 / 兜底扫描。
 */
function applyOutcome(ctx: any, sessionId: string, o: TurnOutcome | null): boolean {
  if (!o) return false
  const row = sessionRow(ctx, sessionId)
  const title = String(row?.title || row?.displayTitle || sessionId)
  const at = Number(row?.updatedAt) || 0
  if (o.failed) {
    outcomeCache.set(sessionId, { at, failed: true, title })
    notifyOutcome()
    return true
  }
  const stop = stoppedAt.get(sessionId) || 0
  const stale = stop > 0 && o.turnAt + TURN_FRESH_SLACK_MS < stop
  if (stale && Date.now() - stop < STALE_NEGATIVE_GRACE_MS) return false
  outcomeCache.set(sessionId, { at, failed: false, title })
  notifyOutcome()
  return true
}

/** 某会话的即时判定（可重入若干次）。延迟由调度方给。 */
function checkStoppedNow(ctx: any, sessionId: string, attempt: number): void {
  if (inflight.has(sessionId)) return
  inflight.add(sessionId)
  void (async () => {
    let written = false
    let o: TurnOutcome | null = null
    try {
      o = await withTimeout(readTurnOutcome(ctx, sessionId), READ_TIMEOUT_MS)
      written = applyOutcome(ctx, sessionId, o)
    } catch {
      /* 交给兜底扫描 */
    } finally {
      inflight.delete(sessionId)
    }
    // 没写成（读不到 / 结局还没进窗口）→ 再读一次，最多 STOP_CHECK_RETRIES 次
    if (!written && attempt < STOP_CHECK_RETRIES) {
      window.setTimeout(() => checkStoppedNow(ctx, sessionId, attempt + 1), STOP_CHECK_RETRY_MS)
    }
  })()
}

/** 扫描「已停下来、但上一轮没正常结束」的会话，结果进 outcomeCache。 */
async function scanOutcomes(ctx: any, projects: ProjectRecord[]): Promise<void> {
  const now = Date.now()
  // 上一轮卡死兜底：扫描超过 SCAN_STUCK_MS 仍未结束，视为卡住并复位（下一轮照常进行）
  if (scanning && now - scanStartedAt > SCAN_STUCK_MS) scanning = false
  if (scanning || now - lastScanAt < SCAN_INTERVAL_MS) return
  lastScanAt = now
  scanStartedAt = now
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
      const o = await withTimeout(readTurnOutcome(ctx, c.id), READ_TIMEOUT_MS)
      if (o === null) {
        const misses = (missCounts.get(c.id) || 0) + 1
        missCounts.set(c.id, misses)
        // 连读 3 次都读不到：不再反复 retain，按「无异常」结案
        if (misses >= 3) {
          outcomeCache.set(c.id, { at: c.at, failed: false, title: c.title })
          notifyOutcome()
          missCounts.delete(c.id)
        }
        continue
      }
      missCounts.delete(c.id)
      // 用候选收集时的 updatedAt 作缓存键（与下一轮 hit.at === s.updatedAt 同口径）
      const row = sessionRow(ctx, c.id)
      const title = String(row?.title || row?.displayTitle || c.title)
      const at = Number(row?.updatedAt) || c.at
      if (o.failed) {
        outcomeCache.set(c.id, { at, failed: true, title })
        notifyOutcome()
      } else {
        const stop = stoppedAt.get(c.id) || 0
        const stale = stop > 0 && o.turnAt + TURN_FRESH_SLACK_MS < stop
        if (!(stale && Date.now() - stop < STALE_NEGATIVE_GRACE_MS)) {
          outcomeCache.set(c.id, { at, failed: false, title })
          notifyOutcome()
        }
      }
    }
    // 防御性清理（缓存只增不减时会随会话数缓慢膨胀）
    if (outcomeCache.size > 400) outcomeCache.clear()
    if (stoppedAt.size > 400) stoppedAt.clear()
    if (missCounts.size > 400) missCounts.clear()
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
 * 任一会话 `running true → false` 时**立刻**做一次结局判定（见文件头「即时路」）。
 */
export function useActivityPulse(): PulseState {
  const [state, setState] = useState<PulseState>(EMPTY)

  useEffect(() => {
    const ctx: any = getClientContext()
    if (!ctx) return
    let live = true
    /** 上一次读到的 running（识别「刚停下」这个沿用） */
    const prevRunning = new Map<string, boolean>()

    const read = () => {
      const projects = loadProjects()
      const statuses = statusSnapshot(ctx)
      let running = 0
      let warn = 0
      const tips: string[] = []

      // 刚停下来的会话：立刻判结局，不等节流扫描（黄灯要“马上亮”）
      if (statuses) {
        for (const [id, row] of statuses) {
          const isRunning = row?.running === true
          const was = prevRunning.get(id)
          // 每次观察到的停止都重判一次（不做「已有结论就跳过」：同一 updatedAt 下
          // 可能已跑了新的一轮——自动续轮不改 updatedAt，旧黄灯必须被新结局覆盖）
          if (was === true && !isRunning && row?.pendingInteraction == null
            && belongsToRegisteredProject(ctx, id)) {
            stoppedAt.set(id, Date.now())
            window.setTimeout(() => checkStoppedNow(ctx, id, 0), STOP_CHECK_DELAY_MS)
            console.debug(`[tokensave] 会话停止 → 立即判定结局：${id}`)
          }
          prevRunning.set(id, isRunning)
        }
      }

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
    // 结局一落缓存就立刻重算（即时路写完缓存后的“点亮”就靠它）
    outcomeListeners.add(read)
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
      outcomeListeners.delete(read)
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

/**
 * 目检 / 排查钩子（浏览器 console 里用，不进 UI）：
 *   __tokensavePulse.check(id)  —— 立刻对某会话做一次结局判定（即时路同一入口）
 *   __tokensavePulse.cache       —— 结局缓存 Map（.get/.delete(id)，改完 .refresh() 即重算）
 *   __tokensavePulse.refresh()   —— 手动重算呼吸灯
 */
;(globalThis as any).__tokensavePulse = {
  check: (sessionId: string) => {
    const ctx = getClientContext()
    if (ctx && sessionId) checkStoppedNow(ctx, sessionId, 0)
  },
  cache: outcomeCache,
  refresh: notifyOutcome,
}
