/**
 * 探索者窗口卡（H 型工作台左右两竖的免费大模型窗口）
 * - 最小化（—）：折叠为仅标题条
 * - 最大化（□）：提升为覆盖整个工作台的浮层
 * - 双击标题：同最大化并尝试浏览器全屏 API（失败则停留在浮层）
 * 状态全部由工作台父级持有（提升渲染时组件位置变化不丢状态）
 */
import React, { useEffect, useRef } from 'react'
import { subscribeSession } from '../session-subscribe'
import type { StreamMsg } from '../session-subscribe'
import { MsgList } from './MsgList'
import type { TelemetrySession } from './api'

export interface ExplorerWindowProps {
  session: TelemetrySession
  /** 去掉 tokensave- 前缀的展示名 */
  label: string
  collapsed: boolean
  /** 正在以工作台浮层形式渲染 */
  overlay: boolean
  overlayRef?: React.RefObject<HTMLDivElement | null>
  onCollapse: (id: string) => void
  onOverlay: (id: string) => void
  onExitOverlay: () => void
  onHide: (id: string) => void
}

export function ExplorerWindow({
  session, label, collapsed, overlay, overlayRef,
  onCollapse, onOverlay, onExitOverlay, onHide,
}: ExplorerWindowProps) {
  const [messages, setMessages] = React.useState<StreamMsg[]>([])
  const localRef = useRef<HTMLDivElement>(null)
  const ref = overlay ? (overlayRef ?? localRef) : localRef
  const running = session.state === 'running'

  useEffect(() => {
    const un = subscribeSession(session.id, (list) => setMessages(list))
    return () => un()
  }, [session.id])

  const handleHeadDoubleClick = () => {
    onOverlay(session.id)
    // 双击升级为浏览器全屏；不支持或被拒时停留在工作台浮层
    const el = localRef.current
    const anyEl = el as any
    if (typeof anyEl?.requestFullscreen === 'function') {
      anyEl.requestFullscreen().catch(() => { /* 停留浮层 */ })
    }
  }

  return (
    <div
      className={`ts-win${collapsed && !overlay ? ' collapsed' : ''}${overlay ? ' ts-win-overlay' : ''}`}
      ref={ref}
    >
      <div className="ts-win-head" onDoubleClick={handleHeadDoubleClick} title="双击全屏">
        <span className={`ts-win-dot${running ? '' : ' idle'}`} />
        <span className="ts-win-name">🔍 {label}</span>
        <span className="ts-head-mid ts-win-mid">{messages.length} 条消息</span>
        {overlay ? (
          <span>
            <button className="ts-icon-btn" onClick={onExitOverlay} title="退出全屏">✕</button>
          </span>
        ) : (
          <span>
            <button
              className="ts-icon-btn"
              onClick={() => collapsed ? onOverlay(session.id) : onCollapse(session.id)}
              title={collapsed ? '展开' : '最小化'}
            >{collapsed ? '□' : '—'}</button>
            <button className="ts-icon-btn" onClick={() => onOverlay(session.id)} title="最大化">⛶</button>
            <button className="ts-icon-btn" onClick={() => onHide(session.id)} title="隐藏窗口">✕</button>
          </span>
        )}
      </div>
      {(!collapsed || overlay) && (
        <div className="ts-win-body">
          <MsgList messages={messages} emptyText="等待该探索者响应…" />
        </div>
      )}
    </div>
  )
}
