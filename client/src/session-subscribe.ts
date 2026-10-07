// 客户端上下文捕获 + 会话消息订阅（Step 11）。
//
// 数据源按 0.2.0-rc.2 真实契约核对（dsh-api-session-controller types）：
//   ctx.sessions.retain(target, { source }) → SessionReference.ready: Promise<SessionBinding>
//   binding.eventSource: SessionEventWindow 的 ObservableSnapshot ——
//     subscribe(listener) 的回调是「失效通知」（参数为 void），数据必须自己
//     src.getSnapshot() 读 { entries, change, revision } 全量窗口再重建消息列表。
//   （文档占位名 subscribeSession 的正式实现；2026-10-06 Step 11 修正了
//    「在失效回调里取 x.event」的错误用法——那永远收不到消息。）
//
// 降级：retain/eventSource → session.subscribe（逐事件推送）→ 控制台留痕等待态。
import type { Context } from '@deepseek-ai/cordis'

export interface StreamMsg {
  role: string
  content: string
  /** 事件时间（Unix ms，来自 SessionEvent.time）；窗口重建时保留，供时间轴/计时使用 */
  time?: number
  /** 该条消息的 token 用量（assistant/message.usage）；主 agent 与探索者同源可用 */
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number }
  /** 事件类型原文（如 assistant/message、tool/result），需要精确分类时用 */
  type?: string
}

// —— 会话指标（token 用量 / 工具耗时 / 活动时间窗）————————————
// 与 messagesFromWindow 共用同一窗口快照做只读折叠，不额外发请求。
// usage 来自 assistant/message.usage（提供方真实上报，非估算）；工具耗时来自
// tool/call → tool/result 按 callId 配对（SessionEvent.time 为 Unix ms）。
export interface ToolSpan {
  callId: string
  name: string
  startMs: number
  endMs: number | null
  ms: number
}

export interface SessionMetrics {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  /** 已配对完成的工具调用 */
  toolSpans: ToolSpan[]
  /** 已发出但尚无结果的工具调用（仍在执行） */
  pendingTools: ToolSpan[]
  firstMs: number | null
  lastMs: number | null
  assistantCount: number
  toolCallCount: number
  lastAssistant: string
  lastAssistantMs: number | null
  lastUser: string
}
export type MetricsListener = (metrics: SessionMetrics) => void

type Unsub = () => void
type Listener = (msgs: StreamMsg[]) => void

let clientCtx: Context | null = null

export function setClientContext(ctx: Context): void {
  clientCtx = ctx
}

export function getClientContext(): Context | null {
  return clientCtx
}

/**
 * 取一个宿主客户端服务。
 *
 * 必须走 ctx.get()（reflect 层）：cordis 的 context 代理在读取未声明的服务时
 * 会直接抛 'cannot get property "X" without inject'，而可选链拦不住 throw。
 * 本插件只 inject 了 slots，所以 sessions / workspaces / uiWorkspace / boardStore
 * 等一律用这个函数取（与 src/board-web-route.ts 同款处理）。
 */
export function readService<T = any>(ctx: any, name: string): T | undefined {
  if (!ctx) return undefined
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]
  } catch {
    return undefined
  }
}

interface Channel {
  /** 当前消息列表（从事件窗口全量重建，非增量追加） */
  msgs: StreamMsg[]
  subs: Set<Listener>
  metrics: SessionMetrics
  metricSubs: Set<MetricsListener>
  close?: Unsub
}

const channels = new Map<string, Channel>()

// —— 事件 → 消息 投影 ————————————————————————————————

function textOf(c: any): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((b: any) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : ''))
      .join('')
      .trim()
  }
  return ''
}

/** 从各类事件负载中抽取可见文本（user/assistant/tool-result 的 content 块布局各不相同）。 */
function contentOf(ev: any): string {
  if (!ev || typeof ev !== 'object') return ''
  const data = ev.data && typeof ev.data === 'object' ? ev.data : ev
  const candidates = [data.content, data.message?.content, data.result?.content, ev.content]
  for (const c of candidates) {
    const t = textOf(c)
    if (t) return t
  }
  if (typeof data.text === 'string') return data.text
  return ''
}

function roleOf(type: string): string {
  if (type.startsWith('user/')) return 'user'
  if (type.startsWith('assistant/')) return 'assistant'
  if (type.startsWith('tool/')) return 'tool'
  return 'system'
}

/**
 * 把 SessionEventWindow 快照重建为消息列表：
 * - durable 事件（{ type:'event', event }）：user/assistant/tool-result 进流，
 *   system/message（渲染后的整份系统提示词）与 tool/call（参数 JSON）不进流；
 * - transient 行（assistant/live-chunk 文本增量）按 attemptId 累积成一条 assistant 消息，
 *   settle 时窗口会滤掉 transient 并放入 durable 行 —— 全量重建天然不重复。
 */
