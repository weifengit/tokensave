/**
 * 项目中心项目仓库（localStorage 持久化）
 * 项目 = { id, 名称, 文件夹路径, 布局模式（当前固定仅 H 型 1 种）, 创建时间 }
 */
export type LayoutMode = 'h-desk'

export interface ProjectRecord {
  id: string
  name: string
  path: string
  layout: LayoutMode
  createdAt: number
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
    return parsed.filter(
      (p: any) => p && typeof p.id === 'string' && typeof p.path === 'string'
    ).map((p: any) => ({
      id: String(p.id),
      name: String(p.name || ''),
      path: String(p.path),
      layout: (p.layout === 'h-desk' ? 'h-desk' : 'h-desk') as LayoutMode,
      createdAt: Number(p.createdAt) || Date.now(),
    }))
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

export function addProject(name: string, path: string): ProjectRecord {
  const layout: LayoutMode = 'h-desk' // 固定唯一布局
  const record: ProjectRecord = {
    id: genId(),
    name: name || path.split('/').pop() || path,
    path,
    layout,
    createdAt: Date.now(),
  }
  const list = loadProjects()
  // 同路径去重：更新已有记录而不是重复添加
  const existing = list.findIndex((p) => p.path === path)
  if (existing >= 0) {
    list[existing] = { ...list[existing], name: record.name, layout, createdAt: record.createdAt }
    saveProjects(list)
    return list[existing]
  }
  list.push(record)
  saveProjects(list)
  return record
}

export function removeProject(id: string): void {
  saveProjects(loadProjects().filter((p) => p.id !== id))
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
