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
import { DEFAULT_FONT_SIZE } from './font-levels'

/** 外框里一行的水平开销：.ts-sound-body 12 + .ts-box 边框 1 + .ts-box-row 内距 9，两侧 */
const CARD_ROW_CHROME_W = 2 * (12 + 1 + 9)

/**
 * 当前界面字号（`--ts-fs`，由设置里的 4 档写到 :root）。
 *
 * 面板宽度必须跟着字号走：字号调大后 label / 单位字变宽，若仍按默认档量宽，
 * 「冷却基数 [20] 秒」的末字又会被卡片裁掉。node 自检（没有 DOM）退到默认档。
 */
export function currentFontSize(): number {
  if (typeof document === 'undefined') return DEFAULT_FONT_SIZE
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--ts-fs').trim()
  const px = Number.parseFloat(raw)
  return Number.isFinite(px) && px >= 8 ? px : DEFAULT_FONT_SIZE
}
/** 一个开关 / 数值输入的宽度、行内间隔 */
const SWITCH_W = 28
const NUM_W = 46
const GAP_W_SMALL = 6
/**
 * 两个「标签+控件」对之间的最小间隔。
 *
 * 不是 .ts-cont-gap 的 8px 本身：`.ts-box-row` 的 gap:6px 会作用在 gap 元素两侧，
 * 实际间隔 = 6(gap) + 8(.ts-cont-gap min-width) + 6(gap) = 20px。
 * 以前这里按 8px 算，正好少 12px —— 面板最窄宽被算成 272，而「冷却基数 [20] 秒」
 * 需要 284，末字「秒」就被卡片右边裁掉了（用户截图反馈）。
 */
const PAIR_GAP_W = GAP_W_SMALL * 2 + 8
/**
 * 文本宽度的余量：DOM 里的 label 带 letter-spacing:.02em（canvas 量不到），
 * 字体族回退也可能比 canvas 的 system-ui 略宽。宽度宁可多 4px，也不要「刚好等于」
 * —— 差 1px 就会让单位字被裁掉。
 */
const SETTINGS_SLACK_W = 4


/** 量文本宽度用的 canvas（懒建；建不出来就退化成字符估算）。
 *  必须声明在 SETTINGS_MIN_W 之前：那个常量在模块初始化时就会调 textWidth。 */
let measureCtx: CanvasRenderingContext2D | null | undefined

/**
 * 「自动继续」两个子行自身的最小宽度（不靠浏览器的默认值，这里算出来）。
 *
 * 这两行是**固定控件**（开关、输入框都不缩），不像清单行可以靠省略号收编 ——
 * 所以面板最窄宽度必须不小于它们，否则输入框会被挤出外框。
 * 面板宽度是跟着清单最长那行走的，清单很短时就会退到这个下限。
 *
 * 随界面字号缩放（fs 缺省读当前 --ts-fs）；控件宽度与行内间距是固定 px。
 */
export function settingsMinWidth(fs: number = currentFontSize()): number {
  const labelPx = fs * 0.84
  const unitPx = fs * 0.8
  return Math.max(
    // 第二行：分类 [开关] 截断 [开关] 瞬时 [开关]
    textWidth('分类', labelPx) + GAP_W_SMALL + SWITCH_W
      + GAP_W_SMALL + textWidth('截断', labelPx) + GAP_W_SMALL + SWITCH_W
      + GAP_W_SMALL + textWidth('瞬时', labelPx) + GAP_W_SMALL + SWITCH_W,
    // 第三行：发送上限 [数字] 次 ⋯ 冷却基数 [数字] 秒
    textWidth('发送上限', labelPx) + GAP_W_SMALL + NUM_W + GAP_W_SMALL + textWidth('次', unitPx)
      + PAIR_GAP_W
      + textWidth('冷却基数', labelPx) + GAP_W_SMALL + NUM_W + GAP_W_SMALL + textWidth('秒', unitPx),
  ) + CARD_ROW_CHROME_W + SETTINGS_SLACK_W
}

