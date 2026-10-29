/**
 * 浮动面板落点计算（纯函数）—— 标题行「探索者设置」这类**只知道自己按钮位置**的浮层用它。
 *
 * 为什么单独一个模块：工作台里有两类锚定浮层。
 *   · DeskDock 的「设置 / 项目切换」按工作台网格算，见 chrome-position.ts 的 popPlacement()；
 *   · 探索者设置挂在标题行（顶置 / 侧置竖轨都可能），它只拿得到按钮与视口的矩形。
 * 后者以前只算 `right` 与 `top = 按钮底 + 6`：底部按钮（侧置竖轨的齿轮）会把面板甩出屏幕，
 * 窄屏上还会横向越界。这两个要求（不出视口、下面放不下就往上翻）与其它浮层一致，所以
 * 把口径抽成这里的一份，谁都能用、也能脱离浏览器单测。
 *
 * 口径：
 *   · 横向：默认**右缘对齐按钮右缘**并夹在视口内；按钮贴着视口左缘（竖轨）时改成从按钮右侧展开；
 *   · 竖向：默认向下 6px；下方装不下且上方更宽裕时翻到按钮上方；
 *   · 高度：maxHeight 取「那一侧真正可用的高度」与调用方给的上限的较小值 ——
 *     面板内部滚动，永远不会被屏幕边缘裁掉。
 */

export interface AnchorRect {
  left: number
  right: number
  top: number
  bottom: number
}
export interface PopViewport {
  width: number
  height: number
}
export interface PopSize {
  /** 量到的面板宽度；0 = 还没量到（首帧） */
  width: number
  /** 面板的**内容**高度（scrollHeight，不受 max-height 限制）；0 = 还没量到 */
  height: number
}
export interface PopAnchorInput {
  anchor: AnchorRect | null
  viewport: PopViewport
  size: PopSize
  /** 与按钮的间距 */
  gap?: number
  /** 与视口边缘的最小留白 */
  margin?: number
  /** 高度上限（对应 CSS 的 64vh 之类） */
  heightCap?: number
  /** 宽度上限（对应 CSS 的 max-width） */
  widthCap?: number
  /** 尺寸未量到时用于判断方向的保守高度 */
  minPreferredHeight?: number
  /** 按钮右缘离视口右缘多近算「贴着右缘」（用于夹位，暂未使用） */
  edgeThreshold?: number
}
export interface PopAnchorResult {
  left: number
  top: number
  maxHeight: number
  placement: 'below' | 'above'
}

export const POP_GAP_PX = 6
export const POP_MARGIN_PX = 8
export const POP_PREFERRED_HEIGHT = 240
/** 按钮贴着视口左缘这么近时，面板改为从按钮右侧展开（侧置竖轨就是这种情况）。 */
export const POP_EDGE_PX = 72

const clamp = (v: number, min: number, max: number): number =>
  Math.min(Math.max(v, min), Math.max(min, max))

export function anchorPopup(input: PopAnchorInput): PopAnchorResult {
  const gap = input.gap ?? POP_GAP_PX
  const margin = input.margin ?? POP_MARGIN_PX
  const vw = input.viewport.width
  const vh = input.viewport.height
  const heightCap = input.heightCap ?? Number.POSITIVE_INFINITY
  const widthCap = input.widthCap ?? Number.POSITIVE_INFINITY
  const edge = input.edgeThreshold ?? POP_EDGE_PX

  // 宽度：量到的优先，否则按上限估；任何情况下都不许比视口还宽
  const widest = Math.max(0, vw - margin * 2)
  const width = Math.min(
    input.size.width > 0 ? input.size.width : Math.min(420, widest),
    widthCap,
    widest,
  )

  // 没给锚点（按钮还没渲染）时贴在左上角，至少不会算出 NaN
  const anchor: AnchorRect = input.anchor ?? {
    left: margin,
    right: margin,
    top: margin,
    bottom: margin,
  }

  const spaceBelow = Math.max(0, vh - anchor.bottom - gap - margin)
  const spaceAbove = Math.max(0, anchor.top - gap - margin)
  // 尺寸未知时按保守高度判断：宁可翻上去，也不把面板塞进屏幕外
  const natural = input.size.height > 0
    ? Math.min(input.size.height, heightCap)
    : Math.min(input.minPreferredHeight ?? POP_PREFERRED_HEIGHT, heightCap)
  const placement: 'below' | 'above' =
    spaceBelow >= natural || spaceBelow >= spaceAbove ? 'below' : 'above'

  const space = placement === 'below' ? spaceBelow : spaceAbove
  const maxHeight = Math.max(0, Math.min(heightCap, space))
  const usedHeight = Math.min(natural, maxHeight)
  const top = placement === 'below'
    ? anchor.bottom + gap
    : Math.max(margin, anchor.top - gap - usedHeight)

  // 按钮贴着视口左缘（竖轨）→ 从按钮右侧展开；否则右缘对齐按钮右缘
  const left = anchor.left < edge
    ? clamp(anchor.right + gap, margin, vw - width - margin)
    : clamp(anchor.right - width, margin, vw - width - margin)

  return { left, top, maxHeight, placement }
}
