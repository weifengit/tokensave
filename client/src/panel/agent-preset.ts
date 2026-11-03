/**
 * Agent 模式（预设）的读取、切换与**启动期诊断**。
 *
 * 背景：宿主把「标准 / PTC / 极简 / 创造」这四种模式的选择器（`AgentPresetSeat`）
 * 只在两处渲染——新会话 Hero 的 chip、会话标题行的只读 label，且由三道门禁
 * 共同把关：
 *
 *     if (!main || !developerTools || !ready) return null;
 *
 *   - `developerTools`：设置里「显示代码工作视图」，取自 ui-settings；
 *   - `main`：该会话仍由主视图保留；
 *   - `ready`：`options.length > 0 && current !== ''` —— 即预设清单必须非空。
 *
 * 实测症状是「连原生对话 tab 都看不到入口」，那就只能是 `ready` 失败：宿主侧的
 * 预设注册链没跑起来（`agentPreset` 投影为 null）。而预设清单来自
 * `ctx.remote.agentPresets.list()`，这条链断了宿主不会在任何地方提示——用户
 * 只会看到「入口凭空消失」。所以这里做两件事：
 *
 *   1. `probeAgentPresets()`：启动时读一次清单，把结果明确打进控制台
 *      （成功打印每个模式 / 失败打印原因与排查方向）。把「猜」变成「看」。
 *   2. `listAgentPresets()` / `selectAgentPreset()`：给工作台自己的选择器用，
 *      不依赖宿主那两个 slot 是否渲染。
 *
 * 为什么不在插件里强改 ui-settings 的开关：那是用户级设置，越权改会连带打开
 * 轨迹、代码差异等其它开发者视图；而且本例里该开关本来就是开的。
 */
import { getClientContext, readService } from '../session-subscribe'

/** 宿主预设清单里的一行（与 agentPresets.list() 的 presets[] 对齐）。 */
export interface AgentPresetRow {
  id: string
  /** 用户自建预设才有 name；宿主内置的四种走 locale 词典 */
  name?: string
  description?: string
  isDefault?: boolean
}

/**
 * 内置四种模式的中文名（与宿主 locale 词典 `presetStandardName` 等一致）。
 *
 * 为什么不走宿主 `t()`：插件里拿不到 agent-preset 的音符（那是它私有 locale
 * 命名空间）；而这四个 id 是**宿主的稳定契约**（`dsh-agent-preset-registry` 的
 * BUILT_IN_PRESET_KEYS 写死了 standard/ptc/minimal/cordis），照抄即可。
 */
const BUILT_IN_LABELS: Record<string, { name: string, description: string }> = {
  standard: { name: '标准模式', description: '日常编程、文件处理与研究' },
  ptc: { name: 'PTC 模式', description: '用代码组织工具调用（Programmatic Tool Calling）' },
  minimal: { name: '极简模式', description: '仅一个 Shell 工具，用于对照测试' },
  cordis: { name: '创造模式', description: '额外具备运行时检查与插件开发能力' },
}

/** 一个模式对用户显示的名字（内置走本地词典，自建预设用它自己的 name）。 */
export function presetLabel(row: AgentPresetRow): string {
  return row.name ?? BUILT_IN_LABELS[row.id]?.name ?? row.id
}

/** 一个模式的说明（用于下拉项的第二行与悬浮提示）。 */
export function presetDescription(row: AgentPresetRow): string {
  return row.description ?? BUILT_IN_LABELS[row.id]?.description ?? ''
}

/**
 * 自检注入点：脚本里没有真实 cordis 上下文，用一个 hook 换掉取值来源。
 * 生产路径永远是 getClientContext()；这里只在显式调用时才改变行为。
 */
let contextOverride: any = null
/** @internal 仅供 scripts/check-agent-preset.mjs 使用 */
export function __setContextForTest(ctx: any): void {
  contextOverride = ctx
}

/** 取 remote.agentPresets 服务（可能因宿主未加载该服务而缺失）。 */
function agentPresetsService(): any {
  const ctx: any = contextOverride ?? getClientContext()
  // 先按服务名取；宿主把它注册为 cordis 服务 `agentPresets`
  const direct = readService<any>(ctx, 'agentPresets')
  if (direct) return direct
  // 兼容 remote 命名空间路径（客户端 remote 代理）
  const remote = readService<any>(ctx, 'remote')
  return remote?.agentPresets
}

