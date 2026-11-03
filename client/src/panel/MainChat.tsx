/**
 * 中下格：DSH 主对话只读消息流
 *
 * 会话记录原本只渲染在宿主的「对话」tab 里（工作台内发送消息不会自动切 tab），
 * 于是中下卡片看起来是空的。这里用与探索者窗口同一套订阅（session-subscribe）
 * 把主会话的窗口快照渲染出来；发送仍然走宿主原生输入条（停靠在本卡片底部）。
 *
 * 另外提供：阅读视图切换、往上翻自动拉更早历史、正文宽度把手（复用宿主偏好键）、
 * 滚动条「滚动时显形、停下淡出」。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { subscribeSession, subscribeHistoryState, loadOlderHistory } from '../session-subscribe'
import type { StreamMsg } from '../session-subscribe'
import { MsgList } from './MsgList'
import { AgentPresetChip } from './agent-preset-chip'
import { CHAT_VIEWS, CHAT_VIEW_STAT, CHAT_VIEW_UNIT, useChatView } from './chat-view'

import { ComposerRunBadge } from './composer-status'
/**
 * 正文阅读宽度 —— **复用宿主官方那套**：
 *   宿主对话区自带一对宽度把手（`[data-width-handle]`），把偏好存在
 *   `dsh.conversation.contentWidth`（px，下限 640，两侧把手+安全区共占 176px）。
 * 工作台把宿主那对把手藏了（否则会浮在面板上），所以这里用**同一个键、同一组数字**
 * 自己做一对把手：拖它就等于拖官方那个，读写互通，随时可调。
 */
const WIDTH_PREF_KEY = 'dsh.conversation.contentWidth'
const CONTENT_MIN = 640
const CONTENT_EDGE_BUDGET = 176
/** 默认值：以前的硬编码 920px（比下限宽一点，宽屏下一行不至于太长）。 */
const CONTENT_DEFAULT = 920

function readContentWidth(): number {
  try {
    const n = Number(window.localStorage.getItem(WIDTH_PREF_KEY))
    if (Number.isFinite(n) && n >= CONTENT_MIN) return n
  } catch {
    /* 忽略 */
  }
  return CONTENT_DEFAULT
}

/** 把宽度写到 :root 变量（所有面板共用一份）并落盘到宿主的偏好键。 */
function applyContentWidth(px: number): void {
  const v = Math.max(CONTENT_MIN, Math.round(px))
  document.documentElement.style.setProperty('--ts-chat-w', `${v}px`)
  try {
    window.localStorage.setItem(WIDTH_PREF_KEY, String(v))
  } catch {
    /* 忽略 */
  }
}

/**
 * 正文宽度把手（左右各一，拖动对称收放）。
 *
 * 方向：**往外拖 = 变宽**。左把手在正文列左缘，鼠标往左（dx<0）是往外 → 系数 -1；
 * 右把手在右缘，往右（dx>0）是往外 → 系数 +1。（第一版两个写反了，用户反馈「拖反了」。）
 * 交互与宿主一致：贴边细条、悬停才显形；拖动期间只改 CSS 变量，松手才落盘。
 */
function WidthHandles() {
  const drag = (side: 1 | -1) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = readContentWidth()
    // 面板可用宽度：拖到超过「面板宽 - 两侧预留」就停（同宿主 CONTENT_EDGE_BUDGET）
    const host = (e.currentTarget.parentElement as HTMLElement | null) ?? document.body
    const avail = host.getBoundingClientRect().width
    // 上限：面板宽 - 边距，但**绝不低于当前宽度** —— 窄面板下 max 会被
    // CONTENT_MIN 顶到 640（小于当前 920），若不加最后一项，往外拖反而把
    // 宽度夹小（用户反馈「拖动和实际是相反的，往外拖却变小了」）。
    const max = Math.max(CONTENT_MIN, avail - CONTENT_EDGE_BUDGET, startW)
    const move = (ev: PointerEvent) => {
      const next = Math.min(max, Math.max(CONTENT_MIN, startW + (ev.clientX - startX) * side))
      document.documentElement.style.setProperty('--ts-chat-w', `${Math.round(next)}px`)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const next = Math.min(max, Math.max(CONTENT_MIN, startW + (ev.clientX - startX) * side))
      applyContentWidth(next)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <>
      <div
        className="ts-chat-w ts-chat-w--left"
        data-desk-chat-w="left"
        title="左右拖动调整正文宽度（与宿主同一份偏好）"
        onPointerDown={drag(-1)}
      />
      <div
        className="ts-chat-w ts-chat-w--right"
        data-desk-chat-w="right"
        title="左右拖动调整正文宽度（与宿主同一份偏好）"
        onPointerDown={drag(1)}
      />
    </>
  )
}

