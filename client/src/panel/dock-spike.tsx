/**
 * dockview spike（Step 13 · Step A）——**一次性验证容器，不进正常使用路径**。
 *
 * 只在开关打开时渲染（`?dockview-spike=1` 或 localStorage `tokensave:dock-spike.v1=1`），
 * 挂在宿主 `shell.overlay` 槽（root 作用域，Step 11 浮窗用过同一槽）。
 *
 * 它要一次性回答 Step A 的四个问题：
 *   ① 产物能加载（vendor UMD 文本注入 + 全局执行）——挂载成功即答；
 *   ② 与宿主样式无冲突、透明背景成立——面板全透明，底下的页面应当可见；
 *   ③ 锁布局 / 隐藏面板 API 存在且可用——工具栏两个按钮就是实测；
 *   ④ **两个项目窗口的输入框互不影响**：各自独立的 textarea + 各自的「项目」，
 *      拖拽/缩放/切分组后焦点与草稿都不串——这是「不串台」的 DOM 级预演。
 *
 * 另外用 ticker iframe 验证「媒体/长任务不因布局操作重载」：iframe 用 srcdoc
 * （同源，可读 contentWindow），内部每 100ms 自增 `window.__t`；任何时候读它，
 * 数值只增不减就说明 DOM 没被销毁重建。
 *
 * 面板内容刻意用 **vanilla DOM**（与 info_report 同款做法）：一是避开
 * react-dom/client（本仓未安装，平台种子词只有 react/react-dom），二是焦点/
 * 拖拽这类原生行为用原生元素测最可信。
 */
import React, { useEffect, useRef, useState } from 'react'
import { installDockview } from '../vendor/dockview'

export const SPIKE_FLAG_KEY = 'tokensave:dock-spike.v1'
const SPIKE_CSS_ID = 'tokensave-dock-spike-css'

/** 与 info_report 的 dv-intel 主题对齐：全透明 + 线条风标签。 */
const SPIKE_CSS = `
.dv-intel { background: transparent; }
.dv-intel .dv-dockview { background: transparent; }
.dv-intel .dv-groupview { background: transparent; border-radius: 0; }
.ts-spike-pane { height: 100%; display: flex; flex-direction: column; min-height: 0; padding: 8px; gap: 6px; font-size: 12.5px; color: #e6e8eb; }
.ts-spike-head { display: flex; align-items: center; gap: 8px; flex: none; color: #9aa4b2; }
.ts-spike-head b { color: #e6e8eb; font-weight: 500; }
.ts-spike-input { flex: none; box-sizing: border-box; width: 100%; min-height: 34px; max-height: 96px; resize: vertical; border: 1px solid #242b36; border-radius: 8px; background: rgba(20,25,34,.72); color: #e6e8eb; padding: 6px 8px; font: inherit; outline: none; }
.ts-spike-input:focus { border-color: #4f8ef7; }
.ts-spike-log { flex: 1; min-height: 0; overflow: auto; border: 1px dashed #242b36; border-radius: 8px; padding: 6px 8px; color: #9aa4b2; }
.ts-spike-frame { flex: 1; min-height: 0; width: 100%; border: 0; border-radius: 8px; background: rgba(11,14,20,.5); }
.ts-spike-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 8px; flex: none; }
.ts-spike-btn { border: 1px solid #242b36; border-radius: 8px; background: rgba(20,25,34,.72); color: #e6e8eb; font: inherit; font-size: 12px; padding: 4px 9px; cursor: pointer; }
.ts-spike-btn:hover { border-color: #4f8ef7; }
.ts-spike-shell { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; background: rgba(11,14,20,.28); backdrop-filter: blur(1px); }
.ts-spike-dock { flex: 1; min-height: 0; }
.dv-intel .dv-tabs-and-actions-container { background: transparent !important; height: 33px; font-size: 12.5px; }
.dv-intel .dv-tab { background: transparent !important; border-radius: 0 !important; }
.dv-intel .dv-tab.dv-active-tab { background: rgba(255,255,255,.06) !important; color: #e6e8eb !important; }
.dv-intel .dv-separator, .dv-intel .dv-sash { border-color: transparent !important; }
.dv-intel .dv-sash.dv-active-sash { background: #4f8ef7 !important; }
.dv-intel .dv-floating { box-shadow: 0 18px 48px rgba(0,0,0,.5); border: 1px solid #242b36; }
.ts-spike-tabico { display: inline-flex; align-items: center; }
`

