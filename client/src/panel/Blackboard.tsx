/**
 * 共享黑板（H 型工作台中上区）
 * 按工作区拉取 /plugins/dsh-tokensave/board；中文主题标签；点击条目展开正文
 */
import React, { useCallback, useEffect, useState } from 'react'
import { fetchBoard } from './api'
import type { BoardEntry } from './api'
import { RichText } from './RichText'

const TOPICS: Array<{ id: string; name: string; cls: string }> = [
  { id: 'requirement', name: '需求', cls: 'ts-topic-req' },
  { id: 'pitfall', name: '坑', cls: 'ts-topic-pit' },
  { id: 'solution', name: '方案', cls: 'ts-topic-sol' },
  { id: 'brief', name: '简报', cls: 'ts-topic-brief' },
]

function formatAge(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(ms).toLocaleDateString('zh-CN')
}

const BRIEF_MARK_START = '<!-- tokensave-brief:v1:start -->'
const BRIEF_MARK_END = '<!-- tokensave-brief:v1:end -->'

/** 简报条目去掉同步标记，只留正文 */
function stripBriefMarks(content: string): string {
  const i = content.indexOf(BRIEF_MARK_START)
  const j = content.indexOf(BRIEF_MARK_END)
  if (i >= 0 && j > i) {
    return content.slice(i + BRIEF_MARK_START.length, j).trim()
  }
  return content
}

export function Blackboard({ workspace, actions }: { workspace: string; actions?: React.ReactNode }) {
  const [entries, setEntries] = useState<BoardEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTopic, setActiveTopic] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const payload = await fetchBoard(workspace)
      setEntries(payload.entries)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '黑板加载失败')
    } finally {
      setLoading(false)
    }
  }, [workspace])

  useEffect(() => {
    setExpandedId(null)
    load()
    const timer = setInterval(() => load(true), 20_000)
    return () => clearInterval(timer)
  }, [load])

  const counts: Record<string, number> = {}
  for (const e of entries) counts[e.topic] = (counts[e.topic] || 0) + 1
  const shown = activeTopic === 'all' ? entries : entries.filter((e) => e.topic === activeTopic)

  return (
    <div className="ts-board">
      {/* #3 标题条：标题 + 中间信息（全部/需求/坑/方案/简报/条数）居中，
          三键（—/⛶/✕）固定右上角。actions 容器用 order 排到最后。 */}
      <div className="ts-board-head">
        <span className="ts-head-title">共享黑板</span>
        <div className="ts-board-tabs">
          <button
            className={`ts-board-tab${activeTopic === 'all' ? ' active' : ''}`}
            onClick={() => setActiveTopic('all')}
          >全部 {entries.length}</button>
          {TOPICS.map((t) => (
            <button
              key={t.id}
              className={`ts-board-tab${activeTopic === t.id ? ' active' : ''}`}
              onClick={() => setActiveTopic(t.id)}
            >{t.name} {counts[t.id] || 0}</button>
          ))}
        </div>
        {actions}
      </div>
      <div className="ts-board-list">
        {loading && <div className="ts-hint">加载中…</div>}
        {error && <div className="ts-hint">⚠️ {error}</div>}
        {!loading && !error && shown.length === 0 && (
          <div className="ts-hint">暂无黑板条目。运行 tokensave_delegate 后，需求/坑/方案/简报会出现在这里。</div>
        )}
        {shown.map((entry) => {
          const topic = TOPICS.find((t) => t.id === entry.topic)
          const dim = entry.status !== 'active'
          const expanded = expandedId === entry.id
          const content = entry.topic === 'brief' ? stripBriefMarks(entry.content) : entry.content
          return (
            <div
              key={entry.id}
              className={`ts-entry${dim ? ' dim' : ''}`}
              onClick={() => setExpandedId(expanded ? null : entry.id)}
            >
              <div className="ts-entry-head">
                <span className={`ts-tag${topic ? ` ${topic.cls}` : ''}`}>{entry.topicLabel}</span>
                <span className="ts-entry-title">{entry.title}</span>
                <span className="ts-entry-time">
                  {dim ? (entry.status === 'expired' ? '已过期' : '已归档') : formatAge(entry.createdAtMs)}
                </span>
              </div>
              {expanded && (
                <div className="ts-entry-body">
                  <RichText text={content} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