export function MainChat({ sessionId, actions }: { sessionId: string; actions?: React.ReactNode }) {
  const [messages, setMessages] = useState<StreamMsg[]>([])
  // 镜头按**会话**分键（Step 13-C）：多项目并存时 A 切镜头不会改到 B；
  // 同一会话的面板/浮层两实例仍共用同一份真值。
  const [view, setView] = useChatView(sessionId)
  /**
   * 是否还能切换模式。
   *
   * 判据用「消息流里有没有真人发言」而不是宿主的 `session.blank`：工作台拿不到
   * 宿主的会话摘要（那是 uiWorkspace / sessions 的私有结构），而「跑过一轮」在
   * 消息流上必然表现为至少一条真人 user 消息——这与宿主拒切模式的真实条件一致。
   * 注入的 runtime-context 不算发言（它不是人发的，也不代表这轮开始了）。
   */
  const blank = !messages.some((m) => m.role === 'user' && !m.injected && !m.queued)
  const [history, setHistory] = useState<{ hasMore: boolean; loadingOlder: boolean }>({
    hasMore: false,
    loadingOlder: false,
  })

  useEffect(() => {
    if (!sessionId) {
      setMessages([])
      return
    }
    const un = subscribeSession(sessionId, (list) => setMessages(list))
    return () => un()
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) {
      setHistory({ hasMore: false, loadingOlder: false })
      return
    }
    return subscribeHistoryState(sessionId, (s) => {
      setHistory((prev) =>
        prev.hasMore === s.hasMore && prev.loadingOlder === s.loadingOlder ? prev : s,
      )
    })
  }, [sessionId])

  /**
   * 统计口径：
   *   user  = 我发的（**排除**宿主注入的上下文快照，那是运行时上下文不是我说的话）；
   *   agent = 助手回复——**不算**思考（reasoning）片段（它们单独折叠）；
   *   total = 消息总条数。
   */
  const stat = useMemo(() => {
    let user = 0
    let agent = 0
    for (const m of messages) {
      if (m.role === 'user') {
        if (!m.injected) user++
      } else if (m.role === 'assistant') {
        if (m.kind !== 'reasoning') agent++
      }
    }
    return { total: messages.length, user, agent }
  }, [messages])

  const shown = view === 'user' ? stat.user : view === 'agent' ? stat.agent : stat.total
  const unit = CHAT_VIEW_UNIT[view]

  const loadOlder = useCallback(async () => {
    if (!sessionId) return
    await loadOlderHistory(sessionId)
  }, [sessionId])

  /**
   * 滚动条自动隐藏：滚动时给容器打 `data-scrolling`（CSS 里才画 thumb），
   * 停下 900ms 淡出。滚动条颜色本身也是主题变量（白条在浅色主题下最刺眼）。
   */
  const scrollHideRef = useRef<number | null>(null)
  const onScrollArea = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.setAttribute('data-scrolling', '1')
    if (scrollHideRef.current) window.clearTimeout(scrollHideRef.current)
    scrollHideRef.current = window.setTimeout(() => {
      scrollHideRef.current = null
      el.removeAttribute('data-scrolling')
    }, 900)
  }

  // 启动时把偏好写到 :root（宿主那对把手改了宽度，这里回来也会读到同一份）
  useEffect(() => {
    applyContentWidth(readContentWidth())
  }, [])

  return (
    <div className="ts-mainchat">
      {/* 正文宽度把手：复用宿主官方的偏好键与数字 */}
      <WidthHandles />
      {/* 运行计时提醒：输入条左上角「深度求索中，用时…」（对齐原生对话 tab） */}
      <ComposerRunBadge sessionId={sessionId} messages={messages} />
      {/* 标题条：标题 + 中间信息（消息条数）居中，三键固定右上角 */}
      <div className="ts-mainchat-head">
        <span className="ts-head-title">DSH 主对话</span>
        {/* 模式选择器：宿主只在新会话 Hero 与它自己的会话标题行渲染这个入口，
            而工作台替换了宿主会话视图 → 那两处都不出现，这里自带一个。
            只有空白会话（还没跑过轮次）可切换，这是宿主的硬约束。 */}
        <AgentPresetChip sessionId={sessionId} editable={blank} />
        {/* 中间段 = 统计 + 视图开关：它两回答的是同一个问题——现在看的是哪一档、有多少 */}
        <span
          className="ts-head-mid ts-mainchat-mid"
          title={
            `当前视图「${CHAT_VIEWS.find((v) => v.id === view)?.label}」· 显示 ${shown} ${unit}（会话共 ${stat.total} 行 · 我发的 ${stat.user} · 模型回复 ${stat.agent}）\n` +
            CHAT_VIEWS.map((v) => `${v.label}：${v.desc}`).join('\n')
          }
        >
          <span className="ts-msgstat">
            <span className="ts-msgstat-k">{CHAT_VIEW_STAT[view]}</span>
            {shown}
          </span>
          <span className="ts-view-tabs" role="group" aria-label="阅读视图">
            {CHAT_VIEWS.map((v) => (
              <button
                key={v.id}
                className={`ts-view-tab${v.id === view ? ' is-on' : ''}`}
                aria-pressed={v.id === view}
                title={`${v.desc}\n（当前${v.id === view ? '已选' : '未选'}）`}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </span>
        </span>
        {actions}
      </div>
      <MsgList
        messages={messages}
        sessionId={sessionId}
        view={view}
        emptyText="在下方输入框发送消息，对话内容会实时显示在这里。"
        hasMore={history.hasMore}
        loadingOlder={history.loadingOlder}
        onLoadOlder={loadOlder}
        followKey={sessionId}
        onScroll={onScrollArea}
      />
    </div>
  )
}
