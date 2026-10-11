/**
 * 告警音「起音时机」自检（纯函数，不需要浏览器）。
 *
 *   node scripts/check-alert-kick.mjs
 *
 * 反馈原话：「不在 dsh 的这个浏览器 tab 页，或者浏览器最小化，好像不能收到提示音」。
 * 根因：起音挂在**两帧 rAF** 之后，而 rAF 只在页面可见时才跑 —— 隐藏标签页 /
 * 最小化浏览器里，挂上去的回调一次都不会执行（实测：隐藏页里挂的 rAF 5s 内没跑），
 * 于是提示音被整个吞掉，直到用户切回那个标签页才响。
 *
 * 这里用一个「永不回调的 rAF」（=隐藏标签页）复现，断言兜底定时器仍会把声音补上，
 * 并且 rAF 与兜底**不会重复起音**。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-kick-'))

try {
  const out = join(dir, 'k.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/alert-kick.ts')],
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

  /** 假的「事件循环」：把 rAF / setTimeout 的回调收进队列，按需手动 flush */
  const makeEnv = ({ rafWorks = true } = {}) => {
    const rafCbs = []
    const timers = []
    return {
      env: {
        requestAnimationFrame: (cb) => {
          if (rafWorks) rafCbs.push(cb)
          return rafCbs.length
        },
        setTimeout: (cb, ms) => {
          timers.push({ cb, ms })
          return timers.length
        },
      },
      /** 跑一帧（只跑当前已排的回调，新排的留到下一帧——与真实 rAF 一致） */
      frame: () => {
        const batch = rafCbs.splice(0, rafCbs.length)
        for (const cb of batch) cb()
      },
      /** 推进定时器到 ms 时刻 */
      advance: (ms) => {
        for (const t of timers.splice(0, timers.length)) if (t.ms <= ms) t.cb()
      },
      timers,
      rafCbs,
    }
  }

  // —— 1. 可见页面：两帧后起音，兜底不重复 ——
  {
    const h = makeEnv()
    let calls = 0
    m.scheduleAlertKick(() => calls++, h.env)
    check('可见页面：起音不是同步的（要等两帧）', calls === 0, `calls=${calls}`)
    h.frame()
    check('可见页面：一帧后还没响', calls === 0, `calls=${calls}`)
    h.frame()
    check('可见页面：两帧后响起（视觉同步不变）', calls === 1, `calls=${calls}`)
    h.advance(m.KICK_FALLBACK_MS + 10)
    check('可见页面：兜底到点不重复起音', calls === 1, `calls=${calls}`)
  }

  // —— 2. 隐藏标签页（rAF 被冻结）：兜底必须把声音补上 ——
  {
    const h = makeEnv({ rafWorks: false })
    let calls = 0
    m.scheduleAlertKick(() => calls++, h.env)
    h.frame()
    h.frame()
    check('隐藏页面：两帧通道不工作（复现 rAF 冻结）', calls === 0, `calls=${calls}`)
    h.advance(m.KICK_FALLBACK_MS + 10)
    check('隐藏页面：兜底定时器把提示音补上（这是本次修复的关键）', calls === 1, `calls=${calls}`)
    h.advance(5000)
    check('隐藏页面：长时间后仍然只响一次', calls === 1, `calls=${calls}`)
  }

  // —— 3. 隐藏 + 兜底与 rAF 都到点：只有一次 ——
  {
    const h = makeEnv()
    let calls = 0
    m.scheduleAlertKick(() => calls++, h.env)
    h.frame()
    h.frame()
    h.advance(m.KICK_FALLBACK_MS + 10)
    check('rAF 与兜底都到点也只响一次', calls === 1, `calls=${calls}`)
  }

  // —— 4. 环境没有 rAF：退化为定时器 ——
  {
    const timers = []
    let calls = 0
    m.scheduleAlertKick(() => calls++, {
      setTimeout: (cb, ms) => {
        timers.push({ cb, ms })
        return 1
      },
    })
    check('没有 rAF 时不同步起音', calls === 0, `calls=${calls}`)
    for (const t of timers) if (t.ms <= m.KICK_NO_RAF_MS) t.cb()
    check('没有 rAF 时用定时器起音', calls === 1, `calls=${calls}`)
  }

  // —— 5. 兜底必须发生在「两帧」之后（否则会抢跑，破掉角标先上屏） ——
  check('兜底延时不小于两帧（≈33ms）', m.KICK_FALLBACK_MS >= 33, `${m.KICK_FALLBACK_MS}ms`)

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
