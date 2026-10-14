/**
 * 中下格：DSH 主对话只读消息流
 *
 * 会话记录原本只渲染在宿主的「对话」tab 里（工作台内发送消息不会自动切 tab），
 * 于是中下卡片看起来是空的。这里用与探索者窗口同一套订阅（session-subscribe
 * 的事件窗口快照）把当前会话的消息记录就地渲染出来，输入条仍由宿主原生
 * composer 停靠在本格底部（见 HDesk 的 useDockNativeComposer）。
 *
 * 只读：不复制宿主的发送/停止逻辑，避免与原生 composer 抢职责。
 *
 * 历史分页：事件窗口只带「最近一段」，更早的靠 session face 的 loadOlder 拉页
 * （契约见 session-subscribe 的 loadOlderHistory）。滚动到顶部时 MsgList 会
 * 请求下一页并保持滚动位置，形成瀑布式按需加载。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { subscribeSession, loadOlderHistory, subscribeHistoryState } from '../session-subscribe'
import type { StreamMsg } from '../session-subscribe'
import { MsgList } from './MsgList'
import { CHAT_VIEWS, CHAT_VIEW_STAT, CHAT_VIEW_UNIT, useChatView } from './chat-view'

interface HistoryState {
  hasMore: boolean
  loadingOlder: boolean
}

export function MainChat({ sessionId, actions }: { sessionId: string; actions?: React.ReactNode }) {
  const [messages, setMessages] = useState<StreamMsg[]>([])
  // 镜头按**会话**分键（Step 13-C）：多项目并存时 A 切镜头不会改到 B；
  // 同一会话的面板/浮层两实例仍共用同一份真值。
  const [view, setView] = useChatView(sessionId)
  const [history, setHistory] = useState<HistoryState>({ hasMore: false, loadingOlder: false })

  useEffect(() => {
    if (!sessionId) {
      setMessages([])
      return
    }
    const un = subscribeSession(sessionId, (list) => setMessages(list))
    return () => un()
  }, [sessionId])

  // 历史分页状态（宿主 session 快照的 hasMore / loadingOlder）。
  // 订阅要等 openStream 拿到 binding，subscribeHistoryState 内部会重试附加。
  useEffect(() => {
    if (!sessionId) {
      setHistory({ hasMore: false, loadingOlder: false })
      return
    }
    return subscribeHistoryState(sessionId, (s) => {
      // 值没变就不写 state，避免每次推送都重渲染整条消息流
      setHistory((prev) => (prev.hasMore === s.hasMore && prev.loadingOlder === s.loadingOlder ? prev : s))
    })
  }, [sessionId])

  /**
   * 标题条上的消息统计：按**当前视图**给一个数。
   *
   * 口径（与 MsgList 的收纳一致）：
   *   all   = 会话流里的全部行（用户/助手/工具/注入…）——与旧 msg 统计同口径；
   *   user  = 你发出的消息——**不算**宿主自动注入的上下文（运行时快照/技能目录等）；
   *   agent = 助手回复——**不算**思考（reasoning）片段（MsgList 单拎为「思考」）。
   *
   * 为什么跟着视图变：这个数就是「你现在看得见多少条」。固定显示总数时，
   * 切到「我的」却仍报 msg 137 会让人以为切换没生效（实际是口径不同）。
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

  return (
    <div className="ts-mainchat">
      {/* #3 标题条：标题 + 中间信息（消息条数）居中，三键固定右上角 */}
      <div className="ts-mainchat-head">
        <span className="ts-head-title">DSH 主对话</span>
        {/* 中间段 = 统计 + 视图开关，同一个 grid 格子里（grid 仍是 [标题][中][三键] 三段式）。
           两样东西本来就该在一起：它两回答的是同一个问题——「现在看的是哪一档、有多少」。 */}
        <span
          className="ts-head-mid ts-mainchat-mid"
          title={`当前视图「${CHAT_VIEWS.find((v) => v.id === view)?.label}」· 显示 ${shown} ${unit}`
            + `（会话共 ${stat.total} 行 · 我发的 ${stat.user} · 模型回复 ${stat.agent}）`
            + '\n\n' + CHAT_VIEWS.map((v) => `${v.label}：${v.desc}`).join('\n')}
        >
          <span className="ts-msgstat"><span className="ts-msgstat-k">{CHAT_VIEW_STAT[view]}</span>{shown}</span>
          {/* 视图开关（全部 / 我的 / 回复）：三档互斥，当前档高亮，键盘可达。 */}
          <span className="ts-view-tabs" role="group" aria-label="阅读视图">
            {CHAT_VIEWS.map((v) => (
              <button
                key={v.id}
                className={`ts-view-tab${v.id === view ? ' is-on' : ''}`}
                aria-pressed={v.id === view}
                title={`${v.desc}\n（当前${v.id === view ? '已选' : '未选'}）`}
                onClick={() => setView(v.id)}
              >{v.label}</button>
            ))}
          </span>
        </span>
        {actions}
      </div>
      <MsgList
        messages={messages}
        view={view}
        emptyText="在下方输入框发送消息，对话内容会实时显示在这里。"
        hasMore={history.hasMore}
        loadingOlder={history.loadingOlder}
        onLoadOlder={loadOlder}
        followKey={sessionId}
      />
    </div>
  )
}
