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
 *
 * 黄灯角标（2026-10-09，用户反馈「黄色时找不到中断的任务」）：
 *   `warn > 0` 时圆点旁挂一枚黄色计数角标，点它弹出「需要处理的对话」清单，
 *   点条目直达那条对话的工作台（enterProjectWorkbench，与项目中心序号点同入口）。
 *   浮层 portal 到 body + position:fixed → rail（56px 收起态）与展开态都从按钮
 *   右缘飞出，不受侧边栏宽度 / overflow 裁剪影响（Step 24 下拉被裁的教训）。
 *   主按钮的「切换」语义不受影响：点角标 stopPropagation，其余区域照旧切换。
 */
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  enterProjectWorkbench, getLiveScreen, onRequestProjectList, onRequestWorkbench, openControlRoom,
} from './sessions'
import { useActivityPulse } from './pulse'
import type { WarnItem } from './pulse'

/** 圆点数量（用户要求 3 个）。 */
const DOT_COUNT = 3
/** 收起态按钮宽度低于该值时，3 个点确实挤不下 → 降为 2 个（展开态沿用同一数量，保持一致）。 */
const RAIL_MIN_WIDE = 30
/**
 * 点击后的“导航在途”窗口：宿主切 tab 是异步的，这段时间内忽略重复点击。
 * 与 sessions.ts 的 NAV_SETTLE_MS 同量级（略短），避免两个窗口错位。
 */
const NAV_LOCK_MS = 700
/** 清单浮层宽高预算（clamp 定位时用）。 */
const POP_W = 300
const POP_H = 220

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

/**
 * 黄灯角标点开的「需要处理的对话」清单。
 *
 * portal 到 body、position:fixed（坐标由打开方按按钮矩形算好传入）：
 * 收起（rail 56px）与展开两种状态下都是从按钮右缘向右飞出，不被侧边栏裁剪。
 */
function WarnPopover({
  pos, items, onClose,
}: { pos: { top?: number; bottom?: number; left: number }; items: WarnItem[]; onClose: () => void }) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      // 点在清单里 / 角标上：交给各自处理（角标自己负责开合）
      if (t?.closest('.ts-warn-pop') || t?.closest('.ts-warn-badge')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const pick = (it: WarnItem) => {
    try {
      if (!enterProjectWorkbench(it.projectId, it.sessionId)) {
        console.warn('[tokensave] 定位对话：没有可导航的目标', it)
      }
    } catch (e) {
      console.warn('[tokensave] 定位对话失败', e)
    }
    onClose()
  }

  return createPortal(
    <div
      className="ts-warn-pop"
      role="dialog"
      aria-label="需要处理的对话"
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
    >
      <div className="ts-warn-pop-head">需要处理的对话（{items.length}）</div>
      <div className="ts-warn-pop-list">
        {items.map((it) => (
          <button
            key={`${it.kind}:${it.sessionId}`}
            type="button"
            className="ts-warn-item"
            title={`打开「${it.title || '未命名对话'}」的工作台，直达这条对话`}
            onClick={() => pick(it)}
          >
            <span className="ts-warn-icon" aria-hidden="true">{it.kind === 'pending' ? '⏳' : '⚠️'}</span>
            <span className="ts-warn-body">
              <span className="ts-warn-title">{it.title || '（未命名对话）'}</span>
              <span className="ts-warn-sub">
                {it.project || '未知项目'} · {it.kind === 'pending' ? '待你确认' : '上一轮未正常结束'}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="ts-warn-pop-foot">点条目直达那条对话的工作台 · Esc 关闭</div>
    </div>,
    document.body,
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

  // —— 黄灯清单（角标 → 浮层）——
  const [pop, setPop] = useState<{ top?: number; bottom?: number; left: number } | null>(null)
  // 需要处理的对话都没了（处理完 / 被复核清掉）→ 自动收起
  useEffect(() => {
    if (pop && pulse.warn <= 0) setPop(null)
  }, [pop, pulse.warn])

  /**
   * 开/关清单：贴着按钮定位（rail 与展开态同一套算法）。
   *   横向：按钮右缘 + 8px（向右飞出，侧边栏再窄也不裁），越界朝窗口内收；
   *   纵向：默认贴按钮下方；下方放不下就改用 bottom 锚到按钮上方（贴住，不留缝）。
   */
  const togglePop = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    if (pop) {
      setPop(null)
      return
    }
    const r = btnRef.current?.getBoundingClientRect()
    if (!r || (r.width === 0 && r.height === 0)) return
    const left = Math.max(8, Math.min(r.right + 8, window.innerWidth - POP_W - 12))
    const below = r.bottom + 6 + 140 <= window.innerHeight - 8
    const above = r.top - 6 >= 140 + 8
    const pos = below
      ? { top: r.bottom + 6, left }
      : above
        ? { bottom: window.innerHeight - r.top + 6, left }
        : { top: Math.max(8, Math.min(r.top, window.innerHeight - POP_H - 12)), left }
    setPop(pos)
  }

  const toDesk = screen === 'list'
  const head = toDesk ? '项目中心：回到工作台' : '项目中心：查看项目列表'
  const title = `${head}（再点一次可在两者间切换）${alive ? `\n\n${pulse.tip}` : ''}`
  // rail 里角标要与圆点同排（36px 挤）：有角标时圆点最多留 2 个
  const dots = !wide && pulse.warn > 0 ? Math.min(dotCount, 2) : dotCount
  return (
    <>
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
        {alive && (
          <span className={`ts-side-right${wide ? '' : ' rail'}`}>
            {/* 黄灯角标：点它=看清单并跳转（stopPropagation，不触发布局切换） */}
            {pulse.warn > 0 && (
              <span
                className="ts-warn-badge"
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={pop != null}
                title={`需要处理的对话（${pulse.warn}）：点击查看清单，点条目直达那条对话\n\n${pulse.tip}`}
                onClick={togglePop}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    togglePop(e)
                  }
                }}
              >
                {pulse.warn}
              </span>
            )}
            <PulseDots tone={tone} running={running} count={dots} />
          </span>
        )}
      </button>
      {pop && <WarnPopover pos={pop} items={pulse.items} onClose={() => setPop(null)} />}
    </>
  )
}
