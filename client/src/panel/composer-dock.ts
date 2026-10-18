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
 *
 * 两个跟随性 bug 的修复（2026-10-18）：
 *  1. **输入条不随面板隐藏/被覆盖而隐藏**（用户反馈：多窗口叠放时输入条一直浮在最上）。
 *     根因：座位是 fixed 在视口层（z-index 35），不在面板 DOM 里——dockview 用行内
 *     `visibility:hidden` 藏非活动面板、最大化浮层盖住主对话时，座位都不受影响，
 *     于是永远浮在所有窗口之上。修法：apply 里做两道判定——
 *     `cellShown`（沿祖先链查 visibility/display，hidden/none 即藏）与
 *     `cellFront`（在停靠点做 elementFromPoint 命中测试，命中点不在 cell 内即藏），
 *     任一不满足就把座位 `visibility:hidden`，满足即恢复——输入条的显隐从此与
 *     面板的显隐/层叠一致，而不是独立于面板常显。
 *  2. **面板被拖到新位置后输入条留在旧坐标**（偶现）。根因：dockview 拖拽/重排是
 *     **命令式重挂 DOM**（不经过 React 重渲染），effect 闭包里的 `cell`（ref 快照）
 *     指向被摘除的旧节点——旧节点 rect 冻结，pickRect 一路退化返回 null 或旧值，
 *     apply 就把座位钉在旧坐标。修法：`resolveCell` 每次 apply 先验 `isConnected`，
 *     ref 失效时按调用方给的 `cellSelector` 回查活节点，并把观察器重挂到新节点上。
 */
import { useLayoutEffect } from 'react'

/** 宿主原生输入条选择器（conversation.composer 常驻座位）。 */
export const COMPOSER_SEAT = '[data-conversation-region="composer"]'
/**
 * 停靠前的原始行内样式缓存（按座位元素记一份）。
 *
 * 为什么必须模块级：useLayoutEffect 的每次重跑都拿不到上一次闭包里的 saved，
 * 而 enabled=true→false 恰恰是**另一次**重跑 —— 局部变量这时还没填过，
 * 写回 undefined 对 CSSStyleDeclaration 等于没写，输入条就带着 position:fixed 留在原地。
 */
const PRE_DOCK_STYLES = new WeakMap<HTMLElement, Record<string, string>>()

/**
 * 把宿主原生输入条停靠进给定容器（工作台的「DSH 主对话」面板）。
 *
 * @param ref - 停靠目标容器（内容内缩由它的 border/padding 决定）
 * @param enabled - false 时立即把输入条交还宿主（还原原始行内样式）
 * @param aboveOverlay - true 时 z-index 抬到 42（用于停靠目标位于浮层内的情况）
 * @param deps - 额外依赖：变化即重新计算停靠位置（如面板显隐/尺寸变化计数）
 * @param cellSelector - 活节点回查选择器：dockview 命令式重挂面板后 ref 可能指向
 *   已摘除的旧节点（rect 冻结在旧坐标），此时按它回查真正在文档里的容器
 */
