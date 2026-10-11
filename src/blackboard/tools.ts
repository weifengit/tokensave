/**
 * tokensave 自建黑板工具层（2026-10-09 去 dsh-call-session 化）。
 *
 * 注册**与 dsh-call-session 完全同名**的三个工具：board_post / board_list / board_clear。
 * 同名是刻意的兼容设计：
 *   - 探索者提示词（buildExplorerPrompt：「发现坑点写入黑板 topic: 'pitfall'」）零改动；
 *   - src/tools/blackboard-ops.ts 的 ctx.tools.execute('board_post'/'board_list') 零改动；
 *   - 任何 agent（含主会话）看到的工具目录与原版一致。
 *
 * 参数/返回结构对齐 dsh-call-session@0.1.6（见其 index.mjs 注册处）：
 *   - board_post: topic(必填)/content(必填)/tags/ttl(默认3600,上限86400)/metadata
 *   - board_list: id/topic/topic_prefix/tag/active_only(默认true)/cross_workspace(默认false)/
 *                 titles_only(默认true)/limit(默认20,上限100)
 *   - board_clear: id/topic/mode(dismiss|purge, 默认 dismiss)
 *
 * 调用方上下文（exec.agent）解析：authorSessionId = agent.id、
 * authorWorkspace = session.header.cwd（规范化后参与工作区隔离）。
 * tokensave 内部调用（blackboard-ops 不带 agent）→ authorWorkspace 空 = global 全可见，
 * 与原版语义一致。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { getBoardStore, normalizeWorkspace, extractTitle } from './store.ts'

/** 从调用方 agent 解析作者上下文（对齐原 resolveCallerContext 的最小口径）。 */
function resolveCaller(exec: any): { authorSessionId: string; authorTitle: string; callerWorkspace: string } {
  const agent = exec?.agent
  const authorSessionId = agent?.id ?? agent?.session?.id ?? 'unknown-session'
  const authorTitle = agent?.session?.title ?? agent?.title ?? 'Session'
  const callerWorkspace = normalizeWorkspace(agent?.session?.header?.cwd ?? agent?.session?.cwd ?? '')
  return { authorSessionId, authorTitle, callerWorkspace }
}

/**
 * 发帖 metadata 兜底补全（BUG-4：测试报告里 4 个模型仅 MiMo 完整带 metadata——
 * 提示词要求 ≠ 各家遵守，服务端统一补默认值，交叉验证永远可归属信源）：
 * title ← 正文首行；source ← 会话标题；confidence ← medium；digest ← 首行截 80 字。
 */
function normalizePostMetadata(raw: unknown, authorTitle: string, content: string): Record<string, unknown> {
  const meta: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {}
  if (typeof meta.title !== 'string' || !meta.title.trim()) meta.title = extractTitle({ content })
  if (typeof meta.source !== 'string' || !String(meta.source).trim()) meta.source = authorTitle || '未知信源'
  if (meta.confidence !== 'high' && meta.confidence !== 'medium' && meta.confidence !== 'low') meta.confidence = 'medium'
  if (typeof meta.digest !== 'string' || !meta.digest.trim()) {
    const firstLine = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] ?? ''
    meta.digest = firstLine.slice(0, 80)
  }
  return meta
}

// —— board_post ——

export function createBoardPostTool(_ctx: Context) {
  return defineTool({
    name: 'board_post',
    description: '向共享黑板发布一条条目（跨会话可读写，供多智能体协作沉淀结论）。'
      + '条目按主题（topic）分区，如 pitfall（坑点）、solution（方案）、requirement（需求）、brief（简报）；'
      + '默认 1 小时后过期，可用 ttl（秒）调整。',
    parameters: {
      topic: {
        type: 'string',
        required: true,
        description: '主题分区（如 pitfall / solution / requirement / brief）；telemetry:/call:/sys: 前缀为保留主题',
      },
      content: {
        type: 'string',
        required: true,
        description: '条目正文（支持多行文本 / Markdown）',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '可选标签数组（用于后续按 tag 过滤）',
      },
      ttl: {
        type: 'integer',
        description: '生存时间（秒）：默认 3600，上限 86400；过期后条目自动转为 expired',
      },
      metadata: {
        type: 'object',
        additionalProperties: true,
        description: '可选附加元数据（如 { source, confidence, digest, title }）；title 会作为条目摘要标题展示',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          postId: { type: 'string' },
          topic: { type: 'string' },
          authorSessionId: { type: 'string' },
          createdAt: { type: 'string' },
          expiresAt: { type: 'string' },
          scope: { type: 'string' },
          error: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.success
          ? `已发布黑板条目 ${value.postId}（主题 ${value.topic}，${value.expiresAt} 过期）`
          : `黑板发布失败：${value.error}`,
      }],
    },
    async execute(args, exec) {
      const store = getBoardStore()
      const { authorSessionId, authorTitle, callerWorkspace } = resolveCaller(exec)
      try {
        const post = store.post({
          topic: String(args.topic),
          content: String(args.content),
          tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
          ttl: typeof args.ttl === 'number' ? args.ttl : undefined,
          metadata: normalizePostMetadata(args.metadata, authorTitle, String(args.content)),
          authorSessionId,
          authorTitle,
          authorWorkspace: callerWorkspace,
        })
        return {
          success: true,
          postId: post.id,
          topic: post.topic,
          authorSessionId: post.authorSessionId,
          createdAt: post.createdAt,
          expiresAt: post.expiresAt,
          scope: post.scope,
        }
      } catch (error: any) {
        return {
          success: false,
          error: String(error?.message ?? error),
          postId: '',
          topic: String(args.topic ?? ''),
          authorSessionId,
          createdAt: '',
          expiresAt: '',
          scope: '',
        }
      }
    },
  })
}

