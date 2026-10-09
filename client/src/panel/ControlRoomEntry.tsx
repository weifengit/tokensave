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
 *   - 任何已登记项目下有对话存活（跑 / 待确认 / 上一轮没正常结束 / 未读的正常结束）
 *     才显示；全部完成时**不显示**，rail 回落成原来的图标；
 *   - 绿 = 正常使用；黄 = 弹选择框 / 被故障中断（黄覆盖绿）；
 *   - 有对话正在跑 → 依次闪烁（跑马灯）；只有待处理时 → 同相呼吸。
 *   状态来源见 pulse.ts（含成本说明）。
 *
 * 两个可点入口（2026-10-09 需求：黄灯要能“标注已读”，完成情况也要能定位）：
 *   1. **黄灯角标**：`warn > 0` 时圆点旁的计数角标 →「需要处理的对话」清单，
 *      每条有「已读」按钮、头部有「全部已读」；**全部标注完黄灯回绿**
 *      （不必非得去对话框发消息才叫处理完）。
 *   2. **第 3 个圆点**：改造成「最近正常结束」指示（蓝色）→ 同款清单，
 *      点条目直达那条对话，也可逐条 / 全部标注已读；标注完该点消隐。
 *   两者都走 enterProjectWorkbench（与项目中心序号点同一入口）；已读标注写
 *   localStorage（跨刷新、同源多标签共享），同一轮不会重复提醒，
 *   新的一轮 / 新的待确认会话期会重新提醒。
 *
 * 浮层 portal 到 body + position:fixed → rail（56px 收起态）与展开态都从按钮
 * 右缘飞出，不受侧边栏宽度 / overflow 裁剪影响（Step 24 下拉被裁的教训）。
 * 主按钮的「切换」语义不受影响：点角标 / 第 3 点都 stopPropagation。
 */
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  enterProjectWorkbench, getLiveScreen, onRequestProjectList, onRequestWorkbench, openControlRoom,
} from './sessions'
import { markPulseRead, useActivityPulse } from './pulse'

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

/** 浮层里的一行（黄灯清单与完成清单共用结构）。 */
interface PopItem {
  /** 已读标注键（markPulseRead 用） */
  key: string
  sessionId: string
  projectId: string
  icon: string
  title: string
  sub: string
}

type PopKind = 'warn' | 'done'

/**
 * 「需要处理的对话」/「最近正常结束的对话」清单（同一个组件，两套数据）。
 *
 * portal 到 body、position:fixed（坐标由打开方按按钮矩形算好传入）：
 * 收起（rail 56px）与展开两种状态下都是从按钮右缘飞出，不被侧边栏裁剪。
 */