/** 面板的「视窗」集合：两个假项目，各带 预览 + 主对话；外加项目中心列表。 */
interface PaneSpec {
  id: string
  title: string
  icon: string
  kind: 'list' | 'preview' | 'chat'
  project?: string
}

export const SPIKE_PANES: PaneSpec[] = [
  { id: 'center', title: '项目中心', icon: 'list', kind: 'list' },
  { id: 'A:preview', title: '项目A · 预览', icon: 'book', kind: 'preview', project: 'A' },
  { id: 'A:chat', title: '项目A · 主对话', icon: 'chat', kind: 'chat', project: 'A' },
  { id: 'B:preview', title: '项目B · 预览', icon: 'book', kind: 'preview', project: 'B' },
  { id: 'B:chat', title: '项目B · 主对话', icon: 'chat', kind: 'chat', project: 'B' },
]

/** 线条图标（24 视窗、currentColor 描边、不填色 —— 与 icons.js 同规）。 */
const ICON: Record<string, string> = {
  list: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M7 9.5h10"/><path d="M7 13.5h6"/>',
  book: '<path d="M3 5h6a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3H3z"/><path d="M21 5h-6a3 3 0 0 0-3 3v11a3 3 0 0 1 3-3h6z"/>',
  chat: '<path d="M4 5.5h16v11H9.5L4 20.5z"/><path d="M8 10h8"/><path d="M8 13.5h5"/>',
}

function iconSvg(name: string, size = 15): string {
  const body = ICON[name] || ICON.list
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}

/** 可在自动化里读的诊断状态。 */
interface SpikeState {
  ticks: Record<string, number>
  drafts: Record<string, string>
  focusLog: string[]
  layoutOps: string[]
}

