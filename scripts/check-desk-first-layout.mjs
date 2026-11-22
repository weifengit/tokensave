/**
 * 首次进入布局的**纯函数**单测（client/src/panel/desk-first-layout.ts）。
 *
 *   node scripts/check-desk-layout.mjs
 *
 * 为什么单独一份：布局是**用户可见的契约**，而它以前散在 DeskDock 的
 * buildDefault / reconcile / ensureById 三处各算一遍（改一处漏两处的历史事故
 * 已经发生过）。现在唯一权威源是 desk-layout.ts，这里直接对着它断言，
 * 不用去正则匹配 TSX。
 *
 * 用户给的两张截图 = 两种布局：
 *   ① 有项目预览：面板区放预览；主对话 + 黑板 + 协作对话 + 收益 全在辅助侧栏
 *   ② 无项目预览：主对话放面板区；黑板 + 协作对话 + 收益 在辅助侧栏
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-layout-'))

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

try {
  const out = join(dir, 'layout.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/desk-first-layout.ts')],
    bundle: true,
    format: 'esm',
    outfile: out,
    platform: 'neutral',
    logLevel: 'silent',
  })
  const m = await import(out)

  // —— ① 有项目预览 ——
  const withP = m.layoutFor(true)
  check('有预览：项目预览落在面板区', withP.region.preview === 'center')
  check('有预览：其余 4 个窗口全在辅助侧栏',
    ['chat', 'board', 'talk', 'save'].every((k) => withP.region[k] === 'right'),
    JSON.stringify(withP.region))
  check('有预览：面板区**只有**预览（主对话不在面板区）',
    Object.keys(withP.region).filter((k) => withP.region[k] === 'center').length === 1 &&
    withP.region.chat !== 'center')
  check('有预览：辅助侧栏次序 chat → board → talk → save',
    withP.stack.chat === undefined && withP.stack.board === 'chat' &&
    withP.stack.talk === 'board' && withP.stack.save === 'talk')

  // —— ② 无项目预览 ——
  const noP = m.layoutFor(false)
  check('无预览：DSH 主对话落在面板区', noP.region.chat === 'center')
  check('无预览：三个面板在辅助侧栏',
    ['board', 'talk', 'save'].every((k) => noP.region[k] === 'right'),
    JSON.stringify(noP.region))
  check('无预览：辅助侧栏次序 board → talk → save',
    noP.stack.board === undefined && noP.stack.talk === 'board' && noP.stack.save === 'talk')

  // —— 工具函数口径 ——
  check('regionOfKind 有预览/无预览分别取对',
    m.regionOfKind('chat', true) === 'right' && m.regionOfKind('chat', false) === 'center' &&
    m.regionOfKind('preview', true) === 'center' && m.regionOfKind('preview', false) === 'center')
  check('stackAnchorOf 有预览时 chat 排第一（undefined）',
    m.stackAnchorOf('chat', true) === undefined && m.stackAnchorOf('board', true) === 'chat')
  check('stackAnchorOf 无预览时 board 排第一（undefined）',
    m.stackAnchorOf('board', false) === undefined && m.stackAnchorOf('talk', false) === 'board')
  check('未知 kind → 退到面板区（不抛错）',
    m.regionOfKind('nope', true) === 'center' && m.stackAnchorOf('nope', false) === undefined)

  // —— 两种布局的「面板总数」口径 ——
  check('有预览：面板区 1 个 + 辅助侧栏 4 个',
    Object.values(withP.region).filter((r) => r === 'center').length === 1 &&
    Object.values(withP.region).filter((r) => r === 'right').length === 4)
  // 注意：无预览表里 preview 仍写着 center —— 那是「预览一旦出现就进面板区」的声明；
  // 没有 devUrl 时 DeskDock 压根不建预览面板，所以面板区实际只有主对话。
  check('无预览：辅助侧栏 3 个（黑板/协作对话/收益）',
    Object.values(noP.region).filter((r) => r === 'right').length === 3 &&
    ['board', 'talk', 'save'].every((k) => noP.region[k] === 'right'))

  // —— 插入顺序模拟：复现 v0.9.0 的白屏事故 ——
  // buildDefault 是「前一块当后一块的 position.referencePanel」，参照面一旦还没建就
  // 被引用，dockview 直接抛 `referencePanel '…' does not exist`，整个工作台 tab 白屏
  // （实测：无预览时面板区推成 preview、chat 未建却被当参照）。
  // 这里按 DeskDock 的同一顺序重放一遍，任何悬空参照都会当场报错。
  const simulateBuild = (layout) => {
    const built = new Set()
    const order = []
    const addPanel = (kind) => {
      const anchorKind = layout.region[kind] === 'right' ? layout.stack[kind] : undefined
      if (anchorKind && !built.has(anchorKind)) {
        throw new Error(`referencePanel 悬空：${anchorKind}（加 ${kind} 时尚未创建）`)
      }
      built.add(kind)
      order.push(kind)
    }
    addPanel(layout.primary)
    const rightKinds = ['chat', 'board', 'talk', 'save'].filter((k) => layout.region[k] === 'right')
    rightKinds.filter((k) => layout.stack[k] === undefined).forEach(addPanel)
    rightKinds.filter((k) => layout.stack[k] !== undefined).forEach(addPanel)
    return order
  }
  for (const [label, layout] of [['有预览', withP], ['无预览', noP]]) {
    let order = null
    let err = ''
    try {
      order = simulateBuild(layout)
    } catch (e) {
      err = e.message
    }
    check(`${label}：按默认顺序建面板不会引用未创建的参照`, !err, err)
    if (order) check(`${label}：面板区那块最先建（primary）`, order[0] === layout.primary, order.join('→'))
  }
  check('有预览：primary 是 preview（主对话在侧栏）', withP.primary === 'preview')
  check('无预览：primary 是 chat（不先建预览）',
    noP.primary === 'chat' && simulateBuild(noP).includes('preview') === false)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exitCode = fail === 0 ? 0 : 1
