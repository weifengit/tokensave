/**
 * 右栏：协作收益（H 台右竖顶部）
 *
 * 优势：省 token / 省费用 —— 口径：探索者实际消耗的 token 按主 agent
 *   单价折算（探索者跑在免费模型上，实际支出为 0）。数据源为各会话
 *   assistant/message.usage（提供方真实上报），非估算。
 * 劣势：主 agent 等待探索者的墙钟时间 —— 主会话 tokensave_delegate 的
 *   tool/call → tool/result 跨度，进行中的按当前时刻计。
 *
 * 界面只呈现数字与短标签；计价口径等说明一律走 title 悬浮提示。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { subscribeSessionMetrics } from '../session-subscribe'
import type { SessionMetrics } from '../session-subscribe'
import type { TelemetrySession } from './api'

/**
 * 主 agent 计价口径（元 / 百万 token）。
 * DSH 未提供价格表（已核实 llm / session-stats / token-meter 均无单价），
 * 故在此显式声明；界面用悬浮提示标注，不占版面。
 * 口径：DeepSeek 开放平台 deepseek-chat 标准价（缓存未命中输入 / 输出）。
 */
const PRICE_IN = 2.0
const PRICE_OUT = 8.0
const PRICE_TIP = `计价口径：输入 ¥${PRICE_IN.toFixed(1)}/M · 输出 ¥${PRICE_OUT.toFixed(1)}/M（主 agent 单价）。
按「同量 token 若由主 agent 承担的成本」折算；探索者用量取自提供方上报，非估算。`

const DELEGATE_TOOL = 'tokensave_delegate'

function num(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('zh-CN')
}

function money(yuan: number): string {
  if (!Number.isFinite(yuan)) return '—'
  if (yuan >= 1) return `¥${yuan.toFixed(2)}`
  if (yuan >= 0.01) return `¥${yuan.toFixed(3)}`
  return `¥${yuan.toFixed(4)}`
}