export function spikeEnabled(search = typeof window === 'undefined' ? '' : window.location.search): boolean {
  try {
    if (search && search.includes('dockview-spike')) return true
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(SPIKE_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

function installSpikeCss(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(SPIKE_CSS_ID)) return
  const style = document.createElement('style')
  style.id = SPIKE_CSS_ID
  style.textContent = SPIKE_CSS
  document.head.appendChild(style)
}

/** ticker iframe：srcdoc 同源，内部自增 window.__t，用来判定 DOM 是否被重建。 */
function buildTicker(project: string): HTMLIFrameElement {
  const fr = document.createElement('iframe')
  fr.className = 'ts-spike-frame'
  fr.setAttribute('data-spike-frame', project)
  fr.srcdoc = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:12px system-ui;color:#9aa4b2;background:transparent">
<div id="v">t=0</div>
<script>window.__t=0;setInterval(function(){window.__t++;document.getElementById('v').textContent='${project} ticker t='+window.__t;},100);<\/script>
</body>`
  return fr
}

function readTicks(fr: HTMLIFrameElement | null): number {
  try {
    const w = fr && (fr.contentWindow as any)
    return w && typeof w.__t === 'number' ? w.__t : -1
  } catch {
    return -1
  }
}

/** 建一个面板的 DOM（vanilla）。 */
function buildPaneDom(spec: PaneSpec, state: SpikeState): HTMLElement {
  const root = document.createElement('div')
  root.className = 'ts-spike-pane'
  root.setAttribute('data-spike-pane', spec.id)

  const head = document.createElement('div')
  head.className = 'ts-spike-head'
  head.innerHTML = `<b>${spec.title}</b><span data-role="ticks"></span>`
  root.appendChild(head)

  if (spec.kind === 'preview') {
    const fr = buildTicker(spec.project || '?')
    root.appendChild(fr)
    const refresh = document.createElement('button')
    refresh.className = 'ts-spike-btn'
    refresh.textContent = '重建 iframe（对照：数值会归零）'
    refresh.onclick = () => {
      const next = buildTicker(spec.project || '?')
      fr.replaceWith(next)
    }
    root.appendChild(refresh)
    return root
  }

  if (spec.kind === 'chat') {
    const input = document.createElement('textarea')
    input.className = 'ts-spike-input'
    input.setAttribute('data-spike-input', spec.project || '')
    input.placeholder = `项目${spec.project} 的输入框（只属于本项目）`
    input.value = state.drafts[spec.project || ''] || ''
    input.addEventListener('input', () => {
      state.drafts[spec.project || ''] = input.value
    })
    input.addEventListener('focus', () => {
      state.focusLog.push(`${spec.project}:${Date.now()}`)
    })
    const send = document.createElement('button')
    send.className = 'ts-spike-btn'
    send.textContent = `发送到项目${spec.project} 的会话`
    const log = document.createElement('div')
    log.className = 'ts-spike-log'
    send.onclick = () => {
      const text = input.value.trim()
      const line = document.createElement('div')
      line.textContent = text
        ? `[${spec.project}] 将以 sendToSession(项目${spec.project} 的 sessionId, ${JSON.stringify(text)}) 发送`
        : `[${spec.project}] 空内容，未发送`
      log.prepend(line)
    }
    const row = document.createElement('div')
    row.className = 'ts-spike-head'
    row.appendChild(input)
    root.appendChild(row)
    root.appendChild(send)
    root.appendChild(log)
    return root
  }

  // 项目中心（列表）
  const list = document.createElement('div')
  list.className = 'ts-spike-log'
  list.innerHTML =
    '<div>项目 A —（这里的「打开」按钮在正式实现里会新建一个项目分组/浮窗）</div>' +
    '<div>项目 B —</div>'
  root.appendChild(list)
  return root
}

/**
 * spike 的宿主组件（React 只做外壳：容器 + 工具栏；面板内容全 vanilla）。
 */
export function DockSpike(): React.ReactElement | null {
  const hostRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<any>(null)
  const stateRef = useRef<SpikeState>({ ticks: {}, drafts: {}, focusLog: [], layoutOps: [] })
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const DVC = installDockview()
    if (!DVC || typeof DVC.createDockview !== 'function') {
      console.warn('[dock-spike] dockview-core 未就绪', DVC)
      return
    }
    installSpikeCss()
    const state = stateRef.current

    const api = DVC.createDockview(host, {
      createComponent: (o: any) => {
        if (o?.name !== 'pane') return null
        const el = document.createElement('div')
        el.style.height = '100%'
        return {
          element: el,
          init(params: any) {
            const spec = SPIKE_PANES.find((p) => p.id === params?.params?.win)
            el.appendChild(spec ? buildPaneDom(spec, state) : document.createTextNode('?'))
          },
          dispose() {
            el.replaceChildren()
          },
        }
      },
      createTabComponent: (o: any) => {
        if (o?.name !== 'iconTab') return undefined
        const el = document.createElement('span')
        el.className = 'ts-spike-tabico'
        return {
          element: el,
          init(params: any) {
            const spec = SPIKE_PANES.find((p) => p.id === params?.params?.win)
            el.innerHTML = spec ? iconSvg(spec.icon) : ''
            el.title = spec ? spec.title : ''
          },
          dispose() {
            el.innerHTML = ''
          },
        }
      },
      theme: { name: 'intel', className: 'dv-intel', colorScheme: 'dark', gap: 0 },
      defaultRenderer: 'always',
      noPanelsOverlay: 'emptyGroup',
      disableDnd: false,
      getTabContextMenuItems: ({ panel, group }: any) => [
        { label: '关闭', action: () => panel.api.close() },
        { label: '关闭其他', action: () => group.panels.slice().forEach((p: any) => p !== panel && p.api.close()) },
        'separator',
        { label: '浮动', action: () => api.addFloatingGroup(panel, { width: 560, height: 420 }) },
        {
          label: panel.api.isMaximized() ? '还原' : '最大化',
          action: () => (panel.api.isMaximized() ? panel.api.exitMaximized() : panel.api.maximize()),
        },
      ],
    })
    apiRef.current = api

    // 初始布局：左边项目中心；中间项目A（预览+对话）；右边项目B（预览+对话）
    api.addPanel({ id: 'center', component: 'pane', title: '项目中心', tabComponent: 'iconTab', params: { win: 'center' } })
    api.addPanel({
      id: 'A:preview', component: 'pane', title: '项目A · 预览', tabComponent: 'iconTab', params: { win: 'A:preview' },
      position: { direction: 'right', referencePanel: 'center' },
    })
    api.addPanel({
      id: 'A:chat', component: 'pane', title: '项目A · 主对话', tabComponent: 'iconTab', params: { win: 'A:chat' },
      position: { direction: 'below', referencePanel: 'A:preview' },
    })
    api.addPanel({
      id: 'B:preview', component: 'pane', title: '项目B · 预览', tabComponent: 'iconTab', params: { win: 'B:preview' },
      position: { direction: 'right', referencePanel: 'A:chat' },
    })
    api.addPanel({
      id: 'B:chat', component: 'pane', title: '项目B · 主对话', tabComponent: 'iconTab', params: { win: 'B:chat' },
      position: { direction: 'below', referencePanel: 'B:preview' },
    })

    api.onDidLayoutChange(() => {
      state.layoutOps.push(String(Date.now()))
    })

    // 诊断钩子：自动化直接读它
    ;(window as any).__tsDockSpike = {
      api,
      state,
      panelIds: () => api.panels.map((p: any) => p.id),
      ticks: () => {
        const out: Record<string, number> = {}
        SPIKE_PANES.filter((p) => p.kind === 'preview').forEach((p) => {
          const fr = host.querySelector<HTMLIFrameElement>(`[data-spike-frame="${p.project}"]`)
          out[p.project || '?'] = readTicks(fr)
        })
        return out
      },
      drafts: () => ({ ...state.drafts }),
      focusLog: () => [...state.focusLog],
      layoutOps: () => state.layoutOps.length,
      lock: (on: boolean) => api.updateOptions({ disableDnd: on }),
      snapshot: () => api.toJSON(),
      restore: (json: any) => api.fromJSON(json, { reuseExistingPanels: true }),
      setVisible: (id: string, v: boolean) => api.getPanel(id)?.api.setVisible(v),
      floating: (id: string) => api.addFloatingGroup(api.getPanel(id), { width: 520, height: 380 }),
    }
    return () => {
      try {
        api.dispose()
      } catch {
        /* 卸载时忽略 */
      }
      delete (window as any).__tsDockSpike
    }
  }, [])

  return (
    <div className="ts-spike-shell" data-spike-shell="">
      <div className="ts-spike-bar">
        <b>dockview spike（Step A）</b>
        <button
          className="ts-spike-btn"
          data-spike-lock=""
          onClick={() => {
            const next = !locked
            setLocked(next)
            apiRef.current?.updateOptions({ disableDnd: next })
          }}
        >
          {locked ? '解锁布局' : '锁定布局（disableDnd）'}
        </button>
        <button className="ts-spike-btn" onClick={() => apiRef.current?.addFloatingGroup(apiRef.current.getPanel('A:chat'), { width: 520, height: 380 })}>
          浮动 项目A · 主对话
        </button>
        <button className="ts-spike-btn" onClick={() => apiRef.current?.getPanel('A:preview')?.api.setVisible(false)}>
          隐藏 项目A · 预览
        </button>
        <button className="ts-spike-btn" onClick={() => apiRef.current?.getPanel('A:preview')?.api.setVisible(true)}>
          显示 项目A · 预览
        </button>
        <span style={{ color: '#6b7280' }}>拖拽/缩放面板，然后看两个项目的输入框是否互不干扰</span>
      </div>
      <div className="ts-spike-dock" ref={hostRef} data-spike-dock="" />
    </div>
  )
}

/** 槽位门：只在开关打开时渲染 spike（否则完全不进 DOM）。 */
export function DockSpikeGate(): React.ReactElement | null {
  const [on] = useState(() => spikeEnabled())
  if (!on) return null
  return <DockSpike />
}
