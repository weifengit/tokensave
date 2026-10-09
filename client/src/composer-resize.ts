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
 *  1. **自动加高**：内容有多高就把滚动口的上限提到多高（一眼看全，不出现内部滚动条），
 *     上限为可视高度的 70%，超过才回到滚动。
 *  2. **手动拉高**：输入区上沿是一条抓手，按住上下拖可把上限固定到任意高度；
 *     松手后固定并写入 localStorage（`tokensave:composer-height.v1`），刷新后仍在，
 *     且内容变少也不会自动收回（固定高度是用户的明确意图）；
 *     抓手右侧的「重置」（或双击抓手）把上限交还给自动加高。
 *
 * 不碰宿主的 React 树：抓手是挂在 body 上的 position:fixed 浮层，只写滚动口的
 * `--dsh-composer-text-max-height`（宿主样式表里声明的那个变量）。
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
/** 自动加高的上限比例：最多占可视高度的 70%，再长就在框里滚动。 */
const AUTO_VIEWPORT_RATIO = 0.7
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
  /** 按下时抓手浮层的视口位置：拖动期间冻结（抓手会跟着盒子动，不冻结则位移自我抵消）。 */
  left: number
  width: number
  top: number
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

/** 写/清持久化的手动高度（private 模式等写入失败静默忽略，本次会话内仍然生效）。 */
function writeManualCap(value: number | null): void {
  manualCap = value
  try {
    if (value === null) localStorage.removeItem(STORE_KEY)
    else localStorage.setItem(STORE_KEY, String(Math.round(value)))
  } catch {
    /* 忽略 */
  }
}

/** 自动加高的上限：随窗口高度变化，且永远不小于 AUTO_VIEWPORT_MIN。 */
function autoCap(): number {
  const vh = window.innerHeight || 800
  return Math.max(AUTO_VIEWPORT_MIN, Math.round(vh * AUTO_VIEWPORT_RATIO))
}

/** 手动高度允许的上界（别把输入框拖到比窗口还高）。 */
function maxCap(): number {
  return Math.max(MIN_CAP, Math.round((window.innerHeight || 800) - 24))
}

