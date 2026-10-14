/**
 * 宿主原生输入条（composer）的「自适应加高 + 手动拉高」增强。
 *
 * 背景：宿主的输入区结构是
 *   [data-input-scroll]（滚动口，max-height: var(--dsh-composer-text-max-height)，默认 336px）
 *     └ .grow
 *         └ [data-composer-input]（contenteditable / Lexical 宿主）
 * 内容超过 336px 就在滚动口里滚动 —— 长文本「看不全」。
 *
 * 本模块做两件事：
 *  1. **自动加高**：内容有多高就把滚动口提到多高（一眼看全，不出现内部滚动条），
 *     上限为「可视高度 - 160px」（下限 160），超过才回到滚动。
 *  2. **手动拉高**：输入区上沿是一条抓手，按住上下拖可把盒子**固定**到任意高度；
 *     松手后固定并写入 localStorage（`tokensave:composer-height.v1`），刷新后仍在，
 *     且内容变少也不会自动收回（固定高度是用户的明确意图）；
 *     抓手右侧的「重置」（或双击抓手）把高度交还给自动加高。
 *
 * 关键：手动高度必须**同时写 min-height 与 max-height**（固定盒）。
 * 只写 max-height 时，内容比目标矮的盒子不会变高——空输入框往上拖毫无反应。
 *
 * 不碰宿主的 React 树：抓手是挂在 body 上的 position:fixed 浮层，只写滚动口的
 * `--dsh-composer-text-max-height` 与 `min-height`（前者是宿主样式表声明的变量）。
 * 幂等：模块只挂一套全局监听，重复 install 直接返回。
 */

/** 滚动口选择器（DraftEditor 的宿主元素）。 */
const SCROLL_SELECTOR = '[data-input-scroll]'
/** 输入内容宿主（Lexical 的 root element）。 */
const INPUT_SELECTOR = '[data-composer-input]'
/** 手动高度（滚动口上限）的 localStorage 键。 */
const STORE_KEY = 'tokensave:composer-height.v1'
/** 最小上限：低于此值连一行都放不下（宿主一行约 36px）。 */
const MIN_CAP = 36
/** 自动加高的上限：可视高度减去这些余量（给头部/工具栏留位），再长就在框里滚动。 */
const AUTO_VIEWPORT_HEADROOM = 160
/** 自动上限的绝对下限：窗口很矮时也别把输入条压成一条缝。 */
const AUTO_VIEWPORT_MIN = 160
/** 抓手浮层高度（命中区）；下沿压在滚动口上沿，正好落在输入区 4px 上留白里。 */
const GRABBER_H = 16

/** 抓手样式表的 id（幂等插入）。 */
const STYLE_ID = 'tokensave-composer-resize-css'

interface DragState {
  /** 按下时的指针 Y。 */
  originY: number
  /** 按下时滚动口的实际高度（作为拖动基准，避免第一下跳变）。 */
  originH: number
}

let installed = false
/** 当前接管中的滚动口（页面上常驻一个 composer；换元素时重新绑定）。 */
let current: HTMLElement | null = null
let grabber: HTMLDivElement | null = null
let resetChip: HTMLButtonElement | null = null
let sizeLabel: HTMLSpanElement | null = null
let innerObserver: ResizeObserver | null = null
let contentObserver: MutationObserver | null = null

/** 手动固定的上限（px）；null = 未手动设置，完全交给自动加高。 */
let manualCap: number | null = readManualCap()
/** 拖动中的状态。 */
let drag: DragState | null = null
/** 最近一次量到的内容自然高度（用于判断「是否已经全部看得见」）。 */
let contentH = 0
let raf = 0

/** 读持久化的手动高度（脏数据/越界一律当作未设置）。 */
function readManualCap(): number | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw === null) return null
    const n = Math.round(Number(raw))
    return Number.isFinite(n) && n >= MIN_CAP ? n : null
  } catch {
    return null
  }
}

/**
 * 写/清持久化的手动高度（private 模式等写入失败静默忽略，本次会话内仍然生效）。
 * @param persist - false = 只更新内存不落盘。拖动中每个 pointermove 都写
 *   localStorage 是同步磁盘 IO，会掉帧；拖动期间只改内存，松手一次性落盘。
 */
