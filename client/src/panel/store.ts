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
