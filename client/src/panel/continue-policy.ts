/**
 * 自动发送「继续」的判定引擎。
 *
 * 判定口径参考 https://github.com/HsiangNianian/dsh-auto-continue ：
 *   - **max-tokens**（输出被截断）：总是自动继续 —— 这轮没写完，接着写就行；
 *   - **瞬时故障**（网络 / 超时 / 5xx / 429 …）：自动继续，因为重试真的能好；
 *   - **永久性故障**（鉴权 / 凭据 / 余额 / 未知模型 / 上下文超长）：**不自动**，
 *     重试永远不会成功，只会白白烧配额 —— 交给人工处理并说明原因；
 *   - **需要人工确认**（权限 / 同意 / 阻断）：**不自动**，模型在等人点按钮；
 *     自动发「继续」只会把待确认状态搅乱；
 *   - **用户主动停止**（aborted/user）：**不自动**，那是人不想让它写了。
 *
 * 另外带一整套「别把上游打崩」的护栏：连续次数上限、冷却时间（失败越多等越久）、
 * 每会话状态（用户一介入就清零）、以及可自定义的可重试关键字。
 */

/** localStorage 键：自动继续设置 */
export const CONTINUE_SETTINGS_KEY = 'tokensave:continue.v1'

export interface ContinueSettings {
  /** 总开关；关掉即完全不自动发送（「继续」按钮仍然可用） */
  enabled: boolean
  /** max-tokens（输出被截断）时自动继续 */
  autoMaxTokens: boolean
  /** 瞬时故障（网络 / 超时 / 5xx / 429）时自动继续 */
  autoTransient: boolean
  /** 永久性错误分类：开启后鉴权 / 余额 / 未知模型 / 上下文超长一律不自动重试 */
  classify: boolean
  /** 连续自动继续次数上限（用户介入或正常完成即清零） */
  maxConsecutive: number
  /** 冷却时间：两次自动继续之间的最小间隔 */
  cooldownMs: number
  /** 连续失败时冷却的放大倍数（2 = 20s → 40s → 80s…） */
  backoffFactor: number
  /** 冷却上限 */
  backoffMaxMs: number
  /** 自定义「可重试」关键字：一行一条，字面量（非正则），命中即覆盖内建的永久性判定 */
  customRetryable: string
  /** max-tokens 自动继续时发送的文案（支持占位符） */
  textMaxTokens: string
  /** 瞬时故障自动继续时发送的文案（支持占位符） */
  textTransient: string
}

export const DEFAULT_CONTINUE_SETTINGS: ContinueSettings = {
  enabled: true,
  autoMaxTokens: true,
  autoTransient: true,
  classify: true,
  maxConsecutive: 3,
  cooldownMs: 20_000,
  backoffFactor: 2,
  backoffMaxMs: 300_000,
  customRetryable: '',
  textMaxTokens: '继续（上一轮输出达到长度上限被截断，接着写，不要重复已经写过的内容）',
  textTransient: '继续（{code}）',
}

let cached: ContinueSettings | null = null

export function getContinueSettings(): ContinueSettings {
  if (cached) return cached
  const base = { ...DEFAULT_CONTINUE_SETTINGS }
  try {
    if (typeof window === 'undefined') return (cached = base)
    const raw = window.localStorage.getItem(CONTINUE_SETTINGS_KEY)
    if (!raw) return (cached = base)
    const obj = JSON.parse(raw) as Record<string, unknown>
    const num = (v: unknown, d: number, lo: number, hi: number) => {
      const n = Number(v)
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
    }
    if (typeof obj.enabled === 'boolean') base.enabled = obj.enabled
    if (typeof obj.autoMaxTokens === 'boolean') base.autoMaxTokens = obj.autoMaxTokens
    if (typeof obj.autoTransient === 'boolean') base.autoTransient = obj.autoTransient
    if (typeof obj.classify === 'boolean') base.classify = obj.classify
    base.maxConsecutive = num(obj.maxConsecutive, base.maxConsecutive, 1, 20)
    base.cooldownMs = num(obj.cooldownMs, base.cooldownMs, 0, 600_000)
    base.backoffFactor = num(obj.backoffFactor, base.backoffFactor, 1, 10)
    base.backoffMaxMs = num(obj.backoffMaxMs, base.backoffMaxMs, 1_000, 3_600_000)
    if (typeof obj.customRetryable === 'string') base.customRetryable = obj.customRetryable
    if (typeof obj.textMaxTokens === 'string' && obj.textMaxTokens.trim()) base.textMaxTokens = obj.textMaxTokens
    if (typeof obj.textTransient === 'string' && obj.textTransient.trim()) base.textTransient = obj.textTransient
  } catch {
    /* 读坏就当默认值 */
  }
  return (cached = base)
}

