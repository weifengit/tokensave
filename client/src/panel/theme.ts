/**
 * 主题（深色 / 浅色）探测
 *
 * 背景：插件外壳原来写死了浅色前景（`color: #e6e8eb`）且背景透明 —— 深色宿主下
 * 正好合用（宿主的深底透上来），但**宿主切浅色**时白底 + 浅色字 → 主对话里大量文字
 * 直接看不见（用户反馈）。所以外壳必须知道自己活在哪种主题里。
 *
 * 宿主怎么表达主题：没有 `data-theme` 属性，只在 `:root` 上写 `color-scheme`
 * （实测 `light` / `dark`），页面底色也跟着变。因此：
 *   1. 读 `:root` 的 computed `color-scheme`（最准）；
 *   2. 读不到就退化成「页面底色亮度」判断；
 *   3. 结果写 `<html data-ts-theme="dark|light">`，插件所有样式用这个属性分支。
 *
 * 监听：宿主切主题可能只改 CSS 变量（不动属性），所以除了
 * matchMedia + MutationObserver，再挂一个低频兜底轮询（2s，页面隐藏时自动跳过）。
 */

export type TsTheme = 'dark' | 'light'

/**
 * 主题调色板（**唯一来源**，由 installThemeCss 注入一次）。
 *
 * 三组变量，用途不同、别混：
 *   --ts-t-*      「纯主题」色（不含皮肤）：弹层用，因为它必须与弹层自己的底对得上；
 *   --ts-fg*      外壳前景 = 主题色，但**皮肤可以覆盖**（深色皮时强制浅字）；
 *   --ts-pop-*    弹层调色板：底色 / 文字 / 描边 / 悬停 / 阴影。
 *
 * ⚠️ 弹层必须把内部的 --ts-fg* 重定向到 --ts-pop-fg*（见文件末尾的弹层重定向规则）：
 * 否则「宿主浅色主题 + 深色皮肤」时弹层是浅底、文字却被皮肤逼成浅色，又一次看不见。
 */
export const THEME_CSS = `
:root {
  /* 外壳（可被皮肤覆盖） */
  --ts-fg: #e6e8eb;
  --ts-fg-dim: #9aa4b2;
  --ts-fg-mute: #6b7280;
  --ts-surface: transparent;
  --ts-surface-solid: #0e1116;
  --ts-line: rgba(127,127,127,.22);
  --ts-hover: rgba(127,127,127,.14);
  /* 纯主题色（弹层用，不随皮肤变） */
  --ts-t-fg: #e6e8eb;
  --ts-t-fg-dim: #9aa4b2;
  --ts-t-fg-mute: #8b96a5;
  /* 弹层调色板 */
  --ts-pop-bg: rgba(24,27,33,.97);
  --ts-pop-bg-solid: #14161b;
  --ts-pop-fg: #e6e8eb;
  --ts-pop-fg-dim: #9aa4b2;
  --ts-pop-fg-mute: #8b96a5;
  --ts-pop-line: rgba(127,127,127,.35);
  --ts-pop-hover: rgba(127,127,127,.16);
  --ts-pop-shadow: 0 14px 40px rgba(0,0,0,.5);
  --ts-pop-mask: rgba(0,0,0,.45);
  /* 悬浮状态栏底色（半透明 + 模糊 + 上投阴影，内容从底下穿过） */
  --ts-sb-bg: rgba(14,16,21,.86);
  --ts-scroll-thumb: rgba(154,164,178,.45);
  /* --ts-fade-from / --ts-fade-mid 已删：那条 .ts-dock-fade 渐隐遮罩已移除
     （它只在聊天区下方糊出一块渐变深色，破坏页面背景一体性）。 */
}
html[data-ts-theme="light"] {
  --ts-fg: #1f2328;
  --ts-fg-dim: #4b5563;
  --ts-fg-mute: #6b7280;
  --ts-surface: #f7f8fa;
  --ts-surface-solid: #ffffff;
  --ts-line: rgba(0,0,0,.12);
  --ts-hover: rgba(0,0,0,.06);
  --ts-t-fg: #1f2328;
  --ts-t-fg-dim: #4b5563;
  --ts-t-fg-mute: #6b7280;
  --ts-pop-bg: rgba(255,255,255,.99);
  --ts-pop-bg-solid: #ffffff;
  --ts-pop-fg: #1f2328;
  --ts-pop-fg-dim: #4b5563;
  --ts-pop-fg-mute: #6b7280;
  --ts-pop-line: rgba(0,0,0,.16);
  --ts-pop-hover: rgba(0,0,0,.07);
  --ts-pop-shadow: 0 14px 40px rgba(15,23,42,.18);
  --ts-pop-mask: rgba(15,23,42,.28);
  --ts-sb-bg: rgba(247,248,250,.92);
  --ts-scroll-thumb: rgba(90,98,112,.38);
}
/* 选了深色皮肤 → 外壳前景永远浅色（皮肤是自己的底，不跟随宿主主题）。
   必须写在浅色覆盖**之后**：同权重靠源码顺序定胜负。 */
html[data-ts-skin="dark"] {
  --ts-fg: #e6e8eb;
  --ts-fg-dim: #9aa4b2;
  --ts-fg-mute: #8b96a5;
  --ts-line: rgba(255,255,255,.14);
  --ts-hover: rgba(255,255,255,.10);
}
html[data-ts-skin="light"] { --ts-fg: #1f2328; --ts-fg-dim: #4b5563; --ts-fg-mute: #6b7280; }
/* 说明：**不要**在「浅色主题 + 深色皮」时给 .ts-dock-pane 垫浅底 ——
   那是上一版的做法，结果整个中间区域变白、换皮肤只有标题行/标签行/状态栏三块有反应
   （用户反馈）。正确做法：皮肤照常铺在中间，自己渲染的内容一律走 --ts-fg（深色皮强制浅字）；
   唯一由宿主渲染的块（输入条座位）单独给一块主题底，见 composer-dock.ts。 */
/* ⚠️ 聊天正文（markdown 标题/表格/段落）一律**继承外壳前景**。
   为什么要有这条兜底：浅色主题下正文里时不时冒出深色（宿主/第三方样式或我们某条规则写成
   固定深色），一配上深色皮肤就变成「深底 + 深字」，大标题和表格尤其明显（用户两次反馈）。
   这里按元素兜住（不用 * ）：保留行内 code / 链接自己的配色。 */
html[data-ts-skin] .ts-chat-msgs :is(h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote, dt, dd) {
  color: inherit !important;
}
/* 深色皮肤：状态栏底色也要用深色端 */
html[data-ts-skin="dark"] {
  --ts-sb-bg: rgba(14,16,21,.86);
}
/* 浅色皮肤：状态栏底色用浅色端 */
html[data-ts-skin="light"] {

  --ts-sb-bg: rgba(252,252,253,.9);
}
/* 滚动条：深/浅各一套颜色（白条在浅色主题下尤其刺眼） */
.ts-chat-msgs { scrollbar-width: thin; scrollbar-color: var(--ts-scroll-thumb, rgba(127,127,127,.45)) transparent; }
.ts-chat-msgs::-webkit-scrollbar { width: 10px; height: 10px; }
.ts-chat-msgs::-webkit-scrollbar-track { background: transparent; }
.ts-chat-msgs::-webkit-scrollbar-thumb { background: transparent; border-radius: 6px; border: 3px solid transparent; background-clip: padding-box; transition: background-color .25s ease; }
/* 滚动时才显形（MainChat 在滚动中打 data-scrolling）；停下 1s 后淡出 */
.ts-chat-msgs[data-scrolling]::-webkit-scrollbar-thumb { background-color: var(--ts-scroll-thumb, rgba(127,127,127,.5)); }
.ts-chat-msgs:hover::-webkit-scrollbar-thumb { background-color: var(--ts-scroll-thumb, rgba(127,127,127,.35)); }
/* 所有浮动面板：底/字/描边/悬停都走弹层调色板，并把内部的 --ts-fg* 指回弹层色。 */
.ts-pop,
.ts-sess-pop,
.ts-expset-pop,
.ts-warn-pop,
.ts-skin-pop,
.ts-win-overlay,
.ts-jump-latest,
.ts-modal,
.dv-context-menu[data-ts-hoisted="1"] {
  --ts-fg: var(--ts-pop-fg);
  --ts-fg-dim: var(--ts-pop-fg-dim);
  --ts-fg-mute: var(--ts-pop-fg-mute);
  --ts-line: var(--ts-pop-line);
  --ts-hover: var(--ts-pop-hover);
  background: var(--ts-pop-bg);
  color: var(--ts-pop-fg);
}
`

