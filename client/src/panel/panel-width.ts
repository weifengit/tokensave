/**
 * 跑马灯面板的宽度策略（独立成模块：不依赖 React，可以在 node 里单测）。
 *
 * 需求原话：「宽度可以根据对话的最长进行控制」。
 *
 * 两版踩过的坑，都记在这里免得再犯：
 *   1. 最初 `max(MIN, min(MAX, avail))` —— 窗口一宽 `avail` 恒大于上限，
 *      于是**永远顶到上限**，跟内容毫无关系。
 *   2. 接着把「行内固定装饰」在 `widestRowContent` 里算了一遍，
 *      `clampPanelWidth` 里又加了一遍 → 每行凭空多 150px，很快又顶到上限。
 *      现在**只在一处**加装饰（见 `rowOuterWidth`），clamp 只负责夹紧。
 */

/** 外框里一行的水平开销：.ts-sound-body 12 + .ts-box 边框 1 + .ts-box-row 内距 9，两侧 */
const CARD_ROW_CHROME_W = 2 * (12 + 1 + 9)
/** 一个开关 / 数值输入的宽度、行内间隔 */
const SWITCH_W = 28
const NUM_W = 46
const GAP_W_SMALL = 6
/** 两个「标签+控件」对之间的最小间隔（.ts-cont-gap 的 min-width） */
const PAIR_GAP_W = 8

/** 量文本宽度用的 canvas（懒建；建不出来就退化成字符估算）。
 *  必须声明在 SETTINGS_MIN_W 之前：那个常量在模块初始化时就会调 textWidth。 */
let measureCtx: CanvasRenderingContext2D | null | undefined

/**
 * 「自动继续」两个子行自身的最小宽度（不靠浏览器的默认值，这里算出来）。
 *
 * 这两行是**固定控件**（开关、输入框都不缩），不像清单行可以靠省略号收编 ——
 * 所以面板最窄宽度必须不小于它们，否则输入框会被挤出外框。
 * 面板宽度是跟着清单最长那行走的，清单很短时就会退到这个下限。
 */
export const SETTINGS_MIN_W = Math.max(
  // 第二行：分类 [开关] 截断 [开关] 瞬时 [开关]
  textWidth('分类', 10.5) + GAP_W_SMALL + SWITCH_W
    + GAP_W_SMALL + textWidth('截断', 10.5) + GAP_W_SMALL + SWITCH_W
    + GAP_W_SMALL + textWidth('瞬时', 10.5) + GAP_W_SMALL + SWITCH_W,
  // 第三行：发送上限 [数字] 次 ⋯ 冷却基数 [数字] 秒
  textWidth('发送上限', 10.5) + GAP_W_SMALL + NUM_W + GAP_W_SMALL + textWidth('次', 10)
    + PAIR_GAP_W
    + textWidth('冷却基数', 10.5) + GAP_W_SMALL + NUM_W + GAP_W_SMALL + textWidth('秒', 10),
) + CARD_ROW_CHROME_W

/**
 * 面板最窄：取「设置行必须放得下」的量。
 * 不再写死一个数字 —— 改标签文案 / 控件宽度时它会自己跟着变，
 * 不会出现“改了字面板却还是老宽度、输入框被挤出去”那种事。
 */
export const POP_W_MIN = Math.max(236, Math.ceil(SETTINGS_MIN_W))
/**
 * 面板最宽。比 440 收窄了不少 —— 清单是扫一眼用的，
 * 再宽眼睛就要来回移动，不如让标题走省略号。
 */
export const POP_W_MAX = 360

// —— 行内固定装饰（只在这里加一次）——

/** 行自身的内边距：.ts-warn-item 左右各 8 + .ts-warn-row 右内边距 1 */
const ROW_PAD_W = 17
/** 图标 11 + 图标与文本的间隔 8 */
const ICON_W = 19
/** 条目区与操作区之间的间距（.ts-warn-row 的 gap） */
const ROW_GAP_W = 6
/** 操作区：只放「已读」 */
const ACTIONS_READ_W = 53
/** 操作区：「继续」+ 间隔 + 「已读」 */
const ACTIONS_CONTINUE_W = 41 + 5 + 53

/**
 * 面板自身的内边距（一行宽度里“非内容”的那部分）。
 *
 * 自外向内：
 *   .ts-sec 左右各 0（区域本身不设边距）
 *   .ts-sound-body / .ts-cont-block 左右各 12
 *   .ts-box-list 边框 1 + 内边距 3（清单外面那圈外框）
 *   .ts-warn-pop-list 左右各 5
 * 单边 = 12 + 1 + 3 + 5 = 21 → 两侧共 42。
 * 改了上面任何一层的 padding/border，这里要跟着调；
 * check-panel-ui.mjs 里有一条断言把这个对应关系钉住。
 */
