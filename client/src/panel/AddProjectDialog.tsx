/**
 * 「添加项目」弹窗：两种来源，同一个落点（addProject(name, path, desc)）。
 *
 *   ① 本地已有目录：目录浏览器选路径（原行为）；
 *   ② 从 GitHub 克隆：选好父目录 + 填仓库地址，服务端跑 git clone，
 *      完成后拿到的目录直接当项目路径。
 *
 * 两种来源共用：目录浏览器、项目名称、项目介绍、底部主按钮。
 * 克隆是长任务（可能数十秒），故启动后拿 taskId 轮询 /clone-status 显示进度。
 *
 * 除了「浏览已有目录 → 选择当前文件夹」，还支持直接在浏览器里
 *   - 「＋ 新建文件夹」：在当前目录下建一个新目录（名字即新项目名），建完自动选中；
 *   - 「✏️ 重命名」：把**已选中**的文件夹改名（同目录内），改名后自动选中新路径，
 *     项目名称若仍是旧文件夹名也会跟着更新。
 * 这些都走后端写路由 POST /plugins/dsh-tokensave/mkdir（只允许单层目录名、不覆盖）。
 */
import React, { useCallback, useEffect, useState } from 'react'
import { fetchDirectory, createFolder, renameFolder, cloneRepo, fetchCloneStatus } from './api'
import type { FsEntry, CloneStatus } from './api'
import { addProject } from './store'
import type { ProjectRecord } from './store'

interface Props {
  onClose: () => void
  onCreated: (project: ProjectRecord) => void
}

