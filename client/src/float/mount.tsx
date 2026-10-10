// 浮窗挂载（Step 11）。
// 挂载点策略：优先 root 层浮层槽 shell.overlay（经 slots.inject 等待就绪），
// 8s 未就绪降级注册到 KB 示例槽 conversation.session.header.actions（FloatWindow
// 自身为 fixed 定位浮层，DOM 位置不影响浮动表现）。
// FloatWindow 源码已 vendor 进仓库（client/vendor/dsh-float-window/，v0.4.1 快照 + LICENSE），
// 构建时打进本 bundle——不再依赖 npm 包 dsh-float-window（去第三方源码依赖，防上游变更/失联）。
// 老板键/几何持久化/多窗协调由组件 + window.__dshFloatWindows 注册表自动处理。
import type { Context } from '@deepseek-ai/cordis'
import { FloatWindow } from '../../vendor/dsh-float-window/index.tsx'
import { ExplorerStream } from '../components/ExplorerStream'
import { BriefViewer } from '../components/BriefViewer'

export interface ExplorerInfo {
  sessionId: string
  label: string
}

const mountedExplorers = new Set<string>()
const disposers = new Map<string, () => void>()
let inited = false
let shellReady = false
const pending: Array<(placement: string) => void> = []

function init(ctx: Context): void {
  if (inited) return
  inited = true
  try {
    const slots = (ctx as any).slots
    slots?.inject('shell.overlay', () => {
      shellReady = true
      pending.splice(0).forEach((fn) => fn('shell.overlay'))
      return () => {
        /* slot 卸载时由渲染台账回收，无需额外清理 */
      }
    })
  } catch (e) {
    console.warn('[tokensave] shell.overlay inject 失败', e)
  }
  setTimeout(() => {
    if (!shellReady && pending.length > 0) {
      console.warn('[tokensave] shell.overlay 8s 未就绪，降级注册到 conversation.session.header.actions')
      pending.splice(0).forEach((fn) => fn('conversation.session.header.actions'))
    }
  }, 8000)
}

function registerWindow(ctx: Context, id: string, order: number, Comp: () => any): void {
  init(ctx)
  const doReg = (placement: string) => {
    try {
      const d = (ctx as any).slots.register({ name: placement, id, order }, Comp)
      if (typeof d === 'function') disposers.set(id, d)
    } catch (e) {
      console.warn(`[tokensave] 注册 ${id} 到 ${placement} 失败`, e)
    }
  }
  if (shellReady) doReg('shell.overlay')
  else pending.push(doReg)
}

export function mountExplorerWindows(ctx: Context, explorers: ExplorerInfo[]): void {
  explorers.forEach((explorer, index) => {
    if (!explorer.sessionId || mountedExplorers.has(explorer.sessionId)) return
    mountedExplorers.add(explorer.sessionId)
    const Comp = () => (
      <FloatWindow
        storageKey={`tokensave:explorer:${explorer.sessionId}`}
        title={explorer.label}
        accent="#7fc4ff"
        launcherGlyph="🔍"
      >
        {(visible: boolean, fwCtx: any) => (
          <ExplorerStream
            sessionId={explorer.sessionId}
            visible={visible}
            bossKey={fwCtx?.bossKey ?? ''}
          />
        )}
      </FloatWindow>
    )
    registerWindow(ctx, `tokensave-explorer-${explorer.sessionId}`, 100 + index, Comp)
  })
}

export function mountedExplorerCount(): number {
  return mountedExplorers.size
}

// 探索者浮窗停用后，实际计数由 H 台（panel/HDesk）探测上报
let reportedCount = 0
export function reportExplorerCount(n: number): void {
  reportedCount = n
}

export function mountBriefWindow(ctx: Context, brief: string, _explorerCount: number): void {
  const id = 'tokensave-brief'
  const old = disposers.get(id)
  if (typeof old === 'function') {
    try {
      old()
    } catch {
      /* noop */
    }
    disposers.delete(id)
  }
  const Comp = () => (
    <FloatWindow storageKey="tokensave:brief" title="任务简报" accent="#9be7a8" launcherGlyph="📋">
      {() => <BriefViewer brief={brief} explorerCount={reportedCount} />}
    </FloatWindow>
  )
  registerWindow(ctx, id, 300, Comp)
}
