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
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangesDiffState, ChangedFile } from './changes-types'
import { loadChangesDiff, loadChangesSummary } from './changes-api'
import type { ChangesSummary } from './changes-types'

/** 折叠状态下先露几行（原生 COLLAPSED_ROWS = 4，一旦可折就按这个高度收）。 */
const COLLAPSED_ROWS = 4
/** 悬浮多久才去读 diff（原生 500ms；太快会在鼠标划过时打一串无用请求）。 */
const PREVIEW_OPEN_DELAY_MS = 500
/** 预览宽度上限：不占满整块面板，也不至于窄到读不了。 */
const PREVIEW_MAX_W = 520
const PREVIEW_MAX_H = 260

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

/** 悬浮锚点：位置由锚点矩形算出（避开视口边缘），指针移入预览本身时保持显示。 */
interface HoverState { index: number, display: string, left: number, top: number }

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
  const hoverTimer = useRef<number | null>(null)

  // 有 seq 才读宿主清单；没有就直接用本地统计（此时不显示行数）
  useEffect(() => {
    if (seq === null || !sessionId) { setSummary(null); return }
    let alive = true
    void loadChangesSummary(sessionId, seq).then((s) => {
      if (alive) setSummary(s)
    })
    return () => { alive = false }
  }, [sessionId, seq])

  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }
  useEffect(() => clearHoverTimer, [])

  // 卸载 / 收起时把悬浮卡关掉，避免它留在屏上
  useEffect(() => {
    if (!expanded) setHover(null)
  }, [expanded])

  const openHover = (index: number, display: string, anchor: HTMLElement) => {
    clearHoverTimer()
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null
      const r = anchor.getBoundingClientRect()
      const cardRect = cardRef.current?.getBoundingClientRect()
      // 左缘对齐卡片，纵向落在锚点下方；下方空间不够就翻到上方
      const left = Math.max(8, Math.min(cardRect?.left ?? r.left, window.innerWidth - PREVIEW_MAX_W - 8))
      const below = r.bottom + 6
      const fits = below + PREVIEW_MAX_H + 8 <= window.innerHeight
      const top = fits ? below : Math.max(8, r.top - PREVIEW_MAX_H - 6)
      setHover({ index, display, left, top })
    }, PREVIEW_OPEN_DELAY_MS)
  }

  const files = summary?.files ?? null
  const fallbackFilesUsed = !files
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
                onMouseEnter={(e) => openHover(index, f.display, e.currentTarget)}
                onMouseLeave={clearHoverTimer}
                onFocus={(e) => openHover(index, f.display, e.currentTarget)}
                onBlur={clearHoverTimer}
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

      {hover && seq !== null && (
        <div
          className="ts-cf-hovercard"
          style={{ left: hover.left, top: hover.top, maxHeight: PREVIEW_MAX_H, maxWidth: PREVIEW_MAX_W }}
          onMouseEnter={clearHoverTimer}
          onMouseLeave={() => setHover(null)}
        >
          <DiffPreview sessionId={sessionId} seq={seq} index={hover.index} display={hover.display} />
        </div>
      )}
    </div>
  )
}
