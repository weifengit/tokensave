/**
 * 项目中心 HTTP API 封装（宿主已挂载的只读路由）
 *  - /plugins/dsh-tokensave/fs           目录浏览（选择项目文件夹）
 *  - /plugins/dsh-tokensave/board        黑板条目（按工作区）
 *  - /plugins/dsh-tokensave/explorers    探索者快照（直读 agents，不依赖第三方）
 *  - /plugins/dsh-tokensave/clone       从 GitHub 克隆仓（POST 启动 / GET 查进度）
 *  - /plugins/dsh-tokensave/project-info 项目文件最后修改时间 + 开发服务器地址
 */
import type { ProjectRecord } from './store'

export interface FsEntry {
  name: string
  path: string
  isProject: boolean
}

export interface FsListing {
  path: string
  /** 父目录（在文件系统根上时为 null）——由后端算好，客户端不再字符串切片猜。 */
  parent: string | null
  /** 文件系统根列表：Windows 上是盘符（C:/、D:/…），类 Unix 上是 ['/']。 */
  roots: string[]
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
  return {
    path: String(data.path || ''),
    parent: typeof data.parent === 'string' ? data.parent : null,
    roots: Array.isArray(data.roots) ? data.roots.map((r: unknown) => String(r)) : [],
    entries: (data.entries || []) as FsEntry[],
  }
}

export interface ProjectInfo {
  path: string
  /** 项目内部文件最后一次修改时间（真实 mtime，毫秒） */
  mtimeMs: number
  /** 项目文件夹内**最老**文件的修改时间（真实 mtime，毫秒）——「创建于」用它 */
  oldestMtimeMs: number
  /** 推断出的开发服务器地址（无则空串） */
  devUrl: string
  /** 探测结果：该地址是否真的有人在监听（= 项目已启动） */
  devRunning: boolean
}

/**
 * 读项目信息：真实文件 mtime（最新 = 更新于、最老 = 创建于）+ 推断的开发服务器地址。
 * 失败时返回 null（调用方退回到本地记录的 updatedAt），不抛错——
 * 这只是展示用的附加信息，不应阻断项目列表渲染。
 */
export async function fetchProjectInfo(path: string): Promise<ProjectInfo | null> {
  try {
    const res = await fetch(`/plugins/dsh-tokensave/project-info?path=${encodeURIComponent(path)}`)
    if (!res.ok) return null
    const data = await res.json()
    return {
      path: String(data.path || path),
      mtimeMs: Number(data.mtimeMs) || 0,
      oldestMtimeMs: Number(data.oldestMtimeMs) || 0,
      devUrl: typeof data.devUrl === 'string' ? data.devUrl : '',
      devRunning: data.devRunning === true,
    }
  } catch {
    return null
  }
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

// —— 项目注册表（跨来源 / 跨设备共享）———————————————
//
// 项目列表若只存浏览器 localStorage，会因「来源（origin）隔离」而在手机端
// （经 dsh-remote-mobile 网关以局域网 / Tailscale IP 访问）读不到——同一服务、
// 不同来源 → 空列表。故宿主侧提供文件落库的注册表路由，所有来源读写同一份数据。

export interface ProjectsPayload {
  /** 服务端是否已有注册表（false = 首次运行，客户端应以本地缓存播种） */
  initialized: boolean
  projects: ProjectRecord[]
}

/** 读服务端项目注册表。 */
export async function fetchProjects(): Promise<ProjectsPayload> {
  const res = await fetch('/plugins/dsh-tokensave/projects')
  if (!res.ok) throw new Error(`项目列表加载失败（HTTP ${res.status}）`)
  const data = await res.json()
  return {
    initialized: data.initialized === true,
    projects: Array.isArray(data.projects) ? (data.projects as ProjectRecord[]) : [],
  }
}

/**
 * 写回服务端项目注册表。失败返回 false（调用方静默兼底为本地缓存）。
 *
 * 注意语义：服务端做的是**并集合并**（见 board-web-route 的 mergeProjects），
 * 而不是整表覆盖。因此这里的 projects 只是「我这边看到的全部」，服务端已有的
 * 项目只要没出现在 removed 里就会保留——残缺缓存再也无法把别人的项目删掉。
 *
 * @param projects - 本机看到的项目列表（新增 + 修改 + 保留）
 * @param removed - 显式删除的项目 id（真正的删除必须走这里）
 */
export async function publishProjects(
  projects: ProjectRecord[],
  removed: string[] = [],
): Promise<boolean> {
  try {
    const res = await fetch('/plugins/dsh-tokensave/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projects, removed }),
    })
    if (!res.ok) {
      console.warn(`[tokensave] 项目注册表保存失败（HTTP ${res.status}）`)
      return false
    }
    return true
  } catch (e) {
    console.warn('[tokensave] 项目注册表保存失败', e)
    return false
  }
}

// —— 新建 / 重命名文件夹（「添加项目」里直接开一个新项目目录）—————

/** 文件夹操作结果（新目录的绝对路径 + 名称）。 */
export interface FolderResult {
  path: string
  name: string
}

/**
 * 在 parent 下新建一个文件夹（可带 from：把 parent/from 重命名）。
 *
 * 服务端路由 POST /plugins/dsh-tokensave/mkdir 只接受**单层**目录名，
 * 目标已存在会返回 409（不覆盖）。失败抛错，由调用方显示。
 */
