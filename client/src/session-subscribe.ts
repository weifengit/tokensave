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
  /**
   * 细分类型：'reasoning' 表示这是模型的思考（thinking）内容。
   * 思考与正文同为 assistant 流，但呈现上要分开（思考默认折叠，见 MsgList）。
   */
  kind?: 'reasoning' | 'file-edit' | 'changes'
  /**
   * 该消息是宿主**自动注入**的上下文（运行时快照 / 技能目录 / 工作区指令…），
   * 而非用户亲口发送。
   * 依据：这类消息事件类型同为 user/message，但 data.source.kind 是
   * runtime-context / skill-catalog / agent-instructions 等，只有真人消息才是 'user'。
   * 呈现上要与真实用户气泡分开（见 MsgList 的「上下文注入」折叠行）。
   */
  injected?: boolean
  /** 注入来源（event.data.source.kind），用于给人话标签 */
  injectKind?: string
  /**
   * 该消息在宿主**收件箱队列**里（会话忙时发的消息先进 queue，
   * 下一轮开始才成为 durable user/message）。依据 agent/inbox/spliced
   * 事件折叠出来（用户反馈：忙时发的第二条 / 自动继续的「继续」看不见——
   * 宿主原生「对话」有 QueueDock 显示队列，我们的消息流以前直接丢了这个事件）。
   */
  queued?: boolean
  /**
   * 本轮的**异常结局**（`turn/end` 的 reason / `agent/error`）。
   *
   * 有值 = 这一轮不是正常结束（故障中断 / 输出被截断 / 异常中止）。
   * 以前 `turn/end` 被直接丢掉，于是「本轮被故障中止」只在宿主原生「对话」
   * tab 里可见，工作台里与正常结束长得一模一样（用户反馈）。
   */
  notice?: TurnNotice

  /**
   * 该 tool/call 是一次**文件编辑**（write / edit / str_replace_editor，与宿主
   * dsh-workspace-changes 的 mutationPath 同口径），editPath 是目标文件路径。
   * 只作为轮次统计的标记存在（不渲染气泡）；MsgList 按轮去重后在轮末
   * 展示「已编辑 N 个文件」——对齐原生对话 tab 的结束报告。
   */
  editPath?: string
  /**
   * 该行是本轮**变更档案**（`workspace/changes` 事件）。
   * changesSeq = 事件 seq，用于向宿主认证路由要完整清单 / 单文件 diff
   * （与原生对话 tab 的「已编辑 N 个文件」卡同源，含 +N/-M 与悬浮预览）。
   */
  changesSeq?: number
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
  binding?: any
  /**
   * 底层流状态：openStream 只在首次订阅时跑一次，新建会话刚创建时 binding
   * 尚未物化、retain 三源可能全失败——以前失败后通道永久停在空列表，
   * 后续发出去的消息（含自动继续的「继续」）永远看不见（用户反馈）。
   * failed 时由订阅入口/延时重试重新拉起。
   */
  streamState?: 'connecting' | 'open' | 'failed'
  retryTimer?: ReturnType<typeof setTimeout>
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


// —— 文件编辑口径（与宿主 dsh-workspace-changes 的 mutationPath 对齐）——————
/**
 * 会把文件写进工作区的工具及其路径参数：write→file_path、edit→file_path（有新旧串）、
 * str_replace_editor→path（仅 create/str_replace/insert 三种 command）。
 * 宿主的「变更文件」卡（交付物面板 / 对话 tab）统计的就是这三类；
 * 这里同口径提取，用于工作台轮末的「已编辑 N 个文件」。
 */
export function fileEditOf(name: unknown, args: unknown): string | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null
  const a = args as Record<string, unknown>
  const path = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
  switch (name) {
    case 'write':
      return typeof a.content === 'string' ? path(a.file_path) : null
    case 'edit':
      return typeof a.old_string === 'string' && typeof a.new_string === 'string' ? path(a.file_path) : null
    case 'str_replace_editor':
      return a.command === 'create' || a.command === 'str_replace' || a.command === 'insert'
        ? path(a.path)
        : null
    default:
      return null
  }
}

