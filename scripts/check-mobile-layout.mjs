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

// —— 呼吸灯浮动面板（手机摆法）的真实几何 ——
// 宽度不是写死的：用真实策略 sheetBox 算，避免测试与实现各记一套数字。
const panelWidthBundle = join(tmpRoot, 'panel-width.mjs')
await build({
  entryPoints: [join(root, 'client/src/panel/panel-width.ts')],
  bundle: true, format: 'esm', outfile: panelWidthBundle, platform: 'neutral', logLevel: 'silent',
})
const panelWidth = await import(panelWidthBundle)
/** 短清单 → sheetBox 退到宽度下限（这也是「秒被裁」发生时的真实宽度） */
const sheetFor = (width) => panelWidth.sheetBox(width, [{ title: '短标题' }])
/** 18 条会话：足够把清单撑出可滚动高度 */
const sheetRows = Array.from({ length: 18 }, (_, i) => `
  <div class="ts-warn-row"><button class="ts-warn-item" type="button">
    <span class="ts-warn-icon"></span>
    <span class="ts-warn-body"><span class="ts-warn-title">会话标题 ${i + 1}：一个比较长的会话标题用于验证省略号与滚动</span>
    <span class="ts-warn-tags"><span class="ts-warn-sub">tokensave</span><span class="ts-warn-reason">上下文</span></span></span>
  </button><div class="ts-warn-actions"><span class="ts-warn-slot"></span><span class="ts-warn-slot"></span><span class="ts-warn-slot"></span></div></div>`).join('')