function writeManualCap(value: number | null, persist = true): void {
  manualCap = value
  if (!persist) return
  try {
    if (value === null) localStorage.removeItem(STORE_KEY)
    else localStorage.setItem(STORE_KEY, String(Math.round(value)))
  } catch {
    /* 忽略 */
  }
}

/** 自动加高的上限：可视高度减去头部/工具栏余量，且不小于 AUTO_VIEWPORT_MIN。 */
function autoCap(): number {
  const vh = window.innerHeight || 800
  return Math.max(AUTO_VIEWPORT_MIN, vh - AUTO_VIEWPORT_HEADROOM)
}

/** 手动高度允许的上界（别把输入框拖到比窗口还高）。 */
function maxCap(): number {
  return Math.max(MIN_CAP, Math.round((window.innerHeight || 800) - 24))
}

/**
 * 把高度限制写进滚动口：max-height（CSS 变量）+ 手动模式的 min-height。
 * 两者必须成对：只写 max-height 时，内容比目标矮的盒子不会变高 ——
 * 空输入框往上拖毫无反应（“没实现”的根源）；手动高度因此是**固定盒**。
 * 值未变不写，避免与监听器自激。
 */
function applyLimits(el: HTMLElement, capPx: number): void {
  const next = `${Math.round(capPx)}px`
  if (el.style.getPropertyValue('--dsh-composer-text-max-height') !== next) {
    el.style.setProperty('--dsh-composer-text-max-height', next)
  }
  const minNext = manualCap === null ? '' : `${Math.round(manualCap)}px`
  if (el.style.getPropertyValue('min-height') !== minNext) {
    if (minNext === '') el.style.removeProperty('min-height')
    else el.style.setProperty('min-height', minNext)
  }
}

/**
 * 内容自然高度：滚动口的上下内边距 + 内部内容盒的高度。
 * 用 `.grow` 子项而不是滚动口自身 —— 后者的 scrollHeight 被 max-height 裁剪过。
 */
function measureContent(el: HTMLElement): number {
  const inner = el.firstElementChild as HTMLElement | null
  const cs = getComputedStyle(el)
  const padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
  const innerH = inner ? inner.scrollHeight : el.scrollHeight
  return Math.max(MIN_CAP, Math.ceil(innerH + padding))
}

/** 抓手与「重置」按钮的样式（一次性注入，id 幂等）。 */
const CSS = `
.ts-composer-grabber{position:fixed;z-index:60;height:16px;display:flex;align-items:flex-end;cursor:ns-resize;user-select:none;-webkit-user-select:none;touch-action:none}
/* —— 横线已按用户要求**彻底移除**（连带此前拖动中的横线残影/闪屏源）：
   抓手只保留一条不可见的 16px 命中区（cursor:ns-resize + title 提示可发现），
   拖动反馈只靠 px 数字胶囊与悬停浮出的「重置」按钮。 */
.ts-composer-grabber .ts-composer-size{margin-left:var(--ts-grab-inset,16px);border-radius:99px;padding:0 7px;font-size:calc(var(--ts-fs, 12.5px) * 0.8);line-height:15px;font-variant-numeric:tabular-nums;background:rgba(127,127,127,.25);color:var(--dsw-alias-label-secondary,#9aa0a6);opacity:0;transition:opacity .14s ease;pointer-events:none;transform:translateY(-2px)}
.ts-composer-grabber[data-ts-dragging="1"] .ts-composer-size{opacity:1}
/* 重置胶囊：悬停才浮出，右端同样按圆角内缩，不越过卡片圆角 */
.ts-composer-reset{position:absolute;right:var(--ts-grab-inset,16px);top:-11px;height:18px;border-radius:99px;padding:0 8px;border:.5px solid rgba(127,127,127,.4);background:var(--dsw-specific-menu,rgba(30,30,32,.92));color:var(--dsw-alias-label-secondary,#9aa0a6);font-size:calc(var(--ts-fs, 12.5px) * 0.84);line-height:1;cursor:pointer;opacity:0;transition:opacity .14s ease}
.ts-composer-grabber:hover .ts-composer-reset,.ts-composer-grabber:focus-within .ts-composer-reset{opacity:1}
.ts-composer-reset:hover{color:var(--dsw-alias-label-primary,#e6e8eb);border-color:rgba(127,127,127,.85)}
body.ts-composer-resizing{cursor:ns-resize}
`

function injectComposerStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

