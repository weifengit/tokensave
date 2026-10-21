/**
 * 项目中心卡片**真实布局**自检（用无头浏览器量几何，不是正则猜）。
 *
 *   node scripts/check-card-layout.mjs
 *
 * 为什么要单独有这一条：2026-10-20 的线上反馈「卡片宽度不一样 / 相邻卡片重叠 / 悬停抖动」，
 * 根因是 styles.ts 里**一段注释漏了收尾的注释符** —— 紧跟其后的三条关键规则
 * （`.ts-flip-scene { min-width:0 }`、`.ts-flip-inner { grid-template-columns:minmax(0,1fr) }`、
 * `.ts-flip-face { min-width:0 }`）被 CSS 解析器整块当成注释吞掉了，从未生效。
 * 正则断言全绿也发现不了 —— 因为**源码里那几行确实在**，丢的是解析后的规则。
 * 所以这里必须拿真浏览器量：
 *
 *   A. 栅格每列等宽 ⇒ 每张卡（scene）等宽；
 *   B. 每个「面」的宽度 == 内层宽度（格子不被内容撑宽 ⇒ 不会溢出到相邻卡）；
 *   C. 卡片内容不越出卡片盒（OVERFLOW none）；
 *   D. CSSOM 里那三条 min-width / minmax 规则**真的存在**（这条直接钉死上面那个事故）。
 *
 * 找不到浏览器时**明确 SKIP**（不算失败）—— 换机器/CI 上不该因此红掉。
 * 可用环境变量指定：DSH_CHROMIUM=/path/to/chrome
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const face = (p, back) => `
  <div class="ts-center-card ts-flip-face ${back ? 'ts-flip-back' : 'ts-flip-front'}">
    <div class="ts-center-cardhead">
      <span class="ts-center-icon" aria-hidden="true">${back ? '✅' : '📁'}</span>
      <span class="ts-center-name" title="${p.name}">${p.name}</span>
      ${p.dots ? '<span class="ts-dots"><button class="ts-dot ts-dot-active">①</button><button class="ts-dot ts-dot-pending">②</button></span>' : ''}
      <button type="button" class="ts-flip-btn" aria-pressed="${back}">${back ? '↺ 翻回' : '↻ 翻牌'}</button>
    </div>
    <div class="ts-center-path"><span class="ts-center-basedir">${p.path.split('/').pop()}</span><span class="ts-center-fullpath">${p.path}</span></div>
    <div class="ts-center-desc">${p.desc || '<span class="ts-dim">（未填写项目介绍）</span>'}</div>
    <div class="ts-center-meta">
      <span class="ts-tag">创建于 ${p.created}</span>
      <span class="ts-tag ts-tag-warn">更新于 ${p.updated}</span>
    </div>
    <div class="ts-center-actions">
      ${p.dev
        ? '<a class="ts-dev-chip on ts-dev-chip-link" role="link"><span class="ts-dev-chip-state">● 已启动</span><span class="ts-dev-chip-go">去调试 →</span></a>'
        : '<span class="ts-dev-chip">○ 未启动</span>'}
      <button class="ts-btn ts-btn-sm ts-btn-primary">＋ 新会话</button>
      <button class="ts-btn ts-btn-sm ts-btn-danger">移除</button>
    </div>
  </div>`

// 样例刻意覆盖：长/短名字、有/无序号点、有/无开发服务器、正面/背面（is-done）
const projects = [
  { name: 'tokensave', path: '/Users/sonoma/code/tokensave', desc: 'DSH 插件：免费模型探索 + 共享黑板', created: '10/19 10:52', updated: '刚刚', status: 'active', dots: true, dev: true },
  { name: 'openvpn-remote-control', path: '/Users/sonoma/code/openvpn-remote-control', desc: '', created: '10/15 09:34', updated: '3 天前', status: 'done', dots: false, dev: false },
  { name: 'summer', path: '/Users/sonoma/code/summer', desc: '一个很长的项目介绍，用来验证两行截断不会把卡片撑开或挤到旁边的卡片上', created: '10/20 10:45', updated: '1 分钟前', status: 'active', dots: true, dev: false },
  { name: 'aibg', path: '/Users/sonoma/code/aibg', desc: 'AI 背景图工具', created: '10/19 18:38', updated: '昨天', status: 'done', dots: false, dev: true },
  { name: 'compare-text', path: '/Users/sonoma/code/compare-text', desc: '文本对比', created: '10/20 09:20', updated: '2 小时前', status: 'active', dots: false, dev: true },
]

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>card layout</title>
<style>
:root { --ts-fs: 12.5px; --ts-fg: #e6e8ec; --ts-fg-mute: #94a3b8; --ts-pop-fg: #e6e8ec; --ts-pop-fg-mute: #94a3b8; }
html, body { margin: 0; background: #14161b; color: var(--ts-fg); font-family: -apple-system, system-ui, sans-serif; }
#wrap { width: 1100px; height: 900px; display: flex; }
#wrap > .ts-center { flex: 1; min-width: 0; }
${css}
</style></head>
<body>
<div id="wrap"><div class="ts-cr ts-center"><div class="ts-center-inner"><div class="ts-center-grid">
${projects.map((p) => `<div class="ts-flip-scene ts-center-card-click" role="button" tabindex="0">
  <div class="ts-flip-inner${p.status === 'done' ? ' is-done' : ''}">${face(p, false)}${face(p, true)}</div>
</div>`).join('\n')}
<button class="ts-center-card ts-center-addcard"><span class="ts-center-addplus">＋</span><span class="ts-center-addlabel">添加项目</span></button>
</div></div></div></div>
<pre id="out"></pre>
<script>
window.addEventListener('load', () => {
  const px = (v) => Math.round(parseFloat(v) * 100) / 100
  const rules = [...document.styleSheets[0].cssRules]
  const grid = document.querySelector('.ts-center-grid')
  const track = px(getComputedStyle(grid).gridTemplateColumns.split(' ')[0])
  const cards = [...document.querySelectorAll('.ts-center-grid > .ts-flip-scene')].map((el) => {
    const r = el.getBoundingClientRect()
    const inner = el.querySelector('.ts-flip-inner')
    const faces = [...el.querySelectorAll('.ts-flip-face')]
    const overflowsCard = faces.some((f) => f.getBoundingClientRect().right - r.right > 0.5)
    const rowOverflow = (sel) => {
      const n = el.querySelector(sel)
      return n ? n.scrollWidth - n.clientWidth : 0
    }
    return {
      w: px(r.width), inner: px(inner.getBoundingClientRect().width),
      faceMax: px(Math.max(...faces.map((f) => f.getBoundingClientRect().width))),
      faceMin: px(Math.min(...faces.map((f) => f.getBoundingClientRect().width))),
      headOver: rowOverflow('.ts-center-cardhead'), metaOver: rowOverflow('.ts-center-meta'), actsOver: rowOverflow('.ts-center-actions'),
      outside: overflowsCard,
    }
  })
  // 直接问 CSSOM：那三条关键规则**解析后**还在不在（源码里有、解析后被吞掉是历史事故）
  const minWidthRules = rules.filter((r) => r.style && r.style.minWidth === '0px' && String(r.selectorText || '').indexOf('ts-flip') >= 0).length
  const minmaxRules = rules.filter((r) => r.style && String(r.style.gridTemplateColumns || '').indexOf('minmax(0') >= 0).length
  const widths = cards.map((c) => c.w)
  document.getElementById('out').textContent = JSON.stringify({
    track, cards, minWidthRules, minmaxRules,
    ruleCount: rules.length,
    allSameWidth: widths.every((w) => Math.abs(w - widths[0]) < 0.6),
    sceneRuleFound: rules.some((r) => String(r.selectorText || '') === '.ts-flip-scene'),
  })
})
</script>
</body></html>`

const dir = mkdtempSync(join(tmpdir(), 'ts-cardlayout-'))
const page = join(dir, 'card.html')
writeFileSync(page, html)

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

console.log('— 卡片真实布局（无头浏览器量几何）—')

if (!browser) {
  skipped = 1
  console.log('SKIP  没找到 Chrome/Edge/Chromium —— 本机跳过真实布局自检')
  console.log('      （要跑它：DSH_CHROMIUM=/path/to/chrome node scripts/check-card-layout.mjs）')
} else {
  let out = ''
  try {
    out = execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--dump-dom',
      '--user-data-dir=' + join(dir, 'profile'),
      '--virtual-time-budget=3000',
      'file://' + page,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 })
  } catch (e) {
    console.log(`FAIL  无头浏览器跑失败：${e.message}`)
    fail++
  }
  const m = out.match(/<pre id="out">([\s\S]*?)<\/pre>/)
  let data = null
  try { data = JSON.parse((m ? m[1] : '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) } catch { /* 下面是 FAIL */ }
  if (!data) {
    console.log('FAIL  没拿到测量结果（页面没渲染完 / 浏览器参数变了？）')
    fail++
  } else {
    const widths = data.cards.map((c) => c.w)
    check('栅格每列等宽 ⇒ 每张卡（scene）等宽',
      data.allSameWidth && widths.length === 5,
      `track=${data.track} 各卡宽=[${widths.join(', ')}]`)
    check('每个「面」的宽度 == 卡片宽度（格子没被内容撑宽）',
      data.cards.every((c) => Math.abs(c.faceMax - c.w) < 0.6 && Math.abs(c.faceMin - c.w) < 0.6),
      data.cards.map((c, i) => `#${i} 面=${c.faceMin}~${c.faceMax}/卡=${c.w}`).join(' '))
    check('卡片内容不越出卡片盒（不压到相邻卡）',
      data.cards.every((c) => !c.outside),
      data.cards.some((c) => c.outside) ? '有卡片内容溢出' : '无溢出')
    check('CSSOM 里三条 min-width / minmax 规则真的被解析进来了（防「被注释吞掉」事故重演）',
      data.minWidthRules >= 3 && data.minmaxRules >= 1 && data.sceneRuleFound,
      `minWidth 规则=${data.minWidthRules} minmax 规则=${data.minmaxRules} 总规则=${data.ruleCount}`)
    check('卡片内各行不顶出卡片（允许小幅吃进 18px 内边距）',
      data.cards.every((c) => c.headOver <= 0 && c.metaOver <= 8 && c.actsOver <= 0),
      data.cards.map((c, i) => `#${i} head+${c.headOver} meta+${c.metaOver} acts+${c.actsOver}`).join(' '))
  }
}

rmSync(dir, { recursive: true, force: true })

console.log(skipped ? '\nSKIPPED（真实布局未验证）' : fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)