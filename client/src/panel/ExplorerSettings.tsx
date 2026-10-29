/**
 * 标题行「探索者设置」：一个按钮 + 浮动面板。
 *
 * 面板按 默认 / 免费 / 收费 三个大区列出**可用**的探索者，逐个（或整组）开关；
 * 至少保留 1 个选中（最后一个不允许取消）。选择即时 POST 到宿主侧持久化
 * （~/.dsh/tokensave/explorers.json），此后 parallelExplore 完全按这份选择跑。
 *
 * 面板用 portal 挂 body：卡片链路上有 overflow:hidden（.ts-cr），就地渲染会被裁掉。
 * 落点交给 pop-anchor.ts（纯函数）：默认挂在按钮下方；下方放不下就翻到按钮上方，
 * 并且**整块夹在按钮所属的那一栏里**（由 bounds 传进去）—— 这个按钮既可能在
 * 标题行右端（它那一栏是辅助侧栏），也可能在侧置竖轨最底部（旧实现「按钮底 + 6」
 * 会把面板甩到屏幕外；380~420px 的面板还会压过侧栏伸进编辑区）。
 *
 * 加载：**先亮上次成功的快照，再后台刷新**。这份目录要先问宿主探测 provider 模型
 * （首次可能要几秒），插件重挂 / 网关重启时接口还可能整个拿不到（浏览器里就是
 * `Failed to fetch`）。以前失败只剩一行错误、面板等于是废的；现在有本地快照兜底，
 * 失败也留在原地给一枚「重试」，不白屏、也不丢已经加载出来的内容。
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchExplorerSettings, readCachedExplorerSettings, saveExplorerSettings } from './api'
import type { ExplorerSettingGroup, ExplorerSettingItem, ExplorerSettingsPayload } from './api'
import { anchorPopup, type AnchorRect } from './pop-anchor'

/** 提交/本地状态用的最小选择单位（label/focus 由目录带回，保证持久化的一致）。 */
type Sel = Pick<ExplorerSettingItem, 'model' | 'label' | 'focus'>

/** 面板落点：left/top 是 fixed 坐标，maxHeight 是这一侧真正可用的高度（面板内部滚动）。 */
type PopPos = { left: number; top: number; width: number; maxHeight: number }

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

export function ExplorerSettings({
  variant = 'text',
  bounds,
}: {
  variant?: 'text' | 'icon'
  /**
   * 面板必须待着的范围（按钮所属的那一栏，一般是侧栏）。给了就整块夹在栏内、宽度最多占满栏
   * —— 否则 380~420px 的面板会压过侧栏伸进编辑区。栏被收起（宽 < 180）时由 pop-anchor
   * 自动退回按视口夹位。
   */
  bounds?: () => AnchorRect | null
} = {}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<PopPos | null>(null)
  const [data, setData] = useState<ExplorerSettingsPayload | null>(null)
  const [selected, setSelected] = useState<Sel[]>([])
  const [err, setErr] = useState<string | null>(null)
  /** 当前显示的是不是本地快照（接口还没回来 / 回不来） */
  const [fromCache, setFromCache] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  /** 重试计数：自增即重跑加载 effect（比手写一套 loading 状态机稳） */
  const [attempt, setAttempt] = useState(0)
  const boxRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  /**
   * 落点：按钮矩形 + 视口 + 面板实测尺寸 → pop-anchor.ts。
   *
   * 两段式：首帧面板还没挂上（pos 为空）量不到尺寸，先按保守高度摆一次；挂上之后这个
   * layout effect 会带着真实尺寸再算一遍 —— 两段都在同一帧 paint 之前完成，看不到跳。
   * ResizeObserver 兜住内容高度变化（目录拉回来、分组变多）；算出来一样就不 setState，
   * 不会自己触发自己。
   */
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = boxRef.current?.getBoundingClientRect()
      if (!r) return
      const el = popRef.current
      const next = anchorPopup({
        anchor: r,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        size: { width: el ? el.offsetWidth : 0, height: el ? el.scrollHeight : 0 },
        bounds: bounds ? bounds() : null,
        heightCap: Math.round(window.innerHeight * 0.64),
      })
      setPos((prev) =>
        prev && prev.left === next.left && prev.top === next.top &&
        prev.width === next.width && prev.maxHeight === next.maxHeight
          ? prev
          : { left: next.left, top: next.top, width: next.width, maxHeight: next.maxHeight },
      )
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined' && popRef.current) {
      ro = new ResizeObserver(place)
      ro.observe(popRef.current)
    }
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      ro?.disconnect()
    }
  }, [open, data, err, loading, attempt])

  // 打开（或重试）时：先亮本地快照 → 再拉真目录。接口挂了也不会白屏。
  useEffect(() => {
    if (!open) return
    let alive = true
    if (!data) {
      const cached = readCachedExplorerSettings()
      if (cached) {
        setData(cached)
        setSelected(selectionsFrom(cached))
        setFromCache(true)
      }
    }
    setLoading(true)
    setErr(null)
    void (async () => {
      try {
        const payload = await fetchExplorerSettings()
        if (!alive) return
        setData(payload)
        setSelected(selectionsFrom(payload))
        setFromCache(false)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : '探索者设置加载失败')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [open, attempt])

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
      setFromCache(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
      try {
        const fresh = await fetchExplorerSettings()
        setData(fresh)
        setSelected(selectionsFrom(fresh))
        setFromCache(false)
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
  const retry = () => setAttempt((n) => n + 1)

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

      {open && createPortal((
        <div
          className="ts-expset-pop"
          role="dialog"
          aria-label="探索者设置"
          data-desk-explorers-panel=""
          data-compact={pos && pos.width < 300 ? '' : undefined}
          ref={popRef}
          style={{
            position: 'fixed',
            left: pos?.left ?? -10000,
            top: pos?.top ?? -10000,
            right: 'auto',
            // 宽度由落点算出（夹在所属侧栏内）；同时盖掉 CSS 的 min-width:300px，否则窄栏里会被顶回去
            width: pos ? pos.width : undefined,
            minWidth: pos ? 0 : undefined,
            maxWidth: pos ? pos.width : undefined,
            maxHeight: pos ? pos.maxHeight : undefined,
            // 首帧还没算出落点：先藏起来，等 layout effect 定位好再显（否则会闪在左上角）
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          <div className="ts-expset-head">
            探索者设置
            <span className="ts-expset-head-tip">
              {fromCache ? '上次加载 · 正在刷新' : '至少保留 1 个；选择即时保存'}
            </span>
          </div>
          {err && (
            <div className="ts-expset-err" data-desk-explorers-err="">
              <span className="ts-expset-err-text">⚠️ {err}</span>
              <button className="ts-expset-retry" type="button" onClick={retry} disabled={loading}>
                {loading ? '重试中…' : '重试'}
              </button>
            </div>
          )}
          {loading && !data && <div className="ts-expset-empty">加载中…</div>}
          {!loading && !data && !err && <div className="ts-expset-empty">（暂无目录）</div>}

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
