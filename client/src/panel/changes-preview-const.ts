/**
 * 悬浮预览的几何常量（摆位算法与卡片样式共用一个来源）。
 *
 * 单独成文件是为了让 changes-preview-position.ts（纯函数）与 changes-card.tsx
 * （UI）读同一组数字——两处各写一份 520/260 迟早会对不上。
 */

/** 理想最大宽高（视口更小时按剩余空间收窄，见 placePreview）。 */
export const PREVIEW_MAX_W = 520
export const PREVIEW_MAX_H = 260
/** 与锚点行的间隙。 */
export const PREVIEW_GAP = 6
/** 距视口边缘的最小留白（同时保证圆角/阴影不被裁）。 */
export const PREVIEW_MARGIN = 8
/** 鼠标离开锚点后延迟关闭：给指针移进预览卡的时间，否则一移到卡上就消失。 */
export const PREVIEW_CLOSE_DELAY_MS = 120
/** 停留在锚点上多久才真正读取 diff（原生 HoverCard 的 openDelayMs）。 */
export const PREVIEW_OPEN_DELAY_MS = 500
