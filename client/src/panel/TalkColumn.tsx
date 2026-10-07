/**
 * 左栏：主 agent ↔ 探索者 沟通时间轴（H 台左竖顶部）
 *
 * 数据全部来自真实事件流（订阅主会话指标 + 各探索者会话消息），
 * 组件只做「措辞包装」——把真实事件翻译成友好对白，不虚构任何内容：
 *   - 探索者的首条 user 消息 = 主 agent 实际下发的任务原文
 *   - 探索者的首条 assistant 消息 = 真正开工的时刻
 *   - 后续 assistant 消息 = 进度/完成汇报（原文截断）
 *   - 含报错特征的 tool 结果 = 「遇到问题」
 *   - 主会话的 tokensave_delegate 工具跨度 = 派发 / 等待 / 汇总
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { subscribeSession, subscribeSessionMetrics } from '../session-subscribe'
import type { SessionMetrics, StreamMsg } from '../session-subscribe'
import type { TelemetrySession } from './api'

interface TalkLine {
  key: string
  timeMs: number
  side: 'main' | 'explorer'
  who: string
  glyph: string
  tone: 'info' | 'work' | 'warn' | 'done'
  text: string
}

const MAIN_GLYPH = '🧭'
const EXP_GLYPH = '🔍'

function shortLabel(s: TelemetrySession): string {
  const t = String(s?.title || '')
  const raw = t.startsWith('tokensave-') ? t.slice('tokensave-'.length) : t
  return raw || String(s?.shortId || s?.id || '').slice(0, 6) || '探索者'
}

function clean(text: string): string {
  return String(text || '')
    .replace(/<!--\s*tokensave-brief:v\d+:(start|end)\s*-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cut(text: string, max: number): string {
  const t = clean(text)
  return t.length > max ? t.slice(0, max) + '…' : t
}

/** 报错特征：用于把 tool 结果判定为「遇到问题」（只认明显信号，不猜） */
function looksLikeProblem(text: string): boolean {
  const t = clean(text).slice(0, 400)
  return /\b(error|failed|failure|exception|timeout|refused|not found)\b|失败|错误|异常|无法|超时|拒绝/i.test(t)
}

