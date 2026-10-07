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
}
