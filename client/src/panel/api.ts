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
 * 探索者探测：tokensave 自有路由（严格按项目隔离）。
 *
 * @param workspace 当前项目路径。传入后只取该项目工作区的探索者——**不再回退全量**：
 *   回退会把别的项目的探索者（乃至陈旧会话）显示到当前工作台，既破坏隔离，
 *   又让窗口看似“有内容却永不更新”。路径匹配的容差由宿主侧路由负责
 *   （规范化 + 尾部路径段比较），客户端只做严格收敛。
 *   不传 workspace 时返回全量（仅调试用）。
 */
export async function fetchExplorers(workspace?: string): Promise<TelemetrySession[]> {
  const pick = (data: any): TelemetrySession[] =>
    (Array.isArray(data?.sessions) ? data.sessions : []).filter(
      (s: any) => typeof s?.title === 'string' && s.title.startsWith('tokensave-')
    )
  const base = '/plugins/dsh-tokensave/explorers'
  const url = workspace ? `${base}?workspace=${encodeURIComponent(workspace)}` : base
  const res = await fetch(url)
  if (!res.ok) throw new Error(`探索者快照加载失败（HTTP ${res.status}）`)
  return pick(await res.json())
}

/**
 * 发布「当前打开的工作台项目」（探索者归属的真相）。
 *
 * 宿主侧 session_create 没有 cwd 参数，工作区取自调用方 agent；因此探索者默认跟随
 * **发起会话**而非**当前打开的项目**。这里把当前项目告知宿主，探索者创建时读它作为
 * cwd，使探索者强制跟随当前工作台项目。传空串清除（退回项目列表时调用）。
 *
 * 失败不抛：作用域只是「归属优化」，不应阻断 UI；清除失败时宿主侧会保留旧值，
 * 下次进入项目会重新发布。
 */
export async function publishProjectScope(workspace: string): Promise<void> {
  try {
    const res = await fetch('/plugins/dsh-tokensave/scope', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: workspace || '' }),
    })
    if (!res.ok) console.warn(`[tokensave] 项目作用域发布失败（HTTP ${res.status}）`)
  } catch (e) {
    console.warn('[tokensave] 项目作用域发布失败', e)
  }
}