/** 轻量诊断计数：静置时 styleWrites 应≈0。挂到 window.__TS_COMPOSER_STATS 供真机验证。 */
const stats = { apply: 0, styleWrites: 0, attach: 0, sync: 0, detach: 0 }

/** 差量写行内样式：值没变不碰 DOM（防止高频空转写引发抖动/自激）。 */
function setStyle(el: HTMLElement, prop: string, value: string): void {
  if (el.style.getPropertyValue(prop) === value) return
  if (value === '') el.style.removeProperty(prop)
  else el.style.setProperty(prop, value)
  stats.styleWrites++
}

/** 差量写 data-* 属性：同上。 */
function setDs(el: HTMLElement, key: string, value: string): void {
  if (el.dataset[key] === value) return
  el.dataset[key] = value
  stats.styleWrites++
}

/** 排一次「量内容 → 定上限 → 摆抓手」，rAF 合并（输入/滚动/resize/DOM 变动会连着触发）。 */
function schedule(): void {
  if (raf || !current || drag) return
  raf = requestAnimationFrame(() => {
    raf = 0
    if (!current || drag) return
    apply()
  })
}

/** 应用一次状态：量内容、定上限、摆抓手、刷新抓手外观。 */
function apply(): void {
  const el = current
  if (!el || !el.isConnected) return
  stats.apply++
  contentH = measureContent(el)
  applyLimits(el, manualCap ?? autoCap())
  positionHandle()
  reflect()
}

/** 抓手与「重置」按钮的显隐/状态（全程差量写）。 */
function reflect(): void {
  if (!grabber) return
  const manual = manualCap !== null
  setDs(grabber, 'tsManual', manual ? '1' : '0')
  setDs(grabber, 'tsDragging', drag ? '1' : '0')
  if (resetChip) setStyle(resetChip, 'display', manual ? '' : 'none')
}

/**
 * 把抓手命中区摆到输入区上沿（fixed 定位，滚动/布局变化时重摆）。
 * 拖动中也按**实时** rect 摆位（不冻结 —— 冻结曾造成“残影”）；
 * 高度数学是 origin 基准（从不读抓手位置），实时摆位不影响跟手。
 * 全程差量写入。
 */
function positionHandle(): void {
  const el = current
  if (!el || !grabber) return
  const r = el.getBoundingClientRect()
  const visible = r.width >= 40 && r.height > 0
  setStyle(grabber, 'display', visible ? '' : 'none')
  if (!visible) return
  // 命中区下沿压在滚动口上沿 8px（贴实时盒顶），拖动热区跟着盒子走
  const top = clamp(r.top - (GRABBER_H - 8), 0, Math.max(0, (window.innerHeight || 0) - GRABBER_H))
  setStyle(grabber, 'left', `${Math.round(r.left)}px`)
  setStyle(grabber, 'width', `${Math.round(r.width)}px`)
  setStyle(grabber, 'top', `${Math.round(top)}px`)
  setStyle(grabber, 'bottom', 'auto')
  // 两端按输入卡圆角半径内缩（px 胶囊与「重置」胶囊吃这个变量），不越过圆角
  const card = el.parentElement
  const radius = card ? parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0 : 0
  const inset = Math.round(Math.min(Math.max(radius + 2, 10), Math.max(10, r.width / 3)))
  setStyle(grabber, '--ts-grab-inset', `${inset}px`)
}

/** 手势起点：先把上限设为「当前实际高度」，再按指针位移跟随（第一下不跳变）。 */
function onPointerDown(e: PointerEvent): void {
  const el = current
  if (!el || !grabber || e.button !== 0) return
  e.preventDefault()
  // 高度数学是 origin 基准（originH + 指针位移，与抓手自身位置无关），
  // 因此抓手可实时跟随盒顶走而不影响跟手（无残影）。
  drag = { originY: e.clientY, originH: Math.max(MIN_CAP, Math.round(el.clientHeight)) }
  writeManualCap(drag.originH)
  try {
    grabber.setPointerCapture(e.pointerId)
  } catch {
    /* 某些指针捕获不可用时靠 body 上的监听兜底 */
  }
  document.body.classList.add('ts-composer-resizing')
  reflect()
}

/** 拖动逐帧合并：pointermove 频率可高于刷新率，每移动一次就布局会闪屏。 */
let dragRaf = 0
let pendingPx = 0

