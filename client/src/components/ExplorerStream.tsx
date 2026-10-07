// 探索者会话流（Step 11）：数据源为 session-subscribe 的 subscribeSession
//（doc 占位名的正式实现，feature-detect 三级降级，连接状态在控制台留痕）。
import React, { useEffect, useState } from 'react'
import { subscribeSession } from '../session-subscribe'
import type { StreamMsg } from '../session-subscribe'
import { INJECT_LABELS } from '../panel/MsgList'

/**
 * 一条上下文注入（宿主自动带入的运行时快照/技能目录，非用户所发）：
 * 折叠成一行，点开才看正文，不冒充用户气泡。
 */
function InjectLine({ msg }: { msg: StreamMsg }) {
  const [open, setOpen] = useState(false)
  const label = INJECT_LABELS[msg.injectKind ?? ''] ?? '上下文注入'
  return (
    <div className="msg msg-inject">
      <button className="inject-toggle" onClick={() => setOpen((v) => !v)} title={open ? '收起' : '展开正文'}>
        <span>{open ? '▾' : '▸'}</span>
        <span>上下文注入 · {label}</span>
      </button>
      {open && <div className="inject-body">{msg.content}</div>}
    </div>
  )
}

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
          msg.injected ? (
            <InjectLine key={i} msg={msg} />
          ) : (
            <div key={i} className={`msg msg-${msg.role}`}>
              {msg.content}
            </div>
          )
        ))}
      </div>
    </div>
  )
}
