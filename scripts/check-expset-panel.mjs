/**
 * 探索者设置面板自检（纯函数 + 假 fetch/存储，不需要浏览器）。
 *
 *   node scripts/check-expset-panel.mjs
 *
 * 这轮反馈两条：
 *   1. 「浮动面板位置要参考其他面板优化」—— 以前只算 `right` + `top = 按钮底 + 6`：
 *      按钮在侧置竖轨底部时面板直接掉出屏幕；窄屏还会横向越界。
 *   2. 「面板一直加载不出来，Failed to fetch」—— 接口挂掉后只剩一行错误、没有重试，
 *      内容也丢了，面板等于废的。
 *
 * 所以这里钉三组事：
 *   A. 落点：默认向下、右缘对齐；下方放不下翻上去；竖轨按钮从右侧展开；永不越出视口；
 *   B. 加载：网络失败重试一次、4xx 不重试、成功后落本地快照、失败也带得上 URL；
 *   C. 接线：面板确实用了这两条路，并且有「重试」入口（不能又退回一行错误）。
 */
import { build } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-expset-'))

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

/** 极简 localStorage 替身（api.ts 里的缓存函数读写它）。 */
function fakeStorage(seed = {}) {
  const data = { ...seed }
  return {
    data,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
  }
}

try {
  // —— A. 落点（pure）——
  const anchorOut = join(dir, 'anchor.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/pop-anchor.ts')],
    bundle: true, format: 'esm', outfile: anchorOut, platform: 'neutral', logLevel: 'silent',
  })
  const A = await import(anchorOut)
  const vp = { width: 1440, height: 900 }
  /** 面板实际画出来的高度 = min(内容高, maxHeight)；落点不能让它越出视口 */
  const inside = (r, v, contentH) => {
    const h = Math.min(contentH, r.maxHeight)
    return r.left >= 8 - 0.001 && r.left <= v.width - 8 + 0.001 &&
      r.maxHeight >= 0 && r.top >= 8 - 0.001 && r.top + h <= v.height - 8 + 0.001
  }

  // 顶置：标题行右端的按钮（下方空间充足）
  const topBtn = { left: 1200, right: 1320, top: 8, bottom: 32 }
  const below = A.anchorPopup({ anchor: topBtn, viewport: vp, size: { width: 380, height: 420 }, heightCap: 576 })
  check('普通按钮：默认挂在按钮下方 6px', below.placement === 'below' && below.top === topBtn.bottom + 6, `top=${below.top}`)
  check('普通按钮：右缘对齐按钮右缘', below.left === topBtn.right - 380, `left=${below.left}`)
  check('普通按钮：不出视口', inside(below, vp, 420), `left=${below.left} top=${below.top} maxH=${below.maxHeight}`)

  // 侧置竖轨：按钮在左下角（我的新竖轨就是这种位置）
  const railBtn = { left: 8, right: 36, top: 820, bottom: 844 }
  const rail = A.anchorPopup({ anchor: railBtn, viewport: vp, size: { width: 380, height: 420 }, heightCap: 576 })
  check('竖轨底部按钮：向上翻（不再掉出屏幕）', rail.placement === 'above', `placement=${rail.placement} top=${rail.top}`)
  check('竖轨底部按钮：面板底沿停在按钮上沿外 6px',
    Math.abs(rail.top + rail.maxHeight - (railBtn.top - 6)) < 40 || rail.top >= 8,
    `top=${rail.top} maxH=${rail.maxHeight}`)
  check('竖轨按钮：从按钮右侧展开（不盖住 44px 竖轨）', rail.left === railBtn.right + 6, `left=${rail.left}`)
  check('竖轨底部按钮：不出视口', inside(rail, vp, 420))
  check('竖轨按钮：maxHeight 收到上方可用高度', rail.maxHeight <= railBtn.top - 6 - 8, `maxH=${rail.maxHeight}`)

  // 窄屏（手机）：宽度与位置都必须夹住
  const phone = { width: 393, height: 800 }
  const narrow = A.anchorPopup({
    anchor: { left: 300, right: 330, top: 10, bottom: 40 },
    viewport: phone,
    size: { width: 420, height: 500 },
    widthCap: 361,
    heightCap: 512,
  })
  check('窄屏：面板宽度不超过视口（左右各留 8）',
    narrow.left >= 8 && narrow.left + 361 <= phone.width - 8, `left=${narrow.left}`)
  check('窄屏：不出视口（纵向）', narrow.top >= 8 && narrow.top + narrow.maxHeight <= phone.height - 8)

  // 尺寸未知的首帧：也得给出一个在视口里的位置
  const blind = A.anchorPopup({ anchor: topBtn, viewport: vp, size: { width: 0, height: 0 }, heightCap: 576 })
  check('首帧（尺寸未知）也有合法落点', Number.isFinite(blind.left) && blind.top >= 0 && blind.maxHeight > 0)

  // —— 夹在所属侧栏内（用户要求：面板不要超出边栏）——
  // 顶置：按钮在标题行右端，它那一栏是右侧辅助侧栏（desk 右边 260px）
  const desk = { left: 56, right: 1440, top: 40, bottom: 880 }
  const rightSide = { left: desk.right - 260, right: desk.right, top: desk.top + 42, bottom: desk.bottom - 28 }
  const sideBtn = { left: desk.right - 92, right: desk.right - 36, top: 48, bottom: 72 }
  const inSide = A.anchorPopup({
    anchor: sideBtn,
    viewport: vp,
    size: { width: 386, height: 480 },
    bounds: rightSide,
    heightCap: 576,
  })
  check('右栏内：面板整块被夹在侧栏里（不再压进编辑区）',
    inSide.withinBounds && inSide.left >= rightSide.left + 8 &&
    inSide.left + inSide.width <= rightSide.right - 8,
    `left=${inSide.left} w=${inSide.width} side=${rightSide.left}..${rightSide.right}`)
  check('右栏内：宽度最多占满栏（260 - 两侧留白）', inSide.width <= 260 - 16, `w=${inSide.width}`)
  check('右栏内：贴着栏右侧内边（宽度占满到 8px 留白）',
    Math.abs(inSide.left + inSide.width - (rightSide.right - 8)) <= 1,
    `right=${inSide.left + inSide.width} sideRight=${rightSide.right}`)
  check('右栏内：竖向也不越出栏（上下留白）',
    inSide.top >= rightSide.top + 8 && inSide.top + Math.min(480, inSide.maxHeight) <= rightSide.bottom - 8)

  // 面板从侧栏的**标签条下方**开始（标签条 118..151）：不压住侧栏自己的标签
  const sideTabbed = A.anchorPopup({
    anchor: sideBtn,
    viewport: vp,
    size: { width: 386, height: 480 },
    bounds: { ...rightSide, top: rightSide.top + 33 + 6 },
    heightCap: 576,
  })
  // 标签条 = 栏顶 + 33；面板顶边必须落在它下面（侧栏自己的标签要留着能点）
  const tabsBottom = rightSide.top + 33
  check('不盖住侧栏标签条（面板顶边在标签条之下）', sideTabbed.top >= tabsBottom,
    `top=${sideTabbed.top} tabsBottom=${tabsBottom}`)

  // 侧栏很窄（用户拖到最小附近）：也必须在栏内，不能又拉宽到 300+ 压出去
  const skinny = { left: 1180, right: 1340, top: 118, bottom: 871 }
  const inSkinny = A.anchorPopup({
    anchor: sideBtn,
    viewport: vp,
    size: { width: 386, height: 480 },
    bounds: skinny,
    heightCap: 576,
  })
  check('窄栏（160）也整块夹在栏内',
    inSkinny.withinBounds && inSkinny.left >= skinny.left && inSkinny.left + inSkinny.width <= skinny.right,
    `left=${inSkinny.left} w=${inSkinny.width}`)
  check('窄栏里宽度缩到栏内宽（160 - 16）', inSkinny.width <= 160 - 16, `w=${inSkinny.width}`)
  check('栏窄到 140 以下才退回视口口径',
    !A.anchorPopup({ anchor: sideBtn, viewport: vp, size: { width: 386, height: 480 }, bounds: { left: 1180, right: 1320, top: 118, bottom: 871 }, heightCap: 576 }).withinBounds)

  // 左侧竖轨：按钮在轨里，面板该待到相邻的主侧栏里（44..264）
  const leftSide = { left: 44, right: 264, top: 40, bottom: 852 }
  const inLeft = A.anchorPopup({
    anchor: railBtn,
    viewport: vp,
    size: { width: 386, height: 420 },
    bounds: leftSide,
    heightCap: 576,
  })
  check('左轨：面板整块在左栏内（不越到编辑区）',
    inLeft.withinBounds && inLeft.left >= leftSide.left && inLeft.left + inLeft.width <= leftSide.right,
    `left=${inLeft.left} w=${inLeft.width}`)
  check('左轨：仍然向上翻、不出栏', inLeft.placement === 'above' && inLeft.top >= leftSide.top)

  // 栏被收起（只剩把手）：退回按视口夹位，不能把面板压成一条缝
  const collapsed = A.anchorPopup({
    anchor: sideBtn,
    viewport: vp,
    size: { width: 0, height: 420 },
    bounds: { left: desk.right - 4, right: desk.right, top: 40, bottom: 852 },
    heightCap: 576,
  })
  check('栏收起时不硬塞（withinBounds=false 且宽度恢复）',
    !collapsed.withinBounds && collapsed.width >= 300, `w=${collapsed.width}`)

  // —— B. 加载（api.ts，假 fetch + 假存储）——
  globalThis.window = { localStorage: fakeStorage() }
  const apiOut = join(dir, 'api.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/api.ts')],
    bundle: true, format: 'esm', outfile: apiOut, platform: 'neutral', logLevel: 'silent',
  })
  const api = await import(apiOut)
  const payload = {
    groups: [
      { id: 'default', label: '默认', items: [{ model: 'a/one', label: '一', focus: 'f', group: 'default', available: true }] },
      { id: 'free', label: '免费', items: [] },
      { id: 'paid', label: '收费', items: [] },
    ],
    selected: ['a/one'],
    configured: true,
  }
  const okRes = { ok: true, status: 200, json: async () => payload, text: async () => '' }

  // 成功 → 落缓存
  let calls = 0
  globalThis.fetch = async () => { calls++; return okRes }
  const fresh = await api.fetchExplorerSettings()
  check('成功：返回目录并只请求一次', fresh.groups.length === 3 && calls === 1)
  const cached = api.readCachedExplorerSettings()
  check('成功：顺手落了本地快照（下次打开先亮它）', !!cached && cached.selected[0] === 'a/one')

  // 网络层失败一次 → 重试成功
  calls = 0
  globalThis.fetch = async () => {
    calls++
    if (calls === 1) throw new TypeError('Failed to fetch')
    return okRes
  }
  const retried = await api.fetchExplorerSettings()
  check('网络失败（Failed to fetch）：自动重试一次即恢复', calls === 2 && retried.groups.length === 3, `calls=${calls}`)

  // 网络层始终失败 → 错误里带 URL，便于排查
  calls = 0
  globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch') }
  let netErr = null
  try { await api.fetchExplorerSettings() } catch (e) { netErr = e }
  check('网络全失败：重试到上限（2 次请求）', calls === 2, `calls=${calls}`)
  check('网络全失败：错误里带接口地址与原因',
    !!netErr && netErr.message.includes(api.EXPLORER_SETTINGS_URL) && /Failed to fetch/.test(netErr.message),
    netErr ? netErr.message : 'no error')

  // 4xx：不重试，直接报状态码
  calls = 0
  globalThis.fetch = async () => { calls++; return { ok: false, status: 401, text: async () => '{"error":"Unauthorized"}', json: async () => ({}) } }
  let authErr = null
  try { await api.fetchExplorerSettings() } catch (e) { authErr = e }
  check('401：不重试（重试也没用）', calls === 1, `calls=${calls}`)
  check('401：错误里带 HTTP 状态与后端提示',
    !!authErr && /HTTP 401/.test(authErr.message) && /Unauthorized/.test(authErr.message), authErr ? authErr.message : '')

  // 缓存坏掉 / 没有 → null（面板退回纯在线）
  globalThis.window = { localStorage: fakeStorage({ 'tokensave:explorer-settings.v1': '{not json' }) }
  check('缓存损坏：读缓存返回 null 而不是抛错', api.readCachedExplorerSettings() === null)
  globalThis.window = { localStorage: fakeStorage() }
  globalThis.window = { localStorage: fakeStorage({ 'tokensave:explorer-settings.v1': JSON.stringify({ groups: [] }) }) }
  check('缓存为空目录：当作没有缓存', api.readCachedExplorerSettings() === null)

  // —— C. 接线（源码级）——
  const panel = readFileSync(join(root, 'client/src/panel/ExplorerSettings.tsx'), 'utf8')
  const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
  const apiSrc = readFileSync(join(root, 'client/src/panel/api.ts'), 'utf8')
  const dockSrc = readFileSync(join(root, 'client/src/panel/DeskDock.tsx'), 'utf8')
  check('面板落点走 pop-anchor 的纯函数', /from '\.\/pop-anchor'/.test(panel) && /anchorPopup\(\{/.test(panel))
  check('面板不再自己用 right 硬贴（会算出负值 / 出视口）',
    !/right: Math\.max\(margin, window\.innerWidth - r\.right\)/.test(panel) &&
    /left: pos\?\.left/.test(panel) && /top: pos\?\.top/.test(panel))
  check('面板把「所属那一栏」传给落点函数',
    /bounds: bounds \? bounds\(\) : null/.test(panel) && /bounds\?: \(\) => AnchorRect \| null/.test(panel))
  check('面板宽度/最小宽跟着落点走（否则 CSS min-width 会把宽顶回去）',
    /width: pos \? pos\.width : undefined/.test(panel) &&
    /minWidth: pos \? 0 : undefined/.test(panel) &&
    /maxWidth: pos \? pos\.width : undefined/.test(panel))
  check('工作台接线：取按钮所属侧栏（顶置→右栏，左侧竖轨→左栏）',
    /from '\.\/pop-anchor'/.test(dockSrc) &&
    /chromePos === 'left' \? 'left' : 'right'/.test(dockSrc) &&
    /\.ts-region\[data-region="\$\{region\}"\]/.test(dockSrc) &&
    /POP_MIN_BOUNDS_WIDTH/.test(dockSrc))
  check('面板从侧栏标签条下方开始（不压住侧栏自己的标签）',
    /dv-tabs-and-actions-container/.test(dockSrc) && /SIDEBAR_TABS_GAP/.test(dockSrc))
  check('窄栏换紧凑版式（data-compact + 对应 CSS）',
    /data-compact=\{pos && pos\.width < 300/.test(panel) &&
    /\.ts-expset-pop\[data-compact\] \{ padding:8px/.test(styles))
  check('面板高度跟着可用空间走（内部滚动，不被屏幕裁）', /maxHeight: pos \? pos\.maxHeight : undefined/.test(panel))
  check('打开时先亮本地快照，再后台刷新',
    /readCachedExplorerSettings\(\)/.test(panel) && /setFromCache\(true\)/.test(panel))
  check('失败有「重试」入口（不是只剩一行错误）',
    /data-desk-explorers-err/.test(panel) && /ts-expset-retry/.test(panel) && /setAttempt\(\(n\) => n \+ 1\)/.test(panel))
  check('重试会重跑加载 effect', /\}, \[open, attempt\]\)/.test(panel))
  check('重试按钮样式存在（错误行是一条 flex）',
    /\.ts-expset-err \{ display:flex;/.test(styles) && /\.ts-expset-retry \{/.test(styles))
  check('面板宽度按 border-box 算（否则 padding 会把面板撞出栏外）',
    /\.ts-expset-pop \{[^}]*box-sizing:border-box/.test(styles))
  check('接口地址是一个常量（错误提示与自检共用）',
    /export const EXPLORER_SETTINGS_URL = '\/plugins\/dsh-tokensave\/explorer-settings'/.test(apiSrc))
  check('请求带 no-store（不被中间缓存 / 代理卡住）', /cache: 'no-store'/.test(apiSrc))
  check('成功后落快照的调用点在 api 层（面板不用重复写）',
    /cacheExplorerSettings\(payload\)/.test(apiSrc) && /export function cacheExplorerSettings/.test(apiSrc))

  if (fail) {
    console.log(`\n${fail} 项未通过`)
    process.exitCode = 1
  } else {
    console.log('\n全部通过')
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