function onPointerMove(e: PointerEvent): void {
  if (!drag || !current || !current.isConnected) return
  e.preventDefault()
  // 往上拖 = 变高：只记录目标值，真正应用合并到下一帧（防闪屏）
  pendingPx = clamp(Math.round(drag.originH + (drag.originY - e.clientY)), MIN_CAP, maxCap())
  if (!dragRaf) dragRaf = requestAnimationFrame(applyDrag)
}

/** 应用一帧拖动：改固定盒（min+max）→ 重摆命中区 → 刷状态。 */
function applyDrag(): void {
  dragRaf = 0
  const el = current
  if (!drag || !el || !el.isConnected) return
  const px = pendingPx
  writeManualCap(px, false)
  contentH = measureContent(el)
  applyLimits(el, px)
  positionHandle()
  reflect()
  if (sizeLabel && sizeLabel.textContent !== String(px)) {
    sizeLabel.textContent = String(px)
    stats.styleWrites++
  }
}

function onPointerUp(e: PointerEvent): void {
  if (!drag) return
  const el = current
  // 冲刷排队中的最后一帧（合并后 pointerup 可能先于 rAF 到达）
  if (dragRaf) {
    cancelAnimationFrame(dragRaf)
    dragRaf = 0
    applyDrag()
  }
  drag = null
  try {
    grabber?.releasePointerCapture(e.pointerId)
  } catch {
    /* 已释放 */
  }
  document.body.classList.remove('ts-composer-resizing')
  // 拖动期间只改内存，松手一次性落盘
  if (manualCap !== null) writeManualCap(manualCap)
  // 松手即固定：这次拖出来的高度是用户的明确意图（“就固定在这个高度”），
  // 不做自动收回；抓手右侧的「重置」或双击抓手指它交还自动加高。
  if (el && el.isConnected) apply()
  else reflect()
}

/** 重置：交还自动加高，并清掉持久化值。 */
function resetManual(): void {
  writeManualCap(null)
  if (current?.isConnected) apply()
  else reflect()
  schedule()
}

/** 建一次抓手浮层（fixed 挂在 body，不进宿主 React 树）。 */
function ensureHandle(): void {
  if (grabber) return
  injectComposerStyles()
  grabber = document.createElement('div')
  grabber.className = 'ts-composer-grabber'
  grabber.setAttribute('role', 'separator')
  grabber.setAttribute('aria-orientation', 'horizontal')
  grabber.setAttribute('aria-label', '拖动调整输入框高度')
  grabber.title = '拖动调整输入框高度 · 双击恢复自动高度'
  grabber.innerHTML = '<span class="ts-composer-size"></span>'
  sizeLabel = grabber.querySelector('.ts-composer-size') as HTMLSpanElement

  resetChip = document.createElement('button')
  resetChip.type = 'button'
  resetChip.className = 'ts-composer-reset'
  resetChip.textContent = '重置'
  resetChip.title = '恢复自动加高'
  resetChip.style.display = 'none'
  resetChip.addEventListener('pointerdown', (e) => e.stopPropagation())
  resetChip.addEventListener('click', (e) => {
    e.stopPropagation()
    resetManual()
  })
  grabber.appendChild(resetChip)

  grabber.addEventListener('pointerdown', onPointerDown)
  grabber.addEventListener('pointermove', onPointerMove)
  grabber.addEventListener('pointerup', onPointerUp)
  grabber.addEventListener('pointercancel', onPointerUp)
  grabber.addEventListener('dblclick', (e) => {
    e.preventDefault()
    resetManual()
  })
  document.body.appendChild(grabber)
}

/**
 * 隐藏抓手浮层（滚动口换人/卸载时）。**不摘除**：整颗摘掉再插回去会闪一下，
 * 页面上看起来就是“刷新”；抓手常驻，只切 display。
 */
function hideHandle(): void {
  drag = null
  document.body.classList.remove('ts-composer-resizing')
  if (grabber) setStyle(grabber, 'display', 'none')
}

/** 彻底移除抓手（仅卸载插件时）。 */
function removeHandle(): void {
  grabber?.remove()
  grabber = null
  resetChip = null
  sizeLabel = null
}

/** 解绑当前滚动口（宿主写在行内样式里的上限值不动，宿主自己会接管）。 */
function detach(): void {
  stats.detach++
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  innerObserver?.disconnect()
  innerObserver = null
  contentObserver?.disconnect()
  contentObserver = null
  current = null
  contentH = 0
  hideHandle()
}

