/**
 * 轮次登记（2026-10-11 多探索者测试报告 BUG-1 / 优化-6）。
 *
 * 问题：/explorers 路由按「tokensave- 前缀 + 工作区」列出探索者，不区分轮次——
 * 第 N+1 轮委派时第 N 轮的旧探索者窗口仍全部可见；旧轮次的黑板帖（pitfall/solution/brief）
 * 也混进评审输入，简报引擎被迫做跨轮「归属考古」。
 *
 * 方案：每个工作区一份「当前轮次」登记（~/.dsh/tokensave/runs.json）：
 *   - parallelExplore 开跑时 beginRun(workspace)：归档上一轮的黑板帖并重置登记；
 *   - 探索者建完后 recordRunSessions(workspace, sessions)：登记本轮会话；
 *   - /explorers 路由按登记过滤 → 旧轮窗口在 H 台 8s 轮询内自动消失。
 *
 * 归档口径（beginRun）：
 *   - 上一轮探索者的帖：authorSessionId ∈ 上一轮 sessions；
 *   - 引擎帖（简报/需求）：topic=brief 且 metadata.source==='tokensave-engine'
 *     且工作区匹配（含 legacy 空工作区的全局帖）——引擎帖按轮产出，旧的必归档；
 *   - 其他一律不动（别的项目/别的来源的帖不误伤）。
 * 无上一轮登记（首次/记录缺失）→ 不归档，安全降级。
 */
import fs from 'node:fs'
import path from 'node:path'
import { getBoardStore, normalizeWorkspace, dshHomeDir } from './store.ts'

export interface RunSessionInfo {
  sessionId: string
  label: string
  model: string
}

export interface RunRecord {
  runId: string
  startedAtMs: number
  sessions: RunSessionInfo[]
  /**
   * 发起本轮委派的主会话（`tokensave_delegate` 调用方的 sessionId）。
   *
   * 为什么必须记：探索者会话是 root 会话（cwd = 项目路径），但轮次本身属于
   * **发起它的那条对话**。旧实现只按 workspace 登记，于是一个新会话进入同一项目
   * 的工作台时，仍会看到上一轮探索者窗口和协作对话（用户反馈：「新建会话还是有
   * 探索者那些内容和探索者的对话」）。记住发起会话后，客户端只在本会话发起时展示。
   * 旧记录没有这个字段（undefined）→ 客户端退回「按本会话 delegate 跨度自证」。
   */
  originSessionId?: string
}

interface RunsFile {
  version: 1
  runs: Record<string, RunRecord>
}

function runsFilePath(): string {
  return path.join(dshHomeDir(), 'tokensave', 'runs.json')
}

let cache: RunsFile | null = null

function ensureLoaded(): RunsFile {
  if (cache) return cache
  try {
    const file = runsFilePath()
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as RunsFile
      if (data && typeof data === 'object' && data.runs && typeof data.runs === 'object') {
        cache = data
        return cache
      }
    }
  } catch { /* 损坏即从空起步 */ }
  cache = { version: 1, runs: {} }
  return cache
}

function persist(): void {
  if (!cache) return
  try {
    const file = runsFilePath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  } catch (error) {
    console.warn(`[dsh-tokensave] 轮次登记落盘失败（内存态仍有效）:`, error)
  }
}

/** 上一轮 tokensave 产出的黑板帖 id（引擎帖 + 上轮探索者帖）。 */
function previousRunPostIds(workspace: string, prev: RunRecord): string[] {
  const store = getBoardStore()
  const prevSessions = new Set(prev.sessions.map((s) => s.sessionId))
  const all = store.list({ status: 'all', crossWorkspace: true, limit: 200 }).posts
  const ids: string[] = []
  for (const p of all as Array<Record<string, unknown>>) {
    const meta = (p.metadata ?? {}) as Record<string, unknown>
    const isEngineBrief =
      p.topic === 'brief' && meta.source === 'tokensave-engine' &&
      (normalizeWorkspace(String(p.workspace ?? '')) === workspace || String(p.workspace ?? '') === '')
    if (prevSessions.has(String(p.authorSessionId)) || isEngineBrief) {
      ids.push(String(p.id))
    }
  }
  return ids
}

/**
 * 开启新一轮：归档上一轮帖 + 重置登记，返回本轮 runId。
 * 首次（无上一轮记录）只重置登记，不归档。
 */
export function beginRun(
  workspace: string,
  /** 发起本轮委派的主会话（可选；旧调用方不传时保持旧行为） */
  originSessionId?: string,
): { runId: string; archived: number } {
  const data = ensureLoaded()
  const key = normalizeWorkspace(workspace)
  const prev = data.runs[key]
  let archived = 0
  if (prev) {
    try {
      archived = getBoardStore().archiveByIds(previousRunPostIds(key, prev))
    } catch (error) {
      console.warn('[dsh-tokensave] 归档上一轮黑板帖失败（不阻断本轮）:', error)
    }
  }
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const origin = typeof originSessionId === 'string' && originSessionId ? originSessionId : undefined
  data.runs[key] = {
    runId,
    startedAtMs: Date.now(),
    sessions: [],
    ...(origin ? { originSessionId: origin } : {}),
  }
  persist()
  return { runId, archived }
}

/** 探索者建完后登记本轮会话（/explorers 路由据此过滤）。 */
export function recordRunSessions(workspace: string, sessions: RunSessionInfo[]): void {
  const data = ensureLoaded()
  const key = normalizeWorkspace(workspace)
  const run = data.runs[key]
  if (!run) return // beginRun 未调用（防御：不登记比错登记好）
  run.sessions = sessions
  persist()
}

/** 当前轮次登记（无记录返回 null → 路由不过滤，保持旧行为）。 */
export function currentRun(workspace: string): RunRecord | null {
  const data = ensureLoaded()
  return data.runs[normalizeWorkspace(workspace)] ?? null
}
