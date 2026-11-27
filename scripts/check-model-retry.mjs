/**
 * 工作台「模型重试提醒」自检（纯函数 + 源码断言，不需要浏览器）。
 *
 *   node scripts/check-model-retry.mjs
 *
 * 需求原话：「原生的『对话』tab 中可以看到模型重试那些提醒，也请在自己开发的
 * 『工作台』中复刻，方便跟进。」
 *
 * 这里钉四件事：
 *   1. 投影 —— llm/retry / llm/retry-started 必须进入消息流（以前这两个事件被丢掉）；
 *   2. 聚合 —— 同一 retryId 的多次尝试只保留一条，attempt / delay / failure 取最新；
 *   3. 生命周期 —— scheduled → started；回合关闭仍未 started → cancelled；
 *   4. 呈现 —— 重试行不进「过程」折叠（折起来就失去实时提醒的意义），
 *      MsgList 有对应渲染，styles 有对应样式。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-retry-'))

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

try {
  const out = join(dir, 'sub.mjs')
  await build({
    entryPoints: [join(root, 'client/src/session-subscribe.ts')],
    bundle: true, format: 'esm', outfile: out, platform: 'neutral', logLevel: 'silent',
  })
  const m = await import(out)

  /** 一条 durable 事件（SessionEventWindow 的 entries 形态） */
  const ev = (type, data, time = Date.now()) => ({ type: 'event', event: { type, time, data } })
  const retryData = (patch = {}) => ({
    retryId: 'retry-1',
    turn: 3,
    step: 2,
    provider: 'deepseek',
    mode: 'normal',
    policyKey: 'default',
    retry: 1,
    maxRetries: 3,
    delayMs: 5000,
    failure: { message: 'upstream overloaded', code: 'OVERLOADED' },
    ...patch,
  })
  const msgsOf = (...entries) => m.messagesFromWindow({ entries })

  // —— 1. 事件进入消息流 ——
  {
    const msgs = msgsOf(ev('llm/retry', retryData()))
    const r = msgs.find((x) => x.retry)
    check('llm/retry 进入消息流（不再被丢掉）', !!r)
    check('retry 字段归一化：retryId / 次数 / 上限 / 延迟 / 失败原因',
      r?.retry?.retryId === 'retry-1' && r.retry.retry === 1 && r.retry.maxRetries === 3
      && r.retry.delayMs === 5000 && r.retry.failureMessage === 'upstream overloaded'
      && r.retry.failureCode === 'OVERLOADED',
      JSON.stringify(r?.retry))
    check('初始生命周期为 scheduled（等待重试）', r?.retry?.state === 'scheduled')
    check('重试行不允许有正文（不混进气泡）', r?.content === '' && !r?.images)
  }

  // —— 2. 同一 retryId 聚合成一条 ——
  {
    const msgs = msgsOf(
      ev('llm/retry', retryData()),
      ev('llm/retry', retryData({ retry: 2, delayMs: 10000, failure: { message: 'still failing', code: 'RATE_LIMIT' } })),
    )
    const rs = msgs.filter((x) => x.retry)
    check('同 retryId 的第二次尝试不新增一行（按链聚合）', rs.length === 1, `${rs.length} 行`)
    check('聚合行取最新一次的 attempt / delay / failure',
      rs[0]?.retry?.retry === 2 && rs[0].retry.delayMs === 10000
      && rs[0].retry.failureMessage === 'still failing',
      JSON.stringify(rs[0]?.retry))
  }

  // —— 3. 生命周期 ——
  {
    const msgs = msgsOf(
      ev('llm/retry', retryData()),
      ev('llm/retry-started', { retryId: 'retry-1', turn: 3, step: 2, retry: 1 }),
    )
    const r = msgs.find((x) => x.retry)
    check('llm/retry-started → started', r?.retry?.state === 'started')
    check('started 后仍保留 delay / failure（详情可展开）',
      r?.retry?.delayMs === 5000 && r?.retry?.failureMessage === 'upstream overloaded')
  }
  {
    const msgs = msgsOf(
      ev('llm/retry', retryData()),
      ev('turn/end', { turn: 3, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
    )
    const r = msgs.find((x) => x.retry)
    check('回合关闭仍未 started → cancelled（不会一直显示“正在重试”）',
      r?.retry?.state === 'cancelled')
  }
  {
    const msgs = msgsOf(
      ev('llm/retry', retryData({ turn: 3 })),
      ev('turn/end', { turn: 4, reason: { kind: 'completed' } }),
    )
    check('别的回合关闭不会误伤本回合的 scheduled 重试',
      msgs.find((x) => x.retry)?.retry?.state === 'scheduled')
  }

  // —— 3b. 连上即隐藏（用户要求：模型连上了之后就隐藏这条提醒）——
  {
    const started = ev('llm/retry-started', { retryId: 'retry-1', turn: 3, step: 2, retry: 1 })
    const reply = ev('assistant/message', { turn: 3, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: '好了' }] } })
    const msgs = msgsOf(ev('llm/retry', retryData()), started, reply)
    check('重试开始后拿到模型回复 → 提醒从流里摘掉',
      msgs.every((x) => !x.retry))
  }
  {
    const started = ev('llm/retry-started', { retryId: 'retry-1', turn: 3, step: 2, retry: 1 })
    const chunk = {
      type: 'transient',
      event: { type: 'assistant/live-chunk', time: Date.now(), data: { turn: 3, attemptId: 'a1', chunk: { type: 'text-delta', text: '你' } } },
    }
    const msgs = msgsOf(ev('llm/retry', retryData()), started, chunk)
    check('重试开始后先到流式增量也算连上 → 提醒隐藏（正文保留）',
      msgs.every((x) => !x.retry) && msgs.some((x) => x.content === '你'))
  }
  {
    const started = ev('llm/retry-started', { retryId: 'retry-1', turn: 3, step: 2, retry: 1 })
    const tool = ev('tool/call', { turn: 3, name: 'read', arguments: '{}' })
    const msgs = msgsOf(ev('llm/retry', retryData()), started, tool)
    check('重试开始后只有工具调用（没有正文）也算连上 → 提醒隐藏',
      msgs.every((x) => !x.retry))
  }
  {
    const started = ev('llm/retry-started', { retryId: 'retry-1', turn: 3, step: 2, retry: 1 })
    const reply = ev('assistant/message', { turn: 4, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '下一轮' }] } })
    const msgs = msgsOf(ev('llm/retry', retryData()), started, reply)
    check('别的轮的回包不会抹掉本轮的 started 提醒（只看同轮）',
      msgs.find((x) => x.retry)?.retry?.state === 'started')
  }
  {
    const msgs = msgsOf(
      ev('llm/retry', retryData()),
      ev('llm/retry-started', { retryId: 'retry-1', turn: 3, step: 2, retry: 1 }),
      ev('assistant/message', { turn: 3, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: '好了' }] } }),
      ev('llm/retry', retryData({ retry: 2, delayMs: 8000 })),
      ev('llm/retry-started', { retryId: 'retry-1', turn: 3, step: 2, retry: 2 }),
    )
    check('连上后又失败重试 → 新的提醒照常出现（按链重新开头）',
      msgs.find((x) => x.retry)?.retry?.retry === 2)
  }

  // —— 4. 脏数据 / 边界 ——
  {
    check('缺 retryId 的脏事件不产出行',
      msgsOf(ev('llm/retry', { ...retryData(), retryId: '' })).length === 0)
    check('孤立的 retry-started（计划事件在窗口外）不凭空造行',
      msgsOf(ev('llm/retry-started', { retryId: 'x', turn: 1, step: 1, retry: 1 })).length === 0)
    const always = msgsOf(ev('llm/retry', { ...retryData(), mode: 'always', maxRetries: undefined }))
    check('mode=always 不带上限（渲染为 ∞）', always.find((x) => x.retry)?.retry?.maxRetries === undefined)
    const two = msgsOf(ev('llm/retry', retryData()), ev('llm/retry', retryData({ retryId: 'retry-2' })))
    check('不同 retryId 是两条独立的链', two.filter((x) => x.retry).length === 2)
  }

  // —— 5. 呈现：不折进「过程」，有渲染与样式 ——
  const listSrc = readFileSync(join(root, 'client/src/panel/MsgList.tsx'), 'utf8')
  const css = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
  check('重试链在 splitTurn 里先于「过程」收口（不埋进过程折叠）',
    /if \(m\.retry\) \{ retries\.push\(m\); continue \}/.test(listSrc))
  check('MsgList 真的渲染重试行（t.retries + ModelRetryRow）',
    /t\.retries\.length > 0/.test(listSrc) && /<ModelRetryRow/.test(listSrc))
  check('重试行有独立样式（运行中脉冲 + 详情）',
    /\.ts-retry-row\.is-active \{[^}]*background/.test(css) &&
    /\.ts-retry-detail \{[^}]*display:flex/.test(css))
  check('失败码翻成人话（AUTH / QUOTA）',
    /case 'AUTH': return 'API 密钥无效'/.test(listSrc) &&
    /case 'ACCOUNT_QUOTA': return '账号额度不足'/.test(listSrc))

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}