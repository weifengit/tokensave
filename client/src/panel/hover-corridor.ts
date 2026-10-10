/**
 * 悬浮面板的「保持」几何（纯函数，可在 node 里单测）。
 *
 * 问题原话：「鼠标还没移动到面板上就消失了」。
 *
 * 原因：面板 portal 到 body，与触发器（侧边栏那一簇圆点/角标）**不是同一棵子树**，
 * 而且两者之间留着一道缝 —— 横向 8px（面板贴侧边栏右缘再 +8）加纵向 6px。
 * 鼠标从触发器挪向面板时必须穿过这道缝，穿过时既不在触发器上、也不在面板上，
 * 于是两边都判定「离开了」→ 220ms 倒计时开始跑；手稍微慢一点（或中途顿一下），
 * 倒计时先到点 —— 面板就在鼠标到达之前收起了。
 *
 * 修法：不用 DOM 元素去搭「桥」（那会被 .ts-warn-pop 的 overflow:hidden 裁掉，
 * 而且透明元素会挡住底下侧边栏的点击），改成**命中测试**：
 * 关闭倒计时期间监听 mousemove，指针只要还在「走廊」里，就把倒计时往后推。
 * 走廊 = 触发器与面板的并集再外扩一圈 —— 命中测试没有遮挡问题，
 * 所以并集里那块用不到的角落也可以放心算进去。
 */

/** 视口坐标的矩形（与 DOMRect 的四个边同义） */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** 关闭倒计时：指针离开后等这么久再收（走廊命中会不断续期） */
export const HOVER_CLOSE_MS = 420
/** 走廊外扩：给手抖和斜向移动留余量 */
export const CORRIDOR_PAD = 28

/** DOMRect → Box（只取需要的四个边） */
export function boxOf(r: { left: number; top: number; right: number; bottom: number }): Box {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

/**
 * 走廊 = 触发器与面板的并集，四周外扩 `pad`。
 * @param trigger - 触发器的视口矩形
 * @param panel - 面板的视口矩形
 */
export function hoverCorridor(trigger: Box, panel: Box, pad = CORRIDOR_PAD): Box {
  return {
    left: Math.min(trigger.left, panel.left) - pad,
    top: Math.min(trigger.top, panel.top) - pad,
    right: Math.max(trigger.right, panel.right) + pad,
    bottom: Math.max(trigger.bottom, panel.bottom) + pad,
  }
}

/** 点是否落在走廊里（含边界） */
export function corridorContains(c: Box, x: number, y: number): boolean {
  return x >= c.left && x <= c.right && y >= c.top && y <= c.bottom
}

/**
 * 指针现在落在哪个区域（关闭倒计时到点时用它决定收不收）。
 *
 *   'panel'    —— 在面板上：**绝不能收**（会从鼠标底下消失）
 *   'trigger'  —— 在触发器上：也不能收（mouseleave 会给准确信号）
 *   'corridor' —— 在两者之间的缝里：正在挪过去，可以续期
 *   'out'      —— 真的离开了：收起
 *
 * 顺序很重要：先认面板、再认触发器，最后才看走廊 ——
 * 走廊是两者的并集外扩，如果不先判两者，指针停在面板上也会被算成“在走廊里”。
 * （那本身不致命，但会让“在面板上”与“在缝里”共用一套续期上限，语义就混了。）
 */
export type PointerZone = 'panel' | 'trigger' | 'corridor' | 'out'

export function zoneOf(
  trigger: Box | null,
  panel: Box | null,
  x: number | null,
  y: number | null,
  pad = CORRIDOR_PAD,
): PointerZone {
  // 指针位置未知：宁可按离开处理，面板不该在鼠标走后赖着不走
  if (!trigger || !panel || x === null || y === null) return 'out'
  if (corridorContains(panel, x, y)) return 'panel'
  if (corridorContains(trigger, x, y)) return 'trigger'
  return corridorContains(hoverCorridor(trigger, panel, pad), x, y) ? 'corridor' : 'out'
}