/** 取路径的最后一段（文件夹名）。 */
function baseName(p: string): string {
  const parts = String(p || '').split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

/** 取父目录（根目录的父目录仍是根）。 */
function dirName(p: string): string {
  const clean = String(p || '').replace(/\/+$/, '')
  const idx = clean.lastIndexOf('/')
  if (idx <= 0) return '/'
  const parent = clean.slice(0, idx)
  // Windows 盘符根：'C:/foo' 的父目录是 'C:/'（而不是 isAbsolute 为假的 'C:'）
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent
}

/** 把展示路径拆成面包屑段（Windows 盘符根 "C:/" → ["C:"]；POSIX "/Users/me" → ["Users","me"]）。 */
function crumbsOf(p: string): string[] {
  return String(p || '').split('/').filter(Boolean)
}

/** 面包屑第 index 段对应的绝对路径；盘符段（"C:"）要补出 "C:/"，其余补前导 "/"。 */
function crumbPath(crumbs: string[], index: number): string {
  const head = crumbs.slice(0, index + 1).join('/')
  if (/^[A-Za-z]:$/.test(head)) return `${head}/`
  return /^[A-Za-z]:/.test(head) ? head : `/${head}`
}

/** 路径所属的文件系统根（Windows 盘符根 "C:/" 或 POSIX "/"）。 */
function rootOf(p: string): string {
  const m = /^([A-Za-z]):/.exec(String(p || ''))
  return m ? `${m[1].toUpperCase()}:/` : '/'
}

export function AddProjectDialog({ onClose, onCreated }: Props) {
  const [cwd, setCwd] = useState<string>('')
  const [parent, setParent] = useState<string | null>(null)
  const [roots, setRoots] = useState<string[]>([])
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [fsError, setFsError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  // —— 新建 / 重命名文件夹 ——
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // —— 从 GitHub 克隆 ——
  /** 项目来源：'local' 选已有目录（原行为） | 'clone' 从 GitHub 拉一个仓。 */
  const [source, setSource] = useState<'local' | 'clone'>('local')
  const [repoUrl, setRepoUrl] = useState('')
  /** 克隆目标父目录（复用上面的目录浏览器：浏览到哪就是哪个）。 */
  const [cloneParent, setCloneParent] = useState<string | null>(null)
  /** 用户手填的目标文件夹名；空 = 用仓库名自动推导。 */
  const [cloneName, setCloneName] = useState('')
  const [cloneTaskId, setCloneTaskId] = useState<string | null>(null)
  const [cloneStatus, setCloneStatus] = useState<CloneStatus | null>(null)
  const [cloneLog, setCloneLog] = useState<string[]>([])
  const [cloneStarting, setCloneStarting] = useState(false)
  /** 克隆完成后得到的目录（已写进 cloneStatus.path，单独存一份用于确认）。 */
  const clonePending = Boolean(cloneTaskId) && cloneStatus?.state === 'running'

  const load = useCallback(async (path?: string) => {
    setLoading(true)
    setFsError(null)
    try {
      const listing = await fetchDirectory(path)
      setCwd(listing.path)
      setParent(listing.parent)
      setRoots(listing.roots)
      setEntries(listing.entries)
    } catch (e) {
      setFsError(e instanceof Error ? e.message : '目录读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const crumbs = crumbsOf(cwd)
  const gotoCrumb = (index: number) => {
    load(crumbPath(crumbs, index))
    setSelectedPath(null)
  }

  const enterDir = (entry: FsEntry) => {
    load(entry.path)
    setSelectedPath(null)
  }

  const pickCurrent = () => {
    // 选中 / 取消 循环：再次点击同一目录即取消选择
    if (selectedPath === cwd) {
      setSelectedPath(null)
      return
    }
    setSelectedPath(cwd)
    if (!name) setName(cwd.split('/').pop() || '')
  }

  // 目录浏览器与克隆共用：浏览到哪，哪个目录就是「克隆到这里」。
  // 用 cwd（而不是 selectedPath）——克隆时选的是**父目录**，不是项目目录本身。
  useEffect(() => { setCloneParent(cwd || null) }, [cwd])

  /** 推导默认文件夹名（与服务端 deriveRepoName 同规则，仅用于界面预览）。 */
  const repoNameFrom = (url: string): string => {
    const cleaned = String(url || '').trim().replace(/[#?].*$/, '').replace(/\/+$/, '')
    const tail = cleaned.split(/[/:]/).filter(Boolean).pop() || ''
    return tail.replace(/\.git$/i, '')
  }

  /** 启动克隆，随后轮询进度。 */
  const doClone = async () => {
    const url = repoUrl.trim()
    if (!url || !cloneParent || cloneStarting || clonePending) return
    setCloneStarting(true)
    setActionError(null)
    setCloneLog([])
    try {
      const started = await cloneRepo(cloneParent, url, cloneName.trim() || undefined)
      setCloneTaskId(started.taskId)
      setCloneStatus({
        taskId: started.taskId,
        state: 'running',
        phase: '正在准备',
        percent: 0,
        message: '',
        path: started.path,
        lines: [],
      })
      // 仓库名当作项目名（用户没改过的话），与「选目录」的默认行为一致。
      setName((prev) => prev.trim() || started.name || repoNameFrom(url))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '克隆启动失败')
    } finally {
      setCloneStarting(false)
    }
  }

  /**
   * 轮询克隆进度。
   *
   * 三个要点：
   *   ① 只在 running 时轮询；一旦 done/error/cancelled 就停（并做清理）；
   *   ② 组件卸载 / 关闭弹窗同样要停（cleanup 清定时器），不能泄漏；
   *   ③ 轮询失败不断死磕——连着几次拿不到就当作任务丢失（服务端重启了）。
   */
  useEffect(() => {
    if (!cloneTaskId) return
    let stopped = false
    let misses = 0
    const tick = async () => {
      if (stopped) return
      try {
        const status = await fetchCloneStatus(cloneTaskId)
        if (stopped) return
        misses = 0
        setCloneStatus(status)
        if (status.lines.length) {
          setCloneLog((prev) => [...prev, ...status.lines].slice(-200))
        }
        if (status.state !== 'running') return // 终态：本轮不再排下一个定时器
      } catch {
        misses += 1
        // 服务端重启会把内存里的任务弄丢（404）；连续几次就放弃轮询。
        if (misses >= 3) {
          setCloneStatus((prev) => prev
            ? { ...prev, state: 'error', message: '克隆任务已丢失（服务端可能已重启），请重试' }
            : prev)
          return
        }
      }
      if (!stopped) timer = setTimeout(tick, 700)
    }
    let timer = setTimeout(tick, 400)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [cloneTaskId])

  /** 克隆成功 → 把那个目录当作项目路径（名字/介绍沿用表单）。 */
  const finishClone = () => {
    const dir = cloneStatus?.path || ''
    if (!dir) return
    const record = addProject(name.trim() || repoNameFrom(repoUrl), dir, description)
    onCreated(record)
  }

  const confirm = () => {
    if (!selectedPath) return
    const record = addProject(name.trim(), selectedPath, description)
    onCreated(record)
  }

  /** 在当前目录下新建文件夹；建完刷新列表并自动选中它（名字即新项目名）。 */
  const doCreate = async () => {
    const folder = newName.trim()
    if (!folder || folderBusy) return
    setFolderBusy(true)
    setActionError(null)
    try {
      const created = await createFolder(cwd, folder)
      setNewOpen(false)
      setNewName('')
      await load(cwd)
      if (created.path) {
        setSelectedPath(created.path)
        setName((prev) => prev.trim() || created.name || folder)
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '新建文件夹失败')
    } finally {
      setFolderBusy(false)
    }
  }

  /** 把已选中的文件夹改名（同目录内），随后选中新路径。 */
  const doRename = async () => {
    const next = renameName.trim()
    const from = selectedPath ? baseName(selectedPath) : ''
    if (!selectedPath || !from || !next || folderBusy) return
    if (next === from) {
      setRenameOpen(false)
      return
    }
    setFolderBusy(true)
    setActionError(null)
    try {
      const renamed = await renameFolder(dirName(selectedPath), from, next)
      setRenameOpen(false)
      await load(cwd)
      if (renamed.path) {
        setSelectedPath(renamed.path)
        // 项目名称还跟着旧文件夹名时，一并改成新名（用户改过就不动）
        setName((prev) => (prev.trim() === from ? next : prev))
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '重命名失败')
    } finally {
      setFolderBusy(false)
    }
  }

  return (
    <div className="ts-modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ts-modal ts-modal-addproj">
        <div className="ts-modal-head">
          <span>➕ 添加项目</span>
          <button className="ts-icon-btn" onClick={onClose} title="关闭">✕</button>
        </div>
        <div className="ts-modal-body">
          {/* 来源切换：本地已有目录 / 从 GitHub 克隆 */}
          <div className="ts-srcpick">
            <button
              className={`ts-srcbtn${source === 'local' ? ' ts-srcbtn-on' : ''}`}
              onClick={() => setSource('local')}
              disabled={clonePending}
              title="选择一个已有的本地目录作为项目"
            >📁 本地已有目录</button>
            <button
              className={`ts-srcbtn${source === 'clone' ? ' ts-srcbtn-on' : ''}`}
              onClick={() => setSource('clone')}
              disabled={clonePending}
              title="从 GitHub 克隆一个仓库，克隆完直接作为项目"
            >🐙 从 GitHub 克隆</button>
          </div>
          {/* 选择项目文件夹 */}
          <div>
            <label className="ts-field-label">
              {source === 'clone' ? '克隆到哪个目录（浏览选择父目录）' : '选择项目文件夹'}
            </label>
            <div className="ts-fs">
              <div className="ts-fs-crumb">
                <div className="ts-fs-crumbs">
                  <span className="ts-fs-rooticon" onClick={() => load(roots[0])} title="根目录">🖥</span>
                  {crumbs.map((c, i) => (
                    <React.Fragment key={i}>
                      <span onClick={() => gotoCrumb(i)}>{c}</span>
                      {i < crumbs.length - 1 && <span className="ts-fs-sep">/</span>}
                    </React.Fragment>
                  ))}
                </div>
                {roots.length > 1 && roots.map((r) => (
                  <span
                    key={r}
                    className={`ts-fs-drive${r === rootOf(cwd) ? ' ts-fs-drive-on' : ''}`}
                    onClick={() => load(r)}
                    title={`切换到 ${r}`}
                  >{r.replace(/\/$/, '')}</span>
                ))}
                <button
                  className="ts-btn"
                  style={{ padding: '2px 10px', fontSize: 12, flex: '0 0 auto' }}
                  onClick={() => { if (parent) { load(parent); setSelectedPath(null) } }}
                  disabled={!parent}
                >↑ 上级</button>
              </div>
              <div className="ts-fs-list">
                {loading && <div className="ts-hint">加载中…</div>}
                {fsError && <div className="ts-hint">⚠️ {fsError}</div>}
                {!loading && !fsError && entries.length === 0 && (
                  <div className="ts-hint">该目录下没有子文件夹</div>
                )}
                {entries.map((entry) => (
                  <button key={entry.path} className="ts-fs-item" onClick={() => enterDir(entry)}>
                    <span>📁 {entry.name}</span>
                    {entry.isProject && <span className="ts-tag">检测到项目</span>}
                  </button>
                ))}
              </div>
            </div>
            {source === 'local' && (
            <div className="ts-newfolder">
              {!newOpen ? (
                <button
                  className="ts-btn ts-btn-sm"
                  onClick={() => { setNewOpen(true); setNewName(''); setActionError(null) }}
                  disabled={!cwd || folderBusy}
                  title="在当前目录下新建一个文件夹（它本身就是新项目）"
                >＋ 新建文件夹</button>
              ) : (
                <>
                  <input
                    className="ts-input ts-newfolder-input"
                    autoFocus
                    value={newName}
                    placeholder="新文件夹名（即新项目名）"
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void doCreate() }
                      if (e.key === 'Escape') setNewOpen(false)
                    }}
                  />
                  <button
                    className="ts-btn ts-btn-primary ts-btn-sm"
                    disabled={folderBusy || !newName.trim()}
                    onClick={() => void doCreate()}
                  >{folderBusy ? '创建中…' : '创建'}</button>
                  <button className="ts-btn ts-btn-sm" onClick={() => setNewOpen(false)}>取消</button>
                  <span className="ts-newfolder-hint">将建在：{cwd || '/'}</span>
                </>
              )}

              {selectedPath && (
                !renameOpen ? (
                  <button
                    className="ts-btn ts-btn-sm"
                    onClick={() => { setRenameOpen(true); setRenameName(baseName(selectedPath)); setActionError(null) }}
                    disabled={folderBusy}
                    title="重命名已选中的文件夹（同目录内改名）"
                  >✏️ 重命名</button>
                ) : (
                  <>
                    <input
                      className="ts-input ts-newfolder-input"
                      autoFocus
                      value={renameName}
                      placeholder="新的文件夹名"
                      onChange={(e) => setRenameName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); void doRename() }
                        if (e.key === 'Escape') setRenameOpen(false)
                      }}
                    />
                    <button
                      className="ts-btn ts-btn-primary ts-btn-sm"
                      disabled={folderBusy || !renameName.trim()}
                      onClick={() => void doRename()}
                    >{folderBusy ? '改名中…' : '确认改名'}</button>
                    <button className="ts-btn ts-btn-sm" onClick={() => setRenameOpen(false)}>取消</button>
                    <span className="ts-newfolder-hint">重命名：{baseName(selectedPath)}</span>
                  </>
                )
              )}
              {actionError && <span className="ts-newfolder-err">⚠️ {actionError}</span>}
            </div>
            )}

            {source === 'local' && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className={`ts-btn ${selectedPath === cwd ? 'ts-btn-picked' : 'ts-btn-primary'}`}
                onClick={pickCurrent}
                disabled={!cwd}
                title={selectedPath === cwd ? '再次点击取消选择' : '选中当前文件夹作为项目路径'}
              >
                {selectedPath === cwd ? '✓ 已选中（点击取消）' : '选择当前文件夹'}
              </button>
              <span className="ts-sub" style={{ wordBreak: 'break-all' }}>
                {selectedPath ? `已选：${selectedPath}` : '浏览到目标文件夹后点击「选择当前文件夹」，或直接「＋ 新建文件夹」'}
              </span>
            </div>
            )}
          </div>

          {/* 从 GitHub 克隆：仓库地址 + 目标文件夹名 + 进度 */}
          {source === 'clone' && (
            <div className="ts-clone">
              <label className="ts-field-label">仓库地址</label>
              <input
                className="ts-input"
                value={repoUrl}
                placeholder="https://github.com/user/repo.git 或 git@github.com:user/repo.git"
                disabled={clonePending}
                onChange={(e) => setRepoUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void doClone() }
                }}
              />
              <div className="ts-clone-row">
                <input
                  className="ts-input ts-newfolder-input"
                  value={cloneName}
                  disabled={clonePending}
                  placeholder={`目标文件夹名（默认 ${repoNameFrom(repoUrl) || '仓库名'}）`}
                  onChange={(e) => setCloneName(e.target.value)}
                />
                <button
                  className="ts-btn ts-btn-primary ts-btn-sm"
                  disabled={!repoUrl.trim() || !cloneParent || cloneStarting || clonePending}
                  onClick={() => void doClone()}
                >{cloneStarting ? '启动中…' : '开始克隆'}</button>
              </div>
              <span className="ts-newfolder-hint">
                {cloneParent ? `将克隆到：${cloneParent}` : '请先在上面浏览选择一个目录'}（私有仓库自动用本机 gh 登录态）
              </span>

              {/* 进度：阶段 + 百分比 + git 输出尾行 */}
              {cloneStatus && (
                <div className="ts-clone-progress">
                  <div className="ts-clone-bar">
                    <div
                      className={`ts-clone-fill${cloneStatus.state === 'error' ? ' ts-clone-fill-err' : ''}`}
                      style={{ width: `${Math.max(2, Math.min(100, cloneStatus.percent))}%` }}
                    />
                  </div>
                  <div className="ts-clone-meta">
                    <span>
                      {cloneStatus.state === 'running' && `${cloneStatus.phase || '进行中'} ${cloneStatus.percent}%`}
                      {cloneStatus.state === 'done' && `✓ 克隆完成：${cloneStatus.path}`}
                      {cloneStatus.state === 'error' && `✖ ${cloneStatus.message || '克隆失败'}`}
                      {cloneStatus.state === 'cancelled' && '已取消'}
                    </span>
                    {cloneStatus.state === 'done' && (
                      <button className="ts-btn ts-btn-sm" onClick={finishClone}>加入项目</button>
                    )}
                  </div>
                  {cloneLog.length > 0 && cloneStatus.state === 'running' && (
                    <div className="ts-clone-log">{cloneLog.slice(-3).join('\n')}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 项目名称 */}
          <div>
            <label className="ts-field-label">项目名称（可选，默认取文件夹名）</label>
            <input
              className="ts-input"
              value={name}
              placeholder="例如：我的网站"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* 项目介绍（卡片/列表上作为说明性内容展示） */}
          <div>
            <label className="ts-field-label">项目介绍（可选，展示在项目卡片与列表里）</label>
            <textarea
              className="ts-input ts-textarea"
              value={description}
              placeholder="例如：个人博客，Next.js + MDX，部署在 Vercel"
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <div className="ts-modal-foot">
          <button className="ts-btn" onClick={onClose}>取消</button>
          <button
            className="ts-btn ts-btn-primary"
            disabled={source === 'clone' ? !cloneStatus || cloneStatus.state !== 'done' : !selectedPath}
            onClick={source === 'clone' ? finishClone : confirm}
            title={source === 'clone' && cloneStatus?.state !== 'done' ? '先完成克隆' : undefined}
          >创建并进入工作台</button>
        </div>
      </div>
    </div>
  )
}
