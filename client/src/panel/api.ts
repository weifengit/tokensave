/**
 * 项目中心 HTTP API 封装（宿主已挂载的只读路由）
 *  - /plugins/dsh-tokensave/fs     目录浏览（选择项目文件夹）
 *  - /plugins/dsh-tokensave/board  黑板条目（按工作区）
 *  - /plugins/dsh-tokensave/explorers  探索者快照（直读 agents，不依赖第三方）
 */

export interface FsEntry {
  name: string
  path: string
  isProject: boolean
}

export interface FsListing {
  path: string
  entries: FsEntry[]
}

export async function fetchDirectory(path?: string): Promise<FsListing> {
  const url = path
    ? `/plugins/dsh-tokensave/fs?path=${encodeURIComponent(path)}`
    : '/plugins/dsh-tokensave/fs'
  const res = await fetch(url)
  if (res.status === 404) throw new Error('目录不存在')
  if (res.status === 400) throw new Error('不是目录')
  if (!res.ok) throw new Error(`目录读取失败（HTTP ${res.status}）`)
  const data = await res.json()
  return { path: String(data.path || ''), entries: (data.entries || []) as FsEntry[] }
}

export interface BoardEntry {
  id: string
  topic: string
  topicLabel: string
  title: string
  content: string
  metadata: Record<string, unknown>
  createdAtMs: number
  expiresAtMs: number | null
  status: 'active' | 'archived' | 'expired' | 'dismissed'
  workspace: string
}

export interface BoardPayload {
  workspace: string
  entries: BoardEntry[]
}

export async function fetchBoard(workspace: string): Promise<BoardPayload> {
  const res = await fetch(`/plugins/dsh-tokensave/board?workspace=${encodeURIComponent(workspace)}`)
  if (!res.ok) throw new Error(`黑板加载失败（HTTP ${res.status}）`)
  const data = await res.json()
  return { workspace: String(data.workspace || workspace), entries: (data.entries || []) as BoardEntry[] }
}

export interface TelemetrySession {
  id: string
  shortId?: string
  title: string
  workspace: string
  state: string
}

/**
 * 探索者探测：tokensave 自有路由。
 * @param workspace 当前项目路径；传入后只取该工作区的探索者（与黑板同口径）。
 *   若按工作区过滤后为空，则回退为全量——宁可多显示，也不能让窗口凭空消失
 *   （工作区字符串归一化差异、跨项目复用探索者等情况下仍可见）。
 */
export async function fetchExplorers(workspace?: string): Promise<TelemetrySession[]> {
  const pick = (data: any): TelemetrySession[] =>
    (Array.isArray(data?.sessions) ? data.sessions : []).filter(
      (s: any) => typeof s?.title === 'string' && s.title.startsWith('tokensave-')
    )
  const load = async (url: string): Promise<TelemetrySession[]> => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`探索者快照加载失败（HTTP ${res.status}）`)
    return pick(await res.json())
  }
  const base = '/plugins/dsh-tokensave/explorers'
  if (!workspace) return load(base)
  const scoped = await load(`${base}?workspace=${encodeURIComponent(workspace)}`)
  if (scoped.length > 0) return scoped
  return load(base)
}
