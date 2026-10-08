/**
 * 工作台顶部第一行：该项目历史会话选择器 + 新建会话
 *
 * - 点「🕘 历史会话」展开该项目全部历史会话（含非 tokensave 的普通对话），
 *   点选即经宿主 uiWorkspace.openSession 切换当前会话，可直接在历史对话中继续发言；
 * - 点「＋ 新建会话」在该项目下开一个新对话（复用已有空白会话，没有则创建）。
 *
 * 行交互（对齐原生左侧边栏工作区）：
 *   - 鼠标悬浮在某一对话上时，右侧出现两个按钮：**⋯**（更多）与 **📥**（归档图标）；
 *   - 点 📥 直接归档（等价于菜单里的「归档」）；
 *   - 点 ⋯ 展开更多：**置顶会话 / 重命名 / 归档 / 分叉**；
 *   - 悬浮时若标题超宽，标题变跑马灯（左右来回滚动）。
 *
 * 归档沿用原生流程：先直接归档；若该会话正在运行被拒（workspace/session-active），
 * 再弹确认框，确认后带 `stopActivity` 重试（宿主会先停掉它的工作再归档）。
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectSession } from './sessions'
import {
  archiveSession, forkSession, pinSession, renameSession, unpinSession, usePinnedSessions,
} from './sessions'
import { ConfirmDialog } from './ConfirmDialog'

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

/**
 * 会话标题：默认单行省略；**鼠标悬浮**时如果内容超宽，改成跑马灯（左右来回滚动）。
 *
 * 位移量按「内容宽 - 可视宽」实测（--ts-marquee-shift），只在超宽时才启动动画，
 * 短标题不会被无意义地晃动。
 */
