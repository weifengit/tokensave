#!/usr/bin/env node
/**
 * 标题栏位置（顶部 / 左侧 / 右侧）的真实几何自检 —— 用无头浏览器量网格，不靠正则猜。
 *
 *   node scripts/check-chrome-geometry.mjs
 *   DSH_CHROMIUM=/path/to/chrome node scripts/check-chrome-geometry.mjs
 *
 * 为什么单独一份、且**不**进 pnpm test 默认链：它要起浏览器（CI/无桌面环境常常没有，
 * 本机 Edge 的无头模式也不是每次都能起）；而 chrome-position.ts 的浮层几何与偏好读写
 * 已由 check-chrome-position.mjs 用纯函数逐条钉死。这一份补的是**CSS 网格**：
 * 「侧置后顶部那一行真的没了」「竖轨真的 44px」「状态栏还在最底下且没被竖轨压住」
 * ——这些只有真排版算得出来，正则看不出来。
 *
 * 判定口径（全部相对工作台自身矩形）：
 *   · 顶置：首行 42px、标题行横满整个工作台、内容区顶边 = 标题行底边；
 *   · 侧置：首列为 44px、标题行占该列且**下沿到状态栏上沿为止**（不压状态栏）、
 *     内容区顶边 = 工作台顶边（顶部没有标题行）、项目名竖排、关闭 chips 收起；
 *   · 中区收起 / 左区收起时列定义跟着变（不串成三列）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol

// —— 从 DeskDock.tsx 里抽出外壳 CSS（模板串），并把 ${RAIL_W} 换成真值 ——
const dockSrc = readFileSync(join(root, 'client/src/panel/DeskDock.tsx'), 'utf8')
const start = dockSrc.indexOf('const DOCK_CSS = `') + 'const DOCK_CSS = `'.length
const end = dockSrc.indexOf('\n`', start)
if (start <= 20 || end < 0) {
  console.log('FAIL  没能从 DeskDock.tsx 里抽出 DOCK_CSS 模板串（文件名/结构变了？）')
  process.exit(1)
}
const css = dockSrc.slice(start, end).replace(/\$\{RAIL_W\}/g, '44')
const RAIL = 44

// 与真实工作台同构的最小骨架：标题行（左右两组）+ 三个区域 + 状态栏
const page = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;height:900px;position:relative">
<style>${css}</style>
<div class="ts-dock" id="dock" data-chrome="top">
  <header class="ts-titlebar" id="tb">
    <div class="ts-title-left" id="tl">
      <button class="ts-title-switch" id="sw"><span>zone</span><span class="ts-title-caret" id="caret">v</span></button>
      <span class="ts-title-proj" id="proj">TokSave 工作台</span>
      <span class="ts-sb-sep" id="tsep"></span>
      <button class="ts-closed-chip" id="chip">＋ 预览</button>
    </div>
    <div class="ts-title-right" id="tr">
      <button class="ts-tg ts-tg--region" data-on="1">a</button>
      <button class="ts-tg ts-tg--region" data-on="1">b</button>
      <button class="ts-tg ts-tg--region" data-on="1">c</button>
      <span class="ts-tg-sep" id="rsep"></span>
      <button class="ts-tg" id="gear">g</button>
    </div>
  </header>
  <div class="ts-region" data-region="left" id="rl"><div class="ts-region-host"></div></div>
  <div class="ts-region" data-region="center" id="rc"><div class="ts-region-host"></div></div>
  <div class="ts-region" data-region="right" id="rr"><div class="ts-region-host"></div></div>
  <footer class="ts-statusbar" data-desk-statusbar="" id="sb">状态栏</footer>
</div>
<pre id="out"></pre>
<script>
const px = (v) => Math.round(parseFloat(v) * 100) / 100
const R = (id) => {
  const el = document.getElementById(id)
  const r = el.getBoundingClientRect()
  return { left: px(r.left), right: px(r.right), top: px(r.top), bottom: px(r.bottom), w: px(r.width), h: px(r.height) }
}
const S = () => ({
  cols: getComputedStyle(document.getElementById('dock')).gridTemplateColumns.split(' '),
  rows: getComputedStyle(document.getElementById('dock')).gridTemplateRows.split(' '),
  dock: R('dock'), tb: R('tb'), rc: R('rc'), rl: R('rl'), rr: R('rr'), sb: R('sb'), gear: R('gear'),
  tbPos: getComputedStyle(document.getElementById('tb')).position,
  proj: getComputedStyle(document.getElementById('proj')).writingMode,
  chip: getComputedStyle(document.getElementById('chip')).display,
  caret: getComputedStyle(document.getElementById('caret')).display,
  rsep: { w: getComputedStyle(document.getElementById('rsep')).width, h: getComputedStyle(document.getElementById('rsep')).height },
  trDir: getComputedStyle(document.getElementById('tr')).flexDirection,
})
const dock = document.getElementById('dock')
const out = {}
const modes = {
  top: {},
  left: { 'data-chrome': 'left' },
  right: { 'data-chrome': 'right' },
  leftHideCenter: { 'data-chrome': 'left', 'data-hide-center': '' },
  rightHideCenter: { 'data-chrome': 'right', 'data-hide-center': '' },
  leftHideLeft: { 'data-chrome': 'left', 'data-hide-left': '' },
}
for (const name of Object.keys(modes)) {
  for (const k of ['data-chrome', 'data-hide-center', 'data-hide-left']) dock.removeAttribute(k)
  for (const [k, v] of Object.entries(modes[name])) dock.setAttribute(k, v)
  out[name] = S()
}
document.getElementById('out').textContent = JSON.stringify(out)
</script>
</body></html>`

const candidates = [
  process.env.DSH_CHROMIUM,
  join(homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'),
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)
const browser = candidates.find((c) => existsSync(c))

if (!browser) {
  console.log('SKIP  没找到 Chrome/Edge/Chromium —— 跳过标题栏真实几何自检')
  console.log('      （要跑它：DSH_CHROMIUM=/path/to/chrome node scripts/check-chrome-geometry.mjs）')
  process.exit(0)
}

const dir = mkdtempSync(join(tmpdir(), 'ts-rail-geo-'))
try {
  const file = join(dir, 'probe.html')
  writeFileSync(file, page)
  let dom = ''
  try {
    dom = execFileSync(browser, [
      '--headless', '--disable-gpu', '--no-first-run', '--dump-dom',
      '--window-size=1440,900',
      '--user-data-dir=' + join(dir, 'profile'),
      '--virtual-time-budget=2500',
      'file://' + file,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 })
  } catch (e) {
    console.log(`FAIL  无头浏览器跑失败：${e.message}`)
    process.exit(1)
  }
  const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)
  let d = null
  try {
    d = JSON.parse((m ? m[1] : '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
  } catch { /* 下面判 FAIL */ }
  if (!d || !d.top) {
    console.log('FAIL  没拿到测量结果（页面没渲染完 / 浏览器参数变了？）')
    process.exit(1)
  }

  // —— 顶置（默认，旧行为不能变）——
  check('顶置：首行仍是 42px 标题行',
    near(parseFloat(d.top.rows[0]), 42), `rows=${d.top.rows.join(' ')}`)
  check('顶置：标题行横满整个工作台，且压在内容区上方',
    near(d.top.tb.w, d.top.dock.w) && near(d.top.rc.top, d.top.tb.bottom), `tb=${d.top.tb.w} rc.top=${d.top.rc.top}`)
  check('顶置：标题行仍是绝对定位（脱离列宽约束）', d.top.tbPos === 'absolute')
  check('顶置：项目名横排、关闭 chips 与箭头都在',
    d.top.proj === 'horizontal-tb' && d.top.chip === 'flex' && d.top.caret === 'flex')

  // —— 左侧竖轨 ——
  check('左轨：首列正好 44px',
    near(parseFloat(d.left.cols[0]), RAIL), `cols=${d.left.cols.join(' ')}`)
  check('左轨：只剩两行（顶部那一整行还给内容）',
    d.left.rows.length === 2 && near(d.left.rc.top, d.left.dock.top),
    `rows=${d.left.rows.join(' ')} rc.top=${d.left.rc.top} dock.top=${d.left.dock.top}`)
  check('左轨：标题行落在最左一列（宽 44）', near(d.left.tb.left, d.left.dock.left) && near(d.left.tb.w, RAIL))
  check('左轨：标题行下沿停在状态栏上沿（不压状态栏）',
    d.left.tb.bottom <= d.left.sb.top + 0.6, `tb.bottom=${d.left.tb.bottom} sb.top=${d.left.sb.top}`)
  check('左轨：状态栏仍横满整个工作台',
    near(d.left.sb.left, d.left.dock.left) && near(d.left.sb.w, d.left.dock.w))
  check('左轨：内容区不再从标题行下方开始（顶到工作台顶边 + 让出竖轨）',
    near(d.left.rc.left, d.left.dock.left + RAIL + parseFloat(d.left.cols[1])),
    `rc.left=${d.left.rc.left}`)
  check('左轨：项目名竖排、关闭 chips 与箭头收起',
    d.left.proj === 'vertical-rl' && d.left.chip === 'none' && d.left.caret === 'none')
  check('左轨：右侧那组按钮竖着排、分隔线横过来',
    d.left.trDir === 'column' && d.left.rsep.w === '18px' && d.left.rsep.h === '1px',
    `dir=${d.left.trDir} sep=${d.left.rsep.w}×${d.left.rsep.h}`)
  check('左轨：齿轮在竖轨内、贴近底部（浮层才挂得住）',
    d.left.gear.left >= d.left.tb.left && d.left.gear.right <= d.left.tb.right &&
    d.left.tb.bottom - d.left.gear.bottom <= 20,
    `gear=${d.left.gear.left}..${d.left.gear.right} gap=${d.left.tb.bottom - d.left.gear.bottom}`)

  // —— 右侧竖轨 ——
  check('右轨：末列正好 44px',
    near(parseFloat(d.right.cols[d.right.cols.length - 1]), RAIL), `cols=${d.right.cols.join(' ')}`)
  check('右轨：标题行落在最右一列、贴着工作台右缘',
    near(d.right.tb.right, d.right.dock.right) && near(d.right.tb.w, RAIL))
  check('右轨：内容区顶到工作台顶边、右侧让出竖轨',
    near(d.right.rc.top, d.right.dock.top) &&
    near(d.right.rc.right, d.right.tb.left - parseFloat(d.right.cols[d.right.cols.length - 2])),
    `rc.right=${d.right.rc.right}`)
  check('右轨：状态栏仍横满、标题行不压它',
    near(d.right.sb.w, d.right.dock.w) && d.right.tb.bottom <= d.right.sb.top + 0.6)

  // —— 收起状态下的列定义（别串成三列）——
  check('左轨 + 收起中区：仍是四列，第三列塌成 0',
    d.leftHideCenter.cols.length === 4 && near(parseFloat(d.leftHideCenter.cols[2]), 0),
    `cols=${d.leftHideCenter.cols.join(' ')}`)
  check('右轨 + 收起中区：仍是四列，第二列塌成 0',
    d.rightHideCenter.cols.length === 4 && near(parseFloat(d.rightHideCenter.cols[1]), 0),
    `cols=${d.rightHideCenter.cols.join(' ')}`)
  check('左轨 + 收起左区：竖轨还在（44px），主侧栏塌成 0',
    near(parseFloat(d.leftHideLeft.cols[0]), RAIL) && near(parseFloat(d.leftHideLeft.cols[1]), 0),
    `cols=${d.leftHideLeft.cols.join(' ')}`)

  if (fail) {
    console.log(`\n${fail} 项未通过`)
    process.exitCode = 1
  } else {
    console.log('\n全部通过')
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
