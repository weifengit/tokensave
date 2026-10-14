/**
 * 工作台面板的**纯逻辑**（Step 13 · Step D）：面板 id 命名、标题/图标映射、
 * 「应当存在哪些面板」的推导。抽出来是为了可单测（不需要 DOM/dockview）。
 *
 * id 约定：`center`（项目中心） / `<projectId>:<kind>`，
 * kind ∈ preview | board | chat | talk | save | exp:<sessionId>。
 * 两个项目的面板因此天然不撞名 —— 这是「多项目并存不串台」的第一道保障。
 */

export const CENTER = 'center'
export const KINDS = ['preview', 'board', 'chat', 'talk', 'save'] as const
export type Kind = (typeof KINDS)[number]

export const KIND_TITLE: Record<Kind, string> = {
  preview: '项目预览',
  board: '共享黑板',
  chat: 'DSH 主对话',
  talk: '协作对话',
  save: '协作收益',
}

export const KIND_ICON: Record<Kind, string> = {
  preview: 'book',
  board: 'report',
  chat: 'chat',
  talk: 'comment',
  save: 'database',
}

/** 组合面板 id。 */
export function paneId(projectId: string, kind: string): string {
  return `${projectId}:${kind}`
}

/** 拆面板 id；不是「项目面板」形状时返回 null（center 等）。 */
export function parsePaneId(id: string): { projectId: string; kind: string } | null {
  const i = id.indexOf(':')
  if (i <= 0) return null
  return { projectId: id.slice(0, i), kind: id.slice(i + 1) }
}

/** 该 kind 是否是我们认识的固定 kind。 */
export function isKind(kind: string): kind is Kind {
  return (KINDS as readonly string[]).includes(kind)
}

/** 面板标题（跨项目时带项目名，比裸 id 好读）。 */
export function paneTitle(id: string, projectName?: string): string {
  if (id === CENTER) return '项目中心'
  const parsed = parsePaneId(id)
  if (!parsed) return id
  const { kind } = parsed
  if (kind.startsWith('exp:')) return projectName ? `${projectName} · 探索者` : '探索者'
  const title = isKind(kind) ? KIND_TITLE[kind] : kind
  return projectName ? `${projectName} · ${title}` : title
}

/** 面板图标名（标签只画图标）。 */
export function paneIcon(id: string): string {
  if (id === CENTER) return 'list'
  const parsed = parsePaneId(id)
  if (!parsed) return 'report'
  const { kind } = parsed
  if (kind.startsWith('exp:')) return 'chat'
  return isKind(kind) ? KIND_ICON[kind] : 'report'
}

/** 某个项目的数据桶（只列本函数用到的字段，保持纯函数可测）。 */
export interface PaneData {
  explorers?: ReadonlyArray<{ id: string }>
  devUrl?: string
}

/**
 * 推导 dock 里**应当存在**的面板 id 集合。
 * 规则：项目中心恒在；每个打开的项目有 5 个固定面板（预览仅在拿到 devUrl 时才有）；
 * 每个探索者一个 `exp:<id>` 面板。
 */
export function desiredPaneIds(
  openedProjects: ReadonlyArray<{ id: string }>,
  data: Record<string, PaneData | undefined>,
): Set<string> {
  const out = new Set<string>([CENTER])
  openedProjects.forEach((p) => {
    const d = data[p.id]
    KINDS.forEach((k) => {
      if (k === 'preview' && !(d?.devUrl || '')) return
      out.add(paneId(p.id, k))
    })
    ;(d?.explorers || []).forEach((s) => out.add(paneId(p.id, `exp:${s.id}`)))
  })
  return out
}
