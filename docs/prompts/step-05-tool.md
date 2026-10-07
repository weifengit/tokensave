# Step 05：核心工具注册

## 前置
Step 04 完成。

## 目标
注册 tokensave_delegate 工具，execute 内先只调 detectScenario。

## 只看这些
- docs/CONTRACTS.md（tokensave_delegate 完整 schema）
- src/index.ts
- src/tools/smart-delegator.ts
- src/scenario/detector.ts（只读，不改）

## 背景：工具注册契约
DSH 插件的工具注册有严格 API 契约：
- 在 apply 内使用 `ctx.tools.register(defineTool(...))`
- 通过 `inject: ['tools']` 让 Cordis 运行时等待工具注册表就绪
- `output` 是**必填**字段，必须包含 `schema` 和 `render`
- 每个对象 schema 必须显式设置 `additionalProperties`
- 所有经 ctx.tools.register() 注册的资源由所属 Fiber 跟踪，插件停用
  或热重载时自动逆向注销

## 实现

### src/tools/smart-delegator.ts
```typescript
import { defineTool } from '@deepseek-ai/dsh-tools'

export const tokensaveDelegateTool = defineTool({
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
    // Step 05 阶段：只调 detectScenario，返回占位 brief
    const { scenario } = await detectScenario(
      ctx, exec.sessionId, args.task_description
    )
    return {
      brief: `[占位] 场景=${scenario}，任务=${args.task_description}`,
      scenario,
    }
  },
})
```

### src/index.ts 的 apply
```typescript
import { tokensaveDelegateTool } from './tools/smart-delegator'

export function apply(ctx: Context) {
  console.log('[dsh-tokensave] plugin loaded!')
  registerSystemPrompt(ctx)
  ctx.tools.register(tokensaveDelegateTool)
}
```

**注意**：`execute` 内的 `ctx` 需要从外部闭包传入。如果 defineTool
不支持闭包，把 execute 改为工厂函数：`createTool(ctx)` 返回 defineTool
的结果。

## 不要做
- 不要实现 executeWorkflow（Step 10 才做）
- 不要碰 client/
- 不要改 parallel-explorer.ts 和 blackboard-ops.ts

## 验收标准
- [ ] 重启后 DSH 工具列表中能看到 tokensave_delegate
- [ ] 调用该工具能返回 `{ brief: "[占位]...", scenario: "..." }`
- [ ] 不报 schema 校验错误
- [ ] 切换不同工作目录的会话，scenario 返回值随 cwd 变化

## 完成后
更新 PROGRESS.md：当前阶段改为 Step 06。