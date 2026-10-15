/**
 * 会话消息流列表（探索者窗口与主对话共用）
 *
 * 对齐宿主「对话」tab 的呈现语义（工具/过程默认折叠，最终回答才展开）：
 *   按 user 消息把消息切成「轮」；每轮里
 *     - user 消息        → 气泡
 *     - 上下文注入       → 折叠成一行「上下文注入 ▸」，点开才看正文（见 InjectionRow）
 *     - 其余（中间过程） → 折叠成一行「过程 N 步 · 工具 M 次」，点开才看细节
 *     - 该轮**最后一条** assistant 文本 → 视为最终回答，Markdown 渲染并展开
 *   这样工具调用与中间过程不再一股脑铺满界面，与「对话」里的观感一致。
 *
 * 注入消息（运行时上下文快照 / 技能目录 system-reminder 等）事件类型同为
 * user/message，但 `injected` 为真——它们不是用户发的，既不能当用户气泡，
 * 也不能参与轮次切分（否则会把一轮拆成两轮）。
 *
 * DOM 只渲染最近 MAX_TURNS 轮（避免 DOM 爆炸）；更早的历史靠「瀑布式回翻」：
 * 滚到顶部（或点「加载更早」）时先放大本地轮数窗口，本地没得放了就请宿主
 * 拉一页更早的历史（见 MainChat 的 onLoadOlder），并在内容变高后把视口钉回原处。
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { StreamMsg } from '../session-subscribe'
import { RichText, stripMarkdown } from './RichText'
import type { ChatView } from './chat-view'

/** 最多渲染的轮数（超出只显示最近这些） */
const MAX_TURNS = 40
/** 回翻一页的轮数步长 */
const TURNS_PER_PAGE = 20
/** 距顶部多少像素内算「到顶」，触发回翻 */
const TOP_LOAD_THRESHOLD = 32
/** 明确「想往上翻」的按键：按下即上锁并脱离贴底跟随（与滚轮向上同理）。 */
const UPWARD_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])
/** 明确「想往下/回底部」的按键：按下即解除上滚闩锁。 */
const DOWNWARD_KEYS = new Set(['ArrowDown', 'PageDown', 'End', ' '])
/**
 * 解除「上滚闩锁」所需的累计向下位移（像素）。
 *
 * 为什么不按单个事件判断：触控板一次上滚手势里常夹杂小幅反向 deltaY
 * （惯性/噪声），若一见 deltaY>0 就解锁，闩锁会与「接近底部就重新贴底」
 * 互相翻转——每帧 forceBottom 一次，表现为底部附近持续 2~3 秒的微小抖动
 * （视觉上像「重影」）。累计一小段真实向下位移才解锁即可消除。
 */
const UNLATCH_DOWN_PX = 32
/** 折叠行单行预览长度 */
const PREVIEW = 120

/**
 * 会话滚动位置记忆（跨组件重挂保命）。
 *
 * 为什么要模块级而不是组件内 ref：滚动位置就在**被卸载的那个组件**里，
 * 重挂后新实例读不到它。用 sessionId 作键存在模块作用域，重挂时才能接上。
 *
 * 语义：只在「用户当前就在底部附近」时记 bottom（重挂后继续贴底跟随流式输出）；
 * 用户主动往上翻时记具体 scrollTop（重挂后回到原处，不把他抳回底部）。
 */
interface ScrollMemo { bottom: boolean; top: number }
const SCROLL_MEMO = new Map<string, ScrollMemo>()
const SCROLL_MEMO_MAX = 40


const ROLE_LABELS: Record<string, string> = {
  user: '我',
  assistant: '模型',
  tool: '工具',
  system: '系统',
}
/** 某视图下一条都没剩时的提示（消息在，只是被当前口径滤掉了）。 */
const VIEW_EMPTY: Record<ChatView, string> = {
  all: '等待会话消息…',
  user: '本会话里还没有你发的消息（当前视图只看你发的）。',
  agent: '本会话里还没有模型的回复（当前视图只看模型侧）。',
}

/** 注入来源 → 人话标签（未收录的 kind 回退为「上下文注入」）；浮窗同款复用 */
export const INJECT_LABELS: Record<string, string> = {
  'runtime-context': '运行时上下文',
  'skill-catalog': '技能目录',
  'agent-instructions': '工作区指令',
  'skill-invocation': '技能内容',
  'session-reference': '跨会话召回',
}

/** 折叠预览：先去掉 Markdown 标记再截断（预览行里不再出现 ** / ``` / # 等原始标记）。 */
function oneLine(text: string): string {
  const t = stripMarkdown(text)
  return t.length > PREVIEW ? t.slice(0, PREVIEW) + '…' : t
}