async function postMkdir(body: Record<string, unknown>): Promise<FolderResult> {
  const res = await fetch('/plugins/dsh-tokensave/mkdir', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(String(data?.error || `文件夹操作失败（HTTP ${res.status}）`))
  return { path: String(data?.path || ''), name: String(data?.name || '') }
}

/** 在 parent 下新建文件夹。 */
export function createFolder(parent: string, name: string): Promise<FolderResult> {
  return postMkdir({ parent, name })
}

/** 把 parent 下的 from 重命名为 name（同目录内改名）。 */
export function renameFolder(parent: string, from: string, name: string): Promise<FolderResult> {
  return postMkdir({ parent, from, name })
}

// —— 从 GitHub 克隆（「添加项目」里直接拉一个仓库下来）————————
//
// 后端拆成两个端点：POST /clone 启动（长任务，立即返回 taskId），
// GET /clone-status?taskId= 查进度。客户端拿 taskId 轮询到 done/error 为止。

/** 克隆任务的状态（与服务端 CloneTask 对应）。 */
export type CloneState = 'running' | 'done' | 'error' | 'cancelled'

export interface CloneStatus {
  taskId: string
  state: CloneState
  /** 人话阶段名：正在准备 / 服务端打包 / 接收对象 / 解析差异 / 检出文件 */
  phase: string
  percent: number
  /** 失败时的错误信息（成功为空）。 */
  message: string
  /** 克隆完成后的项目目录（绝对路径）。 */
  path: string
  /** 本次新增的 git 输出行（增量，已由服务端取走）。 */
  lines: string[]
}

/** 启动克隆；返回 taskId 与目标目录。失败（校验不过 / 目录非空）抛错。 */
export async function cloneRepo(
  parent: string,
  url: string,
  name?: string
): Promise<{ taskId: string; path: string; name: string }> {
  const res = await fetch('/plugins/dsh-tokensave/clone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parent, url, name: name || undefined }),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(String(data?.error || `克隆启动失败（HTTP ${res.status}）`))
  return {
    taskId: String(data?.taskId || ''),
    path: String(data?.path || ''),
    name: String(data?.name || ''),
  }
}

/** 查一次克隆进度（404 表示任务已过期/不存在，抛错由调用方处理）。 */
export async function fetchCloneStatus(taskId: string): Promise<CloneStatus> {
  const res = await fetch(`/plugins/dsh-tokensave/clone-status?taskId=${encodeURIComponent(taskId)}`)
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(String(data?.error || `查询克隆进度失败（HTTP ${res.status}）`))
  return {
    taskId: String(data?.taskId || taskId),
    state: (data?.state || 'running') as CloneState,
    phase: String(data?.phase || ''),
    percent: Number(data?.percent ?? 0),
    message: String(data?.message || ''),
    path: String(data?.path || ''),
    lines: Array.isArray(data?.lines) ? data.lines.map(String) : [],
  }
}

// —— 探索者设置（默认 / 免费 / 收费 三组开关）——————————————
//
// 面板可逐个（或整组）开关探索者，至少保留 1 个选中。选择由宿主持久化
// （~/.dsh/tokensave/explorers.json）并驱动 parallelExplore。

export type ExplorerGroupId = 'default' | 'free' | 'paid'

export interface ExplorerSettingItem {
  /** `provider/model`，同时作唯一键 */
  model: string
  label: string
  focus: string
  group: ExplorerGroupId
  /** provider 当前是否已注册（未注册 = 凭据未配置，暂不可用） */
  available: boolean
  /** provider 广告的描述（面板里作悬浮提示，可选） */
  note?: string
}

export interface ExplorerSettingGroup {
  id: ExplorerGroupId
  label: string
  items: ExplorerSettingItem[]
}

export interface ExplorerSettingsPayload {
  /** 用户是否存过选择（false = 仍用内置默认） */
  configured: boolean
  groups: ExplorerSettingGroup[]
  /** 当前选中的 model 列表 */
  selected: string[]
}

function groupIdOf(raw: unknown): ExplorerGroupId {
  return raw === 'free' || raw === 'paid' ? raw : 'default'
}

function pickExplorerSettings(data: any): ExplorerSettingsPayload {
  const groups: ExplorerSettingGroup[] = (Array.isArray(data?.groups) ? data.groups : []).map((g: any) => {
    const id = groupIdOf(g?.id)
    const items: ExplorerSettingItem[] = (Array.isArray(g?.items) ? g.items : [])
      .map((it: any) => ({
        model: String(it?.model || ''),
        label: String(it?.label || it?.model || ''),
        focus: String(it?.focus || ''),
        group: id,
        available: it?.available !== false,
        note: it?.note ? String(it.note) : undefined,
      }))
      .filter((it: ExplorerSettingItem) => it.model)
    return { id, label: String(g?.label || ''), items }
  })
  return {
    configured: data?.configured === true,
    groups,
    selected: (Array.isArray(data?.selected) ? data.selected : []).map(String),
  }
}

/** 读探索者目录 + 当前选择。 */
export async function fetchExplorerSettings(): Promise<ExplorerSettingsPayload> {
  const res = await fetch('/plugins/dsh-tokensave/explorer-settings')
  if (!res.ok) throw new Error(`探索者设置加载失败（HTTP ${res.status}）`)
  return pickExplorerSettings(await res.json())
}

/** 保存选择（至少 1 个；宿主侧会再校验一次）。 */
export async function saveExplorerSettings(
  selected: Array<Pick<ExplorerSettingItem, 'model' | 'label' | 'focus'>>
): Promise<ExplorerSettingsPayload> {
  const res = await fetch('/plugins/dsh-tokensave/explorer-settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ selected }),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(String(data?.error || `探索者设置保存失败（HTTP ${res.status}）`))
  return pickExplorerSettings(data)
}
