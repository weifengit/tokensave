/**
 * H 型工作台（唯一布局模式，无中横线）
 * ┌────左竖────┬────中上：共享黑板────┬────右竖────┐
 * │  免费模型   │                     │  免费模型   │
 * │  窗口×N    ├─────────────────────┤  窗口×M    │
 * │           │  中下：DSH 主对话    │           │
 * └───────────┴─────────────────────┴───────────┘
 * - 三列固定比例 1.5 : 7 : 1.5；某列一个可见窗口都不剩时整列移出网格、份额并给
 *   邻列（缺失补位，见 DESK_COLUMNS）：左空 → 中 8.5 : 右 1.5；右空 → 左 1.5 : 中 8.5；
 *   中空 → 左 8.5 : 右 1.5（用户要求「中列全关时用左列扩展」）；只剩一列则该列铺满。
 * - 中列上=共享黑板、下=DSH 主对话，中间一条**可拖**的上下分隔条（比例写进布局快照）；
 *   任一方被关掉或收起，另一方自动铺满整列（两格共用一套 flex-grow 分配）。列内窗口 flex:1 均分。
 * - 中下格内嵌 DSH 主对话只读消息流（MainChat），并把宿主原生输入条
 *   （conversation.composer，每个 tab 常驻）position:fixed 停靠在消息流下方，
 *   卸载/切 tab 自动还原。
 * - 有「项目预览」的项目：进入工作台默认**只呈现预览** —— DSH 主对话收进标题行
 *   「已关闭」条的「＋ DSH 主对话」chip（点即恢复），其外框（.ts-desk-chat）与宿主
 *   输入条一并隐藏（styles.ts 的 body.ts-hdesk-nochat）；台面空置时 .ts-desk 整块
 *   不渲染、预览条撑满剩余高度 —— 界面里不出现任何对话框（与「项目中心」一致）。
 * - 顶部标题行（左→右）：项目名（胶囊按锁定态分色）→ 布局锁按钮 → 已关闭列表
 *   → 一键切换 → 探索者设置 → 历史会话 / 新建会话。
 * - 布局锁（默认锁定）：锁定后，从任何入口（项目中心 / 侧边栏 / 同项目的另一条对话）
 *   回到本项目的工作台，都按固化下来的布局还原；台内的一键切换 / 卡片三键 / 探索者
 *   窗口三键 / 预览条高度照常可用，且改动会即时重新固化。解锁则每次进入都回默认布局。
 *   实现见 desk-layout.ts（按项目 id 存在 localStorage，与项目注册表分开）。
 * - 工作台默认铺满，并**禁用宿主那套宽度把手**：就是鼠标在对话两侧变成左右双向箭头、
 *   拖动即改「聊天内容宽度」的那个功能（body.ts-hdesk-open 下 [data-width-handle] 隐藏）。
 *   它是宿主全局偏好（值写在共享父元素上），与「工作台铺满」语义冲突，且会把卡片拖窄。
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
import { useProjectSessions, openSession, startProjectSession, latestProjectSession, sessionBelongsToProject, stayInProjectAfterArchive, isExplorerSessionId } from './sessions'
import { getClientContext } from '../session-subscribe'
import { rememberOpenedProject } from './store'
import type { ProjectRecord } from './store'
import type { CardState, WinState } from './desk-types'
import { loadDeskPref, saveDeskPref, setDeskLocked } from './desk-layout'
import type { DeskLayout } from './desk-layout'
import { takeFirstSeenClosures } from './desk-win-seed'

import { PreviewPanel, absoluteUrl } from './PreviewPanel'
interface Props {
  project: ProjectRecord
  sessionId: string
  /**
   * 本次进入是否为「去调试」（项目卡片上那枚启动标的超链接）。
   *
   * 由 ControlRoom 读**按项目留存**的意图（sessions.peekWorkbenchIntent）后传入，
   * 而不是 HDesk 自己读：HDesk 会在换项目时重挂，自己读会把同一个意图吃掉两次、
   * 让用户后来正常进入别的项目时也被当成「去调试」。
   */
  debug?: boolean
  onBack: () => void
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
/** 中列默认对半分（布局快照里没存过比例时的落点） */
const MID_SPLIT_DEFAULT = 0.5
/**
 * 中列两格的 flex-grow 放大倍数。
 *
 * 必须乘以一个把**总和抬到 1 以上**的系数：flexbox 规定「增长系数之和 < 1 时，
 * 只按这个和的比例分配剩余空间」——直接用 0.5 / 0.5 时，单格独存（另一格被关掉）
 * 就只能拿到中列的一半高度（实测 764px 的列只剩 391px）。乘 1000 后两格之和远大于 1，
 * 比例分配与「只剩一格就铺满」都符合直觉。
 */
