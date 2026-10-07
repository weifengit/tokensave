/**
 * 工作台顶部的项目预览（原「展示」的内嵌 iframe）。
 *
 * 位置：项目标题行（项目名 + 历史会话 + 新建会话那一行）**之下**、其它窗口**之上**；
 * 与 DSH 主对话之间有一条可上下拖动的分隔条（见 HDesk 的 .ts-vsplit）。
 *
 * 显隐由 HDesk 决定（项目能给出可用 devUrl 才渲染），本组件只负责画：
 *   - 标题行：标题 / 地址 / 启动标记 | 刷新 / 新窗口 | 最小化 / 最大化 / 关闭（最右）
 *   - 正文：iframe 填满剩余高度
 * 三个窗口键复用工作台的卡片状态机（actions 由 HDesk 传入），因此这里不带状态。
 */
import React from 'react'
import type { ProjectRecord } from './store'

/** 把 devUrl 解析成 iframe 可用的绝对地址（解析失败就用原值，交给浏览器按文档源解析）。 */
export function absoluteUrl(raw: string): string {
  if (!raw) return ''
  if (!raw.startsWith('/')) return raw
  try {
    return new URL(raw, window.location.origin).href
  } catch {
    return raw
  }
}

export function PreviewPanel({
  project,
  url,
  devRunning,
  actions,
  reloadKey = 0,
  onReload,
}: {
  project: ProjectRecord
  url: string
  devRunning?: boolean
  /** 窗口三键（最小化 / 最大化 / 关闭），由 HDesk 的卡片状态机提供 */
  actions?: React.ReactNode
  /** 刷新计数：变化即重挂 iframe */
  reloadKey?: number
  onReload: () => void
}) {
  const openExternal = () => {
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      console.warn('[tokensave] 新窗口打开失败', e)
    }
  }
  return (
    <section className="ts-preview-panel">
      <div className="ts-preview-bar">
        <span className="ts-preview-title">🖥 项目预览</span>
        <span className="ts-preview-url" title={url}>{url}</span>
        {devRunning && <span className="ts-tag ts-tag-live">● 已启动</span>}
        <span className="ts-preview-ops">
          <button
            type="button"
            className="ts-btn ts-btn-sm"
            onClick={onReload}
            title="刷新内嵌预览"
          >刷新</button>
          <button
            type="button"
            className="ts-btn ts-btn-sm"
            onClick={openExternal}
            title="在新标签页打开（站点带 X-Frame-Options 时用它）"
          >新窗口</button>
        </span>
        {actions}
      </div>
      <iframe
        key={reloadKey}
        className="ts-preview-frame"
        src={url}
        title={`${project.name} 预览`}
      />
    </section>
  )
}
