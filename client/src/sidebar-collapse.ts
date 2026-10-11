/**
 * 刷新后左侧边栏自动收起（Step 68）。
 *
 * 反馈原话：「当页面刷新之后，左侧边栏会展开，我希望保持左侧边栏是关闭的状态。」
 *
 * 根因（读宿主源码确认，非本插件所致）：
 *   侧边栏的宽/收起状态存在 dsh-client-ui-layout 的根 store ——
 *   createLayoutStore() 用 `defineStore({ init, actions })` 定义，**没有 persist 键**，
 *   而 dsh-client-store 只有声明了 persist 才会 attachPersistence（写 localStorage）。
 *   于是每次刷新 layoutInfo.sidebar 都回到初始 280（展开）；窄视口（<1024）
 *   才因 narrowExpanded=false 默认收起。宿主全链路没有其它地方持久化这个状态
 *   （已 grep 全部 client 包与前端产物的 localStorage 键），config-catalog 里
 *   ui-layout 也无对应配置项。
 *
 * 修法（用户选定「总是收起」）：插件加载时收一次 ——
 *   等 layout 服务就绪 → 判态 → 展开就 ctx.layout.toggleSidebar() 收掉。
 *   - **同一次页面加载只处理一次**（window.__tsSidebarCollapse 标记）：
 *     真刷新后标记消失 → 重新收起（正是要的语义）；HMR 热重应用时标记还在
 *     → 不重复收，绝不把你刚手动展开的又按回去。
 *   - 会话期间你手动展开不受影响（判完即停，不再监听 DOM）。
 *   - 窄视口不收：它默认就是收起态，若被某个宿主逻辑展开了（frame 已渲染
 *     而无收起属性）仍然会收，只有「帧还没渲染 + 窄视口」才跳过 ——
 *     那种情况下盲目 toggle 会把默认收起态反向展开。
 *
 * 状态判定走 DOM：宿主 LayoutController 只暴露 toggleSidebar()（无状态读取），
 * 而 AppFrame 只在收起时挂 `data-sidebar-collapsed` 属性。
 * 「帧已渲染」的旁证是同一元素上的 `data-rightbar-collapsed`（右栏隐藏时必在）
 * 或我们自己挂在 sidebar.footer.action 的 `.ts-side-entry`（宽/收起两态都渲染）。
 */
import { readService } from './session-subscribe'

/** 宿主 AppFrame 收起态属性（ui-layout 的 AppFrame：collapsed || void 0）。 */
export const SIDEBAR_COLLAPSED_SEL = '[data-sidebar-collapsed]'
/** 帧已渲染的旁证（二者任一在场即认为 AppFrame 已挂载）。 */
export const FRAME_PROOF_SEL = '[data-rightbar-collapsed], .ts-side-entry'
/**
 * 宽/窄视口分界（宿主 ui-layout 的 SIDEBAR_AUTO_COLLAPSE）。
 * 窄视口下 store 初始态是**收起**（narrowExpanded=false），与宽视口相反。
 */
export const NARROW_AUTO_COLLAPSE = 1024

export interface SidebarCollapseInput {
  /** 当前收起态：true=已收起 / false=已展开 / null=帧还没渲染、不知道 */
  collapsed: boolean | null
  innerWidth: number
}

export interface SidebarCollapseDecision {
  action: 'toggle' | 'skip'
  reason: string
}

/**
 * 纯决策：这一次要不要 toggle，为什么。
 *
 * 关键分野是 collapsed === null（帧未渲染）时按 **store 初始值**推断：
 * 宽视口初始 280（展开）→ 收；窄视口初始收起 → 不动（动了反而展开）。
 */
export function decideSidebarCollapse(input: SidebarCollapseInput): SidebarCollapseDecision {
  const { collapsed, innerWidth } = input
  if (collapsed === true) return { action: 'skip', reason: 'already-collapsed' }
  if (collapsed === false) return { action: 'toggle', reason: 'expanded' }
  if (innerWidth >= NARROW_AUTO_COLLAPSE) return { action: 'toggle', reason: 'boot-default-expanded' }
  return { action: 'skip', reason: 'narrow-default-collapsed' }
}