const MID_GROW_SCALE = 1000
/** 中列上下两格的最小高度（px）：拖分隔条时不许把任何一格压没 */
const MID_CELL_MIN = 110
/**
 * 列轨道模板（缺失补位）：按「哪几列还有可见窗口」取轨道。
 * 份额归属：某列全关时它的份额并给**邻列**（中列优先吸收）；中列自己空了则由左列
 * 吸收 —— 用户要求「中间的窗口全部关闭时，用左边的窗口扩展过去」。
 * 1.5 : 7 : 1.5 是用户指定的固定比例（三列俱全时）；只剩一列则该列铺满。
 */
const DESK_COLUMNS: Record<string, string> = {
  'left,mid,right': 'minmax(0,1.5fr) minmax(0,7fr) minmax(0,1.5fr)',
  'left,mid': 'minmax(0,1.5fr) minmax(0,8.5fr)',
  'mid,right': 'minmax(0,8.5fr) minmax(0,1.5fr)',
  'left,right': 'minmax(0,8.5fr) minmax(0,1.5fr)',
  left: 'minmax(0,1fr)',
  mid: 'minmax(0,1fr)',
  right: 'minmax(0,1fr)',
}

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

/** 默认布局（未锁定 / 从未固化时的落点）——与历史行为完全一致。 */
function defaultCards(project: ProjectRecord, debug?: boolean): Record<string, CardState> {
  return {
    board: { ...CARD_DEFAULT, hidden: true },
    // 有项目预览的项目：进工作台默认只呈现预览，主对话收进「已关闭」chip（点即恢复）；
    // 从卡片「去调试」进来时两窗并存（debug 为 true，主对话不收起）。
    chat: { ...CARD_DEFAULT, hidden: !debug && cachedPreviewAvailable(project.path) },
    talk: { ...CARD_DEFAULT, hidden: true },
    save: { ...CARD_DEFAULT, hidden: true },
    preview: CARD_DEFAULT,
  }
}

/**
 * 锁定态：按快照恢复窗口布局。
 *
 * 快照里没有的卡片（版本升级后新增的）用默认值补齐，因此旧快照也能安全升级——
 * 不会因为「快照是上个版本存的」就把新卡片漏成 undefined。
 */
function restoreCards(
  layout: DeskLayout | null,
  project: ProjectRecord,
  debug?: boolean,
): Record<string, CardState> {
  const out = defaultCards(project, debug)
  if (!layout) return out
  for (const id of Object.keys(out)) {
    const c = layout.cards[id]
    if (c) out[id] = { collapsed: c.collapsed, hidden: c.hidden, maximized: c.maximized }
  }
  return out
}

