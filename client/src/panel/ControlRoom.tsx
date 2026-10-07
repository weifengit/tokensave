/**
 * 项目中心（conversation.view 入口）
 *
 * 两种展示方式 + 三种排序方式（用户要求）：
 *   展示：卡片模式（点卡片直接进工作台）/ 列表模式（表格：序号/名称/路径/创建/更新/介绍/操作）
 *   排序：按项目名称 / 按创建时间 / 按更新时间
 * 偏好存 localStorage（store 的 ViewPrefs），不污染项目数据。
 *
 * 视觉：参照 dsh-worktable 的「控制室」——玻璃卡片 + 网格底 + 缓慢漂移的
 * 彩光光晕，配色全部走半透明中性色，深浅主题都自适应（不依赖宿主主题探测）。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { injectProjectCenterStyles } from './styles'
import {
  loadProjects, removeProject, recallOpenedProject, rememberOpenedProject,
  loadViewPrefs, saveViewPrefs, sortProjects, touchProject,
} from './store'
import type { ProjectRecord, ViewMode, SortMode } from './store'
import {
  latestProjectSession, sessionBelongsToProject, onRequestProjectList,
  onRequestWorkbench, setControlRoomScreen, isForceList,
} from './sessions'
import { getClientContext } from '../session-subscribe'
import { fetchProjectInfo } from './api'
import type { ProjectInfo } from './api'
import { AddProjectDialog } from './AddProjectDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { HDesk } from './HDesk'

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

export function ControlRoom({ sessionId }: Props) {
  useEffect(() => { injectProjectCenterStyles() }, [])

  const [projects, setProjects] = useState<ProjectRecord[]>([])

  const [showAdd, setShowAdd] = useState(false)
  const [openedId, setOpenedId] = useState<string | null>(null)
  // 展示方式 + 排序方式（持久化为 UI 偏好）
  const [prefs, setPrefs] = useState(() => loadViewPrefs())
  const [busyId, setBusyId] = useState<string | null>(null)
  // 待确认移除的项目（null 表示不显示确认弹窗）
  const [pendingRemove, setPendingRemove] = useState<ProjectRecord | null>(null)
  // 项目信息（真实文件 mtime + 推断的开发服务器地址），按 path 缓存
  const [infos, setInfos] = useState<Record<string, ProjectInfo>>({})
  const setPref = (patch: Partial<{ mode: ViewMode; sort: SortMode }>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    saveViewPrefs(next)
  }
  // 项目信息（真实 mtime）按 path 缓存；用于排序与展示
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

  // 拉取每个项目的真实文件 mtime + 开发服务器地址。
  // 失败不影响列表渲染（fetchProjectInfo 内部已兜错）。
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

  // 会话重挂（切换会话/刷新页面）后恢复上次打开的工作台。
  // 记忆只是 UI 偏好；真正“看哪个会话”由 HDesk 按项目自己解析（见 #1）。
  const [bindingError, setBindingError] = useState<string | null>(null)
  // 会话 → 工作台 自动绑定由 client/src/index.ts 的 Probe（始终挂载）负责；
  // 这里不重复扫描（ControlRoom 只在本视图已激活时才挂载，无法自举）。

  // 恢复上次打开的工作台（记忆只是 UI 偏好；会话归属由 HDesk 自己解析）
  // 若处于“强制列表”态则不恢复（用户刚点了按钮要回列表）。
  useEffect(() => {
    if (!sessionId) return
    if (isForceList()) return
    const remembered = recallOpenedProject(sessionId)
    if (!remembered) return
    if (!loadProjects().some((p) => p.id === remembered)) {
      rememberOpenedProject(sessionId, null)
      return
    }
    setOpenedId(remembered)
  }, [sessionId])

  // 侧边栏「项目中心」按钮是**切换**语义，两个方向都要处理：
  //   列表 ← 工作台：requestProjectList（清掉记忆，停在列表）
  //   工作台 ← 列表：requestWorkbench（恢复上次打开的项目）
  // 用订阅而非挂载时读标记：用户可能**已经**在本视图内（不会重挂），
  // 只有订阅才能收到信号。
  useEffect(() => onRequestProjectList(() => {
    // 切到列表：**不清**工作台记忆（切回来要知道回哪个项目），只显示列表
    setOpenedId(null)
    setBindingError(null)
  }), [sessionId])

  useEffect(() => onRequestWorkbench((targetSid) => {
    setBindingError(null)
    // 跨会话导航（侧边栏点到另一个会话）：此时 prop 还是旧 sessionId，
    // 恢复旧会话的项目没有意义；等 [sessionId] 恢复 effect 接手即可。
    if (targetSid && sessionId && targetSid !== sessionId) return
    const remembered = sessionId ? recallOpenedProject(sessionId) : null
    if (remembered && loadProjects().some((p) => p.id === remembered)) {
      setOpenedId(remembered)
      return
    }
    // 没有记忆（例如刚从列表态清掉）：退而取第一个项目，保证“再点一次能回去”
    const first = loadProjects()[0]
    if (first) {
      setOpenedId(first.id)
      if (sessionId) rememberOpenedProject(sessionId, first.id)
    }
  }), [sessionId])

  const openDesk = (id: string | null) => {
    setOpenedId(id)
    setBindingError(null)
    if (id) {
      // 进入工作台 = 使用过这个项目 → 刷新“上次更新时间”
      touchProject(id)
      refresh()
    } else if (sessionId) {
      // 退回项目列表时清除记忆，避免刷新后又被拉回工作台
      rememberOpenedProject(sessionId, null)
    }
  }

  /**
   * 「展示」：打开**项目自身启动后的 UI**（开发服务器地址）。
   *
   * 语义（用户明确要求）：不是进工作台，而是打开该项目跑起来之后的界面。
   * 因此：拿到 devUrl 且探测到端口在监听 → 新标签页打开；
   * 否则**无响应**（不报错、不弹窗，用户说“暂时无响应即可”）。
   */
  const showProject = async (p: ProjectRecord) => {
    const info = infoOf(p)
    const url = info?.devUrl || ''
    const running = info?.devRunning === true
    if (!url || !running) {
      // 未启动（或未推断出地址）：无响应
      console.log('[tokensave] 项目未启动，展示无响应:', p.name, url || '(未推断出地址)')
      return
    }
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      console.warn('[tokensave] 展示失败', e)
    }
  }

  /** 移除项目：**先弹确认弹窗**（破坏性操作），确认后才真删。 */
  const dropProject = (p: ProjectRecord) => setPendingRemove(p)

  /** 确认弹窗点「移除」后执行。 */
  const confirmRemove = () => {
    if (!pendingRemove) return
    removeProject(pendingRemove.id)
    setPendingRemove(null)
    refresh()
  }

  const opened = openedId ? projects.find((p) => p.id === openedId) : undefined

  // 项目中心（列表态）打开时，把同一套流光玻璃背景延伸到主聊天输入框及其下方区域。
  //
  // 原因：输入条座位 [data-conversation-region="composer"] 与本视图是**兄弟节点**
  // （同在 [data-conversation-scroll] 内），且自带不透明渐变底 —— 视图内部的背景
  // 永远盖不到它，必须在这一层（共享滚动容器）处理。
  // 进入工作台时 opened 不为空，类名移除，不影响 H 台。
  const openedKey = opened?.id ?? ''
  // 上报当前屏，供侧边栏按钮决定切换方向（列表 ⇄ 工作台）。
  useEffect(() => {
    setControlRoomScreen(openedKey ? 'desk' : 'list')
  }, [openedKey])
  useEffect(() => {
    if (openedKey) return
    document.body.classList.add('ts-center-open')
    return () => document.body.classList.remove('ts-center-open')
  }, [openedKey])

  // —— H 型工作台 ——（仅在会话确实属于该项目时展示）
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
                title="列表模式：表格展示全部信息"
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

        {bindingError && (
          <div className="ts-hint ts-hint-warn">⚠️ {bindingError}</div>
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
          /* —— 列表模式：序号 / 名称 / 路径 / 创建 / 更新 / 介绍 / 操作 —— */
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
                  <th className="ts-plist-ops">操作</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p, i) => (
                  <tr key={p.id}>
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
                      <span className="ts-plist-desc" title={p.description}>
                        {p.description || <span className="ts-dim">（未填写）</span>}
                      </span>
                    </td>
                    <td className="ts-plist-ops">
                      <button
                        className="ts-btn ts-btn-sm"
                        disabled={busyId === p.id}
                        onClick={() => showProject(p)}
                        title="在宿主的原生 DSH 界面中打开该项目"
                      >{busyId === p.id ? '打开中…' : '展示'}</button>
                      <button
                        className="ts-btn ts-btn-sm ts-btn-danger"
                        onClick={() => dropProject(p)}
                        title="从项目中心移除（不影响磁盘文件）"
                      >移除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* —— 卡片模式：点卡片直接进工作台，不再需要「进入工作台」按钮 —— */
          <div className="ts-center-grid">
            {shown.map((p) => (
              <div
                key={p.id}
                className={`ts-center-card ts-center-card-click${sessionId ? '' : ' disabled'}`}
                role="button"
                tabIndex={0}
                title={sessionId ? `进入「${p.name}」工作台` : '当前会话上下文不可用，无法进入工作台'}
                onClick={() => { if (sessionId) openDesk(p.id) }}
                onKeyDown={(e) => {
                  if (!sessionId) return
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDesk(p.id) }
                }}
              >
                <div className="ts-center-cardhead">
                  <span className="ts-center-icon">📁</span>
                  <span className="ts-center-name" title={p.name}>{p.name}</span>
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
                    className="ts-btn ts-btn-sm"
                    disabled={busyId === p.id}
                    onClick={(e) => { e.stopPropagation(); showProject(p) }}
                    title="在宿主的原生 DSH 界面中打开该项目"
                  >{busyId === p.id ? '打开中…' : '展示'}</button>
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
            openDesk(record.id)
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
