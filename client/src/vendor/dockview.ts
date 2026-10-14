/**
 * dockview-core 引入层（Step 13 · Step A）。
 *
 * vendor 文件是 UMD（dockview-core.min.js 头部）：
 *   (function (e, t) {
 *     typeof exports == 'object' && typeof module < 'u' ? t(exports)
 *       : typeof define == 'function' && define.amd ? define(['exports'], t)
 *       : (e = globalThis, t(e['dockview-core'] = {}))
 *   })
 *
 * **不能直接 `import 'dockview-core.min.js'`**：本项目产物是 CJS 信封
 * （factory 内定义了 `module` / `exports`，见 scripts/build-client.mjs），
 * 直接 import 会让 UMD 认成 CJS 分支，把 API 写进 bundle 的 exports 而不是全局，
 * 我们拿不到。
 *
 * 所以这里**按文本取源**（esbuild 侧配 text loader），再用 `new Function(src)()`
 * 在**全局作用域**执行 —— 那里没有 module/exports/define，UMD 会走 global 分支，
 * 把 API 挂到 `globalThis['dockview-core']`。已核实 3080 页面无 CSP（无
 * Content-Security-Policy 响应头与 meta），inline 执行可用。
 *
 * CSS 同样按文本取源，注入一次性 `<style>`（与 panel/styles.ts 同款做法）。
 */
import css from './dockview.css'
import coreSrc from './dockview-core.min.js'

/** 注入的 <style> id（幂等判据）。 */
export const DOCKVIEW_CSS_ID = 'tokensave-dockview-css'
/** UMD 的全局键（注意是连字符名，不是 DockviewCore）。 */
export const DOCKVIEW_GLOBAL_KEY = 'dockview-core'

let cssInstalled = false
let coreCache: any = null

/** 注入 dockview 官方样式（幂等；重复调用无副作用）。 */
export function installDockviewCss(): void {
  if (cssInstalled || typeof document === 'undefined') return
  cssInstalled = true
  if (document.getElementById(DOCKVIEW_CSS_ID)) return
  const style = document.createElement('style')
  style.id = DOCKVIEW_CSS_ID
  style.textContent = css
  document.head.appendChild(style)
}

/** 取 dockview-core 的 API 命名空间（首次调用时在全局作用域执行 vendor 源码）。 */
export function getDockviewCore(): any {
  if (coreCache) return coreCache
  const g = globalThis as any
  if (!g[DOCKVIEW_GLOBAL_KEY]) {
    // 全局作用域执行 → UMD 走 global 分支
    new Function(coreSrc)()
  }
  coreCache = g[DOCKVIEW_GLOBAL_KEY] || null
  return coreCache
}

/** 一步到位：装样式 + 拿 API。 */
export function installDockview(): any {
  installDockviewCss()
  return getDockviewCore()
}
