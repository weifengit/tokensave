/**
 * 皮肤覆盖层：让皮肤铺满**整个页面**，而不只是工作台台面。
 *
 * 背景（用户反馈）：齿轮里的「背景皮肤」原来只覆盖工作台 `.ts-dock` 与项目中心
 * 列表页，【对话 / 轨迹 / 项目中心 / 工作台】四个 tab 里，凡是由**宿主**渲染的
 * 区域（会话根容器、轨迹表格、输入条座位…）都还是宿主自己的不透明底色 ——
 * 换皮肤时只有插件自己画的那几块变了，其余纹丝不动。
 *
 * 根因：宿主的每一层都用 `--dsw-alias-bg-base` / `--dsw-alias-bg-layer-1..3`
 * 这几个**背景 token** 刷底（实测：会话根 .wSkVaW_root 用 bg-base，轨迹表格与
 * 工具条用 bg-layer-1，轨迹绘图区用 bg-layer-2，插件输入条卡片用 bg-layer-3）。
 * 这些 token 由宿主的 `body[data-ds-dark-theme]` / `:root` 定义，值是**不透明**的，
 * 所以皮肤永远盖不住它们。
 *
 * 做法（不改宿主源码、不改宿主 token 的全局语义）：
 *   1. 把皮肤的底色 + 背景图铺到 `body`（fixed 附着，滚动时纹样不跑）；
 *   2. 把会话区域**祖先链**上的那几个背景 token 局部改写成 `transparent`，
 *      让宿主各层变“透”，皮肤的底从任意一层都透得到；
 *   3. 只动这四个背景 token。代码块 / 行内代码 / 引用块走的是
 *      `--dsw-alias-markdown-*` 另一组 token，不在改动范围内 —— 它们保留
 *      自己的不透明底，文字不会直接压在花纹上。
 *
 * 作用域用 `:has()` 挂在「含会话容器的任意祖先」上，**不写宿主 hash 类名**
 * （.wSkVaW_root 之类随宿主版本变，:has([data-conversation-content]) 是宿主
 * 稳定写出来的 data 属性）。
 */

/** 注入用的 style 元素 id（幂等：按 id 去重）。 */
const SKIN_LAYER_CSS_ID = 'tokensave-skin-layer-css'

/**
 * 皮肤覆盖层样式。
 *
 * ⚠️ 变量 `--ts-skin-color` / `--ts-skin-bg` 由 skins.ts 写到 `:root`；
 *    「无皮肤」时它们分别是 transparent / none —— 这套规则整体靠
 *    `html[data-ts-skin]:not([data-ts-skin="none"])` 把关，没皮肤时一条都不生效。
 */
export const SKIN_LAYER_CSS = `
/* ① 皮肤铺到 body：整页最底层。
   background-attachment:fixed —— 页面内滚动（轨迹表格很长）时纹样钉住不动，
   否则渐变会随内容一起滚，看着像背景在动。 */
html[data-ts-skin]:not([data-ts-skin="none"]) body {
  background-color: var(--ts-skin-color, transparent) !important;
  background-image: var(--ts-skin-bg, none) !important;
  background-attachment: fixed !important;
}

/* ② 会话页的祖先链：把这些**元素自己的底**直接清掉，
   让 ① 的皮肤从底下透上来（会话根 / 中栏 / 整窗框架，它们都用 bg-base 刷底）。

   ⚠️ 这里**绝不能改背景 token**：token 会被后代继承，而宿主的「设置」浮层是
   body 的**直接子节点**（VOzbGW_overlay → body）—— 在 body 或祖先上改 token，
   设置面板的底也一起变透明，面板就看不清了（用户反馈）。
   改元素自身的 background 不参与继承，所以只影响被命中的那几层。 */
html[data-ts-skin]:not([data-ts-skin="none"]) body *:has([data-conversation-content]) {
  background-color: transparent !important;
  background-image: none !important;
}

/* ③ 会话**内部**（轨迹表格 / 工具条 / 绘图区 / 输入条座位…）跟着皮肤走：
   只在会话子树根上改背景 token，靠继承只影响会话子树，不影响外面的宿主弹层。
   代码块、行内代码、引用块用的是 --dsw-alias-markdown-* 另一组 token，
   不在这里，所以它们保留自己的不透明底。 */
html[data-ts-skin]:not([data-ts-skin="none"]) [data-conversation-content] {
  --dsw-alias-bg-base: transparent !important;
  --dsw-alias-bg-layer-1: transparent !important;
  --dsw-alias-bg-layer-2: transparent !important;
  --dsw-alias-bg-layer-3: transparent !important;
}

/* 代码块 / 行内代码 / 引用块的底色走的是另外三个 token（--dsw-alias-markdown-*），
   不在上面清掉的那四个里，因此它们自动保留原有不透明底 —— 不需要额外补底规则。 */
`

/**
 * 注入皮肤覆盖层样式（幂等：按 id 去重）。
 * 皮肤与主题是全局的，所以由插件入口统一调一次即可（谁先加载谁注入）。
 */
export function installSkinLayerCss(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(SKIN_LAYER_CSS_ID)) return
  const style = document.createElement('style')
  style.id = SKIN_LAYER_CSS_ID
  style.textContent = SKIN_LAYER_CSS
  document.head.appendChild(style)
}