// —— board_list ——

export function createBoardListTool(_ctx: Context) {
  return defineTool({
    name: 'board_list',
    description: '查询共享黑板条目：默认列出当前工作区的活跃条目（titles_only=true 时仅摘要不含正文）。'
      + '支持按 id / topic（前缀匹配）/ topic_prefix / tag 过滤，active_only=false 含已归档与已过期。',
    parameters: {
      id: {
        type: 'string',
        description: '按条目 id 精确查询（给出时默认返回全文）',
      },
      topic: {
        type: 'string',
        description: '按主题过滤（精确匹配或前缀匹配，如 pitfall / solution）',
      },
      topic_prefix: {
        type: 'string',
        description: '按主题前缀过滤（小写比较）',
      },
      tag: {
        type: 'string',
        description: '按标签过滤（不区分大小写）',
      },
      active_only: {
        type: 'boolean',
        description: 'true（默认）只看活跃条目；false 含已归档/已过期',
      },
      cross_workspace: {
        type: 'boolean',
        description: 'false（默认）仅当前工作区 + 全局条目；true 跨工作区全部可见',
      },
      titles_only: {
        type: 'boolean',
        description: 'true（默认，按 id 查时默认 false）只返回摘要（标题+元数据），不含正文',
      },
      limit: {
        type: 'integer',
        description: '返回条数：默认 20，上限 100（按新→旧排序）',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          count: { type: 'number' },
          scope: { type: 'string' },
          titlesOnly: { type: 'boolean' },
          posts: { type: 'array', items: { type: 'object', additionalProperties: true } },
          error: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify(value, null, 2),
      }],
    },
    async execute(args, exec) {
      const store = getBoardStore()
      const { callerWorkspace } = resolveCaller(exec)
      const isCrossWs = args.cross_workspace === true
      try {
        const res = store.list({
          id: args.id ? String(args.id) : undefined,
          topic: args.topic ? String(args.topic) : undefined,
          topicPrefix: args.topic_prefix ? String(args.topic_prefix) : undefined,
          tag: args.tag ? String(args.tag) : undefined,
          status: args.active_only === false ? 'all' : 'active',
          callerWorkspace: isCrossWs ? undefined : callerWorkspace,
          crossWorkspace: isCrossWs,
          titlesOnly: args.titles_only !== undefined ? Boolean(args.titles_only) : undefined,
          limit: typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 100) : 20,
        })
        return {
          success: true,
          count: res.posts.length,
          scope: isCrossWs ? 'global' : (res.workspace || callerWorkspace || 'unknown'),
          titlesOnly: res.titlesOnly,
          // 存储侧为 Record<string, unknown>（条目字段开放）；输出 schema 推断为 JsonValue，此处断言过界
          posts: res.posts as any,
        }
      } catch (error: any) {
        return {
          success: false,
          count: 0,
          scope: isCrossWs ? 'global' : (callerWorkspace || 'unknown'),
          titlesOnly: args.titles_only !== undefined ? Boolean(args.titles_only) : true,
          posts: [],
          error: String(error?.message ?? error),
        }
      }
    },
  })
}

// —— board_clear ——

export function createBoardClearTool(_ctx: Context) {
  return defineTool({
    name: 'board_clear',
    description: '清理共享黑板条目：按 id 或 topic 定位活跃条目，mode=dismiss 归档（仍可查）、mode=purge 彻底删除。',
    parameters: {
      id: {
        type: 'string',
        description: '要清理的条目 id',
      },
      topic: {
        type: 'string',
        description: '要清理的主题（精确或前缀匹配该主题下全部活跃条目）',
      },
      mode: {
        type: 'string',
        description: 'dismiss（默认，归档）或 purge（彻底删除）',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          clearedCount: { type: 'number' },
          action: { type: 'string' },
          error: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.success
          ? `已${value.action === 'purge' ? '删除' : '归档'} ${value.clearedCount} 条黑板条目`
          : `黑板清理失败：${value.error}`,
      }],
    },
    async execute(args) {
      const store = getBoardStore()
      try {
        const action = args.mode === 'purge' ? 'purge' : 'archive'
        const res = store.clear({
          id: args.id ? String(args.id) : undefined,
          topic: args.topic ? String(args.topic) : undefined,
          action,
        })
        return { success: true, clearedCount: res.clearedCount, action: res.action }
      } catch (error: any) {
        return { success: false, clearedCount: 0, action: String(args.mode ?? 'dismiss'), error: String(error?.message ?? error) }
      }
    },
  })
}

// —— 注册（幂等：重载时旧注册随 fiber 卸载，无需额外清理）——

export interface BlackboardToolRegistration {
  ok: number
  errors: string[]
}

export function registerBlackboardTools(ctx: Context): BlackboardToolRegistration {
  // 逐个兕错：若 dsh-call-session 尚未卸载，同名工具注册可能被拒——
  // 单个失败只降级该工具，不拖垮 tokensave 整体（其自家工具 tokensave_delegate 不受影响）。
  const tools = [
    ['board_post', createBoardPostTool(ctx)],
    ['board_list', createBoardListTool(ctx)],
    ['board_clear', createBoardClearTool(ctx)],
  ] as const
  let ok = 0
  const errors: string[] = []
  for (const [name, tool] of tools) {
    try {
      ctx.tools.register(tool)
      ok++
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      errors.push(`${name}: ${msg}`)
      console.warn(`[dsh-tokensave] 黑板工具 ${name} 注册失败（若 dsh-call-session 仍安装，卸载后重启即可由本插件接管）:`, error)
    }
  }
  if (ok > 0) console.log(`[dsh-tokensave] 黑板工具已注册 ${ok}/3: board_post / board_list / board_clear（自建存储）`)
  return { ok, errors }
}
