/**
 * 中下格：DSH 主对话只读消息流
 *
 * 会话记录原本只渲染在宿主的「对话」tab 里（工作台内发送消息不会自动切 tab），
 * 于是中下卡片看起来是空的。这里用与探索者窗口同一套订阅（session-subscribe
 * 的事件窗口快照）把当前会话的消息记录就地渲染出来，输入条仍由宿主原生
 * composer 停靠在本格底部（见 HDesk 的 useDockNativeComposer）。
 *
 * 只读：不复制宿主的发送/停止逻辑，避免与原生 composer 抢职责。
 */
import React, { useEffect, useState } from 'react'
import { subscribeSession } from '../session-subscribe'
import type { StreamMsg } from '../session-subscribe'
import { MsgList } from './MsgList'

export function MainChat({ sessionId, actions }: { sessionId: string; actions?: React.ReactNode }) {
  const [messages, setMessages] = useState<StreamMsg[]>([])

  useEffect(() => {
    if (!sessionId) {
      setMessages([])
      return
    }
    const un = subscribeSession(sessionId, (list) => setMessages(list))
    return () => un()
  }, [sessionId])

  return (
    <div className="ts-mainchat">
      {/* #3 标题条：标题 + 中间信息（消息条数）居中，三键固定右上角 */}
      <div className="ts-mainchat-head">
        <span className="ts-head-title">💬 DSH 主对话</span>
        <span className="ts-head-mid ts-mainchat-sub">{messages.length} 条消息</span>
        {actions}
      </div>
      <MsgList
        messages={messages}
        emptyText="在下方输入框发送消息，对话内容会实时显示在这里。"
      />
    </div>
  )
}
