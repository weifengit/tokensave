/**
 * 宿主「本轮变更档案」读取（`/api/changes.summary` + `/api/changes.diff`）。
 *
 * 为什么复用宿主路由而不是自己算：原生对话 tab 那张「已编辑 N 个文件」卡
 * 就是这两个认证路由的消费者（dsh-client-ui-deliverables）。宿主在每轮结束
 * 时追加一条 `workspace/changes` 事件（data 只有 turn），真正的清单、逐文件
 * 增删行数、以及单文件 before/after 对比都由路由按 (sessionId, seq) 现算——
 * 它把 **git 工作树差异**也算了进去，比我们自己数 tool/call 更准。照搬这套
 * 数据源，工作台的卡才与原生逐字段一致，而不是「看起来差不多」。
 *
 * 缓存策略与宿主 HostReadStore 同意图：同一 URL 读到成功结果就一直复用
 * （清单是某一轮的既成事实，不会变）；失败 / 404 不复用，下次再试——
 * 会话刚结束时后端可能还没落盘，过早缓存会把错误钉死。
 */
import type { ChangesDiff, ChangesDiffState, ChangesSummary } from './changes-types'

/** 已成功的清单：轮次档案是既成事实，一次读取即可长期复用。 */
const summaryCache = new Map<string, ChangesSummary>()
/** 已成功的单文件对比；键含 seq+index，同一文件被多轮改过也不会串。 */
const diffCache = new Map<string, Exclude<ChangesDiffState, 'loading' | 'error' | 'missing'>>()
/** 在飞的请求：并行悬浮多个文件行时不重复打同一 URL。 */
const summaryInFlight = new Map<string, Promise<ChangesSummary | null>>()
const diffInFlight = new Map<string, Promise<Exclude<ChangesDiffState, 'loading' | 'error' | 'missing'> | null>>()

function summaryUrl(sessionId: string, seq: number): string {
  return `/api/changes.summary?${new URLSearchParams({ sessionId, seq: String(seq) })}`
}

function diffUrl(sessionId: string, seq: number, index: number): string {
  return `/api/changes.diff?${new URLSearchParams({
    sessionId,
    seq: String(seq),
    index: String(index),
  })}`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 与宿主 isChangedFile 同口径：路径 + 展示路径 + 增删行数（binary/oversized 可缺省）。 */
function isChangedFile(v: unknown): boolean {
  if (!isRecord(v)) return false
  const { path, display, added, deleted, binary, oversized } = v
  return typeof path === 'string' && path.length > 0
    && typeof display === 'string' && display.length > 0
    && Number.isSafeInteger(added) && Number.isSafeInteger(deleted)
    && (binary === undefined || binary === true)
    && (oversized === undefined || oversized === true)
}

/**
 * 读某一轮的变更清单。
 * @returns 清单；会话/轮次已不可读（404）或请求失败时 null（调用方退回本地统计）。
 */
export async function loadChangesSummary(sessionId: string, seq: number): Promise<ChangesSummary | null> {
  if (!sessionId) return null
  const url = summaryUrl(sessionId, seq)
  const hit = summaryCache.get(url)
  if (hit) return hit
  const flying = summaryInFlight.get(url)
  if (flying) return flying
  const task = (async () => {
    try {
      const res = await fetch(url)
      // 404 = 该轮档案在宿主侧已不存在（会话被回收）；不当错误重试。
      if (!res.ok) return null
      const data = await res.json()
      if (!isRecord(data)) return null
      const { turn, files, total, added, deleted } = data
      if (!Number.isSafeInteger(turn) || (turn as number) < 1) return null
      if (!Number.isSafeInteger(total) || !Number.isSafeInteger(added) || !Number.isSafeInteger(deleted)) return null
      if (!Array.isArray(files) || !files.every(isChangedFile)) return null
      const summary = data as unknown as ChangesSummary
      summaryCache.set(url, summary)
      return summary
    } catch {
      return null
    } finally {
      summaryInFlight.delete(url)
    }
  })()
  summaryInFlight.set(url, task)
  return task
}

/**
 * 读某一轮里某个文件的 before/after 对比（悬浮预览用）。
 * @returns 对比结果；不可读或失败时 null。
 */
export async function loadChangesDiff(
  sessionId: string,
  seq: number,
  index: number,
): Promise<Exclude<ChangesDiffState, 'loading' | 'error' | 'missing'> | null> {
  if (!sessionId) return null
  const url = diffUrl(sessionId, seq, index)
  const hit = diffCache.get(url)
  if (hit) return hit
  const flying = diffInFlight.get(url)
  if (flying) return flying
  const task = (async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const data = await res.json()
      if (!isRecord(data)) return null
      const { kind, path, display } = data
      if (typeof path !== 'string' || !path || typeof display !== 'string' || !display) return null
      if (kind === 'binary' || kind === 'oversized') {
        const refusal: ChangesDiff = { kind, path, display }
        diffCache.set(url, refusal)
        return refusal
      }
      if (kind !== 'text') return null
      const { before, after, hunks, coarse } = data
      if (typeof before !== 'boolean' || typeof after !== 'boolean' || typeof coarse !== 'boolean') return null
      if (!Array.isArray(hunks)) return null
      const diff = data as unknown as Exclude<ChangesDiffState, 'loading' | 'error' | 'missing'>
      diffCache.set(url, diff)
      return diff
    } catch {
      return null
    } finally {
      diffInFlight.delete(url)
    }
  })()
  diffInFlight.set(url, task)
  return task
}

/** 会话/工作区切换时清掉缓存，避免把上一个会话的行数显示在新会话里。 */
export function resetChangesCache(): void {
  summaryCache.clear()
  diffCache.clear()
  summaryInFlight.clear()
  diffInFlight.clear()
}
