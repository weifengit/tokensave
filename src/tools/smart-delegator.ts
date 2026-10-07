import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { detectScenario } from '../scenario/detector.ts'
import { executeWorkflow } from '../orchestration/workflow.ts'

// 工厂函数形态：execute 需要闭包外的 ctx（step-05 注意事项第二种方案）
export function createTokensaveDelegateTool(ctx: Context) {
  return defineTool({
    name: 'tokensave_delegate',
    description: 'Token 节省任务委派器：自动识别当前工作目录场景，'
      + '并行派发免费模型探索者，通过共享黑板沉淀探索结果，'
      + '最终将精炼后的任务简报返回给 DSH 执行',
    parameters: {
      task_description: {
        type: 'string',
        required: true,
        description: '任务描述（用户的需求说明）',
      },
      file_path: {
        type: 'string',
        description: '可选，目标文件路径。不填则根据 cwd 自动识别',
      },
      explorer_count: {
        type: 'number',
        description: '并行探索者数量，默认 3',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          brief: { type: 'string', required: true },
          scenario: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.brief }],
    },
    async execute(args, exec) {
      // 文档的 exec.sessionId 在 0.2.0-rc.2 不存在；正道是 exec.agent.session.id
      const sessionId = exec.agent?.session.id ?? ''
      const { scenario, cwd } = await detectScenario(ctx, sessionId, args.task_description)
      const result = await executeWorkflow(ctx, {
        scenario,
        cwd,
        taskDescription: args.task_description,
        filePath: args.file_path,
        explorerCount: args.explorer_count ?? 3,
        sessionId,
        agent: exec.agent,
      })
      // 仅返 schema 双字段：additionalProperties:false 运行时校验规范值，
      // explorers 无法带出（见 workflow.ts 注释，Step 11 另行获取通道）
      return { brief: result.brief, scenario }
    },
  })
}
