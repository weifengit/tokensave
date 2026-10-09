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
  sendToSession,
} from './sessions'
import { markPulseRead, useActivityPulse } from './pulse'
import {
  DURATION_OPTIONS, SOUND_OPTIONS, getSoundSettings, initSoundBridge, playRole,
  setSoundSettings, stopSound, subscribePlaying,
} from './sound'
import type { SoundDuration, SoundId, SoundSettings } from './sound'

/** 圆点数量（用户要求 3 个）。 */
const DOT_COUNT = 3
/** 收起态按钮宽度低于该值时，3 个点确实挤不下 → 降为 2 个（展开态沿用同一数量，保持一致）。 */
const RAIL_MIN_WIDE = 30
/**
 * 点击后的“导航在途”窗口：宿主切 tab 是异步的，这段时间内忽略重复点击。
 * 与 sessions.ts 的 NAV_SETTLE_MS 同量级（略短），避免两个窗口错位。
 */
const NAV_LOCK_MS = 700
/** 清单浮层高度预算（纵向 clamp 定位用；宽度改成按剩余空间动态上限，见下）。 */
const POP_H = 220

/**
 * 按钮所在**侧边栏容器**的右缘：面板要从容器右缘起飞，而不是按钮右缘——
 * 按钮四周有内边距（实测 13px），只按按钮算会让面板钻到侧边栏底下被盖住。
 * 只在「不宽于视口一半」的祖先里取最大右缘（更宽的那个就是主内容区了）。
 */
function sidebarRightOf(btn: HTMLElement): number {
  const limit = window.innerWidth * 0.5
  let best = btn.getBoundingClientRect().right
  let el: HTMLElement | null = btn.parentElement
  while (el && el !== document.body && el !== document.documentElement) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.width <= limit && r.right > best) best = r.right
    el = el.parentElement
  }
  return best
}
/** 黄灯清单里「继续」按钮直接发出去的原文（宿主 max-tokens 提示就是让用户发「继续」） */
const CONTINUE_TEXT = '继续'

/** 浮层里的一行（黄灯清单与完成清单共用结构）。 */
interface PopItem {
  /** 已读标注键（markPulseRead 用） */
  key: string
  sessionId: string
  projectId: string
  icon: string
  title: string
  sub: string
  /** 项目身份（给胶囊配色用：id 优先，退回项目名） */
  projectKey: string
  /** 是否给「继续」按钮（只有上一轮没正常结束的那类才有意义） */
  canContinue: boolean
}

type PopKind = 'warn' | 'done'


/**
 * 项目胶囊配色：按项目 id/名称稳定散列出一个色相 —— 同项目永远同色、不同项目不同色。
 * 分开给 bg / 边框 / 字色，深色底上既够亮又不抢标题的注意力。
 */
function pillStyle(key: string): React.CSSProperties {
  if (!key) return {}
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return {
    background: `hsla(${h},70%,55%,.18)`,
    borderColor: `hsla(${h},70%,60%,.5)`,
    color: `hsl(${h},72%,80%)`,
  }
}
/**
 * 「需要处理的对话」/「最近正常结束的对话」清单（同一个组件，两套数据）。
 *
 * portal 到 body、position:fixed（坐标由打开方按按钮矩形算好传入）：
 * 收起（rail 56px）与展开两种状态下都是从按钮右缘飞出，不被侧边栏裁剪。
 */
