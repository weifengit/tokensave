/**
 * 脱敏（docmask）运行开关的宿主侧存储。
 *
 * 与 Python 端唯一的契约就是这份文件：
 *   ~/.dsh/tokensave/docmask/runtime.json
 * Python 的 config.py 把它当作「面板覆盖层」合并到 config/docmask.json 之上，
 * 且只认其中的 `runtime` 段——所以面板只写这一段，用户手写的词表 / 实体类型
 * 永远不会被 UI 覆盖。
 *
 * 写入策略：读全量 → 只替换 runtime → 临时文件 + rename 原子落盘。
 * 这样即使写一半崩溃，Python 读到的也是上一份完整配置。
 */

import fs from 'node:fs'
import path from 'node:path'

export interface MaskRuntimeSettings {
  /** 总开关：关掉后所有识别器都不跑，文本原样通过（Python 会告警） */
  enabled: boolean
  /** 结构化识别：手机号/身份证/邮箱/银行卡/IP/密钥/Token */
  regex: boolean
  /** 自定义固定词表（config 内联 + glossary.json） */
  glossary: boolean
  /** GLiNER-small 语义识别（人名/公司/地址/自定义类型） */
  gliner: boolean
  /** 识别结果缓存（避免同一份文档重复跑模型） */
  cache: boolean
  /** 脱敏后的漏检检查与告警 */
  audit: boolean
  /** 配置 / 词表 / 本文件的改动自动生效 */
  hot_reload: boolean
  /** GLiNER 命中阈值：越高越保守 */
  gliner_threshold: number
  /** 会话映射自动加密落盘（跨进程多轮对话需要） */
  auto_persist_sessions: boolean
}

export const MASK_RUNTIME_DEFAULTS: MaskRuntimeSettings = {
  enabled: true,
  regex: true,
  glossary: true,
  gliner: true,
  cache: true,
  audit: true,
  hot_reload: true,
  gliner_threshold: 0.35,
  auto_persist_sessions: false
}

/** 开关型字段（面板按开关渲染，服务端按布尔校验）。 */
export const MASK_RUNTIME_SWITCHES = [
  'enabled',
  'regex',
  'glossary',
  'gliner',
  'cache',
  'audit',
  'hot_reload',
  'auto_persist_sessions'
] as const satisfies readonly (keyof MaskRuntimeSettings)[]

export const MASK_THRESHOLD_MIN = 0.05
export const MASK_THRESHOLD_MAX = 0.95

/** Python 端基础配置（面板只读展示路径，不写它）。 */
export const MASK_BASE_CONFIG_HINT = 'mask/config/docmask.json'

export interface MaskSettingsPayload {
  /** runtime.json 的绝对路径（面板显示，便于用户直接改） */
  path: string
  /** 基础配置路径提示 */
  baseConfigHint: string
  /** 当前生效值（已与默认值合并） */
  values: MaskRuntimeSettings
  /** 文件是否存在（false = 面板尚未落过盘，Python 走基础配置） */
  exists: boolean
  updatedAtMs: number | null
}

function dshHomeDir(): string {
  const fromEnv = process.env.DSH_HOME || process.env.DSH_HOME_DIR
  if (fromEnv) return fromEnv
  return path.join(process.env.HOME || process.cwd(), '.dsh')
}

export function maskRuntimePath(): string {
  return path.join(dshHomeDir(), 'tokensave', 'docmask', 'runtime.json')
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1) return true
  if (value === 'false' || value === 0) return false
  return fallback
}

function coerceThreshold(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(MASK_THRESHOLD_MAX, Math.max(MASK_THRESHOLD_MIN, Math.round(numeric * 100) / 100))
}

/** 把任意输入收敛成合法 runtime（未知字段丢弃，类型错误回落默认值）。 */
export function sanitizeMaskRuntime(raw: unknown): MaskRuntimeSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const result: MaskRuntimeSettings = { ...MASK_RUNTIME_DEFAULTS }
  for (const key of MASK_RUNTIME_SWITCHES) {
    result[key] = coerceBoolean(source[key], MASK_RUNTIME_DEFAULTS[key])
  }
  result.gliner_threshold = coerceThreshold(source.gliner_threshold, MASK_RUNTIME_DEFAULTS.gliner_threshold)
  return result
}

/** 只接受合法字段的部分更新（POST 用）。 */
export function sanitizeMaskRuntimePatch(raw: unknown): Partial<MaskRuntimeSettings> {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const patch: Partial<MaskRuntimeSettings> = {}
  for (const key of MASK_RUNTIME_SWITCHES) {
    if (key in source) patch[key] = coerceBoolean(source[key], MASK_RUNTIME_DEFAULTS[key])
  }
  if ('gliner_threshold' in source) {
    patch.gliner_threshold = coerceThreshold(source.gliner_threshold, MASK_RUNTIME_DEFAULTS.gliner_threshold)
  }
  return patch
}

/** 读当前文件（不存在或损坏都回落默认值，并如实报告 exists）。 */
export function readMaskSettings(): MaskSettingsPayload {
  const target = maskRuntimePath()
  let exists = false
  let updatedAtMs: number | null = null
  let stored: Record<string, unknown> = {}
  try {
    const stat = fs.statSync(target)
    exists = true
    updatedAtMs = stat.mtimeMs
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
    if (parsed && typeof parsed === 'object') {
      const container = parsed as Record<string, unknown>
      // 兼容直接写扁平 runtime 与包一层 runtime 两种形态
      stored = (container.runtime && typeof container.runtime === 'object'
        ? container.runtime
        : container) as Record<string, unknown>
    }
  } catch {
    /* 文件不存在 / 不是合法 JSON：都用默认值 */
  }
  return {
    path: target,
    baseConfigHint: MASK_BASE_CONFIG_HINT,
    values: sanitizeMaskRuntime(stored),
    exists,
    updatedAtMs
  }
}

/** 合并写入：保留用户在该文件里写的其它键，只改 runtime。 */
export function writeMaskSettings(patch: unknown): MaskSettingsPayload {
  const target = maskRuntimePath()
  const current = readMaskSettings()
  const next = sanitizeMaskRuntime({ ...current.values, ...sanitizeMaskRuntimePatch(patch) })

  let container: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      container = parsed as Record<string, unknown>
    }
  } catch {
    /* 首次写入：从空对象开始 */
  }
  // 保留用户在该文件 runtime 里手写的其它键（只覆盖面板管辖的字段）
  const previousRuntime = (container.runtime && typeof container.runtime === 'object' && !Array.isArray(container.runtime))
    ? container.runtime as Record<string, unknown>
    : {}
  container.runtime = { ...previousRuntime, ...next }
  container.updatedAtMs = Date.now()

  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(container, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, target)

  const payload = readMaskSettings()
  console.log(`[dsh-tokensave] 脱敏设置已更新（${Object.entries(next).map(([key, value]) => `${key}=${value}`).join(' ')}）`)
  return payload
}
