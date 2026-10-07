# Step 04：场景自动识别

## 前置
Step 03 完成。

## 目标
实现 detectScenario，通过 session.header.cwd 自动判断任务类型。

## 只看这些
- docs/CONTRACTS.md（Scenario 类型、PROJECT_MARKERS、编辑关键词）
- src/scenario/detector.ts

## 背景
每个 DSH 会话在创建时，其 `cwd` 被冻结在不可变的 `SessionHeader` 中，
且必须是绝对路径。右侧栏文件树根固定取 `session.header.cwd`，该字段
**创建后不可变**（显式收养不同 cwd 的会话会抛 ApiSessionCwdConflict）。
持久但未 attach 的 session 不一定能被 `ctx.sessions.get()` 找到。

## 实现

### src/scenario/detector.ts
```typescript
import type { Context } from '@deepseek-ai/cordis'

export type Scenario = 'from_scratch' | 'edit_existing'

const PROJECT_MARKERS = [
  'package.json', 'Cargo.toml', 'pyproject.toml',
  'go.mod', 'pom.xml', 'build.gradle', '.git'
]

export async function detectScenario(
  ctx: Context, sessionId: string, userMessage: string
): Promise<{ scenario: Scenario; cwd: string | null }> {
  const session = await ctx.sessions.get(sessionId)
  const cwd = session?.header?.cwd ?? null

  if (!cwd) return { scenario: 'from_scratch', cwd: null }

  const entries = await ctx.tools.call('list_dir', { path: cwd })
  const hasProjectFiles = entries.some((e: any) =>
    PROJECT_MARKERS.includes(e.name)
  )
  if (!hasProjectFiles) return { scenario: 'from_scratch', cwd }

  const editKeywords = ['修改', '修复', '改一下', '优化', '重构', '更新', '替换', '删除']
  const hasEditIntent = editKeywords.some(k => userMessage.includes(k))

  return {
    scenario: hasEditIntent ? 'edit_existing' : 'from_scratch',
    cwd
  }
}
```

## 检测策略表

| 条件 | 判定 | 后续流程 |
|:---|:---|:---|
| cwd 未设置 | from_scratch | 跳过文件读取，直接并行探索 |
| cwd 有值，无项目标记 | from_scratch | 跳过文件读取，直接并行探索 |
| cwd 有值，有项目文件，无编辑意图 | from_scratch | 可选择性读取项目结构作为背景 |
| cwd 有值，有项目文件，有编辑意图 | edit_existing | 先精准读取代码片段，再并行探索 |

## 不要做
- 不要改其他文件
- 不要实现任何编排逻辑
- 不要碰 client/

## 验收标准
- [ ] 写一个临时测试：传入空 sessionId 返回 from_scratch
- [ ] 传入一个真实项目 sessionId + "修复登录bug" 返回 edit_existing
- [ ] 测试通过后删除临时测试文件

## 完成后
更新 PROGRESS.md：当前阶段改为 Step 05。