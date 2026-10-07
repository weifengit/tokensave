/**
 * H 型工作台（唯一布局模式，无中横线）
 * ┌────左竖────┬────中上：共享黑板────┬────右竖────┐
 * │  免费模型   │                     │  免费模型   │
 * │  窗口×N    ├─────────────────────┤  窗口×M    │
 * │           │  中下：DSH 主对话    │           │
 * └───────────┴─────────────────────┴───────────┘
 * - 全台共享 R = max(左窗口数, 右窗口数, 2) 行的 1fr 网格：黑板跨 1..R-1 行、
 *   中下格占最后一行、左右两竖跨满 R 行 —— 所有横向缝隙对齐（偶数探索者时
 *   三列缝完全一致），列内窗口 flex:1 等高均分，探索者增多自动细分。
 * - 中下格内嵌 DSH 主对话只读消息流（MainChat），并把宿主原生输入条
 *   （conversation.composer，每个 tab 常驻）position:fixed 停靠在消息流下方，
 *   卸载/切 tab 自动还原。
 * - 顶部第一行：项目名 + 该项目历史会话选择器 + 新建会话（sessions.ts）。
 * - 工作台默认铺满，无宽度把手/滑块（宿主那套全局把手在进入工作台期间隐藏）。
 * - 黑板 / 主对话 / 协作对话 / 协作收益 四张卡都支持最小化、最大化、关闭；
 *   三键渲染在各自卡片自己的标题条里（由本组件构造后作为 actions 传入）。
 * - 左右两竖按奇偶均分探索者；被隐藏的窗口以 chip 形式留在列底部可恢复
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchExplorers, publishProjectScope } from './api'
import type { TelemetrySession } from './api'
import { Blackboard } from './Blackboard'
import { ExplorerWindow } from './ExplorerWindow'
import { TalkColumn } from './TalkColumn'
import { SavingsColumn } from './SavingsColumn'
import { MainChat } from './MainChat'
import { SessionPicker } from './SessionPicker'
import { useProjectSessions, openSession, startProjectSession, latestProjectSession, sessionBelongsToProject } from './sessions'
import { getClientContext } from '../session-subscribe'
import { rememberOpenedProject } from './store'
import type { ProjectRecord } from './store'
import { reportExplorerCount } from '../float/mount'

import { PreviewPanel } from './PreviewPanel'
interface Props {
  project: ProjectRecord
  sessionId: string
  onBack: () => void
}

interface WinState {
  collapsed: boolean
  hidden: boolean
}

/** 非探索者卡片的窗口状态（与探索者窗口同款语义：最小化 / 最大化 / 关闭） */
interface CardState {
  collapsed: boolean
  hidden: boolean
  /** 铺满整个工作台的浮层 */
  maximized: boolean
}

const CARD_DEFAULT: CardState = { collapsed: false, hidden: false, maximized: false }

/** 四张可管理卡片（顺序即恢复条的显示顺序） */
const CARD_LABELS: Array<{ id: string; label: string }> = [
  { id: 'board', label: '共享黑板' },
  { id: 'chat', label: 'DSH 主对话' },
  { id: 'talk', label: '协作对话' },
  { id: 'save', label: '协作收益' },
]

/**
 * 卡片三键（— 最小化 / ⛶ 最大化 / ✕ 关闭），渲染进卡片自己的标题条。
 * 最大化时只留 ✕ 退出浮层（与探索者窗口一致）。
 */
function CardActions({
  state,
  label,
  onToggleCollapse,
  onToggleMax,
  onHide,
}: {
  state: CardState
  label: string
  onToggleCollapse: () => void
  onToggleMax: () => void
  onHide: () => void
}) {
  return (
    <span className="ts-card-actions">
      {state.maximized ? (
        <button className="ts-icon-btn" onClick={onToggleMax} title={`退出「${label}」最大化`}>✕</button>
      ) : (
        <>
          <button
            className="ts-icon-btn"
            onClick={onToggleCollapse}
            title={state.collapsed ? `展开「${label}」` : `最小化「${label}」`}
          >{state.collapsed ? '□' : '—'}</button>
          <button className="ts-icon-btn" onClick={onToggleMax} title={`最大化「${label}」`}>⛶</button>
          <button className="ts-icon-btn" onClick={onHide} title={`关闭「${label}」（可从台顶恢复）`}>✕</button>
        </>
      )}
    </span>
  )
}

