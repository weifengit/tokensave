/**
 * 「设置 → 脱敏」页：docmask 的运行开关。
 *
 * 每一项改动即时 POST 到宿主（写 ~/.dsh/tokensave/docmask/runtime.json），
 * Python 侧下一次调用就热加载——不需要重启 Harness，也不需要重开对话。
 *
 * 页面放在宿主设置浮层里（sidebar.settings → settings.section），
 * 与工作台互不依赖：只用本文件自己的样式表。
 */

import React, { useCallback, useEffect, useState } from 'react'
import { fetchMaskSettings, saveMaskSettings } from './mask-settings-api'
import type { MaskRuntimeValues, MaskSettingsPayload } from './mask-settings-api'
import { injectMaskSettingsStyles } from './mask-settings-styles'

type SwitchKey = Exclude<keyof MaskRuntimeValues, 'gliner_threshold'>

interface SwitchRow {
  key: SwitchKey
  label: string
  hint: string
  /** 依赖总开关：总开关关掉时这些行变灰但仍可操作（保持可预览） */
  group?: 'detector'
}

const SWITCH_ROWS: SwitchRow[] = [
  {
    key: 'enabled',
    label: '启用脱敏',
    hint: '总开关。关闭后所有识别器都不跑，原文会原样通过（Python 侧会告警）。'
  },
  {
    key: 'regex',
    label: '结构化识别（正则）',
    hint: '手机号、身份证、邮箱、银行卡、IP、API Key、Token、密码赋值等固定格式。',
    group: 'detector'
  },
  {
    key: 'glossary',
    label: '自定义词表',
    hint: '命中即脱敏：config 内联 terms/aliases 与 glossary.json（支持热加载）。',
    group: 'detector'
  },
  {
    key: 'gliner',
    label: '语义识别（GLiNER-small）',
    hint: '本地小模型识别人名/公司/地址与自定义类型；未装权重时自动降级为正则+词表。',
    group: 'detector'
  },
  {
    key: 'cache',
    label: '识别结果缓存',
    hint: '同一份文本不重复跑模型（SQLite，按内容与模型参数分键）。'
  },
  {
    key: 'audit',
    label: '脱敏后漏检检查',
    hint: '输出前再跑一遍便宜规则，发现疑似残留就告警，避免明文被静默发出。'
  },
  {
    key: 'hot_reload',
    label: '配置热加载',
    hint: '配置文件、词表、本页开关的改动在下一次调用自动生效。'
  },
  {
    key: 'auto_persist_sessions',
    label: '会话映射自动加密落盘',
    hint: '跨进程多轮对话需要（密码来自 DOCMASK_PASSWORD）。默认只留在内存。'
  }
]

function Switch({ on, disabled, label, onToggle }: {
  on: boolean
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
      className="tsm-switch"
      onClick={(event) => { event.stopPropagation(); onToggle() }}
    >
      <span className="tsm-knob" aria-hidden="true" />
    </button>
  )
}