/**
 * 「展开后点正文任意位置即收起」——用户要求：不必再滚回顶部去点折叠头。
 *
 * 例外（这些不收起）：
 *   - 落在可交互元素上：子折叠按钮（`button`）、RichText 里的链接、表单控件、
 *     `[role=button]` / `contenteditable`；
 *   - 存在文本选区（用户刚拖选了内容）——否则正文里的文字永远选不中。
 *
 * 只挂在已展开的**正文容器**上，不挂折叠头（头部本身就是切换按钮，挂上去会双触发）。
 */
function collapseOnBodyClick(close: () => void) {
  return (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement | null
    if (!el || el.closest('button, a, input, select, textarea, [role="button"], [contenteditable="true"]')) return
    const sel = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null
    if (sel && String(sel).trim().length > 0) return
    close()
  }
}
/**

 * 消息发出时间（每条消息一行小字）。

 * 数据源：StreamMsg.time（来自 SessionEvent.time，Unix ms），窗口重建与逐事件

 * 两条路径都会带上它；缺失时本组件返回 null，不占位。

 * 格式按「离现在多远」选粒度，与宿主对话 tab 的 clock 口径一致：

 *   今天        → HH:mm

 *   今年以内    → M月D日 HH:mm

 *   跨年        → YYYY年M月D日 HH:mm

 * title 始终挂完整本地时间戳，鼠标悬浮可看精确时刻。

 */
function MsgTime({ time, className }: { time?: number; className?: string }) {
  if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return null
  const d = new Date(time)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  const text = sameDay
    ? hm
    : d.getFullYear() === now.getFullYear()
      ? `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
      : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
  return (
    <span className={className ? `ts-msg-time ${className}` : 'ts-msg-time'} title={d.toLocaleString('zh-CN')}>
      {text}
    </span>
  )
}
/**
 * 过程里的一条：默认一行预览，点 ▾ 展开全文。
 *
 * 思考（kind==='reasoning'）与工具同款收纳，但带「思考」标签且弱化显示——
 * 这样它不会再隐形，也不会抢正文的注意力。
 */
function ProcItem({ msg }: { msg: StreamMsg }) {
  const [open, setOpen] = useState(false)
  const isThink = msg.kind === 'reasoning'
  return (
    <div className={`ts-proc-item${isThink ? ' ts-proc-think' : ''}`}>
      <div className="ts-proc-item-head">
        <span className="ts-proc-role">{isThink ? '思考' : ROLE_LABELS[msg.role] || msg.role}</span>
        {/* 过程项也带时间：每条工具/思考何时发生一目了然（用户要求“每条消息”） */}
        <MsgTime time={msg.time} className="ts-proc-time" />
        <button
          className="ts-icon-btn ts-msg-toggle"
          onClick={() => setOpen((v) => !v)}
          title={open ? '折叠' : '展开全文'}
        >{open ? '▴' : '▾'}</button>
      </div>
      {/* 展开后同样走 RichText：思考/工具输出里的 Markdown 与 JSON 也要渲染，
          否则用户会看到原始 ** / - / ``` / JSON 文本。 */}
      {open
        ? <div className="ts-msg-full"><RichText text={msg.content} /></div>
        : <div className="ts-msg-preview">{oneLine(msg.content)}</div>}
    </div>
  )
}

/**
 * 一轮里的「上下文注入」：单独一行「上下文注入 ▸」，点开才看正文。
 *
 * 这些是宿主自动带进会话的运行时上下文快照、技能目录 system-reminder 等，
 * 事件类型是 user/message 但并非用户所发。收纳后它们不再冒充「我」的气泡，
 * 也不干扰轮次切分；形态与「过程」折叠行一致。
 */
