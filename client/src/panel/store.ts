/**
 * 项目中心项目仓库（localStorage 持久化）
 * 项目 = { id, 名称, 文件夹路径, 项目介绍, 创建时间, 上次更新时间 }
 */
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

export function loadProjects(): ProjectRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
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
  } catch {
    return []
  }
}

function saveProjects(list: ProjectRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch (e) {
    console.warn('[tokensave] 项目列表保存失败', e)
  }
}

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

export function removeProject(id: string): void {
  saveProjects(loadProjects().filter((p) => p.id !== id))
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
