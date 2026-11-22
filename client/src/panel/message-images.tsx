/**
 * 会话图片：用户附件 / 工具结果 / 模型回复共用一套缩略图与灯箱。
 *
 * 为什么独立成模块：图片会出现在三个位置（用户气泡、回答正文、折叠「过程」之外），
 * 三处如果各写一套，加载 / 失败重试 / 点击查看原图的口径很快就会分叉。
 *
 * 图片字节不在这里读：`resolveSessionImageUrl` 走宿主 uiConversation 的授权缓存，
 * 本组件只负责把 URL 显示出来、并在点击时铺一层文档级灯箱。
 */
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveSessionImageUrl } from '../session-subscribe'
import type { StreamImageAttachment } from '../session-subscribe'

interface Props {
  /** 会话 id：宿主按它校验图片读取权限 */
  sessionId: string
  images: readonly StreamImageAttachment[]
  /** 用户消息靠右，其余靠左（与气泡同侧） */
  align?: 'start' | 'end'
}

interface LightboxState {
  url: string
  name?: string
}

/** 单张图：加载、失败重试、点击打开原图。 */
function ImageTile({ sessionId, image, compact, onOpen }: {
  sessionId: string
  image: StreamImageAttachment
  compact: boolean
  onOpen: (state: LightboxState) => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  /** 失败后点一下重试：+1 触发 effect 重跑 */
  const [attempt, setAttempt] = useState(0)
  const label = image.name || '图片'

  useEffect(() => {
    let live = true
    setUrl(null)
    setFailed(false)
    setLoaded(false)
    resolveSessionImageUrl(sessionId, image).then(
      (next) => { if (live && next) setUrl(next) },
      () => { if (live) setFailed(true) },
    )
    return () => { live = false }
  }, [sessionId, image.attachmentId, attempt])

  if (failed) {
    return (
      <button
        type="button"
        className={`ts-msg-image is-failed${compact ? ' is-tile' : ''}`}
        title={`${label} 加载失败，点击重试`}
        aria-label={`${label} 加载失败，点击重试`}
        onClick={() => setAttempt((n) => n + 1)}
      >⚠</button>
    )
  }
  if (!url) {
    return (
      <span
        className={`ts-msg-image is-loading${compact ? ' is-tile' : ''}`}
        aria-label={`${label} 载入中`}
        title={`${label} 载入中`}
      />
    )
  }
  return (
    <button
      type="button"
      className={`ts-msg-image${compact ? ' is-tile' : ''}${loaded ? '' : ' is-loading'}`}
      title={`${label}（点击查看原图）`}
      aria-label={`查看图片：${label}`}
      onClick={() => onOpen({ url, name: image.name })}
    >
      <img src={url} alt={label} loading="eager" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
    </button>
  )
}

/** 文档级灯箱：Esc / 点遮罩 / 关闭按钮都能关，打开时把焦点放在关闭按钮上。 */
function Lightbox({ state, onClose }: { state: LightboxState; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="ts-img-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={state.name || '查看图片'}
      onClick={onClose}
    >
      <button
        ref={closeRef}
        type="button"
        className="ts-img-lightbox-close"
        title="关闭（Esc）"
        aria-label="关闭图片预览"
        onClick={onClose}
      >✕</button>
      <img src={state.url} alt={state.name || '图片'} onClick={(e) => e.stopPropagation()} />
    </div>
  )
}

/**
 * 消息图片组：单图按长边 240px 展示，多图收成 64px 方块（与宿主对话一致）。
 * 没有 sessionId（探索者窗口未接入会话）时不渲染，避免每张图都报读取失败。
 */
export function MessageImages({ sessionId, images, align = 'start' }: Props) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  if (!sessionId || images.length === 0) return null
  const compact = images.length > 1
  return (
    <>
      <div className={`ts-msg-images${align === 'end' ? ' is-end' : ''}`}>
        {images.map((image, index) => (
          <ImageTile
            key={`${image.attachmentId}:${index}`}
            sessionId={sessionId}
            image={image}
            compact={compact}
            onOpen={setLightbox}
          />
        ))}
      </div>
      {lightbox && createPortal(
        <Lightbox state={lightbox} onClose={() => setLightbox(null)} />,
        document.body,
      )}
    </>
  )
}