/** 绑定一个滚动口：接管上限，并盯住内容尺寸与文本变化。 */
function attach(el: HTMLElement): void {
  if (current === el) return
  stats.attach++
  detach()
  current = el
  ensureHandle()
  const inner = (el.querySelector(INPUT_SELECTOR) as HTMLElement | null) ?? el.firstElementChild
  try {
    innerObserver = new ResizeObserver(() => schedule())
    if (inner) innerObserver.observe(inner)
    innerObserver.observe(el)
  } catch {
    /* 不支持 ResizeObserver 时靠 scroll/resize 与兜底轮询 */
  }
  try {
    // 换行不一定改变被测元素的 border-box（例如行高被压），文本变动也重排一次
    contentObserver = new MutationObserver(() => schedule())
    if (inner) {
      contentObserver.observe(inner, { childList: true, subtree: true, characterData: true })
    }
  } catch {
    /* 忽略 */
  }
  apply()
  schedule()
}

/** 找一个还活着的滚动口（优先可见的那个）。 */
function findScroll(): HTMLElement | null {
  const list = Array.from(document.querySelectorAll<HTMLElement>(SCROLL_SELECTOR))
  if (list.length === 0) return null
  return list.find((el) => el.isConnected && el.getBoundingClientRect().height > 0) ?? list[0] ?? null
}

/**
 * 扫描并同步：没绑定就绑，绑定的元素被 React 换掉就重新绑。
 * 只由 MutationObserver（childList）与 scroll/resize 事件驱动 ——
 * 早期的 1s 轮询是纯空转噪声，已删。
 */
function sync(): void {
  stats.sync++
  if (drag) return   // 拖动中禁止重绑：会丢 pointer capture，表现为“拖不动”
  const el = findScroll()
  if (!el) {
    if (current) detach()
    return
  }
  if (el !== current) attach(el)
  else schedule()
}

/** 节点里（含自身）是否出现了输入滚动口。 */
function touchesScroll(node: Node): boolean {
  if (!(node instanceof Element)) return false
  return node.matches(SCROLL_SELECTOR) || node.querySelector(SCROLL_SELECTOR) !== null
}

/**
 * 安装全局增强（幂等）。由 client/src/index.ts 的 apply 调用一次。
 * @returns 卸载函数（便于测试与热重载）。
 */
export function installComposerResize(): () => void {
  if (installed || typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {}
  }
  installed = true
  // 诊断计数挂到全局：真机验证「静置零写入」用
  ;(window as any).__TS_COMPOSER_STATS = stats

  // 布局/滚动变化：rAF 合并（scroll 每帧触发，直接写 DOM 是高频空转）；
  // 只重摆抓手（差量写），上限由 schedule 里的 autoCap 按窗口高度重算
  let layoutRaf = 0
  const onLayout = () => {
    if (layoutRaf) return
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = 0
      if (drag) return
      if (current && current.isConnected) positionHandle()
      else sync()
    })
  }
  const onViewport = () => schedule()
  window.addEventListener('resize', onViewport)
  window.addEventListener('scroll', onLayout, true)
  window.visualViewport?.addEventListener('resize', onLayout)
  window.visualViewport?.addEventListener('scroll', onLayout)

  const mo = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of Array.from(rec.addedNodes)) {
        if (touchesScroll(node)) {
          sync()
          return
        }
      }
    }
    // 当前绑定被摘掉（切视图/切会话/输入条重挂）时重找
    if (current && !current.isConnected) sync()
  })
  mo.observe(document.documentElement, { childList: true, subtree: true })

  // 视口高度变化时，手动上限跟着夹到合法区间
  const onResizeClamp = () => {
    if (manualCap !== null && manualCap > maxCap()) writeManualCap(maxCap())
  }
  window.addEventListener('resize', onResizeClamp)

  sync()

  return () => {
    installed = false
    mo.disconnect()
    if (layoutRaf) cancelAnimationFrame(layoutRaf)
    window.removeEventListener('resize', onViewport)
    window.removeEventListener('resize', onResizeClamp)
    window.removeEventListener('scroll', onLayout, true)
    window.visualViewport?.removeEventListener('resize', onLayout)
    window.visualViewport?.removeEventListener('scroll', onLayout)
    detach()
    removeHandle()
  }
}
