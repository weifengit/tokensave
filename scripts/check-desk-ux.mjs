/**
 * 工作台 UX / 面板逻辑自检（Step 13 · Step D 重写）。
 *
 *   node scripts/check-desk-ux.mjs
 *
 * 旧版测的是自研 H 型网格（三列轨道 / 卡片三键 / 分隔条 / 停靠 z-index），
 * 那些断言随 Step B/C 的 dockview 接管**已作废**，本文件改为两段：
 *   一、**纯函数单测**（bundled：client/src/panel/desk-panes.ts）——
 *       面板 id 命名/解析、标题/图标映射、「应当存在哪些面板」的推导；
 *   二、**桌面外壳断言**（DeskDock 的 CSS/主题）——单行工具条、透明主题、
 *       每项目自带输入框；并钉住「旧网格已不存在」。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-deskux-'))

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

try {
  // —— 一、面板纯逻辑单测 ——
  const out = join(dir, 'panes.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/desk-panes.ts')],
    bundle: true,
    format: 'esm',
    outfile: out,
    platform: 'neutral',
    logLevel: 'silent',
  })
  const m = await import(out)

  check('paneId / parsePaneId 往返一致', (() => {
    const id = m.paneId('prj-A', 'chat')
    const back = m.parsePaneId(id)
    return id === 'prj-A:chat' && back && back.projectId === 'prj-A' && back.kind === 'chat'
  })())
  check('parsePaneId 对非项目面板返回 null（center）', m.parsePaneId('center') === null)
  check('paneTitle：固定 kind / 探索者 / 项目中心',
    m.paneTitle('prj-A:chat', 'A项目') === 'A项目 · DSH 主对话' &&
    m.paneTitle('prj-A:exp:s1', 'A项目') === 'A项目 · 探索者' &&
    m.paneTitle('center') === '项目中心')
  // 探索者图标必须与主对话（chat）**不同**：用户反馈两者一模一样，认不出谁是谁
  check('paneIcon：center=list / save=database / 探索者=explorers（≠chat）',
    m.paneIcon('center') === 'list' && m.paneIcon('prj-A:save') === 'database' &&
    m.paneIcon('prj-A:exp:s1') === 'explorers' && m.paneIcon('prj-A:chat') === 'chat')

  // desiredPaneIds：多项目并存的核心推导
  const A = { id: 'A' }
  const B = { id: 'B' }
  {
    const d = m.desiredPaneIds([A, B], { A: { explorers: [] }, B: { explorers: [] } })
    check('无 devUrl → 不建预览面板（其余 4 个 + 项目中心）',
      !d.has('A:preview') && !d.has('B:preview') &&
      ['A:board', 'A:chat', 'A:talk', 'A:save', 'B:board', 'B:chat', 'B:talk', 'B:save'].every((x) => d.has(x)) &&
      d.has('center'))
    check('A/B 面板 id 不撞名（各 4 个专属面板）',
      [...d].filter((x) => x.startsWith('A:')).length === 4 &&
      [...d].filter((x) => x.startsWith('B:')).length === 4)
  }
  {
    const d = m.desiredPaneIds([A], { A: { devUrl: 'http://x', explorers: [{ id: 's1' }, { id: 's2' }] } })
    check('有 devUrl → 建预览面板；每个探索者一个面板',
      d.has('A:preview') && d.has('A:exp:s1') && d.has('A:exp:s2'))
  }
  check('没打开项目时只剩项目中心', (() => {
    const d = m.desiredPaneIds([], { A: { explorers: [] } })
    return d.size === 1 && d.has('center')
  })())

  // —— 二、桌面外壳断言 ——
  const dockSrc = readFileSync(join(root, 'client/src/panel/DeskDock.tsx'), 'utf8')
  const stylesSrc = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
  check('标题行单行不换行（chips 多了不撑高，横向内容裁而不折）',
    /\.ts-titlebar \{[^}]*overflow:\s*hidden/.test(dockSrc) &&
    /\.ts-title-left \{[^}]*min-width:\s*0/.test(dockSrc))
  check('chips 不收缩（文字不被压扁）', /\.ts-closed-chip \{[^}]*flex:\s*none/.test(dockSrc))
  check('聊天格存在（停靠的原生输入条落在它里面）+ 自建输入框样式已删',
    /\.ts-dock-chatcell \{/.test(dockSrc) &&
    /useDockNativeComposer/.test(dockSrc) && !/\.ts-pc-input \{/.test(dockSrc))
  check('dockview 主题透明（视觉对齐 info_report）',
    /\.dv-intel \.dv-dockview, \.dv-intel \.dv-groupview \{ background: transparent/.test(dockSrc))
  check('面板 id 命名空间由纯模块统一提供（DeskDock 不再各写一份）',
    /from '\.\/desk-panes'/.test(dockSrc) && /paneId\(project\.id/.test(dockSrc) &&
    /paneOptsRef\.current\(paneId\(project\.id/.test(dockSrc))
  check('旧 H 型网格已删除（文件不在 + CSS 不再有 .ts-desk 网格规则）',
    !existsSync(join(root, 'client/src/panel/HDesk.tsx')) &&
    !existsSync(join(root, 'client/src/panel/desk-layout.ts')) &&
    !/\.ts-desk \{/.test(stylesSrc) && !/ts-hsplit/.test(stylesSrc))
  check('主对话消息宽度跟**面板**自适应（border-box，不吃宿主全局宽度）',
    /\.ts-mainchat \.ts-chat-msgs \{[^}]*box-sizing:border-box/.test(stylesSrc) &&
    /\.ts-mainchat \.ts-chat-msgs \{[^}]*max-width:100%/.test(stylesSrc) &&
    !/max-width:var\(--ts-chat-content-w/.test(stylesSrc))
  check('输入条停靠宽度只受面板约束（不取带 680px 下限的宿主宽度）',
    !/hostContentWidthPx/.test(readFileSync(join(root, 'client/src/panel/composer-dock.ts'), 'utf8')))
  check('CSS 大括号平衡', (() => {
    let d = 0
    for (const c of stylesSrc) {
      if (c === '{') d++
      else if (c === '}') d--
      if (d < 0) return false
    }
    return d === 0
  })())

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
