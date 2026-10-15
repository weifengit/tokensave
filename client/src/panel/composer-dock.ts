/**
 * 宿主原生输入条停靠（Step 13 · 最终形态：停靠进 dockview 的「DSH 主对话」面板）。
 *
 * 背景：DSH 的原生输入条（`[data-conversation-region="composer"]`，conversation.composer
 * 常驻座位）默认渲染在会话页面的中下位置。工作台希望它出现在「DSH 主对话」面板内部，
 * 于是把它 `position:fixed` 停靠到该面板的矩形里（向下锚定、内容向上生长），
 * **组件卸载即还原原始行内样式**，宿主在其它 tab 的行为原样恢复。
 *
 * 历史：本实现原在 HDesk.tsx 内（旧 H 型网格时代）。HDesk 已删除（Step 13-D），
 * 此处按原样迁移并与 dockview 面板容器适配。
 *
 * 与 dockview 的配合：面板拖拽/缩放时容器矩形连续变化，靠 ResizeObserver（容器）
 * + resize/scroll 监听 + 300ms 轮询兜底跟随；`deps` 由调用方传入（如布局变化计数），
 * 变化即重算。
 */
import { useLayoutEffect } from 'react'

/** 宿主原生输入条选择器（conversation.composer 常驻座位）。 */
export const COMPOSER_SEAT = '[data-conversation-region="composer"]'

/**
 * 把宿主原生输入条停靠进给定容器（工作台的「DSH 主对话」面板）。
 *
 * @param ref - 停靠目标容器（内容内缩由它的 border/padding 决定）
 * @param enabled - false 时立即把输入条交还宿主（还原原始行内样式）
 * @param aboveOverlay - true 时 z-index 抬到 42（用于停靠目标位于浮层内的情况）
 * @param deps - 额外依赖：变化即重新计算停靠位置（如面板显隐/尺寸变化计数）
 */