export function messagesFromWindow(snap: any): StreamMsg[] {
  const entries: any[] = Array.isArray(snap?.entries) ? snap.entries : []
  const out: StreamMsg[] = []
  let live: StreamMsg | null = null
  let liveAttempt = ''
  for (const e of entries) {
    if (e?.type === 'transient') {
      const ev = e.event
      if (ev?.type !== 'assistant/live-chunk') continue
      const chunk = ev?.data?.chunk
      if (chunk?.type !== 'text-delta' || typeof chunk.text !== 'string' || !chunk.text) continue
      const id = String(ev?.data?.attemptId ?? '')
      if (!live || liveAttempt !== id) {
        live = { role: 'assistant', content: '' }
        liveAttempt = id
        out.push(live)
      }
      live.content += chunk.text
      continue
    }
    const ev = e?.event
    if (!ev || typeof ev.type !== 'string') continue
    if (ev.type === 'system/message' || ev.type === 'tool/call') continue
    const content = contentOf(ev)
    if (!content) continue
    live = null
    out.push({ role: roleOf(ev.type), content, time: typeof ev.time === 'number' ? ev.time : undefined, usage: ev?.data?.usage, type: ev.type })
  }
  return out
}

/** 空指标（订阅初值，避免消费方读到 undefined 字段） */
export function emptyMetrics(): SessionMetrics {
  return {
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
    toolSpans: [], pendingTools: [],
    firstMs: null, lastMs: null,
    assistantCount: 0, toolCallCount: 0,
    lastAssistant: '', lastAssistantMs: null, lastUser: '',
  }
}

/**
 * 从窗口快照折叠会话指标。
 * - token：assistant/message.usage 逐条累加（提供方真实上报）；
 * - 工具耗时：tool/call 开 span、tool/result 按 callId 收口；
 * - 时间窗：全部事件的 SessionEvent.time 取 min/max。
 */
export function metricsFromWindow(snap: any): SessionMetrics {
  const entries: any[] = Array.isArray(snap?.entries) ? snap.entries : []
  const m = emptyMetrics()
  const open = new Map<string, ToolSpan>()
  for (const e of entries) {
    const ev = e?.type === 'transient' ? e.event : e?.event
    if (!ev || typeof ev.type !== 'string') continue
    const t = typeof ev.time === 'number' ? ev.time : null
    if (t !== null) {
      if (m.firstMs === null || t < m.firstMs) m.firstMs = t
      if (m.lastMs === null || t > m.lastMs) m.lastMs = t
    }
    const data = ev.data && typeof ev.data === 'object' ? ev.data : {}
    if (ev.type === 'assistant/message') {
      m.assistantCount++
      const u = data.usage
      if (u) {
        m.inputTokens += Number(u.inputTokens) || 0
        m.outputTokens += Number(u.outputTokens) || 0
        m.reasoningTokens += Number(u.reasoningTokens) || 0
      }
      const text = contentOf(ev)
      if (text) { m.lastAssistant = text.slice(0, 400); m.lastAssistantMs = t }
    } else if (ev.type === 'user/message') {
      const text = contentOf(ev)
      if (text) m.lastUser = text.slice(0, 400)
    } else if (ev.type === 'tool/call') {
      m.toolCallCount++
      const callId = String(data.callId ?? '')
      if (callId) {
        open.set(callId, { callId, name: String(data.name ?? ''), startMs: t ?? Date.now(), endMs: null, ms: 0 })
      }
    } else if (ev.type === 'tool/result') {
      const callId = String(data.callId ?? '')
      const span = callId ? open.get(callId) : undefined
      if (span) {
        open.delete(callId)
        span.endMs = t
        span.ms = Math.max(0, (t ?? span.startMs) - span.startMs)
        m.toolSpans.push(span)
      }
    }
  }
  m.pendingTools = Array.from(open.values())
  m.toolSpans.sort((a, b) => a.startMs - b.startMs)
  return m
}

// —— 订阅面 ——————————————————————————————————————————

function publish(ch: Channel): void {
  const snapshot = ch.msgs.slice()
  ch.subs.forEach((f) => {
    try {
      f(snapshot)
    } catch (e) {
      console.warn('[tokensave] 订阅回调失败', e)
    }
  })
  const metrics = ch.metrics
  ch.metricSubs.forEach((f) => {
    try {
      f(metrics)
    } catch (e) {
      console.warn('[tokensave] 指标回调失败', e)
    }
  })
}