export interface PresetRoster {
  ok: boolean
  rows: AgentPresetRow[]
  /** 失败原因（ok=false 时非空），直接给控制台/UI 用 */
  error?: string
}

/**
 * 读一次预设清单。
 *
 * 与宿主 readRoster 同口径：`gateway/invocation-unavailable` 视为「空清单但不算
 * 错误」（那是网关还没就绪，稍后自己会好）；其它错误才报。
 */
export async function listAgentPresets(): Promise<PresetRoster> {
  const svc = agentPresetsService()
  if (!svc || typeof svc.list !== 'function') {
    return { ok: false, rows: [], error: '宿主未提供 agentPresets 服务（预设注册链未加载）' }
  }
  try {
    const result = await svc.list()
    if (result?.ok) {
      const rows = Array.isArray(result.value?.presets) ? result.value.presets : []
      return { ok: true, rows: rows.filter((r: any) => r && typeof r.id === 'string') }
    }
    const code = result?.error?.code
    if (code === 'gateway/invocation-unavailable') return { ok: true, rows: [] }
    return { ok: false, rows: [], error: String(result?.error?.message ?? '读取预设清单失败') }
  } catch (e: any) {
    return { ok: false, rows: [], error: String(e?.message ?? e) }
  }
}

/**
 * 把某个模式应用到指定会话。
 *
 * 只有**空白会话**（还没跑过任何一轮）才能换模式 —— 这是宿主的硬约束：一轮跑过
 * 之后，历史是在那套工具与提示词下产生的，换掉就自相矛盾。宿主的 `select()` 会
 * 在需要时返回拒绝理由，这里原样把它交给调用方去展示，而不是静默吞掉。
 *
 * @returns 成功返回 undefined；被拒绝/不可用返回**能直接展示给用户的中文原因**。
 */
export async function selectAgentPreset(sessionId: string, presetId: string): Promise<string | undefined> {
  const svc = agentPresetsService()
  if (!svc || typeof svc.select !== 'function') return '宿主未提供 agentPresets 服务，无法切换模式'
  if (!sessionId) return '缺少会话 id，无法切换模式'
  try {
    const result = await svc.select(sessionId, presetId)
    if (result?.ok) return undefined
    const reason = result?.error?.details?.reason
    if (typeof reason === 'string' && reason) return reason
    return String(result?.error?.message ?? '切换模式被宿主拒绝')
  } catch (e: any) {
    return String(e?.message ?? e)
  }
}

/**
 * 启动期诊断：读一次清单并把结果打进控制台。
 *
 * 为什么必须显式打日志：预设链断掉时宿主**完全静默**（不报错、不警告），
 * 用户看到的现象只是「模式选择入口不见了」，与「设置里那个开关被关了」
 * 长得一模一样。这条日志给出决定性判据：
 *
 *   ① 读到 4 个内置预设 → 链正常，入口不见就该去查「显示代码工作视图」开关；
 *   ② 读到空清单 → 宿主侧预设注册链没跑起来（profile 的 preset patch 没加载）；
 *   ③ 服务都没有 → 宿主版本不同或该 bundle 未启用。
 *
 * @returns 诊断结论，供自检脚本与人工排查复用。
 */
export async function probeAgentPresets(): Promise<string> {
  const roster = await listAgentPresets()
  if (!roster.ok) {
    const line = `[tokensave] 模式清单读取失败：${roster.error}`
    console.warn(line)
    return line
  }
  if (roster.rows.length === 0) {
    const line = '[tokensave] 模式清单为空：宿主侧预设注册链未加载（profile 的 preset patch 没生效），'
      + '此时原生对话 tab 与工作台的模式选择器都不会出现'
    console.warn(line)
    return line
  }
  const names = roster.rows.map(presetLabel).join(' / ')
  const line = `[tokensave] 模式清单 ${roster.rows.length} 项：${names}`
  console.log(line)
  return line
}