function hhmmss(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function TalkColumn({
  sessionId,
  explorers,
  actions,
}: {
  sessionId: string
  explorers: TelemetrySession[]
  actions?: React.ReactNode
}) {
  const [lines, setLines] = useState<TalkLine[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  // 探索者列表每 8s 轮询会换新数组引用：用 id 串做依赖，避免反复重订阅
  const explorersRef = useRef<TelemetrySession[]>(explorers)
  explorersRef.current = explorers
  const idKey = explorers.map((e) => e.id).join(',')

  useEffect(() => {
    if (!sessionId) return
    const msgs = new Map<string, StreamMsg[]>()
    const emetrics = new Map<string, SessionMetrics>()
    let mainMetrics: SessionMetrics | null = null
    let closed = false

    const rebuild = () => {
      if (closed) return
      const list = explorersRef.current
      const out: TalkLine[] = []

      // —— 主 agent 侧：派发 / 等待 / 汇总（来自主会话真实工具跨度） ——
      if (mainMetrics) {
        for (const span of mainMetrics.toolSpans) {
          if (span.name !== 'tokensave_delegate') continue
          out.push({
            key: `main-dispatch-${span.callId}`,
            timeMs: span.startMs,
            side: 'main',
            who: '主 agent',
            glyph: MAIN_GLYPH,
            tone: 'info',
            text: `派发探索任务（并行 ${list.length || '若干'} 个探索者）`,
          })
          out.push({
            key: `main-collect-${span.callId}`,
            timeMs: span.endMs ?? span.startMs + span.ms,
            side: 'main',
            who: '主 agent',
            glyph: MAIN_GLYPH,
            tone: 'done',
            text: `收齐探索结果，生成任务简报 ✅（等了 ${(span.ms / 1000).toFixed(1)}s）`,
          })
        }
        const pending = mainMetrics.pendingTools.filter((p) => p.name === 'tokensave_delegate')
        for (const p of pending) {
          out.push({
            key: `main-wait-${p.callId}`,
            timeMs: Math.max(p.startMs, (mainMetrics.lastMs ?? p.startMs) - 1),
            side: 'main',
            who: '主 agent',
            glyph: MAIN_GLYPH,
            tone: 'work',
            text: `等待探索者返回…（已等 ${((Date.now() - p.startMs) / 1000).toFixed(0)}s）`,
          })
        }
      }

      // —— 每个探索者：任务下发 → 开工 → 进度/汇报 → 问题 ——
      for (const ex of list) {
        const label = shortLabel(ex)
        const list2 = msgs.get(ex.id) || []
        const m = emetrics.get(ex.id)

        const firstUser = list2.find((x) => x.role === 'user' && clean(x.content))
        if (firstUser) {
          out.push({
            key: `${ex.id}-assign`,
            timeMs: firstUser.time ?? (m?.firstMs ?? Date.now()),
            side: 'main',
            who: '主 agent',
            glyph: MAIN_GLYPH,
            tone: 'info',
            text: `交给「${label}」：${cut(firstUser.content, 140)}`,
          })
        }

        const assistants = list2.filter((x) => x.role === 'assistant' && clean(x.content))
        if (assistants.length > 0) {
          out.push({
            key: `${ex.id}-start`,
            timeMs: assistants[0].time ?? (m?.firstMs ?? Date.now()),
            side: 'explorer',
            who: label,
            glyph: EXP_GLYPH,
            tone: 'work',
            text: '收到，开始干活了 🚀',
          })
          assistants.forEach((a, i) => {
            const isLast = i === assistants.length - 1
            out.push({
              key: `${ex.id}-a-${i}`,
              timeMs: a.time ?? Date.now(),
              side: 'explorer',
              who: label,
              glyph: EXP_GLYPH,
              tone: isLast ? 'done' : 'work',
              text: `${isLast ? '完成汇报' : '进度'}：${cut(a.content, 180)}`,
            })
          })
        }

        // 报错的 tool 结果 → 遇到问题（仅取前 2 条，避免刷屏）
        const problems = list2
          .filter((x) => x.role === 'tool' && looksLikeProblem(x.content))
          .slice(0, 2)
        problems.forEach((p, i) => {
          out.push({
            key: `${ex.id}-p-${i}`,
            timeMs: p.time ?? Date.now(),
            side: 'explorer',
            who: label,
            glyph: EXP_GLYPH,
            tone: 'warn',
            text: `遇到问题：${cut(p.content, 150)}`,
          })
        })

        // 空闲且已汇报 → 主 agent 收尾语（该探索者确实有产出时才说）
        if (m && m.lastMs !== null && assistants.length > 0 && ex.state !== 'running') {
          out.push({
            key: `${ex.id}-ack`,
            timeMs: m.lastMs,
            side: 'main',
            who: '主 agent',
            glyph: MAIN_GLYPH,
            tone: 'info',
            text: `收到「${label}」的汇报，已并入交叉验证 ✔`,
          })
        }
      }

      out.sort((a, b) => a.timeMs - b.timeMs)
      setLines(out.slice(-120))
    }

    const unsubs: Array<() => void> = []
    unsubs.push(
      subscribeSessionMetrics(sessionId, (m) => {
        mainMetrics = m
        rebuild()
      })
    )
    for (const ex of explorersRef.current) {
      unsubs.push(
        subscribeSession(ex.id, (l) => {
          msgs.set(ex.id, l)
          rebuild()
        })
      )
      unsubs.push(
        subscribeSessionMetrics(ex.id, (m) => {
          emetrics.set(ex.id, m)
          rebuild()
        })
      )
    }

    return () => {
      closed = true
      for (const u of unsubs) {
        try {
          u()
        } catch {
          /* noop */
        }
      }
    }
  }, [sessionId, idKey])

  // 自动滚到底部（按最后一条的内容长度触发，覆盖流式追加）
  const lastLen = lines.length > 0 ? lines[lines.length - 1].text.length : 0
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length, lastLen])

  const talkCount = useMemo(() => lines.filter((l) => l.side === 'explorer').length, [lines])

  return (
    <div className="ts-talk">
      <div className="ts-talk-head">
        <span>💬 协作对话</span>
        <span className="ts-talk-sub">
          {explorers.length} 位探索者 · {talkCount} 条发言
        </span>
        {actions}
      </div>
      <div className="ts-talk-list" ref={listRef}>
        {lines.length === 0 && (
          <div className="ts-hint">
            暂无协作记录。主 agent 调用 <code>tokensave_delegate</code> 后，这里会实时显示派发 / 开工 / 进度 / 汇报。
          </div>
        )}
        {lines.map((l) => (
          <div key={l.key} className={`ts-talk-line ${l.side} tone-${l.tone}`}>
            <span className="ts-talk-glyph" title={l.who}>
              {l.glyph}
            </span>
            <div className="ts-talk-body">
              <div className="ts-talk-meta">
                <span className="ts-talk-who">{l.who}</span>
                <span className="ts-talk-time">{hhmmss(l.timeMs)}</span>
              </div>
              <div className="ts-talk-text">{l.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}