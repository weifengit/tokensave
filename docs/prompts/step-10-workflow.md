# Step 10：工作流编排引擎（核心）

## 前置

Step 06-09 全部完成。

## 目标

实现完整的并行黑板编排流程，把所有子模块串起来。

## 只看这些

- docs/CONTRACTS.md
- src/orchestration/workflow.ts
- src/index.ts（把 execute 里的占位替换为真实调用）
- src/orchestration/parallel-explorer.ts（只读，不改）
- src/tools/blackboard-ops.ts（只读，不改）

## 实现

### src/orchestration/workflow.ts

```typescript
import type { Context } from '@deepseek-ai/cordis'
import type { Scenario } from '../scenario/detector'
import { parallelExplore } from './parallel-explorer'
import { postToBoard } from '../tools/blackboard-ops'

interface WorkflowParams {
  scenario: Scenario
  cwd: string | null
  taskDescription: string
  filePath?: string
  explorerCount: number
  sessionId: string
}

export async function executeWorkflow(ctx: Context, params: WorkflowParams) {
  const { scenario, taskDescription, filePath, explorerCount, sessionId } = params

  // ── 阶段 1：获取代码上下文（仅 edit_existing）──
  let codeContext: string | null = null
  if (scenario === 'edit_existing' && filePath) {
    codeContext = await ctx.tools.call('read', {
      path: filePath, range: 'relevant',
    })
    await postToBoard(ctx, {
      topic: 'requirement',
      content: codeContext,
      metadata: {
        source: sessionId, confidence: 'high',
        digest: `文件 ${filePath} 的相关代码片段`,
      },
    })
  }

  // ── 阶段 2：并行派发探索者（返回会话列表供浮窗使用）──
  const explorers = await parallelExplore(
    ctx, taskDescription, codeContext, explorerCount
  )

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

  return { brief: markedBrief, explorers }
}

async function crossValidate(ctx: Context, taskDescription: string): Promise<string> {
  const pitfalls = await ctx.tools.call('board_list', {
    topic: 'pitfall', mode: 'digest',
  })
  const solutions = await ctx.tools.call('board_list', {
    topic: 'solution', mode: 'digest',
  })

  const reviewer = await ctx.tools.call('session_create', {
    workspace: 'current',
    model: 'kimi-web/free',
    prompt: [
      '你是方案评审者。以下是多个探索者独立发现的坑点和推荐方案。',
      '请交叉验证，剔除已被证明不可行的方案，合并互补路径，',
      '输出一份精炼的任务简报。',
      `\n原始需求：${taskDescription}`,
      `\n坑点汇总：\n${JSON.stringify(pitfalls)}`,
      `\n方案汇总：\n${JSON.stringify(solutions)}`,
    ].join('\n'),
  })

  return await ctx.tools.call('session_call', {
    target: reviewer.id,
    message: '请输出最终任务简报。',
    mode: 'steer',
  })
}

function wrapBriefWithMarker(brief: string): string {
  return [
    '<!-- tokensave-brief:v1:start -->',
    brief,
    '<!-- tokensave-brief:v1:end -->',
  ].join('\n')
}
```

### src/index.ts 的 execute 替换

把 Step 05 的占位 execute 替换为：

```typescript
async execute(args, exec) {
  const { scenario, cwd } = await detectScenario(
    ctx, exec.sessionId, args.task_description
  )
  const result = await executeWorkflow(ctx, {
    scenario,
    cwd,
    taskDescription: args.task_description,
    filePath: args.file_path,
    explorerCount: args.explorer_count ?? 3,
    sessionId: exec.sessionId,
  })
  return { brief: result.brief, scenario }
}
```

**注意**：现在 executeWorkflow 返回了 explorers，但 Step 05 定义的
output schema 只有 brief 和 scenario。如果要让客户端浮窗拿到 explorers，
需要更新 output.schema 和 render。**这一步只加 explorers 到返回值，
但暂不更新 output schema**——Step 11 客户端会通过监听 tool/result
事件从原始返回值中读取 explorers，不依赖 schema。

## 不要做

- 不要改 parallel-explorer.ts 和 blackboard-ops.ts
- 不要碰客户端
- 不要更新 output schema（Step 11 处理）

## 验收标准

- [ ] 完整跑一次场景一：返回 brief 中含 tokensave-brief 标记
- [ ] 完整跑一次场景二：先读文件，再并行，再简报
- [ ] 黑板上出现 requirement / pitfall / solution / brief 四类条目
- [ ] LLM Calls 视图搜索 tokensave-brief 能找到注入内容

## 完成后

更新 PROGRESS.md：当前阶段改为 Step 11。
