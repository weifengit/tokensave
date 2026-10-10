/**
 * 自动继续分类器的自检脚本（无框架，直接 node 跑）。
 *
 *   node scripts/check-continue-policy.mjs
 *
 * 为什么要有它：自动继续是**会自己往会话里发消息**的行为，判错的代价是
 * 「往一个已经余额不足 / 上下文超长的会话里不停重试」。所以判定表必须可验证 ——
 * 这里把口径逐条钉下来（瞬时 vs 永久、待确认、用户停止、退避曲线）。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-continue-'))

try {
  const out = join(dir, 'policy.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/continue-policy.ts')],
    bundle: true, format: 'esm', outfile: out, platform: 'neutral', logLevel: 'silent',
  })
  const m = await import(out)
  const S = m.DEFAULT_CONTINUE_SETTINGS

  /** [说明, 中断事实, 期望动作, 设置补丁?] */
  const CASES = [
    ['max-tokens 截断', { kind: 'max-tokens' }, 'auto'],
    ['max-tokens 但关了该项', { kind: 'max-tokens' }, 'manual', { autoMaxTokens: false }],
    ['网络超时', { kind: 'error', message: 'fetch failed: ETIMEDOUT' }, 'auto'],
    ['429 限流', { kind: 'error', code: '429', message: 'rate limit exceeded' }, 'auto'],
    ['502 网关', { kind: 'error', message: 'Bad gateway (502)' }, 'auto'],
    ['连接重置', { kind: 'error', code: 'ECONNRESET' }, 'auto'],
    ['interrupted（宿主崩溃遗留）', { kind: 'interrupted' }, 'auto'],
    ['agent/error 无详情 → 默认瞬时', { kind: 'agent/error' }, 'auto'],
    ['401 鉴权', { kind: 'error', code: '401', message: 'Unauthorized' }, 'manual'],
    ['无效 API Key', { kind: 'error', message: 'invalid api key provided' }, 'manual'],
    ['余额不足', { kind: 'error', message: 'Insufficient balance, please top up' }, 'manual'],
    ['配额超限', { kind: 'error', message: 'You exceeded your current quota' }, 'manual'],
    ['未知模型', { kind: 'error', message: 'unknown model: foo-bar' }, 'manual'],
    ['上下文超长', { kind: 'error', message: 'maximum context length exceeded' }, 'manual'],
    ['推理死循环', { kind: 'error', code: 'REASONING_LOOP', message: 'loop' }, 'manual'],
    ['待确认（权限）', { kind: 'permission' }, 'manual'],
    ['待确认（同意）', { kind: 'awaiting-consent' }, 'manual'],
    ['策略阻断', { kind: 'blocked' }, 'manual'],
    ['用户主动停止', { kind: 'aborted', subKind: 'user' }, 'never'],
    ['登出中止', { kind: 'aborted', subKind: 'hook', code: 'ACCOUNT_SIGNED_OUT' }, 'manual'],
    ['钩子异常中止', { kind: 'aborted', subKind: 'hook', message: 'hook failed' }, 'manual'],
    ['正常完成', { kind: 'completed' }, 'never'],
    ['fork', { kind: 'forked' }, 'never'],
    ['未知 kind → fail closed', { kind: 'weird-host-thing' }, 'manual'],
    ['永久性但关了分类 → 退回瞬时', { kind: 'error', message: 'Insufficient balance' }, 'auto', { classify: false }],
    ['自定义关键字覆盖永久判定', { kind: 'error', message: 'Upstream rejected the request as invalid' }, 'auto', { customRetryable: 'Upstream rejected the request as invalid' }],
    ['总开关关闭', { kind: 'max-tokens' }, 'manual', { enabled: false }],
    ['关掉瞬时自动', { kind: 'error', code: 'ECONNRESET' }, 'manual', { autoTransient: false }],
  ]

  let fail = 0
  for (const [label, info, want, patch] of CASES) {
    const s = patch ? { ...S, ...patch } : S
    const got = m.decideContinue(info, s)
    const ok = got.action === want
    if (!ok) fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(30)} -> ${got.action.padEnd(6)} ${got.reason}`)
  }

  // 占位符渲染：渲染成空时要把空括号一起清掉（别发出「继续（）」）
  const t1 = m.renderTemplate('继续（{code}）', { kind: 'error', code: 'ECONNRESET' })
  const t2 = m.renderTemplate('继续（{code}）', { kind: 'error' })
  for (const [label, got, want] of [['占位符渲染', t1, '继续（ECONNRESET）'], ['空占位符清理', t2, '继续']]) {
    const ok = got === want
    if (!ok) fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(30)} -> ${JSON.stringify(got)}`)
  }

  // 退避曲线：必须单调不减、且封顶（否则会无限拉长或退化成 0）
  const curve = [0, 1, 2, 3, 5, 10, 20].map((n) => m.coolDownFor(n, S))
  const mono = curve.every((v, i) => i === 0 || v >= curve[i - 1])
  const capped = curve.every((v) => v <= S.backoffMaxMs)
  if (!mono || !capped) fail++
  console.log(`${mono && capped ? 'PASS' : 'FAIL'}  ${'退避曲线单调且封顶'.padEnd(30)} -> ${curve.map((v) => `${v / 1000}s`).join(' ')}`)

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