function emitEvent(ch: Channel, x: any): void {
  const ev = x && typeof x === 'object' && x.event ? x.event : x
  if (!ev || typeof ev.type !== 'string') return
  if (ev.type === 'system/message' || ev.type === 'tool/call') return
  const content = contentOf(ev)
  if (!content) return
  ch.msgs = ch.msgs.concat({ role: roleOf(ev.type), content, time: typeof ev.time === 'number' ? ev.time : undefined, usage: ev?.data?.usage, type: ev.type })
  if (typeof ev.time === 'number') ch.metrics.lastMs = ev.time
  publish(ch)
}

/**
 * 订阅一个会话的消息列表（浮窗对话流数据源）。
 * 订阅时立即推送当前列表，之后每次窗口变化推送全量新数组；
 * 同一会话共享一条底层流。
 */
export function subscribeSession(sessionId: string, onMsgs: Listener): Unsub {
  let ch = channels.get(sessionId)
  if (!ch) {
    ch = { msgs: [], subs: new Set(), metrics: emptyMetrics(), metricSubs: new Set() }
    channels.set(sessionId, ch)
    void openStream(sessionId, ch)
  }
  const target = ch
  target.subs.add(onMsgs)
  try {
    onMsgs(target.msgs.slice())
  } catch {
    /* 初值推送失败不影响后续 */
  }
  return () => {
    target.subs.delete(onMsgs)
  }
}

/**
 * 订阅一个会话的指标（token 用量 / 工具耗时 / 活动时间窗）。
 * 与 subscribeSession 共用同一条底层流；订阅时立即推送当前值。
 */
export function subscribeSessionMetrics(sessionId: string, onMetrics: MetricsListener): Unsub {
  let ch = channels.get(sessionId)
  if (!ch) {
    ch = { msgs: [], subs: new Set(), metrics: emptyMetrics(), metricSubs: new Set() }
    channels.set(sessionId, ch)
    void openStream(sessionId, ch)
  }
  const target = ch
  target.metricSubs.add(onMetrics)
  try {
    onMetrics(target.metrics)
  } catch {
    /* 初值推送失败不影响后续 */
  }
  return () => {
    target.metricSubs.delete(onMetrics)
  }
}

async function openStream(sessionId: string, ch: Channel): Promise<void> {
  const ctx = clientCtx as any
  // 服务一律经 ctx.get()（reflect 层，不经 inject 闸门）取得：
  // 本插件只声明了 inject={slots:true}，直接读 ctx.sessions 会被 cordis 代理
  // 以 'cannot get property "sessions" without inject' 抛错（可选链也拦不住），
  // 导致 openStream 静默死亡、所有窗口永远不更新。
  const sessions = readService(ctx, 'sessions')
  if (!sessions) {
    console.warn('[tokensave] client ctx.sessions 不可用，浮窗进入等待态')
    return
  }

  // 路径 A：KB/类型契约路径 retain → ready → binding.eventSource（ObservableSnapshot）
  if (typeof sessions.retain === 'function') {
    for (const source of ['navigation', 'tokensave', 'completion']) {
      let ref: any = null
      try {
        ref = sessions.retain(sessionId, { source })
        const binding = await ref?.ready
        const src: any = binding?.eventSource
        if (src && typeof src.subscribe === 'function') {
          const emit = () => {
            let snap: any = null
            try {
              snap = typeof src.getSnapshot === 'function' ? src.getSnapshot() : null
            } catch (e) {
              console.warn('[tokensave] getSnapshot 失败', e)
            }
            ch.msgs = messagesFromWindow(snap)
            ch.metrics = metricsFromWindow(snap)
            publish(ch)
          }
          const un = src.subscribe(emit)
          ch.close = () => {
            try {
              un?.()
              ref?.release?.()
            } catch {
              /* noop */
            }
          }
          emit()
          console.log(`[tokensave] 会话流已连接（retain/${source} → eventSource 快照）`)
          return
        }
        try {
          ref?.release?.()
        } catch {
          /* noop */
        }
      } catch (e: any) {
        console.warn(`[tokensave] retain(source=${source}) 失败:`, String(e?.message ?? e))
        try {
          ref?.release?.()
        } catch {
          /* noop */
        }
      }
    }
  }

  // 路径 B：会话对象自带逐事件订阅面
  try {
    const s: any = typeof sessions.get === 'function' ? sessions.get(sessionId) : null
    if (s && typeof s.subscribe === 'function') {
      const u = s.subscribe((x: any) => emitEvent(ch, x?.event ?? x))
      ch.close = () => u?.()
      console.log('[tokensave] 会话流已连接（session.subscribe）')
      return
    }
  } catch (e: any) {
    console.warn('[tokensave] session.subscribe 失败:', String(e?.message ?? e))
  }

  console.warn(`[tokensave] 未能为 ${sessionId} 打开会话流，浮窗显示等待态`)
}
