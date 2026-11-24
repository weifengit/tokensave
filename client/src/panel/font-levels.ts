/**
 * 界面字号档位（唯一真相源）。
 *
 * 为什么单独成模块：DeskDock 用它渲染设置、写 `--ts-fs`；panel-width 又要用
 * 「默认档」作为量宽基线（node 自检里没有 DOM，读不到 CSS 变量）。两边各写一份
 * 数字就会漂：改了字号档，呼吸灯面板的最窄宽度却还是旧字号算的，单位「秒」又会被裁。
 *
 * 本次整体上调 1px（用户反馈「对话时间和复制按钮太小，4 个字号都整体增大一些」）：
 *   小 11.5 → 12.5、标准 12.5 → 13.5、大 14 → 15、特大 15.5 → 16.5。
 * 各条 CSS 用 `calc(var(--ts-fs, 13.5px) * 比例)`；默认档的兜底值 12.5px 只在
 * JS 还没把变量写进 :root 的首帧生效，不随档位走。
 */
export const FONT_LEVELS = [
  { id: 's', label: '小', size: 12.5 },
  { id: 'm', label: '标准', size: 13.5 },
  { id: 'l', label: '大', size: 15 },
  { id: 'xl', label: '特大', size: 16.5 },
] as const

export type FontId = (typeof FONT_LEVELS)[number]['id']

/** 默认档（localStorage 读不到 / 首次进入）。 */
export const DEFAULT_FONT_ID: FontId = 'm'

/** 默认档的 px 值：panel-width 在 node（无 DOM）与首帧量宽时用它。 */
export const DEFAULT_FONT_SIZE = 13.5

/** 按档位取 px；脏 id 退回默认档。 */
export function fontSizeOf(id: string | null | undefined): number {
  return FONT_LEVELS.find((f) => f.id === id)?.size ?? DEFAULT_FONT_SIZE
}