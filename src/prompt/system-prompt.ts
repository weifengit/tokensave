import type { Context } from '@deepseek-ai/cordis'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'

export function registerSystemPrompt(ctx: Context) {
  ctx.systemPrompt.section({
    name: 'tokensave-delegation',
    order: 150,  // 排在工具说明之前
    text: [
      '## Token 节省能力（tokensave）',
      '',
      '你拥有一个名为 tokensave 的 token 节省能力。',
      '当用户要求以下类型任务时，优先调用 `tokensave_delegate` 工具：',
      '- 方案探索、需求分析、技术选型讨论',
      '- 代码修改分析、bug 修复方案设计',
      '- 新项目初始化、新功能开发规划',
      '',
      '调用方式：将用户的需求描述作为 task_description 参数传入。',
      'tokensave 会自动完成：并行派发免费模型探索者 → 黑板沉淀 →',
      '交叉验证 → 返回精炼后的任务简报，你根据简报执行文件操作。',
      '',
      '注意：当用户明确要求"直接做""快速改"时，不要调用 tokensave，',
      '直接执行即可。只有需要探索和设计时才调用。',
    ].join('\n')
  } satisfies PromptSection)

  // 任务清单的实时维护纪律（用户反馈：清单一直卡在「1 进行中 · 7 待处理」，
  // 跑完全程也不更新）。实测该会话 todo_write 只在 turn 开头被调用过 1 次，
  // 之后 400+ 步、几十次工具调用直到 reply 都没再更新 —— 面板如实渲染模型
  // 最后写入的那份初稿，所以进度停在第一步。todo_write 是整表替换，
  // 没有增量更新，因此必须靠「每完成一步就重发整表」才能让进度真实。
  ctx.systemPrompt.section({
    name: 'tokensave-todo-discipline',
    order: 160,  // 紧跟 tokensave 能力说明之后
    text: [
      '## 任务清单（todo_write）维护纪律',
      '',
      '任务清单是给用户看的**实时进度**，不是轮次结束时才补的收尾记录。',
      '- 每完成一项，立刻调用 `todo_write` 更新：把该条标为 `completed`，把下一条标为 `in_progress`。',
      '- 不要等到整轮跑完才一次性更新；中途每完成一步就更新一次。',
      '- `todo_write` 是**整表替换**：每次调用必须重发完整清单，不能只发改动的那一条。',
      '- 全部完成时，把所有条目都标为 `completed` 再结束这一轮（否则清单会一直停在旧计数）。',
      '',
      '若不遵守，用户看到的清单会永远停在最初那一步，与实际进度脱节。',
    ].join('\n')
  } satisfies PromptSection)
}
