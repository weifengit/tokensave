import type { Context } from '@deepseek-ai/cordis'
import type { Scenario } from '../scenario/detector'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { readFile } from 'node:fs/promises'
import { parallelExplore } from './parallel-explorer.ts'
import { postToBoard, getBriefFromBoard } from '../tools/blackboard-ops.ts'

interface WorkflowParams {
  scenario: Scenario
  cwd: string | null
  taskDescription: string
  filePath?: string
  explorerCount: number
  sessionId: string
  agent?: Agent   // 调用方 agent（tokensave_delegate 的 exec.agent），透传给探索者会话创建/派发
}

// 评审模型：doc 的 kimi-web/free 已不存在（过时第 8 例）→ 用已实测可用的免费 mimo
const REVIEWER_PROVIDER = 'our-free-model'
const REVIEWER_MODEL = 'mimo-v2.6-flash-free'
const EXPLORER_WAIT_MS = 240_000
// 探索者首轮是异步的，doc 未覆盖——有界等待其写入 pitfall/solution（工程补充，Step 10 实测 90s 不够故放宽到 240s）
const CODE_CONTEXT_MAX = 8000

export async function executeWorkflow(ctx: Context, params: WorkflowParams) {
  const { scenario, taskDescription, filePath, explorerCount, sessionId } = params

  // ── 阶段 1：获取代码上下文（仅 edit_existing）──
  // 文档的 ctx.tools.call('read', {range:'relevant'}) 已死（过时第 3 例）且 range 参数不存在；
  // 按 Step 04 先例用 node:fs 直读，超长截断充当 relevant 语义
  let codeContext: string | null = null
  if (scenario === 'edit_existing' && filePath) {
    codeContext = await readFile(filePath, 'utf8').catch(() => null)
    if (codeContext !== null && codeContext.length > CODE_CONTEXT_MAX) {
      codeContext = `${codeContext.slice(0, CODE_CONTEXT_MAX)}\n…（超长截断）`
    }
    if (codeContext !== null) {
      await postToBoard(ctx, {
        topic: 'requirement',
        content: codeContext,
        metadata: {
          source: sessionId, confidence: 'high',
          digest: `文件 ${filePath} 的相关代码片段`,
        },
      })
    }
  }

  // ── 阶段 2：并行派发探索者（返回会话列表供浮窗使用）──
  const explorers = await parallelExplore(ctx, taskDescription, codeContext, explorerCount, params.agent)

  // ── 阶段 3：交叉验证 ──
  const brief = await crossValidate(ctx, taskDescription)

  // ── 阶段 4：产出最终简报（含标记）──
  const markedBrief = wrapBriefWithMarker(brief)
  await postToBoard(ctx, {
    topic: 'brief',
    content: markedBrief,
    metadata: {
      source: 'tokensave-engine', confidence: 'high',
      digest: '经过多智能体交叉验证的任务简报',
    },
    ttl: 3600,
  })

  // explorers 保留在本函数返回值（doc 要求），但工具 execute 不得带出：
  // output.schema additionalProperties:false 且运行时校验规范值（过时第 8 例之二）
  return { brief: markedBrief, explorers }
}

async function crossValidate(ctx: Context, taskDescription: string): Promise<string> {
  // 有界等待探索者首轮产出（pitfall/solution 由探索者异步写入黑板）
  const { pitfalls, solutions } = await waitForExplorerPosts(ctx)

  const reviewerPrompt = [
    '你是方案评审者。以下是多个探索者独立发现的坑点和推荐方案。',
    '请交叉验证，剔除已被证明不可行的方案，合并互补路径，',
    '输出一份精炼的任务简报。',
    `\n原始需求：${taskDescription}`,
    `\n坑点汇总：\n${JSON.stringify(pitfalls)}`,
    `\n方案汇总：\n${JSON.stringify(solutions)}`,
  ].join('\n')

  // doc 用评审者会话产出简报，但 session_call 只返回投递确认、拿不到评审文本
  // （过时第 8 例）→ 直接调评审模型同步取文本（Step 08/09 已验证路径）
  try {
    return await reviewerCall(ctx, reviewerPrompt)
  } catch (e: any) {
    // 工程兑底：评审失败时用原始摘要拼简报，保证流程不中断
    return [
      `（评审模型不可用：${String(e?.message ?? e).slice(0, 120)}，以下为原始摘要）`,
      `原始需求：${taskDescription}`,
      `坑点汇总：${JSON.stringify(pitfalls)}`,
      `方案汇总：${JSON.stringify(solutions)}`,
    ].join('\n')
  }
}

async function waitForExplorerPosts(ctx: Context) {
  const deadline = Date.now() + EXPLORER_WAIT_MS
  let pitfalls: unknown = null
  let solutions: unknown = null
  while (Date.now() < deadline) {
    if (pitfalls === null) {
      const v: any = await getBriefFromBoard(ctx, 'pitfall').catch(() => null)
      if ((v?.posts?.length ?? 0) > 0) pitfalls = v
    }
    if (solutions === null) {
      const v: any = await getBriefFromBoard(ctx, 'solution').catch(() => null)
      if ((v?.posts?.length ?? 0) > 0) solutions = v
    }
    if (pitfalls !== null && solutions !== null) break
    await new Promise((r) => setTimeout(r, 3000))
  }
  if (pitfalls === null) pitfalls = await getBriefFromBoard(ctx, 'pitfall').catch(() => null)
  if (solutions === null) solutions = await getBriefFromBoard(ctx, 'solution').catch(() => null)
  return { pitfalls, solutions }
}

async function reviewerCall(ctx: Context, prompt: string): Promise<string> {
  let text = ''
  let failure: string | null = null
  for await (const chunk of ctx.llm.stream({
    provider: REVIEWER_PROVIDER,
    model: REVIEWER_MODEL,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    signal: AbortSignal.timeout(120_000),
  } as any)) {
    const ch = chunk as any
    if (ch?.type === 'text-delta') text += ch.text
    if (ch?.type === 'finish' && ch?.reason?.kind === 'error') {
      failure = `${ch.reason.failure?.code ?? 'ERR'}: ${ch.reason.failure?.message ?? ''}`
    }
  }
  if (failure !== null) throw new Error(failure)
  if (text.trim().length === 0) throw new Error('reviewer returned empty text')
  return text
}

function wrapBriefWithMarker(brief: string): string {
  return [
    '<!-- tokensave-brief:v1:start -->',
    brief,
    '<!-- tokensave-brief:v1:end -->',
  ].join('\n')
}
