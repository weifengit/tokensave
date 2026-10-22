/**
 * 项目中心 tab（conversation.view，id = tokensave-project-center）
 *
 * 真正的「项目中心」= 项目列表本身：两种展示方式 + 三种排序（偏好持久化）。
 *   展示：卡片模式 / 列表模式（表格：序号/名称/路径/创建/上次更新/项目介绍/活跃/操作）
 *   排序：按项目名称 / 按创建时间 / 按更新时间
 *
 * 进入工作台的入口（均调 enterProjectWorkbench，进的是**该项目当前会话**的工作台）：
 *   - 卡片模式：点整张卡片
 *   - 列表模式：点整条记录行
 *   - 卡片模式：启动情况标的「● 已启动」本身就是调试**超链接**（悬停时变成「去调试 →」），
 *     点它进工作台并要求「项目预览 + DSH 主对话」两个窗口**并存**（intent='debug'）
 *
 * 「＋ 新会话」按钮（卡片与列表两种模式**一致**）：在该项目下开一个新对话
 * （复用已有空白会话，没有则创建）并直接进入它的工作台（详见 sessions.startProjectSession）。
 * 这样从「侧边栏徽标新会话 → 项目中心 → 选项目」这条链路点下去就是一条全新对话。
 *
 * 活跃标识：每行/每卡片显示该项目下活跃对话的序号点 ①②③（绿=活跃，黄=待确认）；
 * **点某个序号点 = 直接进入那条对话的工作台**（见 ActivityDots.onPick）。
 *
 * 项目介绍在列表模式里行内可编辑，失焦/回车即写回 localStorage。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { injectProjectCenterStyles } from './styles'
import {
  loadProjects, removeProject, loadViewPrefs, saveViewPrefs, sortProjects, subscribeProjects, syncProjectsFromServer,
  updateProjectDescription,
  toggleProjectStatus,
} from './store'
import type { ProjectRecord, ViewMode, SortMode } from './store'
import { enterProjectWorkbench, getCurrentSessionId, setControlRoomScreen, startProjectSession } from './sessions'
import { useProjectsActivity } from './activity'
import type { SessionActivity } from './activity'
import { deleteProjectSource, fetchProjectInfo } from './api'
import type { ProjectInfo } from './api'
import { AddProjectDialog } from './AddProjectDialog'

// 项目中心可能先于工作台挂载（它俩都吃主题变量）：这里也把调色板装上、并跟随宿主主题。
installThemeCss()
startThemeWatch()
// 皮肤目录与工作台共用一份（skins.ts 写 :root 变量，项目中心与 .ts-dock 同时生效）
import { installThemeCss, startThemeWatch } from './theme'
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
  // 勾选「同时删除项目源代码」——勾上后确认会先删盘再固化移除（见 confirmRemove）
  const [deleteSource, setDeleteSource] = useState(false)
  // 移除确认进行中（删除源代码是长操作，防连点 + 锁按钮）
  const [removing, setRemoving] = useState(false)
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
  /**
   * 列表排序：时间类优先用**真实文件 mtime**，拿不到再回退到本地记录。
   * 「创建于」用文件夹内**最老**文件时间（不是加入项目中心的时间）；
   * 「更新于」用**最新**文件时间。
   */
  const shown = useMemo(() => {
    const withTime = projects.map((p) => {
      const info = infos[p.path]
      const newest = info?.mtimeMs || 0
      const oldest = info?.oldestMtimeMs || 0
      return {
        ...p,
        ...(newest > 0 ? { updatedAt: newest } : {}),
        ...(oldest > 0 ? { createdAt: oldest } : {}),
      }
    })
    return sortProjects(withTime, prefs.sort)
  }, [projects, infos, prefs.sort])

  const refresh = () => setProjects(loadProjects())
  useEffect(() => {
    // 跨来源同步：手机端经 dsh-remote-mobile 网关访问时来源与桌面端不同，
    // 据服务端注册表水合出与桌面端一致的清单——这是「手机端项目中心为空」的修复。
    const un = subscribeProjects(setProjects)
    const pull = () => { void syncProjectsFromServer().then(() => refresh()) }
    pull()
    window.addEventListener('focus', pull)
    return () => { un(); window.removeEventListener('focus', pull) }
  }, [])

  // 列表态的流光玻璃背景要覆盖到宿主的输入条座位（与视图是兄弟节点，见 styles.ts）；
  // 同时上报“当前在项目中心”，供侧边栏按钮决定切换方向。
  useEffect(() => {
    setControlRoomScreen('list')
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

  /**
   * 进入该项目的工作台；带 targetSessionId 时直接落到那条对话（序号点用）；
   * intent='debug' 时同时要求「项目预览 + DSH 主对话」两窗并存（卡片上的「去调试」）。
   */
  const enter = (p: ProjectRecord, targetSessionId?: string, intent?: 'debug') => {
    // 优先用宿主当前会话（侧边栏入口可能比 sessionId prop 更新）；都没有才放弃
    const current = sessionId || getCurrentSessionId() || ''
    if (!current && !targetSessionId) return
    if (enterProjectWorkbench(p.id, targetSessionId, intent)) refresh()
  }

  /** 正在「新会话」的项目 id（防连点） */
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4_000)
    return () => window.clearTimeout(timer)
  }, [notice])

  /**
   * 「＋ 新会话」：在该项目下开一个新对话（复用已有空白会话，没有则创建），
   * 并直接进入它的工作台——与工作台顶部那个「＋ 新建会话」完全同款。
   */
  const newSession = async (p: ProjectRecord) => {
    if (busyId) return
    setBusyId(p.id)
    setNotice(null)
    try {
      const res = await startProjectSession(p.path, p.id)
      if (!res.ok) setNotice(`新建会话失败：${res.error}`)
      else refresh()
    } finally {
      setBusyId(null)
    }
  }

  /** 移除项目：**先弹确认弹窗**（破坏性操作），确认后才真删。 */
  const dropProject = (p: ProjectRecord) => {
    setDeleteSource(false)
    setRemoving(false)
    setPendingRemove(p)
  }
  const confirmRemove = () => {
    if (!pendingRemove || removing) return
    const victim = pendingRemove
    if (!deleteSource) {
      removeProject(victim.id)
      setPendingRemove(null)
      refresh()
      return
    }
    // 勾了「删除项目源代码」：先删盘（失败则中断，项目保持原样），成功后再固化移除。
    // removeProject 会记下「移除墓碑」（id + 路径），服务端与各来源从此都不会把它加回来。
    setRemoving(true)
    deleteProjectSource(victim.path)
      .then(() => {
        removeProject(victim.id)
        setPendingRemove(null)
        refresh()
        setNotice(`已移除项目并删除源代码：${victim.name}`)
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        setNotice(`删除源代码失败：${msg}（项目未移除）`)
      })
      .finally(() => setRemoving(false))
  }

  /**
   * 翻牌：切换项目状态并持久化。
   *
   * 卡片本身不需要本地 state —— 状态存在项目记录里（store.toggleProjectStatus），
   * 写回后 refresh() 触发重渲染，class 一变 CSS 自己就把动画演完。
   * 这样「翻过去 → 刷新页面 → 还是背面」是一致的（不会刷新就弹回正面）。
   */
  const toggleStatus = (id: string) => {
    toggleProjectStatus(id)
    refresh()
  }

  /**
   * 卡片的一面（翻牌的两面共用同一份内容，只有「状态呈现」不同）。
   *
   * 为什么两面都渲染完整内容，而不是背面只放一个「已完成」：
   *   翻过去的背面如果只剩状态字样，用户在完成态下就点不到「＋ 新会话 / 移除 /
   *   进入工作台」了。翻牌是**呈现状态**，不是把卡片换成一张不能用的卡。
   * 所以两面只差三处：图标（📁 / ✅）、状态胶囊（进行中 / 已完成）、背面多一条
   * 「✓ 已完成」横条；底色/描边那套区分配色在 CSS（.ts-flip-back）。
   */
  const cardFace = (p: ProjectRecord, back: boolean) => (
    <>
      <div className="ts-center-cardhead">
        <span className="ts-center-icon" aria-hidden="true">{back ? '✅' : '📁'}</span>
        <span className="ts-center-name" title={p.name}>{p.name}</span>
        <ActivityDots items={activity[p.id]} onPick={(sid) => enter(p, sid)} />
        {/* 翻牌按钮放在标题行最右 = 卡片右上角（用户指定的位置）。
            两面各自持有自己的按钮：正面那枚在翻过去后随正面一起背向隐藏，
            不会出现「翻到背面就点不回来」。必须先 stopPropagation，
            否则会连带触发整卡的「进入工作台」。 */}
        <button
          type="button"
          className="ts-flip-btn"
          aria-pressed={back}
          title={back ? '翻回去：改回「进行中」' : '翻牌：标记为「完成」'}
          onClick={(e) => { e.stopPropagation(); toggleStatus(p.id) }}
        >{back ? '↺ 翻回' : '↻ 翻牌'}</button>
      </div>
      <div className="ts-center-path" title={p.path}>
        <span className="ts-center-basedir">{baseName(p.path)}</span>
        <span className="ts-center-fullpath">{p.path}</span>
      </div>
      <div className="ts-center-desc" title={p.description}>
        {p.description || <span className="ts-dim">（未填写项目介绍）</span>}
      </div>
      <div className="ts-center-meta">
        <span className="ts-tag" title="项目文件夹内最老文件的修改时间">创建于 {infoOf(p)?.oldestMtimeMs ? formatCreated(infoOf(p)!.oldestMtimeMs) : '—'}</span>
        <span className="ts-tag ts-tag-warn">更新于 {relTime(infoOf(p)?.mtimeMs || 0)}</span>
        {/* 卡片上**不放**状态胶囊（用户反馈：胶囊把卡片顶高了）：
            状态由翻牌本身表达 —— 背面绿配色 + 「✓ 已完成」横条 + 右上角按钮文案。
            想在卡片上直接改状态的，点右上角那枚按钮（title 里写清了当前状态）。 */}
      </div>
      <div className="ts-center-actions">
        {/* 启动情况（与两个按钮同排不跨行）：
            未启动 → 灰标，只看不点；
            已启动 → 同一枚小标升级成**超链接**：悬停显示「去调试 →」，
              点它进该项目的工作台调试（预览 + DSH 主对话两窗并存）。
            两段文字叠在同一格里（宽度取较大者），悬停不挤动后面的按钮。 */}
        {infoOf(p)?.devRunning ? (
          <a
            className="ts-dev-chip on ts-dev-chip-link"
            role="link"
            tabIndex={sessionId ? 0 : -1}
            title={`开发服务器正在监听 · 点它进入「${p.name}」的工作台调试（项目预览 + DSH 主对话）`}
            onClick={(e) => {
              // 别让卡片自己的「进入工作台」也接一手（那会按默认布局再进一次）
              e.stopPropagation()
              enter(p, undefined, 'debug')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                enter(p, undefined, 'debug')
              }
            }}
          >
            <span className="ts-dev-chip-state">● 已启动</span>
            <span className="ts-dev-chip-go">去调试 →</span>
          </a>
        ) : (
          <span
            className="ts-dev-chip"
            title="未检测到开发服务器；在项目里跑起来后工作台会自动出现预览"
          >○ 未启动</span>
        )}
        <button
          className="ts-btn ts-btn-sm ts-btn-primary"
          disabled={busyId === p.id}
          onClick={(e) => { e.stopPropagation(); void newSession(p) }}
          title={`在「${p.name}」下开一个新对话，并直接进入它的工作台`}
        >{busyId === p.id ? '新建中…' : '＋ 新会话'}</button>
        <button
          className="ts-btn ts-btn-sm ts-btn-danger"
          onClick={(e) => { e.stopPropagation(); dropProject(p) }}
          title="从项目中心移除（弹窗里可勾选「删除项目源代码」把文件夹一起删掉）"
        >移除</button>
      </div>
    </>
  )


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
            <div className="ts-seg ts-seg-mode" role="group" aria-label="展示方式">
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
            <div className="ts-seg ts-seg-sort" role="group" aria-label="排序方式">
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
              <button
                className={`ts-seg-btn${prefs.sort === 'status' ? ' active' : ''}`}
                onClick={() => setPref({ sort: 'status' })}
                title="按完成情况：进行中在前、已完成在后（同组按创建时间倒序）"
              >按完成情况</button>
            </div>
            <span className="ts-center-count">{projects.length} 个项目</span>
          </div>
        )}

        {!sessionId && (
          <div className="ts-hint">当前会话上下文不可用，无法进入工作台（仍可管理项目列表）。</div>
        )}

        {notice && <div className="ts-hint">⚠️ {notice}</div>}

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
                  <th className="ts-plist-time" title="项目文件夹内最老文件的修改时间（不是加入项目中心的时间）">创建于</th>
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
                      // 只在**整行自己**被聚焦时响应：行内的「＋ 新会话 / 移除 / 状态胶囊」
                      // 的回车与空格会冒泡到这里 —— 旧写法会让它们顺带把「进入工作台」也触发一次。
                      if (e.target !== e.currentTarget) return
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enter(p) }
                    }}
                  >
                    <td className="ts-plist-idx">{i + 1}</td>
                    <td>
                      <div className="ts-plist-namecell">
                        <span className="ts-plist-name" title={p.name}>{p.name}</span>
                        <button
                          type="button"
                          className={`ts-status-chip${p.status === 'done' ? ' is-done' : ''}`}
                          title={p.status === 'done' ? '当前：已完成（点它翻回「进行中」）' : '当前：进行中（点它标记为「已完成」）'}
                          onClick={(e) => { e.stopPropagation(); toggleStatus(p.id) }}
                        >{p.status === 'done' ? '已完成' : '进行中'}</button>
                      </div>
                    </td>
                    <td>
                      <span className="ts-plist-path" title={p.path}>{p.path}</span>
                    </td>
                    <td
                      className="ts-plist-time"
                      title={`项目文件夹内最老文件的修改时间：${infoOf(p)?.oldestMtimeMs ? new Date(infoOf(p)!.oldestMtimeMs).toLocaleString('zh-CN') : '（未读取到）'}`}
                    >
                      {infoOf(p)?.oldestMtimeMs ? formatCreated(infoOf(p)!.oldestMtimeMs) : <span className="ts-dim">（未读取到）</span>}
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
                        disabled={busyId === p.id}
                        onClick={(e) => { e.stopPropagation(); void newSession(p) }}
                        title={`在「${p.name}」下开一个新对话，并直接进入它的工作台`}
                      >{busyId === p.id ? '新建中…' : '＋ 新会话'}</button>
                      <button
                        className="ts-btn ts-btn-sm ts-btn-danger"
                        onClick={(e) => { e.stopPropagation(); dropProject(p) }}
                        title="从项目中心移除（弹窗里可勾选「删除项目源代码」把文件夹一起删掉）"
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
                className={`ts-flip-scene ts-center-card-click${sessionId ? '' : ' disabled'}`}
                role="button"
                tabIndex={0}
                title={sessionId
                  ? `进入「${p.name}」工作台（右上角「翻牌」切换 进行中 / 完成）`
                  : '当前会话上下文不可用，无法进入工作台'}
                onClick={() => enter(p)}
                onKeyDown={(e) => {
                  if (!sessionId) return
                  // 同上（卡片模式）：只在卡片自己被聚焦时才算「进入工作台」。
                  // 否则翻牌按钮聚焦后敲回车 = 翻牌 + 同时进工作台（用户反馈的现象之一）。
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enter(p) }
                }}
              >
                {/* 翻牌：外层负责透视、内层负责旋转，两面**叠在同一个网格格里**
                    （高度由两面中较高的一面决定，见 styles.ts 的 .ts-flip-scene 注释）。
                    状态是唯一数据源：status === 'done' 就是翻到背面。 */}
                <div className={`ts-flip-inner${p.status === 'done' ? ' is-done' : ''}`}>
                  <div className="ts-center-card ts-flip-face ts-flip-front">{cardFace(p, false)}</div>
                  <div className="ts-center-card ts-flip-face ts-flip-back">{cardFace(p, true)}</div>
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
          confirmText={deleteSource ? '删除并移除' : '确认移除'}
          busy={removing}
          message={(
            <>
              <div className="ts-confirm-lead">确定要把以下项目从<b>项目中心</b>移除吗？</div>
              <div className="ts-confirm-target">
                <span className="ts-confirm-name">📁 {pendingRemove.name}</span>
                <span className="ts-confirm-path">{pendingRemove.path}</span>
              </div>
              {deleteSource ? (
                <div className="ts-confirm-note ts-confirm-note-warn">
                  将<b>永久删除</b>该项目的<b>整个文件夹</b>（连文件夹本身一起删掉，含 .git 与未提交的修改），<b>不可恢复</b>。
                </div>
              ) : (
                <div className="ts-confirm-note">
                  仅从项目中心的列表里移除，<b>不会删除磁盘上的任何文件</b>。
                  之后可以重新「添加项目」把它加回来。
                </div>
              )}
              <label className="ts-confirm-opt">
                <input
                  type="checkbox"
                  checked={deleteSource}
                  onChange={(e) => setDeleteSource(e.target.checked)}
                />
                <span className="ts-confirm-opt-text">
                  同时<b>删除项目源代码</b>（把项目文件夹从磁盘上整棵删掉，不可恢复）
                </span>
              </label>
            </>
          )}
          onCancel={() => setPendingRemove(null)}
          onConfirm={confirmRemove}
        />
      )}
    </div>
  )
}
