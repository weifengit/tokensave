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
 * - 有「项目预览」的项目：进入工作台默认**只呈现预览** —— DSH 主对话收进标题行
 *   「已关闭」条的「＋ DSH 主对话」chip（点即恢复），其外框（.ts-desk-chat）与宿主
 *   输入条一并隐藏（styles.ts 的 body.ts-hdesk-nochat）；台面空置时 .ts-desk 整块
 *   不渲染、预览条撑满剩余高度 —— 界面里不出现任何对话框（与「项目中心」一致）。
 * - 顶部标题行（左→右）：项目名（显著徽标）→ 已关闭列表 → 一键切换 → 历史会话 / 新建会话。
 * - 工作台默认铺满，无宽度把手/滑块（宿主那套全局把手在进入工作台期间隐藏）。
 * - 黑板 / 主对话 / 协作对话 / 协作收益 四张卡都支持最小化、最大化、关闭；
 *   三键渲染在各自卡片自己的标题条里（由本组件构造后作为 actions 传入）。
 * - 左右两竖按奇偶均分探索者；被关闭的卡片与探索者窗口统一以 chip 列在标题行可恢复
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchExplorers, fetchProjectInfo, publishProjectScope } from './api'
import type { TelemetrySession, ProjectInfo } from './api'
import { Blackboard } from './Blackboard'
import { ExplorerWindow } from './ExplorerWindow'
import { TalkColumn } from './TalkColumn'
import { SavingsColumn } from './SavingsColumn'
import { MainChat } from './MainChat'
import { SessionPicker } from './SessionPicker'
import { ExplorerSettings } from './ExplorerSettings'
import { useProjectSessions, openSession, startProjectSession, latestProjectSession, sessionBelongsToProject, stayInProjectAfterArchive } from './sessions'
import { getClientContext } from '../session-subscribe'
import { rememberOpenedProject } from './store'
import type { ProjectRecord } from './store'
import { reportExplorerCount } from '../float/mount'

import { PreviewPanel, absoluteUrl } from './PreviewPanel'
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
 * 「项目预览」这张卡不在 H 台网格里（它是台顶的一条），但共用同一套窗口三键状态：
 * 最小化 = 收成标题条；最大化 = 铺满工作台浮层；关闭 = 收进「已关闭」恢复条。
 */
const PREVIEW_CARD = { id: 'preview', label: '项目预览' }
/** 预览条高度的持久化键（拖动分隔条后记住，切项目/刷新都保留） */
const PREVIEW_H_KEY = 'tokensave:preview-h.v1'
/** 预览条默认高度与上下限（px）；下限保证正文可见，上限给下面的工作台留位置 */
const PREVIEW_H_DEFAULT = 260
const PREVIEW_H_MIN = 120
const PREVIEW_DESK_MIN = 180

function readPreviewHeight(): number {
  try {
    const v = Number(localStorage.getItem(PREVIEW_H_KEY))
    return Number.isFinite(v) && v >= PREVIEW_H_MIN ? v : PREVIEW_H_DEFAULT
  } catch {
    return PREVIEW_H_DEFAULT
  }
}

function savePreviewHeight(px: number): void {
  try {
    localStorage.setItem(PREVIEW_H_KEY, String(Math.round(px)))
  } catch {
    /* 隐私模式：仅本次会话有效 */
  }
}

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

/** 已关闭窗口的恢复条：统一列出「被关闭的卡片」（含预览）与「被关闭的探索者窗口」。
 *  固定在标题行「历史会话」左侧；全部窗口都呈现时 items 为空 → 本区域自然消失。 */
interface ClosedWindowItem {
  id: string
  label: string
  kind: 'card' | 'explorer'
}

