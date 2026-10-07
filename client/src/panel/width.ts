/**
 * H 台宽度偏好（按项目独立持久化）
 *
 * 与宿主的全局宽度把手解耦：宿主把 `--dsh-chat-user-width` 写在会话容器的
 * 共享父元素上，值是**全局**的，且其 `resolveContentWidth` 会保留
 * `CONTENT_EDGE_BUDGET = 176px` 给两侧把手 —— 所以永远铺不满，且一处拖动
 * 处处生效。工作台要的是「各自项目各自宽度、可以顶到屏幕两边」，因此这里
 * 自持一份按项目 id 索引的偏好，不再读宿主变量。
 *
 * 值语义：
 *   0        → 铺满（100%，左右不留白）—— 默认
 *   >0 的像素 → 居中固定宽度（拖拽结果，两端对称伸缩）
 */
const KEY = 'tokensave:hdesk-width.v1'

/** 居中收窄时的最小宽度（低于此值三列网格会挤坏） */
export const DESK_MIN = 640

/** 铺满哨兵值 */
export const DESK_FULL = 0

type WidthMap = Record<string, number>

function readMap(): WidthMap {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as WidthMap) : {}
  } catch {
    return {}
  }
}

/** 读某个项目的宽度偏好；无记录或损坏时回落「铺满」。 */
export function loadDeskWidth(projectId: string): number {
  const v = Number(readMap()[projectId])
  return Number.isFinite(v) && v >= 0 ? v : DESK_FULL
}

/** 写某个项目的宽度偏好（隐私模式等不可写时静默忽略，仅本次会话有效）。 */
export function saveDeskWidth(projectId: string, px: number): void {
  try {
    const map = readMap()
    map[projectId] = Math.max(0, Math.round(px))
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* 忽略：宽度仅本次会话有效 */
  }
}

/** 偏好 → CSS 宽度；铺满时用 100%，收窄时用 min(100%, Npx) 防止超出容器。 */
export function deskCssWidth(pref: number): string {
  return pref > 0 ? `min(100%, ${Math.round(pref)}px)` : '100%'
}