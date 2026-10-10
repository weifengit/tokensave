/**
 * 悬浮面板「保持」几何自检（纯函数，不需要浏览器）。
 *
 *   node scripts/check-hover-corridor.mjs
 *
 * 反馈原话：「鼠标还没移动到面板上就消失了」。
 * 根因是面板与触发器之间有一道缝（横 8 + 纵 6），指针在缝里时两边都不算「在里面」。
 * 这里用真实坐标复现那道缝，验证走廊确实把它盖住了。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-corridor-'))

try {
  const out = join(dir, 'c.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/hover-corridor.ts')],
    bundle: true, format: 'esm', outfile: out, platform: 'neutral', logLevel: 'silent',
  })
  const m = await import(out)

  let fail = 0
  const check = (label, ok, detail = '') => {
    if (!ok) fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  }
  const box = (left, top, right, bottom) => ({ left, top, right, bottom })

  // —— 复现真实几何 ——
  // 侧边栏收起态：入口按钮 36px 宽，触发簇贴其右侧。
  // 面板：left = 侧边栏右缘 + 8，top = 按钮底 + 6（正是那两道缝的来源）。
  const trigger = box(100, 500, 130, 516)   // 圆点/角标那一簇
  const panel = box(138, 522, 374, 780)     // left 差 8、top 差 6

  const corridor = m.hoverCorridor(trigger, panel)

  // 缝里的点：横向缝（trigger.right .. panel.left）与纵向缝（trigger.bottom .. panel.top）
  const inGapH = { x: 134, y: 508 }   // 在横缝中，纵向上与触发器同高
  const inGapV = { x: 150, y: 519 }   // 在纵缝中，横向上与面板对齐
  const corner = { x: 134, y: 519 }   // 缝的拐角（斜向移动必经）

  check('修复前的缝：横向缝里的点不在触发器也不在面板内',
    !m.corridorContains(trigger, inGapH.x, inGapH.y) && !m.corridorContains(panel, inGapH.x, inGapH.y))
  check('走廊盖住横向缝', m.corridorContains(corridor, inGapH.x, inGapH.y))
  check('走廊盖住纵向缝', m.corridorContains(corridor, inGapV.x, inGapV.y))
  check('走廊盖住缝的拐角（斜向移动）', m.corridorContains(corridor, corner.x, corner.y))

  // —— 从触发器到面板的整条直线都必须落在走廊里 ——
  const from = { x: 115, y: 508 }   // 触发器内部一个点
  const to = { x: 200, y: 560 }     // 面板内部一个点
  let allInside = true
  let firstOut = null
  for (let i = 0; i <= 100; i++) {
    const x = from.x + ((to.x - from.x) * i) / 100
    const y = from.y + ((to.y - from.y) * i) / 100
    // 面板/触发器本身也算「在里面」（mouseenter 管）
    const inside = m.corridorContains(corridor, x, y)
      || m.corridorContains(trigger, x, y)
      || m.corridorContains(panel, x, y)
    if (!inside) { allInside = false; firstOut = { x: Math.round(x), y: Math.round(y) }; break }
  }
  check('触发器→面板的直线全程不断（100 个采样点）', allInside,
    firstOut ? `首个漏点 (${firstOut.x},${firstOut.y})` : '')

  // —— 反向：走廊不能无限大，否则鼠标走了也不收 ——
  check('远离后不在走廊内（左上）', !m.corridorContains(corridor, 0, 0))
  check('远离后不在走廊内（右下）', !m.corridorContains(corridor, 1200, 1200))
  check('走廊外扩有限（不会吞掉整块侧边栏以外区域）',
    corridor.left >= trigger.left - m.CORRIDOR_PAD - 0.001
    && corridor.right <= panel.right + m.CORRIDOR_PAD + 0.001)
  check('外扩量与常量一致', Math.round(trigger.left - corridor.left) === m.CORRIDOR_PAD,
    `${Math.round(trigger.left - corridor.left)} vs ${m.CORRIDOR_PAD}`)

  // pad 到底买到了什么：并集的**包围盒**已经把两道缝盖住了（所以把 pad 改成 0
  // 也不会出现漏点）；pad 真正买到的是包围盒**外面**那圈余量 —— 手抖、斜向摆动。
  // 拓这一条，否则 PAD 这个常量等于没人验。
  const justOutside = { x: trigger.left - 2, y: trigger.bottom + 10 } // 包围盒左外 2px
  check('包围盒外一点：pad=0 时不算在里面（证明确实有漏）',
    !m.corridorContains(m.hoverCorridor(trigger, panel, 0), justOutside.x, justOutside.y))
  check('同一个点：默认 pad 下算在里面（手抖不会断）',
    m.corridorContains(corridor, justOutside.x, justOutside.y))
  check('超出 pad 就不算了（不会无限宽容）',
    !m.corridorContains(corridor, trigger.left - m.CORRIDOR_PAD - 5, justOutside.y))

  // —— 边界与健壮性 ——
  check('边界上的点算在里面（含等号）', m.corridorContains(box(0, 0, 10, 10), 0, 0)
    && m.corridorContains(box(0, 0, 10, 10), 10, 10))
  check('pad=0 时走廊就是并集', JSON.stringify(m.hoverCorridor(trigger, panel, 0))
    === JSON.stringify(box(100, 500, 374, 780)))
  check('面板在触发器上方时也成立（above 分支）',
    m.corridorContains(m.hoverCorridor(box(100, 500, 130, 516), box(138, 200, 374, 494)), 134, 497))
  check('关闭宽限时间足够挪过去（≥ 300ms）', m.HOVER_CLOSE_MS >= 300, `${m.HOVER_CLOSE_MS}ms`)
  check('boxOf 只取四个边', JSON.stringify(m.boxOf({ left: 1, top: 2, right: 3, bottom: 4, width: 2, height: 2, x: 1, y: 2 }))
    === JSON.stringify(box(1, 2, 3, 4)))

  // —— zoneOf：到点时靠它决定收不收 ——
  const z = (x, y) => m.zoneOf(trigger, panel, x, y)
  check('指针在面板上 → panel（绝不能收）', z(200, 560) === 'panel', z(200, 560))
  check('指针在触发器上 → trigger（不能收）', z(115, 508) === 'trigger', z(115, 508))
  check('指针在缝里 → corridor（续期）', z(134, 519) === 'corridor', z(134, 519))
  check('指针真的走远了 → out（收起）', z(600, 200) === 'out', z(600, 200))
  // 顺序：面板优先于走廊（否则“在面板上”会被当成“在缝里”，语义混濶）
  check('面板内部不会被归为 corridor', z(150, 530) === 'panel', z(150, 530))
  check('指针位置未知 → out（不赖着不走）', m.zoneOf(trigger, panel, null, null) === 'out')
  check('矩形未知 → out（面板还没渲染时）', m.zoneOf(null, null, 10, 10) === 'out')
  check('panel 优先于 trigger（重叠时算 panel）',
    m.zoneOf(box(0, 0, 100, 100), box(50, 50, 150, 150), 75, 75) === 'panel')

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
