/**
 * tokensave 自建共享黑板存储（2026-10-09 去 dsh-call-session 化，黑板自集成）。
 *
 * 背景：boardStore/board_post/board_list 原由第三方插件 dsh-call-session 提供，
 * 是 tokensave 对它的最后硬依赖。本模块以**同语义、同工具名**自建：
 *   - 存储：`~/.dsh/tokensave/board.json`（与 projects.json / explorers.json 同落库约定），
 *     内存 Map + 每次变更原子落盘（tmp + rename），进程内单例；
 *   - 语义对齐 dsh-call-session@0.1.6 board-store：TTL 默认 3600s 上限 86400s、
 *     惰性过期（active→expired）、工作区隔离（authorWorkspace 不匹配即过滤，
 *     空 authorWorkspace = global 全可见）、topic 精确或前缀匹配、倒序 + limit、
 *     titlesOnly 摘要映射（title + metadata，无正文）、容量 FIFO（300 条）、
 *     保留主题拦截（telemetry:/call:/sys: 前缀）；
 *   - 保留主题拦截沿用原语义：这些前缀属于遥测/调用轨迹数据域，禁止落公共黑板。
 *
 * 消费方（全部零改动）：
 *   - src/tools/blackboard-ops.ts —— 直调本存储（原经 ctx.tools.execute 绕一圈）
 *   - src/board-web-route.ts —— H 台共享黑板路由直读本存储
 *   - src/blackboard/tools.ts —— 注册同名工具给探索者/任意 agent 调用
 */
import fs from 'node:fs'
import path from 'node:path'

// —— DSH 主目录与工作区规范化（与 board-web-route / projects 注册表同约定）——

/** DSH 主目录（与 dsh-remote-mobile 的 ~/.dsh/<plugin> 落库约定一致）。 */
export function dshHomeDir(): string {
  const fromEnv = process.env.DSH_HOME || process.env.DSH_HOME_DIR
  if (fromEnv) return fromEnv
  return path.join(process.env.HOME || process.cwd(), '.dsh')
}