export function useDockNativeComposer(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  aboveOverlay: boolean,
  deps: unknown[],
  cellSelector?: string,
): void {
  useLayoutEffect(() => {
    const seedCell = ref.current
    if (!seedCell || typeof document === 'undefined') return
    const seat = document.querySelector<HTMLElement>(COMPOSER_SEAT)
    if (!seat) return
    // background / backgroundImage 也要接管：宿主的 composerSeat 自带一条
    // 「透明 → 背景色」的渐变遮罩（linear-gradient(transparent 0, rgb(21,21,23) 36px)），
    // 作用是让滚到输入条上沿的消息被淡出。停靠后它跟着输入条一起被搬进工作台，
    // 就在聊天区下方留下一块**黑色覆盖**（用户反馈）。这里清掉它。
    // （原先为它准备的那条 .ts-dock-fade 替代遮罩也已删除：消息流自带 padding-bottom，
    //   内容不会滑到输入条底下，那条遮罩只会把聊天区下方糊出一块渐变深色。）
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
      'visibility',
    ] as const
    /** 停靠前的原始行內样式：**模块级**缓（不随 effect 重跑丢失，否则 enabled→false 时根本读不到原值）。 */
    let saved = PRE_DOCK_STYLES.get(seat)

    const restore = () => {
      for (const k of KEYS) {
        const v = saved?.[k]
        if (v !== undefined && v !== '') (seat.style as any)[k] = v
        else (seat.style as any)[k] = ''
      }
    }

    // 主对话面板收起/关闭时不再停靠：让输入条回到宿主的原位置（避免悬在空格里）
    if (!enabled) {
      // 交还给宿主：优先恢复**停靠前真实值**；没抓过说明本次根本没停靠，
      // 清掉我们可能写过的那几项（空字符串 = 移除行内值，回落到宿主样式表）。
      restore()
      PRE_DOCK_STYLES.delete(seat)
      seedCell.style.removeProperty('--ts-chat-content-w')
      return
    }
    // 停靠前先记下原值（只记一次，避免把已停靠的值当成原值）
    if (!saved) {
      saved = {}
      for (const k of KEYS) saved[k] = (seat.style as any)[k]
      PRE_DOCK_STYLES.set(seat, saved)
    }

    // 输入条会遮住消息末尾：量出它的高度写回 CSS 变量，
    // 让消息流底部预留同样高度的留白（跟随多行输入动态变化）。
    const root = document.documentElement

    /**
     * 停靠容器的**候选集**。
     *
     * dockview 的拖拽/重排/最大化是命令式重挂 DOM（不触发 React 重渲染）：
     * ref 快照可能指向被摘除的旧节点（rect 冻结在旧坐标，输入条留在搬家前的位置
     * ——用户反馈的偶现 bug）；而工作台里同 id 的 chatcell 也可能有多份副本
     * （面板被 maximizeGroup 提升进 .dv-render-overlay 时，原容器留一份隐藏的）。
     * 所以不能只认一个节点：把 ref 活节点与选择器命中的全部活节点都列为候选，
     * apply 里逐个过「可见 + 在最前层」两道门，选第一个全过的停靠；全不过则藏。
     */
    const candidates = (): HTMLElement[] => {
      const out: HTMLElement[] = []
      const c = ref.current
      if (c && c.isConnected) out.push(c)
      if (cellSelector) {
        for (const q of document.querySelectorAll<HTMLElement>(cellSelector)) {
          if (q.isConnected && !out.includes(q)) out.push(q)
        }
      }
      return out
    }

    /**
     * 取一个「可用矩形」。
     *
     * 为什么需要：主对话是**后台标签**（被同组别的窗口挡在后面）或面板暂时隐藏时，
     * 内容格的 rect 是 0×0 —— 原来这里直接 return，输入条就一直留在宿主原位置
     * （工作台把它盖住了），用户看到的就是「DSH 主对话里没有输入框」（info_report /
     * compare-text 反馈两次）。现在退化到**最近的可见祖先**（dockview 的组容器），
     * 输入条照样停靠在那块可见区域里。
     */
    const pickRect = (cell: HTMLElement): DOMRect | null => {
      const own = cell.getBoundingClientRect()
      if (own.width > 0 && own.height > 0) return own
      // 退化到最近的可见祖先，但**只认工作台内部的祖先**（含 .ts-dock 或它自己）：
      // 不加这个守卫时，dockview 把 cell 摘出去的瞬间会锚到一个无关盒子上，
      // 输入条被停到错误位置（甚至停在屏外）。
      for (let node = cell.parentElement, i = 0; node && i < 6; node = node.parentElement, i++) {
        if (!node.closest?.('.ts-dock')) continue
        const r = node.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) return r
      }
      return null
    }

    /**
     * 容器是否真的可见。dockview 藏非活动面板用行内 `visibility:hidden`（可继承），
     * 区域收起用 display:none —— 两者都查祖先链，任一命中即「不该显示输入条」。
     */
    const cellShown = (cell: HTMLElement): boolean => {
      for (let n: HTMLElement | null = cell; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n)
        if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false
        if (cs.display === 'none') return false
      }
      return true
    }

    /**
     * 容器在停靠点是否处于**最前层**。fixed 座位的 z-index 高于工作台内一切浮层，
     * 不做这道判定，最大化浮层/叠放窗口盖住主对话时输入条仍浮在最上（用户反馈）。
     * 命中测试前先把座位自己藏起来（同步块内完成，不产生中间帧），命中点必须落在
     * cell 内部才算「主对话真的露在最前」。
     */
    const cellFront = (cell: HTMLElement, r: DOMRect): boolean => {
      const x = Math.round(r.left + r.width / 2)
      const y = Math.round(r.bottom - 24)
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false
      const prev = seat.style.visibility
      seat.style.visibility = 'hidden'
      let hit: Element | null = null
      try {
        hit = document.elementFromPoint(x, y)
      } catch {
        hit = null
      }
      seat.style.visibility = prev
      return !!hit && cell.contains(hit)
    }

    let raf = 0
    let ro: ResizeObserver | null = null
    let mo: MutationObserver | null = null
    let observed: HTMLElement | null = null

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply)
    }

    /** 观察器挂到活节点上（cell 身份变化时重挂）。 */
    const attach = (cell: HTMLElement) => {
      ro?.disconnect()
      mo?.disconnect()
      ro = new ResizeObserver(schedule)
      ro.observe(cell)
      // 宿主拖拽只改祖先元素上的 CSS 变量（不触发 cell 尺寸变化），因此额外盯一段
      // 祖先链的 style 变化，拖拽过程中主对话内容能即时跟随，而不是等 300ms 轮询。
      mo = new MutationObserver(schedule)
      for (let node = cell.parentElement, i = 0; node && i < 10; node = node.parentElement, i++) {
        mo.observe(node, { attributes: true, attributeFilter: ['style'] })
      }
      observed = cell
    }

    const apply = () => {
      raf = 0
      try {
        // 候选集：ref 活节点 + 选择器命中的全部活节点（面板被 dockview 重挂/
        // 提升进 overlay 后，活的那份可能不是 ref 拿到的那份）。
        const cands = candidates()
        if (cands.length === 0) {
          // 容器都不在文档里（工作台拆除中/面板被摘）：藏掉输入条，等下次调度再试
          seat.style.visibility = 'hidden'
          return
        }
        // 逐个过「可见 + 在最前层」两道门，选第一个全过的停靠；全不过则藏。
        let target: { cell: HTMLElement, r: DOMRect } | null = null
        for (const cell of cands) {
          if (!cellShown(cell)) continue
          const r = pickRect(cell)
          if (!r || !cellFront(cell, r)) continue
          target = { cell, r }
          break
        }
        if (!target) {
          // 面板隐藏（后台标签/区域收起）或被别的窗口盖住：输入条跟着藏，
          // 不再以 fixed 高层级浮在所有窗口之上
          seat.style.visibility = 'hidden'
          return
        }
        const { cell, r } = target
        if (cell !== observed) attach(cell)
        seat.style.visibility = ''
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
        // 状态栏现在是**真实网格行**（不再浮在内容之上），三区底边天然落在它上方，
        // 所以这里不需要再为它让位：把输入条底边对齐到面板底边即可。
        seat.style.bottom = `${Math.round(window.innerHeight - r.bottom + insetY)}px`
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

    apply()
    window.addEventListener('resize', schedule)
    // scroll 不冒泡，capture 可捕获所有滚动容器（工作台内部/宿主滚动）
    window.addEventListener('scroll', schedule, true)
    // 兜底：未触发 ResizeObserver 的宿主布局变化（含 tab 切换、面板拖拽动画）
    const timer = window.setInterval(schedule, 300)

    return () => {
      ro?.disconnect()
      mo?.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.clearInterval(timer)
      if (raf) cancelAnimationFrame(raf)
      restore()
      PRE_DOCK_STYLES.delete(seat)
      document.documentElement.style.removeProperty('--ts-composer-h')
      seedCell.style.removeProperty('--ts-chat-content-w')
      // 面板若被重挂过，写宽度变量的是活节点（observed），不只 seedCell——两边都清
      if (observed && observed !== seedCell) observed.style.removeProperty('--ts-chat-content-w')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])
}
