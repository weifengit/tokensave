# Step 07：共享黑板封装

## 前置
Step 06 完成。

## 目标
实现 postToBoard / getBriefFromBoard，封装 dsh-call-session 的黑板工具。

## 只看这些
- docs/CONTRACTS.md（BoardTopic、BlackboardEntry）
- src/tools/blackboard-ops.ts

## 背景
`dsh-call-session` 提供以下黑板工具：
- `board_post`：发布黑板条目，用于公布大文本产物与共享状态，取得 postId
- `board_list`：按 ID、topic 或 digest 模式检索黑板记录，避免几十 KB
  大文本在会话间来回复制导致上下文爆炸
- `board_clear`：清理已完成或过期的条目

## 实现

### src/tools/blackboard-ops.ts
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
  return await ctx.tools.call('board_post', {
    topic: entry.topic,
    content: entry.content,
    metadata: entry.metadata,
    ttl: entry.ttl,
  })
}

export async function getBriefFromBoard(ctx: Context, topic: BoardTopic) {
  return await ctx.tools.call('board_list', {
    topic,
    mode: 'digest',  // 摘要模式，避免上下文膨胀
  })
}
```

## 黑板抽象层级

| 层级 | 内容类型 | 写入者 | 示例 |
|:---|:---|:---|:---|
| L0 | 原始数据 | DSH | 用户初始需求、文件片段 |
| L1 | 事实 | 探索者 | "项目使用 TypeScript 5.x" |
| L2 | 假设/坑点 | 探索者 | "方案 X 在此场景可能踩坑" |
| L3 | 最终方案 | 编排引擎 | 经过交叉验证的任务简报 |

DSH 执行时优先消费 L3 层简报。

## 不要做
- 不要改 parallel-explorer.ts
- 不要碰 client/
- 不要实现交叉验证（Step 10 做）

## 验收标准
- [ ] 临时测试：postToBoard 后 board_list 能查到
- [ ] metadata 完整（source、confidence、digest）
- [ ] 不同 topic 互不干扰
- [ ] 测试通过后删除临时测试文件

## 完成后
更新 PROGRESS.md：当前阶段改为 Step 08。