export function useDockNativeComposer(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  aboveOverlay: boolean,
  deps: unknown[],
): void {
  useLayoutEffect(() => {
    const cell = ref.current
    if (!cell || typeof document === 'undefined') return
    const seat = document.querySelector<HTMLElement>(COMPOSER_SEAT)
    if (!seat) return
    // background / backgroundImage 也要接管：宿主的 composerSeat 自带一条
    // 「透明 → 背景色」的渐变遮罩（linear-gradient(transparent 0, rgb(21,21,23) 36px)），
    // 作用是让滚到输入条上沿的消息被淡出。停靠后它跟着输入条一起被搬进工作台，
    // 就在聊天区下方留下一块**黑色覆盖**（用户反馈）。这里清掉它，
    // 改由停靠容器底部的 .ts-dock-fade 提供同样的「滚到底看不见底下」效果。
    const KEYS = [
      'position',
      'left',
      'right',
      'top',
      'bottom',
      'width',
      'zIndex',
      'background',
      'backgroundImage',
    ] as const
    const saved: Record<string, string> = {}

    // 主对话面板收起/关闭时不再停靠：让输入条回到宿主的原位置（避免悬在空格里）
    if (!enabled) {
      for (const k of KEYS) (seat.style as any)[k] = saved[k]
      cell.style.removeProperty('--ts-chat-content-w')
      return
    }
    // 停靠前先记下原值（只记一次，避免把已停靠的值当成原值）
    for (const k of KEYS) saved[k] = (seat.style as any)[k]

    // 输入条会遮住消息末尾：量出它的高度写回 CSS 变量，
    // 让消息流底部预留同样高度的留白（跟随多行输入动态变化）。
    const root = document.documentElement

    /**
     * 取一个「可用矩形」。
     *
     * 为什么需要：主对话是**后台标签**（被同组别的窗口挡在后面）或面板暂时隐藏时，
     * 内容格的 rect 是 0×0 —— 原来这里直接 return，输入条就一直留在宿主原位置
     * （工作台把它盖住了），用户看到的就是「DSH 主对话里没有输入框」（info_report /
     * compare-text 反馈两次）。现在退化到**最近的可见祖先**（dockview 的组容器），
     * 输入条照样停靠在那块可见区域里。
     */
    const pickRect = (): DOMRect | null => {
      const own = cell.getBoundingClientRect()
      if (own.width > 0 && own.height > 0) return own
      for (let node = cell.parentElement, i = 0; node && i < 6; node = node.parentElement, i++) {
        const r = node.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) return r
      }
      return null
    }

    let raf = 0
    const apply = () => {
      raf = 0
      try {
        const r = pickRect()
        if (!r) return
        // 容器内缩：border + padding，让输入条落在容器边框内部
        const cs = getComputedStyle(cell)
        const insetX = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0)
        const insetY = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0)
        // 输入条宽度：**只受本面板约束**（与消息流同口径）。
        // 不再取宿主的 `--dsh-chat-user-width`（带 680px 下限）：面板变窄时
        // 那个值不会跟着变小，输入条会宽出面板、右侧被截。
        const avail = Math.max(0, r.width - insetX * 2)
        const contentW = avail
        if (cell.style.getPropertyValue('--ts-chat-content-w') !== `${Math.round(contentW)}px`) {
          cell.style.setProperty('--ts-chat-content-w', `${Math.round(contentW)}px`)
        }
        seat.style.position = 'fixed'
        seat.style.left = `${Math.round(r.left + insetX + (avail - contentW) / 2)}px`
        seat.style.right = 'auto'
        seat.style.width = `${Math.round(contentW)}px`
        seat.style.top = 'auto'
        // 向下锚定：聚焦/多行输入时向上生长，不挤动面板布局
        // 悬浮状态栏压在页面底部：只有当本面板的底边真的伸到状态栏底下时才把它让开
        // （无条件加高度会在面板本来就没到底的情况下，把输入条从自己面板底部顶起来）。
        const sbH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ts-sb-h')) || 28
        const overlap = Math.max(0, r.bottom - (window.innerHeight - sbH))
        seat.style.bottom = `${Math.round(window.innerHeight - r.bottom + insetY + overlap)}px`
        // 层级：浮层里停靠时要压过面板浮层；普通面板内 35 就够
        seat.style.zIndex = aboveOverlay ? '42' : '35'
        // 清掉宿主那条渐变遮罩（它按「停靠前的位置」算高度，搬进来就是一块黑）
        seat.style.backgroundImage = 'none'
        // 座位保持透明：宿主自己的输入卡片是不透明的（自带底色与字色），
        // 我们再垫一层只会把皮肤盖掉（用户反馈：输入框往下整块发白）。
        seat.style.background = 'transparent'
        // 输入条实际高度（含边框）→ 消息流底部留白，末尾几行不被遮挡
        const seatH = Math.ceil(seat.getBoundingClientRect().height) || 0
        const seatPx = `${seatH}px`
        if (seatH > 0 && root.style.getPropertyValue('--ts-composer-h') !== seatPx) {
          root.style.setProperty('--ts-composer-h', seatPx)
        }
      } catch {
        /* 视图切换竞态：下一次调度再试 */
      }
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply)
    }

    apply()
    const ro = new ResizeObserver(schedule)
    ro.observe(cell)
    window.addEventListener('resize', schedule)
    // scroll 不冒泡，capture 可捕获所有滚动容器（工作台内部/宿主滚动）
    window.addEventListener('scroll', schedule, true)
    // 兜底：未触发 ResizeObserver 的宿主布局变化（含 tab 切换、面板拖拽动画）
    const timer = window.setInterval(schedule, 300)
    // 宿主拖拽只改祖先元素上的 CSS 变量（不触发 cell 尺寸变化），因此额外盯一段
    // 祖先链的 style 变化，拖拽过程中主对话内容能即时跟随，而不是等 300ms 轮询。
    const watched: Element[] = []
    for (let node = cell.parentElement, i = 0; node && i < 10; node = node.parentElement, i++) {
      watched.push(node)
    }
    const mo = new MutationObserver(schedule)
    for (const el of watched) mo.observe(el, { attributes: true, attributeFilter: ['style'] })

    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.clearInterval(timer)
      if (raf) cancelAnimationFrame(raf)
      for (const k of KEYS) (seat.style as any)[k] = saved[k]
      document.documentElement.style.removeProperty('--ts-composer-h')
      cell.style.removeProperty('--ts-chat-content-w')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])
}
