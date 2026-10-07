// 探索者会话流（Step 11）：数据源为 session-subscribe 的 subscribeSession
//（doc 占位名的正式实现，feature-detect 三级降级，连接状态在控制台留痕）。
import React, { useEffect, useState } from 'react'
import { subscribeSession } from '../session-subscribe'
import type { StreamMsg } from '../session-subscribe'

interface Props {
  sessionId: string
  visible: boolean
  bossKey: string
}

export function ExplorerStream({ sessionId, visible, bossKey }: Props) {
  const [messages, setMessages] = useState<StreamMsg[]>([])

  useEffect(() => {
    if (!visible) return
    // 订阅推送全量消息列表（ObservableSnapshot 重建），直接替换状态
    const un = subscribeSession(sessionId, (list) => setMessages(list))
    return () => un()
  }, [sessionId, visible])

  return (
    <div className="explorer-stream">
      <div className="stream-header">
        <span>会话 {sessionId.slice(0, 8)}</span>
        <span className="boss-key-hint">按 {bossKey} 最小化</span>
      </div>
      <div className="stream-messages">
        {messages.length === 0 && <div className="msg msg-system">等待会话消息…</div>}
        {messages.map((msg, i) => (
          <div key={i} className={`msg msg-${msg.role}`}>
            {msg.content}
          </div>
        ))}
      </div>
    </div>
  )
}
