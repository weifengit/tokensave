/**
 * 会话图片：用户附件 / 工具结果 / 模型回复共用一套缩略图与灯箱。
 *
 * 为什么独立成模块：图片会出现在三个位置（用户气泡、回答正文、折叠「过程」之外），
 * 三处如果各写一套，加载 / 失败重试 / 点击查看原图的口径很快就会分叉。
 *
 * 图片字节不在这里读：`resolveSessionImageUrl` 走宿主 uiConversation 的授权缓存，
 * 本组件只负责把 URL 显示出来、并在点击时铺一层文档级灯箱。
 *
 * 灯箱的翻页范围是**整段对话**（调用方按显示顺序把 gallery 传进来）：一处对话里
 * 多张图时，← / → 与两侧按钮都能上一张 / 下一张；没传 gallery 就只在当前这组图里翻。
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
  /**
   * 整段对话里按显示顺序排好的图片（包含本条的 images）。
   * 灯箱据此支持上一张 / 下一张；不传 = 只在当前这组图里翻。
   */
  gallery?: readonly StreamImageAttachment[]
}

interface LightboxState {
  /** 翻页范围（通常 = 整段对话的图片） */
  images: readonly StreamImageAttachment[]
  /** 打开的那张在这个范围里的下标 */
  index: number
  /** 点击的缩略图已经解析出的 URL：先亮出来，不等二次读取 */
  initialUrl: string
}

/** 单图显示框：与宿主「对话」同口径（长边 240 / 比例钳在 [0.25, 4] / 不放大）。 */
function singleFit(image: StreamImageAttachment): {
  width: number
  height: number
  objectPosition: string
} {
  const natural = image.width / image.height
  const ratio = Math.min(4, Math.max(0.25, natural))
  const box = ratio >= 1
    ? { width: 240, height: 240 / ratio }
    : { width: 240 * ratio, height: 240 }
  const scale = Math.min(1, image.width / box.width, image.height / box.height)
  return {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
    // 极端比例会被 object-fit: cover 裁掉一侧：很高的图保留顶部，很宽的图保留左侧
    objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
  }
}

