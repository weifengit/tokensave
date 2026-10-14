/**
 * 项目中心项目仓库（服务端注册表 + 本地缓存）
 * 项目 = { id, 名称, 文件夹路径, 项目介绍, 创建时间, 上次更新时间 }
 */
import { fetchProjects, publishProjects } from './api'
export type LayoutMode = 'h-desk'

export interface ProjectRecord {
  id: string
  name: string
  path: string
  /** 项目介绍（添加项目时填写；卡片/列表上作为说明性内容展示） */
  description: string
  layout: LayoutMode
  createdAt: number
  /** 上次更新时间：进入工作台 / 点「展示」时刷新，供「按更新时间」排序与展示 */
  updatedAt: number
}

// 布局模式固定仅 1 种（H 型工作台），无选择项；保留结构以便未来扩展
export const LAYOUT_OPTIONS: Array<{ id: LayoutMode; name: string; desc: string }> = [
  { id: 'h-desk', name: 'H 型工作台', desc: '左右两竖为免费大模型窗口，中上共享黑板，中下 DSH 主对话' },
]
const STORAGE_KEY = 'tokensave:projects.v1'

function genId(): string {
  return `prj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** 校验 / 归一化任意来源（localStorage 缓存或服务端注册表）的项目数组。 */
export function normalizeProjects(parsed: any): ProjectRecord[] {
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((p: any) => p && typeof p.id === 'string' && typeof p.path === 'string')
    .map((p: any) => {
      const createdAt = Number(p.createdAt) || Date.now()
      return {
        id: String(p.id),
        name: String(p.name || ''),
        path: String(p.path),
        description: typeof p.description === 'string' ? p.description : '',
        layout: 'h-desk' as LayoutMode,
        createdAt,
        // 旧记录没有 updatedAt：回退到 createdAt，保证排序/展示不缺值
        updatedAt: Number(p.updatedAt) || createdAt,
      }
    })
}

/**
 * 读项目列表（同步）：返回**本地缓存**。
 *
 * localStorage 按来源（origin）隔离——桌面端 127.0.0.1 与手机端（经
 * dsh-remote-mobile 网关的局域网 / Tailscale IP）是两个来源，缓存可能为空。
 * 真正的真相在服务端注册表，由 syncProjectsFromServer() 水合进这份缓存。
 */
export function loadProjects(): ProjectRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return normalizeProjects(JSON.parse(raw))
  } catch {
    return []
  }
}

// —— 变更广播（组件据此在服务端数据到达 / 本地增删后重渲染）——
const projectsListeners = new Set<(list: ProjectRecord[]) => void>()

/** 订阅项目列表变化；返回退订函数。 */
export function subscribeProjects(cb: (list: ProjectRecord[]) => void): () => void {
  projectsListeners.add(cb)
  return () => { projectsListeners.delete(cb) }
}

function emitProjects(list: ProjectRecord[]): void {
  for (const cb of [...projectsListeners]) {
    try { cb(list) } catch { /* 单个订阅者出错不影响其他 */ }
  }
}

/** 只写本地缓存（不广播、不回推服务端）。服务端 → 客户端的水合用。 */
function writeCache(list: ProjectRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch (e) {
    console.warn('[tokensave] 项目列表缓存写入失败', e)
  }
}

// 服务端回推串行化：连续增删时保证最后一次快照最终落库，避免并发互相覆盖。
let pushChain: Promise<unknown> = Promise.resolve()
let lastPushAt = 0

/**
 * 把本机项目列表推回服务端注册表（跨来源 / 跨设备共享的真相）。失败静默，缓存仍可用。
 *
 * 服务端做**并集合并**：只有 removed 里点名的 id 才会真的从注册表消失。
 * 这是为了防止「某个来源的缓存残缺 → 一次同步把别人的项目全删了」。
 *
 * @param list - 本机当前列表
 * @param removed - 本次显式删除的项目 id（默认空 = 纯新增/修改）
 */
function pushProjects(list: ProjectRecord[], removed: string[] = []): void {
  const snapshot = list.map((p) => ({ ...p }))
  const ids = [...removed]
  lastPushAt = Date.now()
  pushChain = pushChain.then(() => publishProjects(snapshot, ids)).catch(() => { /* 离线时以缓存兼底 */ })
}

/**
 * 保存本机列表并回推服务端。
 * @param list - 新列表
 * @param removed - 本次显式删除的 id（仅 removeProject 会传）
 */
function saveProjects(list: ProjectRecord[], removed: string[] = []): void {
  writeCache(list)
  emitProjects(list)
  pushProjects(list, removed)
}
let syncInflight: Promise<boolean> | null = null

/**
 * 从服务端注册表同步项目列表（跨来源 / 跨设备共享）。
 *
 * 规则：
 *  - 服务端尚未初始化（首次运行，~/.dsh/tokensave/projects.json 不存在）而本地缓存
 *    有数据 → 用本地缓存**反向播种**服务端，避免把桌面端既有项目清空；
 *  - 否则以服务端为准 → 写入本地缓存并广播，手机端由此看到桌面端登记的项目；
 *  - 拉取失败（离线 / 未授权）→ 返回 false，保持本地缓存不丢。
 *
 * @returns 是否成功完成一次同步
 */
export function syncProjectsFromServer(): Promise<boolean> {
  if (syncInflight) return syncInflight
  syncInflight = doSyncProjects().finally(() => { syncInflight = null })
  return syncInflight
}

async function doSyncProjects(): Promise<boolean> {
  // 刚推送过就先不回拉，避免用尚未落库的旧快照覆盖本地刚做的修改。
  if (Date.now() - lastPushAt < 1500) return false
  const local = loadProjects()
  let payload: { initialized: boolean; projects: ProjectRecord[] }
  try {
    payload = await fetchProjects()
  } catch {
    return false
  }
  const remote = normalizeProjects(payload.projects)
  if (!payload.initialized && local.length > 0) {
    // 服务端还没有注册表：播种本机既有项目 → 其它来源随后即可见
    pushProjects(local)
    return true
  }
  if (JSON.stringify(remote) === JSON.stringify(local)) return true
  // —— 并集水合（关键防护）——
  // 服务端可能比本地**少**（历史事故：某个来源拿着残缺缓存回推，把注册表冲小；
  // 或者本机存着别人还没有的项目）。直接 writeCache(remote) 会把本地独有的项目
  // 一起丢掉，等于把事故放大到每一台机器。因此这里改成按 id 并集：
  //   - 远端有、本地没有 → 采纳（跨设备新增）
  //   - 本地有、远端没有 → 保留，并回推给服务端（本机才是“知道得更多”的一方）
  const byId = new Map<string, ProjectRecord>()
  for (const p of remote) byId.set(p.id, p)
  const localOnly: ProjectRecord[] = []
  for (const p of local) {
    if (!byId.has(p.id)) localOnly.push(p)
  }
  const merged = [...byId.values(), ...localOnly]
  writeCache(merged)
  emitProjects(merged)
  if (localOnly.length > 0) {
    // 本地比服务端多：把多出来的补回服务端，让其他来源也能看到
    console.warn(`[tokensave] 服务端项目数偏少（远端 ${remote.length} / 本地 ${local.length}），已保留本地独有的 ${localOnly.length} 条并回推`)
    pushProjects(merged)
  }
  return true
}

// 模块一加载即开始水合（早于 React 挂载），把「增删早于水合」的竞态窗口压到最小。
void syncProjectsFromServer()

export function addProject(name: string, path: string, description = ''): ProjectRecord {
  const layout: LayoutMode = 'h-desk' // 固定唯一布局
  const now = Date.now()
  const record: ProjectRecord = {
    id: genId(),
    name: name || path.split('/').pop() || path,
    path,
    description: description.trim(),
    layout,
    createdAt: now,
    updatedAt: now,
  }
  const list = loadProjects()
  // 同路径去重：更新已有记录而不是重复添加
  const existing = list.findIndex((p) => p.path === path)
  if (existing >= 0) {
    list[existing] = {
      ...list[existing],
      name: record.name,
      // 介绍留空时不覆盖原有值（避免重添项目把已填的介绍清掉）
      description: record.description || list[existing].description,
      layout,
      updatedAt: now,
    }
    saveProjects(list)
    return list[existing]
  }
  list.push(record)
  saveProjects(list)
  return record
}

/**
 * 刷新某个项目的「上次更新时间」。
 * 在进入工作台 / 点「展示」时调用——这是“使用过”的语义。
 */
export function touchProject(id: string): void {
  if (!id) return
  const list = loadProjects()
  const hit = list.find((p) => p.id === id)
  if (!hit) return
  hit.updatedAt = Date.now()
  saveProjects(list)
}

/**
 * 更新某个项目的「项目介绍」（列表模式行内编辑专用）。
 *
 * 与 addProject / removeProject 同一份存储（localStorage `tokensave:projects.v1`），
 * 不碰其它字段；传入空串表示清空介绍。
 * @returns 是否命中了该项目（未命中时不动存储）
 */
export function updateProjectDescription(id: string, description: string): boolean {
  if (!id) return false
  const list = loadProjects()
  const hit = list.find((p) => p.id === id)
  if (!hit) return false
  hit.description = String(description ?? '').trim()
  saveProjects(list)
  return true
}

/**
 * 删除一个项目（用户显式操作）。
 *
 * 关键：必须把 id 放进 removed 一并上报。服务端现在做并集合并，只有点名的 id
 * 才会真的从注册表消失；否则「列表里少了一条」会被当成“本地缓存没看到它”
 * 而自动保留——那正是防止残缺缓存误删别人项目的机制。
 */
export function removeProject(id: string): void {
  saveProjects(loadProjects().filter((p) => p.id !== id), [id])
  // 项目没了，把它从「已打开项目集合」里摘掉（Step 13：布局快照已交给 dockview，
  // 整块存在 tokensave:desk-dock.v2；项目不在集合里，reconcile 会移除它的面板，
  // 下一次写盘就不再有它的条目，不留孤儿）。
  try {
    const raw = window.localStorage.getItem('tokensave:desk-open.v1')
    const list = raw ? JSON.parse(raw) : null
    if (Array.isArray(list)) {
      window.localStorage.setItem(
        'tokensave:desk-open.v1',
        JSON.stringify(list.filter((x: unknown) => x !== id)),
      )
    }
  } catch {
    /* 隐私模式：忽略 */
  }
}

// —— 展示偏好（卡片 / 列表模式、排序方式）——————
// 与项目数据分开存：这是纯 UI 偏好，换机器/清掉也不影响项目列表。

export type ViewMode = 'card' | 'list'
export type SortMode = 'name' | 'created' | 'updated'

const VIEW_KEY = 'tokensave:project-view.v1'

export interface ViewPrefs {
  mode: ViewMode
  sort: SortMode
}

export function loadViewPrefs(): ViewPrefs {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    const p = raw ? JSON.parse(raw) : null
    const mode: ViewMode = p?.mode === 'list' ? 'list' : 'card'
    const sort: SortMode = p?.sort === 'name' || p?.sort === 'updated' ? p.sort : 'created'
    return { mode, sort }
  } catch {
    return { mode: 'card', sort: 'created' }
  }
}

export function saveViewPrefs(prefs: ViewPrefs): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(prefs))
  } catch {
    /* 隐私模式：仅本次会话有效 */
  }
}

/**
 * 按给定方式排序（返回新数组，不改原数组）。
 * - name：按项目名称（中文用 localeCompare 才是正确的拼音/笔画序）
 * - created / updated：按时间**倒序**（最近的在最前，符合“项目中心”的使用直觉）
 */
export function sortProjects(list: ProjectRecord[], sort: SortMode): ProjectRecord[] {
  const out = list.slice()
  if (sort === 'name') {
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  } else if (sort === 'updated') {
    out.sort((a, b) => b.updatedAt - a.updatedAt)
  } else {
    out.sort((a, b) => b.createdAt - a.createdAt)
  }
  return out
}

// —— 「已进入的工作台」记忆 ——
// 切换会话（宿主按会话作用域重挂 conversation.view）或刷新页面后，仍停留在
// 同一项目的 H 台，而不是退回项目列表。按会话 id 记：每个会话各自记住自己
// 打开的是哪个项目。
const OPENED_KEY = 'tokensave:opened-project.v1'
const openedBySession = new Map<string, string>()

function readOpenedMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(OPENED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** 记住某会话当前打开的项目；传 null 表示退回项目列表（清除记忆）。 */
export function rememberOpenedProject(sessionId: string, projectId: string | null): void {
  if (!sessionId) return
  // 内存快路径（性能关键）：sweepProjectSessionBindings 每 5 秒会对**每个**项目下的
  // **每个**会话调一次本函数（5 项目 × 30 会话 ≈ 150 次/5s）。若值没变就直接返回，
  // 跳过 readOpenedMap 的 getItem + JSON.parse + stringify + setItem 四步同步 I/O——
  // 这在忙碌的机器上是切会话卡顿的明确来源之一。
  const known = openedBySession.get(sessionId)
  if (projectId ? known === projectId : known === undefined) return
  if (projectId) openedBySession.set(sessionId, projectId)
  else openedBySession.delete(sessionId)
  try {
    const map = readOpenedMap()
    if (projectId) map[sessionId] = projectId
    else delete map[sessionId]
    localStorage.setItem(OPENED_KEY, JSON.stringify(map))
  } catch {
    /* 隐私模式等：仅本次会话有效（模块内 Map 已更新） */
  }
}

/** 读某会话记住的项目 id（无记忆返回 null）。 */
export function recallOpenedProject(sessionId: string): string | null {
  if (!sessionId) return null
  const inMemory = openedBySession.get(sessionId)
  if (inMemory) return inMemory
  const stored = readOpenedMap()[sessionId]
  return typeof stored === 'string' && stored ? stored : null
}
