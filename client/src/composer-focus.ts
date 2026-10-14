/**
 * 点击输入条任意空白处即聚焦（Step 69）。
 *
 * 反馈原话：「当我鼠标已经点了对话框区域（假设输入框分最顶部的第一行、
 * 第二行、第三行）的中下行时，是不会出现光标的……只要鼠标点击了输入框任意位置
 * （除了那些发送、更换模型、权限控制等按钮开关），都能实现进入可编辑状态。」
 *
 * 根因（读宿主 ui-conversation 源码确认）：
 *   可见的输入框盒子是 `[data-input-scroll]`（.scroll，max-height+overflow）
 *   > `.grow`（position:relative）> `[data-composer-input]`（contenteditable）
 *   + 覆盖其上的 `[data-composer-placeholder]`。
 *   - contenteditable（.input）只有内容那么高（min-height:36px、padding-top:4px），
 *     而盒子被 tokensave composer-resize 的自动加高/手动固定撑到几百 px ——
 *     **中下行是 .grow/.scroll 的空白背景，普通 div 点了不聚焦**；
 *   - 占位符虽是覆盖层，但 CSS 明确 `pointer-events:none`，点击穿透到背景，
 *     同样不聚焦；且点不可聚焦区域会把已聚焦的编辑面 blur 掉。
 *   发送/换模型/权限等按钮都在 scroll 之外或本身是 button，天然不受影响。
 *
 * 修法（DOM 级轻推，与 todo-collapse / composer-resize 同款 house style，
 * 不碰宿主 React 树）：document 捕获阶段 click 委托 —— 命中滚动口且通过
 * 判定 → focus 编辑面 + 光标落点击点（caretRangeFromPoint / 光标 API，
 * 落空则收拢到文末）。不 preventDefault、不改宿主行为，判完即停。
 */

/** 宿主输入条滚动口（DraftEditor 的 scrollRef）。 */
export const INPUT_SCROLL_SEL = '[data-input-scroll]'
/** 宿主 contenteditable 编辑面（ComposerContentEditable）。 */
export const COMPOSER_INPUT_SEL = '[data-composer-input]'
/**
 * 交互控件白名单之外的排除面：发送/换模型/权限开关/附件等按钮与表单件。
 * 它们要么在 scroll 之外、要么命中本选择器 —— 一律不代为聚焦。
 */
export const INTERACTIVE_SEL =
  'button, a, select, textarea, input, ' +
  '[role="button"], [role="menuitem"], [role="option"], [role="switch"], ' +
  '[role="tab"], [role="combobox"], [role="listbox"]'

export type FocusSkipReason =
  | 'outside-scroll'
  | 'interactive-control'
  | 'native-focus'
  | 'selecting'
  | 'editor-not-editable'
export type FocusAction = 'focus' | 'skip'
export interface FocusDecision {
  action: FocusAction
  /** focus → 'click-to-focus'；skip → 具体跳过原因 */
  reason: 'click-to-focus' | FocusSkipReason
  /** 要聚焦的编辑面元素（仅 action=focus 时非空） */
  input?: HTMLElement
}

/** 最小点击形状（便于测试注入；真实事件是 MouseEvent）。 */
export interface ClickLike {
  target: EventTarget | null
  /** 当前选区是否非折叠（拖选中） */
  selectionCollapsed: boolean
  /** 选区锚点是否落在滚动口内（拖选刚结束的场景） */
  selectionInScroll: boolean
}

interface QueryRoot {
  querySelector(sel: string): unknown
}

/**
 * 纯决策：这次点击要不要代为聚焦，为什么。
 *
 * 顺序有讲究：
 *   1. 不在滚动口内（按钮大多在这之外）→ skip；
 *   2. 命中交互控件（发送/模型/权限等）→ skip，绝不去抢它的焦点；
 *   3. 点击目标已在编辑面内 → skip（浏览器原生就会放光标，我们不插手）；
 *   4. 拖选中/刚拖选完（选区非折叠且锚点在口内）→ skip，不打断选区；
 *   5. 编辑面不可编辑（workspaceTrigger 空态 / editorDisabled）→ skip；
 *   6. 其余 = 点了盒子空白 → focus。
 */
