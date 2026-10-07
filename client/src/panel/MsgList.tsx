/**
 * 会话消息流列表（探索者窗口与主对话共用）
 *
 * 呈现原则（对齐 DSH 默认对话，不把一切都摊在界面上）：
 *   - user / assistant：真实对话内容，直接渲染（自动滚底）
 *   - tool / system：**默认折叠成一行**（截断），点击才展开全文
 *     —— 工具调用与输出多为英文长文，全量平铺会把卡片撑爆
 *   - 只渲染最近 MAX_RENDER 条，更早的折成「更早 N 条」提示（避免 DOM 爆炸）
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { StreamMsg } from '../session-subscribe'

const ROLE_LABELS: Record<string, string> = {
  user: '我',
  assistant: '模型',
  tool: '工具',
  system: '系统',
}

/** 最多渲染的消息条数（超出只显示最近这些，并给出折叠提示） */
const MAX_RENDER = 120

/** 折叠行的单行预览长度 */
const PREVIEW = 120

function firstLine(text: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length > PREVIEW ? t.slice(0, PREVIEW) + '…' : t
}

function ToolRow({ msg }: { msg: StreamMsg }) {
  const [open, setOpen] = useState(false)
  const preview = firstLine(msg.content)
  return (
    <div className={`ts-msg-${msg.role === 'tool' ? 'tool' : 'system'}`}>
      <div className="ts-msg-role">
        {ROLE_LABELS[msg.role] || msg.role}
        <button
          className="ts-icon-btn ts-msg-toggle"
          onClick={() => setOpen((v) => !v)}
          title={open ? '折叠' : '展开全文'}
        >{open ? '▴' : '▾'}</button>
      </div>
      {open ? (
        <div className="ts-msg-full">{msg.content}</div>
      ) : (
        <div className="ts-msg-preview">{preview}</div>
      )}
    </div>
  )
}

export function MsgList({ messages, emptyText }: { messages: StreamMsg[]; emptyText?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  const shown = useMemo(
    () => (messages.length > MAX_RENDER ? messages.slice(-MAX_RENDER) : messages),
    [messages],
  )
  const hidden = messages.length - shown.length
  const lastLen = shown.length > 0 ? shown[shown.length - 1].content.length : 0

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [shown.length, lastLen])

  return (
    <div className="ts-chat-msgs" ref={ref}>
      {messages.length === 0 && (
        <div className="ts-hint">{emptyText ?? '等待会话消息…'}</div>
      )}
      {hidden > 0 && (
        <div className="ts-hint">更早的 {hidden} 条已折叠（仅显示最近 {MAX_RENDER} 条）</div>
      )}
      {shown.map((msg, i) => {
        if (msg.role === 'tool' || msg.role === 'system') {
          return <ToolRow key={i} msg={msg} />
        }
        return (
          <div key={i} className={msg.role === 'user' ? 'ts-msg-user' : 'ts-msg-assistant'}>
            {msg.content}
          </div>
        )
      })}
    </div>
  )
}
