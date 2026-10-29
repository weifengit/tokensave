/**
 * 浮动面板落点计算（纯函数）—— 标题行「探索者设置」这类**只知道自己按钮位置**的浮层用它。
 *
 * 为什么单独一个模块：工作台里有两类锚定浮层。
 *   · DeskDock 的「设置 / 项目切换」按工作台网格算，见 chrome-position.ts 的 popPlacement()；
 *   · 探索者设置挂在标题行（顶置 / 侧置竖轨都可能），它只拿得到按钮、视口，以及可选的
 *     「该依附哪一栏」矩形。
 * 后者以前只算 `right` 与 `top = 按钮底 + 6`：底部按钮（侧置竖轨的齿轮）会把面板甩出屏幕，
 * 380~420px 的面板还会横向压过侧栏、伸进编辑区。这两个要求（不出视口 / 不越出所属侧栏、
 * 下面放不下就往上翻）与其它浮层一致，所以把口径抽成这里的一份，谁都能用、也能脱离浏览器单测。
 *
 * 口径：
 *   · 横向：给了 bounds（所属侧栏）就**整块夹在栏内**、宽度最多占满栏；没给则右缘对齐按钮
 *     右缘并夹在视口内（按钮贴着视口左缘时改成从按钮右侧展开）；
 *   · 竖向：默认向下 6px；下方装不下且上方更宽裕时翻到按钮上方，同样夹在栏/视口内；
 *   · 高度：maxHeight 取「那一侧真正可用的高度」与调用方给的 upper 的较小值 ——
 *     面板内部滚动，永远不会被裁掉。
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
  /**
   * 面板必须待着的范围（比如按钮所在的侧栏）。宽度比 MIN_BOUNDS_WIDTH 还窄（栏被收起 /
   * 只剩把手）时视为「没有可用的栏」，退回按视口夹位 —— 否则面板会被压成一条缝。
   */
  bounds?: AnchorRect | null
  /** 与按钮的间距 */
  gap?: number
  /** 与视口 / 栏边缘的最小留白 */
  margin?: number
  /** 高度上限（对应 CSS 的 64vh 之类） */
  heightCap?: number
  /** 宽度上限（对应 CSS 的 max-width） */
  widthCap?: number
  /** 尺寸未量到时用于判断方向的保守高度 */
  minPreferredHeight?: number
  /** 按钮贴着视口左缘多近算「贴边」（没有 bounds 时决定从哪侧展开） */
  edgeThreshold?: number
}
export interface PopAnchorResult {
  left: number
  top: number
  /** 面板该用的宽度（夹过栏宽）；调用方要把它写进 style，否则 CSS 的 min-width 会顶回去 */
  width: number
  maxHeight: number
  placement: 'below' | 'above'
  /** 是否真的被限制在 bounds 里（调试 / 自检用） */
  withinBounds: boolean
}

export const POP_GAP_PX = 6
export const POP_MARGIN_PX = 8
export const POP_PREFERRED_HEIGHT = 240
/** 按钮贴着视口左缘这么近时，面板改为从按钮右侧展开（侧置竖轨就是这种情况）。 */
export const POP_EDGE_PX = 72
/** 栏宽于这个才当作可用范围（侧栏收起时宽度是 0）：再窄就退回按视口夹位。 */
export const POP_MIN_BOUNDS_WIDTH = 150
/** 面板再挤也不至于更窄（150 的栏，内宽还有 134）。 */
export const POP_MIN_WIDTH = 140

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

  // 没给锚点（按钮还没渲染）时贴在左上角，至少不会算出 NaN
  const anchor: AnchorRect = input.anchor ?? {
    left: margin,
    right: margin,
    top: margin,
    bottom: margin,
  }

  // —— 可用范围：所属侧栏（若够宽）→ 否则视口 ——
  const b = input.bounds
  // 门槛看**整栏宽度**（不是减完留白的）：与调用方同一个常量，避免两边口径差一截
  const boundsWidth = b ? b.right - b.left : 0
  const withinBounds = !!b && boundsWidth >= POP_MIN_BOUNDS_WIDTH
  const spanLeft = withinBounds ? b!.left : 0
  const spanRight = withinBounds ? b!.right : vw
  const spanTop = withinBounds ? b!.top : 0
  const spanBottom = withinBounds ? b!.bottom : vh

  // —— 宽度：不越出这一栏 ——
  const spanWidth = Math.max(0, spanRight - spanLeft - margin * 2)
  const wanted = input.size.width > 0 ? input.size.width : Math.min(420, Math.max(spanWidth, POP_MIN_WIDTH))
  const width = Math.max(
    Math.min(POP_MIN_WIDTH, spanWidth),
    Math.min(wanted, widthCap, spanWidth),
  )

  // —— 竖向：向下优先，放不下才翻上；两侧都夹在可用范围内 ——
  const spaceBelow = Math.max(0, spanBottom - anchor.bottom - gap - margin)
  const spaceAbove = Math.max(0, anchor.top - gap - spanTop - margin)
  const natural = input.size.height > 0
    ? Math.min(input.size.height, heightCap)
    : Math.min(input.minPreferredHeight ?? POP_PREFERRED_HEIGHT, heightCap)
  const placement: 'below' | 'above' =
    spaceBelow >= natural || spaceBelow >= spaceAbove ? 'below' : 'above'

  const space = placement === 'below' ? spaceBelow : spaceAbove
  const maxHeight = Math.max(0, Math.min(heightCap, space))
  const usedHeight = Math.min(natural, maxHeight)
  // 向下展开时也夹在栏内：按钮在标题行（比侧栏顶端还高一点）时，面板不该探进标题行
  const top = placement === 'below'
    ? Math.max(anchor.bottom + gap, withinBounds ? spanTop + margin : 0)
    : Math.max(spanTop + margin, anchor.top - gap - usedHeight)

  // —— 横向：夹在这一栏内 ——
  // 栏内默认右缘对齐按钮右缘；没有可用栏时，贴视口左缘的按钮（竖轨）改为从右侧展开。
  const left = withinBounds || anchor.left >= edge
    ? clamp(anchor.right - width, spanLeft + margin, spanRight - width - margin)
    : clamp(anchor.right + gap, spanLeft + margin, spanRight - width - margin)

  return { left, top, width, maxHeight, placement, withinBounds }
}
