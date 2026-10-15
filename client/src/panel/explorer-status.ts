/**
 * 探索者状态角标（用户反馈：探索者一多，谁在跑、谁被中断、谁刚回了消息分不清，
 * 希望在**对应窗口的图标处**有角标，方便定位）。
 *
 * 数据全部来自客户端已有通道，不额外发请求：
 *   1. 宿主 telemetry 的 `state`（explorers 数组，每 8s 轮询一次那份）
 *      → 'running' = 正在跑
 *   2. 每条探索者会话的消息流（subscribeSession，与窗口/协作栏共用同一个通道）
 *      → 最后一条消息时间：比「上次看它的时间」新 = 有新消息（回消息）
 *      → 最后一条 assistant 的 notice（turn/end 的 reason / agent/error）
 *        = 这一轮不是正常结束（故障中断 / 截断 / 异常中止）
 *
 * 角标优先级：run（在跑）> notice（刚出问题，10 分钟内）> new（有新消息）> idle（安静）。
 */
import { useEffect, useRef, useState } from 'react'
import { subscribeSession } from '../session-subscribe'
import type { TelemetrySession } from './api'

export type ExplorerTone = 'run' | 'notice' | 'new' | 'idle'

export interface ExplorerBadge {
  tone: ExplorerTone
  /** 未读消息数（比 seenAt 新的 assistant 消息） */
  unread: number
  /** 最近一次活动时间（Unix ms） */
  lastMs: number
}

/** notice 只算「刚出问题」多久：超过这个时长的异常不再抢眼（免得永远挂着红点）。 */
const NOTICE_TTL_MS = 10 * 60 * 1000

/**
 * @param explorers 当前项目的探索者列表
 * @param seenAt    「已看过」时间戳表（调用方在激活某个探索者窗口时写一份）
 */
export function useExplorerBadges(
  explorers: TelemetrySession[],
  seenAt: { current: Record<string, number> },
): Record<string, ExplorerBadge> {
  const [raw, setRaw] = useState<Record<string, { lastMs: number; lastAssistantMs: number; noticeMs: number; total: number }>>({})
  const listRef = useRef<TelemetrySession[]>(explorers)
  listRef.current = explorers
  const idKey = explorers.map((e) => e.id).join(',')

  useEffect(() => {
    if (!idKey) {
      setRaw({})
      return
    }
    const unsubs = listRef.current.map((e) =>
      subscribeSession(e.id, (list) => {
        let lastMs = 0
        let lastAssistantMs = 0
        let noticeMs = 0
        for (const m of list) {
          const t = Number(m?.time ?? 0)
          if (t > lastMs) lastMs = t
          if (m?.role === 'assistant') {
            if (t > lastAssistantMs) lastAssistantMs = t
            // 有 notice = 这一轮异常结束（故障中断 / 截断 / 异常中止）
            if (m?.notice && t > noticeMs) noticeMs = t
          }
        }
        setRaw((prev) => {
          const key = e.id
          const cur = prev[key]
          if (cur && cur.lastMs === lastMs && cur.noticeMs === noticeMs && cur.total === list.length) return prev
          return { ...prev, [key]: { lastMs, lastAssistantMs, noticeMs, total: list.length } }
        })
      }),
    )
    return () => unsubs.forEach((un) => un())
  }, [idKey])

  const out: Record<string, ExplorerBadge> = {}
  const now = Date.now()
  for (const e of explorers) {
    const info = raw[e.id]
    const seen = seenAt.current[e.id] ?? 0
    const lastMs = info?.lastMs ?? 0
    const running = e.state === 'running'
    const freshNotice = !!info?.noticeMs && now - info.noticeMs < NOTICE_TTL_MS && info.noticeMs > seen
    // 从没打开过这条探索者（seen=0）但已经有回复 → 也算「有回消息」，给个绿点提示去看；
    // 打开过就用「比上次看的时间新」判断。
    const unread = !info
      ? 0
      : seen
        ? info.lastAssistantMs > seen
          ? 1
          : 0
        : info.lastAssistantMs
          ? 1
          : 0
    out[e.id] = {
      tone: running ? 'run' : freshNotice ? 'notice' : unread ? 'new' : 'idle',
      unread: running ? 0 : unread,
      lastMs,
    }
  }
  return out
}
