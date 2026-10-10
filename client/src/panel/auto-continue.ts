/**
 * 自动继续引擎（挂在告警桥上，**不依赖面板是否打开**）。
 *
 * 为什么不在面板里做：面板只在鼠标悬停时才挂载，而「输出被截断」这轮结束后
 * 面板早就收起了 —— 自动继续必须在任何时刻都能触发，所以它挂在
 * `initSoundBridge`（插件挂载时一次、常驻）这条路上。
 *
 * 流程：告警进来 → `decideContinue` 判该不该自动 → 过 `gateAutoContinue` 三道闸
 * （暂停 / 连续次数 / 冷却退避）→ `scheduleAutoContinue` 延时真发。
 *
 * 用户一介入（面板里点「继续」、或自己发消息）会自动取消排队中的那次发送：
 * `cancelAutoContinue` + `noteUserActivity`。
 */
import { onPulseAlert, type InterruptInfo, type PulseAlert } from './pulse'
import {
  cancelAutoContinue, decideContinue, gateAutoContinue,
  noteUserActivity, scheduleAutoContinue, subscribeContinueSettings,
} from './continue-policy'
import { sendToSession } from './sessions'

/** 发送前的宽限期：宿主有时自己会接着跑（turn/start），这段时间内可被取消 */
const GRACE_MS = 3_000

export interface AutoContinueEvent {
  sessionId: string
  title: string
  /** auto=决定自动 / manual=只给按钮 / never=连按钮都不该给 */
  action: 'auto' | 'manual' | 'never'
  reason: string
  /** 实际走向：queued → sending → sent | error | cancelled（manual/never 不排程） */
  state: 'decided' | 'queued' | 'sending' | 'sent' | 'error' | 'cancelled'
  detail?: string
  at: number
}

type Listener = (e: AutoContinueEvent) => void
const listeners = new Set<Listener>()

/** 最近若干条自动继续事件（面板里展示「刚刚自动继续了哪条」用） */
const recent: AutoContinueEvent[] = []
const RECENT_MAX = 30

export function subscribeAutoContinue(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function recentAutoContinue(): readonly AutoContinueEvent[] {
  return recent
}

/**
 * 某会话当前自动继续的状态（清单里在已读按钮位置显示的东西）。
 *   sending —— 正在发（排队/发送中）
 *   sent    —— 已经自动发出去了（用户看到的就是「我不用管了」）
 *   error   —— 发了但失败（给出重试余地）
 *   idle    —— 没排过 / 已取消（这时显示「继续」按钮）
 */
export type SessionAutoState = 'sending' | 'sent' | 'error' | 'idle'

export function autoStateOf(sessionId: string): SessionAutoState {
  // 最近的记录就是当前状态（publish 每次 unshift，天然按时间倒序）
  for (const e of recent) {
    if (e.sessionId !== sessionId) continue
    if (e.action !== 'auto') return 'idle'
    if (e.state === 'queued' || e.state === 'sending') return 'sending'
    if (e.state === 'sent') return 'sent'
    if (e.state === 'error') return 'error'
    return 'idle'
  }
  return 'idle'
}

function publish(e: AutoContinueEvent): void {
  recent.unshift(e)
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX
  for (const cb of [...listeners]) {
    try {
      cb(e)
    } catch {
      /* 单个订阅者出错不影响其它订阅者 */
    }
  }
}

/**
 * 处理一条结局告警：判该不该自动继续，该就排一次发送。
 * @returns 判定结果（面板 / 调试可直接用）
 */
export function handlePulseAlert(a: PulseAlert, send: (text: string) => Promise<void> = (text) => sendToSession(a.sessionId, text)): AutoContinueEvent {
  const info: InterruptInfo = a.interrupt ?? { kind: a.kind === 'fail' ? 'error' : 'completed' }
  const decision = decideContinue(info)
  const title = a.title || a.sessionId
  const base = { sessionId: a.sessionId, title, action: decision.action, reason: decision.reason }

  if (decision.action !== 'auto') {
    // manual / never：不排程，只留一条记录（面板里的「继续」按钮仍然可用）
    const ev: AutoContinueEvent = { ...base, state: 'decided', at: Date.now() }
    publish(ev)
    return ev
  }

  const gate = gateAutoContinue(a.sessionId)
  if (!gate.ok) {
    const ev: AutoContinueEvent = { ...base, state: 'cancelled', detail: gate.reason, at: Date.now() }
    publish(ev)
    return ev
  }

  // 宽限期起点：若冷却还没走完，就等冷却剩下的时间
  const delay = Math.max(GRACE_MS, gate.waitMs)
  const ev: AutoContinueEvent = { ...base, state: 'queued', detail: `${Math.round(delay / 1000)}s 后发送`, at: Date.now() }
  publish(ev)

  scheduleAutoContinue({
    sessionId: a.sessionId,
    send,
    decision,
    delayMs: delay,
    onState: (state, detail) => {
      publish({ ...base, state, detail, at: Date.now() })
    },
  })
  return ev
}

let off: (() => void) | null = null
let offSettings: (() => void) | null = null

/**
 * 挂上自动继续（幂等，与声音桥同生命周期）。返回解绑函数。
 * 解绑时取消所有排着的发送，避免卸载后还往会话里灌消息。
 */
export function initAutoContinue(): () => void {
  if (!off) {
    off = onPulseAlert((a) => {
      if (a.kind !== 'fail') {
        // 正常结束：这一轮没出问题 → 连续次数清零（下一轮的退避从头算）
        noteUserActivity(a.sessionId)
        return
      }
      handlePulseAlert(a)
    })
  }
  // 开关一改就取消排队中的发送（关掉总开关 / 关掉某一类，排队的那次不该再发）
  if (!offSettings) {
    offSettings = subscribeContinueSettings(() => {
      for (const e of recent) {
        if (e.state === 'queued') cancelAutoContinue(e.sessionId)
      }
    })
  }
  return () => {
    if (off) {
      off()
      off = null
    }
    if (offSettings) {
      offSettings()
      offSettings = null
    }
  }
}

/** 面板里手动点了「继续」→ 视为用户介入（清零退避、取消排队） */
export function noteManualContinue(sessionId: string): void {
  cancelAutoContinue(sessionId)
  noteUserActivity(sessionId)
}

/** 自动继续的调试钩子（console 里用） */
;(globalThis as any).__tokensaveContinue = {
  recent: recentAutoContinue,
  decide: decideContinue,
  gate: gateAutoContinue,
  cancel: cancelAutoContinue,
  reset: () => {
    for (const e of [...recent]) cancelAutoContinue(e.sessionId)
    recent.length = 0
  },
}