function InjectionRow({ items }: { items: StreamMsg[] }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  const label = (m: StreamMsg) => INJECT_LABELS[m.injectKind ?? ''] ?? '上下文注入'
  return (
    <div className="ts-inject">
      <button
        className="ts-proc-head"
        title={`上下文注入 ${items.length} 条（${items.map(label).join('、')}），点开查看正文`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ts-proc-caret">{open ? '▾' : '▸'}</span>
        <span className="ts-proc-lead">上下文注入 {items.length} 条</span>
        <span className="ts-dim">{items.map(label).join('、')}</span>
      </button>
      {open && (
        <div className="ts-proc-body" onClick={collapseOnBodyClick(() => setOpen(false))}>
          {items.map((m, i) => (
            <div className="ts-proc-item ts-inject-item" key={i}>
              <div className="ts-proc-item-head">
                <span className="ts-proc-role">{label(m)}</span>
                <MsgTime time={m.time} className="ts-proc-time" />
              </div>
              <div className="ts-msg-full"><RichText text={m.content} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 一轮里的「过程」：默认折叠（思考 + 工具 + 中间文字）。
 *
 * 头部会报出「思考 N 段」/「工具 M 次」——用户发完消息后一眼就能确认模型已开工，
 * 不必展开（反馈 #1）。展开后逐条列出，思考单独标注。
 */
function ProcessGroup({ items }: { items: StreamMsg[] }) {
  const [open, setOpen] = useState(false)
  const tools = items.filter((m) => m.role === 'tool').length
  const thinks = items.filter((m) => m.kind === 'reasoning').length
  return (
    <div className="ts-proc">
      {/* title 保留完整信息：宽度不足时视觉上会被省略号截断，悬停仍能看到全量计数 */}
      <button
        className="ts-proc-head"
        title={`过程 ${items.length} 步${thinks > 0 ? ` · 思考 ${thinks} 段` : ''}${tools > 0 ? ` · 工具 ${tools} 次` : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ts-proc-caret">{open ? '▾' : '▸'}</span>
        <span className="ts-proc-lead">过程 {items.length} 步</span>
        {thinks > 0 && <span className="ts-dim">思考 {thinks} 段</span>}
        {tools > 0 && <span className="ts-dim">工具 {tools} 次</span>}
        <MsgTime time={items[items.length - 1]?.time} className="ts-proc-time" />
      </button>
      {open && (
        <div className="ts-proc-body" onClick={collapseOnBodyClick(() => setOpen(false))}>
          {items.map((m, i) => <ProcItem key={i} msg={m} />)}
        </div>
      )}
    </div>
  )
}

interface Turn {
  users: StreamMsg[]
  proc: StreamMsg[]
  answer: StreamMsg | null
  /** 宿主自动注入的上下文（非用户所发），单独折叠成一行，不进用户气泡 */
  injects: StreamMsg[]
  /** 本轮异常结束的提示（turn/end 的 reason / agent/error）；正常结束为 null */
  notice: StreamMsg | null
}

/**
 * 一轮拆分：最后一条**非思考**的 assistant 文本算最终回答，其余都算过程。
 *
 * 为何要排除思考：思考与正文同为 assistant 角色，若不过滤，
 * 只跑了思考、还没出正文的那一步会被当成“最终回答”展开，与收纳意图相反。
 */
function splitTurn(turn: StreamMsg[]): Turn {
  const users: StreamMsg[] = []
  const injects: StreamMsg[] = []
  const rest: StreamMsg[] = []
  let notice: StreamMsg | null = null
  for (const m of turn) {
    // 异常结局单独收口：它既不是用户消息，也不该被埋进「过程」折叠里——
    // 用户必须一眼看到「这轮挂了」（以前 turn/end 被丢弃，工作台看不出来）。
    if (m.notice) { notice = m; continue }
    // 注入消息 role 也是 'user'，必须先于 role 判断拦下：
    // 既不能当用户气泡，也不能被算作「该轮的提问」。
    if (m.injected) injects.push(m)
    else if (m.role === 'user') users.push(m)
    else rest.push(m)
  }
  // 从后往前找最后一条「非思考的 assistant 文本」作回答
  let answer: StreamMsg | null = null
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i]
    if (m.role === 'assistant' && m.kind !== 'reasoning' && m.content.trim()) {
      answer = m
      break
    }
  }
  const proc = rest.filter((m) => m !== answer)
  return { users, injects, proc, answer, notice }
}

interface MsgListProps {
  messages: StreamMsg[]
  emptyText?: string
  /** 宿主是否还有更早的历史可分页（session 快照的 hasMore） */
  hasMore?: boolean
  /** 是否正在从宿主拉取更早的一页 */
  loadingOlder?: boolean
  /** 请求拉取更早一页（由 MainChat 转发到 session face 的 loadOlder） */
  onLoadOlder?: () => void | Promise<void>
  /** 滚动回调（MainChat 用来让滚动条「滚动时显形、停下淡出」） */
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
  /**
   * 会话身份键（主对话传 sessionId）。
   *
   * 为什么需要：组件**重挂**时（例如把主对话卡片最大化 / 还原，或布局重排）
   * ref 指向的是新节点、scrollTop 从 0 开始——用户看到的就是对话「跳回更早」。
   * 挂载时若已有内容，直接贴底，不再依赖「内容变化」这个触发条件。
   */
  followKey?: string
  /**
   * 阅读视图（见 chat-view.ts）：只影响**呈现**，不改变轮次切分与滚动。
   *   all   → 现状：我的气泡 + 回复，过程 / 注入各自折叠一行；
   *   user  → 只留我的气泡；
   *   agent → 只留模型侧（过程折叠 + 回复 + 轮末异常提示）。
   * 缺省 all，探索者窗口与简报沿用同一份组件、行为不变。
   */
  view?: ChatView
}

/**
 * 一轮异常结束的提示行（故障中断 / 输出截断 / 异常中止）。
 *
 * 为什么必须独立成行：用户反馈「中断时看不出来」——以前 `turn/end` 被投影丢掉，
 * 工作台里中止的一轮与正常结束长得一模一样，只有宿主原生「对话」tab 能看出区别。
 * 因此这里用醒目样式（而非“过程”折叠）把结局摆到轮末，并带上宿主错误码。
 * 正文默认收起：宿主原文可能很长（判据、额度估算等），需要时可展开。
 */
function TurnNoticeRow({ notice }: { notice: NonNullable<StreamMsg['notice']> }) {
  const [open, setOpen] = useState(false)
  const fatal = notice.kind === 'error' || notice.kind === 'blocked'
  const label = notice.kind === 'max-tokens'
    ? '输出被截断'
    : notice.kind === 'aborted'
      ? '本轮已中止'
      : notice.kind === 'interrupted'
        ? '本轮已中断'
        : notice.kind === 'blocked'
          ? '本轮被阻断'
          : '本轮运行失败'
  return (
    <div className={`ts-turn-notice${fatal ? ' ts-turn-notice-fatal' : ''}`}>
      <div className="ts-turn-notice-head">
        <span className="ts-turn-notice-icon" aria-hidden="true">{fatal ? '⛔' : '⚠️'}</span>
        <span className="ts-turn-notice-label">{label}</span>
        {notice.code && <span className="ts-turn-notice-code">{notice.code}</span>}
        <button
          className="ts-icon-btn ts-msg-toggle"
          onClick={() => setOpen((v) => !v)}
          title={open ? '收起详情' : '展开完整说明'}
        >{open ? '▴' : '▾'}</button>
      </div>
      {open
        ? <div className="ts-turn-notice-body"><RichText text={notice.message} /></div>
        : <div className="ts-turn-notice-preview">{oneLine(notice.message)}</div>}
    </div>
  )
}

export function MsgList({
  messages,
  emptyText,
  hasMore = false,
  loadingOlder = false,
  onLoadOlder,
  onScroll: onScrollExternal,
  followKey = '',
  view = 'all',
}: MsgListProps) {
  const ref = useRef<HTMLDivElement>(null)
  // 当前展示的轮数窗口：瀑布式回翻时逐步放大（只放大，不缩回去）
  const [windowTurns, setWindowTurns] = useState(MAX_TURNS)
  // —— 滚动跟随（反馈 #2）——
  //
  // 旧行为：内容一变就 `scrollTop = scrollHeight`。后果是用户展开过程、
  // 滚上去看细节时，一有新动态就被拉回底部，读不了。
  //
  // 新行为（粘性跟随）：只有用户**本来就在底部附近**时才跟随新内容；
  // 一旦手动往上滚，就不再自动调整，直到他自己滚回底部。
  const pinnedRef = useRef(true)
  const [pinned, setPinned] = useState(true)
  /** 回翻前的滚动锚点：内容变高后用它把视口钉回原处 */
  const anchorRef = useRef<{ height: number; top: number } | null>(null)
  /** 刚做过视口锤定的时间戳：程序化改 scrollTop 会触发 scroll 事件，
      需短时间内忽略它，避免连锁把整段历史一口气拉完 */
  const restoredAtRef = useRef(0)
  /** 距底部多少像素内仍算“在底部”（给流式追加留余量）。 */
  const NEAR_BOTTOM = 24
  /**
   * 记住当前滚动位置（卸载前 / 用户滚动时调用）。
   *
   * 为什么要模块级 SCROLL_MEMO 而不是组件内 ref：位置就在**被卸载的那个
   * 组件实例**里，重挂后新实例读不到。用 followKey（= sessionId）作键才能接上。
   */
  const rememberScroll = useCallback(() => {
    const el = ref.current
    if (!el || !followKey) return
    // 以 pinnedRef 为准（它由真实滚动事件维护）。
    // 不在这里重算：布局切换会改变 scrollHeight（输入条重新停靠→padding-bottom 变），
    // 那会让 gap 瞬间变大，若拿它当真值就会把「贴底」误记成「用户翻上去了」，
    // 重挂后反而把他带到中间——正是要修的那个「跳回更早」。
    const bottom = pinnedRef.current
    SCROLL_MEMO.set(followKey, { bottom, top: el.scrollTop })
    // 只增不减会随会话数缓慢膨胀
    if (SCROLL_MEMO.size > SCROLL_MEMO_MAX) {
      const oldest = SCROLL_MEMO.keys().next().value
      if (oldest !== undefined) SCROLL_MEMO.delete(oldest)
    }
  }, [followKey])

  // 卸载前记下位置，供重挂时恢复（组件重挂是「跳回更早」的直接成因）。
  useEffect(() => rememberScroll, [rememberScroll])

  /** 待恢复的滚动位置：重挂时内容往往还没到位，先存着，等内容来了再套用。 */
  const pendingRestoreRef = useRef<ScrollMemo | null>(null)

  /**
   * 挂载 / 切会话：按记忆恢复滚动位置（绘制前执行，不会先闪一下再跳）。
   *   - 上次就在底部 → 贴底并继续跟随流式输出；
   *   - 上次在往上翻 → 回到原处，且**不**自动跟随（不把用户拽回底部）。
   *
   * 切到**另一个**会话（followKey 变了）时不该沿用旧会话的位置——
   * 那是宿主切会话，应由下面「切会话重新贴底」的 effect 接管。
   */
  const memoKeyRef = useRef(followKey)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const sameSession = memoKeyRef.current === followKey
    memoKeyRef.current = followKey
    const memo = sameSession && followKey ? SCROLL_MEMO.get(followKey) : undefined
    if (memo && !memo.bottom) {
      pinnedRef.current = false
      setPinned(false)
      // 回到用户上次的阅读位置：属于「明确不贴底」，同样上锁，
      // 否则重新挂载后会被贴底循环立刻拽回底部。
      upwardRef.current = true
      downPxRef.current = 0
      pendingRestoreRef.current = memo
      el.scrollTop = Math.min(memo.top, Math.max(0, el.scrollHeight - el.clientHeight))
      return
    }
    // 贴底：解除上滚闩锁（切会话 / 无记忆时都要回到跟随状态）。
    upwardRef.current = false
    downPxRef.current = 0
    pinnedRef.current = true
    setPinned(true)
    pendingRestoreRef.current = null
    el.scrollTop = el.scrollHeight
  }, [followKey])

  // 内容到位后把「待恢复」的位置真正套用一次（重挂时消息通常是异步到达的）。
  useLayoutEffect(() => {
    const p = pendingRestoreRef.current
    const el = ref.current
    if (!p || !el) return
    if (el.scrollHeight <= el.clientHeight) return   // 还没内容，等下一次渲染
    pendingRestoreRef.current = null
    el.scrollTop = Math.min(p.top, Math.max(0, el.scrollHeight - el.clientHeight))
    restoredAtRef.current = Date.now()
  })

  const turns = useMemo(() => {
    const out: StreamMsg[][] = []
    for (const m of messages) {
      // 注入消息不开新轮：它紧跟在用户消息之后到达，若按 user 切轮，
      // 一轮「提问 + 注入 + 回答」会被拆成两轮（提问孤零零、回答没了提问）。
      if ((m.role === 'user' && !m.injected) || out.length === 0) out.push([])
      out[out.length - 1].push(m)
    }
    return out
  }, [messages])

  const shownTurns = turns.length > windowTurns ? turns.slice(-windowTurns) : turns
  const hiddenTurns = turns.length - shownTurns.length
  const parsed = useMemo(() => shownTurns.map(splitTurn), [shownTurns])
  /**
   * 按视图过滤后的轮（整轮被滤空就丢掉）。
   *
   * 为什么先过滤再渲染、而不是在 JSX 里逐块判断：`.ts-turn + .ts-turn` 靠相邻
   * 兄弟选择器画分隔线，滤空的轮若留在 DOM 里就会留下一段空当 + 一条虚线。
   * 顺带用它判定「消息在、只是被口径滤掉了」的空态提示。
   */
  const visible = useMemo(
    () => parsed
      .map((t) => ({
        users: view === 'agent' ? [] : t.users,
        // 上下文注入既不是「我」发的、也不是模型说的（宿主自动带进来），只在全部视图里出现
        injects: view === 'all' ? t.injects : [],
        proc: view === 'user' ? [] : t.proc,
        answer: view === 'user' ? null : t.answer,
        notice: view === 'user' ? null : t.notice,
      }))
      .filter((t) => t.users.length > 0 || t.injects.length > 0
        || t.proc.length > 0 || !!t.answer || !!t.notice),
    [parsed, view],
  )
  /** DOM 里还有被窗口裁掉的更早轮（无需请求宿主，直接放大窗口即可） */
  const hasHiddenInDom = hiddenTurns > 0
  const canLoadOlder = hasHiddenInDom || (hasMore && !!onLoadOlder)


  /**
   * 回翻一页更早的历史（瀑布式）。
   *
   * 两个来源，优先本地：
   *   ① DOM 里还有被窗口裁掉的轮 → 直接放大窗口（瞬时，不发请求）；
   *   ② 宿主还有更早的历史 → 拉一页（loadOlder），窗口扩大后消息会自己多出来。
   * 无论哪种，都先记下当前滚动位置，内容变高后把视口钉回原处，避免「跳」。
   */
  const requestOlder = useCallback(() => {
    const el = ref.current
    if (!el) return
    // 锤定刚发生不久：本次 scroll 是程序写的，不当作「用户滚到顶」
    if (Date.now() - restoredAtRef.current < 150) return
    if (hasHiddenInDom) {
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
      setWindowTurns((v) => v + TURNS_PER_PAGE)
      return
    }
    if (!hasMore || loadingOlder || !onLoadOlder) return
    anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
    void onLoadOlder()
  }, [hasHiddenInDom, hasMore, loadingOlder, onLoadOlder])

  /**
   * 用户「主动滚动」的时间戳（滚轮 / 触控 / 键盘 / 按下鼠标——含拖滚动条）。
   *
   * 为何必须有它：布局切换时宿主输入条会重新停靠，`.ts-chat-msgs` 的
   * padding-bottom / 高度会**分几步异步变化**，中间态把 scrollTop 夹到一个
   * 较小的值，尺寸恢复后浏览器**不会**把它放回去。于是产生一个「离开了底部」
   * 的 scroll 事件，与用户往上翻长得一模一样——不加区分就会把贴底状态
   * 误清掉（实测 98px 偏差且不再自愈）。
   *
   * 只有真实输入才算用户意图；程序化改 scrollTop 不算。
   */
  const userIntentAtRef = useRef(0)
  /** 上一次 scroll 事件看到的 scrollTop：用来判断用户此刻在上滚还是下滚。 */
  const lastTopRef = useRef<number | null>(null)
  /**
   * 「上滚闩锁」：用户明确往上翻之后置真，直到他确实向下走回底部才解除。
   *
   * 为什么需要闩锁而不是每帧重新判断：滚轮向上时贴底循环可能先一步把
   * scrollTop 写回底部，随后的 scroll 事件量不到位移（movedUp 为假），
   * 若此时按「接近底部」重新钉住，刚做出的上滚意图就被抹掉——这正是
   * 「已经快到最底部了、想往上滚却粘在底部」的观感。
   *
   * 闩锁期间**绝不写 scrollTop**（见 onScroll / runSettle / layout effect），
   * 因此不会与贴底循环形成「写回 → 重钉 → 再写回」的抖动回路。
   */
  const upwardRef = useRef(false)
  /** 闩锁期间累计的向下位移：达到 UNLATCH_DOWN_PX 才解锁（抗触控板噪声）。 */
  const downPxRef = useRef(0)

  /** 贴底稳定化窗口的截止时刻与 rAF 句柄（见下方 runSettle）。 */
  const settleUntilRef = useRef(0)
  const settleRafRef = useRef(0)

  /**
   * 立刻脱离「贴底跟随」。
   *
   * 为什么要「立刻」而不是等 scroll 事件：用户上滚的那一帧里，贴底循环的
   * rAF 可能已经先把 scrollTop 写回底部，随后的 scroll 事件就量不到位移，
   * 于是又被判成「还在底部」而重新钉住——表现出来就是「粘在底部」。
   * 所以滚轮/按键的**方向**一确认就当场停手。
   */
  const suspendFollow = useCallback(() => {
    if (pinnedRef.current) {
      pinnedRef.current = false
      setPinned(false)
    }
    // 同时结束稳定化窗口：残留的 rAF 会继续 forceBottom，跟用户抢滚动条。
    settleUntilRef.current = 0
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const mark = () => { userIntentAtRef.current = Date.now() }
    /** 滚轮：向上立即上锁并脱附；向下累计到位后才解锁。 */
    const onWheel = (e: WheelEvent) => {
      mark()
      if (e.deltaY < 0) {
        upwardRef.current = true
        downPxRef.current = 0
        suspendFollow()
      } else if (e.deltaY > 0 && upwardRef.current) {
        downPxRef.current += e.deltaY
        if (downPxRef.current >= UNLATCH_DOWN_PX) {
          upwardRef.current = false
          downPxRef.current = 0
        }
      }
    }
    /** 翻页/方向键：按键是离散的明确意图，直接上锁/解锁。 */
    const onKeyDown = (e: KeyboardEvent) => {
      mark()
      if (UPWARD_KEYS.has(e.key)) {
        upwardRef.current = true
        downPxRef.current = 0
        suspendFollow()
      } else if (DOWNWARD_KEYS.has(e.key)) {
        upwardRef.current = false
        downPxRef.current = 0
      }
    }
    const opts = { passive: true, capture: true } as AddEventListenerOptions
    const types = ['touchstart', 'touchmove', 'pointerdown', 'mousedown'] as const
    el.addEventListener('wheel', onWheel, opts)
    el.addEventListener('keydown', onKeyDown, opts)
    for (const t of types) el.addEventListener(t, mark, opts)
    return () => {
      el.removeEventListener('wheel', onWheel, opts)
      el.removeEventListener('keydown', onKeyDown, opts)
      for (const t of types) el.removeEventListener(t, mark, opts)
    }
  }, [suspendFollow])

  /**
   * 滚到底部，但**只在真的没到底时才写**。
   *
   * 为何要加这个判断：本函数由贴底稳定化循环按 rAF 频率调用。若无条件写
   * `scrollTop`，即使值没变也会触发一次滚动提交；滚动锚定 / 滚动事件 /
   * 渲染回调跟着再来一轮，就形成每帧一次的空写循环——底部附近的微抖。
   * 值相等就跳过，循环自然静止。
   */
  const forceBottom = useCallback(() => {
    const node = ref.current
    if (!node) return false
    const target = node.scrollHeight - node.clientHeight
    if (target - node.scrollTop <= 0.5) return false
    node.scrollTop = target
    return true
  }, [])

  /** 用户主动回到最新：滚到底并恢复跟随。 */
  const scrollToBottom = useCallback(() => {
    // 用户明确要求回底部：解除上滚闩锁并恢复跟随。
    upwardRef.current = false
    downPxRef.current = 0
    forceBottom()
    pinnedRef.current = true
    setPinned(true)
  }, [forceBottom])
  /**
   * 贴底稳定化：布局变动后的一小段时间内反复贴底。
   *
   * 为何要反复而不是补一次：输入条高度由 HDesk 分几步异步写入
   * （layout effect + ResizeObserver + 300ms 轮询），补一次往往赶在最终
   * 尺寸之前，于是留下几十像素偏差。用有界 rAF 窗口盯到尺寸稳定为止。
   */
  const runSettle = useCallback(() => {
    settleRafRef.current = 0
    if (performance.now() >= settleUntilRef.current) return
    // 用**实时**的 pinned 状态，不能用渲染时的快照：用户一旦往上翻，
    // onScroll 会当场把 pinned 置为 false，循环必须立即停手。
    // 这里还要顺手关掉稳定化窗口——否则残留的 rAF 会在用户上滚期间
    // 继续 forceBottom，把他逐帧拽回底部（「像被拉住」）。
    if (!pinnedRef.current) {
      settleUntilRef.current = 0
      return
    }
    // 写到底。forceBottom 已幂等：已经贴底时不写、不返回副作用，
    // 所以本循环即使把窗口跑满也不会像以前那样逐帧空写、触发微抖。
    //
    // 窗口必须跑满而不能「一次不需写入就退出」：流式输出时内容每帧都在
    // 长高，必须持续重新贴底才能跟随最新输出。
    forceBottom()
    settleRafRef.current = requestAnimationFrame(runSettle)
  }, [forceBottom])
  /** 开启（或延长）一段贴底稳定化窗口。 */
  const scheduleSettle = useCallback(() => {
    settleUntilRef.current = performance.now() + 1500
    if (!settleRafRef.current) settleRafRef.current = requestAnimationFrame(runSettle)
  }, [runSettle])
  useEffect(() => () => { if (settleRafRef.current) cancelAnimationFrame(settleRafRef.current) }, [])

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    onScrollExternal?.(e)
    const el = ref.current
    if (!el) return
    const sh = el.scrollHeight
    const ch = el.clientHeight
    const top = el.scrollTop
    const prevTop = lastTopRef.current
    lastTopRef.current = top

    // 刚发生过真实输入（滚轮 / 触控 / 键盘 / 拖滚动条）？
    const freshIntent = Date.now() - userIntentAtRef.current < 900
    // 位移方向（1px 容差抗亚像素抖动）。
    const movedUp = prevTop !== null && top < prevTop - 1
    const atBottom = sh - top - ch <= NEAR_BOTTOM

    // 闩锁期间累计「真实向下位移」，与 onWheel 用**同一个**阈值解除。
    //
    // 这里曾是「1px 向下就解锁」，与滚轮路径的 32px 不一致：用户上滚时
    // 只要出现 1px 的反向抖动（触控板惯性、亚像素重排）就解锁 → 立即被
    // 判为到底而重新贴底 → forceBottom 写回底部 → 又产生向上位移 → 再解锁。
    // 这个 1px 级的翻转回路就是「重影 / 持续 2~3s 的微抖」。
    //
    // 不附加 freshIntent 条件：闩锁期间我们自己绝不写 scrollTop，所以此刻
    // 任何向下位移都是用户所为。加上时间窗反而会让「慢速拖滚动条回底部」
    // （拖过 900ms）永远解不开锁。
    if (upwardRef.current && prevTop !== null && top > prevTop) {
      downPxRef.current += top - prevTop
    }

    // 「真实上滚」必须优先于「接近底部」判定。
    //
    // 否则：距底 NEAR_BOTTOM 像素的这段带内，每一次上滚都会被重新置
    // pinned=true → 贴底循环立刻把人拽回去。用户感受就是「已经快到最底部
    // 了，想往上滚却像粘在底部」。
    //
    // 注意这里**不能**附加「尺寸没变」（旧条件 !sizeChanged）：流式输出期间
    // scrollHeight 几乎每帧都在变，sizeChanged 恒为真，真实上滚会被当成布局
    // 抖动丢掉、pinned 一直是 true —— 即「在最底部向上滚卡住、要非常大力」。
    if (freshIntent && movedUp) {
      upwardRef.current = true
      downPxRef.current = 0
      suspendFollow()
      rememberScroll()
      // 滚到顶部就往下回翻（只认真实用户滚动）
      if (top <= TOP_LOAD_THRESHOLD) requestOlder()
      return
    }

    if (!atBottom) return

    // 到了底部：只有「用户自己向下走回底部」才恢复跟随。
    //
    // 闩锁期间若仅因内容长高而落进这段带内，保持不动。
    //
    // 解锁条件是「累计向下走够了」（downPxRef，与滚轮同一阈值），
    // 而不是任意一次 1px 抖动——后者会与重新贴底形成每帧翻转。
    if (upwardRef.current && downPxRef.current < UNLATCH_DOWN_PX) return

    upwardRef.current = false
    downPxRef.current = 0
    if (!pinnedRef.current) {
      pinnedRef.current = true
      setPinned(true)
    }
  }
  const jumpToBottom = () => {
    scrollToBottom()
    rememberScroll()
  }

  /**
   * 每次渲染后：贴底一次并开一段稳定化窗口。
   *
   * 为什么选“渲染后”做挂钩点：布局切换会让 HDesk 重渲染（actions 每次
   * 都是新元素），MainChat/MsgList 随之重渲染；而输入条高度的异步写入
   * 恰恰也发生在这段时间。在这里开窗，就能把随后的几次尺寸变化都盖住。
   *
   * 只在 pinnedRef 为真（用户本来就在底部）时动手，不会抢用户往上翻的视口。
   */
  useLayoutEffect(() => {
    // 只有用户本来就在底部时才贴底并开窗；他一旦上滚（pinned=false），
    // 这里既不再贴底，也不该重新开一段稳定化窗口把他拽回去。
    if (!pinnedRef.current) return
    forceBottom()
    // 仍然开窗：输入条高度是**异步**写入的（HDesk 分几步 + 300ms 轮询），
    // 开窗才能盖住随后的尺寸变化。
    //
    // 不会因此长期空转：forceBottom 已幂等（到底就不写），runSettle 一旦
    // 发现无需写入就立即结束窗口，所以这里续窗只是「有待修正时才续」。
    scheduleSettle()
  })

  // 回翻后恢复视口：新增内容在**顶部**，因此把 scrollTop 加上「长高的那部分」，
  // 用户眼前的旧内容原地不动（典型瀑布流锚定）。无锚点时 no-op。
  useEffect(() => {
    const a = anchorRef.current
    const el = ref.current
    if (!a || !el) return
    anchorRef.current = null
    restoredAtRef.current = Date.now()
    el.scrollTop = el.scrollHeight - a.height + a.top
  })

  // 切换会话时重置轮数窗口（新会话从头开始；位置由上面 followKey 的 layout effect 接管，
  // 那里已经处理了「贴底 / 恢复原处」，所以这里不再碰 scrollTop——否则会把恢复覆盖掉）。
  useEffect(() => {
    setWindowTurns(MAX_TURNS)
  }, [followKey])
  return (
    <div className="ts-chat-msgs" ref={ref} onScroll={onScroll}>
      {messages.length === 0 && (
        <div className="ts-hint">{emptyText ?? '等待会话消息…'}</div>
      )}
      {/* 消息在、只是被当前视图滤空了：明说是口径问题，别让人以为会话没内容 */}
      {messages.length > 0 && visible.length === 0 && (
        <div className="ts-hint">{VIEW_EMPTY[view]}</div>
      )}
      {(canLoadOlder || loadingOlder) && (
        <div className="ts-msgs-topbar">
          {loadingOlder ? (
            <span className="ts-dim">载入更早的历史…</span>
          ) : (
            <button className="ts-btn ts-btn-sm" onClick={requestOlder} title="向回加载更早的聊天记录">
              加载更早
            </button>
          )}
          {hasHiddenInDom && <span className="ts-dim">已折叠更早 {hiddenTurns} 轮</span>}
        </div>
      )}
      {visible.map((t, ti) => (
        <div className="ts-turn" key={ti}>
          {t.users.map((m, i) => (
            <div className="ts-msg-block ts-msg-block-user" key={`u${i}`}>
              <div className="ts-msg-user">{m.content}</div>
              <MsgTime time={m.time} />
            </div>
          ))}
          <InjectionRow items={t.injects} />
          {t.proc.length > 0 && <ProcessGroup items={t.proc} />}
          {t.answer && (
            <div className="ts-msg-block ts-msg-block-assistant">
              <div className="ts-msg-assistant">
                <RichText text={t.answer.content} />
              </div>
              <MsgTime time={t.answer.time} />
            </div>
          )}
          {t.notice && <TurnNoticeRow notice={t.notice.notice!} />}
        </div>
      ))}
      {/* 用户滚上去看细节时给一个“回到最新”入口（不自动抢滚动）。
         注意：**始终渲染**，只用属性控制可见性。
         以前是 `!pinned && <button>`——按钮是滚动容器里的一个 flex 项，
         它的增删会改变 scrollHeight，而 scrollHeight 又决定 atBottom，
         atBottom 再翻转 pinned：形成「贴底↔离开底部」的自激回路，
         表现为底部附近持续数秒的微抖 / 重影。常驻 DOM 后 scrollHeight 恒定，
         回路断开。（visibility 不脱离文档流，仍占位，正是我们要的。） */}
      {messages.length > 0 && (
        <button
          className="ts-jump-latest"
          data-visible={pinned ? undefined : ''}
          aria-hidden={pinned || undefined}
          tabIndex={pinned ? -1 : undefined}
          onClick={jumpToBottom}
          title="回到最新"
        >
          ↓ 回到最新
        </button>
      )}
    </div>
  )
}
