# Step 03：全局系统提示词注入

## 前置
Step 02 完成，插件能加载。

## 目标
让 DSH 主会话"知道"tokensave 的存在，在合适任务上主动调用。

## 只看这些
- docs/CONTRACTS.md（系统提示词段契约）
- src/prompt/system-prompt.ts
- src/index.ts（只在 apply 里加一行调用）

## 背景
DSH 主会话不会自动知道 tokensave。必须通过 `ctx.systemPrompt.section()`
向所有会话注入全局指令。`dsh-djy-xttsc` 证明了这条路可行：Host 半区
注册的是**全局**系统提示词段，对所有 scope 生效，包括子代理。

## 实现

### src/prompt/system-prompt.ts
```typescript
import type { Context } from '@deepseek-ai/cordis'

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
  })
}
```

### src/index.ts 的 apply
```typescript
import { registerSystemPrompt } from './prompt/system-prompt'

export function apply(ctx: Context) {
  console.log('[dsh-tokensave] plugin loaded!')
  registerSystemPrompt(ctx)
  // 其他 TODO 保留
}
```

## 关键设计点
- `order: 150` 确保提示词排在工具说明之前，模型在阅读工具定义之前
  就知道 tokensave 的存在
- `text` 明确列出"何时调用"和"何时不调用"的边界，避免 DSH 在简单
  任务上也调用 tokensave

## 不要做
- 不要碰 tools/、orchestration/、client/
- 不要注册工具
- 不要改 inject

## 验收标准
- [ ] 重启后，DSH 设置 → 系统提示词中能看到 tokensave-delegation 段
- [ ] 新建会话问"你能看到 tokensave 吗"，DSH 回答中提及该能力
- [ ] 无报错

## 完成后
更新 PROGRESS.md：当前阶段改为 Step 04。