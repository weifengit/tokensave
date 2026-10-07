/**
 * 「添加项目」弹窗：选择项目文件夹（目录浏览器）+ 项目名称
 * 布局模式不在此处选择——固定仅 H 型 1 种，无选择项
 */
import React, { useCallback, useEffect, useState } from 'react'
import { fetchDirectory } from './api'
import type { FsEntry } from './api'
import { addProject } from './store'
import type { ProjectRecord } from './store'

interface Props {
  onClose: () => void
  onCreated: (project: ProjectRecord) => void
}

export function AddProjectDialog({ onClose, onCreated }: Props) {
  const [cwd, setCwd] = useState<string>('')
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [fsError, setFsError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [name, setName] = useState('')

  const load = useCallback(async (path?: string) => {
    setLoading(true)
    setFsError(null)
    try {
      const listing = await fetchDirectory(path)
      setCwd(listing.path)
      setEntries(listing.entries)
    } catch (e) {
      setFsError(e instanceof Error ? e.message : '目录读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const crumbs = cwd ? cwd.split('/').filter(Boolean) : []
  const gotoCrumb = (index: number) => {
    const partial = '/' + crumbs.slice(0, index + 1).join('/')
    load(partial)
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

  const confirm = () => {
    if (!selectedPath) return
    const record = addProject(name.trim(), selectedPath)
    onCreated(record)
  }

  return (
    <div className="ts-modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ts-modal">
        <div className="ts-modal-head">
          <span>➕ 添加项目</span>
          <button className="ts-icon-btn" onClick={onClose} title="关闭">✕</button>
        </div>
        <div className="ts-modal-body">
          {/* 选择项目文件夹 */}
          <div>
            <label className="ts-field-label">选择项目文件夹</label>
            <div className="ts-fs">
              <div className="ts-fs-crumb">
                <span onClick={() => { load('/'); setSelectedPath(null) }} title="根目录">/</span>
                {crumbs.map((c, i) => (
                  <React.Fragment key={i}>
                    <span onClick={() => gotoCrumb(i)}>{c}</span>
                    {i < crumbs.length - 1 && <span style={{ opacity: .4 }}>/</span>}
                  </React.Fragment>
                ))}
                <button
                  className="ts-btn"
                  style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 12 }}
                  onClick={() => load(cwd ? cwd.split('/').slice(0, -1).join('/') || '/' : undefined)}
                  disabled={!cwd || cwd === '/'}
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
                {selectedPath ? `已选：${selectedPath}` : '浏览到目标文件夹后点击「选择当前文件夹」'}
              </span>
            </div>
          </div>

          {/* 项目名称 */}
          <div>
            <label className="ts-field-label">项目名称（可选，默认取文件夹名）</label>
            <input
              className="ts-input"
              style={{ width: '100%' }}
              value={name}
              placeholder="例如：我的网站"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <div className="ts-modal-foot">
          <button className="ts-btn" onClick={onClose}>取消</button>
          <button
            className="ts-btn ts-btn-primary"
            disabled={!selectedPath}
            onClick={confirm}
          >创建并进入工作台</button>
        </div>
      </div>
    </div>
  )
}
