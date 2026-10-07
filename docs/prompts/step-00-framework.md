# Step 00：搭建框架

## 前置
无。这是第一步。

## 目标
建立完整目录骨架，所有文件只写接口签名和 TODO 注释，**不实现任何业务逻辑**。

## 只看这些
- docs/CONTRACTS.md（所有类型定义和函数签名）
- 本文件

## 要创建的文件

### 宿主端 src/

**src/index.ts**
```typescript
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-tokensave'

export const inject = {
  tools: true,
  systemPrompt: true,
  sessions: true,
  llm: true,
}

export function apply(ctx: Context) {
  // TODO: Step 03 registerSystemPrompt(ctx)
  // TODO: Step 05 ctx.tools.register(...)
}
```

**src/prompt/system-prompt.ts**
```typescript
import type { Context } from '@deepseek-ai/cordis'

export function registerSystemPrompt(ctx: Context) {
  // TODO: Step 03
}
```

**src/scenario/detector.ts**
```typescript
import type { Context } from '@deepseek-ai/cordis'

export type Scenario = 'from_scratch' | 'edit_existing'

export async function detectScenario(
  ctx: Context, sessionId: string, userMessage: string
): Promise<{ scenario: Scenario; cwd: string | null }> {
  // TODO: Step 04
  throw new Error('not implemented')
}
```

**src/tools/smart-delegator.ts**
```typescript
// TODO: Step 05 定义 tokensave_delegate 工具
// schema 严格按 CONTRACTS.md
```

**src/tools/blackboard-ops.ts**
```typescript
import type { Context } from '@deepseek-ai/cordis'

export type BoardTopic = 'requirement' | 'pitfall' | 'solution' | 'brief'

export interface BlackboardEntry {
  topic: BoardTopic
  content: string
  metadata: {
    source: string
    confidence: 'high' | 'medium' | 'low'
    digest: string
    explorerLabel?: string
  }
  ttl?: number
}

export async function postToBoard(ctx: Context, entry: BlackboardEntry) {
  // TODO: Step 07
}

export async function getBriefFromBoard(ctx: Context, topic: BoardTopic) {
  // TODO: Step 07
}
```

**src/orchestration/parallel-explorer.ts**
```typescript
import type { Context } from '@deepseek-ai/cordis'

export async function parallelExplore(
  ctx: Context, taskDescription: string,
  codeContext: string | null, explorerCount: number
): Promise<Array<{ sessionId: string; label: string }>> {
  // TODO: Step 06
  throw new Error('not implemented')
}
```

**src/orchestration/workflow.ts**
```typescript
import type { Context } from '@deepseek-ai/cordis'
import type { Scenario } from '../scenario/detector'

interface WorkflowParams {
  scenario: Scenario
  cwd: string | null
  taskDescription: string
  filePath?: string
  explorerCount: number
  sessionId: string
}

export async function executeWorkflow(ctx: Context, params: WorkflowParams) {
  // TODO: Step 10
  throw new Error('not implemented')
}
```

**src/routing/model-router.ts**
```typescript
// TODO: Step 08 读取 fallbacks 配置
```

**src/types.ts**
```typescript
// 把 CONTRACTS.md 的所有类型定义搬过来
// 与 CONTRACTS.md 保持完全一致
```

### 客户端 client/src/

**client/src/index.ts**
```typescript
import type { Context } from '@deepseek-ai/cordis'

export const inject = { slots: true }

export function apply(ctx: Context) {
  // TODO: Step 11 监听 tool/result 事件
}
```

**client/src/float/mount.tsx**
```tsx
import type { Context } from '@deepseek-ai/cordis'

interface ExplorerInfo { sessionId: string; label: string }

export function mountExplorerWindows(ctx: any, explorers: ExplorerInfo[]) {
  // TODO: Step 11
}
```

**client/src/components/ExplorerStream.tsx**
```tsx
import React from 'react'

interface Props {
  sessionId: string
  visible: boolean
  bossKey: string
}

export function ExplorerStream({ sessionId, visible, bossKey }: Props) {
  // TODO: Step 11
  return <div>TODO</div>
}
```

**client/src/components/BriefViewer.tsx**
```tsx
import React from 'react'

interface Props {
  brief: string
  explorerCount: number
}

export function BriefViewer({ brief, explorerCount }: Props) {
  // TODO: Step 11
  return <div>TODO</div>
}
```

## 不要做
- 不要实现任何业务逻辑
- 不要导入未声明的依赖
- 不要写 package.json 的 dsh 字段（Step 02 做）
- 不要注册工具（Step 05 做）

## 验收标准
- [ ] 所有文件存在
- [ ] `pnpm run check` 无语法错误
- [ ] 每个导出函数都有正确签名，函数体只有 TODO 注释或 `throw new Error('not implemented')`
- [ ] types.ts 与 CONTRACTS.md 完全一致

## 完成后
更新 PROGRESS.md：当前阶段改为 Step 01，已完成追加 Step 00 记录。
不要继续做 Step 01，等我的下一条指令。