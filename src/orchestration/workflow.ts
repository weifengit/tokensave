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

/** 未发帖探索者（简报置顶标注用；status 为会话即时状态的中文转写）。 */
interface SilentExplorer {
  sessionId: string
  label: string
  model: string
  status: string
}

// 评审模型：doc 的 kimi-web/free 已不存在（过时第 8 例）→ 用已实测可用的免费 mimo
const REVIEWER_PROVIDER = 'our-free-model'
const REVIEWER_MODEL = 'mimo-v2.6-flash-free'
// 等待全部探索者发帖的上限（BUG-3：旧实现「1 pitfall + 1 solution 即早退」，3 探索者
// 常只有 1 个发帖就进评审——现改为等全员到齐，全员已发即早退；实测有轮次要 21min，
// 探索者本身很慢，故上限放宽到 480s，超时者进简报标注而非静默缺失）。
const EXPLORER_WAIT_MS = 480_000
// 评审输入边界（优化-6：防 prompt 随板上条数/正文膨胀）：每主题最多取最近 N 帖、每帖正文截断。
const REVIEW_POSTS_PER_TOPIC = 12
const REVIEW_CONTENT_MAX = 1500
const CODE_CONTEXT_MAX = 8000

export async function executeWorkflow(ctx: Context, params: WorkflowParams) {
  const { scenario, taskDescription, filePath, explorerCount, sessionId } = params
  // 引擎帖的工作区标记（按轮隔离 + H 台板按项目收敛）；from_scratch 无项目目录 → 空=全局（旧行为）
  const workspace = params.cwd ?? ''

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
        ...(workspace ? { workspace } : {}),
      })
    }
  }

  // ── 阶段 2：并行派发探索者 ──
  // 最后一个参数是**发起会话**：轮次登记它，工作台才能只在该会话里展示本轮探索者
  // （否则新会话进入同一项目时仍看到上一轮的探索者窗口与协作对话）。
  const explorers = await parallelExplore(ctx, taskDescription, codeContext, explorerCount, params.agent, sessionId)

  // ── 阶段 3：交叉验证（等全员发帖 + 评审读正文）──
  const { text, silent } = await crossValidate(ctx, taskDescription, workspace, explorers)

  // ── 阶段 4：产出最终简报（含标记）──
  // 未发帖探索者置顶标注：结论未覆盖其视角（BUG-3：静默缺失 → 显式失败注记）
  const silentNote = silent.length > 0
    ? [
        '> ⚠️ 本轮未发帖探索者（其负责维度的结论未覆盖，请自行核实）：',
        ...silent.map((s) => `> - ${s.label}（${s.model}，${s.status}）`),
        '',
      ].join('\n')
    : ''
  const markedBrief = wrapBriefWithMarker(silentNote ? `${silentNote}\n${text}` : text)
  await postToBoard(ctx, {
    topic: 'brief',
    content: markedBrief,
    metadata: {
      source: 'tokensave-engine', confidence: 'high',
      digest: '经过多智能体交叉验证的任务简报',
      // 2026-10-11：标题列中文（此前缺省由 extractTitle 提取，首行是标记块 → 标题显示成 <!-- … -->）
      title: '任务简报',
      ...(silent.length > 0
        ? { silentExplorers: silent.map((s) => `${s.label}|${s.model}|${s.status}`) }
        : {}),
    },
    ttl: 3600,
    ...(workspace ? { workspace } : {}),
  })

  // explorers 保留在本函数返回值（doc 要求），但工具 execute 不得带出：
  // output.schema additionalProperties:false 且运行时校验规范值（过时第 8 例之二）
  return { brief: markedBrief, explorers }
}

/** 一帖的评审摘要行：标题 + 信源 + confidence + 截断正文（BUG-5：评审此前只见标题+元数据）。 */
function reviewerDigestLine(post: Record<string, any>): string {
  const meta = (post.metadata ?? {}) as Record<string, unknown>
  const conf = typeof meta.confidence === 'string' ? meta.confidence : '未知'
  const content = typeof post.content === 'string' ? post.content : ''
  const clipped = content.length > REVIEW_CONTENT_MAX
    ? `${content.slice(0, REVIEW_CONTENT_MAX)}\n…（正文截断）`
    : content
  return `### [${post.topic}] ${post.title}（${post.authorTitle || '未知信源'}，confidence: ${conf}）\n${clipped || '(无正文)'}`
}

/** 探索者会话的当前状态（简报标注用）。 */
function explorerStatus(ctx: Context, sessionId: string): string {
  try {
    const agents = (ctx as any)?.get?.('agents')
    const agent = agents?.get?.(sessionId)
    if (!agent) return '会话不可用'
    return agent.status === 'running' ? '仍在运行（超时未产出）' : '已结束但未写黑板'
  } catch {
    return '状态未知'
  }
}

