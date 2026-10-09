/**
 * 工作台窗口状态的共享类型。
 *
 * 单独成文件是为了避免循环依赖：HDesk（渲染）与 desk-layout（持久化）都要用这两个
 * 形状，而 desk-layout 不该反过来 import HDesk。
 */

/** 探索者窗口的状态（最小化 / 关闭；探索者的「铺满」走独立浮层，不在这里）。 */
export interface WinState {
  collapsed: boolean
  hidden: boolean
}

/** 非探索者卡片的状态（最小化 / 关闭 / 铺满整个工作台的浮层）。 */
export interface CardState {
  collapsed: boolean
  hidden: boolean
  /** 铺满整个工作台的浮层 */
  maximized: boolean
}
