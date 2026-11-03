/**
 * 轮末「已编辑 N 个文件」变更卡（照搬原生对话 tab 的 ChangedFiles）。
 *
 * 三层来源：
 *   - 清单：`changes-api.loadChangesSummary` 走宿主 `/api/changes.summary`，
 *     与原生卡同一份数据（含 git 工作树差异与逐文件增删行数）；
 *   - 悬浮预览：鼠标停留 500ms 后 `loadChangesDiff` 走 `/api/changes.diff`，
 *     拉该文件的 before/after unified diff 就地渲染（原生用 HoverCard）；
 *   - 兜底：路由不可用（宿主版本变了 / 非 git 仓 / 会话已被回收）时退回
 *     `fallbackFiles`——本地 tool/call 统计出来的纯路径清单，此时不显示行数，
 *     也不提供预览（没有数据就不假装有）。
 *
 * 为什么单独成模块：MsgList 已经很长，卡片带自己的读取状态机、悬浮计时、
 * diff 渲染，塞进去会让两件事互相牵制（自检也不好拆开验）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChangesDiffState, ChangedFile } from './changes-types'
import { loadChangesDiff, loadChangesSummary } from './changes-api'
import type { ChangesSummary } from './changes-types'
import { PREVIEW_CLOSE_DELAY_MS, PREVIEW_OPEN_DELAY_MS, PREVIEW_MAX_H } from './changes-preview-const'
import { placePreview } from './changes-preview-position'
import type { Placement } from './changes-preview-position'

/** 折叠状态下先露几行（原生 COLLAPSED_ROWS = 4，一旦可折就按这个高度收）。 */
const COLLAPSED_ROWS = 4

const COUNT_FMT = new Intl.NumberFormat('en-US')

/** 只显示文件名（完整路径在悬浮提示 / 预览头里）。 */
function fileNameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/** 行数对：`+13` / `-1`，与原生卡同色口径（增=success、删=error 语义色）。 */
function Counts({ added, deleted }: { added: number, deleted: number }) {
  return (
    <>
      <span className="ts-cf-added">+{COUNT_FMT.format(added)}</span>
      <span className="ts-cf-deleted">-{COUNT_FMT.format(deleted)}</span>
    </>
  )
}

