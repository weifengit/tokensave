/**
 * 聊天记录滚动位记忆（Step 61 返工四）。
 *
 * 症状：在「对话」里拉到最新 → 切到别的 tab → 切回来 → 落在中间，
 * 又要手动拉回「回到最新」。根因是切回时消息列表先以不完整高度挂上、
 * scroll anchoring 把视口带到中部，随后内容长入不再回底。
 *
 * 策略：
 *  1. **记账**：scroll（capture）实时记 `{会话id, scrollTop, 是否贴底(≤48px)}`；
 *     容器首次挂载时补一条基线（页面打开即贴底、从未滚动的场景也覆盖）。
 *  2. **离开保护**：点 tab 离开「对话」（白名单标签判定）或 conv-scroll 被卸载时
 *     置 `frozen`，期间任何回填的滚动事件都不许覆盖账本。
 *  3. **回来恢复**：conv-scroll 重新挂载（或点回「对话」）→ rAF 等内容稳定
 *     （连续 3 帧 scrollHeight 不变；内容还是空的最多再等 2s）→
 *     贴底则 pin 到底并进入**贴底跟随**，否则 clamp 回原 scrollTop。
 *  4. **贴底跟随**：恢复到底后，内容再长入持续 pin 底（800ms 慢轮询 + 我们
 *     自己写 scrollTop 的 150ms 自我标记避免误判），用户自己向上滚一次即退出。
 *
 * 记账按**会话 id**（panel/sessions 的 getCurrentSessionId）分键：切会话时
 * 恢复会因键不匹配直接丢弃，不会把 A 会话的位置灌进 B 会话。
 * 挂到 window.__TS_SCROLL_MEMORY 供真机诊断。
 */

import { getCurrentSessionId } from './panel/sessions'

/** 宿主聊天区滚动容器（dsh-client-ui-conversation 的 scrollBody）。 */
const CONV_SCROLL = '[data-conversation-scroll]'
/** 会话区的五个 tab；只有点它们才算「切视图」（避免误伤重置/新会话等同名短按钮）。 */
const TAB_LABELS = new Set(['对话', '轨迹', '看板', '项目中心', '工作台'])
/** 距底多少像素内算「贴着最新」。 */
const AT_BOTTOM_EPS = 48
/** 内容稳定判据：scrollHeight 连续这么多帧不变。 */
const STABLE_FRAMES = 3
/** 非空内容的等待上限。 */
const STABLE_MAX_WAIT = 1200
/** 内容还是空的（消息在路上）时的等待上限。 */
const EMPTY_MAX_WAIT = 2000
/** 贴底跟随的慢轮询周期。 */
const STICK_INTERVAL = 800
/** 我们自己写 scrollTop 后，多久内的 scroll 事件算「自己触发」。 */
const SELF_SCROLL_MS = 150

interface ScrollRecord {
  key: string
  scrollTop: number
  atBottom: boolean
}

let record: ScrollRecord | null = null
/** 已离开「对话」：冻结账本，防复位/回填把它冲掉。 */
let frozen = false
/** 离开过且还没恢复：conv-scroll 挂载时必须执行恢复。 */
let pendingRestore = false
/** 恢复进行中的目标容器（防重复启动）。 */
let pendingEl: HTMLElement | null = null
let restoreRaf = 0
let stick = false
let stickTimer = 0
let selfScrollUntil = 0
let installed = false

const diag = { baseline: 0, restoreStart: 0, restored: 0, discarded: 0, stuck: 0 }

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

/** 读当前激活的会话区 tab 文案（点按发生在 React 重绘前，拿到的是点击前状态）。 */
function readActiveTab(): string | undefined {
  const el = document.querySelector('[class*="tabActive"]')
  const text = el?.textContent?.trim()
  return text && TAB_LABELS.has(text) ? text : undefined
}

function atBottomOf(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_EPS
}

/** 记一笔账（frozen / 恢复进行中时拒绝回填）。 */
function onScroll(ev: Event): void {
  const el = ev.target
  if (!(el instanceof HTMLElement) || !el.matches(CONV_SCROLL)) return
  if (frozen || pendingEl) return
  record = { key: getCurrentSessionId(), scrollTop: el.scrollTop, atBottom: atBottomOf(el) }
  // 用户自己向上滚 = 退出贴底跟随（我们 pin 的写入在自我标记窗口内，不算）
  if (stick && !record.atBottom && performance.now() > selfScrollUntil) setStick(false)
}

/** 确认离开「对话」：冻结账本，等下次挂载恢复。 */
function leaveView(): void {
  if (pendingRestore) return
  frozen = true
  pendingRestore = true
}

function finishRestore(): void {
  if (restoreRaf) cancelAnimationFrame(restoreRaf)
  restoreRaf = 0
  pendingEl = null
  pendingRestore = false
  frozen = false
}

function applyRestore(el: HTMLElement, rec: ScrollRecord): void {
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  const target = rec.atBottom ? max : clamp(rec.scrollTop, 0, max)
  selfScrollUntil = performance.now() + SELF_SCROLL_MS
  el.scrollTop = target
  setStick(rec.atBottom)
  diag.restored++
  finishRestore()
}

/**
 * 启动一次恢复：rAF 等内容稳定后再落位。
 * 内容还是空的（消息在路上）时按 EMPTY_MAX_WAIT 等，避免「先落位、
 * 内容后到」——那正是原症状的复刻。
 */
