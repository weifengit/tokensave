/**
 * H 型工作台（唯一布局模式，无中横线）
 * ┌────左竖────┬────中上：共享黑板────┬────右竖────┐
 * │  免费模型   │                     │  免费模型   │
 * │  窗口×N    ├─────────────────────┤  窗口×M    │
 * │           │  中下：DSH 原生输入条 │           │
 * └───────────┴─────────────────────┴───────────┘
 * - 全台共享 R = max(左窗口数, 右窗口数, 2) 行的 1fr 网格：黑板跨 1..R-1 行、
 *   中下格占最后一行、左右两竖跨满 R 行 —— 所有横向缝隙对齐（偶数探索者时
 *   三列缝完全一致），列内窗口 flex:1 等高均分，探索者增多自动细分。
 * - 中下格不自造聊天：挂载时把宿主原生输入条（conversation.composer，
 *   每个 tab 常驻）position:fixed 停靠进该格，卸载/切 tab 自动还原。
 * - 左右两竖按奇偶均分探索者；被隐藏的窗口以 chip 形式留在列底部可恢复
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchExplorers } from './api'
import type { TelemetrySession } from './api'
import { Blackboard } from './Blackboard'
import { ExplorerWindow } from './ExplorerWindow'
import { TalkColumn } from './TalkColumn'
import { SavingsColumn } from './SavingsColumn'
import type { ProjectRecord } from './store'
import { loadDeskWidth, saveDeskWidth, deskCssWidth, DESK_MIN, DESK_FULL } from './width'
import { reportExplorerCount } from '../float/mount'

interface Props {
  project: ProjectRecord
  sessionId: string
  onBack: () => void
}

interface WinState {
  collapsed: boolean
  hidden: boolean
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
function useDockNativeComposer(ref: React.RefObject<HTMLDivElement | null>, deps: unknown[]): void {
  useLayoutEffect(() => {
    const cell = ref.current
    if (!cell || typeof document === 'undefined') return
    const seat = document.querySelector<HTMLElement>(COMPOSER_SEAT)
    if (!seat) return

    const KEYS = ['position', 'left', 'right', 'top', 'bottom', 'width', 'zIndex'] as const
    const saved: Record<string, string> = {}
    for (const k of KEYS) saved[k] = (seat.style as any)[k]

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
    // 兑底：未触发 ResizeObserver 的宿主布局变化（含宽度把手拖拽/tab 切换）
    const timer = window.setInterval(schedule, 300)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.clearInterval(timer)
      if (raf) cancelAnimationFrame(raf)
      for (const k of KEYS) (seat.style as any)[k] = saved[k]
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export function HDesk({ project, sessionId, onBack }: Props) {
  const [explorers, setExplorers] = useState<TelemetrySession[]>([])
  const [winState, setWinState] = useState<Record<string, WinState>>({})
  const [overlayId, setOverlayId] = useState<string | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const chatCellRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // —— 本工作台自己的宽度（按项目独立，默认铺满）——
  // 不读宿主的 --dsh-chat-content-width：那是全局值，且给两侧把手预留了 176px，
  // 永远铺不满、一处拖动处处生效。
  const [widthPref, setWidthPref] = useState<number>(() => loadDeskWidth(project.id))
  const [availW, setAvailW] = useState(0)

  useEffect(() => {
    setWidthPref(loadDeskWidth(project.id))
  }, [project.id])

  useEffect(() => {
    const el = rootRef.current
    const host = el?.parentElement
    if (!host) return
    const read = () => setAvailW(host.clientWidth || 0)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(host)
    window.addEventListener('resize', read)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', read)
    }
  }, [])

  const applyWidth = (px: number) => {
    setWidthPref(px)
    saveDeskWidth(project.id, px)
  }
  const maxW = Math.max(DESK_MIN, availW || 0)

  // 进入工作台期间隐藏宿主那套「全局宽度把手」（[data-width-handle]，其值写在共享
  // 父元素上、一处拖动处处生效，且给把手预留 176px 永远铺不满）。工作台用自己的
  // 宽度控件，退出即恢复宿主把手。
  useEffect(() => {
    document.body.classList.add('ts-hdesk-open')
    return () => document.body.classList.remove('ts-hdesk-open')
  }, [])

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

  // 网格行数：黑板占 1..R-1，中下占 R；左右两竖跨满 —— 探索者增多即均分
  const rows = Math.max(left.length, right.length, 2)
  // 中下格随窗口数/布局变化 → 停靠持续跟随（deps 覆盖重排）
  useDockNativeComposer(chatCellRef, [rows, sessionId, visible.length])

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

  return (
    <div
      className="ts-cr ts-hdesk"
      ref={rootRef}
      style={{ padding: 8, width: deskCssWidth(widthPref) }}
    >
      <div className="ts-bar">
        <button className="ts-btn" onClick={onBack}>← 项目中心</button>
        <span className="ts-title">{project.name}</span>
        <span className="ts-tag">布局：H 型工作台</span>
        <span className="ts-sub" title={project.path}>{project.path}</span>
        <span className="ts-sub" style={{ marginLeft: 'auto' }}>
          模型窗口 {visible.length}{hidden.length > 0 ? `（隐藏 ${hidden.length}）` : ''}
        </span>
        {/* 宽度：本工作台私有，默认铺满；拖动即收窄并记住（按项目） */}
        <span className="ts-width-ctl" title="工作台宽度（按项目独立记忆）">
          {widthPref === DESK_FULL ? (
            <button
              className="ts-btn"
              onClick={() => applyWidth(Math.min(maxW, Math.max(DESK_MIN, Math.round(availW * 0.72))))}
              title="收窄为居中宽度（可再拖滑块微调）"
            >⤢ 铺满中</button>
          ) : (
            <>
              <input
                className="ts-width-range"
                type="range"
                min={DESK_MIN}
                max={maxW}
                value={Math.min(Math.max(widthPref, DESK_MIN), maxW)}
                onChange={(e) => applyWidth(Number(e.target.value))}
                title={`宽度 ${Math.round(widthPref)}px / 可用 ${availW}px`}
              />
              <button
                className="ts-btn"
                onClick={() => applyWidth(DESK_FULL)}
                title="恢复铺满（左右不留白）"
              >⤢ 铺满</button>
            </>
          )}
        </span>
      </div>
      {probeError && <div className="ts-hint">⚠️ 探索者探测：{probeError}</div>}
      <div className="ts-desk" style={{ gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {/* 左竖：顶部协作对话（主 agent ↔ 探索者），下方探索者窗口等高均分 */}
        <div className="ts-desk-col ts-desk-left">
          <TalkColumn sessionId={sessionId} explorers={visible} />
          {left.length === 0 && <div className="ts-hint">左列暂无模型窗口<br />运行 tokensave_delegate 后自动出现</div>}
          {left.map(renderWin)}
          {renderHiddenChips()}
        </div>
        {/* 中上：共享黑板（跨 1..R-1 行，底边与左右列缝隙对齐，无横线） */}
        <div className="ts-desk-board" style={{ gridRow: `1 / ${rows}` }}>
          <Blackboard workspace={project.path} />
        </div>
        {/* 中下：DSH 主对话卡片 —— 宿主原生输入条 fixed 停靠其中（无自造 UI） */}
        <div className="ts-desk-chat" style={{ gridRow: String(rows) }} ref={chatCellRef} />
        {/* 右竖：顶部协作收益（省 token/费用 vs 等待时间），下方探索者窗口 */}
        <div className="ts-desk-col ts-desk-right">
          <SavingsColumn sessionId={sessionId} explorers={visible} />
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
    </div>
  )
}