/** 默认档的最窄宽度（自检与首帧量宽的参考值）。 */
export const SETTINGS_MIN_W = settingsMinWidth(DEFAULT_FONT_SIZE)
/**
 * 面板最窄：取「设置行必须放得下」的量（随当前字号）。
 * 不再写死一个数字 —— 改标签文案 / 控件宽度 / 字号档时它会自己跟着变，
 * 不会出现“改了字面板却还是老宽度、输入框被挤出去”那种事。
 */
export function panelWidthMin(fs: number = currentFontSize()): number {
  return Math.max(236, Math.ceil(settingsMinWidth(fs)))
}

/** 默认档的最窄宽度（自检与无 DOM 环境用）。 */
export const POP_W_MIN = panelWidthMin(DEFAULT_FONT_SIZE)
// —— 宽度区间（唯一的真值，桌面与手机都从这里取） ——
/**
 * 面板最宽。比 440 收窄了不少 —— 清单是扫一眼用的，
 * 再宽眼睛就要来回移动，不如让标题走省略号。
 */
export const POP_W_MAX = 360
// —— 行内固定装饰（只在这里加一次）——

/** 行自身的内边距：.ts-warn-item 左右各 8（.ts-warn-row 的右内边距本轮改成 0） */
const ROW_PAD_W = 16
/** 图标 11 + 图标与文本的间隔 8 */
const ICON_W = 19
/** 条目区与操作区之间的间距（.ts-warn-row 的 gap） */
const ROW_GAP_W = 6
/**
 * 操作区宽度：现在是**三个固定 22px 图标槽位**（继续 / 已读 / 归档）+ 两个 4px 间隔。
 *
 * 为什么改成固定槽位（上一版是按按钮文案估的 53 / 99px）：
 *   1. 三个按钮都只放图标、不放文字，宽度与文案无关，不必再估文本宽度；
 *   2. 固定槽位保证「有没有继续按钮」时整行宽度一致 —— 否则有/无继续的两种行
 *      操作区宽度不同，标题行的「全部」图标就对不齐下面逐行的图标（用户明确要求对齐）。
 * 数值与 styles.ts 的 `.ts-warn-slot` / `.ts-warn-headops` 一一对应。
 */
const ACTION_SLOT_W = 22
const ACTION_SLOT_GAP = 4
const ACTION_SLOTS = 3
const ACTIONS_W = ACTION_SLOTS * ACTION_SLOT_W + (ACTION_SLOTS - 1) * ACTION_SLOT_GAP

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
export function rowContentWidth(r: WidthRow, fs: number = currentFontSize()): number {
  const titleW = textWidth(r.title, fs)
  const subW = r.sub ? textWidth(r.sub, fs * 0.84) + PILL_CHROME_W : 0
  const reasonW = r.shortReason ? textWidth(r.shortReason, fs * 0.8) + PILL_CHROME_W : 0
  const tagsW = subW + reasonW + (subW > 0 && reasonW > 0 ? TAGS_GAP_W : 0)
  // 标题与标签各占一行 → 取较宽者
  return Math.max(titleW, tagsW)
}

/** 一行的整体外宽（内容 + 行内装饰 + 面板内边距） */
export function rowOuterWidth(r: WidthRow, fs: number = currentFontSize()): number {
  // 操作区宽度与 canContinue 无关：三个槽位恒定占位（见 ACTIONS_W 的注释）
  return rowContentWidth(r, fs) + ROW_PAD_W + ICON_W + ROW_GAP_W + ACTIONS_W + PANEL_PAD_W
}