/** 内页：项目中心工具条 + 卡片 + 历史会话浮层（只量工具条与浮层，卡片另由 check-card-layout 负责）。 */
const innerPage = (width, height) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>mobile inner</title>
<style>
:root { --ts-fs: 13.5px; --ts-fg: #e6e8ec; --ts-fg-mute: #94a3b8; --ts-pop-fg: #e6e8ec; --ts-pop-fg-mute: #94a3b8;
        --ts-pop-bg: #22262e; --ts-pop-line: #3a4049; --ts-pop-shadow: 0 8px 30px rgba(0,0,0,.5); }
html, body { margin: 0; background: #14161b; color: var(--ts-fg); font-family: -apple-system, system-ui, sans-serif; }
#wrap { width: ${width}px; height: ${height}px; display: flex; }
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
<!-- 呼吸灯浮动面板（手机摆法）：宽度按真实策略给，验「清单能在内部滚、不溢出视口」 -->
<div class="ts-warn-pop ts-hover-pop is-sheet" id="pulse-pop"
  style="top:calc(env(safe-area-inset-top, 0px) + 12px); left:${sheetFor(width).left}px; width:${sheetFor(width).width}px; max-height:${Math.round(height * 0.7)}px">
<div class="ts-settings">
  <div class="ts-sec">
    <div class="ts-sec-head"><span class="ts-sec-title">提示音</span></div>
    <div class="ts-sound-body"><div class="ts-box">
      <div class="ts-box-row"><label>音量</label><input class="ts-sound-range" type="range" value="50"></div>
      <div class="ts-box-row"><label>完成</label><select class="ts-select"><option>轻柔</option></select></div>
      <div class="ts-box-row"><label>中断</label><select class="ts-select"><option>警报</option></select></div>
      <div class="ts-box-row"><label>时长</label><select class="ts-select"><option>一声响</option></select></div>
    </div></div>
  </div>
  <div class="ts-sec">
    <div class="ts-sec-head"><span class="ts-sec-title">自动继续</span></div>
    <div class="ts-cont-block"><div class="ts-box">
      <div class="ts-box-row ts-cont-sw-row">
        <div class="ts-cont-sw-item"><label>分类</label><span class="ts-cont-sw on"><i></i></span></div>
        <div class="ts-cont-sw-item"><label>截断</label><span class="ts-cont-sw on"><i></i></span></div>
        <div class="ts-cont-sw-item"><label>瞬时</label><span class="ts-cont-sw on"><i></i></span></div>
      </div>
      <div class="ts-box-row ts-cont-num-row">
        <label>发送上限</label><input class="ts-cont-num" type="number" value="8"><span class="ts-cont-unit">次</span>
        <span class="ts-cont-gap"></span>
        <label>冷却基数</label><input class="ts-cont-num" type="number" value="20"><span class="ts-cont-unit">秒</span>
      </div>
    </div></div>
  </div>
</div>
  <div class="ts-sec ts-sec-list">
    <div class="ts-sec-head"><span class="ts-sec-title">对话清单</span><span class="ts-sec-note">18</span></div>
    <div class="ts-list-body"><div class="ts-box ts-box-list"><div class="ts-warn-pop-list" id="pulse-list">
${sheetRows}
    </div></div></div>
  </div>
</div>
</body></html>`

/** 外页：把内页塞进 iframe（宽度 = 手机宽度），量完写进 #out。 */
const outerPage = (width, height) => `<!doctype html>
<html><head><meta charset="utf-8"><title>mobile outer</title>
<style>html,body{margin:0;background:#000}#f{border:0;display:block}</style></head>
<body>
<iframe id="f" src="inner.html" style="width:${width}px;height:${height}px"></iframe>
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
    const pulseEl = doc.getElementById('pulse-pop')
    const pulseList = doc.getElementById('pulse-list')
    const pulseRect = pulseEl.getBoundingClientRect()
    const pulseListRect = pulseList.getBoundingClientRect()
    const boxRows = [...doc.querySelectorAll('.ts-warn-pop.is-sheet .ts-box-row')]
    const listRows = [...doc.querySelectorAll('.ts-warn-pop.is-sheet .ts-warn-row')]
    const settingsBox = doc.querySelector('.ts-settings')
    pulseList.scrollTop = 400
    d.pulse = {
      left: px(pulseRect.left), right: px(pulseRect.right), width: px(pulseRect.width),
      height: px(pulseRect.height), bottom: px(pulseRect.bottom),
      listBottom: px(pulseListRect.bottom), listClientH: pulseList.clientHeight,
      listScrollH: pulseList.scrollHeight, listAfterScroll: pulseList.scrollTop,
      boxRowH: boxRows.length ? Math.max(...boxRows.map((r) => px(r.getBoundingClientRect().height))) : 0,
      listRowH: listRows.length ? Math.max(...listRows.map((r) => px(r.getBoundingClientRect().height))) : 0,
      settingsH: settingsBox ? px(settingsBox.getBoundingClientRect().height) : 0,
    }
    // 设置行的单位必须落在外框（.ts-box）内；用真实 DOM 量，不估算。
    const numRow = doc.querySelector('.ts-cont-num-row')
    const numBox = numRow && numRow.closest('.ts-box')
    const units = numRow ? [...numRow.querySelectorAll('.ts-cont-unit')] : []
    const lastUnit = units[units.length - 1]
    d.pulse.numUnitOverflow = numBox && lastUnit
      ? px(lastUnit.getBoundingClientRect().right - numBox.getBoundingClientRect().right)
      : null
    d.pulse.numRowOverflow = numRow ? px(numRow.scrollWidth - numRow.clientWidth) : null
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
  // 三种常见手机视口：iPhone 15 级、矮屏、最窄档（矮屏正是「一行都看不全」的重灾区）
  const cases = [
    { width: 393, height: 800 },
    { width: 393, height: 660 },
    { width: 320, height: 568 },
  ]
  for (const { width, height } of cases) {
    writeFileSync(join(dir, 'inner.html'), innerPage(width, height))
    const file = join(dir, 'outer.html')
    writeFileSync(file, outerPage(width, height))
    let out = ''
    // 浏览器启动偶发超时（连着起多个无头实例时容易撞上）：重试两次。
    for (let attempt = 0; attempt < 3 && !out; attempt++) {
      try {
        out = execFileSync(browser, [
          '--headless=new', '--disable-gpu', '--no-first-run', '--dump-dom',
          '--allow-file-access-from-files',
          '--user-data-dir=' + join(dir, `profile${width}x${height}`),
          '--virtual-time-budget=3000',
          'file://' + file,
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 })
      } catch (e) {
        if (attempt === 2) {
          console.log(`FAIL  无头浏览器跑失败：${e.message}`)
          fail++
        }
      }
    }
    if (!out) continue
    const m = out.match(/<pre id="out">([\s\S]*?)<\/pre>/)
    let d = null
    try { d = JSON.parse((m ? m[1] : '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) } catch { /* 下面判 FAIL */ }
    if (!d || d.error) {
      console.log(`FAIL  ${width}px：没拿到测量结果（${d && d.error ? d.error : '页面没渲染完 / 浏览器参数变了？'}）`)
      fail++
      continue
    }
    check(`${width}×${height}px：项目中心内容不横向溢出（没有横向滚动条）`,
      d.innerScrollW <= d.innerClientW + 0.5,
      `inner scrollW=${d.innerScrollW} clientW=${d.innerClientW}`)
    check(`${width}×${height}px：工具条内容不溢出（不撑出外框）`,
      d.toolbarScrollW <= d.toolbarClientW + 0.5,
      `toolbar scrollW=${d.toolbarScrollW} clientW=${d.toolbarClientW}`)
    check(`${width}×${height}px：排序分组在工具条框内（含「按完成情况」那一档）`,
      d.sortRight <= d.toolbarRight + 0.5 && d.sortScrollW <= d.sortClientW + 0.5,
      `sort right=${d.sortRight} toolbar right=${d.toolbarRight} sort scrollW=${d.sortScrollW}`)
    check(`${width}×${height}px：历史会话浮层不越出视口（左缘不被切）`,
      d.popLeft >= 0 && d.popRight <= d.vw + 0.5,
      `pop left=${d.popLeft} right=${d.popRight} vw=${d.vw}`)
    // 字号上调后下限涨到约 297：320 视口放不下 12px 留白，按实现让位到 8px。
    const pulseMargin = width - panelWidth.SHEET_MARGIN_X * 2 < panelWidth.POP_W_MIN
      ? 8
      : panelWidth.SHEET_MARGIN_X
    check(`${width}×${height}px：呼吸灯面板是紧凑浮层（宽度 ≤ SHEET_MAX_W，放不下时限边距让位）`,
      d.pulse.width <= panelWidth.SHEET_MAX_W + 0.5 &&
      d.pulse.left >= pulseMargin - 0.5 &&
      d.pulse.right <= width - pulseMargin + 0.5,
      `left=${d.pulse.left} right=${d.pulse.right} width=${d.pulse.width} margin=${pulseMargin} (max ${panelWidth.SHEET_MAX_W})`)
    check(`${width}×${height}px：设置行的单位「秒」在卡片内（最窄宽不再裁字）`,
      d.pulse.numUnitOverflow !== null && d.pulse.numUnitOverflow <= 0.5,
      `单位右缘超出卡片 ${d.pulse.numUnitOverflow}px`)
    check(`${width}×${height}px：设置行不横向溢出（数值/单位都落在行内）`,
      d.pulse.numRowOverflow === null || d.pulse.numRowOverflow <= 0.5,
      `row overflow=${d.pulse.numRowOverflow}px`)
    check(`${width}×${height}px：呼吸灯面板高度不超过 70vh（上限按真实视口算）`,
      d.pulse.height <= Math.round(height * 0.7) + 2,
      `height=${d.pulse.height}（上限 ${Math.round(height * 0.7)} + 边框）`)
    check(`${width}×${height}px：手机面板行高压实（设置行 ≤38、清单行 ≤54）`,
      d.pulse.boxRowH > 0 && d.pulse.boxRowH <= 38 &&
      // 字号整体上调后清单行约 51px（仍高于 44px 触点下限）；阈值按 13.5 档放宽。
      d.pulse.listRowH > 0 && d.pulse.listRowH <= 54,
      `boxRow=${d.pulse.boxRowH} listRow=${d.pulse.listRowH}`)
    check(`${width}×${height}px：设置区不再吃掉半屏（≤340px，矮屏可自滚）`,
      d.pulse.settingsH > 0 && d.pulse.settingsH <= 340, `settings=${d.pulse.settingsH}`)
    check(`${width}×${height}px：清单至少露出两整行（≥88px 可视）`,
      d.pulse.listClientH >= 88, `listClientH=${d.pulse.listClientH}`)
    check(`${width}×${height}px：清单能在面板内部滚动（末尾会话不再被裁掉）`,
      d.pulse.listScrollH > d.pulse.listClientH + 4 && d.pulse.listAfterScroll > 0 &&
      d.pulse.listBottom <= d.pulse.bottom + 0.5,
      `clientH=${d.pulse.listClientH} scrollH=${d.pulse.listScrollH} scrollTop=${d.pulse.listAfterScroll} bottom=${d.pulse.listBottom}/${d.pulse.bottom}`)
  }
  rmSync(dir, { recursive: true, force: true })
}

console.log(skipped ? '\nSKIPPED（窄屏真实布局未验证）' : fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
