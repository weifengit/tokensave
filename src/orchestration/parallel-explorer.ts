import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { readProjectScope, readExplorerSelection } from '../board-web-route.ts'
import type { ExplorerConfig } from '../types.ts'
import { EXPLORER_PRESETS } from '../types.ts'
import { selectionToConfigs, splitModel } from '../explorer-catalog.ts'
import { createExplorerSession } from '../session/create-explorer-session.ts'
import { beginRun, recordRunSessions } from '../blackboard/runs.ts'

// —— 探索者消息直投（官方 agents 服务）——
// createUserMessage({ content, source: { kind: 'user' } })（平台 dsh-acp / 官方
// sessionController.prompt 同款构造）+ agent.followup/steer 按状态投递。历史背景：
// 曾经的 dsh-call-session session_call 会构造 kind='plugin' 消息被 v4 格式校验拒绝
// （Step 11.1 绕过），去依赖后本路径已是唯一投递方式，与官方 prompt 语义一致。
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

/**
 * 解析探索者工作区：优先「当前打开的工作台项目」作用域，其次调用方会话 cwd。
 *
 * 原实现在调用方 agent 上套 Proxy 篡改 cwd 读取（因 session_create 无 cwd 参数）；
 * 官方 agents.create 的 meta.cwd 原生支持工作区指定，hack 已退役。
 */
function resolveExplorerCwd(agent?: Agent): string {
  const scope = readProjectScope()
  if (scope.workspace) {
    return scope.workspace
  }
  const callerCwd = (agent as any)?.session?.header?.cwd
  if (typeof callerCwd === 'string' && callerCwd) {
    return callerCwd
  }
  throw new Error('tokensave: 无法确定探索者工作区（无工作台项目作用域，调用方会话也无 cwd）')
}

/**
 * 已注册 provider 的 id 集合（探测失败/llm 未就绪返回 null = 无法判断，维持原行为）。
 *
 * 预设/用户选择里的 `provider/model` 来自第三方 provider 插件（our-free-model /
 * opencode-zen…）：插件没装或凭据未配时 provider 未注册，
 * session_create 会创建出死模型会话。这里用 llm.listProviders()（同步目录，
 * 与 explorer-settings 面板同一口径）在建会话前收敛，未注册的一律降级剔除。
 */
function liveProviderIds(ctx: Context): Set<string> | null {
  let llm: any
  try { llm = (ctx as any).llm ?? (ctx as any).get?.('llm') } catch { llm = undefined }
  try {
    const list = llm?.listProviders?.() ?? null
    if (!Array.isArray(list)) return null
    return new Set(list.map((p: any) => String(p?.id ?? '')).filter(Boolean))
  } catch {
    return null
  }
}
export async function parallelExplore(
  ctx: Context, taskDescription: string,
  codeContext: string | null, explorerCount: number, agent?: Agent,
  /** 发起本轮委派的主会话（记进轮次登记，供工作台按会话归属展示） */
  originSessionId?: string,
): Promise<Array<{ sessionId: string; label: string; model: string }>> { // model 供简报标注未发帖者
  // 探索者集合：用户若在「探索者设置」里存过选择，就**完全按选择跑**（自行控制）；
  // 从未配置时保持旧行为——内置预设按 explorer_count 截取。
  const saved = readExplorerSelection()
  const chosen: ExplorerConfig[] = saved && saved.length
    ? selectionToConfigs(saved)
    : EXPLORER_PRESETS.slice(0, explorerCount)
  // provider 探测降级（去第三方 provider 硬编码依赖）：预设/选择里的 provider 插件
  // 未装或凭据未配时，剔除对应项而不是创建死模型会话；全部不可用则明确报错。
  // llm 未就绪（探测返回 null）时不拦截，保持原行为。
  const live = liveProviderIds(ctx)
  let presets: ExplorerConfig[] = chosen
  if (live) {
    presets = chosen.filter((p) => live.has(splitModel(p.model)[0]))
    const dropped = chosen.filter((p) => !live.has(splitModel(p.model)[0]))
    if (dropped.length) {
      console.warn(
        `[dsh-tokensave] ${dropped.length} 个探索者因 provider 未注册被降级剔除: ` +
        `${dropped.map((p) => p.model).join(', ')}（请安装/配置对应 provider 插件或在探索者设置里重选）`
      )
    }
    if (!presets.length) {
      throw new Error(
        `tokensave: 所有选中探索者的 provider 均未注册（${chosen.map((p) => p.model).join(', ')}）——` +
        '请先在「探索者设置」里改选已注册 provider 的模型，或配置对应插件凭据。'
      )
    }
  }
  // 常规路径静默：provider 降级有上面 warn，集合构成变化不值得刷屏

  // 探索者工作区：优先当前打开的工作台项目，其次发起会话 cwd（官方 meta.cwd 直传）。
  const cwd = resolveExplorerCwd(agent)
  // 轮次隔离（BUG-1/优化-6）：开新一轮 = 归档上一轮 tokensave 帖 + 重置登记；
  // 建完探索者后登记本轮会话，/explorers 路由据此过滤 → 旧轮窗口 8s 内消失。
  // 把发起会话记进轮次登记：新会话不该看到上一轮的探索者/协作对话。
  const run = beginRun(cwd, originSessionId)
  // 轮次归档属常规内部维护，不刷屏（archived>0 也可从 runs 登记处追）
  // 1. 并行创建探索者会话——官方原语直建（agents.create + 预设装配 + 标题事件），
  //    见 src/session/create-explorer-session.ts；不再依赖 dsh-call-session 的 session_create。
  const created = await Promise.all(
    presets.map(async (p) => ({
      sessionId: await createExplorerSession(ctx, {
        cwd,
        title: `tokensave-${p.label}`,
        model: p.model,
      }),
    }))
  )

  recordRunSessions(cwd, created.map((s, i) => ({ sessionId: s.sessionId, label: presets[i].label, model: presets[i].model })))

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

  // 3. 返回探索者会话列表（供工作台窗口渲染）；带 model 供简报标注未发帖者
  return created.map((session, i) => ({
    sessionId: session.sessionId,
    label: presets[i].label,
    model: presets[i].model,
  }))
}

function buildExplorerPrompt(
  config: ExplorerConfig, task: string, code: string | null
): string {
  return [
    `你是${config.label}，专注于「${config.focus}」。`,
    `请独立分析以下需求，不要参考其他探索者的结论。`,
    `发现坑点写入黑板（topic: 'pitfall'），推荐方案写入黑板（topic: 'solution'）。`,
    `每次写黑板必须携带 metadata：{ title: 一句话标题, source: '${config.label}', confidence: 'high'|'medium'|'low', digest: 80 字内摘要 }——缺了这些交叉验证无法归属信源。`,
    `至少写 1 条 pitfall 和 1 条 solution；没有坑也要写明「未发现明显坑点」，沉默会被判为未参与。`,
    code ? `\n相关代码片段：\n${code}` : '',
    `\n任务需求：\n${task}`,
  ].join('\n')
}

function buildTaskMessage(
  config: ExplorerConfig, _task: string, _code: string | null
): string {
  return [
    `请开始你的探索。侧重点：${config.focus}`,
    `完成后把结论写入黑板（每条都带 metadata：title/source='${config.label}'/confidence/digest）。`,
  ].join('\n')
}