/** 清单里最长那一行需要多宽（空清单 → 0） */
export function widestRowWidth(rows: readonly WidthRow[], fs: number = currentFontSize()): number {
  let widest = 0
  for (const r of rows) {
    const w = rowOuterWidth(r, fs)
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
export function clampPanelWidth(want: number, avail: number, fs: number = currentFontSize()): number {
  const room = Number.isFinite(avail) ? Math.max(0, avail) : POP_W_MAX
  // 需要的最小宽随字号变；放不下时下限让位，但上限绝不压到下限以下。
  const need = Math.min(panelWidthMin(fs), room)
  const upper = Math.max(need, Math.min(POP_W_MAX, room))
  const lower = Math.min(need, upper)
  const w = Number.isFinite(want) ? want : 0
  return Math.round(Math.max(lower, Math.min(upper, w)))
}

/**
 * —— 窄屏（手机）摆法 ——
 *
 * 触发器的横向锚点是「侧边栏容器右缘 + 8」（见 ControlRoomEntry.sidebarRightOf）。
 * 手机上侧边栏是抽屉，能占到 85vw（最多 320px），锚点右侧往往只剩几十像素：
 * 面板被夹成一条贴在右缘的窄条（用户反馈原话：「呼吸灯面板被挤压到右边，
 * 不方便查看和点击」）。
 *
 * 所以：锚点右侧连最窄宽度都放不下时，改用「贴视口」的摆法 —— 水平居中。
 *
 * 宽度不再等于视口宽：手机摆法只是「不贴侧边栏」，不是「铺满屏幕」。用户反馈
 * 「浮动面板太大太宽了」—— 手机上仍然按清单最长那条走（与桌面同一套策略），
 * 只是上限收得更紧（SHEET_MAX_W = 300），两侧留出能看出这是浮层的空白。
 */
export const SHEET_MARGIN_X = 12
/* 手机摆法的宽度上限：比桌面（POP_W_MAX）再小一档。340 时手机上接近铺满（393 屏占 87%），
   用户反馈「太大太宽」；字号整体上调后下限涨到约 297，300 会压住设置区，取 320（393 屏约占 81%）
   仍留出浮层感；字号档更大时以 panelWidthMin 为硬下限。 */
export const SHEET_MAX_W = 320

/** 锚点右侧放不下最窄面板 → 该用手机摆法（贴视口而不是贴侧边栏右缘） */
export function needsSheetLayout(sideSpace: number, fs: number = currentFontSize()): boolean {
  return !(sideSpace >= panelWidthMin(fs))
}

/**
 * 手机摆法的 left/width：宽度跟清单最长那条走，夹进 [POP_W_MIN, SHEET_MAX_W]，
 * 水平居中，两侧至少留 SHEET_MARGIN_X。
 *
 * 极窄屏（连最窄面板都放不下）边距让位，最多给到 vw - 16（与旧行为一致，
 * 保证控件不被挤出面板，也不溢出视口）。
 */
export function sheetBox(
  viewportW: number,
  rows: readonly WidthRow[] = [],
  fs: number = currentFontSize(),
): { left: number; width: number } {
  const vw = Number.isFinite(viewportW) ? viewportW : 390
  const need = panelWidthMin(fs)
  const room = Math.max(0, vw - SHEET_MARGIN_X * 2)
  if (room < need) {
    const width = Math.round(Math.max(0, vw - 16))
    return { left: Math.max(8, Math.round((vw - width) / 2)), width }
  }
  const want = rows.length === 0 ? 0 : widestRowWidth(rows, fs)
  // 手机摆法同样受 [panelWidthMin(fs), SHEET_MAX_W] 约束：
  // 字号调大时硬下限可能超过 SHEET_MAX_W，此时以上限让位于下限。
  const cap = Math.max(SHEET_MAX_W, need)
  const upper = Math.min(cap, room)
  const lower = Math.min(need, upper)
  const width = Math.round(Math.max(lower, Math.min(upper, want)))
  return { left: Math.max(SHEET_MARGIN_X, Math.round((vw - width) / 2)), width }
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
export function panelWidthFor(rows: readonly WidthRow[], left: number, fs: number = currentFontSize()): number {
  const avail = (typeof window === 'undefined' ? 1280 : window.innerWidth) - left - 12
  return clampPanelWidth(rows.length === 0 ? 0 : widestRowWidth(rows, fs), avail, fs)
}