function ItemPopover({
  pos, kind, items, onPick, onContinue, onClose,
}: {
  pos: { top?: number; bottom?: number; left: number; maxWidth?: number }
  kind: PopKind
  items: PopItem[]
  onPick: (item: PopItem) => void
  /** 直接给那条对话发「继续」（不跳转）；不传则不显示该按钮 */
  onContinue?: (item: PopItem) => Promise<void>
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
  /** 每行「继续」的发送状态（发完那条对话变进行中，行会随黄灯重算消失） */
  const [sendState, setSendState] = useState<Record<string, 'sending' | 'sent' | 'error'>>({})
  const [sendErr, setSendErr] = useState('')
  const cont = async (it: PopItem) => {
    if (!onContinue) return
    const cur = sendState[it.key]
    if (cur === 'sending' || cur === 'sent') return
    setSendState((m) => ({ ...m, [it.key]: 'sending' }))
    try {
      await onContinue(it)
      setSendState((m) => ({ ...m, [it.key]: 'sent' }))
    } catch (e: any) {
      setSendErr(String(e?.message ?? e))
      setSendState((m) => ({ ...m, [it.key]: 'error' }))
      console.warn('[tokensave] 清单里直接发送「继续」失败', e)
    }
  }
  return createPortal(
    <div
      className="ts-warn-pop"
      role="dialog"
      aria-label={heading}
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left, maxWidth: pos.maxWidth }}
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
              title={[it.title, it.sub, '点击：打开这条对话的工作台（并标为已读）'].filter(Boolean).join('\n')}
              onClick={() => onPick(it)}
            >
              <span className="ts-warn-icon" aria-hidden="true">{it.icon}</span>
              <span className="ts-warn-body">
                <span className="ts-warn-title">{it.title}</span>
                {it.sub && <span className="ts-warn-sub" style={pillStyle(it.projectKey)}>{it.sub}</span>}
              </span>
            </button>
            {it.canContinue && (
              <button
                type="button"
                className={`ts-warn-cont${sendState[it.key] ? ` is-${sendState[it.key]}` : ''}`}
                disabled={sendState[it.key] === 'sending' || sendState[it.key] === 'sent'}
                title={sendState[it.key] === 'error'
                  ? `发送失败：${sendErr}（点「重试」再发一次）`
                  : '不跳转：直接给这条对话发一条「继续」，让它接着输出'}
                onClick={(e) => {
                  e.stopPropagation()
                  void cont(it)
                }}
              >
                {sendState[it.key] === 'sending'
                  ? '…'
                  : sendState[it.key] === 'sent'
                    ? '✓'
                    : sendState[it.key] === 'error'
                      ? '重试'
                      : '继续'}
              </button>
            )}
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
    </div>,
    document.body,
  )
}

/**
 * 存活指示圆点（呼吸 / 跑马灯，绿或黄）。“正常结束”已改成**蓝色计数角标**（与黄角标
 * 同款、显示未读条数），不再占用第 3 个点——3 个点回归纯粹的“活跃指示”。
 * 悬停在圆点上 → 打开「对话清单」悬浮面板（项目 + 标题、可点击跳转）——原生 title 点不了，
 * 所以这里用自绘面板取代它。
 */
function PulseDots({
  tone, running, count, onHoverIn, onHoverOut,
}: {
  tone: 'ok' | 'warn'
  running: boolean
  count: number
  onHoverIn?: () => void
  onHoverOut?: () => void
}) {
  return (
    <span
      className={`ts-pulse${running ? ' ts-pulse-run' : ''}${tone === 'warn' ? ' ts-pulse-warn' : ''}`}
      aria-hidden="true"
      onMouseEnter={onHoverIn}
      onMouseLeave={onHoverOut}
    >
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className="ts-pulse-dot" style={{ animationDelay: `${i * 0.16}s` }} />
      ))}
    </span>
  )
}

/**
 * 跑马灯悬浮面板：鼠标停在呼吸圆点上弹出的「对话清单」——每行 = 对话标题 + 项目胶囊，
 * **点条目直达那条对话的工作台**（原生 tooltip 做不到点击，所以自绘）。
 * portal 到 body + position:fixed，与两枚角标的清单同款定位（rail / 展开态都向右飞出）。
 */