export function setContinueSettings(patch: Partial<ContinueSettings>): ContinueSettings {
  const next = { ...getContinueSettings(), ...patch }
  cached = next
  try {
    window.localStorage.setItem(CONTINUE_SETTINGS_KEY, JSON.stringify(next))
  } catch {
    /* 忽略写入失败 */
  }
  notifyContinueSettings()
  return next
}

const settingsListeners = new Set<() => void>()
export function subscribeContinueSettings(cb: () => void): () => void {
  settingsListeners.add(cb)
  return () => settingsListeners.delete(cb)
}
function notifyContinueSettings(): void {
  for (const cb of [...settingsListeners]) {
    try {
      cb()
    } catch {
      /* 单个订阅者出错不影响其它订阅者 */
    }
  }
}

// —— 中断信息 ——

/** 判定一次中断需要知道的全部事实（宿主给多少用多少） */
export interface InterruptInfo {
  /** 宿主 turn/end 的 reason.kind（error / max-tokens / blocked / aborted / …） */
  kind: string
  /** aborted 的子类型（user = 用户主动停止） */
  subKind?: string
  /** 宿主错误码（如 REASONING_LOOP、ACCOUNT_SIGNED_OUT） */
  code?: string
  /** 给人看的错误说明（里面常带上游原文，分类主要靠它） */
  message?: string
  /** HTTP 状态码（宿主给了就优先按它判） */
  status?: number
}

export type ContinueAction =
  /** 自动发送 */
  | 'auto'
  /** 只给按钮，人工点（需要确认、或不想自动的失败） */
  | 'manual'
  /** 连按钮都不该给（用户主动停止这类“不是问题”的结局） */
  | 'never'

export interface ContinueDecision {
  action: ContinueAction
  /** 为什么这么判（中文，可直接展示给用户） */
  reason: string
  /** 自动发送时用的文案（已按占位符渲染） */
  text?: string
}

/** 永久性错误：重试永远不会成功，自动继续只会白烧配额 */
const PERMANENT_PATTERNS: ReadonlyArray<{ re: RegExp; short: string; label: string }> = [
  { re: /401|403/, short: '鉴权', label: '鉴权失败' },
  { re: /\b(?:unauthorized|forbidden|authentication|auth\s*failed|invalid\s*api[\s_-]?key|api[\s_-]?key\s*(?:invalid|expired|missing)|no\s*api\s*key|credential|access\s*denied|permission\s*denied|signed[\s-]?out)\b/i, short: '鉴权', label: '鉴权 / 凭据问题' },
  { re: /\b(?:insufficient|balance|quota|exceeded\s*your\s*current\s*quota|billing|payment|out\s*of\s*credit|no\s*credit)\b/i, short: '余额', label: '余额 / 配额不足' },
  { re: /\b(?:unknown\s*model|model[\s_-]?not[\s_-]?found|no\s*such\s*model|unsupported\s*model|invalid\s*model|does\s*not\s*exist\s*or\s*you\s*do\s*not\s*have\s*access)\b/i, short: '模型', label: '模型不存在 / 无权限' },
  { re: /\b(?:context[\s_-]?(?:length|window|limit)|too\s*many\s*tokens|maximum\s*context|reduce\s*the\s*length|input\s*is\s*too\s*long)\b/i, short: '上下文', label: '上下文超长' },
  { re: /\b(?:invalid\s*request|bad\s*request|400)\b/i, short: '请求无效', label: '请求本身不合法' },
  { re: /REASONING_LOOP/, short: '死循环', label: '推理死循环' },
  { re: /ACCOUNT_SIGNED_OUT/, short: '登录失效', label: '登录已退出' },
]

/** 瞬时故障：等一下重试通常就好了 */
const TRANSIENT_PATTERNS: ReadonlyArray<{ re: RegExp; short: string; label: string }> = [
  { re: /\b(?:429|rate[\s_-]?limit|too\s*many\s*requests|overloaded|throttl)\b/i, short: '限流', label: '触发限流' },
  { re: /\b(?:50[0-9]|bad\s*gateway|service\s*unavailable|gateway\s*time[\s-]?out|internal\s*server\s*error)\b/i, short: '上游 5xx', label: '上游 5xx' },
  { re: /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|socket\s*hang\s*up|fetch\s*failed|network|connection\s*(?:reset|closed|error|lost)|timeout|timed\s*out|aborted\s*by\s*client)\b/i, short: '网络', label: '网络 / 超时' },
]

