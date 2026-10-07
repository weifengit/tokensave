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
 * 另外：只渲染最近 MAX_TURNS 轮，更早的折成提示（避免 DOM 爆炸）。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { StreamMsg } from '../session-subscribe'
import { RichText, stripMarkdown } from './RichText'

/** 最多渲染的轮数（超出只显示最近这些） */
const MAX_TURNS = 40
/** 折叠行单行预览长度 */
const PREVIEW = 120

const ROLE_LABELS: Record<string, string> = {
  user: '我',
  assistant: '模型',
  tool: '工具',
  system: '系统',
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
        <div className="ts-proc-body">
          {items.map((m, i) => (
            <div className="ts-proc-item ts-inject-item" key={i}>
              <div className="ts-proc-item-head">
                <span className="ts-proc-role">{label(m)}</span>
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
      </button>
      {open && (
        <div className="ts-proc-body">
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
  for (const m of turn) {
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
  return { users, injects, proc, answer }
}

export function MsgList({ messages, emptyText }: { messages: StreamMsg[]; emptyText?: string }) {
  const ref = useRef<HTMLDivElement>(null)

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

  const shownTurns = turns.length > MAX_TURNS ? turns.slice(-MAX_TURNS) : turns
  const hiddenTurns = turns.length - shownTurns.length
  const parsed = useMemo(() => shownTurns.map(splitTurn), [shownTurns])

  // —— 滚动跟随（反馈 #2）——
  //
  // 旧行为：内容一变就 `scrollTop = scrollHeight`。后果是用户展开过程、
  // 滚上去看细节时，一有新动态就被拉回底部，读不了。
  //
  // 新行为（粘性跟随）：只有用户**本来就在底部附近**时才跟随新内容；
  // 一旦手动往上滚，就不再自动调整，直到他自己滚回底部。
  const pinnedRef = useRef(true)
  const [pinned, setPinned] = useState(true)
  /** 距底部多少像素内仍算“在底部”（给流式追加留余量）。 */
  const NEAR_BOTTOM = 24

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM
    if (atBottom !== pinnedRef.current) {
      pinnedRef.current = atBottom
      setPinned(atBottom)
    }
  }

  const jumpToBottom = () => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    pinnedRef.current = true
    setPinned(true)
  }

  // 末条内容变化时跟随（覆盖流式追加）；用户已滚上去则不动。
  const tailLen = messages.length > 0 ? messages[messages.length - 1].content.length : 0
  useEffect(() => {
    if (!pinnedRef.current) return
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, tailLen, shownTurns.length])

  // 切换会话时重新贴底（新会话应从头看最新）
  useEffect(() => {
    pinnedRef.current = true
    setPinned(true)
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [emptyText])
  return (
    <div className="ts-chat-msgs" ref={ref} onScroll={onScroll}>
      {messages.length === 0 && (
        <div className="ts-hint">{emptyText ?? '等待会话消息…'}</div>
      )}
      {hiddenTurns > 0 && (
        <div className="ts-hint">更早的 {hiddenTurns} 轮已折叠（仅显示最近 {MAX_TURNS} 轮）</div>
      )}
      {parsed.map((t, ti) => (
        <div className="ts-turn" key={ti}>
          {t.users.map((m, i) => (
            <div className="ts-msg-user" key={`u${i}`}>{m.content}</div>
          ))}
          <InjectionRow items={t.injects} />
          {t.proc.length > 0 && <ProcessGroup items={t.proc} />}
          {t.answer && (
            <div className="ts-msg-assistant">
              <RichText text={t.answer.content} />
            </div>
          )}
        </div>
      ))}
      {/* 用户滚上去看细节时给一个“回到最新”入口（不自动抢滚动） */}
      {!pinned && messages.length > 0 && (
        <button className="ts-jump-latest" onClick={jumpToBottom} title="回到最新">
          ↓ 回到最新
        </button>
      )}
    </div>
  )
}
