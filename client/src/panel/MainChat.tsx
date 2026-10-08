/**
 * 中下格：DSH 主对话只读消息流
 *
 * 会话记录原本只渲染在宿主的「对话」tab 里（工作台内发送消息不会自动切 tab），
 * 于是中下卡片看起来是空的。这里用与探索者窗口同一套订阅（session-subscribe
 * 的事件窗口快照）把当前会话的消息记录就地渲染出来，输入条仍由宿主原生
 * composer 停靠在本格底部（见 HDesk 的 useDockNativeComposer）。
 *
 * 只读：不复制宿主的发送/停止逻辑，避免与原生 composer 抢职责。
 *
 * 历史分页：事件窗口只带「最近一段」，更早的靠 session face 的 loadOlder 拉页
 * （契约见 session-subscribe 的 loadOlderHistory）。滚动到顶部时 MsgList 会
 * 请求下一页并保持滚动位置，形成瀑布式按需加载。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { subscribeSession, loadOlderHistory, subscribeHistoryState } from '../session-subscribe'
import type { StreamMsg } from '../session-subscribe'
import { MsgList } from './MsgList'

interface HistoryState {
  hasMore: boolean
  loadingOlder: boolean
}

export function MainChat({ sessionId, actions }: { sessionId: string; actions?: React.ReactNode }) {
  const [messages, setMessages] = useState<StreamMsg[]>([])
  const [history, setHistory] = useState<HistoryState>({ hasMore: false, loadingOlder: false })

  useEffect(() => {
    if (!sessionId) {
      setMessages([])
      return
    }
    const un = subscribeSession(sessionId, (list) => setMessages(list))
    return () => un()
  }, [sessionId])

  // 历史分页状态（宿主 session 快照的 hasMore / loadingOlder）。
  // 订阅要等 openStream 拿到 binding，subscribeHistoryState 内部会重试附加。
  useEffect(() => {
    if (!sessionId) {
      setHistory({ hasMore: false, loadingOlder: false })
      return
    }
    return subscribeHistoryState(sessionId, (s) => {
      // 值没变就不写 state，避免每次推送都重渲染整条消息流
      setHistory((prev) => (prev.hasMore === s.hasMore && prev.loadingOlder === s.loadingOlder ? prev : s))
    })
  }, [sessionId])

  /**
   * 标题条上的消息统计：总数 + user / agent 细分。
   *
   * 口径（与 MsgList 的收纳一致）：
   *   msg   = 会话流里的全部行（用户/助手/工具…）
   *   user  = 你发出的消息——**不算**宿主自动注入的上下文（运行时快照/技能目录等）
   *   agent = 助手回复——**不算**思考（reasoning）片段（MsgList 单拎为「思考」）
   */
  const stat = useMemo(() => {
    let user = 0
    let agent = 0
    for (const m of messages) {
      if (m.role === 'user') {
        if (!m.injected) user++
      } else if (m.role === 'assistant') {
        if (m.kind !== 'reasoning') agent++
      }
    }
    return { total: messages.length, user, agent }
  }, [messages])
  const loadOlder = useCallback(async () => {
    if (!sessionId) return
    await loadOlderHistory(sessionId)
  }, [sessionId])

  return (
    <div className="ts-mainchat">
      {/* #3 标题条：标题 + 中间信息（消息条数）居中，三键固定右上角 */}
      <div className="ts-mainchat-head">
        <span className="ts-head-title">💬 DSH 主对话</span>
        <span
          className="ts-head-mid ts-mainchat-sub"
          title={`msg ${stat.total} · user ${stat.user} · agent ${stat.agent}`
            + '\n\nmsg：已载入的会话流行数（工具结果、上下文注入等都算一行；往上滚动加载更早历史后会变大）'
            + '\nuser：你发出的消息（不含宿主自动注入的运行时快照 / 审批通知 / 技能目录等）'
            + '\nagent：助手回复（不含思考片段与工具过程）'}
        >
          <span className="ts-msgstat"><span className="ts-msgstat-k">msg</span>{stat.total}</span>
          <span className="ts-msgstat-sep">·</span>
          <span className="ts-msgstat"><span className="ts-msgstat-k">user</span>{stat.user}</span>
          <span className="ts-msgstat-sep">·</span>
          <span className="ts-msgstat"><span className="ts-msgstat-k">agent</span>{stat.agent}</span>
        </span>
        {actions}
      </div>
      <MsgList
        messages={messages}
        emptyText="在下方输入框发送消息，对话内容会实时显示在这里。"
        hasMore={history.hasMore}
        loadingOlder={history.loadingOlder}
        onLoadOlder={loadOlder}
        followKey={sessionId}
      />
    </div>
  )
}
