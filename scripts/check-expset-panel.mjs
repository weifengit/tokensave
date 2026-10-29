/**
 * 探索者设置面板自检（纯函数 + 假 fetch/存储，不需要浏览器）。
 *
 *   node scripts/check-expset-panel.mjs
 *
 * 三件事钉死：
 *   A. **落点与齿轮「设置」面板一字不差**（用户要求「照抄作业」）：同一个 popPlacement ——
 *      按钮下方 6px、右缘对齐按钮、夹在工作台内；侧置竖轨时从轨内侧向上长。
 *      自己另算一套「夹进侧栏」的写法已经删掉（那版会把侧栏盖住，用户反馈太难看）。
 *   B. **加载失败不白屏**：先亮本地快照、再后台刷新；网络层失败/5xx 重试一次，4xx 不重试，
 *      错误带接口地址，面板里直接给「重试」。
 *   C. **面板本身好看**：固定 300 宽、与齿轮面板同体量、最高 72vh；滚动条内嵌（细、圆头、
 *      留透明边），而不是贴在面板外沿的一条灰边。
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
  // —— A. 落点：与齿轮设置面板同一个 popPlacement ——
  const placeOut = join(dir, 'place.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/chrome-position.ts')],
    bundle: true, format: 'esm', outfile: placeOut, platform: 'neutral', logLevel: 'silent',
  })
  const P = await import(placeOut)

  const viewport = { width: 1440, height: 900 }
  const dock = { left: 56, right: 1440, top: 76, bottom: 900 }
  const W = 300
  const button = { left: 1363, right: 1391, top: 85, bottom: 109 }

  const top = P.popPlacement({ chrome: 'top', anchor: button, dock, viewport, width: W })
  check('顶置：挂在按钮下方 6px（与齿轮面板同款）', top.top === 109 + 6, `top=${top.top}`)
  check('顶置：右缘对齐按钮', top.left === button.right - W, `left=${top.left}`)
  check('顶置：夹在工作台内（不越过左右边缘）',
    top.left >= dock.left + 8 - 0.001 && top.left + W <= dock.right - 8 + 0.001)

  // 竖轨：按钮在轨底部 —— 与齿轮面板一样，从轨内侧向上长
  const railBtn = { left: 8, right: 36, top: 820, bottom: 844 }
  const rail = P.popPlacement({ chrome: 'left', anchor: railBtn, dock, viewport, width: W })
  check('左轨：从竖轨内侧漂出（轨宽 + 8px）', rail.left === dock.left + P.RAIL_W + 8, `left=${rail.left}`)
  check('左轨：给 bottom 向上长（不会掉出屏幕）', rail.bottom === viewport.height - railBtn.bottom, `bottom=${rail.bottom}`)
  check('左轨：不再出现 top（避免和 bottom 打架）', rail.top === undefined)

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

  let calls = 0
  globalThis.fetch = async () => { calls++; return okRes }
  const fresh = await api.fetchExplorerSettings()
  check('成功：返回目录并只请求一次', fresh.groups.length === 3 && calls === 1)
  const cached = api.readCachedExplorerSettings()
  check('成功：顺手落了本地快照（下次打开先亮它）', !!cached && cached.selected[0] === 'a/one')

  calls = 0
  globalThis.fetch = async () => {
    calls++
    if (calls === 1) throw new TypeError('Failed to fetch')
    return okRes
  }
  const retried = await api.fetchExplorerSettings()
  check('网络失败（Failed to fetch）：自动重试一次即恢复', calls === 2 && retried.groups.length === 3, `calls=${calls}`)

  calls = 0
  globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch') }
  let netErr = null
  try { await api.fetchExplorerSettings() } catch (e) { netErr = e }
  check('网络全失败：按退避重试到上限（1 次 + 3 次重试）', calls === 4, `calls=${calls}`)
  calls = 0
  globalThis.fetch = async () => {
    calls++
    if (calls <= 2) throw new TypeError('Failed to fetch')
    return okRes
  }
  const lateOk = await api.fetchExplorerSettings()
  check('连续失败两次后第三次成功（插件重挂窗口）', calls === 3 && lateOk.groups.length === 3, `calls=${calls}`)

  check('网络全失败：错误里带接口地址与原因',
    !!netErr && netErr.message.includes(api.EXPLORER_SETTINGS_URL) && /Failed to fetch/.test(netErr.message),
    netErr ? netErr.message : 'no error')

  calls = 0
  globalThis.fetch = async () => { calls++; return { ok: false, status: 401, text: async () => '{"error":"Unauthorized"}', json: async () => ({}) } }
  let authErr = null
  try { await api.fetchExplorerSettings() } catch (e) { authErr = e }
  check('401：不重试（重试也没用）', calls === 1, `calls=${calls}`)
  check('401：错误里带 HTTP 状态与后端提示',
    !!authErr && /HTTP 401/.test(authErr.message) && /Unauthorized/.test(authErr.message), authErr ? authErr.message : '')

  globalThis.window = { localStorage: fakeStorage({ 'tokensave:explorer-settings.v1': '{not json' }) }
  check('缓存损坏：读缓存返回 null 而不是抛错', api.readCachedExplorerSettings() === null)
  globalThis.window = { localStorage: fakeStorage({ 'tokensave:explorer-settings.v1': JSON.stringify({ groups: [] }) }) }
  check('缓存为空目录：当作没有缓存', api.readCachedExplorerSettings() === null)

  // —— C. 接线与外观（源码级）——
  const panel = readFileSync(join(root, 'client/src/panel/ExplorerSettings.tsx'), 'utf8')
  const dockSrc = readFileSync(join(root, 'client/src/panel/DeskDock.tsx'), 'utf8')
  const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
  const apiSrc = readFileSync(join(root, 'client/src/panel/api.ts'), 'utf8')

  check('面板接受注入的落点函数（与齿轮面板共用一个）',
    /place\?: \(anchor: DOMRect, width: number\) => PopPlacement/.test(panel) &&
    /const compute = place \?\? defaultPlace/.test(panel))
  check('面板固定 300 宽（与齿轮面板同体量）',
    /const POP_WIDTH = 300/.test(panel) && /compute\(r, POP_WIDTH\)/.test(panel) &&
    /\.ts-expset-pop \{[^}]*width:300px/.test(styles))
  check('工作台把 popPlacement 注进去（照抄齿轮面板的位置）',
    /place=\{\(anchor, width\) => popPlacement\(\{/.test(dockSrc) &&
    /chrome: chromePos/.test(dockSrc) &&
    /dock: dockRootRef\.current\?\.getBoundingClientRect\(\) \?\? null/.test(dockSrc))
  check('不再有「夹进侧栏」那套自算落点（pop-anchor 已删）',
    !/pop-anchor/.test(panel) && !/pop-anchor/.test(dockSrc) && !/bounds=\{/.test(dockSrc))
  check('落点支持 top / bottom 两种（竖轨向上长）',
    /top: pos\?\.top,/.test(panel) && /bottom: pos\?\.bottom,/.test(panel))

  check('滚动条内嵌：细、透明轨、圆头且留透明边',
    /scrollbar-width:thin/.test(styles) &&
    /\.ts-expset-pop::-webkit-scrollbar \{ width:10px/.test(styles) &&
    /::-webkit-scrollbar-track \{ background:transparent/.test(styles) &&
    /::-webkit-scrollbar-thumb \{[^}]*border-radius:999px/.test(styles) &&
    /::-webkit-scrollbar-thumb \{[^}]*background-clip:content-box/.test(styles) &&
    /::-webkit-scrollbar-thumb \{[^}]*border:3px solid transparent/.test(styles))
  check('不会出现横向滚动条', /\.ts-expset-pop \{[^}]*overflow-x:hidden/.test(styles))
  check('紧凑版式已移除（用户反馈挤、难看）', !/data-compact/.test(styles) && !/data-compact/.test(panel))
  check('面板高度上限与齿轮面板同口径（72vh）',
    /\.ts-expset-pop \{[^}]*max-height:72vh/.test(styles))

  check('打开时先亮本地快照，再后台刷新',
    /readCachedExplorerSettings\(\)/.test(panel) && /setFromCache\(true\)/.test(panel))
  check('失败有「重试」入口（不是只剩一行错误）',
    /data-desk-explorers-err/.test(panel) && /ts-expset-retry/.test(panel) && /setAttempt\(\(n\) => n \+ 1\)/.test(panel))
  check('重试会重跑加载 effect', /\}, \[open, attempt, place\]\)/.test(panel))
  check('网络层失败会自动再试（0.8s 起翻倍，共 3 次）',
    /const AUTO_RETRY_LIMIT = 3/.test(panel) &&
    /if \(isNetworkFailure\(e\) && autoTriesRef\.current < AUTO_RETRY_LIMIT\)/.test(panel) &&
    /800 \* 2 \*\* \(autoTriesRef\.current - 1\)/.test(panel))
  check('标签页回到前台 / 网络恢复也会自动再拉一次',
    /document\.addEventListener\('visibilitychange', onVisible\)/.test(panel) &&
    /window\.addEventListener\('online', again\)/.test(panel))
  check('失败文案是人话（原文留在 title 里）',
    /function friendlyLoadError/.test(panel) && /title=\{err\}/.test(panel) &&
    /点「重试」再试/.test(panel))
  check('重试节奏与「网络层失败」判定在 api 层集中一份',
    /export const EXPLORER_RETRY_DELAYS = \[120, 350, 800\]/.test(apiSrc) &&
    /export function isNetworkFailure/.test(apiSrc))
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
