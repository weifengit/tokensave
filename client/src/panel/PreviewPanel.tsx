/**
 * 工作台顶部的项目预览（原「展示」的内嵌 iframe，整体移到这里）。
 *
 * 位置（用户指定）：项目标题行（项目名 + 历史会话 + 新建会话那一行）**之下**、
 * 其它窗口（左竖 / 黑板 / 主对话 / 右竖）**之上**。
 *
 * 地址来自 project-info 的 devUrl：package.json 的 previewUrl 显式声明，
 * 否则回退到显式端口推断；相对路径按当前源解析成绝对地址（iframe 必须是绝对 URL）。
 *
 * 行为：
 *   - 首次探测到开发服务器**在跑** → 自动展开；否则收成一行（不占地方）。
 *   - 折叠/展开、刷新、新窗口打开三个操作；没有可用地址时按钮置灰但不报错。
 *   - iframe 高度封顶（见 styles.ts 的 .ts-preview-panel .ts-preview-frame），
 *     避免把工作台网格挤出可视区。
 */
import React, { useEffect, useRef, useState } from 'react'
import { fetchProjectInfo } from './api'
import type { ProjectInfo } from './api'
import type { ProjectRecord } from './store'

/** 开发服务器地址探测的轮询间隔（与探索者探测同量级，够快也不吵） */
const PROBE_INTERVAL_MS = 10_000

/** 把 devUrl 解析成 iframe 可用的绝对地址（解析失败就用原值，交给浏览器按文档源解析）。 */
function absoluteUrl(raw: string): string {
  if (!raw) return ''
  if (!raw.startsWith('/')) return raw
  try {
    return new URL(raw, window.location.origin).href
  } catch {
    return raw
  }
}

export function PreviewPanel({ project }: { project: ProjectRecord }) {
  const [info, setInfo] = useState<ProjectInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // 只在首次探测到「在跑」时自动展开一次：之后用户手动收起就不再抢回来
  const autoOpenedRef = useRef(false)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const next = await fetchProjectInfo(project.path)
      if (!alive) return
      setInfo(next)
      if (!autoOpenedRef.current && next?.devRunning === true && next.devUrl) {
        autoOpenedRef.current = true
        setOpen(true)
      }
    }
    void tick()
    const timer = window.setInterval(tick, PROBE_INTERVAL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [project.path])

  const url = absoluteUrl(info?.devUrl || '')
  const ready = url !== ''

  const openExternal = () => {
    if (!ready) return
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      console.warn('[tokensave] 新窗口打开失败', e)
    }
  }

  return (
    <section className="ts-preview-panel">
      <div className="ts-preview-bar">
        <button
          type="button"
          className="ts-icon-btn"
          onClick={() => setOpen((v) => !v)}
          disabled={!ready}
          title={open ? '收起项目预览' : '展开项目预览'}
        >{open ? '▾' : '▸'}</button>
        <span className="ts-preview-title">🖥 项目预览</span>
        <span className="ts-preview-url" title={url || '未检测到开发服务器'}>
          {ready ? url : '未检测到开发服务器（在项目里 npm run dev 后会自动出现）'}
        </span>
        {info?.devRunning && <span className="ts-tag ts-tag-live">● 已启动</span>}
        <span className="ts-preview-ops">
          <button
            type="button"
            className="ts-btn ts-btn-sm"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={!ready}
            title="刷新内嵌预览"
          >刷新</button>
          <button
            type="button"
            className="ts-btn ts-btn-sm"
            onClick={openExternal}
            disabled={!ready}
            title="在新标签页打开（站点带 X-Frame-Options 时用它）"
          >新窗口</button>
        </span>
      </div>
      {open && ready && (
        <iframe
          key={reloadKey}
          className="ts-preview-frame"
          src={url}
          title={`${project.name} 预览`}
        />
      )}
    </section>
  )
}
