/**
 * 工作台 UX 自检（纯静态断言，不需要浏览器）。
 *
 *   node scripts/check-desk-ux.mjs
 *
 * 覆盖本轮两条反馈：
 *   ②「已关闭：＋ 共享黑板 …」出现/消失时标题行高度不一致 → 页面上下跳
 *      根因：`.ts-bar` / `.ts-bar-tools` / `.ts-closed-bar` 都允许 wrap，
 *      chip 一多就折行，标题行从 40px 撑到 78px，下面的工作台整体位移。
 *      修法：整条标题行锁成单行（nowrap + 固定高度），chip 多了在条内横向滚动。
 *   ③ DSH 主对话最大化后，聊天输入框被卡片浮层（.ts-card-overlay, z 40）盖住
 *      根因：停靠的输入条固定 z-index 35 < 40。
 *      修法：停靠目标在浮层里时（chatMaximized）抬到 42；普通格子仍 35。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
const tsx = readFileSync(join(root, 'client/src/panel/HDesk.tsx'), 'utf8')

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}
const ruleOf = (sel) => {
  const i = css.indexOf(`\n${sel} {`)
  if (i < 0) return null
  return css.slice(i + 1, css.indexOf('}', i) + 1)
}

// —— 反馈 ②：标题行高度必须恒定 ——
const bar = ruleOf('.ts-bar') ?? ''
check('.ts-bar 锁单行（不再 wrap）', /flex-wrap:nowrap/.test(bar), bar.slice(0, 80))
check('.ts-bar 固定高度（出现/消失都不改高度）', /height:40px/.test(bar))
check('.ts-bar-tools 也锁单行（工具簇不折行）', /flex-wrap:nowrap/.test(ruleOf('.ts-bar-tools') ?? ''))
const closed = ruleOf('.ts-closed-bar') ?? ''
check('.ts-closed-bar 锁单行 + 条内横向滚动（chip 多了不撑高）',
  /flex-wrap:nowrap/.test(closed) && /overflow-x:auto/.test(closed))
check('滚动条隐藏（视觉上仍是干净的一条）',
  !!ruleOf('.ts-closed-bar::-webkit-scrollbar') && /display:none/.test(ruleOf('.ts-closed-bar::-webkit-scrollbar') ?? ''))
check('.ts-chip 不收缩（文字不被压扁）',
  /flex:none/.test(ruleOf('.ts-chip') ?? '') && /white-space:nowrap/.test(ruleOf('.ts-chip') ?? ''))

// —— 反馈 ③：最大化后输入条要压过卡片浮层 ——
check('停靠钩子新增 aboveOverlay 参数（区分浮层里/格子里）',
  /aboveOverlay: boolean/.test(tsx))
check('浮层里 z 抬到 42（> .ts-card-overlay 的 40）',
  /aboveOverlay \? '42' : '35'/.test(tsx))
check('普通格子仍是 35（不会盖住其它卡片的浮层/下拉）',
  /'42' : '35'/.test(tsx))
check('调用点把 chatMaximized 传了进去',
  /useDockNativeComposer\([\s\S]{0,200}?chatMaximized,/.test(tsx))
check('.ts-card-overlay 确实是 40（前提没变，否则上面的 42 是白抬）',
  /\.ts-card-overlay \{[^}]*z-index:40/.test(css))

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exitCode = fail === 0 ? 0 : 1