async function crossValidate(
  ctx: Context,
  taskDescription: string,
  workspace: string,
  explorers: Array<{ sessionId: string; label: string; model: string }>
): Promise<{ text: string; silent: SilentExplorer[] }> {
  // 有界等待**全部**探索者写入 pitfall/solution（BUG-3：旧实现 1+1 即早退）
  const { pitfalls, solutions, posted } = await waitForExplorerPosts(
    ctx, workspace, explorers.map((e) => e.sessionId)
  )

  // 未发帖者：显式标注（三分：仍在跑 / 跑完没写 / 会话没了）
  const silent: SilentExplorer[] = explorers
    .filter((e) => !posted.has(e.sessionId))
    .map((e) => ({ sessionId: e.sessionId, label: e.label, model: e.model, status: explorerStatus(ctx, e.sessionId) }))

  const digest = (res: any): string =>
    ((res?.posts ?? []) as Array<Record<string, any>>)
      .slice(0, REVIEW_POSTS_PER_TOPIC)
      .map(reviewerDigestLine)
      .join('\n')

  const silentSection = silent.length > 0
    ? `\n⚠未发帖探索者（不得视为已验证）：${silent.map((s) => `${s.label}(${s.model},${s.status})`).join('、')}\n若简报涉及其负责维度，请注明结论未覆盖。`
    : ''

  const reviewerPrompt = [
    '你是方案评审者。以下是多个探索者独立发现的坑点和推荐方案（含各自正文）。',
    '请交叉验证，剔除已被证明不可行的方案，合并互补路径，',
    '输出一份精炼的任务简报。',
    `\n原始需求：${taskDescription}`,
    `\n坑点汇总（含正文）：\n${digest(pitfalls) || '(无)'}`,
    `\n方案汇总（含正文）：\n${digest(solutions) || '(无)'}`,
    silentSection,
  ].join('\n')

  // doc 用评审者会话产出简报，但 session_call 只返回投递确认、拿不到评审文本
  // （过时第 8 例）→ 直接调评审模型同步取文本（Step 08/09 已验证路径）
  try {
    return { text: await reviewerCall(ctx, reviewerPrompt), silent }
  } catch (e: any) {
    // 工程兑底：评审失败时用原始摘要拼简报，保证流程不中断
    return {
      text: [
        `（评审模型不可用：${String(e?.message ?? e).slice(0, 120)}，以下为原始摘要）`,
        `原始需求：${taskDescription}`,
        `坑点汇总：${digest(pitfalls) || '(无)'}`,
        `方案汇总：${digest(solutions) || '(无)'}`,
        silentSection,
      ].join('\n'),
      silent,
    }
  }
}

async function waitForExplorerPosts(
  ctx: Context,
  workspace: string,
  expectedIds: readonly string[]
): Promise<{ pitfalls: any; solutions: any; posted: Set<string> }> {
  const deadline = Date.now() + EXPLORER_WAIT_MS
  const posted = new Set<string>()
  // 轮询用摘要模式（便宜）；定稿时带正文拉一次（BUG-5）
  const pollOnce = async () => {
    const [p, s] = await Promise.all([
      getBriefFromBoard(ctx, 'pitfall', { workspace }).catch(() => null),
      getBriefFromBoard(ctx, 'solution', { workspace }).catch(() => null),
    ])
    for (const res of [p, s]) {
      for (const post of (res?.posts ?? []) as Array<Record<string, unknown>>) {
        posted.add(String(post.authorSessionId))
      }
    }
  }
  while (Date.now() < deadline) {
    await pollOnce()
    // 全员到齐即早退；expectedIds 为空（防御）时退回旧行为不空转
    if (expectedIds.length > 0 && expectedIds.every((id) => posted.has(id))) break
    await new Promise((r) => setTimeout(r, 3000))
  }
  // 定稿：带正文拉一次（评审要读正文；旧实现 titlesOnly 让评审只能考古标题）
  const [pitfalls, solutions] = await Promise.all([
    getBriefFromBoard(ctx, 'pitfall', { workspace, full: true }).catch(() => null),
    getBriefFromBoard(ctx, 'solution', { workspace, full: true }).catch(() => null),
  ])
  for (const res of [pitfalls, solutions]) {
    for (const post of (res?.posts ?? []) as Array<Record<string, unknown>>) {
      posted.add(String(post.authorSessionId))
    }
  }
  return { pitfalls, solutions, posted }
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
