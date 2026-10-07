import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ExplorerConfig } from '../types.ts'
import { EXPLORER_PRESETS } from '../types.ts'

// 进程内 callSeq 保证 callId 唯一（registry 以 callId 关联一次执行）
let callSeq = 0
function nextCallId(tag: string): ToolCallId {
  return brandString<ToolCallId>(`tokensave-${tag}-${++callSeq}-${Date.now().toString(36)}`)
}

// 0.2.0-rc.2 无 ctx.tools.call（文档 API 过时第 3 例）——统一走 ctx.tools.execute，
// 规范值在 result.value（KB cordis-tutorial/07 模式）
async function callTool(ctx: Context, name: string, args: Record<string, unknown>, agent?: Agent) {
  const result = await ctx.tools.execute({
    callId: nextCallId(name),
    name,
    arguments: args,
    // 透传调用方 agent：dsh-call-session 的 preset/driver 接线读 exec?.agent（缺省 peer 轮次不启动）
    ...(agent ? { agent } : {}),
    signal: new AbortController().signal,
  })
  if (result.isError) {
    throw new Error(`tokensave: tool ${name} failed: ${JSON.stringify(result.error).slice(0, 300)}`)
  }
  return result.value as unknown
}

interface SessionCreateValue {
  success?: boolean
  sessionId?: string
  error?: string | null
}

// —— 宿主侧直投（Step 11.1，经用户决策的绕过方案）——
// dsh-call-session 构造的消息 source.kind='plugin' 会被 0.2.0-rc.2 的 v4 格式校验拒绝
// （"format v4 message requires a producer-owned source kind"，见 PROGRESS 已知问题），
// 探索者消息改为：createUserMessage({ content, source: { kind: 'user' } })（平台 dsh-acp
// 同款构造）+ agent.followup/steer 直投（镜像其 dispatchNativeMessage 语义）。
interface ExplorerAgentHandle {
  status: string
  followup(message: unknown): void
  steer(message: unknown): void
}

function explorerAgentOf(ctx: Context, sessionId: string): ExplorerAgentHandle {
  // ctx.get 走 registry 免 inject 通道（与 dsh-call-session resolveAgentsService 同法）
  const registry = (ctx as unknown as { get?: (name: string) => unknown }).get
  const agents = registry?.('agents') as { get?(id: string): unknown } | undefined
  const agent = agents?.get?.(sessionId) as ExplorerAgentHandle | undefined
  if (!agent || typeof agent.followup !== 'function') {
    throw new Error(`tokensave: explorer agent ${sessionId} 未在线，无法直投消息`)
  }
  return agent
}

/**构造 v4 合法 user 消息并按运行状态投递：running→steer，否则 followup。 */
function dispatchExplorerMessage(ctx: Context, sessionId: string, text: string): void {
  const agent = explorerAgentOf(ctx, sessionId)
  const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  if (agent.status === 'running') agent.steer(message)
  else agent.followup(message)
}

export async function parallelExplore(
  ctx: Context, taskDescription: string,
  codeContext: string | null, explorerCount: number, agent?: Agent
): Promise<Array<{ sessionId: string; label: string }>> {
  const presets = EXPLORER_PRESETS.slice(0, explorerCount)

  // 1. 并行创建探索者会话（真实 schema：title/model，返回 sessionId；不带 initial_message——
  //    dsh-call-session 会用 kind='plugin' 构造初始消息被 v4 拒，消息改由步骤 2 合法直投）
  const created = await Promise.all(
    presets.map(async (p) => {
      const value = await callTool(ctx, 'session_create', {
        title: `tokensave-${p.label}`,
        model: p.model,
      }, agent) as SessionCreateValue
      if (!value?.success || !value.sessionId) {
        throw new Error(`tokensave: session_create(${p.label}) failed: ${value?.error ?? 'unknown error'}`)
      }
      return { sessionId: value.sessionId }
    })
  )

  // 2. 宿主直投合法消息（Step 11.1 绕过）：首条探索提示 followup 唤醒首轮；
  //    次条开始指令按状态 steer/followup（镜像原 session_call dispatchNativeMessage 语义）。
  //    失败直接抛出——原 Promise.allSettled 静默吞掉投递错误正是 Step 10 死会话未被发现的原因之一。
  await Promise.all(
    created.map((session, i) => {
      const preset = presets[i]
      dispatchExplorerMessage(ctx, session.sessionId, buildExplorerPrompt(preset, taskDescription, codeContext))
      dispatchExplorerMessage(ctx, session.sessionId, buildTaskMessage(preset, taskDescription, codeContext))
    })
  )

  // 3. 返回探索者会话列表（供浮窗挂载使用）
  return created.map((session, i) => ({
    sessionId: session.sessionId,
    label: presets[i].label,
  }))
}

function buildExplorerPrompt(
  config: ExplorerConfig, task: string, code: string | null
): string {
  return [
    `你是${config.label}，专注于「${config.focus}」。`,
    `请独立分析以下需求，不要参考其他探索者的结论。`,
    `发现坑点写入黑板（topic: 'pitfall'），推荐方案写入黑板（topic: 'solution'）。`,
    code ? `\n相关代码片段：\n${code}` : '',
    `\n任务需求：\n${task}`,
  ].join('\n')
}

function buildTaskMessage(
  config: ExplorerConfig, _task: string, _code: string | null
): string {
  return [
    `请开始你的探索。侧重点：${config.focus}`,
    `完成后把结论写入黑板。`,
  ].join('\n')
}