/** 已关闭卡片的恢复条（放在台顶，避免卡片本身占位） */
function ClosedCardsBar({
  closed,
  onRestore,
}: {
  closed: Array<{ id: string; label: string }>
  onRestore: (id: string) => void
}) {
  if (closed.length === 0) return null
  return (
    <div className="ts-closed-bar">
      <span className="ts-closed-label">已关闭：</span>
      {closed.map((c) => (
        <button key={c.id} className="ts-chip" title={`恢复「${c.label}」`} onClick={() => onRestore(c.id)}>
          ＋ {c.label}
        </button>
      ))}
    </div>
  )
}

function labelOf(session: TelemetrySession): string {
  return session.title.startsWith('tokensave-')
    ? session.title.slice('tokensave-'.length)
    : session.title
}

/** 宿主原生输入条选择器（conversation.composer 常驻座位） */
const COMPOSER_SEAT = '[data-conversation-region="composer"]'

/**
 * 把宿主原生输入条停靠进中下格（position:fixed，向下锚定、内容向上生长）。
 * 组件卸载即还原原始行内样式，宿主在其它 tab 的行为原样恢复。
 */
function useDockNativeComposer(
  ref: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  deps: unknown[],
): void {
  useLayoutEffect(() => {
    const cell = ref.current
    if (!cell || typeof document === 'undefined') return
    const seat = document.querySelector<HTMLElement>(COMPOSER_SEAT)
    if (!seat) return
    const KEYS = ['position', 'left', 'right', 'top', 'bottom', 'width', 'zIndex'] as const
    const saved: Record<string, string> = {}
    for (const k of KEYS) saved[k] = (seat.style as any)[k]

    // 主对话卡收起/关闭时不再停靠：让输入条回到宿主的原位置（避免悬在空格里）
    if (!enabled) {
      for (const k of KEYS) (seat.style as any)[k] = saved[k]
      return
    }
    // 停靠前先记下原值（只记一次，避免把已停靠的值当成原值）
    for (const k of KEYS) saved[k] = (seat.style as any)[k]

    // #4 输入条会遮住消息末尾：量出它的高度写回 CSS 变量，
    // 让消息流底部预留出同样高度的留白（跟随多行输入动态变化）。
    const root = document.documentElement

    let raf = 0
    const apply = () => {
      raf = 0
      try {
        const r = cell.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return
        // 卡片内缩：border + padding，让输入条落在卡片边框内部
        const cs = getComputedStyle(cell)
        const insetX = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0)
        const insetY = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0)
        seat.style.position = 'fixed'
        seat.style.left = `${Math.round(r.left + insetX)}px`
        seat.style.right = 'auto'
        seat.style.width = `${Math.round(r.width - insetX * 2)}px`
        seat.style.top = 'auto'
        // 向下锚定：聚焦/多行输入时向上生长，不挤动网格
        seat.style.bottom = `${Math.round(window.innerHeight - r.bottom + insetY)}px`
        seat.style.zIndex = '35'
        // 输入条实际高度（含边框）→ 消息流底部留白，末尾几行不被遮挡
        const seatH = Math.ceil(seat.getBoundingClientRect().height) || 0
        if (seatH > 0) root.style.setProperty('--ts-composer-h', `${seatH}px`)
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
    // 兑底：未触发 ResizeObserver 的宿主布局变化（含 tab 切换）
    const timer = window.setInterval(schedule, 300)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.clearInterval(timer)
      if (raf) cancelAnimationFrame(raf)
      for (const k of KEYS) (seat.style as any)[k] = saved[k]
      document.documentElement.style.removeProperty('--ts-composer-h')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])
}

