/**
 * 排队消息气泡：混合图片 + 文字时也能改文字。
 *
 * 为什么单独成模块：编辑排队项要走宿主队列接口（updateQueue / readAttachment /
 * prompt），而 MsgList 是纯呈现层的大文件；把「能否编辑 + 怎么保存」收在这里，
 * 消息流只负责摆位置。
 *
 * 宿主限制（0.2.0-rc.2）：`updateQueue(edit)` 只接受**纯文本**，所以：
 *   - 文本-only → 原地改，位置不变；
 *   - 带图片 → 直接 edit 会丢图；改为「读回图片 → 移除旧项 → 图片+新文字重新排队」，
 *     代价是排到队尾，保存前在提示里说明；
 *   - 带文件附件 → 客户端拿不到可重放的文件凭据，禁用编辑而不是悄悄丢文件。
 */
import React, { useState } from 'react'
import { editQueuedMessage } from '../session-subscribe'
import type { StreamImageAttachment, StreamMsg } from '../session-subscribe'
import { MessageImages } from './message-images'

interface Props {
  sessionId: string
  message: StreamMsg
  /** 整段对话的图片顺序（灯箱翻页用） */
  gallery: readonly StreamImageAttachment[]
}

export function QueuedMessage({ sessionId, message, gallery }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mixed = (message.images?.length ?? 0) > 0
  const canEdit = !!message.queueId && !message.hasFiles

  const start = () => {
    setDraft(message.content)
    setError('')
    setEditing(true)
  }

  const save = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    const result = await editQueuedMessage(sessionId, message, draft)
    setBusy(false)
    if (result.ok) {
      setEditing(false)
      return
    }
    setError(result.error || '编辑失败')
  }

  return (
    <>
      {editing ? (
        <div className="ts-msg-user ts-msg-queued is-editing" data-queued-edit="">
          <textarea
            className="ts-queue-edit-box"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="编辑这条排队消息…"
            aria-label="编辑排队消息"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                if (!busy) setEditing(false)
                return
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void save()
              }
            }}
          />
          <div className="ts-queue-edit-actions">
            <span className="ts-queue-edit-hint">
              {mixed ? '图片会保留；保存后这条会移到队尾' : '只改文字，排队位置不变'}
            </span>
            <button type="button" className="ts-btn ts-btn-sm" disabled={busy} onClick={() => setEditing(false)}>
              取消
            </button>
            <button
              type="button"
              className="ts-btn ts-btn-sm ts-btn-primary"
              disabled={busy || draft.trim() === ''}
              onClick={() => { void save() }}
            >
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
          {error && <div className="ts-queue-edit-error" role="alert">{error}</div>}
        </div>
      ) : (
        <div className="ts-msg-user ts-msg-queued">
          {message.content}
          <span
            className="ts-queued-tag"
            title="会话正忙：这条消息在宿主收件箱队列里，下一轮开始时送达模型（与原生对话的队列面板同源）"
          >排队中</span>
          {canEdit && (
            <button
              type="button"
              className="ts-queue-edit"
              data-queued-edit-btn=""
              onClick={start}
              title={mixed
                ? '编辑文字（图片保留；保存后会重新排队到队尾）'
                : '编辑这条排队消息的文字'}
            >编辑</button>
          )}
          {message.hasFiles && (
            <span className="ts-queue-edit is-off" title="含文件附件：重放会丢文件，暂不支持编辑">不可编辑</span>
          )}
        </div>
      )}
      {message.images?.length ? (
        <MessageImages sessionId={sessionId} images={message.images} align="end" gallery={gallery} />
      ) : null}
    </>
  )
}