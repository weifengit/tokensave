/**
 * 脱敏设置的数据通道（宿主路由 /plugins/dsh-tokensave/mask-settings）。
 *
 * 只有 GET（读快照）与 POST（合并写入），写入的是
 * ~/.dsh/tokensave/docmask/runtime.json —— Python 端热加载同一份文件。
 */

export interface MaskRuntimeValues {
  enabled: boolean
  regex: boolean
  glossary: boolean
  gliner: boolean
  cache: boolean
  audit: boolean
  hot_reload: boolean
  gliner_threshold: number
  auto_persist_sessions: boolean
}

export interface MaskSettingsPayload {
  path: string
  baseConfigHint: string
  values: MaskRuntimeValues
  exists: boolean
  updatedAtMs: number | null
}

const ROUTE = '/plugins/dsh-tokensave/mask-settings'

async function readPayload(res: Response, action: string): Promise<MaskSettingsPayload> {
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = data && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
    throw new Error(`${action}失败：${detail}`)
  }
  return data as MaskSettingsPayload
}

export async function fetchMaskSettings(): Promise<MaskSettingsPayload> {
  const res = await fetch(ROUTE)
  return readPayload(res, '脱敏设置加载')
}

export async function saveMaskSettings(patch: Partial<MaskRuntimeValues>): Promise<MaskSettingsPayload> {
  const res = await fetch(ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch)
  })
  return readPayload(res, '脱敏设置保存')
}