/** 文件类型方块：用扩展名首字母代替宿主的 FileTypeIcon（不引宿主内部组件）。 */
function FileTile({ path }: { path?: string }) {
  const ext = path ? (path.split('.').pop() || '').slice(0, 3).toLowerCase() : ''
  return (
    <span className="ts-cf-tile" aria-hidden="true">
      {ext || (
        <svg width="18" height="18" viewBox="0 0 12 12" focusable="false">
          <path d="M7.4 1.2H3.4c-.5 0-.9.4-.9.9v7.8c0 .5.4.9.9.9h5.2c.5 0 .9-.4.9-.9V3.3L7.4 1.2z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M7.3 1.4v2.2h2.2" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

/**
 * 悬浮预览：等 `openDelay` 后才去读 diff（原生挂 HoverCard 时才 mount，
 * 划过不留请求）。读取失败 / 二元文件 / 超大文件都给出明确一行，不空着。
 */
function DiffPreview({
  sessionId, seq, index, display,
}: { sessionId: string, seq: number, index: number, display: string }) {
  const [state, setState] = useState<ChangesDiffState>('loading')
  useEffect(() => {
    let alive = true
    setState('loading')
    void loadChangesDiff(sessionId, seq, index).then((d) => {
      if (!alive) return
      setState(d ?? 'missing')
    })
    return () => { alive = false }
  }, [sessionId, seq, index])

  // 行级渲染：unified diff 直接按行上色，不做分栏（与原生预览 split=false 一致）
  const body = useMemo(() => {
    if (state === 'loading') return <div className="ts-cf-note">读取中…</div>
    if (state === 'missing') return <div className="ts-cf-note">该轮对比已不可读（会话可能已被回收）。</div>
    if (state === 'error') return <div className="ts-cf-note">对比读取失败。</div>
    // 两个 refusal 收成一条分支：联合类型才能在此之后把 state 窄到 text
    if (state.kind === 'binary' || state.kind === 'oversized') {
      return (
        <div className="ts-cf-note">
          {state.kind === 'binary' ? '二进制文件，无法显示行级对比。' : '文件过大，宿主未生成对比。'}
        </div>
      )
    }
    if (state.hunks.length === 0) return <div className="ts-cf-note">内容未变化（只有文件时间戳改动）。</div>
    const rows: React.ReactNode[] = []
    for (const h of state.hunks) {
      rows.push(
        <div className="ts-cf-hunk" key={`h${h.oldStart}-${h.newStart}`}>
          @@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@
        </div>,
      )
      for (let i = 0; i < h.lines.length; i++) {
        const line = h.lines[i]
        const mark = line[0]
        const kind = mark === '+' ? 'add' : mark === '-' ? 'del' : 'ctx'
        rows.push(
          <div className={`ts-cf-line is-${kind}`} key={`l${h.oldStart}-${i}`}>
            <span className="ts-cf-line-sign">{mark === ' ' ? ' ' : mark}</span>
            <span className="ts-cf-line-text">{line.slice(1)}</span>
          </div>,
        )
      }
    }
    return <>{rows}</>
  }, [state])

  return (
    <div className="ts-cf-preview">
      <div className="ts-cf-preview-head">{display}</div>
      <div className="ts-cf-preview-body">{body}</div>
    </div>
  )
}

/**
 * 悬浮预览的**开启状态**。
 *
 * 为什么只存锚点矩形、不存最终 left/top：窗口尺寸会在预览开着时变（拖面板、
 * 拖宽度把手、转屏），摆位必须跟着重算，否则卡片会停在旧坐标上掉出视口。
 * 位置由 placePreview 在渲染时按当前视口现算，见下面的 placement useMemo。
 */
interface HoverState {
  index: number
  display: string
  anchor: { left: number, top: number, width: number, height: number }
}

/**
 * 轮末变更卡。
 *
 * @param sessionId - 用于路由认证与会话回收判定
 * @param seq - 本轮 `workspace/changes` 事件的 seq（路由坐标）
 * @param fallbackFiles - 路由不可用时的本地统计（纯路径，无行数）
 */
export function ChangesCard({
  sessionId, seq, fallbackFiles,
}: { sessionId: string, seq: number | null, fallbackFiles: string[] }) {
  const [summary, setSummary] = useState<ChangesSummary | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [hover, setHover] = useState<HoverState | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  /** 开：等 openDelay 才读 diff；关：等 closeDelay，给指针移进卡片的时间。两个计时互斥。 */
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)

  // 有 seq 才读宿主清单；没有就直接用本地统计（此时不显示行数）
  useEffect(() => {
    if (seq === null || !sessionId) { setSummary(null); return }
    let alive = true
    void loadChangesSummary(sessionId, seq).then((s) => {
      if (alive) setSummary(s)
    })
    return () => { alive = false }
  }, [sessionId, seq])

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null }
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }, [])
  // 卸载必须清计时器：否则组件已经不在了，定时器还在跑 setHover
  useEffect(() => clearTimers, [clearTimers])

  /**
   * 指针进入锚点行：先撤销「待关闭」，再起「待打开」。
   *
   * 锚点矩形在**打开这一刻**量并存在 state 里（不每帧重测）：存储的坐标会在
   * 窗口变化时由渲染期的 placePreview 重算，因此既能跟随布局又不会因为
   * 悬浮期间行被滚动/重排而抖动闪烁。
   */
  const openHover = useCallback((index: number, display: string, anchor: HTMLElement) => {
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
    if (openTimer.current !== null) return   // 已经在同一行上等打开，别重置延迟
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      const r = anchor.getBoundingClientRect()
      setHover({ index, display, anchor: { left: r.left, top: r.top, width: r.width, height: r.height } })
    }, PREVIEW_OPEN_DELAY_MS)
  }, [])

  /**
   * 指针离开：延迟关闭而非立即关。
   *
   * 为什么不能立刻关：锚点行与卡片之间有 PREVIEW_GAP 的空隙，指针从行移到
   * 卡片上必然穿过它；立即关闭会让预览「一碰就没」，用户也就无法在卡内滚动
   * diff。这个延迟给跨越空隙的时间，指针真进到卡上时 onEnter 会把计时撤销。
   */
  const scheduleClose = useCallback(() => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null }
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setHover(null)
    }, PREVIEW_CLOSE_DELAY_MS)
  }, [])

  /** 指针进到卡片本身：撤销待关闭（这是「预览可以停留」的关键）。 */
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }, [])

  // Esc 关闭（键盘用户没有「移开」这个动作，必须给一条退出口）
  useEffect(() => {
    if (!hover) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHover(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hover])

  // 列表收起 / 展开会重排行位置：旧锚点已失效，直接关掉预览
  useEffect(() => {
    setHover(null)
  }, [expanded, summary])

  /**
   * 预览位置（渲染期现算）。
   *
   * 依赖 hover 与视口尺寸：拖面板/拖宽度把手/转屏时视口变了要重算，否则卡片
   * 停在与新布局不匹配的旧坐标上（这正是「掉到屏幕底部之外」的成因之一）。
   * 视口尺寸在 resize 事件里同步进 state，保证重算能被 React 看到。
   */
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }))
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const placement: Placement | null = useMemo(() => {
    if (!hover) return null
    return placePreview(hover.anchor, viewport, { height: PREVIEW_MAX_H })
  }, [hover, viewport])

  const files = summary?.files ?? null
  const count = files ? summary!.total : fallbackFiles.length
  if (count === 0) return null

  const foldable = !!files && files.length > COLLAPSED_ROWS
  const rows = files ? (foldable && !expanded ? files.slice(0, COLLAPSED_ROWS) : files) : null
  const single = !!files && summary!.total === 1 ? files[0] : undefined

  const title = single
    ? `已编辑 ${fileNameOf(single.display)}`
    : `已编辑 ${COUNT_FMT.format(count)} 个文件`

  return (
    <div className="ts-changes-card" data-single={single ? 'true' : undefined} ref={cardRef}>
      <button
        type="button"
        className="ts-cf-head"
        aria-expanded={foldable ? expanded : undefined}
        onClick={() => { if (foldable) setExpanded((v) => !v) }}
        title={files ? files.map((f) => f.display).join('\n') : fallbackFiles.join('\n')}
      >
        <FileTile path={single?.display ?? files?.[0]?.display} />
        <span className="ts-cf-titles">
          <span className="ts-cf-title">{title}</span>
          <span className="ts-cf-stat">
            <span className="ts-cf-stat-counts">
              {files ? <Counts added={summary!.added} deleted={summary!.deleted} /> : '按工具调用统计（宿主未提供行数）'}
            </span>
            <span className="ts-cf-preview-hint">悬浮查看改动</span>
          </span>
        </span>
      </button>

      {/* 单文件时没有列表（原生也是只留 header） */}
      {rows && (
        <ul className="ts-cf-list">
          {rows.map((f, index) => (
            <li key={`${f.display}-${index}`}>
              <button
                type="button"
                className="ts-cf-row"
                // 悬停与键盘焦点各给一次机会：鼠标用户靠 mouseenter，
                // 键盘用户 Tab 到行上同样应该能看预览（原生 HoverCard 也这么做）。
                onMouseEnter={(e) => openHover(index, f.display, e.currentTarget)}
                onMouseLeave={scheduleClose}
                onFocus={(e) => openHover(index, f.display, e.currentTarget)}
                onBlur={scheduleClose}
                aria-label={`查看 ${f.display} 的改动`}
              >
                <span className="ts-cf-path" title={f.path}>{f.display}</span>
                <span className="ts-cf-counts">
                  {f.binary === true ? '二进制' : f.oversized === true ? '超大文件' : <Counts added={f.added} deleted={f.deleted} />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {foldable && (
        <button
          type="button"
          className="ts-cf-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span>{expanded ? '收起' : `展开全部 ${count} 个文件`}</span>
          <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
        </button>
      )}

      {/*
        * 预览卡 **portal 到 body**，不留在卡片 DOM 里。
        *
        * 为什么必须这样（两个实测症状的同一个根因）：
        *   ① 位置算不准 —— 工作台面板处在 dockview / 抽屉这类带 transform 的
        *      容器里，`position:fixed` 会相对最近的 transformed 祖先解析，而不是
        *      视口；于是 getBoundingClientRect 得出的视口坐标被当成「相对那个祖先」
        *      消费，卡片就掉到屏幕外（尤其向下掉出底部）。
        *   ② 被输入框压住 —— 祖先一旦构成 stacking context，子元素的 z-index
        *      只在那个上下文里比较；停靠的原生输入条是 fixed 在视口层（z-index 35），
        *      卡片再大的 z-index 也翻不出祖先，于是落在输入框下层。
        * 挂到 body 之后：坐标系就是视口，z-index 也在顶层比较，两个问题一起消失。
        */}
      {hover && seq !== null && placement && createPortal(
        <div
          className="ts-cf-hovercard"
          style={{
            left: placement.left,
            top: placement.top,
            width: placement.width,
            maxHeight: placement.maxHeight,
          }}
          // 指针进到卡上就撤掉「待关闭」，这样可以在卡内滚动 diff 而不会被关掉
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <DiffPreview sessionId={sessionId} seq={seq} index={hover.index} display={hover.display} />
        </div>,
        document.body,
      )}
    </div>
  )
}
