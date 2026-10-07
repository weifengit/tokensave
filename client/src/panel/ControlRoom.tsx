/**
 * 项目中心（conversation.view 入口）
 * 项目卡片列表 + 「添加项目」弹窗（选文件夹即可，布局固定 H 型 1 种）；
 * 点「进入工作台」切换到 H 型布局。
 *
 * 视觉：参照 dsh-worktable 的「控制室」——玻璃卡片 + 网格底 + 缓慢漂移的
 * 彩光光晕，配色全部走半透明中性色，深浅主题都自适应（不依赖宿主主题探测）。
 */
import React, { useEffect, useState } from 'react'
import { injectProjectCenterStyles } from './styles'
import { loadProjects, removeProject, recallOpenedProject, rememberOpenedProject } from './store'
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

/** 目录名（卡片标题下的次要行用尾段，避免整条长路径挤爆卡片）。 */
function baseName(p: string): string {
  const parts = String(p || '').split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : p
}

export function ControlRoom({ sessionId }: Props) {
  useEffect(() => { injectProjectCenterStyles() }, [])

  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [openedId, setOpenedId] = useState<string | null>(null)

  const refresh = () => setProjects(loadProjects())
  useEffect(() => { refresh() }, [])

  // 会话重挂（切换会话/刷新页面）后恢复上次打开的工作台：按会话 id 记忆
  useEffect(() => {
    if (!sessionId) return
    const remembered = recallOpenedProject(sessionId)
    setOpenedId((current) => {
      if (current && loadProjects().some((p) => p.id === current)) return current
      if (remembered && loadProjects().some((p) => p.id === remembered)) return remembered
      return current
    })
  }, [sessionId])

  const openDesk = (id: string | null) => {
    setOpenedId(id)
    // 记忆/清除「该会话打开的工作台」—— 切会话后仍停在同一个项目
    if (sessionId) rememberOpenedProject(sessionId, id)
  }

  const opened = openedId ? projects.find((p) => p.id === openedId) : undefined

  // —— H 型工作台 ——
  if (opened && sessionId) {
    return (
      <HDesk
        project={opened}
        sessionId={sessionId}
        onBack={() => openDesk(null)}
      />
    )
  }

  // —— 项目列表 ——
  return (
    <div className="ts-cr ts-center">
      <div className="ts-center-bg" aria-hidden="true">
        <span className="ts-center-blob ts-center-blob1" />
        <span className="ts-center-blob ts-center-blob2" />
        <span className="ts-center-blob ts-center-blob3" />
      </div>

      <div className="ts-center-inner">
        <div className="ts-center-head">
          <div className="ts-center-headtext">
            <div className="ts-center-title">🎛 项目中心</div>
            <div className="ts-center-sub">添加项目文件夹 → 进入工作台：并行免费模型探索 + 共享黑板 + 协作收益</div>
          </div>
          <button
            className="ts-btn ts-btn-primary ts-center-add"
            onClick={() => setShowAdd(true)}
          >＋ 添加项目</button>
        </div>

        {!sessionId && (
          <div className="ts-hint">当前会话上下文不可用，无法进入工作台（仍可管理项目列表）。</div>
        )}

        {projects.length === 0 ? (
          <div className="ts-center-emptywrap">
            <button className="ts-center-addcard" onClick={() => setShowAdd(true)}>
              <span className="ts-center-addplus">＋</span>
              <span className="ts-center-addlabel">添加项目</span>
              <span className="ts-center-addhint">选择项目文件夹开始</span>
            </button>
          </div>
        ) : (
          <div className="ts-center-grid">
            {projects.map((p) => (
              <div key={p.id} className="ts-center-card">
                <div className="ts-center-cardhead">
                  <span className="ts-center-icon">📁</span>
                  <span className="ts-center-name" title={p.name}>{p.name}</span>
                </div>
                <div className="ts-center-path" title={p.path}>
                  <span className="ts-center-basedir">{baseName(p.path)}</span>
                  <span className="ts-center-fullpath">{p.path}</span>
                </div>
                <div className="ts-center-meta">
                  <span className="ts-tag ts-tag-warn">创建于 {formatCreated(p.createdAt)}</span>
                </div>
                <div className="ts-center-actions">
                  <button
                    className="ts-btn ts-btn-primary ts-center-enter"
                    disabled={!sessionId}
                    onClick={() => openDesk(p.id)}
                  >进入工作台 →</button>
                  <button
                    className="ts-btn ts-btn-danger"
                    onClick={() => { removeProject(p.id); refresh() }}
                    title="从项目中心移除（不影响磁盘文件）"
                  >移除</button>
                </div>
              </div>
            ))}
            <button className="ts-center-card ts-center-addcard" onClick={() => setShowAdd(true)}>
              <span className="ts-center-addplus">＋</span>
              <span className="ts-center-addlabel">添加项目</span>
            </button>
          </div>
        )}
      </div>

      {showAdd && (
        <AddProjectDialog
          onClose={() => setShowAdd(false)}
          onCreated={(record) => {
            refresh()
            setShowAdd(false)
            openDesk(record.id)
          }}
        />
      )}
    </div>
  )
}