function ClosedWindowsBar({
  items,
  onRestore,
}: {
  items: ClosedWindowItem[]
  onRestore: (item: ClosedWindowItem) => void
}) {
  if (items.length === 0) return null
  return (
    <span className="ts-closed-bar">
      <span className="ts-closed-label">已关闭：</span>
      {items.map((c) => (
        <button
          key={`${c.kind}:${c.id}`}
          className="ts-chip"
          title={`恢复「${c.label}」`}
          onClick={() => onRestore(c)}
        >
          ＋ {c.label}
        </button>
      ))}
    </span>
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
      cell.style.removeProperty('--ts-chat-content-w')
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
        // 内容宽度 = min(卡片可用宽, 宿主横向拖拽出的宽度)：
        // 拖拽变窄时主对话内容与输入条同步变窄并居中，两者始终对齐。
        const avail = Math.max(0, r.width - insetX * 2)
        // 先保证不小于 240，再钳到卡片可用宽（避免小卡片下反而溢出）
        const contentW = Math.min(avail, Math.max(240, hostContentWidthPx(cell)))
        // 幂等写入：下面盯着祖先链的 style 变化，重复写同一个值会自激
        const contentPx = `${Math.round(contentW)}px`
        if (cell.style.getPropertyValue('--ts-chat-content-w') !== contentPx) {
          cell.style.setProperty('--ts-chat-content-w', contentPx)
        }
        seat.style.position = 'fixed'
        seat.style.left = `${Math.round(r.left + insetX + (avail - contentW) / 2)}px`
        seat.style.right = 'auto'
        seat.style.width = `${Math.round(contentW)}px`
        seat.style.top = 'auto'
        // 向下锚定：聚焦/多行输入时向上生长，不挤动网格
        seat.style.bottom = `${Math.round(window.innerHeight - r.bottom + insetY)}px`
        seat.style.zIndex = '35'
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
    // 兑底：未触发 ResizeObserver 的宿主布局变化（含 tab 切换）
    const timer = window.setInterval(schedule, 300)
    // 宿主拖拽只改祖先元素上的 CSS 变量（不触发 cell 尺寸变化），因此额外盯一段
    // 祖先链的 style 变化，拖拽过程中主对话内容能即时跟随，而不是等 300ms 轮询。
    const watched: Element[] = []
    // 链长放宽到 10 层：宿主写变量的元素可能高于 scrollBody；写入侧已做幂等
    // 守卫，多盯几层不会自激。
    for (let node = cell.parentElement, i = 0; node && i < 10; node = node.parentElement, i++) watched.push(node)
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

/**
 * 宿主「对话内容宽度」的像素值（横向拖拽的结果）。
 *
 * 宿主 ConversationWidthControls 拖拽横向把手时只做一件事：把
 * `--dsh-chat-user-width`（px）写到会话列的父元素上；会话 body 再据此算出
 * `--dsh-chat-content-width = var(--dsh-chat-user-width, clamp(680px, 列宽×0.64, 920px))`，
 * 用它限制消息列与输入框卡片。
 *
 * 工作台的 DSH 主对话是我们自己渲染的（MsgList），原本不吃这个变量，
 * 于是拖拽只改了宿主原生输入框、对话内容纹丝不动。这里把同一个宽度读出来，
 * 交给主对话内容与停靠的输入条共用，拖拽才同时作用于两者。
 *
 * 无拖拽偏好时按宿主同款 clamp 兜底（否则宽度无从谈起）。
 * @param el - 工作台内任一后代元素（变量由祖先继承下来）
 * @returns 内容宽度（px）
 */
function hostContentWidthPx(el: HTMLElement): number {
  const cs = getComputedStyle(el)
  const user = parseFloat(cs.getPropertyValue('--dsh-chat-user-width') || '')
  if (Number.isFinite(user) && user > 0) return user
  const column = parseFloat(cs.getPropertyValue('--dsh-conversation-column-width') || '')
  const base = Number.isFinite(column) && column > 0 ? column : el.clientWidth
  return Math.max(680, Math.min(base * 0.64, 920))
}

/** 注意：`onBack` 仍保留在 Props 里（调用方照传），但标题行不再渲染返回按钮——
 *  返回项目列表改由左侧边栏的「项目中心」入口承担（用户要求左侧只留项目名）。 */
// —— 切会话性能：按项目缓存探索者列表与预览探测结果 ——
// conversation.view 按会话作用域重挂：切会话 = 整个 HDesk 重建。首帧若从空状态起步，
// 探索者窗口/预览条会「先消失再出现」，且首轮网络与切换抢资源。
// 用模块级缓存做首屏种子（切回来的瞬间即还原，不空窗、不闪），
// 真正的网络结果延后 400~500ms 再到，刷新后覆盖。键为项目路径，不会串台。
const EXPLORER_CACHE = new Map<string, TelemetrySession[]>()
const DEVINFO_CACHE = new Map<string, ProjectInfo>()
/** 首帧是否已有可用预览（只查模块缓存，不发请求）：供「有预览的项目默认只呈现预览」
 *  做无闪烁种子——缓存命中时主对话首帧即收起，不用先闪出来再被收走。 */
function cachedPreviewAvailable(path: string): boolean {
  const info = DEVINFO_CACHE.get(path)
  return !!info && absoluteUrl(info.devUrl || '') !== ''
}

export function HDesk({ project, sessionId }: Props) {
  const [explorers, setExplorers] = useState<TelemetrySession[]>(() => EXPLORER_CACHE.get(project.path) ?? [])
  const [winState, setWinState] = useState<Record<string, WinState>>({})
  const [overlayId, setOverlayId] = useState<string | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  // 项目预览：探测结果（devUrl / 是否在跑）、预览条高度、iframe 重挂计数
  const [devInfo, setDevInfo] = useState<ProjectInfo | null>(() => DEVINFO_CACHE.get(project.path) ?? null)
  const [previewH, setPreviewH] = useState<number>(() => readPreviewHeight())
  const [previewReload, setPreviewReload] = useState(0)
  // 默认（未唤醒 tokensave、无探索者）只呈现「DSH 主对话」：黑板 / 协作对话 / 协作收益
  // 一律以「已关闭」形式列在标题行里，可单独点开恢复 —— 这正是「隐藏窗口明示」的落点。
  // 例外：有项目预览的项目默认只呈现预览，主对话同样以 chip 形式留在标题行可恢复。
  const [cards, setCards] = useState<Record<string, CardState>>({
    board: { ...CARD_DEFAULT, hidden: true },
    // 有项目预览的项目：进工作台默认只呈现预览，主对话收进「已关闭」chip（点即恢复）
    chat: { ...CARD_DEFAULT, hidden: cachedPreviewAvailable(project.path) },
    talk: { ...CARD_DEFAULT, hidden: true },
    save: { ...CARD_DEFAULT, hidden: true },
    preview: CARD_DEFAULT,
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
      EXPLORER_CACHE.set(project.path, list)
      setExplorers(list)
      reportExplorerCount(list.length)
      setProbeError(null)
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : '探索者探测失败')
    }
  }, [project.path])

  useEffect(() => {
    // 首次探测延后 500ms：让路给切会话的首帧/主线程（首屏已有上面的缓存种子，不空窗）。
    const first = window.setTimeout(probe, 500)
    const timer = setInterval(probe, 8_000)
    return () => { window.clearTimeout(first); clearInterval(timer) }
  }, [probe])

  // 项目预览的探针：解析 devUrl / 是否在监听。
  // 两个要点（修复「进入工作台时预览闪屏抖动」）：
  //   ① 拉取失败**不**清空上一次结果——否则面板会消失又出现，看着像闪屏；
  //   ② 值未变就不写 state——否则每 10s 一次无意义的重渲染。
  useEffect(() => {
    let alive = true
    const tick = async () => {
      const next = await fetchProjectInfo(project.path)
      if (!alive || !next) return
      DEVINFO_CACHE.set(project.path, next)
      setDevInfo((prev) =>
        prev && prev.devUrl === next.devUrl && prev.devRunning === next.devRunning && prev.mtimeMs === next.mtimeMs
          ? prev
          : next,
      )
    }
    // 首次 tick 延后 400ms（同 probe）：首屏用缓存种子，网络让给切换本身。
    const first = window.setTimeout(tick, 400)
    const timer = window.setInterval(tick, 10_000)
    return () => {
      alive = false
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [project.path])

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
  // 工作台是**派生态**的单窗口 / H 台切换：只要「黑板 / 协作对话 / 协作收益」三者都仍
  // 处于关闭、且没有任何可见的探索者窗口，就收成只有 DSH 主对话的单窗口；恢复其中任意
  // 一个窗口（或探索者出现）即自动回到 H 台 —— 不额外存一份布局状态。
  const extraShown =
    visible.length > 0 || !cardOf('board').hidden || !cardOf('talk').hidden || !cardOf('save').hidden
  const compact = !extraShown

  // 探索者一出现（tokensave_delegate 跑起来）就把黑板 / 协作对话 / 协作收益 一并放出，
  // 保持既有的「跑起来自动还原 H 台」行为；只做一次，之后不再抢用户手动收起的选择。
  const autoRevealed = useRef(false)
  useEffect(() => {
    if (autoRevealed.current || explorers.length === 0) return
    autoRevealed.current = true
    setCards((prev) => ({
      ...prev,
      board: { ...(prev.board || CARD_DEFAULT), hidden: false },
      talk: { ...(prev.talk || CARD_DEFAULT), hidden: false },
      save: { ...(prev.save || CARD_DEFAULT), hidden: false },
    }))
  }, [explorers.length])

  // —— 项目预览（台顶一条，不在 H 台网格里）——
  // 「项目能显示预览时才显示预览窗口」：拿不到可用 devUrl 就整块不渲染。
  const previewUrl = absoluteUrl(devInfo?.devUrl || '')
  const previewAvailable = previewUrl !== ''
  const previewState = cardOf('preview')
  // 恢复条要能列出所有被关闭的卡（含预览）；预览不可用时它不该出现
  const allCards = previewAvailable ? [PREVIEW_CARD, ...CARD_LABELS] : CARD_LABELS
  /** 铺满的那张卡（含预览）；浮层独占渲染，网格里不再重复实例 */
  const maximizedCard = allCards.find((c) => cardOf(c.id).maximized)?.id ?? null
  const previewInStrip = previewAvailable && !previewState.hidden && !previewState.maximized
  // —— DSH 主对话卡的呈现态（提前算：台面空置判定与停靠共用）——
  // 铺满时停靠到浮层里的那张卡；收起/关闭时既不停靠，也**不留输入框**（见下方 nochat 标记）。
  const chatState = cardOf('chat')
  const chatMaximized = chatState.maximized
  const chatDocked = chatMaximized || (!chatState.collapsed && !chatState.hidden)
  // 用户手动收放过主对话（恢复 chip / 一键切换 / 卡片 ✕）后，预览的显隐不再替他做主。
  const chatChoiceRef = useRef(false)
  // 有预览 → 默认只呈现预览（主对话收进「已关闭」chip）；无预览 → 呈现主对话。
  // 预览探测晚到（缓存未命中）或 dev server 停掉时在这里收/放一次。
  useEffect(() => {
    if (chatChoiceRef.current) return
    setCards((prev) => {
      const want = previewAvailable // 主对话默认隐藏 ⇔ 有可用预览
      if (!!prev.chat?.hidden === want) return prev
      return { ...prev, chat: { ...(prev.chat || CARD_DEFAULT), hidden: want } }
    })
  }, [previewAvailable])
  // 台面空置：主对话未呈现（已关闭/铺满浮层），且没有探索者、其余卡片全关
  // → 整块 .ts-desk 不渲染（不留空的中下格外框），预览条撑满标题行以下的全部高度。
  const deskEmpty = compact && (chatState.hidden || chatState.maximized)
  const showSplitter = previewInStrip && !previewState.collapsed && !deskEmpty

  // —— 标题行「已关闭列表」：卡片（含预览）与探索者窗口统一收口 ——
  // 全部窗口都呈现时 closedItems 为空 → 该区域自然消失（「只有全部呈现才消失」）。
  const closedItems: ClosedWindowItem[] = [
    ...allCards
      .filter((c) => cardOf(c.id).hidden)
      .map((c) => ({ id: c.id, label: c.label, kind: 'card' as const })),
    ...hidden.map((s) => ({ id: s.id, label: labelOf(s), kind: 'explorer' as const })),
  ]
  /** 点 chip 恢复单个窗口（可选择性恢复）。 */
  const restoreWindow = (item: ClosedWindowItem) => {
    if (item.kind === 'card') {
      if (item.id === 'chat') chatChoiceRef.current = true
      setCard(item.id, { hidden: false })
    } else setStateOf(item.id, { hidden: false })
  }
  /** 标题行一键切换：在「全部窗口」与「仅呈现一个窗口」之间换挡 ——
   *  有预览只留「项目预览」，无预览只留「DSH 主对话」。 */
  const allShown = closedItems.length === 0
  const toggleAllWindows = () => {
    chatChoiceRef.current = true // 一键切换即显式选择，之后预览显隐不再自动干预主对话
    if (allShown) {
      // 只保留一个窗口：有预览 →「项目预览」；无预览 →「DSH 主对话」。
      // 其余卡片与探索者窗口全部关闭 —— 主对话收进「已关闭」chip，可随时点回。
      const keep = new Set([previewAvailable ? 'preview' : 'chat'])
      // 探索者「最大化」走的是独立浮层：收成 focus 时必须一并退出，否则浮层仍会盖着。
      setOverlayId(null)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      setCards((prev) => {
        const out: Record<string, CardState> = { ...prev }
        for (const c of allCards) {
          out[c.id] = { ...(prev[c.id] || CARD_DEFAULT), hidden: !keep.has(c.id), maximized: false }
        }
        return out
      })
      setWinState((prev) => {
        const out: Record<string, WinState> = { ...prev }
        for (const s of explorers) {
          out[s.id] = { ...(prev[s.id] || { collapsed: false, hidden: false }), hidden: true }
        }
        return out
      })
    } else {
      // 全部放出：卡片 + 探索者窗口一律恢复（不动各自的收起 / 铺满状态）
      setCards((prev) => {
        const out: Record<string, CardState> = { ...prev }
        for (const c of allCards) out[c.id] = { ...(prev[c.id] || CARD_DEFAULT), hidden: false }
        return out
      })
      setWinState((prev) => {
        const out: Record<string, WinState> = { ...prev }
        for (const s of explorers) {
          out[s.id] = { ...(prev[s.id] || { collapsed: false, hidden: false }), hidden: false }
        }
        return out
      })
    }
  }

  // 网格行数：黑板占 1..R-1，中下占 R；左右两竖跨满 —— 探索者增多即均分
  const rows = Math.max(left.length, right.length, 2)
  // 中下格随窗口数/布局变化 → 停靠持续跟随（deps 覆盖重排）
  useDockNativeComposer(
    chatMaximized ? overlayChatRef : chatCellRef,
    chatDocked,
    // 不再把 previewH 放进依赖：拖分隔条时 chat cell 尺寸变化会经它自己的
    // ResizeObserver 触发重定位；把高度写进依赖会让每次拖动都重建观察器（拖拽发卡）。
    [rows, compact, sessionId, visible.length, chatMaximized, previewInStrip],
  )

  // 停靠期间给 body 加标记：宿主输入条**座位**自带「透明 → 宿主底色」渐变，
  // 底部 36px 完全不透明，会在输入框下方压出一块深色背景板；用这个标记把它置透明
  // （样式见 styles.ts 的 body.ts-hdesk-dock）。
  useEffect(() => {
    if (!chatDocked) return
    document.body.classList.add('ts-hdesk-dock')
    return () => document.body.classList.remove('ts-hdesk-dock')
  }, [chatDocked])

  // 主对话卡未呈现（已关闭/收起）时，输入条既不停靠、也不独自悬在预览/台面下方：
  // 整条隐藏（同「项目中心」的做法，样式见 styles.ts 的 body.ts-hdesk-nochat）。
  // 恢复主对话卡（标题行「＋ DSH 主对话」chip / 一键切换）即原样回来——
  // display:none 不卸载节点，宿主状态不丢。用 layout effect：避免首帧闪一下输入条。
  useLayoutEffect(() => {
    if (chatDocked) return
    document.body.classList.add('ts-hdesk-nochat')
    return () => document.body.classList.remove('ts-hdesk-nochat')
  }, [chatDocked])

  /** 卡片三键：构造后交给各卡片渲染进自己的标题条 */
  const actionsFor = (id: string, label: string) => {
    const st = cardOf(id)
    return (
      <CardActions
        state={st}
        label={label}
        onToggleCollapse={() => setCard(id, { collapsed: !st.collapsed })}
        onToggleMax={() => toggleMax(id)}
        onHide={() => { if (id === 'chat') chatChoiceRef.current = true; setCard(id, { hidden: true }) }}
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

  /**
   * 拖动预览条与下方工作台之间的分隔条：总高度不变，上面变高下面就变矮。
   *
   * 性能：pointermove 的触发频率可达 100–1000Hz（高刷鼠标/触控板），而工作台是
   * 一棵很重的树（黑板/主对话/探索者/iframe）。所以：
   *   1. **按帧合并**：一帧最多 setState 一次，而不是每个事件一次；
   *   2. 拖动期间给 body 加 .ts-vsplit-dragging：iframe 屏蔽指针事件 + 禁止选中文字
   *      —— 这两者是拖拽时的主要闪屏源（iframe 频繁重绘 + 命中区抢事件导致抖动）。
   *
   * 结束拖拽必须**万无一失**（Bug 反馈：往上拖松手后，鼠标再往下动，分界线又跟着走，
   * 说明拖动没结束——pointerup 丢了而监听还挂着）。因此三重保险：
   *   A. `setPointerCapture`：指针滑出分隔条/窗口，pointerup 也一定回到这里；
   *   B. pointerup/pointercancel 用**捕获阶段**监听（+ window blur / visibilitychange）：
   *      即使某个中间元素对指针事件做了 stopPropagation 也能收到；
   *   C. **buttons 兜底**：松手后再来的 pointermove 带 `buttons === 0`（没有任何键按下）——
   *      那就是“已松手”的铁证，立即结束，不再跟随鼠标。
   */
  const onSplitDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    const pointerId = e.pointerId
    const startY = e.clientY
    const startH = previewH
    const rootH = rootRef.current?.getBoundingClientRect().height ?? 0
    const maxH = Math.max(PREVIEW_H_MIN, rootH - PREVIEW_DESK_MIN)
    let last = startH
    let raf = 0
    let done = false
    const flush = () => {
      raf = 0
      setPreviewH(last)
    }
    const move = (ev: PointerEvent) => {
      // C. 已经松手了（例如在窗口外/被别的元素吃掉 pointerup）：不再跟随鼠标。
      if (ev.buttons === 0) { end(); return }
      last = Math.min(maxH, Math.max(PREVIEW_H_MIN, startH + (ev.clientY - startY)))
      // 一帧只提交一次（下一次帧回调前到达的事件直接合并）
      if (!raf) raf = requestAnimationFrame(flush)
    }
    const end = () => {
      if (done) return   // 多重结束信号（up/cancel/blur/buttons）只跑一次
      done = true
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)
      window.removeEventListener('blur', end)
      document.removeEventListener('visibilitychange', onVisibility)
      try { el.releasePointerCapture(pointerId) } catch { /* 已自动释放 */ }
      document.body.classList.remove('ts-vsplit-dragging')
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
      // 无条件提交最终值：拖着一半松手（或被系统 cancel）也要停在松手处；
      // 值未变时 React 会自己跳过重渲染，无额外开销。
      setPreviewH(last)
      savePreviewHeight(last)
    }
    const onVisibility = () => { if (document.hidden) end() }
    // A. 指针捕获：拖出元素/窗口也不丢事件
    try { el.setPointerCapture(pointerId) } catch { /* 合成事件或旧浏览器 */ }
    document.body.classList.add('ts-vsplit-dragging')
    window.addEventListener('pointermove', move)
    // B. 捕获阶段：中间元素 stopPropagation 也不影响结束
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)
    window.addEventListener('blur', end)
    document.addEventListener('visibilitychange', onVisibility)
  }

  return (
    <div className="ts-cr ts-hdesk" ref={rootRef} style={{ padding: 8 }}>
      <div className="ts-bar">
        {/* 左侧只留项目名（显著标识）：原「← 项目中心」按钮与项目路径已移除，
            返回项目列表改由左侧边栏的「项目中心」入口承担。 */}
        <span className="ts-title ts-title-proj" title={project.path}>
          <span className="ts-title-proj-icon" aria-hidden="true">🗂</span>
          <span className="ts-title-proj-name">{project.name}</span>
        </span>
        {/* 右侧区域顺序固定：已关闭列表 → 一键切换 → 探索者设置 → 历史会话 / 新建会话 */}
        <span className="ts-bar-right ts-bar-tools">
          <ClosedWindowsBar items={closedItems} onRestore={restoreWindow} />
          <button
            className="ts-btn ts-btn-mode"
            onClick={toggleAllWindows}
            title={
              allShown
                ? '当前：全部窗口已呈现 · 点击只保留「项目预览」（无预览时为「DSH 主对话」）'
                : '当前：部分窗口已关闭 · 点击放出全部窗口（DSH 主对话 / 黑板 / 探索者 / 协作对话 / 协作收益）'
            }
          >
            一键切换
          </button>
          {/* 探索者设置：浮动面板里按 默认 / 免费 / 收费 三组开关探索者 */}
          <ExplorerSettings />
          <SessionPicker
            sessions={sessions}
            currentId={sessionId}
            onPick={(id) => {
              if (id === sessionId) return
              // 先写「已进入的工作台」记忆，再导航：ControlRoom 重挂时首帧就按记忆进 H 台。
              // 等 5s 一次的 sweep 补记忆会留下闪现引导页的窗口（且记忆晚到时
              // bindToProject 不一定发工作台信号，见 sessions.ts）。
              rememberOpenedProject(id, project.id)
              if (!openSession(id)) {
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
            onArchived={(id) => {
              // 归档当前会话后宿主会 clearMain()（界面掉进「新建会话」Hero）：
              // 立刻把界面拉回本项目的工作台（打开别的会话，或新建一个空白会话）。
              if (id !== sessionId) return
              try {
                stayInProjectAfterArchive(project.path, project.id, id)
              } catch (e) {
                console.warn('[tokensave] 归档后留在工作台失败', e)
              }
            }}
          />
        </span>
      </div>

      {/* 项目预览：标题行（项目名 + 历史会话 + 新建会话）之下、其它窗口之上；
          能给出可用 devUrl 才渲染（见 previewInStrip）。三键在最右（刷新/新窗口之后）。 */}
      {previewInStrip && (
        <div
          className="ts-preview-strip"
          style={previewState.collapsed
            ? undefined
            : deskEmpty
              // 台面空置（只呈现预览）：预览条撑满标题行以下的全部高度
              ? { flex: '1 1 auto', minHeight: 0 }
              : { height: previewH }}
        >
          {cardShell('preview', (
            <PreviewPanel
              project={project}
              url={previewUrl}
              devRunning={devInfo?.devRunning === true}
              reloadKey={previewReload}
              onReload={() => setPreviewReload((k) => k + 1)}
              actions={actionsFor('preview', '项目预览')}
            />
          ), 'ts-card-fill')}
        </div>
      )}
      {/* 预览 ↔ 工作台 的上下分隔条：拖动即互相挤压（总高度不变） */}
      {showSplitter && (
        <div
          className="ts-vsplit"
          role="separator"
          aria-orientation="horizontal"
          title="上下拖动：调整预览与工作台的高度"
          onPointerDown={onSplitDown}
        >
          <span className="ts-vsplit-grip" aria-hidden="true" />
        </div>
      )}

      {probeError && <div className="ts-hint">⚠️ {probeError}</div>}

      {/* 行轨道同样用 minmax(0, 1fr)：裸 1fr 的自动最小值是 min-content，
          卡片里的长内容会把行撑高，把网格顶出容器（与列同款问题）。 */}
      {/* —— 单棵稳定树：compact ⇄ H 台 只改布局样式，**不重挂卡片** ——
          以前这里是 `compact ? <单窗口树> : <H 台树>` 两个分支：布局一翻，React
          就把整棵子树卸载重建，中下格的 MainChat/MsgList 连同它内部 `.ts-chat-msgs`
          的 scrollTop、展开态、轮数窗口全部归零——用户看到的就是「时不时刷一下、
          对话跳回更早，还得重新拉到底」。
          现在只留一棵树：切换布局只更新 grid 样式，聊天卡片的组件实例与 DOM 节点
          原样保留（滚动位置、展开态、已加载的历史都不丢）。
          DOM 顺序把主对话放在 index 0：compact 下其余格子渲染成 false 也不会
          挤动它的位置；视觉位置仍由各格子自己的 grid-row/grid-column 决定。 */}
      {/* 台面空置（只呈现预览）时整块不渲染：否则会留下空的中下格外框/空网格。 */}
      {!deskEmpty && (
      <div
        className="ts-desk"
        style={compact
          ? { gridTemplateRows: 'minmax(0,1fr)', gridTemplateColumns: 'minmax(0,1fr)' }
          : { gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {/* 中下：DSH 主对话卡片 —— 消息流就地渲染 + 宿主原生输入条停靠。
            两种布局下都渲染在**同一个 child index**，因此布局切换时组件实例不重建。 */}
        <div
          className={`ts-desk-chat${chatState.hidden || chatState.maximized ? ' ts-desk-chat-empty' : ''}`}
          style={compact ? { gridRow: '1', gridColumn: '1' } : { gridRow: String(rows) }}
          ref={chatCellRef}
        >
          {cardShell('chat', (
            <MainChat sessionId={sessionId} actions={actionsFor('chat', 'DSH 主对话')} />
          ), 'ts-card-fill')}
        </div>
        {/* 左竖：顶部协作对话（主 agent ↔ 探索者），下方探索者窗口等高均分。
            compact（未唤醒 tokensave）时整列不渲染——省掉它的订阅与 DOM。 */}
        {!compact && (
          <div className="ts-desk-col ts-desk-left">
            {cardShell('talk', (
              <TalkColumn
                sessionId={sessionId}
                explorers={visible}
                actions={actionsFor('talk', '协作对话')}
              />
            ), `ts-card-talk${left.length === 0 ? ' ts-card-talk-solo' : ''}`)}
            {left.map(renderWin)}
          </div>
        )}
        {/* 中上：共享黑板（跨 1..R-1 行，底边与左右列缝隙对齐，无横线） */}
        {!compact && (
          <div className="ts-desk-board" style={{ gridRow: `1 / ${rows}` }}>
            {cardShell('board', (
              <Blackboard workspace={project.path} actions={actionsFor('board', '共享黑板')} />
            ), 'ts-card-fill')}
          </div>
        )}
        {/* 右竖：顶部协作收益（省 token/费用 vs 等待时间），下方探索者窗口 */}
        {!compact && (
          <div className="ts-desk-col ts-desk-right">
            {cardShell('save', (
              <SavingsColumn
                sessionId={sessionId}
                explorers={visible}
                actions={actionsFor('save', '协作收益')}
              />
            ), `ts-card-save${right.length === 0 ? ' ts-card-save-solo' : ''}`)}
            {right.map(renderWin)}
          </div>
        )}
        {/* 最大化/双击全屏的浮层（放在最后：它的增删不会挤动前面的格子） */}
        {!compact && overlaid && (
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
            {maximizedCard === 'preview' && (
              <PreviewPanel
                project={project}
                url={previewUrl}
                devRunning={devInfo?.devRunning === true}
                reloadKey={previewReload}
                onReload={() => setPreviewReload((k) => k + 1)}
                actions={actionsFor('preview', '项目预览')}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
