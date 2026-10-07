# Step 06：并行探索调度

## 前置
Step 05 完成，dsh-call-session 已安装。

## 目标
实现 parallelExplore，并行创建多个免费模型会话并派发任务。

## 只看这些
- docs/CONTRACTS.md（EXPLORER_PRESETS、返回值类型）
- src/orchestration/parallel-explorer.ts

## 背景
`dsh-call-session` 提供：
- `session_create`：在当前工作区创建长期运行的同级会话，自动继承
  模型规格和预设
- `session_call`：1:1 单播调用，用于任务分发、进度报告、交接
- `session_query`：列出会话并检查活跃/空闲状态

## 实现

### src/orchestration/parallel-explorer.ts
```typescript
import type { Context } from '@deepseek-ai/cordis'

interface ExplorerConfig {
  model: string
  label: string
  focus: string
}

const EXPLORER_PRESETS: ExplorerConfig[] = [
  { model: 'deepseek-web/free', label: 'DeepSeek探索者', focus: '整体方案可行性' },
  { model: 'kimi-web/free',     label: 'Kimi探索者',     focus: '边界条件与异常处理' },
  { model: 'qwen-web/free',     label: 'Qwen探索者',     focus: '性能与实现复杂度' },
]

export async function parallelExplore(
  ctx: Context,
  taskDescription: string,
  codeContext: string | null,
  explorerCount: number
): Promise<Array<{ sessionId: string; label: string }>> {
  const presets = EXPLORER_PRESETS.slice(0, explorerCount)

  // 1. 并行创建探索者会话
  const explorers = await Promise.all(
    presets.map(p =>
      ctx.tools.call('session_create', {
        workspace: 'current',
        model: p.model,
        prompt: buildExplorerPrompt(p, taskDescription, codeContext),
      })
    )
  )

  // 2. 并行派发探索任务
  await Promise.allSettled(
    explorers.map((session: any, i: number) =>
      ctx.tools.call('session_call', {
        target: session.id,
        message: buildTaskMessage(presets[i], taskDescription, codeContext),
        mode: 'steer',
      })
    )
  )

  // 3. 返回探索者会话列表（供浮窗挂载使用）
  return explorers.map((s: any, i: number) => ({
    sessionId: s.id,
    label: presets[i].label,
  }))
}

function buildExplorerPrompt(
  config: ExplorerConfig, task: string, code: string | null
): string {
  return [
    `你是${config.label}，专注于「${config.focus}」。`,
    `请独立分析以下需求，不要参考其他探索者的结论。`,
    `发现坑点写入黑板（topic: 'pitfall'），推荐方案写入黑板（topic: 'solution'）。`,
    code ? `\n相关代码片段：\n${code}` : '',
    `\n任务需求：\n${task}`,
  ].join('\n')
}

function buildTaskMessage(
  config: ExplorerConfig, task: string, code: string | null
): string {
  return [
    `请开始你的探索。侧重点：${config.focus}`,
    `完成后把结论写入黑板。`,
  ].join('\n')
}
```

## 重要：DeepSeek 免费账号并发限制
同一 DeepSeek 免费账号同一时刻只允许一路流式请求。多个探索者必须
分属不同厂商或不同账号。EXPLORER_PRESETS 已按此约束配置。

## 不要做
- 不要读取黑板（Step 07 才做）
- 不要交叉验证（Step 10 才做）
- 不要碰客户端

## 验收标准
- [ ] 临时测试：调用 parallelExplore 后，session_query 能看到 3 个新会话
- [ ] 3 个会话分别使用不同 model
- [ ] 总耗时 < 最慢单个会话耗时的 1.5 倍（确认是并行）
- [ ] 测试通过后删除临时测试文件

## 完成后
更新 PROGRESS.md：当前阶段改为 Step 07。