/** 工作区路径规范化：统一正斜杠、盘符小写、去尾斜杠（与原 board-store 规则一致）。 */
export function normalizeWorkspace(rawPath?: string | null): string {
  if (!rawPath || typeof rawPath !== 'string') return ''
  let p = rawPath.trim()
  p = p.replace(/\\+/g, '/')
  p = p.replace(/^([a-zA-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`)
  p = p.replace(/\/+$/, '')
  return p
}

// —— 保留主题（沿用原 ADR-0012 语义：遥测/调用轨迹数据域不得落公共黑板）——

const RESERVED_TOPIC_PREFIXES = ['telemetry:', 'call:', 'sys:']

export function isReservedTopic(topic?: string | null): boolean {
  if (!topic || typeof topic !== 'string') return false
  const t = topic.trim().toLowerCase()
  for (const prefix of RESERVED_TOPIC_PREFIXES) if (t.startsWith(prefix)) return true
  return t === 'telemetry' || t === 'call' || t === 'sys'
}

export function reservedTopicMessage(topic: string): string {
  return `[保留主题] 主题 "${topic}" 属遥测/调用轨迹数据域（telemetry:/call:/sys: 前缀），不能写入公共黑板。`
}

// —— 条目模型（字段与原 BoardPost 对齐，多 workspace 为 authorWorkspace 别名）——

export type BoardPostStatus = 'active' | 'archived' | 'expired' | 'dismissed'

export interface BoardPost {
  id: string
  topic: string
  content: string
  tags: string[]
  metadata: Record<string, unknown>
  authorSessionId: string
  authorTitle: string
  authorWorkspace: string
  createdAt: string
  createdAtMs: number
  expiresAt: string
  expiresAtMs: number
  status: BoardPostStatus
  scope: string
}

export interface BoardListOptions {
  id?: string
  topic?: string
  topicPrefix?: string
  tag?: string
  status?: BoardPostStatus | 'all'
  limit?: number
  callerWorkspace?: string
  crossWorkspace?: boolean
  titlesOnly?: boolean
}

export interface BoardListResult {
  total: number
  returned: number
  workspace: string
  crossWorkspace: boolean
  titlesOnly: boolean
  posts: Array<Record<string, unknown>>
}

/** TTL 与容量常量（TTL 对齐原默认 3600s / 上限 86400s；容量 300 条 FIFO）。 */
const DEFAULT_TTL_SEC = 3600
const MAX_TTL_SEC = 86400
const MAX_POSTS = 300

/** 剥掉 markdown 强调/行内代码记号（黑板标题列是纯文本观测面，不渲染 markdown）。 */
function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
}

/**
 * 从条目提取人类可读标题：
 * metadata.title → 正文首个非空且非 <!-- 注释行 → 兑底文案。
 * 2026-10-11 两处修正（用户反馈）：
 *   ① 跳过 <!-- 标记行——简报正文被 tokensave-brief 标记包表，此前标题列直接显示
 *     `<!-- tokensave-brief:v1:start -->`；
 *   ② 剥 markdown 强调记号——探索者写的 `**加粗**` 首行此前原样进标题列。
 * 提取发生在读取时，存量条目即时受益，无需迁移。
 */
export function extractTitle(post: { metadata?: Record<string, unknown>; content?: string }): string {
  const explicit = typeof post?.metadata?.title === 'string' ? (post.metadata.title as string).trim() : ''
  if (explicit) return stripMarkdownEmphasis(explicit)
  if (typeof post?.content === 'string' && post.content.trim()) {
    // 跳过 <!-- … --> 行：简报正文两端包着 tokensave-brief 标记，标记行不能当标题
    const lines = post.content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('<!--'))
    if (lines.length > 0) {
      let first = lines[0]
      first = first.replace(/^#+\s*/, '').replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').trim()
      first = stripMarkdownEmphasis(first)
      if (first) return first.slice(0, 60)
    }
  }
  return '(无标题内容)'
}

/** 条目落盘记录的构造参数（工具层/内部调用共用）。 */
export interface BoardPostInput {
  topic: string
  content: string
  tags?: string[]
  metadata?: Record<string, unknown>
  ttl?: number
  authorSessionId?: string
  authorTitle?: string
  authorWorkspace?: string
}

export class TokensaveBoardStore {
  private posts = new Map<string, BoardPost>()
  private loaded = false

  private readonly filePath: string

  // 注意：不用构造器参数属性（`constructor(private readonly x)`）——
  // dsh 宿主加载器是 Node strip-only TS（不可擦除语法直接导入失败，
  // 报 "TypeScript parameter property is not supported in strip-only mode"，
  // esbuild/tsc 却能过）。显式字段声明在两种模式下都合法。
  constructor(filePath: string) {
    this.filePath = filePath
  }

  /** 惰性加载：首次访问时读盘；文件缺失/损坏均从空板起步（损坏文件改名留档）。 */
  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      if (!fs.existsSync(this.filePath)) return
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const data = JSON.parse(raw) as { posts?: BoardPost[] }
      if (Array.isArray(data.posts)) {
        for (const post of data.posts) {
          if (post && typeof post.id === 'string' && typeof post.topic === 'string') {
            this.posts.set(post.id, post)
          }
        }
      }
    } catch (error) {
      console.warn(`[dsh-tokensave] 黑板数据读取失败，从空板起步（原文件改名留档）:`, error)
      try {
        fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
      } catch { /* 留档失败不阻断 */ }
      this.posts.clear()
    }
  }

  /** 原子落盘：写 tmp 后 rename，读方永远看到完整 JSON。 */
  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const file = this.filePath
      const tmp = `${file}.tmp`
      const payload = {
        version: 1,
        updatedAt: Date.now(),
        posts: [...this.posts.values()].sort((a, b) => b.createdAtMs - a.createdAtMs),
      }
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
      fs.renameSync(tmp, file)
    } catch (error) {
      console.warn(`[dsh-tokensave] 黑板落盘失败（内存态仍有效）:`, error)
    }
  }

  /** 容量 FIFO：超出上限时淘汰最旧条目。 */
  private evictOverflow(): void {
    if (this.posts.size <= MAX_POSTS) return
    const sorted = [...this.posts.values()].sort((a, b) => a.createdAtMs - b.createdAtMs)
    const overflow = sorted.slice(0, this.posts.size - MAX_POSTS)
    for (const post of overflow) this.posts.delete(post.id)
  }

  /** 惰性过期：读到时把超时的 active 条目翻成 expired（与原语义一致）。 */
  private flipExpired(): void {
    const now = Date.now()
    for (const post of this.posts.values()) {
      if (post.status === 'active' && post.expiresAtMs && now > post.expiresAtMs) {
        post.status = 'expired'
      }
    }
  }

  /**
   * 发布一条黑板条目。
   * 保留主题抛错（由工具层转成失败应答）；TTL 默认 3600s 上限 86400s；
   * authorWorkspace 为空 = global（所有工作区可见，tokensave 引擎自产条目即此口径）。
   */
  post(input: BoardPostInput): BoardPost {
    this.ensureLoaded()
    if (isReservedTopic(input.topic)) {
      throw new Error(reservedTopicMessage(input.topic))
    }
    const now = Date.now()
    const ttlSec = typeof input.ttl === 'number' && input.ttl > 0
      ? Math.min(input.ttl, MAX_TTL_SEC)
      : DEFAULT_TTL_SEC
    const authorWorkspace = normalizeWorkspace(input.authorWorkspace)
    const post: BoardPost = {
      id: `post-${now}-${Math.random().toString(36).slice(2, 8)}`,
      topic: String(input.topic),
      content: String(input.content ?? ''),
      tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
      authorSessionId: input.authorSessionId || 'unknown-session',
      authorTitle: input.authorTitle || 'Session',
      authorWorkspace,
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
      expiresAt: new Date(now + ttlSec * 1000).toISOString(),
      expiresAtMs: now + ttlSec * 1000,
      status: 'active',
      scope: authorWorkspace || 'global',
    }
    this.posts.set(post.id, post)
    this.evictOverflow()
    this.persist()
    return post
  }

  /**
   * 查询条目（与原 list 同口径）：
   * - status：active（默认）/ archived / expired / all，读时先翻惰性过期；
   * - 工作区隔离：非 crossWorkspace 时只匹配 callerWorkspace 或空（global）；
   * - topic 精确或前缀匹配；topicPrefix 前缀匹配；tag 包含匹配；
   * - 倒序（新→旧）+ limit（上限 200，工具层再限 100）；
   * - titlesOnly（缺省：按 id 查默认全文，默认列表仅摘要）映射不含正文。
   */
  list(options: BoardListOptions = {}): BoardListResult {
    this.ensureLoaded()
    this.flipExpired()
    const {
      id, topic, topicPrefix, tag,
      status = 'active', limit = 20,
      callerWorkspace, crossWorkspace = false, titlesOnly,
    } = options

    const effectiveLimit = typeof limit === 'number' && limit > 0 ? Math.min(limit, 200) : 20
    const effectiveCallerWs = normalizeWorkspace(callerWorkspace)
    const targetId = id ? String(id).trim() : ''
    const effectiveTitlesOnly = titlesOnly !== undefined ? Boolean(titlesOnly) : !targetId
    const effectivePrefix = (topicPrefix || '').trim().toLowerCase()
    const now = Date.now()
    const results: BoardPost[] = []

    for (const post of this.posts.values()) {
      if (!post) continue
      if (status === 'active') {
        if (post.status !== 'active') continue
      } else if (status === 'archived') {
        if (post.status !== 'archived') continue
      } else if (status !== 'all') {
        if (post.status !== status) continue
      }
      // 工作区隔离：非跨区时，带 authorWorkspace 且不匹配调用方的条目跳过；
      // authorWorkspace 为空（global 条目）保持可见——tokensave 引擎自产简报/需求即靠此口径。
      if (!crossWorkspace) {
        if (effectiveCallerWs && post.authorWorkspace && post.authorWorkspace !== effectiveCallerWs) {
          continue
        }
      }
      if (targetId && post.id !== targetId) continue
      if (topic) {
        const t = topic.trim().toLowerCase()
        const pt = (post.topic || '').toLowerCase()
        if (pt !== t && !pt.startsWith(t)) continue
      }
      if (effectivePrefix && !(post.topic || '').toLowerCase().startsWith(effectivePrefix)) continue
      if (tag) {
        const searchTag = tag.trim().toLowerCase()
        const tags = (post.tags || []).map((x) => String(x).toLowerCase())
        if (!tags.includes(searchTag)) continue
      }
      results.push(post)
    }

    results.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
    const total = results.length
    const returnedPosts = results.slice(0, effectiveLimit).map((p) => {
      const remainingMinutes = p.expiresAtMs ? Math.ceil(Math.max(0, (p.expiresAtMs - now) / 1000) / 60) : 0
      const title = extractTitle(p)
      const base = {
        id: p.id,
        topic: p.topic,
        title,
        tags: p.tags || [],
        authorSessionId: p.authorSessionId,
        authorTitle: p.authorTitle || '',
        createdAt: p.createdAt,
        remainingMinutes,
        status: p.status,
        metadata: p.metadata || {},
      }
      return effectiveTitlesOnly ? base : { ...base, content: p.content }
    })

    return {
      total,
      returned: returnedPosts.length,
      workspace: effectiveCallerWs || '',
      crossWorkspace: Boolean(crossWorkspace),
      titlesOnly: effectiveTitlesOnly,
      posts: returnedPosts,
    }
  }

  /**
   * 归档（dismiss/archive）或删除（purge）条目；按 id 或 topic 定位，只作用于 active。
   * 返回受影响条数与执行动作。
   */
  clear(options: { id?: string; topic?: string; action?: 'archive' | 'purge' } = {}): { clearedCount: number; action: string } {
    this.ensureLoaded()
    const { id, topic, action = 'archive' } = options
    const targetId = id ? String(id).trim() : ''
    const targetTopic = topic ? topic.trim().toLowerCase() : ''
    let clearedCount = 0
    for (const post of [...this.posts.values()]) {
      if (post.status !== 'active') continue
      if (targetId && post.id !== targetId) continue
      if (targetTopic) {
        const pt = (post.topic || '').toLowerCase()
        if (pt !== targetTopic && !pt.startsWith(targetTopic)) continue
      }
      if (action === 'purge') {
        this.posts.delete(post.id)
      } else {
        post.status = 'archived'
      }
      clearedCount++
    }
    if (clearedCount > 0) this.persist()
    return { clearedCount, action }

  }

  /** 按 id 批量归档（轮次隔离用：委派启动时归档上一轮 tokensave 产出的条目）。 */
  archiveByIds(ids: readonly string[]): number {
    this.ensureLoaded()
    let archived = 0
    for (const raw of ids) {
      const post = this.posts.get(String(raw))
      if (post && post.status === 'active') {
        post.status = 'archived'
        archived++
      }
    }
    if (archived > 0) this.persist()
    return archived
  }
}

// —— 进程内单例（存储路径：~/.dsh/tokensave/board.json）——

let singleton: TokensaveBoardStore | null = null

export function boardFilePath(): string {
  return path.join(dshHomeDir(), 'tokensave', 'board.json')
}

export function getBoardStore(): TokensaveBoardStore {
  if (!singleton) singleton = new TokensaveBoardStore(boardFilePath())
  return singleton
}