export function HDesk({ project, sessionId, onBack }: Props) {
  const [explorers, setExplorers] = useState<TelemetrySession[]>([])
  const [winState, setWinState] = useState<Record<string, WinState>>({})
  const [overlayId, setOverlayId] = useState<string | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [cards, setCards] = useState<Record<string, CardState>>({
    board: CARD_DEFAULT,
    chat: CARD_DEFAULT,
    talk: CARD_DEFAULT,
    save: CARD_DEFAULT,
  })
  const overlayRef = useRef<HTMLDivElement>(null)
  const chatCellRef = useRef<HTMLDivElement>(null)
  // 主对话铺满时，输入条改停靠到浮层里的那张卡上
  const overlayChatRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const sessions = useProjectSessions(project.path)

  // 进入/切换工作台即发布「当前打开的项目」：宿主据此把探索者强制归属到本项目。
  // 离开（卸载/返回列表）时清除，避免把陈旧的归属继续用在新探索者上。
  useEffect(() => {
    void publishProjectScope(project.path)
    return () => { void publishProjectScope('') }
  }, [project.path])

  // —— 主对话必须绑定「本项目自己的会话」（#1）——
  //
  // 中下格与探索者窗口都订阅宿主**当前**会话；而 conversation.view 拿到的 sessionId 是
  // 宿主全局当前会话——若用户是从别的项目切过来，它就不属于本项目，于是每个项目的工作台
  // 都会显示同一个（不相干的）会话。
  //
  // 这里把宿主切到本项目自己的会话（默认最新）。顺序很关键：先写记忆再导航——
  // 导航会重挂 ControlRoom 并立即读记忆。
  const boundRef = useRef<string>('')
  useEffect(() => {
    const ctx = getClientContext()
    if (!ctx) return
    // 当前会话已属于本项目：不动（避免把用户手动切到的历史会话抢回最新）
    if (sessionId && sessionBelongsToProject(ctx, sessionId, project.path)) {
      boundRef.current = sessionId
      return
    }
    if (boundRef.current === project.id) return
    boundRef.current = project.id
    const own = latestProjectSession(ctx, project.path)
    if (!own) {
      setProbeError('该项目还没有会话，点右上角「＋ 新建会话」开始')
      return
    }
    rememberOpenedProject(own.id, project.id)
    // 导航失败不占位：复位守卫，下次依赖变化（如用户新建会话）可重试
    if (!openSession(own.id)) {
      boundRef.current = ''
      setProbeError('切换本项目会话失败：会话导航服务不可用')
    }
  }, [project.path, sessionId])

  const cardOf = (id: string): CardState => cards[id] || CARD_DEFAULT
  const setCard = (id: string, patch: Partial<CardState>) =>
    setCards((prev) => ({ ...prev, [id]: { ...(prev[id] || CARD_DEFAULT), ...patch } }))

  /** 同一时刻只允许一张卡片铺满：切换即收回其它卡片。 */
  const toggleMax = (id: string) => {
    const next = !cardOf(id).maximized
    setCards((prev) => {
      const out: Record<string, CardState> = {}
      for (const [k, v] of Object.entries(prev)) out[k] = { ...v, maximized: k === id ? next : false }
      return out
    })
  }

  const probe = useCallback(async () => {
    try {
      // 按当前项目路径收敛（与黑板同口径）；宿主侧过滤后为空会自动回退全量
      const list = await fetchExplorers(project.path)
      setExplorers(list)
      reportExplorerCount(list.length)
      setProbeError(null)
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : '探索者探测失败')
    }
  }, [project.path])

  useEffect(() => {
    probe()
    const timer = setInterval(probe, 8_000)
    return () => clearInterval(timer)
  }, [probe])

  // 退出全屏：浏览器全屏被 ESC/按钮关闭时同步收回浮层态
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && overlayId) setOverlayId(null)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [overlayId])

  const stateOf = (id: string): WinState => winState[id] || { collapsed: false, hidden: false }
  const setStateOf = (id: string, patch: Partial<WinState>) =>
    setWinState((prev) => ({ ...prev, [id]: { ...stateOf(id), ...patch } }))

  const visible = explorers.filter((s) => !stateOf(s.id).hidden)
  const hidden = explorers.filter((s) => stateOf(s.id).hidden)
  const left = visible.filter((_, i) => i % 2 === 0)
  const right = visible.filter((_, i) => i % 2 === 1)
  const overlaid = overlayId ? explorers.find((s) => s.id === overlayId) : undefined
  // 未唤醒 tokensave（本项目还没有任何探索者会话）：按用户要求只保留一个
  // DSH 主对话窗口并铺满整个工作台；探索者一出现（tokensave_delegate 跑起来）
  // 即自动还原 H 台——idle 是派生态，不写入任何卡片状态。
  const idle = explorers.length === 0
  const rawMax = CARD_LABELS.find((c) => cardOf(c.id).maximized)?.id ?? null
  // idle 时只允许 chat 最大化（其他卡不渲染，放行只会弹出孤立浮层）
  // idle 下主对话已在网格里铺满（本身就是最大化），浮层一律不上，否则双实例双订阅
  const maximizedCard = idle ? null : rawMax

  // 网格行数：黑板占 1..R-1，中下占 R；左右两竖跨满 —— 探索者增多即均分
  const rows = Math.max(left.length, right.length, 2)
  // 中下格随窗口数/布局变化 → 停靠持续跟随（deps 覆盖重排）
  const chatMaximized = !idle && cardOf('chat').maximized
  const chatDocked = idle || (!cardOf('chat').collapsed && !cardOf('chat').hidden)
  useDockNativeComposer(
    chatMaximized ? overlayChatRef : chatCellRef,
    chatDocked,
    [rows, idle, sessionId, visible.length, chatMaximized],
  )

  /** 卡片三键：构造后交给各卡片渲染进自己的标题条 */
  const actionsFor = (id: string, label: string) => {
    const st = cardOf(id)
    return (
      <CardActions
        state={st}
        label={label}
        onToggleCollapse={() => setCard(id, { collapsed: !st.collapsed })}
        onToggleMax={() => toggleMax(id)}
        onHide={() => setCard(id, { hidden: true })}
      />
    )
  }

  /** 卡片外壳：只负责收起/铺满的布局，标题条由卡片自己渲染（actions 传入） */
  const cardShell = (id: string, body: React.ReactNode, extraClass = '') => {
    const st = cardOf(id)
    // 铺满时由下方浮层独占渲染（避免同一组件双实例、双订阅）
    if (st.hidden || st.maximized) return null
    const cls = `ts-card ${extraClass}${st.collapsed ? ' ts-card-collapsed' : ''}`
    return <div className={cls}>{body}</div>
  }

  const renderWin = (session: TelemetrySession) => (
    <ExplorerWindow
      key={session.id}
      session={session}
      label={labelOf(session)}
      collapsed={stateOf(session.id).collapsed}
      overlay={false}
      onCollapse={(id) => setStateOf(id, { collapsed: !stateOf(id).collapsed })}
      onOverlay={(id) => setOverlayId(id)}
      onExitOverlay={() => { setOverlayId(null); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) }}
      onHide={(id) => setStateOf(id, { hidden: true })}
    />
  )

  const renderHiddenChips = () => hidden.length > 0 && (
    <div className="ts-win-hidden-bar">
      {hidden.map((s) => (
        <button
          key={s.id}
          className="ts-chip"
          title="恢复该模型窗口"
          onClick={() => setStateOf(s.id, { hidden: false })}
        >＋ {labelOf(s)}</button>
      ))}
    </div>
  )

  const closedCards = CARD_LABELS.filter((c) => cardOf(c.id).hidden)

  return (
    <div className="ts-cr ts-hdesk" ref={rootRef} style={{ padding: 8 }}>
      <div className="ts-bar">
        <button className="ts-btn" onClick={onBack}>← 项目中心</button>
        <span className="ts-title">{project.name}</span>
        <span className="ts-sub ts-bar-path" title={project.path}>{project.path}</span>
        {/* 会话操作固定靠右，不换行（#8） */}
        <span className="ts-bar-right ts-bar-sessions">
          <SessionPicker
            sessions={sessions}
            currentId={sessionId}
            onPick={(id) => {
              if (id !== sessionId && !openSession(id)) {
                setProbeError('切换会话失败：会话导航服务不可用')
              }
            }}
            onNew={async () => {
              const res = await startProjectSession(project.path, project.id)
              if (res.ok) {
                // 新会话也记住同一个项目：发出第一条消息后直接回到本工作台
                rememberOpenedProject(res.id, project.id)
              } else {
                setProbeError(`新建会话失败：${res.error}`)
              }
            }}
          />
        </span>
      </div>

      {/* 项目预览：标题行（项目名 + 历史会话 + 新建会话）之下、其它窗口之上 */}
      <PreviewPanel project={project} />

      {probeError && <div className="ts-hint">⚠️ {probeError}</div>}
      {/* idle 下其它卡都不渲染，恢复 chip 点了也没意义（且会与“只保留一个窗口”矛盾） */}
      {!idle && <ClosedCardsBar closed={closedCards} onRestore={(id) => setCard(id, { hidden: false })} />}

      {/* 行轨道同样用 minmax(0, 1fr)：裸 1fr 的自动最小值是 min-content，
          卡片里的长内容会把行撑高，把网格顶出容器（与列同款问题）。 */}
      {idle ? (
        /* —— 未唤醒 tokensave：单窗口 —— 其它窗口全部隐藏，DSH 主对话铺满整个工作台
           （派生态：不改任何卡片状态；探索者一出现就回到 H 台） */
        <div className="ts-desk" style={{ gridTemplateRows: 'minmax(0,1fr)', gridTemplateColumns: 'minmax(0,1fr)' }}>
          <div className="ts-desk-chat" style={{ gridRow: '1', gridColumn: '1' }} ref={chatCellRef}>
            {/* 不走 cardShell：idle 下主对话必须无条件渲染（此前的 hidden/collapsed/maximized
                状态在单窗口模式下会让台面空掉或缩成一条；三键在只有一个窗口时也无意义 */}
            <div className="ts-card ts-card-fill">
              <MainChat sessionId={sessionId} actions={null} />
            </div>
          </div>
        </div>
      ) : (
        <div className="ts-desk" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {/* 左竖：顶部协作对话（主 agent ↔ 探索者），下方探索者窗口等高均分 */}
        <div className="ts-desk-col ts-desk-left">
          {cardShell('talk', (
            <TalkColumn
              sessionId={sessionId}
              explorers={visible}
              actions={actionsFor('talk', '协作对话')}
            />
          ), 'ts-card-talk')}
          {left.length === 0 && <div className="ts-hint">左列暂无模型窗口<br />运行 tokensave_delegate 后自动出现</div>}
          {left.map(renderWin)}
          {renderHiddenChips()}
        </div>
        {/* 中上：共享黑板（跨 1..R-1 行，底边与左右列缝隙对齐，无横线） */}
        <div className="ts-desk-board" style={{ gridRow: `1 / ${rows}` }}>
          {cardShell('board', (
            <Blackboard workspace={project.path} actions={actionsFor('board', '共享黑板')} />
          ), 'ts-card-fill')}
        </div>
        {/* 中下：DSH 主对话卡片 —— 消息流就地渲染 + 宿主原生输入条停靠 */}
        <div className="ts-desk-chat" style={{ gridRow: String(rows) }} ref={chatCellRef}>
          {cardShell('chat', (
            <MainChat sessionId={sessionId} actions={actionsFor('chat', 'DSH 主对话')} />
          ), 'ts-card-fill')}
        </div>
        {/* 右竖：顶部协作收益（省 token/费用 vs 等待时间），下方探索者窗口 */}
        <div className="ts-desk-col ts-desk-right">
          {cardShell('save', (
            <SavingsColumn
              sessionId={sessionId}
              explorers={visible}
              actions={actionsFor('save', '协作收益')}
            />
          ), 'ts-card-save')}
          {right.map(renderWin)}
        </div>
        {/* 最大化/双击全屏的浮层 */}
        {overlaid && (
          <ExplorerWindow
            session={overlaid}
            label={labelOf(overlaid)}
            collapsed={false}
            overlay
            overlayRef={overlayRef}
            onCollapse={() => {}}
            onOverlay={() => {}}
            onExitOverlay={() => {
              setOverlayId(null)
              if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
            }}
            onHide={() => {}}
          />
        )}
        </div>
      )}

      {/* 卡片铺满浮层：覆盖整个工作台 */}
      {maximizedCard && (
        <div className="ts-card-overlay">
          <div className="ts-card-overlay-inner">
            {maximizedCard === 'board' && (
              <Blackboard workspace={project.path} actions={actionsFor('board', '共享黑板')} />
            )}
            {maximizedCard === 'chat' && (
              <div className="ts-card-overlay-chat" ref={overlayChatRef}>
                <MainChat sessionId={sessionId} actions={actionsFor('chat', 'DSH 主对话')} />
              </div>
            )}
            {maximizedCard === 'talk' && (
              <TalkColumn sessionId={sessionId} explorers={visible} actions={actionsFor('talk', '协作对话')} />
            )}
            {maximizedCard === 'save' && (
              <SavingsColumn sessionId={sessionId} explorers={visible} actions={actionsFor('save', '协作收益')} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