function HoverPanel({ pos, items, onPick, onHover }: {
  pos: { top?: number; bottom?: number; left: number; maxWidth?: number }
  items: PopItem[]
  onPick: (item: PopItem) => void
  /** 鼠标进出面板：父级据此保持打开 / 计时关闭 */
  onHover: (inside: boolean) => void
}) {
  // 提示音设置**直接嵌在面板里**（与「对话清单」同面板同现，不再单独弹一层）；
  // 改动即持久化，这里只是本地镜像，用来驱动控件显示。
  const [s, setS] = useState<SoundSettings>(() => getSoundSettings())
  const [playingLabel, setPlayingLabel] = useState<string | null>(null)
  useEffect(() => subscribePlaying(setPlayingLabel), [])
  const update = (patch: Partial<SoundSettings>) => setS(setSoundSettings(patch))
  return createPortal(
    <div
      className="ts-warn-pop ts-hover-pop"
      role="dialog"
      aria-label="对话清单"
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left, maxWidth: pos.maxWidth }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      {/* 提示音设置：直接内嵌在面板顶部（与「对话清单」同面板同现，不再单独弹一层）；
         紧凑字号，改完即持久化 */}
      <div className="ts-sound-body">
        <div className="ts-sound-row">
          <label>提醒</label>
          <button
            type="button"
            className={`ts-sound-toggle${s.enabled ? ' on' : ''}`}
            title="开启 / 关闭结局提示音"
            onClick={() => update({ enabled: !s.enabled })}
          >
            {s.enabled ? '开' : '关'}
          </button>
          <input
            className="ts-sound-range"
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(s.volume * 100)}
            title={`音量 ${Math.round(s.volume * 100)}%`}
            onChange={(e) => update({ volume: Number(e.target.value) / 100 })}
          />
        </div>
        <div className="ts-sound-row">
          <label>完成</label>
          <select
            className="ts-select"
            value={s.doneId}
            title="正常结束时的提示音"
            onChange={(e) => update({ doneId: e.target.value as SoundId })}
          >
            {SOUND_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="ts-sound-mini"
            title="试听完成音效"
            onClick={() => void playRole('done', true)}
          >
            ▶
          </button>
        </div>
        <div className="ts-sound-row">
          <label>中断</label>
          <select
            className="ts-select"
            value={s.failId}
            title="被中断 / 失败 / 被截断时的提示音"
            onChange={(e) => update({ failId: e.target.value as SoundId })}
          >
            {SOUND_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="ts-sound-mini"
            title="试听中断音效"
            onClick={() => void playRole('fail', true)}
          >
            ▶
          </button>
        </div>
        <div className="ts-sound-row">
          <label>时长</label>
          <select
            className="ts-select"
            value={s.duration}
            title="每次提醒持续多久（到点自动停）"
            onChange={(e) => update({ duration: e.target.value as SoundDuration })}
          >
            {DURATION_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          {s.duration === 'custom' && (
            <input
              className="ts-sound-min"
              type="number"
              min={1}
              max={180}
              value={s.customMinutes}
              title="自定义分钟数（1–180）"
              onChange={(e) => update({ customMinutes: Number(e.target.value) })}
            />
          )}
          {s.duration === 'custom' && <span className="ts-sound-unit">分钟</span>}
          <button
            type="button"
            className={`ts-sound-mini${playingLabel ? ' is-playing' : ''}`}
            title={playingLabel ? `停止正在响的「${playingLabel}」提示音（在页面里任意操作也会自动停）` : '停止提示音（在页面里任意操作也会自动停）'}
            onClick={() => stopSound()}
          >
            ■
          </button>
        </div>
      </div>
      <div className="ts-warn-pop-head">
        <span className="ts-warn-pop-title">对话清单（{items.length}）</span>
      </div>
      <div className="ts-warn-pop-list">
        {items.map((it) => (
          <div className="ts-warn-row" key={it.key}>
            <button
              type="button"
              className="ts-warn-item"
              onClick={() => onPick(it)}
            >
              <span className="ts-warn-icon" aria-hidden="true">{it.icon}</span>
              <span className="ts-warn-body">
                <span className="ts-warn-title">{it.title}</span>
                {it.sub && <span className="ts-warn-sub" style={pillStyle(it.projectKey)}>{it.sub}</span>}
              </span>
            </button>
          </div>
        ))}
      </div>
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
  const [pop, setPop] = useState<{ pos: { top?: number; bottom?: number; left: number; maxWidth?: number }; kind: PopKind } | null>(null)
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
    // 贴按钮右缘定位；宽度上限按**剩余空间**动态算 —— 窄窗口下宁可让内容省略，
    // 也不能把面板塞回侧边栏底下（此前按固定 300/560 夹紧，面板左侧被侧边栏盖住过）
    const left = Math.max(8, sidebarRightOf(btnRef.current as HTMLElement) + 8)
    const maxWidth = Math.max(220, window.innerWidth - left - 12)
    const below = r.bottom + 6 + 140 <= window.innerHeight - 8
    const above = r.top - 6 >= 140 + 8
    const pos = below
      ? { top: r.bottom + 6, left, maxWidth }
      : above
        ? { bottom: window.innerHeight - r.top + 6, left, maxWidth }
        : { top: Math.max(8, Math.min(r.top, window.innerHeight - POP_H - 12)), left, maxWidth }
    setPop({ pos, kind })
  }

  /**
 * 点条目：直达那条对话的工作台；kind 给了就顺手把它标为已读。
 * 悬浮清单（kind=null）没有“已读”概念——那里的对话本来就活着，只负责跳转。
 */
  const pick = (kind: PopKind | null, it: PopItem) => {
    try {
      if (!enterProjectWorkbench(it.projectId, it.sessionId)) {
        console.warn('[tokensave] 定位对话：没有可导航的目标', it)
      }
    } catch (e) {
      console.warn('[tokensave] 定位对话失败', e)
    }
    if (kind) markPulseRead(kind, it.key)
  }

  const toDesk = screen === 'list'
  const head = toDesk ? '项目中心：回到工作台' : '项目中心：查看项目列表'
  const title = `${head}（再点一次可在两者间切换）`
  // 计数角标（黄=需要处理 / 蓝=未读完成）占位会让 rail（36px）挤不下圆点 →
  // 按「角标优先」递减圆点：无角标 3 个、1 枚角标 2 个、2 枚角标让位给角标。
  const badges = (warnUnread ? 1 : 0) + (doneUnread ? 1 : 0)
  const breathing = wide
    ? (pulse.running + pulse.warn) > 0 ? dotCount : 0
    : badges === 0
      ? dotCount
      : badges === 1
        ? Math.min(dotCount, 2)
        : 0

  const warnItems: PopItem[] = pulse.items.map((i) => ({
    key: i.key,
    sessionId: i.sessionId,
    projectId: i.projectId,
    icon: i.kind === 'pending' ? '⏳' : '⚠️',
    title: i.title || '（未命名对话）',
    sub: i.project || '',
    projectKey: i.projectId || i.project,
    canContinue: i.kind === 'failed'
  }))
  const doneItems: PopItem[] = pulse.done.map((d) => ({
    key: d.key,
    sessionId: d.sessionId,
    projectId: d.projectId,
    icon: '✅',
    title: d.title || '（未命名对话）',
    sub: d.project || '',
    projectKey: d.projectId || d.project,
    canContinue: false
  }))

  /** 悬浮清单里的全部条目：跑着的（●） + 需处理的（⏳/⚠️） + 已完成的（✅），与 tip 同序 */
  const hoverItems: PopItem[] = [
    ...pulse.active.map((a) => ({
      key: `a:${a.sessionId}`,
      sessionId: a.sessionId,
      projectId: a.projectId,
      icon: '●',
      title: a.title || '（未命名对话）',
      sub: a.project || '',
      projectKey: a.projectId || a.project,
      canContinue: false,
    })),
    ...warnItems,
    ...doneItems,
  ]

  // —— 跑马灯悬浮面板：圆点 hover → 弹出可点击的对话清单（取代原生 title，因为它点不了）——
  const [hoverPos, setHoverPos] = useState<{ top?: number; bottom?: number; left: number; maxWidth?: number } | null>(null)
  const hoverTimer = useRef<number | null>(null)
  const clearHoverTimer = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }
  /** 打开：定位算法与角标清单同款（贴按钮右缘，放不下改锚上方） */
  const openHover = () => {
    clearHoverTimer()
    if (hoverPos || hoverItems.length === 0) return
    const r = btnRef.current?.getBoundingClientRect()
    if (!r || (r.width === 0 && r.height === 0)) return
    // 同角标清单：贴按钮右缘，宽度上限按剩余空间动态给（窄窗口下不钻到侧边栏底下）
    const left = Math.max(8, sidebarRightOf(btnRef.current as HTMLElement) + 8)
    const maxWidth = Math.max(220, window.innerWidth - left - 12)
    const below = r.bottom + 6 + 140 <= window.innerHeight - 8
    const above = r.top - 6 >= 140 + 8
    setHoverPos(
      below
        ? { top: r.bottom + 6, left, maxWidth }
        : above
          ? { bottom: window.innerHeight - r.top + 6, left, maxWidth }
          : { top: Math.max(8, Math.min(r.top, window.innerHeight - POP_H - 12)), left, maxWidth },
    )
  }
  /** 关闭：给 220ms 缓冲，鼠标从圆点挪到面板上不会闪断 */
  const closeHover = () => {
    clearHoverTimer()
    hoverTimer.current = window.setTimeout(() => {
      setHoverPos(null)
      hoverTimer.current = null
    }, 220)
  }
  useEffect(() => clearHoverTimer, [])

  useEffect(() => {
    // 结局告警桥：观察到「停止」并判定出完成 / 中断时各响各的音（挂载一次，幂等）；
    // 设置本身内嵌在跑马灯悬浮面板里（HoverPanel 自己管），这里只负责“该响时响”。
    return initSoundBridge()
  }, [])

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
          <span
            className={`ts-side-right${wide ? '' : ' rail'}`}
            // 悬停热区 = 整个右侧簇（角标 + 圆点及其 padding 扩出的区域）：
            // 圆点只有 6px 高，只盯圆点既迟钝又难点中；鼠标一进这片区域就立刻弹出。
            onMouseOver={(e) => {
              // 角标自带 title + 点击面板，不在此处唤出悬浮清单（避免两层提示叠在一起）
              if ((e.target as HTMLElement)?.closest?.('.ts-side-badge')) return
              openHover()
            }}
            onMouseLeave={closeHover}
          >
            {/* 黄角标 = 需要处理的对话；蓝角标 = 未读的正常结束（都点得开各自清单） */}
            {warnUnread && (
              <span
                className="ts-side-badge is-warn"
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
            {doneUnread && (
              <span
                className="ts-side-badge is-done"
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={pop != null && pop.kind === 'done'}
                title={`最近正常结束的对话（${pulse.done.length}）：点击查看清单，点条目直达那条对话，可标注已读`}
                onClick={togglePop('done')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    togglePop('done')(e)
                  }
                }}
              >
                {pulse.done.length}
              </span>
            )}
            {breathing > 0 && (
              <PulseDots
                tone={tone}
                running={running}
                count={breathing}
              />
            )}
          </span>
        )}
      </button>
      {pop && (
        <ItemPopover
          pos={pop.pos}
          kind={pop.kind}
          items={pop.kind === 'warn' ? warnItems : doneItems}
          onPick={(it) => pick(pop.kind, it)}
          onContinue={async (it) => { await sendToSession(it.sessionId, CONTINUE_TEXT) }}
          onClose={() => setPop(null)}
        />
      )}
      {hoverPos && (
        <HoverPanel
          pos={hoverPos}
          items={hoverItems}
          onPick={(it) => {
            pick(null, it)
            setHoverPos(null)
          }}
          onHover={(inside) => {
            if (inside) clearHoverTimer()
            else closeHover()
          }}
        />
      )}
    </>
  )
}
