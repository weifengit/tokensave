/**
 * 会话消息流列表（探索者窗口与主对话共用）
 * 中文角色标签；自动滚动到底部（按末条消息内容长度触发，覆盖流式追加）
 */
import React, { useEffect, useRef } from 'react'
import type { StreamMsg } from '../session-subscribe'

const ROLE_LABELS: Record<string, string> = {
  user: '我',
  assistant: '模型',
  tool: '工具',
  system: '系统',
}

export function MsgList({ messages, emptyText }: { messages: StreamMsg[]; emptyText?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const lastLen = messages.length > 0 ? messages[messages.length - 1].content.length : 0

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, lastLen])

  return (
    <div className="ts-chat-msgs" ref={ref} style={{ padding: 8 }}>
      {messages.length === 0 && (
        <div className="ts-hint">{emptyText ?? '等待会话消息…'}</div>
      )}
      {messages.map((msg, i) => (
        <div
          key={i}
          className={
            msg.role === 'user' ? 'ts-msg-user'
            : msg.role === 'assistant' ? 'ts-msg-assistant'
            : msg.role === 'tool' ? 'ts-msg-tool'
            : 'ts-msg-system'
          }
        >
          {msg.role !== 'user' && msg.role !== 'assistant' && (
            <div className="ts-msg-role">{ROLE_LABELS[msg.role] || msg.role}</div>
          )}
          {msg.content}
        </div>
      ))}
    </div>
  )
}
