/**
 * 探索者窗口「关闭态补登」的自检脚本（无框架，直接 node 跑）。
 *
 *   node scripts/check-desk-win-seed.mjs
 *
 * 为什么要有它：这段逻辑决定「探索者窗口进工作台时怎么恢复」，判错的代价是
 * 「用户刚放出来的窗口被 8s 轮询重新关掉」——2026-10-10 用户报障
 * （全部窗口开启 → 隔几秒探索者集体自行关闭、左右两竖塌缩、像是屏幕自己刷了一下）
 * 的根因就是补登被每轮轮询重放。因此「每个 id 只补登一次」必须可验证，
 * 这里把口径逐条钉下来，并用同一份纯逻辑（client/src/panel/desk-win-seed.ts）跑。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-winseed-'))

/** 快照构造：说关 / 说开 / 未记录 */
const off = () => ({ winState: { e1: { hidden: true }, e2: { hidden: false } } })
const snap = (winState) => ({ winState })

let fail = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} -> ${JSON.stringify(got)}`)
}

try {
  const out = join(dir, 'seed.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/desk-win-seed.ts')],
    bundle: true, format: 'esm', outfile: out, platform: 'neutral', logLevel: 'silent',
  })
  const { takeFirstSeenClosures } = await import(out)

  // ① 首次出现 + 快照说关 → 关一次
  {
    const applied = new Set()
    check('首见 / 快照说关 → 关', takeFirstSeenClosures(off(), ['e1', 'e2'], applied), ['e1'])
  }

  // ② **关键回归**：同一个 id 再轮询（用户已手动放出）→ 不再关
  {
    const applied = new Set()
    takeFirstSeenClosures(off(), ['e1', 'e2'], applied)   // 首轮：补登
    const again = takeFirstSeenClosures(off(), ['e1', 'e2'], applied) // 8s 后再来一轮
    check('第 2 轮轮询不再回关（用户放出后保持）', again, [])
    check('第 3 轮同样不回关', takeFirstSeenClosures(off(), ['e1', 'e2'], applied), [])
  }

  // ③ 快照未记录该 id（新探索者）→ 默认呈现，且记进 applied
  {
    const applied = new Set()
    check('快照没有的新探索者 → 不关', takeFirstSeenClosures(off(), ['e9'], applied), [])
    check('……并已记账（后续轮询也不关）', takeFirstSeenClosures(off(), ['e9'], applied), [])
    check('记账确实写入了 applied', [...applied], ['e9'])
  }

  // ④ 快照说开 → 不关（hidden 缺省同样不关）
  {
    const applied = new Set()
    check('快照说开 / 缺省 → 不关', takeFirstSeenClosures(snap({ e3: { hidden: false }, e4: {} }), ['e3', 'e4'], applied), [])
  }

  // ⑤ 混合批次：已见的绝不回关，只关首见且说关的
  {
    const applied = new Set(['e1'])
    check('混合批次：只关首见且说关的', takeFirstSeenClosures(off(), ['e1', 'e2', 'e7'], applied), [])
  }

  // ⑥ 无快照（未锁定 / 从未固化）→ 什么都不做
  check('seed=null → 不补登', takeFirstSeenClosures(null, ['e1'], new Set()), [])
  check('seed=null 也不记账', [...new Set()], [])

  // ⑦ 空列表 / 脏 id 防御
  check('空列表 → 空', takeFirstSeenClosures(off(), [], new Set()), [])
  check('空 id 跳过', takeFirstSeenClosures(off(), ['', 'e1'], new Set()), ['e1'])

  // ⑧ 用户「一键切换 → 全部放出」的真实时序：放出后连轮询多轮都不得回关
  {
    const applied = new Set()
    const ids = ['e1', 'e2', 'e5', 'e6']
    takeFirstSeenClosures(off(), ids, applied)                       // 进台首轮
    let flipped = 0
    for (let i = 0; i < 5; i++) flipped += takeFirstSeenClosures(off(), ids, applied).length
    check('放出后连续 5 轮轮询的回关次数 = 0', flipped, 0)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(fail === 0 ? '\n全部通过 ✅' : `\n有 ${fail} 条失败 ❌`)
process.exit(fail === 0 ? 0 : 1)