export function decideComposerFocus(click: ClickLike, root: QueryRoot): FocusDecision {
  const scroll = root.querySelector(INPUT_SCROLL_SEL) as HTMLElement | null
  if (!scroll) return { action: 'skip', reason: 'outside-scroll' }

  const target = click.target as Element | null
  if (target && typeof target.closest === 'function') {
    if (target.closest(INTERACTIVE_SEL)) return { action: 'skip', reason: 'interactive-control' }
    const scrollHit = target.closest(INPUT_SCROLL_SEL)
    if (!scrollHit) return { action: 'skip', reason: 'outside-scroll' }
    if (target.closest(COMPOSER_INPUT_SEL)) return { action: 'skip', reason: 'native-focus' }
  } else {
    // target 不是元素（文本节点/文档等）→ 只要有滚动口就算命中，交给 focus 兜底
    return finishFocus(scroll, click)
  }

  if (!click.selectionCollapsed && click.selectionInScroll) {
    return { action: 'skip', reason: 'selecting' }
  }

  return finishFocus(scroll, click)
}

function finishFocus(scroll: HTMLElement, click: ClickLike): FocusDecision {
  const input = scroll.querySelector(COMPOSER_INPUT_SEL) as HTMLElement | null
  if (!input || input.isContentEditable !== true) {
    return { action: 'skip', reason: 'editor-not-editable' }
  }
  void click
  return { action: 'focus', reason: 'click-to-focus', input }
}

/**
 * 聚焦编辑面并把光标放到点击点。
 * - 光标定位用 caretRangeFromPoint（WebKit/Blink）→ caretPositionFromPoint（FF）；
 * - 落点不在编辑面内（点了空白背景/占位符）→ 收拢到**文末**（符合直觉）；
 * - focus 用 preventScroll，避免聚焦把视口跳走（长会话里很关键）。
 */
export function focusComposerAt(input: HTMLElement, x: number, y: number): boolean {
  try {
    input.focus({ preventScroll: true })
  } catch {
    try {
      input.focus()
    } catch {
      return false
    }
  }
  try {
    const doc = input.ownerDocument
    const sel = doc.getSelection()
    if (!sel) return true
    let range: Range | null = null
    const anyDoc = doc as any
    if (typeof anyDoc.caretRangeFromPoint === 'function') {
      range = anyDoc.caretRangeFromPoint(x, y)
    } else if (typeof anyDoc.caretPositionFromPoint === 'function') {
      const pos = anyDoc.caretPositionFromPoint(x, y)
      if (pos && typeof Range !== 'undefined') {
        range = doc.createRange()
        range.setStart(pos.offsetNode, pos.offset)
      }
    }
    if (range && input.contains(range.startContainer)) {
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
      return true
    }
    // 点在空白背景 → 光标放到已有文字末尾
    const end = doc.createRange()
    end.selectNodeContents(input)
    end.collapse(false)
    sel.removeAllRanges()
    sel.addRange(end)
    return true
  } catch {
    // 只要 focus 成功就算达成（光标至少在编辑面里）
    return true
  }
}

/** 从点击事件提取决策所需的最小事实。 */
export function readClick(e: MouseEvent, doc: Document | QueryRoot = document): ClickLike {
  const sel = (doc as Document).getSelection?.() ?? null
  const collapsed = sel ? sel.isCollapsed : true
  let inScroll = false
  if (!collapsed && sel && typeof sel.anchorNode === 'object') {
    const scroll = (doc as Document).querySelector?.(INPUT_SCROLL_SEL) ?? null
    inScroll = !!(scroll && sel.anchorNode && scroll.contains(sel.anchorNode as Node))
  }
  return { target: e.target, selectionCollapsed: collapsed, selectionInScroll: inScroll }
}

let installed = false

/**
 * 安装点击聚焦（幂等）。document 捕获阶段单监听，每次现查 DOM ——
 * 会话/Tab 重挂载、HDesk 停靠、composer-resize 改高度都天然适配。
 */
export function installComposerFocus(): void {
  if (installed) return
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  installed = true

  const onClick = (e: Event) => {
    try {
      const me = e as MouseEvent
      const click = readClick(me, document)
      const decision = decideComposerFocus(click, document)
      const diag = ((window as any).__tsComposerFocus ??= { at: Date.now(), last: '' })
      diag.last = decision.reason
      if (decision.action !== 'focus' || !decision.input) return
      focusComposerAt(decision.input, me.clientX, me.clientY)
    } catch (err) {
      console.warn('[composer-focus] click handler failed', err)
    }
  }
  // 捕获阶段：宿主若有自己的 click 处理也不受影响（我们不 stopPropagation、不 preventDefault）
  document.addEventListener('click', onClick, true)
  ;(window as any).__tsComposerFocusInstalled = true
}
