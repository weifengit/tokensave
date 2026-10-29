/**
 * 标题栏位置（顶部 / 左侧 / 右侧）—— 工作台外壳的一件外观偏好。
 *
 * 参考 info_report 的 chrome-position.js：这个功能只做一件事 —— 把工作台网格换成
 * 另一套行列定义（顶部整整一行 ↔ 左侧/右侧一条窄竖轨），并用一份偏好记住选择。
 * 它**不碰** dockview 布局快照（那是 desk-dock.v2 的事），两者互不干扰。
 *
 * 与 info_report 的一处有意不同：那边把位置写到 `<html data-chrome>`（页面级脚本、在
 * 首帧前同步执行，避免先画顶部再跳窄轨）。这里的工作台只是插件里的一块，写到 <html>
 * 会波及宿主页面，所以位置由 React 状态渲染成 `.ts-dock[data-chrome]`；首帧闪烁无从谈起
 * （工作台本来就是组件挂载后才画）。窄屏（≤900px）两侧栏是覆盖式抽屉、竖轨无从放置，
 * 一律按顶部渲染，见 effectiveChrome()。
 *
 * 存储：`tokensave:desk-chrome.v1`（与 desk-skin.v1 / desk-font.v1 同一套命名）。
 */

export const CHROME_POSITIONS = ['top', 'left', 'right'] as const
export type ChromePosition = (typeof CHROME_POSITIONS)[number]

export const CHROME_KEY = 'tokensave:desk-chrome.v1'

/**
 * 侧置竖轨的宽度。
 *
 * 为什么必须窄：用户把标题行挪到侧边的目的就是多看几行内容（顶部一整行的高度还回来），
 * 轨一宽，省下来的横向空间又被吃掉。44px 是「图标 28 + 两侧留白」的最小整数宽。
 * CSS 里的 `--ts-rail-w` 由这个常量插值写入，浮层定位也读它 —— 只有一处真值。
 */
export const RAIL_W = 44

/** 浮层与竖轨/工作台边缘之间的留白（顶置时是「面板挂在按钮下方」那 6px 的同族）。 */
export const POP_GAP = 8

export const CHROME_LABEL: Record<ChromePosition, string> = {
  top: '顶部',
  left: '左侧',
  right: '右侧',
}

export const CHROME_HINT: Record<ChromePosition, string> = {
  top: '标题行横在顶部（默认）',
  left: '收成左侧窄轨：顶部那一整行的高度全部还给内容',
  right: '收成右侧窄轨：与左侧相同，只是靠右',
}

/** 任何来源的位置值都先过一遍这里：未知值（旧版本 / 手改存储）一律回顶部。 */
export function normalizeChrome(value: unknown): ChromePosition {
  const v = String(value)
  return (CHROME_POSITIONS as readonly string[]).includes(v) ? (v as ChromePosition) : 'top'
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/**
 * 读偏好。存储不可用（隐私模式 / 无 DOM / 被宿主禁用）时回顶部，不抛。
 * storage 显式传入是为了自检脚本能喂一个假存储（纯函数，无需浏览器）。
 */
export function readChromePosition(storage?: StorageLike | null): ChromePosition {
  try {
    const s = storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
    return normalizeChrome(s?.getItem(CHROME_KEY))
  } catch {
    return 'top'
  }
}

/** 写偏好。写不进去就只让本次会话生效，下次回顶部（不打断用户操作）。 */
export function writeChromePosition(
  position: ChromePosition,
  storage?: StorageLike | null,
): ChromePosition {
  const next = normalizeChrome(position)
  try {
    const s = storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
    s?.setItem(CHROME_KEY, next)
  } catch {
    /* 忽略：上面注释说的退化 */
  }
  return next
}

/** 窄屏两侧栏是覆盖式抽屉，竖轨放不下 → 一律按顶部渲染（偏好本身保留）。 */
export function effectiveChrome(position: ChromePosition, narrow: boolean): ChromePosition {
  return narrow ? 'top' : normalizeChrome(position)
}

/** 视口 / 元素的矩形（只取这几项，方便纯函数测试）。 */
export interface PopRect {
  left: number
  right: number
  top: number
  bottom: number
}
export interface PopViewport {
  width: number
  height: number
}

/**
 * 浮层落点：顶置给 top（挂在按钮下方），侧置给 bottom（向上长）。
 *
 * 为什么侧置不能再用 top：齿轮按钮在竖轨**最底部**，`top = 按钮底 + 6` 会把整块面板
 * 甩到屏幕外（info_report 踩过同一个坑，它改成 `bottom: 6px` 底对齐齿轮）。
 * 这里按按钮在轨里的上下半区自动选方向：靠上的按钮（项目切换）向下长、靠下的（设置）
 * 向上长 —— 两块浮层共用一套规则。
 */
export interface PopPlacement {
  left: number
  top?: number
  bottom?: number
}

export function popPlacement(input: {
  chrome: ChromePosition
  anchor: PopRect | null
  dock: PopRect | null
  viewport: PopViewport
  width: number
}): PopPlacement {
  const { anchor, dock, viewport, width } = input
  const position = normalizeChrome(input.chrome)

  if (position === 'top') {
    // 与旧版同口径：右对齐按钮、挂在按钮下方 6px，左右都夹在工作台内
    // （左侧按钮原来会算出负值 → 被夹到页面左边，像弹到宿主侧边栏上去了）。
    const minLeft = (dock ? dock.left : 0) + POP_GAP
    const maxLeft = Math.min(
      viewport.width - width - POP_GAP,
      (dock ? dock.right : viewport.width) - width - POP_GAP,
    )
    const left = anchor
      ? Math.max(minLeft, Math.min(anchor.right - width, Math.max(minLeft, maxLeft)))
      : minLeft
    return { left, top: anchor ? anchor.bottom + 6 : 48 }
  }

  // 侧置：竖轨贴着工作台的左/右边缘，面板从轨的**内侧**漂出来
  const dockLeft = dock ? dock.left : 0
  const dockRight = dock ? dock.right : viewport.width
  const left =
    position === 'left'
      ? dockLeft + RAIL_W + POP_GAP
      : Math.max(POP_GAP, dockRight - RAIL_W - POP_GAP - width)

  if (!anchor) return { left, top: 48 }
  const railMid = dock ? (dock.top + dock.bottom) / 2 : viewport.height / 2
  if ((anchor.top + anchor.bottom) / 2 <= railMid) {
    return { left, top: Math.max(POP_GAP, anchor.top) }
  }
  return { left, bottom: Math.max(POP_GAP, viewport.height - anchor.bottom) }
}