const PANEL_PAD_W = 2 * (12 + 1 + 3 + 5)
/** 胶囊的额外宽度：左右内边距 + 边框 */
const PILL_CHROME_W = 16
/** 两个胶囊之间的间隔 */
const TAGS_GAP_W = 4

/** 面板里一行的宽度输入（只取宽度计算需要的字段） */
export interface WidthRow {
  title: string
  /** 项目名（第二行左侧胶囊） */
  sub?: string
  /** 中断原因短标签（第二行右侧胶囊） */
  shortReason?: string
  /** 该行是否有「继续」按钮（决定操作区宽度） */
  canContinue?: boolean
}

/**
 * 一行所需的**内容**宽度（不含面板内边距）：标题行与标签行取较宽者。
 * 只算文本与胶囊本身，装饰由 `rowOuterWidth` 加。
 */
export function rowContentWidth(r: WidthRow): number {
  const titleW = textWidth(r.title, 12.5)
  const subW = r.sub ? textWidth(r.sub, 10.5) + PILL_CHROME_W : 0
  const reasonW = r.shortReason ? textWidth(r.shortReason, 10) + PILL_CHROME_W : 0
  const tagsW = subW + reasonW + (subW > 0 && reasonW > 0 ? TAGS_GAP_W : 0)
  // 标题与标签各占一行 → 取较宽者
  return Math.max(titleW, tagsW)
}

/** 一行的整体外宽（内容 + 行内装饰 + 面板内边距） */
export function rowOuterWidth(r: WidthRow): number {
  const actions = r.canContinue ? ACTIONS_CONTINUE_W : ACTIONS_READ_W
  return rowContentWidth(r) + ROW_PAD_W + ICON_W + ROW_GAP_W + actions + PANEL_PAD_W
}

/** 清单里最长那一行需要多宽（空清单 → 0） */
export function widestRowWidth(rows: readonly WidthRow[]): number {
  let widest = 0
  for (const r of rows) {
    const w = rowOuterWidth(r)
    if (w > widest) widest = w
  }
  return widest
}

/**
 * 纯策略：把「最长一行的宽度」夹进 [MIN, MAX] 与可用空间。
 *
 * 注意这里**不再叠加任何装饰**：`want` 已经是含装饰的整体宽度（见 rowOuterWidth）。
 *
 * 可用空间比下限还小时下限让位（`lower = min(MIN, upper)`）——
 * 否则窄窗口下会返回 MIN，面板直接溢出到窗口外。
 */
export function clampPanelWidth(want: number, avail: number): number {
  const room = Number.isFinite(avail) ? Math.max(0, avail) : POP_W_MAX
  const upper = Math.min(POP_W_MAX, room)
  const lower = Math.min(POP_W_MIN, upper)
  const w = Number.isFinite(want) ? want : 0
  return Math.round(Math.max(lower, Math.min(upper, w)))
}

// —— 文本宽度 ——

// measureCtx 在文件顶部声明（见上）—— 顶部算 SETTINGS_MIN_W 时就会调到 textWidth，
// 声明放在这里会撞上 let 的 TDZ（esbuild 恰好把 let 降级成 var，所以本地看不出问题）。

/**
 * 估算一段文本的渲染宽度。
 *
 * 用 canvas 量而不是插 DOM：不触发重排抽动，且面板还没挂载时也能算。
 * 字体拿不到真实计算值（那要读 DOM），这里用面板的实际字号 + 通用字族近似 ——
 * 宽度本来就有上下限夹着，几像素误差不会让布局出问题。
 */
export function textWidth(text: string, px: number, weight = 400): number {
  if (!text) return 0
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    } catch {
      measureCtx = null
    }
  }
  if (measureCtx) {
    measureCtx.font = `${weight} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`
    return measureCtx.measureText(text).width
  }
  // 退化估算：CJK/全角按 1em，其余按 0.55em
  let em = 0
  for (const ch of text) {
    em += /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 1 : 0.55
  }
  return em * px
}

/**
 * 面板宽度：跟着清单里最长的那条走，夹进 [MIN, MAX] 与可用空间。
 * @param rows - 当前清单（空清单 → 取下限，面板保持窄）
 * @param left - 面板左缘（从侧边栏右缘算起），px
 */
export function panelWidthFor(rows: readonly WidthRow[], left: number): number {
  const avail = (typeof window === 'undefined' ? 1280 : window.innerWidth) - left - 12
  return clampPanelWidth(rows.length === 0 ? 0 : widestRowWidth(rows), avail)
}
