/**
 * 轮末变更卡 / 宿主变更档案读取自检（纯函数 + 模拟 fetch，不需要浏览器）。
 *
 *   node scripts/check-changes-card.mjs
 *
 * 需求原话：「在原生的'对话'tab 下，每次会话结束时，最后面有'已编辑 2 个文件'
 * +13 -1 … 鼠标放在上面还能预览变化情况，请给我的'工作台'tab 也实现同样的效果。」
 *
 * 实现照搬原生卡的数据源（宿主 dsh-client-ui-deliverables 的两个认证路由）：
 *   - /api/changes.summary?sessionId&seq      → 清单 + 总增删 + 逐文件增删
 *   - /api/changes.diff?sessionId&seq&index   → 单文件 before/after unified diff
 * 这里钉四件事：
 *   1. 两个路由的响应校验口径（畸形响应一律拒绝，不把脏数据显示成行数）；
 *   2. 缓存语义：成功结果复用、失败/404 不复用（会话刚结束时可以后续重试）；
 *   3. 卡片渲染的硬事实：折叠行数、单文件只留 header、悬浮预览延迟 500ms；
 *   4. 样式消费的变量与类名存在（否则卡片渲染出来是裸 HTML）。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-changes-'))

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

try {
  const out = join(dir, 'api.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/changes-api.ts')],
    bundle: true,
    format: 'esm',
    outfile: out,
    platform: 'neutral',
    logLevel: 'silent',
  })
  const api = await import(out)

  // —— 1. 响应校验：畸形响应不能变成行数 ——
  // 用假 fetch 走真实代码路径（校验逻辑与请求拼装一起验，不单测校验函数）
  const GOOD = {
    turn: 1,
    files: [
      { path: 'client/src/panel/styles.ts', display: 'client/src/panel/styles.ts', added: 6, deleted: 0 },
      { path: 'scripts/check-composer-status.mjs', display: 'scripts/check-composer-status.mjs', added: 7, deleted: 1 },
    ],
    total: 2,
    added: 13,
    deleted: 1,
  }
  let calls = 0
  let answer = null
  globalThis.fetch = async (url) => {
    calls++
    const payload = answer
    if (payload === null) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => payload }
  }

  answer = GOOD
  const got = await api.loadChangesSummary('s1', 7)
  check('summary 正常响应解析出总增删（+13/-1）',
    got?.total === 2 && got?.added === 13 && got?.deleted === 1 && got?.files.length === 2)
  check('summary 请求打到宿主认证路由',
    readFileSync(join(root, 'client/src/panel/changes-api.ts'), 'utf8')
      .includes('/api/changes.summary?'))
  check('summary 成功结果复用（同一轮档案是既成事实，不重复请求）',
    await (async () => { const n = calls; await api.loadChangesSummary('s1', 7); return calls === n })())

  // 404 / 畸形 → null，且**不**缓存（下次还能试）
  answer = null
  check('summary 404 → null（会话被回收时不报错）', (await api.loadChangesSummary('s2', 9)) === null)
  answer = { turn: 0, files: [], total: 0, added: 0, deleted: 0 }
  check('summary turn<1 → null（不是有效轮次）', (await api.loadChangesSummary('s3', 9)) === null)
  answer = { turn: 1, files: [{ path: 'a', display: 'a', added: 'x', deleted: 0 }], total: 1, added: 1, deleted: 0 }
  check('summary 行数不是整数 → null（脏数据不显示成 +N/-M）',
    (await api.loadChangesSummary('s4', 9)) === null)
  answer = { turn: 1, files: 'oops', total: 1, added: 1, deleted: 0 }
  check('summary files 不是数组 → null', (await api.loadChangesSummary('s5', 9)) === null)
  // 失败后重试能成功（证明失败没被缓存）
  answer = GOOD
  check('summary 失败后重试可成功（失败不被缓存）',
    (await api.loadChangesSummary('s5', 9))?.total === 2)

  // —— 2. diff：文本 / 拒绝 / 缓存 ——
  const TEXT = {
    kind: 'text',
    path: 'a.ts',
    display: 'a.ts',
    before: true,
    after: true,
    coarse: false,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-old', '+new', '+more'] }],
  }
  answer = TEXT
  check('diff 正常响应解析出 hunks（预览要渲染的数据）',
    (await api.loadChangesDiff('s1', 7, 0))?.hunks.length === 1)
  check('diff 请求带 seq + index 坐标',
    readFileSync(join(root, 'client/src/panel/changes-api.ts'), 'utf8')
      .includes('/api/changes.diff?') && readFileSync(join(root, 'client/src/panel/changes-api.ts'), 'utf8')
      .includes('index: String(index)'))
  answer = { kind: 'binary', path: 'a.bin', display: 'a.bin' }
  check('diff 二进制文件保留 kind（预览给出「无法显示」而不是空框）',
    (await api.loadChangesDiff('s1', 7, 1))?.kind === 'binary')
  answer = { kind: 'oversized', path: 'big.log', display: 'big.log' }
  check('diff 超大文件保留 kind', (await api.loadChangesDiff('s1', 7, 2))?.kind === 'oversized')
  answer = { kind: 'weird', path: 'a', display: 'a' }
  check('diff 未知 kind → null（不猜）', (await api.loadChangesDiff('s1', 7, 3)) === null)
  answer = null
  check('diff 404 → null', (await api.loadChangesDiff('s9', 7, 0)) === null)

  // —— 3. 卡片渲染的硬事实（源码断言） ——
  const card = readFileSync(join(root, 'client/src/panel/changes-card.tsx'), 'utf8')
  check('折叠行数与原生一致（COLLAPSED_ROWS = 4）', card.includes('const COLLAPSED_ROWS = 4'))
  const consts = readFileSync(join(root, 'client/src/panel/changes-preview-const.ts'), 'utf8')
  check('悬浮预览延迟 500ms（与原生 HoverCard openDelayMs 同拍）',
    consts.includes('PREVIEW_OPEN_DELAY_MS = 500'))
  check('关闭有延迟（给指针跨过锚点与卡片之间的空隙，否则一碰就没）',
    consts.includes('PREVIEW_CLOSE_DELAY_MS'))
  check('预览卡 portal 到 body（否则祖先的 transform 会把 fixed 改写成相对祖先定位）',
    card.includes('createPortal') && card.includes('document.body'))
  check('单文件时只留 header（不渲染文件列表）',
    card.includes('rows &&') && card.includes('const single = '))
  check('文案对齐原生（已编辑 N 个文件 / +N / -N）',
    card.includes('已编辑 ${COUNT_FMT.format(count)} 个文件')
    && card.includes('+{COUNT_FMT.format(added)}')
    && card.includes('-{COUNT_FMT.format(deleted)}'))
  check('没有宿主档案时退回本地统计，且不假造行数',
    card.includes('fallbackFiles') && card.includes('按工具调用统计（宿主未提供行数）'))

  // —— 3b. 预览摆位：不许掉出视口（用户反馈的正是这两种掉出） ——
  const posOut = join(dir, 'pos.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/changes-preview-position.ts')],
    bundle: true, format: 'esm', outfile: posOut, platform: 'neutral', logLevel: 'silent',
  })
  const pos = await import(posOut)
  const VP = { width: 1280, height: 800 }
  // 锚点在视口底部附近：下方只剩很少空间 → 必须翻到上方，且完全在视口内
  const nearBottom = pos.placePreview({ left: 100, top: 740, width: 800, height: 24 }, VP)
  check('锚点在底部时翻到上方（不会掉出屏幕底部）',
    nearBottom.side === 'above' && nearBottom.top + nearBottom.maxHeight <= VP.height - 8)
  check('上方落位不越过视口顶',
    nearBottom.top >= 8)
  // 锚点在顶部附近：上方没空间 → 落在下方，且底边不越界
  const nearTop = pos.placePreview({ left: 100, top: 30, width: 800, height: 24 }, VP)
  check('锚点在顶部时落在下方且不出底边',
    nearTop.side === 'below' && nearTop.top + nearTop.maxHeight <= VP.height - 8)
  // 视口比理想高度还矮（面板被拖扁）：高度收成剩余空间，仍不出屏
  const tiny = pos.placePreview({ left: 100, top: 120, width: 400, height: 20 }, { width: 900, height: 300 })
  check('视口很矮时高度收成剩余空间（宁可内部滚动也不出屏）',
    tiny.maxHeight <= 300 && tiny.top + tiny.maxHeight <= 300 - 8 + 0.5)
  // 锚点极靠右：横向夹回视口内
  const right = pos.placePreview({ left: 1200, top: 200, width: 60, height: 24 }, VP)
  check('锚点靠右时横向夹回视口内',
    right.left + right.width <= VP.width - 8 + 0.5)
  // 窄屏（手机）：宽度跟着视口收
  const phone = pos.placePreview({ left: 10, top: 200, width: 300, height: 24 }, { width: 390, height: 844 })
  check('窄屏时宽度跟着视口收窄（不横向溢出）',
    phone.width <= 390 - 16 && phone.left + phone.width <= 390 - 8 + 0.5)
  // 锚点在正中、窗口矮到两侧都放不下：仍必须完全在视口内
  const middle = pos.placePreview({ left: 200, top: 150, width: 400, height: 24 }, { width: 800, height: 320 })
  check('两侧都放不下时选空间更大一侧且完全在视口内',
    middle.top >= 8 && middle.top + middle.maxHeight <= 320 - 8 + 0.5)

  // —— 4. 样式消费 ——
  const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
  check('卡片类名都有样式定义（否则渲染成裸 HTML）',
    ['.ts-changes-card', '.ts-cf-head', '.ts-cf-list', '.ts-cf-row', '.ts-cf-counts', '.ts-cf-toggle', '.ts-cf-hovercard', '.ts-cf-preview']
      .every((sel) => styles.includes(`${sel} `) || styles.includes(`${sel}{`) || styles.includes(`${sel},`)))
  check('悬浮预览用 fixed 定位（消息流是可滚容器，absolute 会被裁掉）',
    /\.ts-cf-hovercard \{[^}]*position:fixed/.test(styles))
  check('增删有颜色语义（+成功 / -错误）',
    styles.includes('.ts-cf-added') && styles.includes('.ts-cf-deleted'))
  // 层级：停靠输入条 fixed 在视口层（z-index 35，浮层里 42），预览必须压过它，
  // 否则会落在「聊天对话输入框」下层（用户反馈的第三个问题）。
  const cardZ = Number((styles.match(/\.ts-cf-hovercard \{[^}]*z-index:(\d+)/) || [])[1])
  check('预览卡 z-index 压过停靠输入条(35/42)与 dockview 浮层，但低于宿主弹窗(1000)',
    cardZ > 42 && cardZ < 1000, `z-index=${cardZ}`)
  check('样式不再写 max-width（否则与「按视口收窄」的行内宽度打架）',
    !/\.ts-cf-hovercard \{[^}]*max-width:/.test(styles))

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
