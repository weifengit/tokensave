/**
 * 探索者候选目录（默认 / 免费 / 收费）
 *
 * 背景：探索者原本写死 EXPLORER_PRESETS 三个免费模型。用户要求「自行控制探索者」：
 * 面板里按 默认 / 免费 / 收费 三组列出**可用**的探索者，逐个（或整组）开关，
 * 但至少保留 1 个选中。
 *
 * 本文件是**纯数据 / 无 ctx** 的一层，供两边共用：
 *   - 宿主路由 `/explorer-settings`（读目录 / 写选择，见 board-web-route.ts）
 *   - 编排 `parallelExplore`（按用户选择决定真正跑哪些探索者）
 *
 * 分组口径（写在界面上、可随环境调整）：
 *   - 默认 = 插件内置的三个探索者预设（EXPLORER_PRESETS）
 *   - 免费 = FREE_PROVIDERS 上、除预设之外的模型
 *   - 收费 = 其余 provider 的模型
 */
import { EXPLORER_PRESETS, type ExplorerConfig } from './types.ts'

export type ExplorerGroupId = 'default' | 'free' | 'paid'

export interface ExplorerGroup {
  id: ExplorerGroupId
  label: string
}

export const EXPLORER_GROUPS: ExplorerGroup[] = [
  { id: 'default', label: '默认' },
  { id: 'free', label: '免费' },
  { id: 'paid', label: '收费' },
]

/** 一个可被选为探索者的候选（model = `provider/model`，同时充当唯一 key）。 */
export interface ExplorerCandidate {
  /** `provider/model`——既作唯一键，也直接喂给 session_create.model */
  model: string
  label: string
  focus: string
  group: ExplorerGroupId
  /** provider 当前是否已注册（未注册 = 暂时不可用，通常是凭据未配置） */
  available: boolean
  /** provider 广告的描述（面板里作悬浮提示，可选） */
  note?: string
}

/** 免费 provider 路由（与 parallel-explorer / MAINTENANCE 冻结口径一致）；其余归「收费」。 */
export const FREE_PROVIDERS: readonly string[] = ['our-free-model', 'opencode-zen']

/**
 * 已知 provider 的模型清单（兜底 + 主用）。
 *
 * 刻意**不**调 `ctx.llm.listModels()`：那是 per-provider 的异步探测，可能打到网络
 * 端点，会让设置面板的读取变慢甚至挂住；这里用与 parallel-explorer 一致的已知清单，
 * 快且确定。新增 provider / 模型时同步维护本表即可。
 */
export const KNOWN_MODELS: Record<string, string[]> = {
  'our-free-model': ['mimo-v2.6-flash-free', 'nemotron-3-ultra-free'],
  'opencode-zen': ['deepseek-v4-flash-free'],
  'deepseek-official': ['deepseek-v4-pro', 'deepseek-flash'],
}

/** 非预设模型的默认侧重点（保证 focus 非空，探索者提示词用它）。 */
const FOCUS_BY_PROVIDER: Record<string, string> = {
  'our-free-model': '边界条件与异常处理',
  'opencode-zen': '性能与实现复杂度',
  'deepseek-official': '整体方案与正确性',
}

export const DEFAULT_FOCUS = '整体方案可行性'

/** 拆分 `provider/model`（无 `/` 时两者相同）。 */
export function splitModel(full: string): [string, string] {
  const i = full.indexOf('/')
  if (i < 0) return [full, full]
  return [full.slice(0, i), full.slice(i + 1)]
}

export function presetModels(): string[] {
  return EXPLORER_PRESETS.map((p) => p.model)
}

function labelFor(provider: string, model: string, displayName?: string, modelName?: string): string {
  const full = `${provider}/${model}`
  const preset = EXPLORER_PRESETS.find((p) => p.model === full)
  if (preset) return preset.label
  const head = displayName || provider
  // provider 广告的 name 比裸 id 友好；同名时不再重复拼接
  return modelName && modelName !== model ? `${head} · ${modelName}` : `${head} · ${model}`
}

