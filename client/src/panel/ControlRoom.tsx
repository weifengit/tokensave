/**
 * 项目中心（conversation.view 入口）
 * 项目卡片列表 + 「添加项目」弹窗（选文件夹即可，布局固定 H 型 1 种）；
 * 点「进入工作台」切换到 H 型布局
 */
import React, { useEffect, useState } from 'react'
import { injectProjectCenterStyles } from './styles'
import { loadProjects, removeProject } from './store'
import type { ProjectRecord } from './store'
import { AddProjectDialog } from './AddProjectDialog'
import { HDesk } from './HDesk'

interface Props {
  sessionId?: string
}

function formatCreated(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function ControlRoom({ sessionId }: Props) {
  useEffect(() => { injectProjectCenterStyles() }, [])

  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [openedId, setOpenedId] = useState<string | null>(null)

  const refresh = () => setProjects(loadProjects())
  useEffect(() => { refresh() }, [])

  const opened = openedId ? projects.find((p) => p.id === openedId) : undefined

  // —— H 型工作台 ——
  if (opened && sessionId) {
    return (
      <HDesk
        project={opened}
        sessionId={sessionId}
        onBack={() => setOpenedId(null)}
      />
    )
  }

  // —— 项目列表 ——
  return (
    <div className="ts-cr">
      <div className="ts-bar">
        <span className="ts-title">🎛 项目中心</span>
        <span className="ts-sub">管理你的项目：添加文件夹 → 进入 H 型工作台</span>
        <button
          className="ts-btn ts-btn-primary"
          style={{ marginLeft: 'auto' }}
          onClick={() => setShowAdd(true)}
        >➕ 添加项目</button>
      </div>

      {!sessionId && (
        <div className="ts-hint">当前会话上下文不可用，无法进入工作台（仍可管理项目列表）。</div>
      )}

      {projects.length === 0 ? (
        <div className="ts-empty">
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎛</div>
          <div>还没有项目。点击右上角「添加项目」，选择项目文件夹开始。</div>
        </div>
      ) : (
        <div className="ts-proj-grid">
          {projects.map((p) => (
            <div key={p.id} className="ts-proj-card">
              <div className="ts-proj-name">{p.name}</div>
              <div className="ts-proj-path">{p.path}</div>
              <div className="ts-proj-meta">
                <span className="ts-tag">H 型工作台</span>
                <span className="ts-tag ts-tag-warn">创建于 {formatCreated(p.createdAt)}</span>
              </div>
              <div className="ts-proj-actions">
                <button
                  className="ts-btn ts-btn-primary"
                  disabled={!sessionId}
                  onClick={() => setOpenedId(p.id)}
                >进入工作台 →</button>
                <button
                  className="ts-btn ts-btn-danger"
                  onClick={() => { removeProject(p.id); refresh() }}
                  title="从项目中心移除（不影响磁盘文件）"
                >移除</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddProjectDialog
          onClose={() => setShowAdd(false)}
          onCreated={(record) => {
            refresh()
            setShowAdd(false)
            setOpenedId(record.id)
          }}
        />
      )}
    </div>
  )
}
