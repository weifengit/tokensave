/**
 * 停靠输入条左上角的**运行计时提醒**——对齐原生对话 tab 的
 * 「深度求索中，用时10分10秒…」。
 *
 * 为什么工作台需要自己做：工作台把宿主原生输入条（composer seat）fixed 停靠进
 * 「DSH 主对话」面板，宿主只在它自己的对话页渲染运行提醒；停靠后那套 UI
 * 不跟着走，运行中除了消息流在长就没有任何"还在跑"的现场感。
 *
 * 数据（全部宿主客户端服务 + 已订阅的消息流，不发网络请求）：
 *   - 是否在跑：`uiSession.sessionStatus` 的 `running`（activity.ts 同源）；
 *   - 计时起点：本轮**最后一条真人消息**的 time（durable user/message）。
 *     注入的 runtime-context、收件箱里排队的消息都不算发言——它们不代表
 *     "这轮开始了"。窗口重建时 time 来自 SessionEvent.time（宿主时钟），
 *     刷新后重算依然正确。
 *
 * 呈现：一条小胶囊 absolute 定位在停靠输入条的上沿左侧（`--ts-composer-h`
 * 是 composer-dock.ts 写到 :root 的输入条实际高度），圆点呼吸 + 每秒刷新；
 * 会话停止 / 面板隐藏（visibility、display 可继承）时自然消失。
 */
import { useEffect, useState } from 'react'
import { getClientContext, readService, readTurnStartMs } from '../session-subscribe'
import type { StreamMsg } from '../session-subscribe'

/**
 * 本轮计时起点：消息流里最后一条**真人**消息的 time。
 * 从后往前找第一条 role==='user' 且非注入、非排队队列的消息。
 */
export function turnStartMsOf(messages: readonly StreamMsg[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user' && !m.injected && !m.queued) return m.time ?? null
  }
  return null
}

/** 秒数 → 用户口径的「10分10秒」（<1 分钟显示「45 秒」）。纯函数供自检复用。 */
export function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m <= 0) return `${r} 秒`
  return `${m}分${String(r).padStart(2, '0')}秒`
}

/** 订阅当前会话是否在跑（uiSession.sessionStatus；4s 兜底轮询防订阅失败）。 */
function useRunning(sessionId: string): boolean {
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!sessionId) {
      setRunning(false)
      return
    }
    const ctx: any = getClientContext()
    const src = readService<any>(ctx, 'uiSession')?.sessionStatus
    const read = () => {
      try {
        setRunning(src?.getSnapshot?.()?.get?.(sessionId)?.running === true)
      } catch {
        /* 服务不可用时保持旧值 */
      }
    }
    read()
    let unsub: (() => void) | null = null
    try {
      if (src && typeof src.subscribe === 'function') unsub = src.subscribe(read)
    } catch {
      /* 不可订阅时退化为轮询 */
    }
    const timer = window.setInterval(read, 4_000)
    return () => {
      try {
        unsub?.()
      } catch {
        /* noop */
      }
      window.clearInterval(timer)
    }
  }, [sessionId])
  return running
}

/**
 * 运行计时胶囊：挂在「DSH 主对话」面板容器内（absolute 定位靠容器与
 * `--ts-composer-h`），随面板隐藏而隐藏，不遮消息、不参与布局。
 */
export function ComposerRunBadge({ sessionId, messages }: {
  sessionId: string
  messages: readonly StreamMsg[]
}) {
  const running = useRunning(sessionId)
  // 计时起点与原生 RunningStatus 同拍：优先事件窗口里本轮 turn/start 的 time，
  // 拿不到（流未就绪 / 老窗口）回退到消息流里最后一条真人消息的时间。
  const startMs = readTurnStartMs(sessionId) ?? turnStartMsOf(messages)
  // 每秒重渲染一次拿新用时；不跑时挂空轮询
  const [, tick] = useState(0)
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => tick((n) => n + 1), 1_000)
    return () => window.clearInterval(t)
  }, [running])
  if (!running || startMs == null) return null
  const sec = Math.max(0, Math.round((Date.now() - startMs) / 1000))
  return (
    <div
      className="ts-run-badge"
      role="status"
      title="这轮对话从本轮 turn/start 起计时（与原生对话 tab 同口径）"
    >
      <span className="ts-run-dot" aria-hidden="true" />
      深度求索中，用时{formatElapsed(sec)}…
    </div>
  )
}