/**
 * 非预设模型的默认侧重点（保证 focus 非空，探索者提示词用它）。
 * 预设模型优先用其自带 focus（否则会丢掉 Nemotron 的「性能与实现复杂度」这类细分）。
 */
function focusFor(provider: string, model?: string): string {
  if (model) {
    const preset = EXPLORER_PRESETS.find((p) => p.model === `${provider}/${model}`)
    if (preset) return preset.focus
  }
  return FOCUS_BY_PROVIDER[provider] || DEFAULT_FOCUS
}

/** 一个模型候选（provider 广告的模型元数据）。 */
export interface ModelEntry {
  id: string
  name?: string
  description?: string
}

/** provider 目录项（由宿主从 ctx.llm 解析后传入）。 */
export interface ProviderEntry {
  provider: string
  displayName?: string
  /** 该 provider 当前是否已注册（live） */
  available: boolean
  /** 该 provider 广告的模型（live 时用 ctx.llm.listModels，否则回退 KNOWN_MODELS） */
  models?: ModelEntry[]
}

/**
 * 把 provider 目录组装成三组候选（返回扁平列表，界面按 group 归位）。
 * 默认组永远列出内置预设；免费 / 收费只列已知 provider 的模型。
 */
export function buildCatalog(entries: ProviderEntry[]): ExplorerCandidate[] {
  const out: ExplorerCandidate[] = []
  const seen = new Set<string>()
  const push = (
    provider: string,
    model: string,
    group: ExplorerGroupId,
    displayName?: string,
    available = true,
    modelName?: string,
    note?: string
  ) => {
    if (!provider || !model) return
    const key = `${provider}/${model}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      model: key,
      label: labelFor(provider, model, displayName, modelName),
      focus: focusFor(provider, model),
      group,
      available,
      note,
    })
  }

  // 1) 默认组：内置三个预设（始终列出；可用性跟随其 provider）
  const liveOf = new Map(entries.map((e) => [e.provider, e.available]))
  for (const p of EXPLORER_PRESETS) {
    const [provider, model] = splitModel(p.model)
    push(provider, model, 'default', undefined, liveOf.get(provider) ?? true)
  }
  // 2) 免费 / 收费：provider 广告的模型（默认组已占用的 model 一律跳过 → 三组互不重复）
  for (const entry of entries) {
    const group: ExplorerGroupId = FREE_PROVIDERS.includes(entry.provider) ? 'free' : 'paid'
    for (const m of entry.models ?? []) {
      push(entry.provider, m.id, group, entry.displayName, entry.available, m.name, m.description)
    }
  }
  return out
}

// —— 选择项（持久化 + 消费的最小单位）———————————————

export interface ExplorerSelection {
  model: string
  label: string
  focus: string
}

/** 逐字段校验并归一化一条选择；不合法返回 null（丢弃）。 */
export function sanitizeSelection(raw: unknown): ExplorerSelection | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const model = typeof r.model === 'string' ? r.model.trim() : ''
  if (!model || model.length > 200 || !model.includes('/')) return null
  const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 80) : model
  const focus = typeof r.focus === 'string' && r.focus.trim() ? r.focus.trim().slice(0, 200) : DEFAULT_FOCUS
  return { model, label, focus }
}

/** 从未配置时的默认选择 = 内置预设。 */
export function defaultSelection(): ExplorerSelection[] {
  return EXPLORER_PRESETS.map((p) => ({ model: p.model, label: p.label, focus: p.focus }))
}

/** 选择项 → 编排用的 ExplorerConfig。 */
export function selectionToConfigs(sel: ExplorerSelection[]): ExplorerConfig[] {
  return sel.map((s) => ({ model: s.model, label: s.label, focus: s.focus }))
}