function ItemPopover({
  pos, kind, items, onPick, onClose,
}: {
  pos: { top?: number; bottom?: number; left: number }
  kind: PopKind
  items: PopItem[]
  onPick: (item: PopItem) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      // 点在清单里 / 角标 / 第 3 点上：交给各自处理（开合由它们自己负责）
      if (t?.closest('.ts-warn-pop') || t?.closest('.ts-side-entry')) return
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

  const isWarn = kind === 'warn'
  const heading = isWarn ? `需要处理的对话（${items.length}）` : `最近正常结束的对话（${items.length}）`
  return createPortal(
    <div
      className="ts-warn-pop"
      role="dialog"
      aria-label={heading}
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
    >
      <div className="ts-warn-pop-head">
        <span className="ts-warn-pop-title">{heading}</span>
        {items.length > 0 && (
          <button
            type="button"
            className="ts-warn-allread"
            title="把清单里这些全部标为已读，不再提醒"
            onClick={() => markPulseRead(kind)}
          >
            全部已读
          </button>
        )}
      </div>
      <div className="ts-warn-pop-list">
        {items.map((it) => (
          <div className="ts-warn-row" key={it.key}>
            <button
              type="button"
              className="ts-warn-item"
              title={`打开「${it.title}」的工作台，直达这条对话（并标为已读）`}
              onClick={() => onPick(it)}
            >
              <span className="ts-warn-icon" aria-hidden="true">{it.icon}</span>
              <span className="ts-warn-body">
                <span className="ts-warn-title">{it.title}</span>
                <span className="ts-warn-sub">{it.sub}</span>
              </span>
            </button>
            <button
              type="button"
              className="ts-warn-read"
              title="标为已读：不再提醒这一条（新一轮会重新提醒）"
              onClick={(e) => {
                e.stopPropagation()
                markPulseRead(kind, it.key)
              }}
            >
              已读
            </button>
          </div>
        ))}
      </div>
      <div className="ts-warn-pop-foot">
        {isWarn
          ? '点条目直达那条对话并标为已读；「已读」只标注不跳转 · Esc 关闭'
          : '点条目直达那条对话并标为已读；标完该点消隐 · Esc 关闭'}
      </div>
    </div>,
    document.body,
  )
}

/**
 * 存活指示圆点：前 N 个是呼吸 / 跑马灯（绿或黄），最后一个是「正常结束」指示
 * （蓝色、可点开清单）。只有「还没标注已读的正常结束」时才画最后那颗。
 */
function PulseDots({
  tone, running, breathing, doneCount, onOpenDone,
}: {
  tone: 'ok' | 'warn'
  running: boolean
  breathing: number
  doneCount: number
  onOpenDone: () => void
}) {
  return (
    <span className={`ts-pulse${running ? ' ts-pulse-run' : ''}${tone === 'warn' ? ' ts-pulse-warn' : ''}`}>
      {Array.from({ length: breathing }, (_, i) => (
        <i
          key={i}
          className="ts-pulse-dot"
          aria-hidden="true"
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
      {doneCount > 0 && (
        <span
          className="ts-pulse-dot ts-pulse-done"
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-label={`最近正常结束的对话 ${doneCount} 条`}
          title={`最近正常结束的对话（${doneCount}）：点击查看清单，点条目直达那条对话，可标注已读`}
          onClick={(e) => {
            e.stopPropagation()
            onOpenDone()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onOpenDone()
            }
          }}
        />
      )}
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

  // 呼吸灯状态（存活对话数 / 是否需要提醒 / 是否正在跑 / 未读完成通知）
  const pulse = useActivityPulse()
  const alive = pulse.alive > 0
  // 导航在途标记：宿主切 tab 是异步的，期间把重复点击当作同一意图的重复表达。
  const navigatingRef = useRef(false)
  const tone: 'ok' | 'warn' = pulse.warn > 0 ? 'warn' : 'ok'
  const running = pulse.running > 0
  const warnUnread = pulse.warn > 0
  const doneUnread = pulse.done.length > 0

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

  // —— 清单浮层（黄灯角标 / 第 3 个圆点共用）——
  const [pop, setPop] = useState<{ pos: { top?: number; bottom?: number; left: number }; kind: PopKind } | null>(null)
  // 对应的提醒被处理完（标注已读 / 状态变化）→ 自动收起
  useEffect(() => {
    if (!pop) return
    if (pop.kind === 'warn' && pulse.warn <= 0) setPop(null)
    if (pop.kind === 'done' && pulse.done.length <= 0) setPop(null)
  }, [pop, pulse.warn, pulse.done.length])

  /** 开/关清单：贴着按钮定位（rail 与展开态同一套算法）。
   *   横向：按钮右缘 + 8px（向右飞出，侧边栏再窄也不裁），越界朝窗口内收；
   *   纵向：默认贴按钮下方；下方放不下就改用 bottom 锚到按钮上方（贴住，不留缝）。 */
  const togglePop = (kind: PopKind) => (e?: { stopPropagation?: () => void }) => {
    e?.stopPropagation?.()
    if (pop && pop.kind === kind) {
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
    setPop({ pos, kind })
  }

  /** 点条目：直达那条对话的工作台，并把它标为已读（去过 = 看过了）。 */
  const pick = (kind: PopKind, it: PopItem) => {
    try {
      if (!enterProjectWorkbench(it.projectId, it.sessionId)) {
        console.warn('[tokensave] 定位对话：没有可导航的目标', it)
      }
    } catch (e) {
      console.warn('[tokensave] 定位对话失败', e)
    }
    markPulseRead(kind, it.key)
  }

  const toDesk = screen === 'list'
  const head = toDesk ? '项目中心：回到工作台' : '项目中心：查看项目列表'
  const title = `${head}（再点一次可在两者间切换）${alive ? `\n\n${pulse.tip}` : ''}`
  // rail 里角标要与圆点同排（36px 挤）：有角标时总点数最多留 2 个
  const totalDots = !wide && warnUnread ? Math.min(dotCount, 2) : dotCount
  // 呼吸灯只在「真有活动（跑 / 待处理）」时画；只剩未读完成通知时只画第 3 点
  const breathing = (pulse.running + pulse.warn) > 0
    ? Math.max(0, totalDots - (doneUnread ? 1 : 0))
    : 0

  const warnItems: PopItem[] = pulse.items.map((i) => ({
    key: i.key,
    sessionId: i.sessionId,
    projectId: i.projectId,
    icon: i.kind === 'pending' ? '⏳' : '⚠️',
    title: i.title || '（未命名对话）',
    sub: `${i.project || '未知项目'} · ${i.kind === 'pending' ? '待你确认' : '上一轮未正常结束'}`,
  }))
  const doneItems: PopItem[] = pulse.done.map((d) => ({
    key: d.key,
    sessionId: d.sessionId,
    projectId: d.projectId,
    icon: '✅',
    title: d.title || '（未命名对话）',
    sub: `${d.project || '未知项目'} · 已正常结束`,
  }))

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
            {/* 黄灯角标：点它=看「需要处理的对话」清单并标注已读（不触发布局切换） */}
            {warnUnread && (
              <span
                className="ts-warn-badge"
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={pop != null && pop.kind === 'warn'}
                title={`需要处理的对话（${pulse.warn}）：点击逐条 / 全部标注已读，标完黄灯回绿\n\n${pulse.tip}`}
                onClick={togglePop('warn')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    togglePop('warn')(e)
                  }
                }}
              >
                {pulse.warn}
              </span>
            )}
            <PulseDots
              tone={tone}
              running={running}
              breathing={breathing}
              doneCount={doneUnread ? pulse.done.length : 0}
              onOpenDone={togglePop('done')}
            />
          </span>
        )}
      </button>
      {pop && (
        <ItemPopover
          pos={pop.pos}
          kind={pop.kind}
          items={pop.kind === 'warn' ? warnItems : doneItems}
          onPick={(it) => pick(pop.kind, it)}
          onClose={() => setPop(null)}
        />
      )}
    </>
  )
}
