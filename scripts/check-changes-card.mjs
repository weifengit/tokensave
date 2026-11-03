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
  check('悬浮预览延迟 500ms（与原生 HoverCard openDelayMs 同拍）',
    card.includes('const PREVIEW_OPEN_DELAY_MS = 500'))
  check('单文件时只留 header（不渲染文件列表）',
    card.includes('rows &&') && card.includes('const single = '))
  check('文案对齐原生（已编辑 N 个文件 / +N / -N）',
    card.includes('已编辑 ${COUNT_FMT.format(count)} 个文件')
    && card.includes('+{COUNT_FMT.format(added)}')
    && card.includes('-{COUNT_FMT.format(deleted)}'))
  check('没有宿主档案时退回本地统计，且不假造行数',
    card.includes('fallbackFiles') && card.includes('按工具调用统计（宿主未提供行数）'))

  // —— 4. 样式消费 ——
  const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
  check('卡片类名都有样式定义（否则渲染成裸 HTML）',
    ['.ts-changes-card', '.ts-cf-head', '.ts-cf-list', '.ts-cf-row', '.ts-cf-counts', '.ts-cf-toggle', '.ts-cf-hovercard', '.ts-cf-preview']
      .every((sel) => styles.includes(`${sel} `) || styles.includes(`${sel}{`) || styles.includes(`${sel},`)))
  check('悬浮预览用 fixed 定位（消息流是可滚容器，absolute 会被裁掉）',
    /\.ts-cf-hovercard \{[^}]*position:fixed/.test(styles))
  check('增删有颜色语义（+成功 / -错误）',
    styles.includes('.ts-cf-added') && styles.includes('.ts-cf-deleted'))

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