export function HDesk({ project, sessionId, debug }: Props) {
  const [explorers, setExplorers] = useState<TelemetrySession[]>(() => EXPLORER_CACHE.get(project.path) ?? [])

  // BUG-2：探索者严禁出现在「DSH 主对话」卡。用户从侧边栏点到探索者会话时，
  // 宿主把工作台视图绑到了那条会话——主对话卡若直接渲染它就等于探索者混进主对话。
  // 这里回退到项目自己的最新非探索者会话（无则空 → MainChat 已处理空态）。
  const mainChatSessionId =
    isExplorerSessionId(sessionId) ? (latestProjectSession(getClientContext(), project.path)?.id ?? '') : sessionId
  // —— 项目布局锁（按项目 id 固化布局）——
  // 首帧就按「锁定态快照」摆好窗口（惰性初始化），从别处跳回来时不会先闪一下默认布局。
  // 例外：「去调试」是一次**显式**的进入意图（要预览 + 主对话两窗并存），不锁——照旧走默认。
  // 惰性读一次：useRef 的参数**每次渲染都会求值**，而 HDesk 渲染很频繁
  //（探索者 8s 轮询、输入条停靠跟随等），把 localStorage 的读+解析放进去是白烧。
  const [initialPref] = useState(() => loadDeskPref(project.id))
  const [layoutLocked, setLayoutLocked] = useState<boolean>(() => initialPref?.locked ?? true)
  /** 本次进入要恢复的快照（锁定 + 有固化 + 非「去调试」时才有值）。 */
  const seedRef = useRef<DeskLayout | null>(
    !debug && initialPref?.locked ? (initialPref.layout ?? null) : null,
  )
  // 恢复锁定布局 = 用户的显式选择：抑制两条「默认规则」——有预览就自动收起主对话、
  // 探索者出现就自动放出三卡——否则它们会把刚恢复的布局当场改掉（锁定也就白锁了）。
  const chatChoiceRef = useRef(!!seedRef.current)
  const autoRevealed = useRef(!!seedRef.current)
  const [winState, setWinState] = useState<Record<string, WinState>>(
    () => (seedRef.current ? { ...seedRef.current.winState } : {}),
  )
  const [overlayId, setOverlayId] = useState<string | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  // 项目预览：探测结果（devUrl / 是否在跑）、预览条高度、iframe 重挂计数
  const [devInfo, setDevInfo] = useState<ProjectInfo | null>(() => DEVINFO_CACHE.get(project.path) ?? null)
  const [previewH, setPreviewH] = useState<number>(() => {
    const stored = seedRef.current?.previewH ?? 0
    return stored > 0 ? stored : readPreviewHeight()
  })
  /**
   * 中列「上格（共享黑板）占中列高度的比例」：拖中列那条上下分隔条改写它，
   * 随布局快照一起固化（锁定态下切走再回来仍是这个高度）。0 = 快照没存过 → 对半分。
   */
  const [midSplit, setMidSplit] = useState<number>(() => {
    const stored = seedRef.current?.midSplit ?? 0
    return stored > 0 ? stored : MID_SPLIT_DEFAULT
  })
  const [previewReload, setPreviewReload] = useState(0)
  // 默认（未唤醒 tokensave、无探索者）只呈现「DSH 主对话」：黑板 / 协作对话 / 协作收益
  // 一律以「已关闭」形式列在标题行里，可单独点开恢复 —— 这正是「隐藏窗口明示」的落点。
  // 例外：有项目预览的项目默认只呈现预览，主对话同样以 chip 形式留在标题行可恢复。
  const [cards, setCards] = useState<Record<string, CardState>>(
    () => (seedRef.current ? restoreCards(seedRef.current, project, debug) : defaultCards(project, debug)),
  )
  const overlayRef = useRef<HTMLDivElement>(null)
  const chatCellRef = useRef<HTMLDivElement>(null)
  /** 中列容器与上格（共享黑板）格：拖上下分隔条时按帧直接改两格的 flex-grow */
  const midRef = useRef<HTMLDivElement>(null)
  const boardCellRef = useRef<HTMLDivElement>(null)
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

  // —— 布局锁（默认开启）——
  //
  // 锁定态下，把当前布局随每一次窗口变动固化到项目上；解锁后不再回写，快照冻结在
  // 解锁前的最后一帧（用户再锁回来仍能恢复他上次摆好的布局，而不是被清成默认）。
  //
  // 为什么固化只能放在这里、不能写进 setCard / toggleAllWindows 等每个改动点：
  // 那些地方同时改 cards 与 winState 两个 state，若各自落库就会用「另一半还是旧值」
  // 的快照互相覆盖（探索者窗口列表尤其容易丢）。以 state 为依赖的 effect 在本次渲染
  // 提交后、绘制前跑，拿到的必定是两者一致的完整快照，一处覆盖全部入口。
  //
  // 顺带覆盖一个细节：预览条高度也能记住。
  //
  // `debug`（「去调试」进入）不落库：那是一次**临时**的进入意图，若把它当成用户的布局
  // 固化下来，用户点一次「去调试」就会静默改写他锁定的布局——锁定也就名存实亡了。
  //
  // 写入用 **300ms 节流 + 尾包**（latestLayout 存最新值，卸载时再 flush 一次）：
  // 拖预览分隔条时 previewH 每帧都在变，直接写就是每帧一次 localStorage 同步写，
  // 而这棵台面本来就重（见 onSplitDown 的大段说明）。节流窗口结束前的新值只更新 ref，
  // 所以「拖着不停手」也只会每个窗口写一次，且写的一定是最新值。
  const latestLayout = useRef<DeskLayout | null>(null)
  const persistTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!layoutLocked || debug) {
      latestLayout.current = null
      return
    }
    latestLayout.current = { v: 1, cards, winState, previewH, midSplit }
    if (persistTimer.current !== null) return // 已有待写：新值已被 ref 接住
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null
      const snap = latestLayout.current
      if (snap) saveDeskPref(project.id, { locked: true, layout: snap })
    }, 300)
  }, [layoutLocked, debug, project.id, cards, winState, previewH, midSplit])

  // 卸载（切会话 / 换项目 / 离开工作台）前把待写的那一份落库：
  // 否则防抖窗口内的最后一次改动会被吞掉——那正是用户「拖完就切走」的常见路径。
  useEffect(() => () => {
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current)
      persistTimer.current = null
    }
    if (latestLayout.current) saveDeskPref(project.id, { locked: true, layout: latestLayout.current })
  }, [project.id])

  /** 标题行「锁定布局 / 解锁布局」按钮：切开关，并当场把快照对齐到用户意图。 */
  const toggleLayoutLock = () => {
    const next = !layoutLocked
    setLayoutLocked(next)
    // 开关一翻，待写入的那一份就作废：下面自己会写一次最新的。
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current)
      persistTimer.current = null
    }
    if (next) {
      // 重新锁定 → 立刻固化当前（解锁期间用户摆出来的）布局，不等节流窗口
      const snap: DeskLayout = { v: 1, cards, winState, previewH, midSplit }
      latestLayout.current = snap
      saveDeskPref(project.id, { locked: true, layout: snap })
    } else {
      // 解锁 → 只翻开关并停掉回写，**保留**快照（见 setDeskLocked 的说明）
      latestLayout.current = null
      setDeskLocked(project.id, false)
    }
  }

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
      // mount.tsx 已被并行会话移除；reportExplorerCount 是个无副作用的模块级变量赋值，
      // 去掉调用即可。
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

  // —— 探索者窗口的关闭态也要能恢复 ——
  //
  // 快照里记了「哪些探索者窗口当时是关闭的」，但探索者列表是 8s 轮询来的，首帧还在路上。
  // 这里在列表到达后做一次**只关不放**的补登：快照说关就关，没说就不动——于是
  //   ① 已固化「关掉」的探索者不会因为列表晚到就先闪出来；
  //   ② 快照里没有的新探索者默认呈现，探索者一跑起来该出现还是会出现。
  //
  // 关键：每个探索者**只补登一次**（按 id 记账，见 seedApplied）。seed 是**进入时**读的
  // （seedRef 冻结在挂载那一刻，之后不再更新），而 explorers 每 8s 轮询都会换一个新数组
  // 引用。若每轮都拿这份过期快照重放「只关不放」，用户手动放出的探索者窗口会在下一个
  // 轮询周期被重新关掉——实测：一键切换放出全部窗口后，隔几秒探索者集体自行关闭、列
  // 轨道随之塌缩，看着就像「屏幕自己刷了一下」；而这次重放还会被写回布局快照，于是
  // 「关掉」这个状态会一直粘住（再点开，几秒后又关）。按 id 记账后，之后一律以用户
  // 当场的三键选择为准。
  const seedApplied = useRef<Set<string>>(new Set())
  useEffect(() => {
    const seed = seedRef.current
    if (!seed || explorers.length === 0) return
    // 只对**本次首次出现**的探索者做补登；已经在场的（用户可能刚点开）绝不回关。
    // 「每个 id 只补登一次」的记账与自检见 desk-win-seed.ts。
    const toClose = takeFirstSeenClosures(seed, explorers.map((s) => s.id), seedApplied.current)
    if (toClose.length === 0) return
    setWinState((prev) => {
      let changed = false
      const out = { ...prev }
      for (const id of toClose) {
        if (out[id]?.hidden) continue
        out[id] = { ...(out[id] || { collapsed: false, hidden: false }), hidden: true }
        changed = true
      }
      return changed ? out : prev
    })
  }, [explorers])

  const stateOf = (id: string): WinState => winState[id] || { collapsed: false, hidden: false }
  const setStateOf = (id: string, patch: Partial<WinState>) =>
    setWinState((prev) => ({ ...prev, [id]: { ...stateOf(id), ...patch } }))

  const visible = explorers.filter((s) => !stateOf(s.id).hidden)
  const hidden = explorers.filter((s) => stateOf(s.id).hidden)
  const left = visible.filter((_, i) => i % 2 === 0)
  const right = visible.filter((_, i) => i % 2 === 1)
  const overlaid = overlayId ? explorers.find((s) => s.id === overlayId) : undefined
  // 单窗口 ⇄ H 台不在这里判：它只是「三列谁还有可见窗口」的派生态，
  // 落到下面的列轨道（DESK_COLUMNS）上——不额外存一份布局状态。

  // 探索者一出现（tokensave_delegate 跑起来）就把黑板 / 协作对话 / 协作收益 一并放出，
  // 保持既有的「跑起来自动还原 H 台」行为；只做一次，之后不再抢用户手动收起的选择。
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
  // 有预览 → 默认只呈现预览（主对话收进「已关闭」chip）；无预览 → 呈现主对话。
  // 预览探测晚到（缓存未命中）或 dev server 停掉时在这里收/放一次。
  useEffect(() => {
    // 「去调试」进来的那一次不适用：它要的是预览与主对话**并存**（且已由初始状态摆好），
    // 这里再插一手会把刚打开的主对话当场收走——正是用户点「去调试」时看到的闪没。
    if (chatChoiceRef.current || debug) return
    setCards((prev) => {
      const want = previewAvailable // 主对话默认隐藏 ⇔ 有可用预览
      if (!!prev.chat?.hidden === want) return prev
      return { ...prev, chat: { ...(prev.chat || CARD_DEFAULT), hidden: want } }
    })
  }, [previewAvailable, debug])
  // 「去调试」意图**后到**时（点卡片时工作台已经挂着，只剩 prop 变化）在这里把两窗摆开：
  // 预览本就已经呈现，只需要把被默认收起的 DSH 主对话放回来。若用户随后自己又收起了它，
  // chatChoiceRef 会置位，这里不再插手（与其它入口的手动选择语义一致）。
  useEffect(() => {
    if (!debug || chatChoiceRef.current) return
    setCards((prev) => (prev.chat && !prev.chat.hidden
      ? prev
      : { ...prev, chat: { ...(prev.chat || CARD_DEFAULT), hidden: false } }))
  }, [debug])
  // —— 三列「在不在」与列轨道（缺失补位）——
  //
  // 判定口径：**这一列里当前有没有可见窗口**（卡片被关掉、或被铺满浮层占走都不算）：
  // 有 → 留在网格里；没有 → 整列挂 ts-desk-empty 移出网格，份额按模板并给邻列。
  // 注意判断的是「渲染在格子里的」：铺满的卡片在浮层里，格子其实空着。
  const talkShown = !cardOf('talk').hidden && !cardOf('talk').maximized
  const saveShown = !cardOf('save').hidden && !cardOf('save').maximized
  const boardShown = !cardOf('board').hidden && !cardOf('board').maximized
  const chatShown = !chatState.hidden && !chatState.maximized
  const leftPresent = talkShown || left.length > 0
  const rightPresent = saveShown || right.length > 0
  const midPresent = boardShown || chatShown
  // 中列某一格「收起」（最小化）时它只占标题条高度、另一格自然铺满 —— 此时没有可调的
  // 分高，分隔条一并撤掉（对着一格标题条拖是拖不动的假动作）。
  const boardCollapsed = cardOf('board').collapsed
  const chatCollapsed = chatState.collapsed
  const midSplittable = boardShown && chatShown && !boardCollapsed && !chatCollapsed
  const presentKey = [leftPresent && 'left', midPresent && 'mid', rightPresent && 'right']
    .filter(Boolean)
    .join(',')
  const deskColumns = DESK_COLUMNS[presentKey] || DESK_COLUMNS['left,mid,right']
  // 台面空置：三列都没有可见窗口（只呈现预览 / 什么都没有）→ 整块 .ts-desk 不渲染
  // （不留空网格/空的中下格外框），预览条撑满标题行以下的全部高度。
  const deskEmpty = !leftPresent && !midPresent && !rightPresent
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

  // 中下格随窗口数 / 列轨道变化 → 停靠持续跟随（deps 覆盖重排）
  useDockNativeComposer(
    chatMaximized ? overlayChatRef : chatCellRef,
    chatDocked,
    // 不再把 previewH / midSplit 放进依赖：拖分隔条时 chat cell 尺寸变化会经它自己的
    // ResizeObserver 触发重定位；把高度写进依赖会让每次拖动都重建观察器（拖拽发卡）。
    [presentKey, sessionId, visible.length, chatMaximized, previewInStrip],
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

  // —— 工作台标记：宿主的「宽度把手」在这里必须失效 ——
  //
  // 宿主 ConversationWidthControls 在对话列两侧各渲染一条 [data-width-handle]
  // （10px 命中区、悬停光标变左右双向箭头），拖动即改写 --dsh-chat-user-width，也就是
  // 「放大 / 缩小聊天窗口内容宽度」那个功能。它是**全局偏好**（值写在共享父元素上，
  // 一处拖动处处生效），与工作台「铺满 + 自己排版」的语义冲突；而把手在台面上还横跨
  // 卡片，很容易误触。
  //
  // styles.ts 里 `body.ts-hdesk-open [data-width-handle]{display:none}` 就是这道闸门，
  // 但以前只有 CSS、没有类名（从未生效）—— 这里补上：进工作台即挂、离开即摘
  // （切到「对话」tab 时 HDesk 卸载，把手原样回来）。
  //
  // 同一个类还负责把宿主那条「随内容长高」的视图链压成可收缩（styles.ts 顶部），
  // 保证 .ts-desk 拿到确定高度 —— 中列两格的上下分高全靠它。
  useLayoutEffect(() => {
    document.body.classList.add('ts-hdesk-open')
    return () => document.body.classList.remove('ts-hdesk-open')
  }, [])

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

  /**
   * 拖动中列「共享黑板 ↔ DSH 主对话」之间的上下分隔条。
   *
   * 与预览分隔条的区别：这条改的是**它所在列内部**的分高比例，而台面很重（黑板/主对话/
   * 探索者/iframe）。所以拖动期间**一次 setState 都不做**——按帧把两个格子的 flex-grow
   * 直接写到 DOM 上（flex-basis 为 0 时两个增长系数之比就是两格高度之比），松手才提交
   * 一次比例值。
   *
   * 结束信号沿用预览分隔条那套三重保险（见上）：拖到一半丢 pointerup 会表现成「松手后
   * 分界线还跟着鼠标走」，是最常见的报障。
   */
  const onMidSplitDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    const pointerId = e.pointerId
    const mid = midRef.current
    const topCell = boardCellRef.current
    const bottomCell = chatCellRef.current
    if (!mid || !topCell || !bottomCell) return
    const startTop = topCell.getBoundingClientRect().height
    const total = startTop + bottomCell.getBoundingClientRect().height
    if (total <= 0) return
    const startY = e.clientY
    // 上下各留 MID_CELL_MIN：拖到头也只能把一格压到最小高度，不会压没
    const maxTop = Math.max(MID_CELL_MIN, total - MID_CELL_MIN)
    let last = startTop
    let ratio = startTop / total
    let raf = 0
    let done = false
    const apply = () => {
      raf = 0
      const top = Math.min(maxTop, Math.max(MID_CELL_MIN, last))
      ratio = top / total
      topCell.style.flexGrow = String(top)
      bottomCell.style.flexGrow = String(Math.max(1, total - top))
    }
    const move = (ev: PointerEvent) => {
      if (ev.buttons === 0) { end(); return }   // 已经松手（pointerup 丢了）：立即结束
      last = startTop + (ev.clientY - startY)
      if (!raf) raf = requestAnimationFrame(apply)
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
      document.body.classList.remove('ts-hsplit-dragging')
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
      apply()          // 无条件把最后一帧落到位：拖着一半松手也停在松手处
      setMidSplit(ratio)   // 提交比例 → 随布局快照固化（锁定态下可复现）
    }
    const onVisibility = () => { if (document.hidden) end() }
    try { el.setPointerCapture(pointerId) } catch { /* 合成事件或旧浏览器 */ }
    document.body.classList.add('ts-hsplit-dragging')
    window.addEventListener('pointermove', move)
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
        <span
          className={`ts-title ts-title-proj ${layoutLocked ? 'ts-proj-locked' : 'ts-proj-unlocked'}`}
          title={`${project.path}${layoutLocked ? ' · 布局已锁定' : ' · 布局未锁定'}`}
        >
          <span className="ts-title-proj-icon" aria-hidden="true">🗂</span>
          <span className="ts-title-proj-name">{project.name}</span>
        </span>
        {/* 布局锁（紧贴项目名）：锁定 = 从别处回到本项目时按固化的布局恢复；
            解锁 = 每次进入都用默认布局。台内的一键切换 / 卡片三键照常可用，
            锁定的只是「离开再回来」这一次的还原。 */}
        <button
          className={`ts-btn ts-btn-sm ts-lock-btn ${layoutLocked ? 'ts-lock-on' : 'ts-lock-off'}`}
          onClick={toggleLayoutLock}
          aria-pressed={layoutLocked}
          title={layoutLocked
            ? '布局已锁定：从其它位置跳回本项目（含同项目的其它对话）时按你摆好的布局恢复。点此解锁，解锁后每次进入都回归默认布局。'
            : '布局未锁定：每次进入本项目都回归默认布局。点此锁定，把当前布局固化到这个项目上。'}
        >
          {layoutLocked ? '🔒 锁定布局' : '🔓 解锁布局'}
        </button>
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

      {/* 行轨道同样用 minmax(0, 1fr)（写在 styles.ts 的 .ts-desk 上）：裸 1fr 的自动
          最小值是 min-content，卡片里的长内容会把行撑高、把网格顶出容器（与列同款问题）。 */}
      {/* —— 单棵稳定树：单窗口 ⇄ H 台 只改列轨道，**不重挂卡片** ——
          以前这里是 `compact ? <单窗口树> : <H 台树>` 两个分支：布局一翻，React
          就把整棵子树卸载重建，中下格的 MainChat/MsgList 连同它内部 `.ts-chat-msgs`
          的 scrollTop、展开态、轮数窗口全部归零——用户看到的就是「时不时刷一下、
          对话跳回更早，还得重新拉到底」。
          现在只留一棵树（三列、中列上下两格都在固定 child index 上），切布局只改 grid
          的列轨道与几个 display:none：聊天卡片的组件实例与 DOM 节点原样保留
（滚动位置、展开态、已加载的历史都不丢）。 */}
      {/* 台面空置（三列都没有可见窗口，只呈现预览）时整块不渲染：否则会留下空网格。 */}
      {!deskEmpty && (
      <div className="ts-desk" style={{ gridTemplateColumns: deskColumns }}>
        {/* 左竖：顶部协作对话（主 agent ↔ 探索者），下方探索者窗口等高均分。
            整列一个窗口都不剩（全关）时挂 ts-desk-empty：该列移出网格、份额并给邻列。
            用 display:none 而不是「不渲染」——列内组件的实例与订阅原样保留。 */}
        <div className={`ts-desk-col ts-desk-left${leftPresent ? '' : ' ts-desk-empty'}`}>
          {cardShell('talk', (
            <TalkColumn
              sessionId={sessionId}
              explorers={visible}
              actions={actionsFor('talk', '协作对话')}
            />
          ), `ts-card-talk${left.length === 0 ? ' ts-card-talk-solo' : ''}`)}
          {left.map(renderWin)}
        </div>
        {/* 中列：上=共享黑板、下=DSH 主对话，中间一条**可拖**的上下分隔条。
            两格共用中列高度、靠 flex-grow 按比例分——所以「关掉/收起其中一格，另一格
            铺满整列」与「拖分隔条换高」是同一套机制，没有额外的补位分支。
            flex-grow 由内联 style 注入（比例值），拖动期间则按帧直接写 DOM。 */}
        <div className={`ts-desk-mid${midPresent ? '' : ' ts-desk-empty'}`} ref={midRef}>
          {boardShown && (
            <div
              className={`ts-desk-board${boardCollapsed ? ' ts-desk-cell-collapsed' : ''}`}
              style={{ flexGrow: midSplit * MID_GROW_SCALE }}
              ref={boardCellRef}
            >
              {cardShell('board', (
                <Blackboard workspace={project.path} actions={actionsFor('board', '共享黑板')} />
              ), 'ts-card-fill')}
            </div>
          )}
          {midSplittable && (
            <div
              className="ts-hsplit"
              role="separator"
              aria-orientation="horizontal"
              title="上下拖动：调整「共享黑板」与「DSH 主对话」的高度"
              onPointerDown={onMidSplitDown}
            >
              <span className="ts-hsplit-grip" aria-hidden="true" />
            </div>
          )}
          {chatShown && (
            <div
              className={`ts-desk-chat${chatCollapsed ? ' ts-desk-cell-collapsed' : ''}`}
              style={{ flexGrow: (1 - midSplit) * MID_GROW_SCALE }}
              ref={chatCellRef}
            >
              {cardShell('chat', (
                <MainChat sessionId={mainChatSessionId} actions={actionsFor('chat', 'DSH 主对话')} />
              ), 'ts-card-fill')}
            </div>
          )}
        </div>
        {/* 右竖：顶部协作收益（省 token/费用 vs 等待时间），下方探索者窗口 */}
        <div className={`ts-desk-col ts-desk-right${rightPresent ? '' : ' ts-desk-empty'}`}>
          {cardShell('save', (
            <SavingsColumn
              sessionId={sessionId}
              explorers={visible}
              actions={actionsFor('save', '协作收益')}
            />
          ), `ts-card-save${right.length === 0 ? ' ts-card-save-solo' : ''}`)}
          {right.map(renderWin)}
        </div>
        {/* 最大化/双击全屏的浮层（绝对定位、不占网格格位；放最后，增删不挤动前面的格子） */}
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
                <MainChat sessionId={mainChatSessionId} actions={actionsFor('chat', 'DSH 主对话')} />
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
