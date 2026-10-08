/**
 * 侧边栏「项目中心」入口（sidebar.footer.action 槽）
 *
 * 为什么放在侧边栏：用户要求「项目中心这个按钮请直接放在左侧边栏区域」。
 *
 * 关键约束（读宿主 ui-sidebar 的槽契约得出）：
 *   - `sidebar.footer.action` 是 **root 作用域**的 list 槽 → 拿不到 sessionId
 *     （sessionId 由宿主动态注入 conversation.* 槽）；
 *   - 因此当前会话 id 由 Probe（挂在会话头部、始终挂载）经
 *     `setCurrentSessionId` 写到 sessions.ts 的模块级变量，这里读它。
 *
 * 行为：**切换**语义（用户要求保留），两个方向都走 openControlRoom：
 *   - 当前在「项目中心」（项目列表）→ 点一下回「工作台」；
 *   - 当前在「工作台」→ 点一下回「项目中心」。
 * 当前在哪一屏由 getControlRoomScreen() 给出：ControlRoom（工作台）上报 'desk'，
 * ProjectCenter（项目列表）上报 'list'。
 *
 * 视觉沿用侧边栏底部的紧凑样式：wide 时「图标 + 文字」，rail 时只有图标。
 *
 * 呼吸灯（用户要求）：入口右侧（wide）/ 顶替图标（rail）显示存活指示小圆点——
 *   - 任何已登记项目下有对话存活（跑 / 待确认 / 上一轮没正常结束）才显示；
 *     全部完成时**不显示**，rail 回落成原来的图标；
 *   - 绿 = 正常使用；黄 = 弹选择框 / 被故障中断（黄覆盖绿）；
 *   - 有对话正在跑 → 依次闪烁（跑马灯）；只有待处理时 → 同相呼吸。
 *   状态来源见 pulse.ts（含成本说明）。
 */
import React, { useEffect, useRef, useState } from 'react'
import { openControlRoom, getLiveScreen, onRequestProjectList, onRequestWorkbench } from './sessions'
import { useActivityPulse } from './pulse'

/** 圆点数量（用户要求 3 个）。 */
const DOT_COUNT = 3
/** 收起态按钮宽度低于该值时，3 个点确实挤不下 → 降为 2 个（展开态沿用同一数量，保持一致）。 */
const RAIL_MIN_WIDE = 30
/**
 * 点击后的“导航在途”窗口：宿主切 tab 是异步的，这段时间内忽略重复点击。
 * 与 sessions.ts 的 NAV_SETTLE_MS 同量级（略短），避免两个窗口错位。
 */
const NAV_LOCK_MS = 700

/** 存活指示：3 个（或 2 个）小圆点。running 时依次闪烁（跑马灯），否则同相呼吸。 */
function PulseDots({ tone, running, count }: { tone: 'ok' | 'warn'; running: boolean; count: number }) {
  return (
    <span
      className={`ts-pulse${running ? ' ts-pulse-run' : ''}${tone === 'warn' ? ' ts-pulse-warn' : ''}`}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className="ts-pulse-dot" style={{ animationDelay: `${i * 0.16}s` }} />
      ))}
    </span>
  )
}

export function ControlRoomEntry({ wide }: { wide?: boolean }) {
  // 标题随当前屏变化：在工作台时提示“回项目列表”，在列表时提示“回工作台”，
  // 让“再点一次能回去”这件事在 UI 上自解释。
  const [screen, setScreen] = useState<'list' | 'desk'>(() => getLiveScreen())
  useEffect(() => {
    const sync = () => setScreen(getLiveScreen())
    sync()
    const offList = onRequestProjectList(sync)
    const offDesk = onRequestWorkbench(sync)
    return () => { offList(); offDesk() }
  }, [])

  // 呼吸灯状态（存活对话数 / 是否需要提醒 / 是否正在跑）
  const pulse = useActivityPulse()
  const alive = pulse.alive > 0
  // 导航在途标记：宿主切 tab 是异步的，期间把重复点击当作同一意图的重复表达。
  const navigatingRef = useRef(false)
  const tone: 'ok' | 'warn' = pulse.warn > 0 ? 'warn' : 'ok'
  const running = pulse.running > 0

  // 圆点数量：量一下按钮宽度，收起态太窄就用 2 个（展开态沿用同一数量）
  const btnRef = useRef<HTMLButtonElement>(null)
  const [dotCount, setDotCount] = useState(DOT_COUNT)
  useEffect(() => {
    const el = btnRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      if (w > 0) setDotCount(w < RAIL_MIN_WIDE ? 2 : DOT_COUNT)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const toDesk = screen === 'list'
  const head = toDesk ? '项目中心：回到工作台' : '项目中心：查看项目列表'
  const title = `${head}（再点一次可在两者间切换）${alive ? `\n\n${pulse.tip}` : ''}`
  return (
    <button
      ref={btnRef}
      type="button"
      className={`ts-side-entry${wide ? '' : ' rail'}`}
      title={title}
      aria-label={title}
      onClick={() => {
        // 连点防抖：导航在途（tab 尚未落定）时忽略后续点击。
        // 否则第二次点击会在“旧屏幕”上算出反方向，把刚切过去的界面又拨回来。
        if (navigatingRef.current) return
        navigatingRef.current = true
        window.setTimeout(() => { navigatingRef.current = false }, NAV_LOCK_MS)
        // 意图即真值：点击瞬间就定住目标屏，按钮文案不再闪动（不等宿主回流）。
        const target: 'list' | 'desk' = screen === 'list' ? 'desk' : 'list'
        setScreen(target)
        try {
          if (!openControlRoom()) {
            console.warn('[tokensave] 项目中心：没有可导航的会话，且没有已登记项目')
          }
        } catch (e) {
          console.warn('[tokensave] 项目中心入口导航失败', e)
        }
        // 宿主 tab 可能晚一拍才切过去，稍后再对一次账
        window.setTimeout(() => setScreen(getLiveScreen()), NAV_LOCK_MS)
      }}
    >
      {/* 收起态有存活对话时：圆点**顶替**图标；否则照旧显示图标（用户要求） */}
      {(!alive || wide) && <span className="ts-side-icon" aria-hidden="true">{toDesk ? '🧭' : '🗂️'}</span>}
      {wide && <span className="ts-side-label">{toDesk ? '回到工作台' : '项目中心'}</span>}
      {alive && <PulseDots tone={tone} running={running} count={dotCount} />}
    </button>
  )
}
