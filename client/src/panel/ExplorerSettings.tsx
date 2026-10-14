/**
 * 标题行「探索者设置」：一个按钮 + 浮动面板。
 *
 * 面板按 默认 / 免费 / 收费 三个大区列出**可用**的探索者，逐个（或整组）开关；
 * 至少保留 1 个选中（最后一个不允许取消）。选择即时 POST 到宿主侧持久化
 * （~/.dsh/tokensave/explorers.json），此后 parallelExplore 完全按这份选择跑。
 *
 * 面板用 portal 挂 body：卡片链路上有 overflow:hidden（.ts-cr），就地渲染会被裁掉；
 * 坐标按按钮位置算成 fixed（右对齐），与 SessionPicker 同款。
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchExplorerSettings, saveExplorerSettings } from './api'
import type { ExplorerSettingGroup, ExplorerSettingItem, ExplorerSettingsPayload } from './api'

/** 提交/本地状态用的最小选择单位（label/focus 由目录带回，保证持久化的一致）。 */
type Sel = Pick<ExplorerSettingItem, 'model' | 'label' | 'focus'>

/** 目录 → 已选列表（从目录里回填 label/focus）。 */
function selectionsFrom(payload: ExplorerSettingsPayload): Sel[] {
  const byModel = new Map<string, ExplorerSettingItem>()
  for (const g of payload.groups) for (const it of g.items) byModel.set(it.model, it)
  return payload.selected.map((model) => {
    const it = byModel.get(model)
    return { model, label: it?.label || model, focus: it?.focus || '整体方案可行性' }
  })
}

/** 小开关（role=switch）。 */
function Switch({
  on, disabled, label, onToggle, tone,
}: {
  on: boolean
  /** 分组开关：换一套配色，与单个探索者的开关区分开 */
  tone?: 'group'
  disabled?: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`ts-switch${tone === 'group' ? ' ts-switch-group' : ''}${on ? ' on' : ''}`}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
    >
      <span className="ts-switch-knob" aria-hidden="true" />
    </button>
  )
}

