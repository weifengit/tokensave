/**
 * 悬浮预览的**视口内摆位**（纯函数，无 DOM 副作用，便于自检）。
 *
 * 为什么单独成模块：这段几何最容易被写错也最难在浏览器里肉眼验证——
 * 「掉到屏幕底部之外」「贴边被裁」「在鼠标下抖动」都出在这里。抽成纯函数后
 * 可以用一组边界输入把它钉死，而不是靠反复打开面板看。
 *
 * 坐标系：全部是**视口坐标**（与 getBoundingClientRect 同一套）。
 * 前提：调用方把卡片 portal 到 body 并 position:fixed —— 若挂在有 transform /
 * filter / contain 的祖先里，fixed 会相对那个祖先解析，算出来的 left/top 就全错了。
 */
import { PREVIEW_GAP, PREVIEW_MARGIN, PREVIEW_MAX_H, PREVIEW_MAX_W } from './changes-preview-const'

export interface Rect { left: number, top: number, width: number, height: number }
export interface Viewport { width: number, height: number }
export interface Placement {
  left: number
  top: number
  /** 实际可用宽度（已按视口收窄） */
  width: number
  /** 实际可用高度（已按剩余空间收窄，卡片内部自己滚） */
  maxHeight: number
  /** 落在锚点下方还是上方（决定阴影/圆角朝向，也便于自检断言） */
  side: 'below' | 'above'
}

/**
 * 把预览卡摆进视口。
 *
 * 规则（依次）：
 *   1. 横向与锚点左缘对齐，再夹进 [margin, vw - width - margin]；
 *   2. 纵向优先放锚点下方；下方装不下就翻到上方；
 *   3. 上下都装不下（锚点在视口中部、窗口很矮）则选**空间更大的一侧**，
 *      并把高度收成那侧的实际剩余 —— 宁可卡片矮一点内部滚动，也不许出屏；
 *   4. 宽度同理收窄，永不超出视口。
 */
export function placePreview(anchor: Rect, viewport: Viewport, desired?: { width?: number, height?: number }): Placement {
  const wantW = desired?.width ?? PREVIEW_MAX_W
  const wantH = desired?.height ?? PREVIEW_MAX_H
  // 视口本身比理想宽度还窄（窄屏/手机）时，宽度先跟着视口收
  const width = Math.max(120, Math.min(wantW, viewport.width - PREVIEW_MARGIN * 2))
  const topSpace = anchor.top - PREVIEW_GAP - PREVIEW_MARGIN
  const bottomSpace = viewport.height - (anchor.top + anchor.height) - PREVIEW_GAP - PREVIEW_MARGIN

  let side: 'below' | 'above'
  let maxHeight: number
  if (bottomSpace >= wantH) {
    side = 'below'
    maxHeight = wantH
  } else if (topSpace >= wantH) {
    side = 'above'
    maxHeight = wantH
  } else if (bottomSpace >= topSpace) {
    // 两侧都不够：选更宽裕的一侧，并把高度收成那侧的剩余空间
    side = 'below'
    maxHeight = Math.max(0, bottomSpace)
  } else {
    side = 'above'
    maxHeight = Math.max(0, topSpace)
  }

  const left = Math.min(
    Math.max(PREVIEW_MARGIN, anchor.left),
    Math.max(PREVIEW_MARGIN, viewport.width - width - PREVIEW_MARGIN),
  )
  const top = side === 'below'
    ? anchor.top + anchor.height + PREVIEW_GAP
    : anchor.top - maxHeight - PREVIEW_GAP

  // 最后一道保险：即便上面的分支判断都不利，top 也不许落到视口外
  const clampedTop = Math.min(
    Math.max(PREVIEW_MARGIN, top),
    Math.max(PREVIEW_MARGIN, viewport.height - maxHeight - PREVIEW_MARGIN),
  )

  return { left, top: clampedTop, width, maxHeight, side }
}
