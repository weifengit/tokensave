/**
 * 移动端（窄视口）真实布局自检 —— 用无头浏览器量几何，钉死两个用户报过的 bug：
 *
 *   node scripts/check-mobile-layout.mjs
 *
 *   A. 项目中心工具条：排序多出「按完成情况」后，分段控件比手机屏还宽 →
 *      工具条被撑破、页面出现横向滚动条、内容溢出外框
 *      （用户反馈：「项目中心的排序新增了按完成情况超出界面导致出现了水平滚动条
 *      并且超出了外框，布局有点问题」）。
 *      判定：.ts-center-inner 的 scrollWidth == clientWidth（**没有**横向溢出），
 *            工具条内容不溢出，排序分组仍在框内。
 *
 *   B. 历史会话浮层：手机上点「历史会话」弹出的窗口**左侧被遮挡**
 *      （用户反馈：「工作台点击历史回话弹出的窗口左侧被遮挡了」）。
 *      判定：浮层宽度不超过视口（左右各留 12px），左缘 >= 0、右缘 <= 视口宽。
 *
 * 为什么要单独有这一条：这两条都是**几何**问题 —— 源码里规则写着、看着也对，
 * 但窄屏下 flex 收缩 / 浮层定位算出来就溢出。正则断言看不出来（卡片那次就是这么漏的），
 * 所以必须拿真浏览器量。找不到浏览器时明确 SKIP（换机器/CI 上不该因此红掉）。
 *
 * 窄视口怎么模拟：--window-size 在本机 headless 上不生效（视口固定），
 * 所以改用 **iframe**：内页宽度 = 手机宽度，媒体查询与 100vw 都在这个视口里算。
 * 需要 --allow-file-access-from-files 才能读 iframe 内的 DOM。
 * 可用环境变量指定浏览器：DSH_CHROMIUM=/path/to/chrome
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let fail = 0
let skipped = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
const start = styles.indexOf('const CSS = `') + 'const CSS = `'.length
const end = styles.indexOf('`', start)
const css = styles.slice(start, end)
if (start <= 12 || end < 0) {
  console.log('FAIL  没能从 styles.ts 里抽出 CSS 模板串（文件名/结构变了？）')
  process.exit(1)
}


// —— 源码级断言：几何那几条之外的“根因”钉死（浮层定位是 JS 算的，正则能查）——
const sessSrc = readFileSync(join(root, 'client/src/panel/SessionPicker.tsx'), 'utf8')
const centerSrc = readFileSync(join(root, 'client/src/panel/ProjectCenter.tsx'), 'utf8')
check('历史会话浮层：左缘按视口夹回（不再只右对齐按钮右缘）',
  /const left = Math\.min\(Math\.max\(margin, preferred\), Math\.max\(margin, vw - margin - w\)\)/.test(sessSrc) &&
  /left: pos\?\.left \?\? 12/.test(sessSrc) &&
  !/right: pos\?\.right/.test(sessSrc),
  '浮层位置必须由 left 夹住（用户反馈“弹窗左侧被遮挡”）')
check('窄屏样式：排序分组可换行 + 浮层宽度夹在视口内',
  /@media \(max-width: 900px\)/.test(css) &&
  /\.ts-center-toolbar \.ts-seg \{ flex-wrap: wrap; \}/.test(css) &&
  /\.ts-center-toolbar \.ts-seg-sort \{ flex: 1 1 100%; \}/.test(css) &&
  /\.ts-sess-pop \{ width: calc\(100vw - 24px\)/.test(css))
check('项目中心：两组分段控件带可定位的类名（窄屏样式要分别处理）',
  /className="ts-seg ts-seg-mode"/.test(centerSrc) &&
  /className="ts-seg ts-seg-sort"/.test(centerSrc))
const previewSrc = readFileSync(join(root, 'client/src/panel/PreviewPanel.tsx'), 'utf8')
check('移动端：预览地址里的回环主机换成页面所在主机（否则 iframe 永远空白）',
  /function rewriteLoopbackHost\(raw: string\): string/.test(previewSrc) &&
  /u\.hostname = pageHost/.test(previewSrc) &&
  /if \(!raw\.startsWith\('\/'\)\) return rewriteLoopbackHost\(raw\)/.test(previewSrc),
  '手机访问的 127.0.0.1 指的是手机自己 → 必须换成隧道/虚拟网地址')

const tmpRoot = mkdtempSync(join(tmpdir(), 'ts-mobile-'))
// —— absoluteUrl 的**函数级**验证：把 PreviewPanel 打包后注入假的 window.location ——
// 桌面端（回环）必须原样保留；手机端（隧道/虚拟网地址）要把 127.0.0.1 换掉，
// 否则 iframe 里的 127.0.0.1 指的是**手机自己** → 预览永远是空白。
const previewBundle = join(tmpRoot, 'preview-panel.mjs')
await build({
  entryPoints: [join(root, 'client/src/panel/PreviewPanel.tsx')],
  bundle: true, format: 'esm', outfile: previewBundle, platform: 'node', logLevel: 'silent',
})
const { absoluteUrl } = await import(previewBundle)
const fakeWindow = (hostname, origin) => { globalThis.window = { location: { hostname, origin } } }
fakeWindow('127.0.0.1', 'http://127.0.0.1:3080')
const desktopUrl = absoluteUrl('http://127.0.0.1:3180/')
fakeWindow('10.126.126.13', 'http://10.126.126.13:3080')
const phoneUrl = absoluteUrl('http://127.0.0.1:3180/')
const phoneRelative = absoluteUrl('/api/intel/site/console/')
const phoneForeign = absoluteUrl('http://192.168.1.5:4000/')
check('桌面端：预览地址原样保留 127.0.0.1（桌面就该指本机）',
  desktopUrl === 'http://127.0.0.1:3180/', desktopUrl)
check('手机端：预览地址的回环主机换成页面所在主机（隧道/虚拟网地址）',
  phoneUrl === 'http://10.126.126.13:3180/', phoneUrl)
check('手机端：相对路径仍按页面 origin 解析（DSH 自带页面不受影响）',
  phoneRelative === 'http://10.126.126.13:3080/api/intel/site/console/', phoneRelative)
check('手机端：非回环的 dev 地址不动（不乱改用户自己的地址）',
  phoneForeign === 'http://192.168.1.5:4000/', phoneForeign)
/** 内页：项目中心工具条 + 卡片 + 历史会话浮层（只量工具条与浮层，卡片另由 check-card-layout 负责）。 */
const innerPage = (width) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>mobile inner</title>
<style>
:root { --ts-fs: 12.5px; --ts-fg: #e6e8ec; --ts-fg-mute: #94a3b8; --ts-pop-fg: #e6e8ec; --ts-pop-fg-mute: #94a3b8;
        --ts-pop-bg: #22262e; --ts-pop-line: #3a4049; --ts-pop-shadow: 0 8px 30px rgba(0,0,0,.5); }
html, body { margin: 0; background: #14161b; color: var(--ts-fg); font-family: -apple-system, system-ui, sans-serif; }
#wrap { width: ${width}px; height: 800px; display: flex; }
#wrap > .ts-center { flex: 1; min-width: 0; }
${css}
</style></head>
<body>
<div id="wrap"><div class="ts-cr ts-center"><div class="ts-center-inner">
  <div class="ts-center-toolbar">
    <div class="ts-seg ts-seg-mode" role="group">
      <button class="ts-seg-btn active">▦ 卡片</button>
      <button class="ts-seg-btn">☰ 列表</button>
    </div>
    <div class="ts-seg ts-seg-sort" role="group">
      <span class="ts-seg-label">排序</span>
      <button class="ts-seg-btn active">按名称</button>
      <button class="ts-seg-btn">按创建时间</button>
      <button class="ts-seg-btn">按更新时间</button>
      <button class="ts-seg-btn">按完成情况</button>
    </div>
    <span class="ts-center-count">5 个项目</span>
  </div>
  <div class="ts-center-grid">
    <div class="ts-flip-scene ts-center-card-click"><div class="ts-flip-inner">
      <div class="ts-center-card ts-flip-face ts-flip-front"><div class="ts-center-name">tokensave</div></div>
    </div></div>
  </div>
</div></div></div>
<!-- 历史会话浮层：按 SessionPicker 的移动端口径 —— 左缘 12px、宽 = 视口 - 24px -->
<div class="ts-sess-pop" id="pop" style="position:fixed; top:200px; right:auto; left:12px; visibility:hidden">
  <div class="ts-sess-pop-head">历史会话 · 5 个</div>
  <div class="ts-sess-list"><div class="ts-sess-row"><div class="ts-sess-item">一个很长的会话标题，用来把浮层宽度顶到内容宽度上限</div></div></div>
</div>
</body></html>`

/** 外页：把内页塞进 iframe（宽度 = 手机宽度），量完写进 #out。 */
const outerPage = (width) => `<!doctype html>
<html><head><meta charset="utf-8"><title>mobile outer</title>
<style>html,body{margin:0;background:#000}#f{border:0;display:block}</style></head>
<body>
<iframe id="f" src="inner.html" style="width:${width}px;height:800px"></iframe>
<pre id="out"></pre>
<script>
window.addEventListener('load', () => {
  const px = (v) => Math.round(parseFloat(v) * 100) / 100
  let d = null
  try {
    const doc = document.getElementById('f').contentDocument
    const win = doc.defaultView
    const inner = doc.querySelector('.ts-center-inner')
    const toolbar = doc.querySelector('.ts-center-toolbar')
    const sort = doc.querySelector('.ts-seg-sort')
    const sr = sort.getBoundingClientRect()
    const tr = toolbar.getBoundingClientRect()
    const pop = doc.getElementById('pop')
    const pr = pop.getBoundingClientRect()
    d = {
      vw: win.innerWidth,
      innerScrollW: inner.scrollWidth, innerClientW: inner.clientWidth,
      toolbarScrollW: toolbar.scrollWidth, toolbarClientW: toolbar.clientWidth,
      toolbarRight: px(tr.right),
      sortRight: px(sr.right), sortScrollW: sort.scrollWidth, sortClientW: sort.clientWidth,
      popLeft: px(pr.left), popRight: px(pr.right), popW: px(pr.width),
    }
  } catch (e) { d = { error: String(e) } }
  document.getElementById('out').textContent = JSON.stringify(d)
})
</script>
</body></html>`

const candidates = [
  process.env.DSH_CHROMIUM,
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)
const browser = candidates.find((c) => existsSync(c))

console.log('— 移动端（窄视口）真实布局 —')
if (!browser) {
  skipped = 1
  console.log('SKIP  没找到 Chrome/Edge/Chromium —— 本机跳过窄屏真实布局自检')
  console.log('      （要跑它：DSH_CHROMIUM=/path/to/chrome node scripts/check-mobile-layout.mjs）')
} else {
  const dir = tmpRoot
  writeFileSync(join(dir, 'inner.html'), innerPage(393))
  // 两种常见手机宽度：iPhone 15 级的 393px 与最窄一档的 320px
  for (const width of [393, 320]) {
    writeFileSync(join(dir, 'inner.html'), innerPage(width))
    const file = join(dir, 'outer.html')
    writeFileSync(file, outerPage(width))
    let out = ''
    try {
      out = execFileSync(browser, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--dump-dom',
        '--allow-file-access-from-files',
        '--user-data-dir=' + join(dir, 'profile' + width),
        '--virtual-time-budget=3000',
        'file://' + file,
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 })
    } catch (e) {
      console.log(`FAIL  无头浏览器跑失败：${e.message}`)
      fail++
      continue
    }
    const m = out.match(/<pre id="out">([\s\S]*?)<\/pre>/)
    let d = null
    try { d = JSON.parse((m ? m[1] : '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) } catch { /* 下面判 FAIL */ }
    if (!d || d.error) {
      console.log(`FAIL  ${width}px：没拿到测量结果（${d && d.error ? d.error : '页面没渲染完 / 浏览器参数变了？'}）`)
      fail++
      continue
    }
    check(`${width}px：项目中心内容不横向溢出（没有横向滚动条）`,
      d.innerScrollW <= d.innerClientW + 0.5,
      `inner scrollW=${d.innerScrollW} clientW=${d.innerClientW}`)
    check(`${width}px：工具条内容不溢出（不撑出外框）`,
      d.toolbarScrollW <= d.toolbarClientW + 0.5,
      `toolbar scrollW=${d.toolbarScrollW} clientW=${d.toolbarClientW}`)
    check(`${width}px：排序分组在工具条框内（含「按完成情况」那一档）`,
      d.sortRight <= d.toolbarRight + 0.5 && d.sortScrollW <= d.sortClientW + 0.5,
      `sort right=${d.sortRight} toolbar right=${d.toolbarRight} sort scrollW=${d.sortScrollW}`)
    check(`${width}px：历史会话浮层不越出视口（左缘不被切）`,
      d.popLeft >= 0 && d.popRight <= d.vw + 0.5,
      `pop left=${d.popLeft} right=${d.popRight} vw=${d.vw}`)
  }
  rmSync(dir, { recursive: true, force: true })
}

console.log(skipped ? '\nSKIPPED（窄屏真实布局未验证）' : fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
