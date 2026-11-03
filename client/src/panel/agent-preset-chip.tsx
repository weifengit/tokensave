/**
 * 工作台标题行的**模式选择器**（标准 / PTC / 极简 / 创造）。
 *
 * 为什么工作台要自带一个：宿主把模式选择器只注册在「新会话 Hero chip」与
 * 「会话标题行只读 label」两个 slot 上，而工作台用自己的视图替换了宿主的会话
 * 视图——那两个 slot 根本不渲染。于是即便宿主侧预设链完好，工作台里也没有入口。
 *
 * 与宿主 `AgentPresetSeat` 的对应关系（照搬语义，不照搬内部组件）：
 *   - 读清单：remote.agentPresets.list()（见 agent-preset.ts）
 *   - 选模式：remote.agentPresets.select(sessionId, id)
 *   - 只有**空白会话**可选：一轮跑过之后历史已在那套工具下产生，宿主会拒绝；
 *     因此非空白会话这里渲染成只读标签，并在 title 里说明原因（不装作能点）。
 *   - 被拒绝时把原因显示出来（原生用 Toast，这里就地一行提示，少一个浮层）。
 *
 * 下拉用 portal 挂到 body：面板是可滚/可裁容器，普通 absolute 下拉会被裁掉
 * （与 changes-card 的预览卡同一个坑）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { listAgentPresets, presetDescription, presetLabel, selectAgentPreset } from './agent-preset'
import type { AgentPresetRow } from './agent-preset'
import { placePreview } from './changes-preview-position'

/** 下拉宽度（与标题行左缘对齐；比触发按钮宽，好让说明文字读得开）。 */
const MENU_W = 260
/** 下拉最大高度；超出内部滚动。 */
const MENU_MAX_H = 320

interface MenuPos { left: number, top: number, width: number, maxHeight: number }

function presetIcon(): React.ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <circle cx="7" cy="4" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.6 12c0-2.4 2-4.2 4.4-4.2s4.4 1.8 4.4 4.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * 模式选择器。
 *
 * @param sessionId - 目标会话（空白会话才能切换）
 * @param editable - 宿主是否允许切换（空白会话为 true）；false 时只读显示
 */
export function AgentPresetChip({ sessionId, editable }: { sessionId: string, editable: boolean }) {
  const [rows, setRows] = useState<AgentPresetRow[] | null>(null)
  const [current, setCurrent] = useState('')
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)

  // 清单与当前值：挂载读一次；换会话重读（不同会话可能有不同的当前模式）
  useEffect(() => {
    let alive = true
    void listAgentPresets().then((roster) => {
      if (!alive) return
      setRows(roster.rows)
      // 当前模式取 isDefault 的那条作初值；宿主服务若提供当前值会在 select 后更新
      const def = roster.rows.find((r) => r.isDefault) ?? roster.rows[0]
      setCurrent((prev) => prev || (def?.id ?? ''))
    })
    return () => { alive = false }
  }, [sessionId])

  /** 摆放下拉：复用播报卡的摆位纯函数（同一套"不许出视口"规则）。 */
  const placeMenu = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const p = placePreview(
      { left: r.left, top: r.top, width: r.width, height: r.height },
      { width: window.innerWidth, height: window.innerHeight },
      { width: MENU_W, height: MENU_MAX_H },
    )
    setPos({ left: p.left, top: p.top, width: MENU_W, maxHeight: Math.max(120, p.maxHeight) })
  }, [])

  const toggle = () => {
    if (!editable) return
    if (!open) placeMenu()
    setOpen((v) => !v)
    setNotice(null)
  }

  // 打开期间：滚动/改尺寸跟着挪，Esc 与点击别处关闭（原生 Menu 也是这套）
  useEffect(() => {
    if (!open) return
    const onScroll = () => placeMenu()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (anchorRef.current?.contains(t)) return
      // 下拉本身在 portal 里，点它自己的行不算"点别处"
      const menu = document.querySelector('[data-ts-preset-menu]')
      if (menu?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open, placeMenu])

  const pick = (id: string) => {
    setOpen(false)
    const before = current
    setCurrent(id)   // 乐观更新：宿主拒绝时再回滚，避免点了没反应的观感
    void selectAgentPreset(sessionId, id).then((refusal) => {
      if (refusal !== undefined) {
        setCurrent(before)
        setNotice(refusal)
      }
    })
  }

  const chosen = useMemo(() => rows?.find((r) => r.id === current), [rows, current])
  const label = chosen ? presetLabel(chosen) : (rows === null ? '模式加载中…' : '未配置模式')

  // 清单为空（宿主预设链未加载）：明确说出来，不让入口凭空消失
  if (rows !== null && rows.length === 0) {
    return (
      <span className="ts-preset-chip is-empty" title="宿主侧预设注册链未加载，模式清单为空（详见控制台诊断日志）">
        {presetIcon()}
        <span className="ts-preset-label">模式不可用</span>
      </span>
    )
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`ts-preset-chip${editable ? '' : ' is-readonly'}${open ? ' is-open' : ''}`}
        aria-haspopup={editable ? 'menu' : undefined}
        aria-expanded={editable ? open : undefined}
        disabled={!editable}
        onClick={toggle}
        title={editable
          ? '选择本轮会话的 Agent 模式（标准 / PTC / 极简 / 创造）'
          : '模式在会话开始后固定：历史是在该模式的工具与提示词下产生的，切换会自相矛盾'}
      >
        {presetIcon()}
        <span className="ts-preset-label">{label}</span>
        {editable && <span className="ts-preset-caret" aria-hidden="true">▾</span>}
      </button>

      {notice && (
        <span className="ts-preset-notice" role="status">{notice}</span>
      )}

      {open && pos && rows && createPortal(
        <div
          className="ts-preset-menu"
          data-ts-preset-menu=""
          role="menu"
          style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
        >
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              role="menuitemradio"
              aria-checked={r.id === current}
              className={`ts-preset-item${r.id === current ? ' is-current' : ''}`}
              onClick={() => pick(r.id)}
            >
              <span className="ts-preset-item-name">{presetLabel(r)}</span>
              <span className="ts-preset-item-desc">{presetDescription(r)}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
