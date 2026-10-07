/**
 * 工作台顶部第一行：该项目历史会话选择器 + 新建会话
 *
 * - 点「🕘 历史会话」展开该项目全部历史会话（含非 tokensave 的普通对话），
 *   点选即经宿主 uiWorkspace.openSession 切换当前会话，可直接在历史对话中继续发言；
 * - 点「＋ 新建会话」在该项目下开一个新对话（复用已有空白会话，没有则创建）。
 * 列表数据由 sessions.ts 的 useProjectSessions 提供（订阅宿主会话目录）。
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectSession } from './sessions'

/** 相对时间（列表里用，避免每行一串完整时间戳）。 */
function relTime(ms: number): string {
  if (!ms) return ''
  const d = Date.now() - ms
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)} 天前`
  return new Date(ms).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export interface SessionPickerProps {
  sessions: ProjectSession[]
  currentId: string
  onPick: (id: string) => void
  onNew: () => void | Promise<void>
}

export function SessionPicker({ sessions, currentId, onPick, onNew }: SessionPickerProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const boxRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // 下拉定位：卡片链路上有 overflow:hidden（.ts-cr），就地渲染会被裁掉。
  // 改用 portal 挂到 body，并按按钮位置算 fixed 坐标（右对齐，不超出视口）。
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = boxRef.current?.getBoundingClientRect()
      if (!r) return
      const margin = 12
      setPos({ top: r.bottom + 6, right: Math.max(margin, window.innerWidth - r.right) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])
  const current = useMemo(() => sessions.find((s) => s.id === currentId), [sessions, currentId])

  // 点击外部 / Esc 关闭下拉
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      // 点击外部（含 portal 内部）关闭：portal 不在 boxRef 子树里，需单独判断
      if (!boxRef.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleNew = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onNew()
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="ts-sess" ref={boxRef}>
      <button
        className={`ts-btn ts-sess-btn${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="该项目的历史会话：点选即切换过去，可直接继续发言"
      >
        <span>🕘 历史会话（{sessions.length}）</span>
        <span className="ts-sess-cur" title={current?.title || currentId}>
          {current ? current.title : '当前会话'}
        </span>
        <span className="ts-sess-caret">{open ? '▴' : '▾'}</span>
      </button>
      <button
        className="ts-btn ts-btn-primary"
        onClick={handleNew}
        disabled={busy}
        title="在该项目下开启一个新对话"
      >
        {busy ? '新建中…' : '＋ 新建会话'}
      </button>

      {/* 下拉用 portal 挂到 body：卡片链路上有 overflow:hidden（.ts-cr），
          就地渲染会被裁掉；坐标由上面 useLayoutEffect 按按钮位置算（fixed）。 */}
      {open && pos && createPortal((
        <div
          className="ts-sess-pop"
          role="listbox"
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right, left: 'auto' }}
        >
          <div className="ts-sess-pop-head">该项目的历史会话 · {sessions.length} 个</div>
          {sessions.length === 0 ? (
            <div className="ts-sess-empty">
              该项目还没有历史会话。点「＋ 新建会话」开始第一个对话。
            </div>
          ) : (
            <div className="ts-sess-list">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={s.id === currentId}
                  className={`ts-sess-item${s.id === currentId ? ' active' : ''}`}
                  onClick={() => {
                    setOpen(false)
                    onPick(s.id)
                  }}
                  title={`${s.title}${s.running ? '（进行中）' : ''}`}
                >
                  <span className={`ts-win-dot${s.running ? '' : ' idle'}`} />
                  <span className="ts-sess-item-title">
                    {s.explorer ? '🔍 ' : ''}
                    {s.title}
                  </span>
                  {s.blank && <span className="ts-sess-tag">空白</span>}
                  <span className="ts-sess-item-time">{relTime(s.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ), document.body)}
    </span>
  )
}
