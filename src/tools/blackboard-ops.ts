import type { Context } from '@deepseek-ai/cordis'
import { getBoardStore } from '../blackboard/store.ts'

// 2026-10-09 去 dsh-call-session 化：黑板读写由自建存储直调（原经 ctx.tools.execute
// 绕到第三方 board_post/board_list 工具）。语义与返回形状不变：
//   - postToBoard → store.post（TTL 默认 3600s；保留主题抛错）
//   - getBriefFromBoard → store.list({ topic, titlesOnly: true })，返回 { posts } 供 workflow 轮询
// 探索者/任意 agent 侧仍可用同名工具（src/blackboard/tools.ts 注册），与本直调共用同一存储。

export type BoardTopic = 'requirement' | 'pitfall' | 'solution' | 'brief'

export interface BlackboardEntry {
  topic: BoardTopic
  content: string
  metadata: {
    source: string
    confidence: 'high' | 'medium' | 'low'
    digest: string
    explorerLabel?: string
    /** 2026-10-11：条目标题列（中文）；缺省时 extractTitle 从正文首行提取 */
    title?: string
  }
  ttl?: number
  /** 2026-10-11：产出工作区（引擎帖按轮隔离：带 workspace 的帖只在该项目板可见，且可按轮归档） */
  workspace?: string
}

export interface BriefQueryOptions {
  /** 只看该工作区的帖（引擎帖带 workspace；探索者帖带 authorWorkspace；跨区帖仍可见） */
  workspace?: string
  /** true = 附带正文（评审引擎用；默认 false 摘要模式） */
  full?: boolean
}

export async function postToBoard(_ctx: Context, entry: BlackboardEntry): Promise<any> {
  // ttl 可选：undefined 不传（存储落默认 3600）
  return getBoardStore().post({
    topic: entry.topic,
    content: entry.content,
    metadata: entry.metadata,
    ...(entry.ttl !== undefined ? { ttl: entry.ttl } : {}),
    ...(entry.workspace !== undefined ? { authorWorkspace: entry.workspace } : {}),
  })
}

export async function getBriefFromBoard(
  _ctx: Context, topic: BoardTopic, opts: BriefQueryOptions = {}
): Promise<any> {
  // 默认摘要模式（titlesOnly，不含正文）；full=true 供评审引擎读正文。
  // workspace 传入时启用工作区收敛：全局帖（空 workspace）与本项目帖可见，
  // 别的项目探索者帖被隔离——评审不再跨项目考古。
  const res = getBoardStore().list({
    topic,
    titlesOnly: opts.full === true ? false : true,
    status: 'active',
    limit: 100,
    ...(opts.workspace ? { callerWorkspace: opts.workspace, crossWorkspace: false } : {}),
  })
  return {
    success: true,
    count: res.posts.length,
    scope: res.workspace || 'global',
    titlesOnly: res.titlesOnly,
    posts: res.posts,
  }
}
