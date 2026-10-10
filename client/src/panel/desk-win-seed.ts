/**
 * 探索者窗口「关闭态补登」的纯逻辑（HDesk 与自检脚本共用，无 React 依赖）。
 *
 * 背景（HDesk 为什么需要它）：布局快照里记了「进入工作台时哪些探索者窗口是关的」，
 * 而探索者列表是 8s 轮询来的、首帧还在路上。列表到达后要**只关不放**地补登一次——
 * 「快照说关就关、没说就不动」，这样：
 *   ① 已固化「关掉」的探索者不会因为列表晚到就先闪出来；
 *   ② 快照里没有的新探索者默认呈现，探索者一跑起来该出现还是会出现。
 *
 * 关键约束（2026-10-10 报障修复）：**每个探索者最多补登一次**。
 * seed 是进入工作台那一刻冻结的快照（之后不再更新），而 explorers 每次轮询都是
 * 一个新数组（8s 一次）。若每轮都拿这份过期快照重放，用户手动放出的窗口会在下一个
 * 轮询周期被重新关掉 —— 实测表现：「一键切换」放出全部窗口后，隔几秒探索者集体
 * 自行关闭、左右两竖塌缩，看着就像屏幕自己刷了一下；而且这次关闭还会被写回布局
 * 快照，把「关掉」粘住（再点开，几秒后又关）。按 id 记账后，之后一律以用户当场的
 * 三键 / 一键切换选择为准。
 */

/** 快照里一条探索者窗口状态（只需关心 hidden；collapsed 不参与补登）。 */
export interface SeedWinState {
  hidden?: boolean
}

/** 本函数需要的最小快照形状（DeskLayout 结构上兼容）。 */
export interface SeedWinSnapshot {
  winState: Record<string, SeedWinState | undefined>
}

/**
 * 依据「进入时的快照」算出本次需要关闭的探索者 id。
 *
 * 就地记账：凡本次见过的 id（无论快照说关还是说开）都会写进 `applied`，
 * 因此同一个探索者永远不会被补登第二次 —— 这是「用户放出后不被 8s 轮询关回」的保证。
 *
 * @param seed - 进入工作台时的 winState 快照；null（未锁定 / 从未固化）表示不补登
 * @param explorerIds - 本次轮询到的探索者会话 id（按列表顺序）
 * @param applied - 已补登过的 id 集合（调用方持久的 ref，跨渲染复用）
 * @returns 本次需要关闭的探索者 id；空数组 = 什么都不做
 */
export function takeFirstSeenClosures(
  seed: SeedWinSnapshot | null,
  explorerIds: readonly string[],
  applied: Set<string>,
): string[] {
  if (!seed) return []
  const toClose: string[] = []
  for (const id of explorerIds) {
    if (!id || applied.has(id)) continue
    applied.add(id)
    if (seed.winState[id]?.hidden) toClose.push(id)
  }
  return toClose
}
