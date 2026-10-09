// DSH DockKit 前端补丁
//
// 目标：关闭 DSH 主对话窗口（dock tab）后，如果该 docked pane 因此变空，
// 自动触发一次 merge —— 相邻窗口随即扩展填补，不再留下空白 / 覆盖区域。
//
// 背景：dockkit 的 closeTab 操作只把 tab 从 pane 里摘掉；当 pane 变为空时
// 不会自动合并（只有 planSettle 才会），于是空 pane 继续占着分割位，表现为
// 一块残留的灰/黑色覆盖区域。
//
// 实现：客户端插件拿不到 dockkit 模块本身，但可以通过 DOM 上的 React fiber
// 找到 DockSurface 接收的 intents（就是 DockController 实例），再补丁其
// closeTab。所有访问都用鸭子类型 + try/catch 兜底，找不到就静默重试，
// 绝不影响插件自身加载。

const PATCH_KEY = '__dshDockkitPatchApplied'

/** 通过 [data-dockkit-surface] 元素的 React fiber 向上找到 DockController 实例。 */
function findDockControllerFromDom(): any {
  try {
    const surface = document.querySelector('[data-dockkit-surface]')
    if (!surface) return null
    const key = Object.keys(surface).find(
      (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
    )
    if (!key) return null
    let fiber: any = (surface as any)[key]
    // DockSurface 的 props.intents 就是 DockController；沿 return 链向上找。
    for (let i = 0; fiber && i < 80; i += 1, fiber = fiber.return) {
      const intents = fiber.memoizedProps?.intents
      if (
        intents &&
        typeof intents.closeTab === 'function' &&
        typeof intents.run === 'function' &&
        intents.state
      ) {
        return intents
      }
    }
  } catch {
    /* 忽略；调用方会重试 */
  }
  return null
}

/** 补丁 DockController 实例的 closeTab：pane 变空则补一次 merge。@returns 是否已完成（无需再试）。 */
function patchController(ctrl: any): boolean {
  if (!ctrl) return false
  if (ctrl.__dshCloseTabPatched) return true
  const original = ctrl.closeTab
  if (typeof original !== 'function') return false

  ctrl.closeTab = function (this: any, tabId: string) {
    // 关闭前记录目标 pane，判断是否为最后一个 tab。
    let paneId: string | undefined
    let wasLastTab = false
    try {
      const st = this.state
      for (const [id, node] of Object.entries(st.nodes)) {
        const pane = node as any
        if (pane?.kind === 'pane' && Array.isArray(pane.tabs) && pane.tabs.includes(tabId)) {
          paneId = id
          wasLastTab = pane.tabs.length === 1
          break
        }
      }
    } catch {
      /* 忽略 */
    }

    const result = original.call(this, tabId)

    // 关闭后：若该 docked pane 已空且不是根 pane，合并掉它，让兄弟 pane 扩展。
    try {
      if (paneId && wasLastTab) {
        const st = this.state
        const pane = st.nodes[paneId] as any
        if (
          pane &&
          pane.kind === 'pane' &&
          pane.host === 'dock' &&
          pane.tabs.length === 0 &&
          paneId !== st.rootId
        ) {
          this.run([{ type: 'merge', paneId }])
        }
      }
    } catch (e) {
      console.warn('[dockkit-patch] merge after closeTab failed', e)
    }

    return result
  }
  ctrl.__dshCloseTabPatched = true
  console.log('[dockkit-patch] DockController.closeTab patched')
  return true
}

/** 主入口：等待 DockSurface 挂载后补丁一次。 */
export function applyDockkitPatch(): void {
  const win = window as any
  if (win[PATCH_KEY]) return
  win[PATCH_KEY] = true

  let tries = 0
  const tick = (): void => {
    tries += 1
    if (patchController(findDockControllerFromDom())) return
    if (tries < 30) setTimeout(tick, 1000)
    else console.warn('[dockkit-patch] DockController not found; patch skipped')
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick)
  } else {
    tick()
  }
}