function customRetryableHit(info: InterruptInfo, custom: string): boolean {
  if (!custom.trim()) return false
  const hay = `${info.code ?? ''}\n${info.message ?? ''}\n${info.status ?? ''}`.toLowerCase()
  for (const line of custom.split('\n')) {
    const needle = line.trim().toLowerCase()
    if (needle && hay.includes(needle)) return true
  }
  return false
}

/** 渲染文案里的占位符：{code} {message} {status} {turn} {errorCount} {elapsed} */
export function renderTemplate(tpl: string, info: InterruptInfo, extra: { errorCount?: number; elapsedMs?: number } = {}): string {
  const elapsed = extra.elapsedMs != null ? formatElapsed(extra.elapsedMs) : ''
  const map: Record<string, string> = {
    code: info.code ?? '',
    message: info.message ?? '',
    status: info.status != null ? String(info.status) : '',
    turn: '',
    errorCount: extra.errorCount != null ? String(extra.errorCount) : '',
    elapsed,
  }
  return tpl
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in map ? map[k] : m))
    .replace(/[（(]\s*[)）]/g, '') // 占位符被渲染成空 → 留下空括号，清掉
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${s % 60 ? `${s % 60}s` : ''}`
  return `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ''}`
}

/**
 * 判一次中断该怎么处理。纯函数：不读时间、不读缓存，方便单测与调试。
 * @param info - 中断事实
 * @param s - 设置（默认取当前持久化设置）
 */
export function decideContinue(info: InterruptInfo, s: ContinueSettings = getContinueSettings()): ContinueDecision {
  const kind = String(info.kind || '')

  // 用户自己按的停止：不是故障，不给「继续」
  if (kind === 'aborted' && info.subKind === 'user') {
    return { action: 'never', reason: '你主动停止了这一轮' }
  }
  if (kind === 'completed' || kind === 'forked') {
    return { action: 'never', reason: '这一轮正常结束了' }
  }

  // 输出被截断：这轮没写完，接着写 —— 总是自动
  if (kind === 'max-tokens') {
    if (!s.enabled || !s.autoMaxTokens) return { action: 'manual', reason: '输出被截断（自动继续已关闭）' }
    return { action: 'auto', reason: '输出达到长度上限被截断，自动接着写', text: renderTemplate(s.textMaxTokens, info) }
  }

  // 需要人工确认：模型在等人点按钮，自动发「继续」会把待确认状态搅乱
  if (kind === 'consent' || kind === 'permission' || kind === 'awaiting-consent') {
    return { action: 'manual', reason: '等待你确认权限 / 授权，自动继续会打断这个确认' }
  }
  // 策略阻断：宿主动的手，重发也一样
  if (kind === 'blocked') {
    return { action: 'manual', reason: '本轮被策略阻断，重发通常仍会被阻断' }
  }
  // 异常中止（登出 / 钩子）：等人工处理，通常是账号态问题
  if (kind === 'aborted') {
    return { action: 'manual', reason: info.code === 'ACCOUNT_SIGNED_OUT' ? '登录已退出，需要你重新登录' : '本轮被异常中止' }
  }

  const hay = `${info.code ?? ''}\n${info.message ?? ''}`

  // 自定义可重试关键字优先：命中即当瞬时故障处理（覆盖内建的永久性判定）
  if (customRetryableHit(info, s.customRetryable)) {
    if (!s.enabled || !s.autoTransient) return { action: 'manual', reason: '命中自定义可重试关键字（自动继续已关闭）' }
    return { action: 'auto', reason: '命中自定义可重试关键字', text: renderTemplate(s.textTransient, info) }
  }

  if (s.classify) {
    for (const p of PERMANENT_PATTERNS) {
      if (p.re.test(hay)) {
        return { action: 'manual', reason: `${p.label}：重试不会成功，已跳过自动继续` }
      }
    }
  }

  // 故障类（error / agent/error / interrupted）：默认当瞬时，靠次数上限与退避兜底
  if (kind === 'error' || kind === 'agent/error' || kind === 'interrupted') {
    for (const p of TRANSIENT_PATTERNS) {
      if (p.re.test(hay)) {
        if (!s.enabled || !s.autoTransient) return { action: 'manual', reason: `${p.label}（自动继续已关闭）` }
        return { action: 'auto', reason: `${p.label}，等冷却后自动重试`, text: renderTemplate(s.textTransient, info) }
      }
    }
    if (!s.enabled || !s.autoTransient) return { action: 'manual', reason: '这一轮出错了（自动继续已关闭）' }
    return { action: 'auto', reason: '这一轮出错了，等冷却后自动重试', text: renderTemplate(s.textTransient, info) }
  }

  // 未知 kind：fail closed —— 不自动
  return { action: 'manual', reason: '未知的中断类型，未自动继续' }
}

/**
 * 中断原因的**短标签**（清单里挂在项目胶囊后面用，必须够短）。
 * 例如「截断」「限流」「网络」「鉴权」「余额」「模型」「上下文」「待确认」「已停止」。
 * 与 decideContinue 同源：同一个判定表，只是取短名 —— 两处文案不会说不同的话。
 */
export function shortInterruptLabel(info: InterruptInfo | undefined): string {
  if (!info) return ''
  const kind = String(info.kind || '')
  if (kind === 'max-tokens') return '截断'
  if (kind === 'consent' || kind === 'permission' || kind === 'awaiting-consent') return '待确认'
  if (kind === 'blocked') return '被阻断'
  if (kind === 'aborted') return info.subKind === 'user' ? '' : '异常中止'
  if (kind === 'completed' || kind === 'forked') return ''
  if (kind === 'interrupted') return '被中断'
  const hay = `${info.code ?? ''}\n${info.message ?? ''}`
  for (const p of PERMANENT_PATTERNS) {
    if (p.re.test(hay)) return p.short
  }
  for (const p of TRANSIENT_PATTERNS) {
    if (p.re.test(hay)) return p.short
  }
  return '出错'
}

// —— 每会话运行状态（连续次数 / 冷却 / 暂停）——

interface SessionRunState {
  /** 连续自动继续了几次（用户介入或正常完成清零） */
  attempts: number
  /** 上一次自动发送的时间 */
  lastAt: number
  /** 暂停到此时间为止（人工暂停 / 用户停止后短暂静默） */
  pausedUntil: number
}

const runStates = new Map<string, SessionRunState>()

function stateOf(sessionId: string): SessionRunState {
  let st = runStates.get(sessionId)
  if (!st) {
    st = { attempts: 0, lastAt: 0, pausedUntil: 0 }
    runStates.set(sessionId, st)
  }
  if (runStates.size > 200) {
    // 只留最近用过的：清掉早已过期的
    const now = Date.now()
    for (const [id, v] of runStates) {
      if (id !== sessionId && v.pausedUntil < now && now - v.lastAt > 30 * 60_000) runStates.delete(id)
    }
  }
  return st
}

export interface GateResult {
  ok: boolean
  /** 还需要等多久（ms）；ok=true 时为 0 */
  waitMs: number
  /** 不能自动时的原因（ok=true 时为 undefined） */
  reason?: string
}

/**
 * 现在能不能给这个会话自动发「继续」。
 * 三道闸：暂停 → 连续次数上限 → 冷却（连续失败按倍数退避）。
 */
export function gateAutoContinue(sessionId: string, s: ContinueSettings = getContinueSettings()): GateResult {
  const st = stateOf(sessionId)
  const now = Date.now()
  if (st.pausedUntil > now) {
    return { ok: false, waitMs: st.pausedUntil - now, reason: '这个会话的自动继续已暂停' }
  }
  if (st.attempts >= s.maxConsecutive) {
    return { ok: false, waitMs: 0, reason: `已连续自动继续 ${st.attempts} 次，达到上限（等你介入后重置）` }
  }
  if (st.lastAt > 0 && s.cooldownMs > 0) {
    const wait = coolDownFor(st.attempts, s)
    const left = st.lastAt + wait - now
    if (left > 0) return { ok: false, waitMs: left, reason: `冷却中，${Math.ceil(left / 1000)}s 后再试` }
  }
  return { ok: true, waitMs: 0 }
}

/** 第 n 次失败后要等的冷却：cooldown × factor^(n-1)，封顶 backoffMaxMs */
export function coolDownFor(attempts: number, s: ContinueSettings = getContinueSettings()): number {
  const n = Math.max(0, attempts)
  const raw = s.cooldownMs * Math.pow(s.backoffFactor, n)
  return Math.min(s.backoffMaxMs, Math.max(s.cooldownMs, raw))
}

/** 记一次自动发送（推进连续次数与冷却基准） */
export function noteAutoContinue(sessionId: string): void {
  const st = stateOf(sessionId)
  st.attempts += 1
  st.lastAt = Date.now()
}

/** 用户介入了（自己发了消息 / 手动点了「继续」）→ 连续次数清零，退避归位 */
export function noteUserActivity(sessionId: string): void {
  const st = runStates.get(sessionId)
  if (!st) return
  st.attempts = 0
  st.lastAt = 0
  st.pausedUntil = 0
}

/** 暂停 / 恢复某个会话的自动继续 */
export function pauseAutoContinue(sessionId: string, ms: number): void {
  stateOf(sessionId).pausedUntil = Date.now() + Math.max(0, ms)
}
export function resumeAutoContinue(sessionId: string): void {
  const st = runStates.get(sessionId)
  if (st) st.pausedUntil = 0
}
export function isPaused(sessionId: string): boolean {
  return stateOf(sessionId).pausedUntil > Date.now()
}
export function attemptsOf(sessionId: string): number {
  return stateOf(sessionId).attempts
}

/** 供 UI 展示一行状态（次数 / 冷却 / 原因） */
export function describeGate(sessionId: string, s: ContinueSettings = getContinueSettings()): string {
  const gate = gateAutoContinue(sessionId, s)
  if (gate.ok) {
    const n = attemptsOf(sessionId)
    return n > 0 ? `可自动继续（已连续 ${n} 次）` : '可自动继续'
  }
  return gate.reason ?? '暂不自动继续'
}

/** 测试 / 重置用：清掉全部会话状态 */
export function resetContinueStates(): void {
  runStates.clear()
}

// —— 排程器：把「决定自动发」落成一次延时的真实发送 ——

interface Pending {
  timer: number
  sessionId: string
  cancel: () => void
}

const pendingBySession = new Map<string, Pending>()

export interface ScheduleOptions {
  sessionId: string
  /** 真实发送（通常是 sendToSession(id, text)） */
  send: (text: string) => Promise<void>
  /** 决定与文案 */
  decision: ContinueDecision
  /** 发送前等待（grace / 冷却），0 = 立即 */
  delayMs: number
  /** 状态回调：queued → sending → sent | error | cancelled */
  onState?: (state: 'queued' | 'sending' | 'sent' | 'error' | 'cancelled', detail?: string) => void
}

/**
 * 排一次自动继续。同一会话只保留最后一次（新的中断会顶掉旧的排队）。
 * @returns 取消函数（用户介入 / 会话重新跑起来时调用）
 */
export function scheduleAutoContinue(opts: ScheduleOptions): () => void {
  const { sessionId, send, decision, delayMs, onState } = opts
  cancelAutoContinue(sessionId)
  if (decision.action !== 'auto' || !decision.text) {
    onState?.('cancelled', 'not-auto')
    return () => {}
  }
  let cancelled = false
  const fire = async () => {
    pendingBySession.delete(sessionId)
    if (cancelled) {
      onState?.('cancelled', 'cancelled')
      return
    }
    onState?.('sending')
    try {
      await send(decision.text as string)
      noteAutoContinue(sessionId)
      onState?.('sent')
    } catch (e: any) {
      onState?.('error', String(e?.message ?? e))
    }
  }
  const timer = window.setTimeout(() => void fire(), Math.max(0, delayMs))
  const cancel = () => {
    cancelled = true
    window.clearTimeout(timer)
    if (pendingBySession.get(sessionId)?.timer === timer) pendingBySession.delete(sessionId)
    onState?.('cancelled', 'cancelled')
  }
  pendingBySession.set(sessionId, { timer, sessionId, cancel })
  onState?.('queued')
  return cancel
}

/** 取消某会话排着的自动继续（用户一介入 / 会话重新跑起来就该取消） */
export function cancelAutoContinue(sessionId: string): void {
  const p = pendingBySession.get(sessionId)
  if (p) {
    window.clearTimeout(p.timer)
    pendingBySession.delete(sessionId)
  }
}

/** 该会话是否有排着的自动继续 */
export function hasPendingAutoContinue(sessionId: string): boolean {
  return pendingBySession.has(sessionId)
}

/** 全部取消（插件卸载时用） */
export function cancelAllAutoContinue(): void {
  for (const p of [...pendingBySession.values()]) {
    window.clearTimeout(p.timer)
    p.cancel()
  }
  pendingBySession.clear()
}
