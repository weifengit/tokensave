import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { readProjectScope, readExplorerSelection } from '../board-web-route.ts'
import type { ExplorerConfig } from '../types.ts'
import { EXPLORER_PRESETS } from '../types.ts'
import { selectionToConfigs } from '../explorer-catalog.ts'

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

// —— 探索者工作区强制跟随「当前打开的工作台项目」————————————
//
// session_create 没有 cwd 参数：它的工作区取自 exec.agent 的 session.header.cwd
// （call-session resolveCwd）。所以默认是「在哪个项目的会话里发起，探索者就落在哪个项目」。
// 用户要求改为**强制跟随当前打开的工作台项目**，于是在传给 session_create 的 agent 上
// 用 Proxy 只改写 cwd 读取路径——id/title/ctx/options/preset/requestHeader 等一律透传，
// 因此 session_create 的标题去重、配额、预设装配全部照常生效，只有工作区被替换。
function withProjectCwd<T extends object>(agent: T, cwd: string): T {
  return new Proxy(agent, {
    get(target, prop, receiver) {
      if (prop === 'session') {
        const sess = (target as any).session
        if (!sess) return sess
        return new Proxy(sess, {
          get(st, sp, sr) {
            if (sp === 'header') {
              const header = st.header
              if (!header) return { cwd }
              return new Proxy(header, {
                get(ht, hp, hr) { return hp === 'cwd' ? cwd : Reflect.get(ht, hp, hr) },
                has(ht, hp) { return hp === 'cwd' ? true : Reflect.has(ht, hp) }
              })
            }
            // 兑底：有些路径直接读 session.cwd
            if (sp === 'cwd') return cwd
            return Reflect.get(st, sp, sr)
          }
        })
      }
      return Reflect.get(target, prop, receiver)
    }
  })
}

export async function parallelExplore(
  ctx: Context, taskDescription: string,
  codeContext: string | null, explorerCount: number, agent?: Agent
): Promise<Array<{ sessionId: string; label: string }>> {
  // 探索者集合：用户若在「探索者设置」里存过选择，就**完全按选择跑**（自行控制）；
  // 从未配置时保持旧行为——内置预设按 explorer_count 截取。
  const saved = readExplorerSelection()
  const presets: ExplorerConfig[] = saved && saved.length
    ? selectionToConfigs(saved)
    : EXPLORER_PRESETS.slice(0, explorerCount)
  console.log(
    `[dsh-tokensave] 探索者集合(${saved ? '用户设置' : '内置默认'}): ${presets.map((p) => p.label).join(', ')}`
  )

  // 探索者强制跟随「当前打开的工作台项目」：把 cwd 注入传给 session_create 的 agent。
  // 无作用域（未发布/已清除）时保持原行为（跟随发起会话），不静默改到未知目录。
  const scope = readProjectScope()
  const scopedAgent = scope.workspace && agent ? withProjectCwd(agent, scope.workspace) : agent
  if (scope.workspace) {
    console.log(`[dsh-tokensave] 探索者工作区跟随当前工作台项目: ${scope.workspace}`)
  } else {
    console.log('[dsh-tokensave] 无工作台项目作用域，探索者工作区跟随发起会话')
  }

  // 1. 并行创建探索者会话（真实 schema：title/model，返回 sessionId；不带 initial_message——
  //    dsh-call-session 会用 kind='plugin' 构造初始消息被 v4 拒，消息改由步骤 2 合法直投）
  const created = await Promise.all(
    presets.map(async (p) => {
      const value = await callTool(ctx, 'session_create', {
        title: `tokensave-${p.label}`,
        model: p.model,
      }, scopedAgent) as SessionCreateValue
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