function secs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(0)}s`
  const m = Math.floor(s / 60)
  const r = Math.round(s - m * 60)
  return r > 0 ? `${m}m${r}s` : `${m}m`
}

function priceOf(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1e6) * PRICE_IN + (outputTokens / 1e6) * PRICE_OUT
}

export function SavingsColumn({
  sessionId,
  explorers,
  actions,
}: {
  sessionId: string
  explorers: TelemetrySession[]
  actions?: React.ReactNode
}) {
  const [main, setMain] = useState<SessionMetrics | null>(null)
  const [perExplorer, setPerExplorer] = useState<Record<string, SessionMetrics>>({})
  const explorersRef = useRef<TelemetrySession[]>(explorers)
  explorersRef.current = explorers
  const idKey = explorers.map((e) => e.id).join(',')

  useEffect(() => {
    if (!sessionId) return
    const unsubs: Array<() => void> = []
    unsubs.push(subscribeSessionMetrics(sessionId, (m) => setMain(m)))
    for (const ex of explorersRef.current) {
      unsubs.push(
        subscribeSessionMetrics(ex.id, (m) =>
          setPerExplorer((prev) => ({ ...prev, [ex.id]: m }))
        )
      )
    }
    return () => {
      for (const u of unsubs) {
        try {
          u()
        } catch {
          /* noop */
        }
      }
    }
  }, [sessionId, idKey])

  const stat = useMemo(() => {
    const list = explorersRef.current
    let expIn = 0
    let expOut = 0
    let expPersonMs = 0
    let active = 0

    for (const ex of list) {
      const m = perExplorer[ex.id]
      if (!m) continue
      expIn += m.inputTokens
      expOut += m.outputTokens
      if (m.firstMs !== null && m.lastMs !== null) {
        expPersonMs += Math.max(0, m.lastMs - m.firstMs)
        active++
      }
    }

    // 主 agent 等待：delegate 跨度 + 进行中的部分（按当前时刻）
    let waitMs = 0
    let calls = 0
    if (main) {
      for (const s of main.toolSpans) {
        if (s.name !== DELEGATE_TOOL) continue
        calls++
        waitMs += s.ms
      }
      for (const p of main.pendingTools) {
        if (p.name !== DELEGATE_TOOL) continue
        calls++
        waitMs += Math.max(0, Date.now() - p.startMs)
      }
    }

    const mainCost = priceOf(main?.inputTokens ?? 0, main?.outputTokens ?? 0)
    const saved = priceOf(expIn, expOut)
    const savedPct = mainCost + saved > 0 ? (saved / (mainCost + saved)) * 100 : 0

    const sessionMs =
      main && main.firstMs !== null && main.lastMs !== null
        ? Math.max(0, main.lastMs - main.firstMs)
        : 0
    const waitPct = sessionMs > 0 ? Math.min(100, (waitMs / sessionMs) * 100) : 0

    return { expIn, expOut, expPersonMs, active, waitMs, calls, mainCost, saved, savedPct, sessionMs, waitPct }
  }, [main, perExplorer, idKey])

  return (
    <div className="ts-save">
      <div className="ts-save-head">
        <span>📊 协作收益</span>
        <span className="ts-save-sub">
          {stat.calls} 次派发 · {explorers.length} 位
        </span>
        {actions}
      </div>

      <div className="ts-save-body">
        {/* —— 优势 —— */}
        <div className="ts-save-block good">
          <div className="ts-save-title" title={PRICE_TIP}>
            <span className="ts-badge good">优势</span>
            <span>省 token · 省费用</span>
          </div>
          <div className="ts-save-rows">
            <div className="ts-kv" title={`探索者 token 用量（提供方上报）\n输入 ${stat.expIn.toLocaleString('zh-CN')} · 输出 ${stat.expOut.toLocaleString('zh-CN')}`}>
              <span className="ts-kv-k">探索者用量</span>
              <span className="ts-kv-v">
                ↑{num(stat.expIn)} ↓{num(stat.expOut)}
              </span>
            </div>
            <div className="ts-kv" title="探索者跑在免费模型上：实际支出为 0">
              <span className="ts-kv-k">实际支出</span>
              <span className="ts-kv-v">
                <b className="ts-good">¥0</b>
                <span className="ts-dim">免费模型</span>
              </span>
            </div>
            <div className="ts-kv" title={PRICE_TIP}>
              <span className="ts-kv-k">省下</span>
              <span className="ts-kv-v">
                <b className="ts-good">{money(stat.saved)}</b>
                <span className="ts-dim">≈{stat.savedPct.toFixed(0)}%</span>
              </span>
            </div>
          </div>
          <div className="ts-bar-track" title={`节省占比 ${stat.savedPct.toFixed(1)}%`}>
            <div className="ts-bar-fill good" style={{ width: `${Math.max(2, stat.savedPct)}%` }} />
          </div>
        </div>

        {/* —— 劣势 —— */}
        <div className="ts-save-block bad">
          <div className="ts-save-title">
            <span className="ts-badge bad">劣势</span>
            <span>等待时间占用</span>
          </div>
          <div className="ts-save-rows">
            <div className="ts-kv" title={`主 agent 等待累计（${stat.calls} 次派发的 tool/call → tool/result 墙钟）`}>
              <span className="ts-kv-k">主 agent 等待</span>
              <span className="ts-kv-v">
                <b className="ts-bad">{secs(stat.waitMs)}</b>
                <span className="ts-dim">占 {stat.waitPct.toFixed(0)}%</span>
              </span>
            </div>
            <div className="ts-kv" title={`探索者并行总人时（${stat.active} 位已活动）`}>
              <span className="ts-kv-k">探索者人时</span>
              <span className="ts-kv-v">
                {secs(stat.expPersonMs)}
                <span className="ts-dim">{stat.active} 位</span>
              </span>
            </div>
            <div className="ts-kv" title="会话墙钟总时长（首末事件时间差）">
              <span className="ts-kv-k">会话时长</span>
              <span className="ts-kv-v">{secs(stat.sessionMs)}</span>
            </div>
          </div>
          <div className="ts-bar-track" title={`等待占比 ${stat.waitPct.toFixed(1)}%`}>
            <div className="ts-bar-fill bad" style={{ width: `${Math.max(2, stat.waitPct)}%` }} />
          </div>
        </div>

      </div>
    </div>
  )
}