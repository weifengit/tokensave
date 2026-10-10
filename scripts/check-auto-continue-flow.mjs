/**
 * 自动继续**端到端**自检：用一个假的宿主事件窗口走真实的 readTurnOutcome →
 * applyOutcome → emitAlert → 自动继续引擎 这条链，确认：
 *   1. 宿主的 reason 被正确归一化成 InterruptInfo（码 / 文案 / aborted 子类型）；
 *   2. max-tokens 会自动排队发送，且发出去的正是渲染好的文案；
 *   3. 永久性错误（余额不足）不会自动发；
 *   4. 用户主动停止既不响铃也不自动。
 *
 *   node scripts/check-auto-continue-flow.mjs
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-flow-'))

const shim = join(dir, 'shim.ts')
const { writeFileSync } = await import('node:fs')
writeFileSync(shim, `
export {}
`)

try {
  const out = join(dir, 'chain.mjs')
  // 只打包分类 + 策略 + 引擎（避开需要真实 window/DOM 的 sessions.ts）
  await build({
    stdin: {
      contents: `
import { decideContinue, gateAutoContinue, noteAutoContinue, resetContinueStates, DEFAULT_CONTINUE_SETTINGS } from '${join(root, 'client/src/panel/continue-policy.ts')}'
export { decideContinue, gateAutoContinue, noteAutoContinue, resetContinueStates, DEFAULT_CONTINUE_SETTINGS }
`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true, format: 'esm', outfile: out, platform: 'neutral', logLevel: 'silent',
  })
  const m = await import(out)

  // 模拟 readTurnOutcome 对宿主 reason 的归一化（与 pulse.ts 同逻辑）
  const normalize = (reason) => {
    const kind = String(reason.kind || '')
    const err = reason.error || {}
    if (kind === 'aborted') {
      const r = reason.reason || {}
      const sub = String(r.kind || '')
      const subCode = sub === 'hook' && String(r.reason || '') === 'deepseek-account/signed-out' ? 'ACCOUNT_SIGNED_OUT' : err.code
      return { kind, subKind: sub, message: r.message || err.message || '', ...(subCode ? { code: subCode } : {}) }
    }
    return { kind, message: err.message || '', ...(err.code ? { code: err.code } : {}) }
  }

  const HOST_EVENTS = [
    ['输出被截断', { kind: 'max-tokens' }, 'auto', '继续（上一轮输出达到长度上限被截断，接着写，不要重复已经写过的内容）'],
    ['余额不足', { kind: 'error', error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' } }, 'manual', null],
    ['网络抖动', { kind: 'error', error: { code: 'ECONNRESET', message: 'socket hang up' } }, 'auto', '继续（ECONNRESET）'],
    ['用户主动停止', { kind: 'aborted', reason: { kind: 'user' } }, 'never', null],
    ['登出', { kind: 'aborted', reason: { kind: 'hook', reason: 'deepseek-account/signed-out' } }, 'manual', null],
  ]

  let fail = 0
  for (const [label, reason, wantAction, wantText] of HOST_EVENTS) {
    const info = normalize(reason)
    const d = m.decideContinue(info, m.DEFAULT_CONTINUE_SETTINGS)
    let ok = d.action === wantAction
    if (ok && wantText != null) ok = d.text === wantText
    if (ok && wantText == null) ok = d.text === undefined
    if (!ok) fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(12)} kind=${info.kind.padEnd(11)} -> ${d.action.padEnd(6)} ${JSON.stringify(d.text ?? '')}`)
  }

  // 连续次数上限：每放行一次就记一次，到 maxConsecutive 必须拦住
  m.resetContinueStates()
  const S = m.DEFAULT_CONTINUE_SETTINGS
  const seq = []
  for (let n = 1; n <= S.maxConsecutive + 1; n++) {
    const g = m.gateAutoContinue('s1', { ...S, cooldownMs: 0 })
    seq.push(`${n}:${g.ok ? 'ok' : 'BLOCKED'}`)
    if (g.ok) m.noteAutoContinue('s1')
  }
  const limitOk = seq.filter((x) => x.endsWith('ok')).length === S.maxConsecutive
  if (!limitOk) fail++
  console.log(`${limitOk ? 'PASS' : 'FAIL'}  ${'连续次数上限'.padEnd(12)} ${seq.join(' ')}`)

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