export function ExplorerSettings({ variant = 'text' }: { variant?: 'text' | 'icon' } = {}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [data, setData] = useState<ExplorerSettingsPayload | null>(null)
  const [selected, setSelected] = useState<Sel[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const boxRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // 下拉定位：卡片链路上有 overflow:hidden（.ts-cr），就地渲染会被裁掉 → portal + fixed。
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

  // 打开即拉目录 + 当前选择
  useEffect(() => {
    if (!open) return
    let alive = true
    setErr(null)
    void (async () => {
      try {
        const payload = await fetchExplorerSettings()
        if (!alive) return
        setData(payload)
        setSelected(selectionsFrom(payload))
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : '探索者设置加载失败')
      }
    })()
    return () => { alive = false }
  }, [open])

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /** 保存：先乐观更新，失败则回滚（重拉目录）。 */
  const persist = async (next: Sel[]) => {
    setSelected(next)
    setBusy(true)
    setErr(null)
    try {
      const payload = await saveExplorerSettings(next)
      setData(payload)
      setSelected(selectionsFrom(payload))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
      try {
        const fresh = await fetchExplorerSettings()
        setData(fresh)
        setSelected(selectionsFrom(fresh))
      } catch { /* 回滚也失败：保留乐观值 */ }
    } finally {
      setBusy(false)
    }
  }

  const selectedModels = new Set(selected.map((s) => s.model))

  const toggleItem = (item: ExplorerSettingItem) => {
    if (!item.available) return
    if (selectedModels.has(item.model)) {
      if (selected.length <= 1) { setErr('至少保留 1 个探索者'); return }
      void persist(selected.filter((s) => s.model !== item.model))
    } else {
      void persist([...selected, { model: item.model, label: item.label, focus: item.focus }])
    }
  }

  const toggleGroup = (group: ExplorerSettingGroup) => {
    const usable = group.items.filter((i) => i.available)
    if (!usable.length) return
    const allOn = usable.every((i) => selectedModels.has(i.model))
    if (allOn) {
      const inGroup = new Set(usable.map((i) => i.model))
      const next = selected.filter((s) => !inGroup.has(s.model))
      if (!next.length) { setErr('至少保留 1 个探索者'); return }
      void persist(next)
    } else {
      const next = [...selected]
      for (const i of usable) {
        if (!selectedModels.has(i.model)) next.push({ model: i.model, label: i.label, focus: i.focus })
      }
      void persist(next)
    }
  }

  const total = selected.length

  return (
    <span className="ts-expset" ref={boxRef}>
      {variant === 'icon' ? (
        <button
          className="ts-tg"
          data-desk-explorers=""
          data-on={open ? '1' : undefined}
          onClick={() => setOpen((v) => !v)}
          title="探索者设置：自行选择哪些探索者参与（默认 / 免费 / 收费，可逐个或整组开关，至少保留 1 个）"
        >
          <span
            aria-hidden="true"
            dangerouslySetInnerHTML={{
              __html:
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8.5" width="16" height="11" rx="3"/><path d="M12 8.5V5.5"/><circle cx="12" cy="4" r="1.4"/><circle cx="9.2" cy="13.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.8" cy="13.5" r="1.2" fill="currentColor" stroke="none"/><path d="M9.5 16.6h5"/></svg>',
            }}
          />
          {total ? <span className="ts-tg-badge">{total}</span> : null}
        </button>
      ) : (
        <button
        className={`ts-btn ts-expset-btn${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="探索者设置：自行选择哪些探索者参与（默认 / 免费 / 收费，可逐个或整组开关，至少保留 1 个）"
      >
        ⚙️ 探索者设置{total ? `（${total}）` : ''}
        </button>
      )}

      {open && pos && createPortal((
        <div
          className="ts-expset-pop"
          role="dialog"
          aria-label="探索者设置"
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right, left: 'auto' }}
        >
          <div className="ts-expset-head">
            探索者设置
            <span className="ts-expset-head-tip">至少保留 1 个；选择即时保存</span>
          </div>
          {err && <div className="ts-expset-err">⚠️ {err}</div>}
          {!data && !err && <div className="ts-expset-empty">加载中…</div>}

          {data?.groups.map((g) => {
            const usable = g.items.filter((i) => i.available)
            const allOn = usable.length > 0 && usable.every((i) => selectedModels.has(i.model))
            const onCount = g.items.filter((i) => selectedModels.has(i.model)).length
            return (
              <div className="ts-expset-group" key={g.id}>
                <div className="ts-expset-group-head">
                  <span className="ts-expset-group-name">{g.label}</span>
                  <span className="ts-expset-group-count">{onCount}/{g.items.length}</span>
                  <Switch
                    tone="group"
                    on={allOn}
                    disabled={usable.length === 0}
                    label={allOn ? `取消「${g.label}」整组` : `全选「${g.label}」整组`}
                    onToggle={() => toggleGroup(g)}
                  />
                </div>
                {g.items.length === 0 && <div className="ts-expset-empty">（暂无探索者）</div>}
                {g.items.map((it) => (
                  <div className={`ts-expset-row${it.available ? '' : ' ts-expset-row-off'}`} key={it.model}>
                    <span
                      className="ts-expset-name"
                      title={`${it.model}${it.note ? `\n${it.note}` : ''}${it.available ? '' : '\n（provider 未注册：凭据未配置，暂不可用）'}`}
                    >
                      {it.label}
                      {!it.available && <span className="ts-expset-tag">不可用</span>}
                    </span>
                    <Switch
                      on={selectedModels.has(it.model)}
                      disabled={!it.available}
                      label={`${selectedModels.has(it.model) ? '取消' : '选中'}「${it.label}」`}
                      onToggle={() => toggleItem(it)}
                    />
                  </div>
                ))}
              </div>
            )
          })}

          {busy && <div className="ts-expset-busy">保存中…</div>}
        </div>
      ), document.body)}
    </span>
  )
}
