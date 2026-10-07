import type { Context } from '@deepseek-ai/cordis'
// type-only：拉入 Context.sessions 的声明合并与 SessionId 品牌类型（运行时被擦除）
import type { SessionId } from '@deepseek-ai/dsh-session'
import { readdir } from 'node:fs/promises'
import { PROJECT_MARKERS, editKeywords } from '../types.ts'

export type Scenario = 'from_scratch' | 'edit_existing'

export async function detectScenario(
  ctx: Context, sessionId: string, userMessage: string
): Promise<{ scenario: Scenario; cwd: string | null }> {
  const session = ctx.sessions.get(sessionId as SessionId)
  const cwd = session?.header?.cwd ?? null

  if (!cwd) return { scenario: 'from_scratch', cwd: null }

  // 文档的 ctx.tools.call('list_dir') 在 0.2.0-rc.2 不存在（方法与工具均无，已查实）；
  // 改用 node:fs 读取 cwd 根目录，行为与检测策略表一致，读取失败按无项目标记处理
  const entries = await readdir(cwd).catch(() => [] as string[])
  const hasProjectFiles = entries.some(name => PROJECT_MARKERS.includes(name))
  if (!hasProjectFiles) return { scenario: 'from_scratch', cwd }

  const hasEditIntent = editKeywords.some(k => userMessage.includes(k))

  return {
    scenario: hasEditIntent ? 'edit_existing' : 'from_scratch',
    cwd
  }
}