/** 把上限（px）写进滚动口：值相同不写，避免与监听器自激。 */
function setCap(el: HTMLElement, px: number): void {
  const next = `${Math.round(px)}px`
  if (el.style.getPropertyValue('--dsh-composer-text-max-height') === next) return
  el.style.setProperty('--dsh-composer-text-max-height', next)
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
.ts-composer-grabber .ts-composer-grip{position:absolute;top:4px;left:0;right:0;height:3px;border-radius:99px;background:rgba(127,127,127,.22);transition:background .14s ease,height .14s ease}
.ts-composer-grabber[data-ts-overflow="0"] .ts-composer-grip{background:rgba(127,127,127,.13)}
.ts-composer-grabber:hover .ts-composer-grip{background:rgba(127,127,127,.45);height:4px}
.ts-composer-grabber[data-ts-manual="1"] .ts-composer-grip{background:rgba(96,165,250,.55)}
.ts-composer-grabber[data-ts-dragging="1"] .ts-composer-grip{background:rgba(96,165,250,.85);height:4px}
.ts-composer-grabber .ts-composer-size{border-radius:99px;padding:0 7px;font-size:10px;line-height:15px;font-variant-numeric:tabular-nums;background:rgba(96,165,250,.2);color:var(--dsw-alias-label-secondary,#9aa0a6);opacity:0;transition:opacity .14s ease;pointer-events:none;transform:translateY(-2px)}
.ts-composer-grabber[data-ts-dragging="1"] .ts-composer-size{opacity:1}
.ts-composer-reset{position:absolute;right:8px;top:-11px;height:18px;border-radius:99px;padding:0 8px;border:.5px solid rgba(127,127,127,.4);background:var(--dsw-specific-menu,rgba(30,30,32,.92));color:var(--dsw-alias-label-secondary,#9aa0a6);font-size:10.5px;line-height:1;cursor:pointer;opacity:0;transition:opacity .14s ease}
.ts-composer-grabber:hover .ts-composer-reset,.ts-composer-grabber:focus-within .ts-composer-reset{opacity:1}
.ts-composer-reset:hover{color:var(--dsw-alias-label-primary,#e6e8eb);border-color:rgba(96,165,250,.7)}
body.ts-composer-resizing{cursor:ns-resize}
body.ts-composer-resizing .ts-composer-grabber .ts-composer-grip{background:rgba(96,165,250,.85);height:4px}
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
  contentH = measureContent(el)
  setCap(el, manualCap ?? autoCap())
  positionHandle()
  reflect()
}

/** 抓手与「重置」按钮的显隐/状态。 */
function reflect(): void {
  if (!grabber) return
  const manual = manualCap !== null
  grabber.dataset.tsManual = manual ? '1' : '0'
  grabber.dataset.tsDragging = drag ? '1' : '0'
  // 内容已全部看得见时抓手淡一点，不抢视线
  grabber.dataset.tsOverflow = contentH > (manualCap ?? autoCap()) + 1 ? '1' : '0'
  if (resetChip) resetChip.style.display = manual ? '' : 'none'
}

/**
 * 把抓手浮层摆到输入区上沿（fixed 定位，滚动/布局变化时重摆）。
 * 拖动中冻结在按下时的位置：跟手的是内容高度，不是抓手本身。
 */
function positionHandle(): void {
  const el = current
  if (!el || !grabber) return
  let left: number
  let width: number
  let top: number
  if (drag) {
    left = drag.left
    width = drag.width
    top = drag.top
  } else {
    const r = el.getBoundingClientRect()
    if (r.width < 40 || r.height <= 0) {
      grabber.style.display = 'none'
      return
    }
    left = r.left
    width = r.width
    top = clamp(r.top - (GRABBER_H - 4), 0, Math.max(0, (window.innerHeight || 0) - GRABBER_H))
  }
  grabber.style.display = ''
  grabber.style.left = `${Math.round(left)}px`
  grabber.style.width = `${Math.round(width)}px`
  grabber.style.top = `${Math.round(top)}px`
  grabber.style.bottom = 'auto'
}

/** 手势起点：先把上限设为「当前实际高度」，再按指针位移跟随（第一下不跳变）。 */
function onPointerDown(e: PointerEvent): void {
  const el = current
  if (!el || !grabber || e.button !== 0) return
  e.preventDefault()
  const rect = grabber.getBoundingClientRect()
  drag = {
    originY: e.clientY,
    originH: Math.max(MIN_CAP, Math.round(el.clientHeight)),
    // 按下时抓手的视口位置：拖动期间冻结（见 positionHandle 的 drag 分支），
    // 否则抓手会随盒子一起上移，指针位移被抵消、拖不动。
    left: rect.left,
    width: rect.width,
    top: rect.top,
  }
  writeManualCap(drag.originH)
  try {
    grabber.setPointerCapture(e.pointerId)
  } catch {
    /* 某些指针捕获不可用时靠 body 上的监听兜底 */
  }
  document.body.classList.add('ts-composer-resizing')
  reflect()
}

function onPointerMove(e: PointerEvent): void {
  const el = current
  if (!drag || !el || !el.isConnected) return
  e.preventDefault()
  // 抓手在输入条上沿：往上拖 = 变高
  const px = clamp(Math.round(drag.originH + (drag.originY - e.clientY)), MIN_CAP, maxCap())
  writeManualCap(px)
  contentH = measureContent(el)
  setCap(el, px)
  positionHandle()
  reflect()
  if (sizeLabel) sizeLabel.textContent = `${px}`
}

function onPointerUp(e: PointerEvent): void {
  if (!drag) return
  const el = current
  drag = null
  try {
    grabber?.releasePointerCapture(e.pointerId)
  } catch {
    /* 已释放 */
  }
  document.body.classList.remove('ts-composer-resizing')
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
  grabber.innerHTML = '<span class="ts-composer-grip"></span><span class="ts-composer-size"></span>'
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

/** 移除抓手浮层（滚动口换人/卸载时）。 */
function dropHandle(): void {
  drag = null
  document.body.classList.remove('ts-composer-resizing')
  grabber?.remove()
  grabber = null
  resetChip = null
  sizeLabel = null
}

/** 解绑当前滚动口（宿主写在行内样式里的上限值不动，宿主自己会接管）。 */
function detach(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  innerObserver?.disconnect()
  innerObserver = null
  contentObserver?.disconnect()
  contentObserver = null
  current = null
  contentH = 0
  dropHandle()
}

/** 绑定一个滚动口：接管上限，并盯住内容尺寸与文本变化。 */
function attach(el: HTMLElement): void {
  if (current === el) return
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
 * 由 MutationObserver（childList）与兜底轮询共同驱动，成本极低。
 */
function sync(): void {
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

  // 布局/滚动变化：只重摆抓手；上限由 schedule 里的 autoCap 按窗口高度重算
  const onLayout = () => {
    if (current && current.isConnected) positionHandle()
    else sync()
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

  // 兜底轮询：宿主大规模重排后 observer 也可能错过，1s 一次比对成本可忽略
  const timer = window.setInterval(sync, 1000)

  // 视口高度变化时，手动上限跟着夹到合法区间
  const onResizeClamp = () => {
    if (manualCap !== null && manualCap > maxCap()) writeManualCap(maxCap())
  }
  window.addEventListener('resize', onResizeClamp)

  sync()

  return () => {
    installed = false
    mo.disconnect()
    window.clearInterval(timer)
    window.removeEventListener('resize', onViewport)
    window.removeEventListener('resize', onResizeClamp)
    window.removeEventListener('scroll', onLayout, true)
    window.visualViewport?.removeEventListener('resize', onLayout)
    window.visualViewport?.removeEventListener('scroll', onLayout)
    detach()
  }
}