const THEME_CSS_ID = 'tokensave-theme-css'

/** 注入主题调色板（幂等：按 id 去重）。工作台与项目中心都调，谁先加载谁注入。 */
export function installThemeCss(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(THEME_CSS_ID)) return
  const style = document.createElement('style')
  style.id = THEME_CSS_ID
  style.textContent = THEME_CSS
  document.head.appendChild(style)
}

/** 读页面底色亮度（0=黑 1=白）；拿不到返回 null。 */
function bgLuma(el: Element | null): number | null {
  if (!el) return null
  const bg = getComputedStyle(el).backgroundColor
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(bg)
  if (!m) return null
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** 当前主题：先用 color-scheme，再退化成底色亮度，最后默认深色。 */
export function detectTheme(): TsTheme {
  if (typeof document === 'undefined') return 'dark'
  const scheme = getComputedStyle(document.documentElement).colorScheme || ''
  if (/\blight\b/.test(scheme)) return 'light'
  if (/\bdark\b/.test(scheme)) return 'dark'
  const luma = bgLuma(document.body)
  if (luma !== null) return luma > 0.55 ? 'light' : 'dark'
  return 'dark'
}

/** 把主题写到 <html data-ts-theme>；返回当前主题。 */
export function applyTheme(): TsTheme {
  if (typeof document === 'undefined') return 'dark'
  installThemeCss()
  const theme = detectTheme()
  const root = document.documentElement
  if (root.getAttribute('data-ts-theme') !== theme) root.setAttribute('data-ts-theme', theme)
  return theme
}

/**
 * 开始跟随宿主主题。返回停止函数。
 * （插件外壳在 document 级生效，所以挂在 <html> 上而不是某个 React 根节点。）
 */
export function startThemeWatch(onChange?: (theme: TsTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  installThemeCss()
  let last = applyTheme()
  const tick = () => {
    const next = applyTheme()
    if (next !== last) {
      last = next
      onChange?.(next)
    }
  }
  const mq = window.matchMedia?.('(prefers-color-scheme: light)')
  mq?.addEventListener?.('change', tick)
  // 宿主切主题可能只改 <html style> 或往 <head> 里塞样式表 → 两种都盯上
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(tick) : null
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
  if (document.head) mo?.observe(document.head, { childList: true, subtree: true, attributeFilter: ['media'] })
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') tick()
  }, 2000)
  return () => {
    mq?.removeEventListener?.('change', tick)
    mo?.disconnect()
    window.clearInterval(timer)
  }
}