/**
 * 本轮变更档案的 seq（宿主 workspace/changes 事件）。
 *
 * 宿主 dsh-workspace-changes 在每轮结束时追加一条 workspace/changes 事件，
 * data 只有 turn；真正的清单/行数/diff 由认证路由按 (sessionId, seq) 提供。
 * 拿到 seq 就能直接照搬原生卡（含 +N/-M 与悬浮 diff 预览），不必自己猜；
 * 拿不到（宿主版本变了 / 工作区不是 git 仓）时退回 file-edit 标记的纯路径统计。
 */
export function changesSeqOf(ev: any): number | null {
  const seq = typeof ev?.seq === 'number' ? ev.seq : null
  if (seq === null || !Number.isSafeInteger(seq) || seq < 1) return null
  const turn = ev?.data?.turn
  if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1) return null
  return seq
}

/**
 * 从事件里抽出**思考**（reasoning）块文本。
 *
 * 依据（读 dsh-llm 的 ContentBlockMap）：assistant 消息的 content 是 ContentBlock[]，
 * 其中 `{type:'reasoning', text}` 是思考、`{type:'text', text}` 是正文。
 * `textOf` 会把两者拼在一起，因此必须单独挑出 reasoning 才能分开呈现。
 */
function reasoningOf(ev: any): string {
  if (!ev || typeof ev !== 'object') return ''
  const data = ev.data && typeof ev.data === 'object' ? ev.data : ev
  const cands = [data.content, data.message?.content]
  for (const c of cands) {
    if (!Array.isArray(c)) continue
    const parts = c
      .filter((b: any) => b && typeof b === 'object' && b.type === 'reasoning' && typeof b.text === 'string')
      .map((b: any) => b.text)
    if (parts.length > 0) return parts.join('').trim()
  }
  return ''
}

/**
 * 从事件里抽出**可见正文**：把 reasoning 块排除在外。
 * 否则思考会混进最终回答（与 reasoningOf 重复显示）。
 */
