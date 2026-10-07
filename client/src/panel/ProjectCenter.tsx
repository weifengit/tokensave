/**
 * 项目中心 tab（conversation.view，id = tokensave-project-center）
 *
 * 真正的「项目中心」= 项目列表本身：两种展示方式 + 三种排序（偏好持久化）。
 *   展示：卡片模式 / 列表模式（表格：序号/名称/路径/创建/上次更新/项目介绍/活跃/操作）
 *   排序：按项目名称 / 按创建时间 / 按更新时间
 *
 * 三个进入工作台的入口**行为完全一致**（都调 enterProjectWorkbench）：
 *   - 卡片模式：点整张卡片
 *   - 列表模式：点整条记录行
 *   - 两种模式里的「进入工作台」按钮
 *
 * 活跃标识：每行/每卡片显示该项目下活跃对话的序号点 ①②③（绿=活跃，黄=待确认）；
 * **点某个序号点 = 直接进入那条对话的工作台**（见 ActivityDots.onPick）。
 *
 * 项目介绍在列表模式里行内可编辑，失焦/回车即写回 localStorage。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { injectProjectCenterStyles } from './styles'
import {
  loadProjects, removeProject, loadViewPrefs, saveViewPrefs, sortProjects,
  updateProjectDescription,
} from './store'
import type { ProjectRecord, ViewMode, SortMode } from './store'
import { enterProjectWorkbench, getCurrentSessionId } from './sessions'
import { useProjectsActivity } from './activity'
import type { SessionActivity } from './activity'
import { fetchProjectInfo } from './api'
import type { ProjectInfo } from './api'
import { AddProjectDialog } from './AddProjectDialog'
import { ConfirmDialog } from './ConfirmDialog'

interface Props {
  sessionId?: string
}

function formatCreated(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** 相对时间（“3 分钟前”），列表里比完整时间戳更易读。 */
function relTime(ms: number): string {
  if (!ms) return '—'
  const d = Date.now() - ms
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)} 天前`
  return new Date(ms).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

/** 目录名（卡片标题下的次要行用尾段，避免整条长路径挤爆卡片）。 */
function baseName(p: string): string {
  const parts = String(p || '').split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : p
}

/** 带圈序号 ①..⑳；超过 20 个活跃对话时退化为 (21) 这类写法（不常见的边角）。 */
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']
function dotLabel(n: number): string {
  return CIRCLED[n - 1] ?? `(${n})`
}

/**
 * 活跃对话序号点。
 *
 * 非活跃对话不会出现在 items 里（见 activity.ts），所以这里只渲染「该亮的点」；
 * items 为空时**什么都不渲染**（没有对话 / 没有活跃对话 → 无序号标注）。
 * 点某个点 = 进入那条对话的工作台。
 */
function ActivityDots({
  items,
  onPick,
}: {
  items?: SessionActivity[]
  onPick: (sessionId: string) => void
}) {
  if (!items || items.length === 0) return null
  const tip = items
    .map((a) => `${dotLabel(a.order)} ${a.state === 'pending' ? '待你确认' : '正在活跃'} · ${a.title}`)
    .join('\n')
  return (
    <span className="ts-dots" title={`${tip}\n\n点序号可直接进入对应对话的工作台`}>
      {items.map((a) => (
        <button
          key={a.sessionId}
          type="button"
          className={`ts-dot ts-dot-${a.state}`}
          title={`${dotLabel(a.order)} · ${a.state === 'pending' ? '待你确认' : '正在活跃'}：${a.title}`}
          aria-label={`进入「${a.title}」的工作台`}
          onClick={(e) => {
            // 点序号只进那条对话，不要顺带触发行/卡片的「进入工作台」
            e.stopPropagation()
            onPick(a.sessionId)
          }}
        >{dotLabel(a.order)}</button>
      ))}
    </span>
  )
}

/**
 * 列表模式的【项目介绍】行内编辑。
 *
 * 交互：单击进入编辑态 → 回车/失焦保存，Esc 取消；
 * 编辑期间的点按/按键都不冒泡，避免误触「点整行进工作台」。
 */
function DescEditor({ project, onSaved }: { project: ProjectRecord; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(project.description)

  const begin = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft(project.description)
    setEditing(true)
  }
  const commit = () => {
    setEditing(false)
    if (draft.trim() === project.description.trim()) return
    if (updateProjectDescription(project.id, draft)) onSaved()
  }

  if (!editing) {
    return (
      <span
        className="ts-plist-desc ts-desc-editable"
        title={project.description || '点击填写项目介绍'}
        onClick={begin}
      >
        {project.description || <span className="ts-dim">点击填写…</span>}
      </span>
    )
  }
  return (
    <input
      className="ts-input ts-desc-input"
      autoFocus
      value={draft}
      placeholder="例如：个人博客，Next.js + MDX，部署在 Vercel"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === 'Escape') {
          setEditing(false)
        }
      }}
    />
  )
}

export function ProjectCenter({ sessionId }: Props) {
  useEffect(() => { injectProjectCenterStyles() }, [])

  const [projects, setProjects] = useState<ProjectRecord[]>(() => loadProjects())
  const [showAdd, setShowAdd] = useState(false)
  // 展示方式 + 排序方式（持久化为 UI 偏好）
  const [prefs, setPrefs] = useState(() => loadViewPrefs())
  // 待确认移除的项目（null 表示不显示确认弹窗）
  const [pendingRemove, setPendingRemove] = useState<ProjectRecord | null>(null)
  // 项目信息（真实文件 mtime + 推断的开发服务器地址），按 path 缓存
  const [infos, setInfos] = useState<Record<string, ProjectInfo>>({})
  // 活跃对话序号点（会话目录 / 会话状态变化时自动刷新）
  const activity = useProjectsActivity(projects)

  const setPref = (patch: Partial<{ mode: ViewMode; sort: SortMode }>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    saveViewPrefs(next)
  }
  const infoOf = (p: ProjectRecord): ProjectInfo | undefined => infos[p.path]
  /** 列表排序：时间类优先用**真实文件 mtime**，拿不到再回退到本地记录。 */
  const shown = useMemo(() => {
    const withTime = projects.map((p) => {
      const m = infos[p.path]?.mtimeMs || 0
      return m > 0 ? { ...p, updatedAt: m } : p
    })
    return sortProjects(withTime, prefs.sort)
  }, [projects, infos, prefs.sort])

  const refresh = () => setProjects(loadProjects())
  useEffect(() => { refresh() }, [])

  // 列表态的流光玻璃背景要覆盖到宿主的输入条座位（与视图是兄弟节点，见 styles.ts）
  useEffect(() => {
    document.body.classList.add('ts-center-open')
    return () => document.body.classList.remove('ts-center-open')
  }, [])

  // 拉取每个项目的真实文件 mtime + 开发服务器地址。失败不影响列表渲染
  // （fetchProjectInfo 内部已兜错）。
  useEffect(() => {
    let alive = true
    const paths = projects.map((p) => p.path)
    if (paths.length === 0) return
    ;(async () => {
      const pairs = await Promise.all(
        paths.map(async (path) => [path, await fetchProjectInfo(path)] as const)
      )
      if (!alive) return
      const next: Record<string, ProjectInfo> = {}
      for (const [path, info] of pairs) if (info) next[path] = info
      setInfos(next)
    })()
    return () => { alive = false }
    // projects 变化（增删项目）时重新拉
  }, [projects])

  /** 进入该项目的工作台；带 targetSessionId 时直接落到那条对话（序号点用）。 */
  const enter = (p: ProjectRecord, targetSessionId?: string) => {
    // 优先用宿主当前会话（侧边栏入口可能比 sessionId prop 更新）；都没有才放弃
    const current = sessionId || getCurrentSessionId() || ''
    if (!current && !targetSessionId) return
    if (enterProjectWorkbench(p.id, targetSessionId)) refresh()
  }

  /** 移除项目：**先弹确认弹窗**（破坏性操作），确认后才真删。 */
  const dropProject = (p: ProjectRecord) => setPendingRemove(p)
  const confirmRemove = () => {
    if (!pendingRemove) return
    removeProject(pendingRemove.id)
    setPendingRemove(null)
    refresh()
  }

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
            <div className="ts-center-sub">
              添加项目文件夹 → 进入工作台：并行免费模型探索 + 共享黑板 + 协作收益
            </div>
          </div>
        </div>

        {/* 工具条：展示方式切换（卡片/列表）+ 排序方式切换 */}
        {projects.length > 0 && (
          <div className="ts-center-toolbar">
            <div className="ts-seg" role="group" aria-label="展示方式">
              <button
                className={`ts-seg-btn${prefs.mode === 'card' ? ' active' : ''}`}
                onClick={() => setPref({ mode: 'card' })}
                title="卡片模式：点卡片直接进入工作台"
              >▦ 卡片</button>
              <button
                className={`ts-seg-btn${prefs.mode === 'list' ? ' active' : ''}`}
                onClick={() => setPref({ mode: 'list' })}
                title="列表模式：表格展示全部信息（点记录行进工作台，项目介绍可就地编辑）"
              >☰ 列表</button>
            </div>
            <div className="ts-seg" role="group" aria-label="排序方式">
              <span className="ts-seg-label">排序</span>
              <button
                className={`ts-seg-btn${prefs.sort === 'name' ? ' active' : ''}`}
                onClick={() => setPref({ sort: 'name' })}
              >按名称</button>
              <button
                className={`ts-seg-btn${prefs.sort === 'created' ? ' active' : ''}`}
                onClick={() => setPref({ sort: 'created' })}
              >按创建时间</button>
              <button
                className={`ts-seg-btn${prefs.sort === 'updated' ? ' active' : ''}`}
                onClick={() => setPref({ sort: 'updated' })}
              >按更新时间</button>
            </div>
            <span className="ts-center-count">{projects.length} 个项目</span>
          </div>
        )}

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
        ) : prefs.mode === 'list' ? (
          /* —— 列表模式：序号 / 名称 / 路径 / 创建 / 上次更新 / 介绍 / 活跃 / 操作 ——
             点整行 = 进入工作台；介绍可编辑；（点）活跃点可直达对应对话 */
          <div className="ts-plist-wrap">
            <table className="ts-plist">
              <thead>
                <tr>
                  <th className="ts-plist-idx">序号</th>
                  <th>项目名称</th>
                  <th>项目路径</th>
                  <th className="ts-plist-time">创建时间</th>
                  <th className="ts-plist-time">上次更新</th>
                  <th>项目介绍</th>
                  <th className="ts-plist-active">活跃对话</th>
                  <th className="ts-plist-ops">操作</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p, i) => (
                  <tr
                    key={p.id}
                    className="ts-plist-row-click"
                    tabIndex={0}
                    title={sessionId ? `进入「${p.name}」工作台` : '当前会话上下文不可用，无法进入工作台'}
                    onClick={() => enter(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enter(p) }
                    }}
                  >
                    <td className="ts-plist-idx">{i + 1}</td>
                    <td>
                      <span className="ts-plist-name" title={p.name}>{p.name}</span>
                    </td>
                    <td>
                      <span className="ts-plist-path" title={p.path}>{p.path}</span>
                    </td>
                    <td className="ts-plist-time" title={new Date(p.createdAt).toLocaleString('zh-CN')}>
                      {formatCreated(p.createdAt)}
                    </td>
                    <td className="ts-plist-time" title={infoOf(p)?.mtimeMs ? new Date(infoOf(p)!.mtimeMs).toLocaleString('zh-CN') : '（未读取到）'}>
                      {relTime(infoOf(p)?.mtimeMs || 0)}
                    </td>
                    <td>
                      <DescEditor project={p} onSaved={refresh} />
                    </td>
                    <td className="ts-plist-active">
                      <ActivityDots items={activity[p.id]} onPick={(sid) => enter(p, sid)} />
                    </td>
                    <td className="ts-plist-ops">
                      <button
                        className="ts-btn ts-btn-sm ts-btn-primary"
                        onClick={(e) => { e.stopPropagation(); enter(p) }}
                        title="进入该项目的工作台（与点击整行一致）"
                      >进入工作台</button>
                      <button
                        className="ts-btn ts-btn-sm ts-btn-danger"
                        onClick={(e) => { e.stopPropagation(); dropProject(p) }}
                        title="从项目中心移除（不影响磁盘文件）"
                      >移除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* —— 卡片模式：点卡片直接进工作台 —— */
          <div className="ts-center-grid">
            {shown.map((p) => (
              <div
                key={p.id}
                className={`ts-center-card ts-center-card-click${sessionId ? '' : ' disabled'}`}
                role="button"
                tabIndex={0}
                title={sessionId ? `进入「${p.name}」工作台` : '当前会话上下文不可用，无法进入工作台'}
                onClick={() => enter(p)}
                onKeyDown={(e) => {
                  if (!sessionId) return
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enter(p) }
                }}
              >
                <div className="ts-center-cardhead">
                  <span className="ts-center-icon">📁</span>
                  <span className="ts-center-name" title={p.name}>{p.name}</span>
                  <ActivityDots items={activity[p.id]} onPick={(sid) => enter(p, sid)} />
                  <span className="ts-center-enterhint">进入 →</span>
                </div>
                <div className="ts-center-path" title={p.path}>
                  <span className="ts-center-basedir">{baseName(p.path)}</span>
                  <span className="ts-center-fullpath">{p.path}</span>
                </div>
                <div className="ts-center-desc" title={p.description}>
                  {p.description || <span className="ts-dim">（未填写项目介绍）</span>}
                </div>
                <div className="ts-center-meta">
                  <span className="ts-tag">创建于 {formatCreated(p.createdAt)}</span>
                  <span className="ts-tag ts-tag-warn">更新于 {relTime(infoOf(p)?.mtimeMs || 0)}</span>
                  {infoOf(p)?.devRunning && <span className="ts-tag ts-tag-live">● 已启动</span>}
                </div>
                <div className="ts-center-actions">
                  <button
                    className="ts-btn ts-btn-sm ts-btn-primary"
                    onClick={(e) => { e.stopPropagation(); enter(p) }}
                    title="进入该项目的工作台（与点击整张卡片一致）"
                  >进入工作台</button>
                  <button
                    className="ts-btn ts-btn-sm ts-btn-danger"
                    onClick={(e) => { e.stopPropagation(); dropProject(p) }}
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
            enter(record)
          }}
        />
      )}

      {/* 移除项目：先弹确认弹窗（破坏性操作），确认后才真删 */}
      {pendingRemove && (
        <ConfirmDialog
          title="移除项目"
          danger
          confirmText="确认移除"
          message={(
            <>
              <div className="ts-confirm-lead">确定要把以下项目从<b>项目中心</b>移除吗？</div>
              <div className="ts-confirm-target">
                <span className="ts-confirm-name">📁 {pendingRemove.name}</span>
                <span className="ts-confirm-path">{pendingRemove.path}</span>
              </div>
              <div className="ts-confirm-note">
                仅从项目中心的列表里移除，<b>不会删除磁盘上的任何文件</b>。
                之后可以重新「添加项目」把它加回来。
              </div>
            </>
          )}
          onCancel={() => setPendingRemove(null)}
          onConfirm={confirmRemove}
        />
      )}
    </div>
  )
}
