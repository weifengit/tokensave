/**
 * 输入框高度抓手误触防护自检（纯函数 + 假环境，不需要浏览器）。
 *
 *   node scripts/check-composer-resize.mjs
 *
 * 需求原话：「会话输入框的高度不会随着输入内容而自动变高，请修复。」
 *
 * 根因：抓手是横在输入框上沿的**隐形命中区**（视觉横线已删），旧实现在
 * pointerdown 当场把高度固定并持久化 —— 一次无意的点击/拖选路过就把输入框
 * 钉死在当时的行高，且抓手看不见、重置按钮要悬停才出现，用户只看到
 * 「输入框再也不随内容变高」。自动加高本身（--dsh-composer-text-max-height
 * 行内覆盖）经宿主源码核对有效。
 *
 * 这里钉四件事：
 *   1. 纯函数 —— 位移 ≥ DRAG_START_PX(3) 才升级为拖动；未升级不改变任何高度；
 *   2. 时机 —— pointerdown 不再写 manualCap（按下即固定的旧写法必须消失）；
 *      只有拖动后的 pointerup 才落盘；
 *   3. 可见性 —— 固定态（data-ts-manual=1 且非拖动）数字胶囊淡显、「重置」常显，
 *      固定随时可发现、可撤销；
 *   4. 口径 —— 自动模式上限仍是 --dsh-composer-text-max-height（宿主规则为
 *      var() 引用，行内覆盖有效）。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-cresize-'))

try {
  const out = join(dir, 't.mjs')
  await build({
    entryPoints: [join(root, 'client/src/composer-resize.ts')],
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

  // —— 1. 纯函数：拖动升级阈值 ——
  const d = { originY: 100, moved: false }
  check('阈值常量为 3px（手感无死区）', m.DRAG_START_PX === 3)
  check('位移 < 3px 不算拖动', m.shouldBeginDrag(d, 102) === false)
  check('位移 ≥ 3px 升级为拖动', m.shouldBeginDrag(d, 104) === true)
  check('已升级后不再重复判定', m.shouldBeginDrag({ originY: 100, moved: true }, 90) === false)
  check('dragOffsetPx 取绝对值（上下拖都算位移）',
    m.dragOffsetPx({ originY: 100 }, 97) === 3 && m.dragOffsetPx({ originY: 100 }, 103) === 3)

  // —— 2. 时机：按下不固定 ——
  const src = readFileSync(join(root, 'client/src/composer-resize.ts'), 'utf8')
  {
    // onPointerDown 函数体（从签名到下一个顶层函数之间）
    const body = src.slice(src.indexOf('function onPointerDown'), src.indexOf('function onPointerMove'))
    check('pointerdown 不再写 manualCap（「按下即固定」的误触根源已拔除）',
      !body.includes('writeManualCap'))
    check('pointerdown 记录 moved=false（等待位移判定）', body.includes('moved: false'))
  }
  {
    const body = src.slice(src.indexOf('function onPointerMove'), src.indexOf('function applyDrag'))
    check('pointermove 升级当下先写基准高度（第一下不跳变）',
      body.includes('shouldBeginDrag(drag, e.clientY)') && body.includes('writeManualCap(drag.originH, false)'))
    check('未升级的移动直接返回（不改变任何高度）', body.includes('if (!drag.moved) return'))
  }
  {
    const body = src.slice(src.indexOf('function onPointerUp'), src.indexOf('/** 重置'))
    check('只有真的拖过才落盘固定（误触不落盘）',
      body.includes('const dragged = drag.moved') && /if \(dragged && manualCap !== null\) writeManualCap\(manualCap\)/.test(body))
  }

  // —— 3. 固定态可见 ——
  check('固定态数字胶囊淡显（随时可见）',
    src.includes('[data-ts-manual="1"]:not([data-ts-dragging="1"]) .ts-composer-size{opacity:.8}'))
  check('固定态「重置」常显（随时可撤销）',
    src.includes('[data-ts-manual="1"]:not([data-ts-dragging="1"]) .ts-composer-reset{opacity:1}'))

  // —— 4. 口径：自动上限仍是宿主变量 ——
  check('上限仍写宿主的 --dsh-composer-text-max-height（行内覆盖 var() 规则）',
    src.includes("'--dsh-composer-text-max-height'"))
  check('自动模式 cap 来自视口（manualCap ?? autoCap）', /manualCap \?\? autoCap\(\)/.test(src))

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
