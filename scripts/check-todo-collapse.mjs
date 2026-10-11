/**
 * 任务规划清单「跑完自动收起」自检（纯函数，不需要浏览器）。
 *
 *   node scripts/check-todo-collapse.mjs
 *
 * 反馈原话：「任务规划清单……一直停留在【任务 1 进行中 · 7 待处理】这种状态下，
 * 当全部跑通且大模型已经 reply 之后，也不关闭」。
 *
 * 这里钉三件事：
 *   1. 决策口径 —— 只有「当前会话 + running→停下 + 不在等确认」才收起；
 *   2. DOM 动作 —— 只点展开态（aria-expanded="true"）的表头，收起态/无面板不动；
 *   3. 挂载点 —— pulse.ts 必须在状态沿上调用它（否则决策对了也没人触发）。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-todo-'))

try {
  const out = join(dir, 't.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/todo-collapse.ts')],
    bundle: true,
    format: 'esm',
    outfile: out,
    platform: 'neutral',
    logLevel: 'silent',
    // react 要打进来（tmp 目录没有 node_modules）；决策函数不碰它，只是被 sessions.ts 拖进来的
    // import —— 不标 external 否则 import 时解析失败
  })
  const m = await import(out)

  let fail = 0
  const check = (label, ok, detail = '') => {
    if (!ok) fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  }

  // —— 1. 决策口径 ——
  const base = { wasRunning: true, running: false, pending: false, isCurrentSession: true }
  check('当前会话跑完 → 收起', m.shouldCollapseTodoPanel(base) === true)
  check('还在跑 → 不收', m.shouldCollapseTodoPanel({ ...base, running: true }) === false)
  check('不是从 running 停下的（本来就没跑）→ 不收',
    m.shouldCollapseTodoPanel({ ...base, wasRunning: false }) === false)
  check('停下但在等确认 → 不收（清单此时还有用）',
    m.shouldCollapseTodoPanel({ ...base, pending: true }) === false)
  check('别的会话停下 → 不收（当前看着的面板属于当前会话）',
    m.shouldCollapseTodoPanel({ ...base, isCurrentSession: false }) === false)

  // —— 2. DOM 动作 ——
  /** 造一个假的 todo 面板根：querySelector 只认选择器，返回可点的假按钮 */
  const fakeRoot = (btn) => ({
    querySelector: (sel) => {
      if (sel !== `${m.TODO_PANEL_SEL} ${m.TODO_HEADER_SEL}`) throw new Error(`选择器变了：${sel}`)
      return btn
    },
  })
  const fakeBtn = (expanded) => {
    const b = {
      clicked: 0,
      getAttribute: (k) => (k === 'aria-expanded' ? expanded : null),
      click() {
        b.clicked++
      },
    }
    return b
  }
  {
    const btn = fakeBtn('true')
    check('展开态 → 点表头收起', m.collapseTodoPanel(fakeRoot(btn)) === true && btn.clicked === 1)
  }
  {
    const btn = fakeBtn('false')
    check('已收起 → 不点（幂等，不会来回抖）', m.collapseTodoPanel(fakeRoot(btn)) === false && btn.clicked === 0)
  }
  {
    check('面板不存在（无 todo）→ 不点不炸', m.collapseTodoPanel(fakeRoot(null)) === false)
  }
  {
    // 真实选择器必须与宿主 TodoPanel 的标记对得上（宿主：data-testid="todo-panel"，表头 button aria-expanded）
    check('选择器锚定宿主标记（data-testid="todo-panel" + button[aria-expanded]）',
      m.TODO_PANEL_SEL === '[data-testid="todo-panel"]' && m.TODO_HEADER_SEL === 'button[aria-expanded]')
  }

  // —— 3. 挂载点 ——
  const pulse = readFileSync(join(root, 'client/src/panel/pulse.ts'), 'utf8')
  check('pulse.ts 在状态沿上调用了它', /onSessionStopped\(id, was === true, isRunning, isPending\)/.test(pulse))
  check('pulse.ts 引入了 todo-collapse', /from '\.\/todo-collapse'/.test(pulse))
  const todoSrc = readFileSync(join(root, 'client/src/panel/todo-collapse.ts'), 'utf8')
  check('收起前延后一拍（让最后一笔 todo 投影先落地）',
    /scheduleCollapseTodoPanel\(delayMs = 600\)/.test(todoSrc))
  check('有连发保护（同一次 transition 不会来回点）',
    /REENTRANT_GUARD_MS/.test(todoSrc) && /lastCollapseAt/.test(todoSrc))

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
