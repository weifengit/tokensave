import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'

// 0.2.0-rc.2 无 ctx.tools.call（文档 API 过时第 3 例）——统一走 ctx.tools.execute
let callSeq = 0
async function callTool(ctx: Context, name: string, args: Record<string, unknown>) {
  const result = await ctx.tools.execute({
    callId: brandString<ToolCallId>(`tokensave-board-${name}-${++callSeq}-${Date.now().toString(36)}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
  })
  if (result.isError) {
    throw new Error(`tokensave: tool ${name} failed: ${JSON.stringify(result.error).slice(0, 300)}`)
  }
  return result.value as unknown
}

export type BoardTopic = 'requirement' | 'pitfall' | 'solution' | 'brief'

export interface BlackboardEntry {
  topic: BoardTopic
  content: string
  metadata: {
    source: string
    confidence: 'high' | 'medium' | 'low'
    digest: string
    explorerLabel?: string
  }
  ttl?: number
}

export async function postToBoard(ctx: Context, entry: BlackboardEntry) {
  return await callTool(ctx, 'board_post', {
    topic: entry.topic,
    content: entry.content,
    metadata: entry.metadata,
    // ttl 可选：undefined 不下发（无损 JSON 约束），让工具落默认 3600
    ...(entry.ttl !== undefined ? { ttl: entry.ttl } : {}),
  })
}

export async function getBriefFromBoard(ctx: Context, topic: BoardTopic) {
  // 文档的 mode:'digest' 参数在 0.2.0-rc.2 不存在（过时第 6 例）——
  // 语义等价物为 titles_only：true = 标题+metadata 摘要模式（不含正文，避免上下文膨胀）
  return await callTool(ctx, 'board_list', {
    topic,
    titles_only: true,
  })
}