export function MaskSettings() {
  const [data, setData] = useState<MaskSettingsPayload | null>(null)
  const [threshold, setThreshold] = useState(0.35)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => { injectMaskSettingsStyles() }, [])

  const load = useCallback(async () => {
    setErr(null)
    try {
      const payload = await fetchMaskSettings()
      setData(payload)
      setThreshold(payload.values.gliner_threshold)
    } catch (error) {
      setErr(error instanceof Error ? error.message : '脱敏设置加载失败')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const persist = useCallback(async (patch: Partial<MaskRuntimeValues>) => {
    // 乐观更新：开关手感优先；失败时用服务端快照回滚。
    setData((prev) => (prev ? { ...prev, values: { ...prev.values, ...patch } } : prev))
    setBusy(true)
    setErr(null)
    try {
      const fresh = await saveMaskSettings(patch)
      setData(fresh)
      setThreshold(fresh.values.gliner_threshold)
      setSavedAt(new Date().toLocaleTimeString())
    } catch (error) {
      setErr(error instanceof Error ? error.message : '脱敏设置保存失败')
      try {
        const fresh = await fetchMaskSettings()
        setData(fresh)
        setThreshold(fresh.values.gliner_threshold)
      } catch {
        /* 回滚也失败：保留乐观值，错误已经提示 */
      }
    } finally {
      setBusy(false)
    }
  }, [])

  const values = data?.values
  const masterOff = values ? !values.enabled : false

  return (
    <div className="tsm-page">
      <div className="tsm-head">
        <h2 className="tsm-title">脱敏（docmask）</h2>
        <span className="tsm-badge">本地离线</span>
      </div>
      <p className="tsm-desc">
        文档与对话里的敏感信息在本地换成本会话占位符（如 <code>&lt;&lt;PER_1&gt;&gt;</code>），
        只把占位符文本发给模型；映射表与明文始终留在本机，回答回来后在本地还原。
      </p>

      {err && <div className="tsm-err">⚠️ {err}</div>}
      {!data && !err && <div className="tsm-loading">加载中…</div>}

      {data && values && (
        <>
          <section className="tsm-card">
            <div className="tsm-card-head">
              识别与安全
              <span className="tsm-card-tip">改动即时生效 · Python 侧热加载</span>
            </div>
            {SWITCH_ROWS.map((row) => {
              const on = Boolean(values[row.key])
              const dimmed = row.group === 'detector' && masterOff
              return (
                <div className={`tsm-row${dimmed ? ' tsm-row-off' : ''}`} key={row.key}>
                  <div className="tsm-row-text">
                    <span className="tsm-row-label">{row.label}</span>
                    <span className="tsm-row-hint">{row.hint}</span>
                  </div>
                  <Switch
                    on={on}
                    disabled={busy}
                    label={`${on ? '关闭' : '开启'}「${row.label}」`}
                    onToggle={() => void persist({ [row.key]: !on } as Partial<MaskRuntimeValues>)}
                  />
                </div>
              )
            })}
          </section>

          <section className="tsm-card">
            <div className="tsm-card-head">
              语义识别阈值
              <span className="tsm-card-tip">越高越保守（漏检风险↑ / 误替换↓）</span>
            </div>
            <div className="tsm-row">
              <div className="tsm-row-text">
                <span className="tsm-row-label">GLiNER 命中阈值</span>
                <span className="tsm-row-hint">仅对语义识别生效；拖动后松手保存。</span>
              </div>
              <div className="tsm-threshold">
                <input
                  type="range"
                  min={0.05}
                  max={0.95}
                  step={0.05}
                  value={threshold}
                  disabled={busy || !values.gliner}
                  aria-label="GLiNER 命中阈值"
                  onChange={(event) => setThreshold(Number(event.target.value))}
                  onPointerUp={() => void persist({ gliner_threshold: threshold })}
                  onKeyUp={() => void persist({ gliner_threshold: threshold })}
                  onBlur={() => void persist({ gliner_threshold: threshold })}
                />
                <span className="tsm-threshold-value">{threshold.toFixed(2)}</span>
              </div>
            </div>
          </section>

          <section className="tsm-card tsm-paths">
            <div className="tsm-path">
              <span className="tsm-path-key">开关文件</span>
              <span className="tsm-path-val">{data.path}{data.exists ? '' : '（尚未创建，保存即生成）'}</span>
            </div>
            <div className="tsm-path">
              <span className="tsm-path-key">基础配置</span>
              <span className="tsm-path-val">{data.baseConfigHint}（实体类型 / 词表 / 模型路径，面板不改它）</span>
            </div>
          </section>

          <div className="tsm-foot">
            <button type="button" disabled={busy} onClick={() => void load()}>刷新</button>
            <span>{busy ? '保存中…' : savedAt ? `已保存 ${savedAt}` : '本页参数由 docmask 的 Python 端读取'}</span>
          </div>
        </>
      )}
    </div>
  )
}