function startRestore(el: HTMLElement): void {
  if (pendingEl) return
  const rec = record
  if (!rec) {
    finishRestore()
    return
  }
  const cur = getCurrentSessionId()
  // 空键领养：基线可能记在 Probe 上报会话 id 之前（key=''），
  // 恢复时补齐当前会话 id 即可；只有「两侧都是真实 id 且不同」才丢弃
  // （切了会话，不能把 A 的位置灌进 B）。
  if (rec.key && cur && rec.key !== cur) {
    diag.discarded++
    finishRestore()
    return
  }
  rec.key = cur || rec.key
  pendingEl = el
  diag.restoreStart++
  const t0 = performance.now()
  let last = -1
  let stable = 0
  const tick = () => {
    if (pendingEl !== el || !el.isConnected) {
      finishRestore()
      return
    }
    const h = el.scrollHeight
    stable = h === last ? stable + 1 : 0
    last = h
    const waited = performance.now() - t0
    const empty = el.clientHeight < 8 || h <= el.clientHeight + 4
    const ready = empty
      ? waited > EMPTY_MAX_WAIT
      : stable >= STABLE_FRAMES || waited > STABLE_MAX_WAIT
    if (ready) {
      applyRestore(el, rec)
      return
    }
    restoreRaf = requestAnimationFrame(tick)
  }
  restoreRaf = requestAnimationFrame(tick)
}

function pinBottom(): void {
  if (!stick) return
  const el = document.querySelector<HTMLElement>(CONV_SCROLL)
  if (!el || !el.isConnected) return
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  if (el.scrollTop >= max - 4) return
  if (performance.now() <= selfScrollUntil) return
  selfScrollUntil = performance.now() + SELF_SCROLL_MS
  el.scrollTop = max
  diag.stuck++
}

function setStick(on: boolean): void {
  if (stick === on) return
  stick = on
  if (on) {
    if (!stickTimer) stickTimer = window.setInterval(pinBottom, STICK_INTERVAL)
  } else if (stickTimer) {
    window.clearInterval(stickTimer)
    stickTimer = 0
  }
}

/** conv-scroll 挂载：有待恢复就恢复；否则（首次打开）补一条基线账。 */
function onMounted(el: HTMLElement): void {
  if (pendingRestore) {
    startRestore(el)
    return
  }
  if (record === null) {
    record = { key: getCurrentSessionId(), scrollTop: el.scrollTop, atBottom: atBottomOf(el) }
    diag.baseline++
  }
}

function containsConvScroll(node: Node): HTMLElement | null {
  if (!(node instanceof Element)) return null
  if (node.matches(CONV_SCROLL)) return node as HTMLElement
  return node.querySelector<HTMLElement>(CONV_SCROLL)
}

/**
 * 安装滚动位记忆（幂等）。由 client/src/index.ts 的 apply 调用一次。
 * @returns 卸载函数。
 */
export function installScrollMemory(): () => void {
  if (installed || typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {}
  }
  installed = true
  ;(window as any).__TS_SCROLL_MEMORY = diag

  // ① 记账：scroll 不冒泡，capture 全局捕获
  window.addEventListener('scroll', onScroll, true)

  // ② 离开/回来的主触发：会话区 tab 点按（capture 早于 React 重绘，
  //    readActiveTab 拿到的是点击前的激活 tab）
  const onClick = (ev: Event) => {
    const t = ev.target
    if (!(t instanceof Element)) return
    const btn = t.closest('button, [role="tab"], a')
    if (!btn) return
    const label = (btn.textContent || '').trim()
    if (!TAB_LABELS.has(label)) return
    const prev = readActiveTab()
    if (prev === '对话' && label !== '对话') {
      leaveView()
      return
    }
    if (prev !== undefined && prev !== '对话' && label === '对话' && pendingRestore) {
      // 容器若没被重建（原位换内容），点回来也要主动恢复一次
      const el = document.querySelector<HTMLElement>(CONV_SCROLL)
      if (el && !pendingEl) startRestore(el)
    }
  }
  document.addEventListener('click', onClick, true)

  // ③ 侧路触发：conv-scroll 整棵卸载 = 离开（会话切换/工作台收起对话等
  //    不经过 tab 点按的路径）；重新挂载 = 回来
  const mo = new MutationObserver((records) => {
    for (const rec of records) {
      for (const n of Array.from(rec.removedNodes)) {
        if (containsConvScroll(n)) leaveView()
      }
      for (const n of Array.from(rec.addedNodes)) {
        const el = containsConvScroll(n)
        if (el) onMounted(el)
      }
    }
  })
  mo.observe(document.documentElement, { childList: true, subtree: true })

  // ④ 基线：安装时已存在的容器（页面刚打开、从未滚动过）
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(CONV_SCROLL))) onMounted(el)

  return () => {
    installed = false
    mo.disconnect()
    window.removeEventListener('scroll', onScroll, true)
    document.removeEventListener('click', onClick, true)
    if (stickTimer) window.clearInterval(stickTimer)
    if (restoreRaf) cancelAnimationFrame(restoreRaf)
    stickTimer = 0
    restoreRaf = 0
    pendingEl = null
    record = null
    frozen = false
    pendingRestore = false
    stick = false
  }
}
