/**
 * 工作台「项目布局」记忆：**布局锁 + 布局快照**，按项目 id 绑定。
 *
 * 背景（用户需求）：从别处（项目中心 / 侧边栏 / 同项目的另一条对话）跳回某个项目的
 * 工作台时，窗口布局总是回到默认——用户每次都要重新摆一遍。于是给每个项目记一份
 * 「布局锁 + 布局快照」：
 *
 *   - **锁定**（默认）：再次进入本项目时，按快照原样恢复窗口布局；
 *   - **未锁定**：每次进入都用默认布局（「只有解锁之后才回归默认」）；
 *   - 锁**只作用于「从别处回到本项目」这一件事**：台内的「一键切换」、卡片三键、
 *     探索者窗口三键、预览条高度全部照常可用；锁定态下这些改动会即时更新快照，
 *     也就是「以用户定义的布局固化」。
 *   - 键是**项目 id**（不是会话 id），所以同一项目的不同对话共享同一份布局。
 *
 * 为什么存 localStorage 而不是项目注册表（服务端 projects.json）：
 * 布局是**本机视图状态**——里面既有探索者会话 id（本机会话），也有像素高度（屏幕相关）。
 * 手机端与桌面端本就该各有一套布局，跨设备同步没有意义；而注册表是全来源共享的真相，
 * 把视图噪声写进去只会让「并集合并 / 备份」那套防护承担无谓风险。
 */
import type { CardState } from './desk-types'

/** 探索者窗口的状态（与卡片同款语义，但不参与「铺满浮层」）。 */
export interface DeskWinState {
  collapsed: boolean
  hidden: boolean
}

/** 一个项目的完整布局快照（`v` 用于将来的结构迁移）。 */
export interface DeskLayout {
  v: 1
  /** 卡片 id → 三键状态（board / chat / talk / save / preview） */
  cards: Record<string, CardState>
  /** 探索者会话 id → 三键状态 */
  winState: Record<string, DeskWinState>
  /** 预览条高度（px）；0 = 没存过，调用方回落全局记忆 */
  previewH: number
  /**
   * 中列「上格（共享黑板）占中列高度的比例」；0 = 没存过，调用方回落对半分。
   * 只影响中列内部两格的分高，与预览条高度、列轨道互不相干。
   */
  midSplit: number
}

export interface ProjectDeskPref {
  /** 布局锁：true = 再次进入本项目时按 layout 恢复；false = 每次进入都用默认布局 */
  locked: boolean
  /** 锁定态下固化的布局；未锁定（或从未存过）为 null */
  layout: DeskLayout | null
  updatedAt: number
}

const STORAGE_KEY = 'tokensave:desk-layout.v1'
/** 快照里探索者窗口条目的上限（只留非默认项，正常远达不到；纯属安全阀）。 */
const MAX_WIN_ENTRIES = 200

/** 中列上下比例的安全区间：越界就钳回来（任一侧被压到只剩标题条都不可用）。 */
const MID_SPLIT_MIN = 0.12
const MID_SPLIT_MAX = 0.88
function readAll(): Record<string, ProjectDeskPref> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ProjectDeskPref>) : {}
  } catch {
    return {}
  }
}

function writeAll(map: Record<string, ProjectDeskPref>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* 隐私模式 / 配额满：仅本次会话有效 */
  }
}

/** 逐字段归一化一张卡片的状态（任意来源的数据都不可信）。 */
function sanitizeCard(raw: any): CardState | null {
  if (!raw || typeof raw !== 'object') return null
  return {
    collapsed: raw.collapsed === true,
    hidden: raw.hidden === true,
    maximized: raw.maximized === true,
  }
}

function sanitizeLayout(raw: any): DeskLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const cards: Record<string, CardState> = {}
  for (const [id, v] of Object.entries(raw.cards || {})) {
    const c = sanitizeCard(v)
    if (c) cards[id] = c
  }
  const winState: Record<string, DeskWinState> = {}
  for (const [id, v] of Object.entries(raw.winState || {})) {
    if (Object.keys(winState).length >= MAX_WIN_ENTRIES) break
    const c = sanitizeCard(v)
    if (c) winState[id] = { collapsed: c.collapsed, hidden: c.hidden }
  }
  const previewH = Number(raw.previewH)
  // 中列比例：只认 (0,1) 区间里的有限数（0 与脏数据一律当「没存过」），再钳到安全区间
  const midSplitRaw = Number(raw.midSplit)
  const midSplit =
    Number.isFinite(midSplitRaw) && midSplitRaw > 0 && midSplitRaw < 1
      ? Math.min(MID_SPLIT_MAX, Math.max(MID_SPLIT_MIN, midSplitRaw))
      : 0
  return {
    v: 1,
    cards,
    winState,
    previewH: Number.isFinite(previewH) && previewH > 0 ? previewH : 0,
    midSplit,
  }
}

/** 读某个项目的布局偏好；没存过返回 null（调用方回落默认布局 + 默认锁定）。 */
export function loadDeskPref(projectId: string): ProjectDeskPref | null {
  if (!projectId) return null
  const hit = readAll()[projectId]
  if (!hit || typeof hit !== 'object') return null
  return {
    locked: hit.locked !== false, // 默认锁定（用户要求：默认即锁定）
    layout: sanitizeLayout(hit.layout),
    updatedAt: Number(hit.updatedAt) || 0,
  }
}

/**
 * 只改「布局锁」这一个开关，不动已固化的布局快照。
 *
 * 为什么要单独一个函数：解锁时快照必须**留着**——用户再锁回来时应该恢复他上次摆好的
 * 布局，而不是回到默认（用户要求：「直至用户自行更改，再以用户定义的布局固化」）。
 */
export function setDeskLocked(projectId: string, locked: boolean): void {
  if (!projectId) return
  const map = readAll()
  const prev = map[projectId]
  map[projectId] = {
    locked: locked !== false,
    layout: prev?.layout ? sanitizeLayout(prev.layout) : null,
    updatedAt: Date.now(),
  }
  writeAll(map)
}

/**
 * 写某个项目的布局偏好（合并进整张表，不动其它项目）。
 * @param pref - 锁定态与快照；`updatedAt` 省略时取当前时间
 */
export function saveDeskPref(
  projectId: string,
  pref: { locked: boolean; layout: DeskLayout | null; updatedAt?: number },
): void {
  if (!projectId) return
  const map = readAll()
  map[projectId] = {
    locked: pref.locked !== false,
    layout: pref.layout ? sanitizeLayout(pref.layout) : null,
    updatedAt: pref.updatedAt || Date.now(),
  }
  writeAll(map)
}

/** 忘记某个项目的布局偏好（项目被移除时调用，避免留下孤儿条目）。 */
export function forgetDeskPref(projectId: string): void {
  if (!projectId) return
  const map = readAll()
  if (!(projectId in map)) return
  delete map[projectId]
  writeAll(map)
}
