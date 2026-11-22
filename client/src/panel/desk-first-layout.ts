/**
 * 工作台的**首次进入布局**（纯逻辑：不依赖 React / DOM，可单独单测）。
 *
 * 用户提供了两张截图，要求按「有没有项目预览」分两种布局：
 *
 *   ① 有预览（devUrl 探测到在跑）
 *        面板区   = 项目预览（独占一大块）
 *        辅助侧栏 = DSH 主对话 + 共享黑板 + 协作对话 + 协作收益（四个竖向并列）
 *
 *   ② 无预览
 *        面板区   = DSH 主对话
 *        辅助侧栏 = 共享黑板 + 协作对话 + 协作收益
 *
 * 为什么要把这张表抽出来单独放：
 *   「哪个窗口默认落在哪个区」是**用户可见的布局契约**，而它以前散在
 *   DeskDock 的 buildDefault / reconcile / ensureById 三处各算一遍（改一处漏两处
 *   的历史事故已经发生过）。集中到这里以后，三处都只调 `layoutFor(hasPreview)`，
 *   自检脚本也能直接对着纯函数断言，不用去正则匹配 TSX。
 *
 * 归属区只决定**首次落点**，不锁定位置：用户随时可以把窗口拖到任意区。
 */

/** 三个区域（与 DeskDock 的 REGIONS 同一口径）。 */
export type Region = 'left' | 'center' | 'right'

/** 固定的面板 kind（探索者不在表里，它恒定落面板区）。 */
export type Kind = 'preview' | 'chat' | 'board' | 'talk' | 'save'

export interface DeskLayout {
  /** kind → 默认归属区 */
  region: Record<Kind, Region>
  /**
   * 辅助侧栏内的竖向次序：kind → 它应该排在谁的下面。
   * `undefined` = 该区第一个（没有上方参照）。
   */
  stack: Partial<Record<Kind, Kind | undefined>>
}

/** 无预览：主对话占面板区，其余三个在辅助侧栏。 */
const LAYOUT_NO_PREVIEW: DeskLayout = {
  region: { preview: 'center', chat: 'center', board: 'right', talk: 'right', save: 'right' },
  stack: { board: undefined, talk: 'board', save: 'talk' },
}

/** 有预览：预览独占面板区，四个窗口全在辅助侧栏（主对话在最上）。 */
const LAYOUT_WITH_PREVIEW: DeskLayout = {
  region: { preview: 'center', chat: 'right', board: 'right', talk: 'right', save: 'right' },
  stack: { chat: undefined, board: 'chat', talk: 'board', save: 'talk' },
}

/** 按「有没有项目预览」取布局。 */
export function layoutFor(hasPreview: boolean): DeskLayout {
  return hasPreview ? LAYOUT_WITH_PREVIEW : LAYOUT_NO_PREVIEW
}

/** 某个 kind 的默认归属区。 */
export function regionOfKind(kind: string, hasPreview: boolean): Region {
  return layoutFor(hasPreview).region[kind as Kind] ?? 'center'
}

/** 某个 kind 在辅助侧栏里的上方参照（undefined = 排第一）。 */
export function stackAnchorOf(kind: string, hasPreview: boolean): Kind | undefined {
  return layoutFor(hasPreview).stack[kind as Kind]
}