/**
 * 读当前收起态。收起属性在 → true；帧已渲染但无该属性 → false；帧未渲染/异常 → null。
 * 只读不写，可传入任意带 querySelector 的根（测试注入假 DOM）。
 */
export function readSidebarCollapsed(
  root: { querySelector(sel: string): unknown } = document,
): boolean | null {
  try {
    if (root.querySelector(SIDEBAR_COLLAPSED_SEL)) return true
    if (root.querySelector(FRAME_PROOF_SEL)) return false
    return null
  } catch {
    return null
  }
}

/** 同一次页面加载的处理标记（挂 window，真刷新消失、HMR 重应用保留）。 */
export interface SidebarCollapseMarker {
  at: number
  handled: boolean
  action: 'pending' | 'toggle' | 'skip'
  reason: string
  /** 判定时读到的收起态（null = 帧未渲染） */
  collapsed: boolean | null
  /** toggle 后校验收起属性是否落位；未 toggle 为 null */
  verified: boolean | null
}

const MARKER_KEY = '__tsSidebarCollapse'
/** 服务未就绪时的轮询间隔 / 上限（5s）。 */
const POLL_MS = 100
const MAX_POLLS = 50
/** toggle 后校验属性落位的轮询上限（3s）。 */
const VERIFY_TRIES = 30

/** toggle 后轮询确认收起属性真的落位（诊断用，失败只 warn、绝不重试去按你手动的展开）。 */
function verifyCollapsed(marker: SidebarCollapseMarker): void {
  let tries = 0
  const tick = () => {
    const now = readSidebarCollapsed()
    if (now === true) {
      marker.verified = true
      return
    }
    // null（帧还没渲染）与 false 都继续等：属性随 React 重渲染落位需要一拍
    if (++tries >= VERIFY_TRIES) {
      marker.verified = false
      console.warn(
        '[sidebar-collapse] 收起后 3s 内未观察到 data-sidebar-collapsed' +
          '（可能宿主渲染未跟上，或被其它逻辑重新展开）',
      )
      return
    }
    window.setTimeout(tick, POLL_MS)
  }
  window.setTimeout(tick, POLL_MS)
}

/**
 * 刷新后把左侧边栏收起一次。幂等：同一次页面加载（含 HMR 重应用）只生效一次。
 *
 * 服务未就绪时走 ctx.inject + 100ms 轮询兜底（与 wrapSessionNavigation 同款口径），
 * 5s 仍不就绪则放弃并留 warn（不阻断插件其它功能）。
 */
export function installSidebarCollapse(ctx: any): void {
  if (typeof window === 'undefined') return
  const w = window as any
  const marker: SidebarCollapseMarker = w[MARKER_KEY] ??
    (w[MARKER_KEY] = {
      at: Date.now(),
      handled: false,
      action: 'pending',
      reason: '',
      collapsed: null,
      verified: null,
    })
  // 已处理过（本页刷新前的 apply 或 HMR 重应用）→ 直接返回：
  // 不重复 toggle，也就不会把你这次会话手动展开的又收掉
  if (marker.handled) return

  const run = (): boolean => {
    if (marker.handled) return true
    const layout = readService<any>(ctx, 'layout')
    if (!layout || typeof layout.toggleSidebar !== 'function') return false
    marker.handled = true
    const collapsed = readSidebarCollapsed()
    const { action, reason } = decideSidebarCollapse({
      collapsed,
      innerWidth: window.innerWidth,
    })
    marker.collapsed = collapsed
    marker.action = action
    marker.reason = reason
    if (action === 'toggle') {
      try {
        layout.toggleSidebar()
        verifyCollapsed(marker)
      } catch (e) {
        console.warn('[sidebar-collapse] toggleSidebar 失败', e)
      }
    }
    return true
  }

  if (run()) return
  try {
    ctx?.inject?.(['layout'], () => {
      run()
    })
  } catch (e) {
    console.warn('[sidebar-collapse] 等待 layout 服务失败（转轮询）', e)
  }
  let polls = 0
  const timer = window.setInterval(() => {
    polls++
    if (run() || polls >= MAX_POLLS) {
      window.clearInterval(timer)
      if (!marker.handled) {
        console.warn('[sidebar-collapse] 等待 layout 服务超时（5s），本次未收起侧边栏')
      }
    }
  }, POLL_MS)
}