function visibleTextOf(ev: any): string {
  if (!ev || typeof ev !== 'object') return ''
  const data = ev.data && typeof ev.data === 'object' ? ev.data : ev
  const cands = [data.content, data.message?.content, data.result?.content, ev.content]
  for (const c of cands) {
    if (!Array.isArray(c)) {
      const t = textOf(c)
      if (t) return t
      continue
    }
    // 数组：只取非 reasoning 块
    const t = c
      .filter((b: any) => !(b && typeof b === 'object' && b.type === 'reasoning'))
      .map((b: any) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : ''))
      .join('')
      .trim()
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
 * 判定一条 `user/message` 是否为宿主**自动注入**的上下文。
 *
 * 依据（0.2.0-rc.2 真实契约）：运行时上下文快照、技能目录、工作区指令等
 * 同样以 user 角色写进会话（dsh-agent-loop 的 RuntimeContextProjection、
 * dsh-tool-skill 的目录注入），但 `data.source.kind` 分别是
 * runtime-context / skill-catalog / agent-instructions / skill-invocation …；
 * 只有用户亲手发送的消息 source.kind 才是 'user'。
 *
 * 老数据或压根没有 source 的消息按真实用户处理（保守：宁可显示，不误折叠）。
 */
function injectionOf(ev: any): { injected: boolean; kind?: string } {
  if (!ev || ev.type !== 'user/message') return { injected: false }
  const source = ev.data?.source
  const kind = typeof source?.kind === 'string' ? source.kind : ''
  if (kind === '' || kind === 'user') return { injected: false }
  return { injected: true, kind }
}

/**
 * 队列消息（agent/inbox/spliced 的 inserted 项）→ StreamMsg。
 * 形状与 user/message 的 data 基本一致（content 块数组 + source + role）。
 */
function queuedMsgOf(m: any, time?: number): StreamMsg | null {
  if (!m || typeof m !== 'object') return null
  const text = visibleTextOf(m)
  if (!text) return null
  return { role: 'user', content: text, time, type: 'agent/inbox/spliced', queued: true }
}

/**
 * 把一条 `agent/inbox/spliced` 应用到队列数组（splice 语义与事件同名同参：
 * target=next-turn 的队列在 start 处删 removedCount 条、插入 inserted）。
 * 队列消息被消费时宿主先写 spliced(removedCount) 再写 durable user/message，
 * 全量重放天然不重复。
 */
function applySplice(queue: StreamMsg[], data: any, time?: number): void {
  if (!data || data.target !== 'next-turn') return
  const start = typeof data.start === 'number' ? data.start : 0
  const removed = typeof data.removedCount === 'number' ? data.removedCount : 0
  const inserted = Array.isArray(data.inserted) ? data.inserted : []
  const items = inserted.map((m: any) => queuedMsgOf(m, time)).filter(Boolean) as StreamMsg[]
  queue.splice(start, removed, ...items)
}


/**
 * 一轮为何异常结束（归一化后的可读说明）。
 *
 * 语义对齐宿主 dsh-client-ui-chat 的 turn-error / turn-max-tokens 节点：
 *   reason.kind === 'error'      → 用 reason.error.{message,code}（如 REASONING_LOOP）
 *   reason.kind === 'max-tokens' → 输出被 token 上限截断
 *   reason.kind === 'aborted'    → 用户主动停止**不报**；钩子/登出等异常中止要报
 *   reason.kind === 'completed' / 'forked' → 正常结束，不产出行
 */
export interface TurnNotice {
  /** 归一化结局：error=故障中断 / max-tokens=输出截断 / aborted=异常中止 / 其它为宿主原样 kind */
  kind: string
  /** 给人看的说明（优先用宿主给的原文） */
  message: string
  /** 宿主错误码（如 REASONING_LOOP），便于排查 */
  code?: string
}

/**
 * 从 `turn/end`（或 `agent/error`）里抽出「本轮为何结束」的可读说明。
 * @returns 需要提示时返回说明；正常结束 / 用户主动停止返回 null
 */
function noticeFromEvent(ev: any): TurnNotice | null {
  if (!ev || typeof ev !== 'object') return null
  const data = ev.data && typeof ev.data === 'object' ? ev.data : {}
  if (ev.type === 'agent/error') {
    const message = typeof data.message === 'string' ? data.message : ''
    return { kind: 'error', message: message || '本轮运行出错，已中止。' }
  }
  if (ev.type !== 'turn/end') return null
  const reason = data.reason && typeof data.reason === 'object' ? data.reason : {}
  const kind = String(reason.kind || '')
  if (kind === 'error') {
    const err = reason.error && typeof reason.error === 'object' ? reason.error : {}
    const message = typeof err.message === 'string' ? err.message : ''
    const code = typeof err.code === 'string' ? err.code : undefined
    return { kind: 'error', message: message || '本轮运行失败，已中止。', ...(code ? { code } : {}) }
  }
  if (kind === 'max-tokens') {
    return { kind: 'max-tokens', message: '本轮达到输出长度上限被截断，回答可能不完整。' }
  }
  if (kind === 'aborted') {
    const r = reason.reason && typeof reason.reason === 'object' ? reason.reason : {}
    const rk = String(r.kind || '')
    // 用户自己按的停止：不是故障，不要误报成异常
    if (rk === 'user') return null
    const message = typeof r.message === 'string' ? r.message : ''
    // 宿主对「登出」有专门文案，照搬以免工作台与「对话」tab 口径不一
    if (rk === 'hook' && String(r.reason || '') === 'deepseek-account/signed-out') {
      return { kind: 'aborted', message: '因为已退出 DeepSeek 登录，本轮被中止。', code: 'ACCOUNT_SIGNED_OUT' }
    }
    return { kind: 'aborted', message: message || '本轮已被中止。' }
  }
  if (kind === 'blocked') {
    return { kind: 'blocked', message: '本轮被阻断，未继续执行。' }
  }
  if (kind === 'interrupted') {
    return { kind: 'interrupted', message: '本轮被中断。' }
  }
  return null
}
/**
 * 把 SessionEventWindow 快照重建为消息列表：
 * - durable 事件（{ type:'event', event }）：user/assistant/tool-result 进流，
 *   system/message（渲染后的整份系统提示词）不进流；tool/call 也不进流，
 *   但其中的**文件编辑**（write/edit/str_replace_editor，见 fileEditOf）折叠成
 *   kind:'file-edit' 的标记消息留在流里，供 MsgList 按轮统计「已编辑 N 个文件」；
 * - transient 行（assistant/live-chunk 文本增量）按 attemptId 累积成一条 assistant 消息，
 *   settle 时窗口会滤掉 transient 并放入 durable 行 —— 全量重建天然不重复。
 */
export function messagesFromWindow(snap: any): StreamMsg[] {
  const entries: any[] = Array.isArray(snap?.entries) ? snap.entries : []
  const out: StreamMsg[] = []
  const queue: StreamMsg[] = []
  let live: StreamMsg | null = null
  let liveAttempt = ''
  let liveSlot = ''
  for (const e of entries) {
    if (e?.type === 'transient') {
      const ev = e.event
      if (ev?.type !== 'assistant/live-chunk') continue
      const chunk = ev?.data?.chunk
      const ct = chunk?.type
      // 流式增量有两类，**都必须收**：
      //   text-delta      → 正文（最终回答）
      //   reasoning-delta → 思考（thinking）；以前只收 text-delta，
      //                     导致“思考那步看不见”（用户反馈 #1）。
      if ((ct !== 'text-delta' && ct !== 'reasoning-delta') || typeof chunk.text !== 'string' || !chunk.text) continue
      const isReasoning = ct === 'reasoning-delta'
      const id = String(ev?.data?.attemptId ?? '')
      // 思考与正文要分开累积（各自一条消息），否则会混成一段。
      const slot = isReasoning ? 'reasoning' : 'text'
      if (!live || liveAttempt !== id || liveSlot !== slot) {
        live = { role: 'assistant', content: '', kind: isReasoning ? 'reasoning' : undefined }
        liveAttempt = id
        liveSlot = slot
        out.push(live)
      }
      live.content += chunk.text
      continue
    }
    const ev = e?.event
    if (!ev || typeof ev.type !== 'string') continue
    if (ev.type === 'agent/inbox/spliced') {
      // 忙时发的消息先进收件箱队列（还不是 user/message）——折叠进队列尾部，
      // 否则主对话卡里「发出去了却看不见」（宿主 QueueDock 有、我们以前丢了）
      applySplice(queue, ev.data, typeof ev.time === 'number' ? ev.time : undefined)
      continue
    }
    // tool/call 不进消息流（参数 JSON 没有展示价值），但**文件编辑**要留下来：
    // 折叠成一条不渲染的标记消息，供 MsgList 按轮统计「已编辑 N 个文件」。
    if (ev.type === 'tool/call') {
      const p = fileEditOf(ev.data?.name, ev.data?.arguments)
      if (p) out.push({ role: 'tool', content: '', type: 'tool/call', kind: 'file-edit', editPath: p })
      continue
    }
    // 轮末变更档案：宿主在每轮结束追加一条 workspace/changes（data 只有 turn），
    // 真正清单/行数/diff 由认证路由按 seq 提供。留成标记消息，MsgList 据此渲染
    // 与原生对话 tab 同款的「已编辑 N 个文件」卡（含 +N/-M 与悬浮预览）。
    if (ev.type === 'workspace/changes') {
      const changesSeq = changesSeqOf(ev)
      if (changesSeq !== null) out.push({ role: 'tool', content: '', type: ev.type, kind: 'changes', changesSeq })
      continue
    }
    if (ev.type === 'system/message') continue
    // durable assistant 消息可能同时带 reasoning 与 text 块：
    // 拆成两条（思考在前），呈现上才能分别折叠/展开（见 MsgList）。
    if (ev.type === 'assistant/message') {
      const think = reasoningOf(ev)
      const text = visibleTextOf(ev)
      const t = typeof ev.time === 'number' ? ev.time : undefined
      const u = ev?.data?.usage
      live = null
      if (think) out.push({ role: 'assistant', content: think, kind: 'reasoning', time: t, type: ev.type })
      if (text) out.push({ role: 'assistant', content: text, time: t, usage: u, type: ev.type })
      // 思考与正文都空（例如只含 tool-call）时不产出行
      continue
    }
    // 本轮的异常结局：必须显式呈现，否则工作台里「中断」与「正常结束」无从分辨。
    if (ev.type === 'turn/end' || ev.type === 'agent/error') {
      const notice = noticeFromEvent(ev)
      live = null
      if (notice) {
        out.push({
          role: 'system',
          content: notice.message,
          time: typeof ev.time === 'number' ? ev.time : undefined,
          type: ev.type,
          notice,
        })
      }
      continue
    }
    const content = visibleTextOf(ev)
    if (!content) continue
    live = null
    const inj = injectionOf(ev)
    out.push({
      role: roleOf(ev.type),
      content,
      time: typeof ev.time === 'number' ? ev.time : undefined,
      usage: ev?.data?.usage,
      type: ev.type,
      ...inj.injected ? { injected: true, injectKind: inj.kind } : {},
    })
  }
  // 队列消息永远排在流末尾（它们还没被任何轮次消费）
  return out.concat(queue)
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
      // 注入上下文（source.kind !== 'user'）不是用户输入，不能算 lastUser
      const text = injectionOf(ev).injected ? '' : contentOf(ev)
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
  if (ev.type === 'agent/inbox/spliced') {
    // 增量路径没有可重放的窗口，队列状态在通道上就地维护：
    // 队列消息恒在流末尾，先摘出来 splice 完再拼回去
    const base = ch.msgs.filter((m) => !m.queued)
    const queue = ch.msgs.filter((m) => m.queued)
    applySplice(queue, ev.data, typeof ev.time === 'number' ? ev.time : undefined)
    ch.msgs = base.concat(queue)
    publish(ch)
    return
  }
  // 逐事件路径同样要把文件编辑留下来（与 messagesFromWindow 同口径）
  if (ev.type === 'tool/call') {
    const p = fileEditOf(ev.data?.name, ev.data?.arguments)
    if (p) {
      ch.msgs = ch.msgs.concat({ role: 'tool', content: '', type: 'tool/call', kind: 'file-edit', editPath: p })
      publish(ch)
    }
    return
  }
  // 逐事件路径同样要带上轮末变更档案（与 messagesFromWindow 同口径）
  if (ev.type === 'workspace/changes') {
    const changesSeq = changesSeqOf(ev)
    if (changesSeq !== null) {
      ch.msgs = ch.msgs.concat({ role: 'tool', content: '', type: ev.type, kind: 'changes', changesSeq })
      publish(ch)
    }
    return
  }
  if (ev.type === 'system/message') return
  // 逐事件订阅路径同样要带上异常结局（与 messagesFromWindow 保持同口径）
  if (ev.type === 'turn/end' || ev.type === 'agent/error') {
    const notice = noticeFromEvent(ev)
    if (notice) {
      ch.msgs = ch.msgs.concat({
        role: 'system',
        content: notice.message,
        time: typeof ev.time === 'number' ? ev.time : undefined,
        type: ev.type,
        notice,
      })
      publish(ch)
    }
    return
  }
  const content = contentOf(ev)
  if (!content) return
  const inj = injectionOf(ev)
  ch.msgs = ch.msgs.concat({
    role: roleOf(ev.type),
    content,
    time: typeof ev.time === 'number' ? ev.time : undefined,
    usage: ev?.data?.usage,
    type: ev.type,
    ...inj.injected ? { injected: true, injectKind: inj.kind } : {},
  })
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
  // 之前失败过的通道（新会话 binding 未物化时首开必败）：重新订阅即再拉一把，
  // 并挂上目录变化重试钩子（openStream 的失败路径也调它，双保险）。
  if (ch.streamState === 'failed') { hookListRetry(); retryOpenStream(sessionId, ch) }
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
  if (ch.streamState === 'failed') { hookListRetry(); retryOpenStream(sessionId, ch) }
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

// —— 历史分页（「滚动到顶部加载更早」）——————————————

/**
 * 拉取一页更早的历史（宿主 session face 的 loadOlder）。
 *
 * 契约（0.2.0-rc.2）：`binding.session` 是 `ISession & ObservableSnapshot<SessionSnapshot>`，
 * 其 `loadOlder()` 至少扩 50 条消息 / 两个 Turn，上限 500 条；快照的
 * `hasMore` / `loadingOlder` 是「还有更早 / 正在载入」的信号。窗口扩大后照常触发
 * eventSource 的失效通知，messagesFromWindow 因而重建出更长的消息列表。
 * @param sessionId - 目标会话
 * @returns 是否成功发起并完成一次加载
 */
export async function loadOlderHistory(sessionId: string): Promise<boolean> {
  const face: any = channels.get(sessionId)?.binding?.session
  if (!face || typeof face.loadOlder !== 'function') return false
  try {
    await face.loadOlder()
    return true
  } catch (e) {
    console.warn('[tokensave] 加载更早历史失败', e)
    return false
  }
}

/** 读某会话的历史分页状态（会话流尚未建立时视为「没有更早」）。 */
export function readHistoryState(sessionId: string): { hasMore: boolean; loadingOlder: boolean } {
  try {
    const snap = channels.get(sessionId)?.binding?.session?.getSnapshot?.()
    return { hasMore: snap?.hasMore === true, loadingOlder: snap?.loadingOlder === true }
  } catch {
    return { hasMore: false, loadingOlder: false }
  }
}

/**
 * 读事件窗口里最新一条 `turn/start` 的时间（Unix ms；没有则 null）。
 *
 * 原生对话 tab 的运行计时（RunningStatus）用的就是「当前 open turn 的
 * turn/start.time」——比「最后一条真人消息的时间」更准：自动继续的续轮
 * 也有自己的 turn/start，计时与原生同拍。调用方拿到 null 时可回退到
 * 消息流投影里的真人消息时间。
 */
export function readTurnStartMs(sessionId: string): number | null {
  try {
    const src = channels.get(sessionId)?.binding?.eventSource
    const snap = typeof src?.getSnapshot === 'function' ? src.getSnapshot() : null
    const entries: any[] = Array.isArray(snap?.entries) ? snap.entries : []
    for (let i = entries.length - 1; i >= 0; i--) {
      const ev = entries[i]?.event
      if (ev?.type === 'turn/start') return Number(ev.time) || null
    }
  } catch {
    /* 窗口未就绪：回退调用方自己的口径 */
  }
  return null
}

/**
 * 订阅历史分页状态（hasMore / loadingOlder）。
 *
 * session face 要等 openStream 异步拿到 binding 后才存在，而订阅方（主对话）
 * 在挂载时就会订阅——因此先尝试附加，未就绪则短暂重试（最多到附加成功）。
 * @param sessionId - 目标会话
 * @param fn - 状态回调（附加成功时立即推一次）
 * @returns 取消订阅函数
 */
export function subscribeHistoryState(
  sessionId: string,
  fn: (state: { hasMore: boolean; loadingOlder: boolean }) => void,
): Unsub {
  let stopped = false
  let un: (() => void) | null = null
  const emit = () => { if (!stopped) fn(readHistoryState(sessionId)) }
  const attach = () => {
    if (stopped || un) return
    const face: any = channels.get(sessionId)?.binding?.session
    if (!face || typeof face.subscribe !== 'function') return
    try {
      un = face.subscribe(emit)
      emit()
    } catch {
      un = null
    }
  }
  attach()
  emit()
  const timer = window.setInterval(() => {
    attach()
    if (un) window.clearInterval(timer)
  }, 500)
  return () => {
    stopped = true
    window.clearInterval(timer)
    try {
      un?.()
    } catch {
      /* noop */
    }
  }
}

async function openStream(sessionId: string, ch: Channel): Promise<void> {
  ch.streamState = 'connecting'
  const ctx = clientCtx as any
  // 服务一律经 ctx.get()（reflect 层，不经 inject 闸门）取得：
  // 本插件只声明了 inject={slots:true}，直接读 ctx.sessions 会被 cordis 代理
  // 以 'cannot get property "sessions" without inject' 抛错（可选链也拦不住），
  // 导致 openStream 静默死亡、所有窗口永远不更新。
  const sessions = readService(ctx, 'sessions')
  if (!sessions) {
    console.warn('[tokensave] client ctx.sessions 不可用，浮窗进入等待态')
    markStreamFailed(sessionId, ch)
    return
  }

  // 路径 A：KB/类型契约路径 retain → ready → binding.eventSource（ObservableSnapshot）
  if (typeof sessions.retain === 'function') {
    for (const source of ['navigation', 'tokensave', 'completion']) {
      let ref: any = null
      try {
        ref = sessions.retain(sessionId, { source })
        const binding = await ref?.ready
        if (binding) ch.binding = binding
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
          ch.streamState = 'open'
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
      ch.streamState = 'open'
      console.log('[tokensave] 会话流已连接（session.subscribe）')
      return
    }
  } catch (e: any) {
    console.warn('[tokensave] session.subscribe 失败:', String(e?.message ?? e))
  }

  console.warn(`[tokensave] 未能为 ${sessionId} 打开会话流，浮窗显示等待态`)
  markStreamFailed(sessionId, ch)
}

/** 流打开失败后的退避重试间隔（新会话 binding 物化通常远快于此）。 */
const STREAM_RETRY_MS = 1500

/**
 * 流打开失败 → 登记重试，而不是永久停在空列表。
 *
 * 场景（用户反馈「新会话第一句发出去看不到」）：刚创建的会话 binding 尚未物化，
 * 首次 openStream 的 retain 三源全失败；以前失败后没人再拉起这条通道，
 * 之后发出去的消息（含自动继续的「继续」）虽已落盘，主对话卡永远读不到。
 * 重试两条腿：① 退避定时器；② 会话目录任意变化（list.subscribe）——新会话
 * 完成首轮时目录必动，比傻等更快。
 */
function markStreamFailed(sessionId: string, ch: Channel): void {
  ch.streamState = 'failed'
  if (ch.retryTimer) return
  ch.retryTimer = setTimeout(() => {
    ch.retryTimer = undefined
    retryOpenStream(sessionId, ch)
  }, STREAM_RETRY_MS)
}

/** 重试一把：只在还有人订阅、且仍未打开时真正重跑 openStream。 */
function retryOpenStream(sessionId: string, ch: Channel): void {
  if (ch.streamState === 'open' || ch.streamState === 'connecting') return
  if (ch.subs.size === 0 && ch.metricSubs.size === 0) return
  void openStream(sessionId, ch)
}

/** 会话目录变化时，把全部 failed 通道再拉一把（一次性挂监听）。 */
let listRetryHooked = false
function hookListRetry(): void {
  if (listRetryHooked) return
  const ctx = clientCtx as any
  const list = readService<any>(ctx, 'sessions')?.list
  if (!list || typeof list.subscribe !== 'function') return
  listRetryHooked = true
  try {
    list.subscribe(() => {
      for (const [id, ch] of channels) {
        if (ch.streamState === 'failed') retryOpenStream(id, ch)
      }
    })
  } catch {
    listRetryHooked = false
  }
}