function MarqueeTitle({ text, prefix }: { text: string; prefix?: string }) {
  const clipRef = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)
  const measure = () => {
    const el = clipRef.current
    if (!el) return
    const over = el.scrollWidth - el.clientWidth
    setShift(over > 4 ? over : 0)
  }
  useEffect(() => { measure() }, [text])
  return (
    <span
      className="ts-sess-item-title"
      ref={clipRef}
      title={text}
      onMouseEnter={measure}
    >
      <span
        className={`ts-marquee${shift > 0 ? ' ts-marquee-move' : ''}`}
        style={shift > 0 ? ({ '--ts-marquee-shift': `${shift}px` } as React.CSSProperties) : undefined}
      >{prefix}{text}</span>
    </span>
  )
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
  // 展开「⋯」菜单的会话 id（同一时刻只开一个）
  const [menuFor, setMenuFor] = useState<string | null>(null)
  // 正在行内重命名的会话 id 与草稿
  const [renameFor, setRenameFor] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  /** 正在归档的会话 id */
  const [archiving, setArchiving] = useState<string | null>(null)
  /** 因“正在运行”被拒、待用户确认「停止并归档」的会话 */
  const [pendingArchive, setPendingArchive] = useState<ProjectSession | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pinned = usePinnedSessions()

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

  // 提示语自动消失，避免长期挂在标题行里
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4_000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const closeAll = () => {
    setOpen(false)
    setMenuFor(null)
    setRenameFor(null)
  }

  const handleNew = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onNew()
    } finally {
      setBusy(false)
    }
  }

  /** 归档：第一次不带 stopActivity；被拒（正在运行）时弹确认框问「停止并归档」。 */
  const doArchive = async (session: ProjectSession, stopActivity = false) => {
    setMenuFor(null)
    setNotice(null)
    setArchiving(session.id)
    const res = await archiveSession(session.id, stopActivity)
    setArchiving(null)
    if (res.ok) {
      closeAll()
      return
    }
    if (res.active) {
      setPendingArchive(session)
      return
    }
    setNotice(`归档失败：${res.error}`)
  }

  const doPin = async (session: ProjectSession) => {
    setMenuFor(null)
    const isPinned = pinned.has(session.id)
    const ok = isPinned ? await unpinSession(session.id) : await pinSession(session.id)
    setNotice(ok ? (isPinned ? '已取消置顶' : '已置顶') : (isPinned ? '取消置顶失败' : '置顶失败'))
  }

  const startRename = (session: ProjectSession) => {
    setMenuFor(null)
    setRenameFor(session.id)
    setRenameName(session.title)
  }

  const doRename = async (session: ProjectSession) => {
    const next = renameName.trim()
    if (!next || next === session.title) {
      setRenameFor(null)
      return
    }
    const res = await renameSession(session.id, next)
    setRenameFor(null)
    setNotice(res.ok ? '已重命名' : `重命名失败：${res.error}`)
  }

  const doFork = async (session: ProjectSession) => {
    setMenuFor(null)
    const child = await forkSession(session.id)
    setNotice(child ? '已分叉：新会话已出现在列表中' : '分叉失败')
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
      {notice && <span className="ts-sess-notice" title={notice}>{notice}</span>}

      {/* 下拉用 portal 挂到 body：卡片链路上有 overflow:hidden（.ts-cr），
          就地渲染会被裁掉；坐标由上面 useLayoutEffect 按按钮位置算（fixed）。 */}
      {open && pos && createPortal((
        <div
          className="ts-sess-pop"
          role="listbox"
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right, left: 'auto' }}
        >
          <div className="ts-sess-pop-head">
            历史会话 · {sessions.length} 个
          </div>
          {sessions.length === 0 ? (
            <div className="ts-sess-empty">
              该项目还没有历史会话。点「＋ 新建会话」开始第一个对话。
            </div>
          ) : (
            <div className="ts-sess-list">
              {sessions.map((s) => {
                const isPinned = pinned.has(s.id)
                const rowOpen = menuFor === s.id || renameFor === s.id
                return (
                  <div key={s.id} className="ts-sess-row">
                      {/* 行本体：点任意处选会话；右侧同一个槽里“时间 ↔ 悬浮双按钮”互换
                        （槽宽固定，互换不引起浮动面板宽度跳动） */}
                      <div
                        className={`ts-sess-item${s.id === currentId ? ' active' : ''}${rowOpen ? ' ts-sess-item-open' : ''}`}
                        role="option"
                        aria-selected={s.id === currentId}
                        tabIndex={0}
                        title={`${s.title}${s.running ? '（进行中）' : ''}`}
                        onClick={() => {
                          closeAll()
                          onPick(s.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          closeAll()
                          onPick(s.id)
                        }}
                      >
                        <span className={`ts-win-dot${s.running ? '' : ' idle'}`} />
                        <MarqueeTitle text={s.title} prefix={s.explorer ? '🔍 ' : ''} />
                        {isPinned && <span className="ts-sess-tag" title="已置顶">📌</span>}
                        {s.blank && <span className="ts-sess-tag">空白</span>}
                        <span className="ts-sess-slot">
                          {relTime(s.updatedAt) !== '' && (
                            <span className="ts-sess-time">
                              <span className="ts-sess-sep" aria-hidden="true">·</span>
                              {relTime(s.updatedAt)}
                            </span>
                          )}
                          <span className="ts-sess-rowops">
                            <button
                              type="button"
                              className={`ts-sess-op${menuFor === s.id ? ' active' : ''}`}
                              title="更多操作（置顶 / 重命名 / 归档 / 分叉）"
                              aria-haspopup="menu"
                              aria-expanded={menuFor === s.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                setRenameFor(null)
                                setMenuFor((v) => (v === s.id ? null : s.id))
                              }}
                            >⋯</button>
                            <button
                              type="button"
                              className="ts-sess-op"
                              title="归档该会话（运行中会先问你是否停止）"
                              disabled={archiving === s.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                void doArchive(s)
                              }}
                            >📥</button>
                          </span>
                        </span>
                      </div>

                    {menuFor === s.id && (
                      <div className="ts-sess-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="ts-sess-menu-item"
                          onClick={() => void doPin(s)}
                        >{isPinned ? '📌 取消置顶' : '📌 置顶会话'}</button>
                        <button
                          type="button"
                          role="menuitem"
                          className="ts-sess-menu-item"
                          onClick={() => startRename(s)}
                        >✏️ 重命名</button>
                        <button
                          type="button"
                          role="menuitem"
                          className="ts-sess-menu-item"
                          disabled={archiving === s.id}
                          onClick={() => void doArchive(s)}
                        >📥 归档</button>
                        <button
                          type="button"
                          role="menuitem"
                          className="ts-sess-menu-item"
                          onClick={() => void doFork(s)}
                        >🌿 分叉</button>
                      </div>
                    )}

                    {renameFor === s.id && (
                      <div className="ts-sess-rename">
                        <input
                          className="ts-input ts-sess-rename-input"
                          autoFocus
                          value={renameName}
                          placeholder="新的会话标题"
                          onChange={(e) => setRenameName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); void doRename(s) }
                            if (e.key === 'Escape') setRenameFor(null)
                          }}
                        />
                        <button
                          type="button"
                          className="ts-btn ts-btn-primary ts-btn-sm"
                          disabled={!renameName.trim()}
                          onClick={() => void doRename(s)}
                        >保存</button>
                        <button type="button" className="ts-btn ts-btn-sm" onClick={() => setRenameFor(null)}>取消</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ), document.body)}

      {/* 运行中的会话被拒后的确认：确认即「停止并归档」 */}
      {pendingArchive && (
        <ConfirmDialog
          title="归档会话"
          danger
          confirmText="停止并归档"
          message={(
            <>
              <div className="ts-confirm-lead">该会话正在运行，直接归档会被拒绝。</div>
              <div className="ts-confirm-target">
                <span className="ts-confirm-name">💬 {pendingArchive.title}</span>
              </div>
              <div className="ts-confirm-note">
                点「停止并归档」会<b>先停止它正在跑的工作</b>，再把它归档。
                归档只是从列表中移出，会话记录不会删除，之后可在宿主的「已归档」里恢复。
              </div>
            </>
          )}
          onCancel={() => setPendingArchive(null)}
          onConfirm={() => {
            const target = pendingArchive
            setPendingArchive(null)
            if (target) void doArchive(target, true)
          }}
        />
      )}
    </span>
  )
}
