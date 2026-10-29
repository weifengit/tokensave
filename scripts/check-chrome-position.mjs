/**
 * 标题栏位置（顶部 / 左侧 / 右侧）自检：纯函数 + 静态约束，不需要浏览器。
 *
 *   node scripts/check-chrome-position.mjs
 *
 * 这次需求是「参考 info_report 把标题行做成可放顶部 / 左侧 / 右侧」。参考实现里踩过的
 * 两个坑必须在断言里钉住，否则下次改动很容易退回去：
 *   1. **浮层落点**：齿轮在竖轨最底部，沿用「按钮底 + 6」会把整块设置面板甩到屏幕外；
 *   2. **轨宽只有一处真值**：CSS 的 --ts-rail-w 与 JS 的浮层定位读同一个常量，
 *      写死两份迟早对不上（差 1px 就会让面板压住/悬空于轨边）。
 * 另外钉住：偏好读写的退化路径（隐私模式/无 DOM 不抛）、窄屏一律按顶部渲染、
 * 以及网格与竖排样式确实落在 .ts-dock[data-chrome] 上。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-chrome-'))

try {
  const out = join(dir, 'c.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/chrome-position.ts')],
    bundle: true,
    format: 'esm',
    outfile: out,
    platform: 'neutral',
    logLevel: 'silent',
  })
  const m = await import(out)

  let fail = 0
  const check = (label, ok, detail = '') => {
    if (!ok) fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  }

  /** 极简假存储：与 localStorage 同形，可选抛错（隐私模式）。 */
  const fakeStorage = (seed = {}, throwOn = '') => {
    const data = { ...seed }
    const guard = (op) => {
      if (throwOn === op) throw new Error('denied')
    }
    return {
      data,
      getItem: (k) => {
        guard('getItem')
        return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null
      },
      setItem: (k, v) => {
        guard('setItem')
        data[k] = String(v)
      },
    }
  }

  // —— 1. 位置值归一 ——
  check('normalize：三个合法值原样返回',
    m.normalizeChrome('top') === 'top' &&
    m.normalizeChrome('left') === 'left' &&
    m.normalizeChrome('right') === 'right')
  check('normalize：未知值 / 空值一律回顶部（旧版本与手改存储不能把界面搞坏）',
    m.normalizeChrome('bottom') === 'top' &&
    m.normalizeChrome('') === 'top' &&
    m.normalizeChrome(null) === 'top' &&
    m.normalizeChrome(undefined) === 'top')

  // —— 2. 偏好读写（含退化路径）——
  const s1 = fakeStorage({ [m.CHROME_KEY]: 'right' })
  check('read：读到自己存的值', m.readChromePosition(s1) === 'right')
  check('read：存了脏值 → 顶部', m.readChromePosition(fakeStorage({ [m.CHROME_KEY]: 'side' })) === 'top')
  check('read：存储抛错 → 顶部（不把工作台带崩）', m.readChromePosition(fakeStorage({}, 'getItem')) === 'top')
  check('read：没有 window / 没有存储 → 顶部', m.readChromePosition(null) === 'top')

  const s2 = fakeStorage()
  const written = m.writeChromePosition('left', s2)
  check('write：写进偏好键且回写归一值',
    written === 'left' && s2.data[m.CHROME_KEY] === 'left')
  m.writeChromePosition('nope', s2)
  check('write：脏值写成顶部（读回来永远合法）', s2.data[m.CHROME_KEY] === 'top')
  let threw = false
  try {
    m.writeChromePosition('left', fakeStorage({}, 'setItem'))
  } catch {
    threw = true
  }
  check('write：存储抛错不外溢（隐私模式只当本次会话生效）', !threw)

  // —— 3. 窄屏让位 ——
  check('effectiveChrome：窄屏一律顶部（竖轨在抽屉布局里放不下）',
    m.effectiveChrome('left', true) === 'top' && m.effectiveChrome('right', true) === 'top')
  check('effectiveChrome：宽屏尊重偏好',
    m.effectiveChrome('left', false) === 'left' && m.effectiveChrome('right', false) === 'right')

  // —— 4. 顶置落点（旧行为不能变）——
  const viewport = { width: 1440, height: 900 }
  const dock = { left: 100, right: 1340, top: 40, bottom: 880 }
  const W = 238
  const topMode = m.popPlacement({
    chrome: 'top',
    anchor: { left: 1200, right: 1320, top: 8, bottom: 32 },
    dock,
    viewport,
    width: W,
  })
  check('顶置：挂在按钮下方 6px',
    topMode.top === 38 && topMode.bottom === undefined, `top=${topMode.top}`)
  check('顶置：右对齐按钮',
    topMode.left === 1320 - W, `left=${topMode.left}`)
  const clampRight = m.popPlacement({
    chrome: 'top',
    anchor: { left: 1320, right: 1338, top: 8, bottom: 32 },
    dock, viewport, width: W,
  })
  check('顶置：不许越出工作台右边缘', clampRight.left === dock.right - W - m.POP_GAP, `left=${clampRight.left}`)
  const clampLeft = m.popPlacement({
    chrome: 'top',
    anchor: { left: 104, right: 140, top: 8, bottom: 32 },
    dock, viewport, width: W,
  })
  check('顶置：不许越出工作台左边缘（左侧按钮不再弹到宿主侧栏上）',
    clampLeft.left === dock.left + m.POP_GAP, `left=${clampLeft.left}`)

  // —— 5. 侧置落点：轨内侧 + 靠下的按钮向上长 ——
  const railGap = m.RAIL_W + m.POP_GAP
  const gearLow = { left: 104, right: 140, top: 820, bottom: 852 }
  const leftRail = m.popPlacement({ chrome: 'left', anchor: gearLow, dock, viewport, width: W })
  check('左轨：面板从轨内侧漂出（轨宽 + 留白）', leftRail.left === dock.left + railGap, `left=${leftRail.left}`)
  check('左轨：齿轮在底部 → 向上长（给 bottom，不给 top）',
    leftRail.bottom === viewport.height - gearLow.bottom && leftRail.top === undefined,
    `bottom=${leftRail.bottom}`)
  const rightRail = m.popPlacement({ chrome: 'right', anchor: gearLow, dock, viewport, width: W })
  check('右轨：面板右边缘收在轨左侧（不压住竖轨）',
    rightRail.left + W === dock.right - railGap, `left=${rightRail.left}`)
  const projTop = { left: 104, right: 140, top: 60, bottom: 92 }
  const upper = m.popPlacement({ chrome: 'left', anchor: projTop, dock, viewport, width: 272 })
  check('左轨：靠上的按钮（项目切换）向下长', upper.top === projTop.top && upper.bottom === undefined)
  check('左轨：两种方向都不出屏', m.popPlacement({ chrome: 'left', anchor: gearLow, dock, viewport, width: W }).bottom >= m.POP_GAP)

  // —— 6. 静态约束（源码里钉住实现口径）——
  const dockSrc = readFileSync(join(root, 'client/src/panel/DeskDock.tsx'), 'utf8')
  const modSrc = readFileSync(join(root, 'client/src/panel/chrome-position.ts'), 'utf8')
  check('CSS 轨宽用常量插值（只有一处真值）',
    dockSrc.includes('--ts-rail-w: ${RAIL_W}px') && /export const RAIL_W = 44/.test(modSrc))
  check('侧置时网格回到两行（顶部那一整行让给内容）',
    /\.ts-dock\[data-chrome="left"\],[\s\S]{0,80}\.ts-dock\[data-chrome="right"\] \{ grid-template-rows: minmax\(0,1fr\) auto; \}/.test(dockSrc))
  check('左/右轨各多一列、title 区域贴对应边',
    /data-chrome="left"\] \{ grid-template-columns: var\(--ts-rail-w\)[\s\S]{0,220}grid-template-areas: "title left center right"/.test(dockSrc) &&
    /data-chrome="right"\] \{ grid-template-columns: [\s\S]{0,220}var\(--ts-rail-w\); grid-template-areas: "left center right title"/.test(dockSrc))
  check('中区收起时列定义跟着变（两种侧置各一条）',
    /\.ts-dock\[data-chrome="left"\]\[data-hide-center\] \{ grid-template-columns: var\(--ts-rail-w\)/.test(dockSrc) &&
    /\.ts-dock\[data-chrome="right"\]\[data-hide-center\] \{ grid-template-columns: [^}]*var\(--ts-rail-w\); \}/.test(dockSrc))
  check('竖轨里的标题行回到正常流（复位绝对定位）',
    /\.ts-dock\[data-chrome="left"\] \.ts-titlebar,[\s\S]{0,140}position: relative; left: auto; right: auto; top: auto; width: auto; height: auto;/.test(dockSrc))
  check('竖轨里项目名竖排（44px 轨里横排必被截断）',
    /\.ts-dock\[data-chrome="left"\] \.ts-title-proj,[\s\S]{0,200}writing-mode: vertical-rl;/.test(dockSrc))
  check('竖轨里「已关闭」chips 收起（放不下，且可用设置面板全部打开找回来）',
    /\.ts-dock\[data-chrome="left"\] \.ts-closed-chip,[\s\S]{0,220}display: none; \}/.test(dockSrc))
  check('根元素按位置写 data-chrome', /data-chrome=\{chromePos\}/.test(dockSrc))
  check('设置面板里有三枚位置按钮（数据来自 CHROME_POSITIONS）',
    /data-desk-set-block="chrome"/.test(dockSrc) &&
    /CHROME_POSITIONS\.map\(\(p\) => \(/.test(dockSrc) &&
    /data-desk-chrome=\{p\}/.test(dockSrc))
  check('切换位置会重排开着的浮层（齿轮在轨底部，旧坐标会飞）',
    /const switchChrome = \(next: ChromePosition\) => \{[\s\S]{0,600}requestAnimationFrame[\s\S]{0,300}placePop\(settingsBtnRef\.current/.test(dockSrc))
  check('浮层落点统一走纯函数（两处浮层共用一套口径）',
    /popPlacement\(\{/.test(dockSrc) && /anchor: anchor\?\.getBoundingClientRect\(\) \?\? null/.test(dockSrc))
  check('窄屏按顶部渲染（抽屉布局）', /const chromePos = effectiveChrome\(chrome, narrow\)/.test(dockSrc))
  check('设置面板的窗口/皮肤/字体之外多出「标题栏」一块',
    /data-desk-set-block="chrome"/.test(dockSrc) &&
    /data-desk-set-block="skin"/.test(dockSrc) &&
    /data-desk-set-block="font"/.test(dockSrc))

  if (fail) {
    console.log(`\n${fail} 项未通过`)
    process.exitCode = 1
  } else {
    console.log('\n全部通过')
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