/** 单张图：加载、失败重试、点击打开原图。 */
function ImageTile({ sessionId, image, compact, onOpen }: {
  sessionId: string
  image: StreamImageAttachment
  compact: boolean
  onOpen: (url: string) => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  /** 失败后点一下重试：+1 触发 effect 重跑 */
  const [attempt, setAttempt] = useState(0)
  const label = image.name || '图片'
  const fit = compact ? null : singleFit(image)
  // 外框尺寸由图片自身决定：单图用 fit 的宽高，窄容器下靠 max-width:100% 收缩、
  // aspect-ratio 同步缩高，不会出现「框比图大」或「一张图铺满整行」。
  const frameStyle: React.CSSProperties | undefined = fit
    ? { width: `${fit.width}px`, aspectRatio: `${fit.width} / ${fit.height}` }
    : undefined

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

  const retry = () => setAttempt((n) => n + 1)
  const frameClass = `ts-msg-image${compact ? ' is-tile' : ' is-single'}${failed ? ' is-failed' : ''}`
  if (failed) {
    return (
      <button
        type="button"
        className={frameClass}
        style={frameStyle}
        title={`${label} 加载失败，点击重试`}
        aria-label={`${label} 加载失败，点击重试`}
        onClick={retry}
      >
        <span className="ts-msg-image-retry" aria-hidden="true">重试</span>
      </button>
    )
  }
  return (
    <button
      type="button"
      className={frameClass}
      style={frameStyle}
      title={url ? `${label}（点击查看原图）` : `${label} 载入中`}
      aria-label={url ? `查看图片：${label}` : `${label} 载入中`}
      aria-busy={url && !loaded ? true : undefined}
      onClick={() => { if (url) onOpen(url) }}
    >
      {url && (
        <img
          src={url}
          alt={label}
          loading="eager"
          decoding="async"
          style={fit ? { objectPosition: fit.objectPosition } : undefined}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      {!loaded && <span className="ts-msg-image-wait" aria-hidden="true">载入中…</span>}
    </button>
  )
}

/** 一张图的 URL 缓存键：同一附件在多条消息里复用同一个 URL。 */
function urlKeyOf(image: StreamImageAttachment): string {
  return image.attachmentId
}

/**
 * 文档级灯箱：Esc 关闭、← / → 翻页、两侧按钮翻页（手机没有键盘也能用），
 * 打开时把焦点放在关闭按钮上。
 */
function Lightbox({ state, sessionId, onClose }: {
  state: LightboxState
  sessionId: string
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [index, setIndex] = useState(state.index)
  const [urls, setUrls] = useState<Record<string, string>>(() => {
    const first = state.images[state.index]
    return first && state.initialUrl ? { [urlKeyOf(first)]: state.initialUrl } : {}
  })
  const [failed, setFailed] = useState(false)
  const total = state.images.length
  const current = state.images[index]
  const currentKey = current ? urlKeyOf(current) : ''

  const step = (delta: number) => {
    if (total < 2) return
    setIndex((i) => (i + delta + total) % total)
    setFailed(false)
  }

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        step(-1)
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        step(1)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // 切到还没解析过的图：按宿主的授权缓存现取；邻居顺带预热，手机上连点也不卡。
  useEffect(() => {
    if (!current) return
    let live = true
    const need = !urls[currentKey]
    if (need) {
      setFailed(false)
      resolveSessionImageUrl(sessionId, current).then(
        (next) => {
          if (!live || !next) return
          setUrls((m) => (m[currentKey] ? m : { ...m, [currentKey]: next }))
        },
        () => { if (live) setFailed(true) },
      )
    }
    for (const delta of [1, -1]) {
      if (total < 2) break
      const neighbor = state.images[(index + delta + total) % total]
      if (!neighbor) continue
      const key = urlKeyOf(neighbor)
      if (urls[key]) continue
      void resolveSessionImageUrl(sessionId, neighbor).then(
        (next) => {
          if (!live || !next) return
          setUrls((m) => (m[key] ? m : { ...m, [key]: next }))
        },
        () => undefined,
      )
    }
    return () => { live = false }
  }, [sessionId, index, total, state.images, current, currentKey, urls])

  const label = current?.name || '图片'
  const url = current ? urls[currentKey] : undefined
  return (
    <div
      className="ts-img-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={label}
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
      {total > 1 && (
        <>
          <button
            type="button"
            className="ts-img-lightbox-nav is-prev"
            title="上一张（←）"
            aria-label="上一张"
            onClick={(e) => { e.stopPropagation(); step(-1) }}
          >‹</button>
          <button
            type="button"
            className="ts-img-lightbox-nav is-next"
            title="下一张（→）"
            aria-label="下一张"
            onClick={(e) => { e.stopPropagation(); step(1) }}
          >›</button>
          <div className="ts-img-lightbox-count" aria-live="polite">
            {index + 1} / {total}
          </div>
        </>
      )}
      {url
        ? <img src={url} alt={label} onClick={(e) => e.stopPropagation()} />
        : failed
          ? <div className="ts-img-lightbox-tip" onClick={(e) => e.stopPropagation()}>这张图读取失败，可先关闭再点缩略图重试</div>
          : <div className="ts-img-lightbox-tip" onClick={(e) => e.stopPropagation()}>载入中…</div>}
    </div>
  )
}

/**
 * 消息图片组：单图按长边 240px、多图收成 64px 方块（与宿主对话一致）。
 * 单图的外框就是图片的显示框，不额外撑满容器；没有 sessionId 时不渲染。
 */
export function MessageImages({ sessionId, images, align = 'start', gallery }: Props) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  if (!sessionId || images.length === 0) return null
  const compact = images.length > 1
  // 灯箱翻页范围：优先用调用方给的整段对话；本组图不在里面（口径不一致）就退回本组
  const found = gallery && gallery.length > 0 ? gallery.indexOf(images[0]) : -1
  const scope = found >= 0 ? gallery! : images
  const base = found >= 0 ? found : 0
  const open = (url: string, index: number) => setLightbox({
    images: scope,
    index: base + index,
    initialUrl: url,
  })
  return (
    <>
      <div className={`ts-msg-images${align === 'end' ? ' is-end' : ''}`}>
        {images.map((image, index) => (
          <ImageTile
            key={`${image.attachmentId}:${index}`}
            sessionId={sessionId}
            image={image}
            compact={compact}
            onOpen={(url) => open(url, index)}
          />
        ))}
      </div>
      {lightbox && createPortal(
        <Lightbox state={lightbox} sessionId={sessionId} onClose={() => setLightbox(null)} />,
        document.body,
      )}
    </>
  )
}