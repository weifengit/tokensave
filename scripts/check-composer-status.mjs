/**
 * 运行计时提醒自检（纯函数 + 源码断言，不需要浏览器）。
 *
 *   node scripts/check-composer-status.mjs
 *
 * 需求原话：「在对话输入框左上角显示"深度求索中，用时10分10秒…"这种提醒。」
 *
 * 对齐原生对话 tab 的 RunningStatus（dsh-client-ui-chat）：
 *   - 显示条件：会话 running；
 *   - 计时起点：本轮 turn/start 事件的 time（拿不到时回退消息流里最后一条
 *     真人消息的 time——注入的 runtime-context 与排队消息不算发言）；
 *   - 每秒刷新，停止即消失。
 *
 * 这里钉三件事：
 *   1. formatElapsed 的「10分10秒」口径；
 *   2. turnStartMsOf 跳过注入与排队消息；
 *   3. 起点优先 readTurnStartMs（与原生同拍），渲染挂在输入条上沿（--ts-composer-h），
 *      横向贴可见输入卡左缘并跟随其宽度（--ts-composer-left / --ts-composer-w，
 *      由 composer-dock 每轮实测 [data-composer-card] 写入）；且徽标出现时消息流
 *      底部多让位（.ts-mainchat:has(.ts-run-badge) → +34px），不压住最新一条回复。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-cstatus-'))

try {
  const out = join(dir, 't.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/composer-status.tsx')],
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

  // —— 1. 用时格式 ——
  check('45 秒（<1 分钟）', m.formatElapsed(45) === '45 秒')
  check('10分10秒（用户口径原样）', m.formatElapsed(610) === '10分10秒')
  check('秒数补零（1分05秒）', m.formatElapsed(65) === '1分05秒')
  check('负数/小数不炸', m.formatElapsed(-3) === '0 秒' && m.formatElapsed(61.9) === '1分01秒')

  // —— 2. 起点：跳过注入与排队消息 ——
  const now = Date.now()
  check('最后一条真人消息的 time 是起点',
    m.turnStartMsOf([
      { role: 'user', content: 'first', time: now - 9_000 },
      { role: 'assistant', content: 'reply', time: now - 8_000 },
      { role: 'user', content: 'second', time: now - 5_000 },
    ]) === now - 5_000)
  check('注入的 runtime-context 不算发言',
    m.turnStartMsOf([
      { role: 'user', content: 'real', time: now - 9_000, injected: false },
      { role: 'user', content: 'snapshot', time: now - 1_000, injected: true, injectKind: 'runtime-context' },
    ]) === now - 9_000)
  check('收件箱排队消息（还没开始跑）不算发言',
    m.turnStartMsOf([
      { role: 'user', content: 'real', time: now - 9_000 },
      { role: 'user', content: 'queued', time: now - 2_000, queued: true },
    ]) === now - 9_000)
  check('流里没有真人消息 → null（badge 不显示）', m.turnStartMsOf([{ role: 'assistant', content: 'x' }]) === null)
  check('真人消息缺 time → null（宁可不算，不显示 1970）',
    m.turnStartMsOf([{ role: 'user', content: 'x' }]) === null)

  // —— 3. 源码断言：与原生同拍 + 挂载点 ——
  const src = readFileSync(join(root, 'client/src/panel/composer-status.tsx'), 'utf8')
  check('起点优先 readTurnStartMs（本轮 turn/start，与原生 RunningStatus 同口径）',
    src.includes('readTurnStartMs(sessionId) ?? turnStartMsOf(messages)'))
  check('running 订阅 uiSession.sessionStatus（activity 同源）',
    src.includes("readService<any>(ctx, 'uiSession')?.sessionStatus"))
  check('每秒自转（对齐原生 LIVE_RUN_CLOCK_INTERVAL_MS=1000）',
    src.includes('setInterval(() => tick((n) => n + 1), 1_000)'))
  check('文案对齐原生（深度求索中，用时…）', src.includes('深度求索中，用时'))
  const main = readFileSync(join(root, 'client/src/panel/MainChat.tsx'), 'utf8')
  check('挂载在主对话面板（ComposerRunBadge + messages 直通）',
    main.includes('<ComposerRunBadge sessionId={sessionId} messages={messages} />'))
  const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
  check('定位在停靠输入条上沿（--ts-composer-h 是 composer-dock 写的实际高度）',
    styles.includes('.ts-run-badge') && styles.includes('var(--ts-composer-h, 0px)'))
  check('徽标左对齐输入卡并随宽度调节变动（left/max-width 消费 dock 实测变量）',
    styles.includes('left:var(--ts-composer-left, 14px)') &&
    styles.includes('max-width:var(--ts-composer-w,'))
  check('徽标出现时消息流多让位，不压最新回复（:has 只在实际显示时生效）',
    styles.includes('.ts-mainchat:has(.ts-run-badge) .ts-chat-msgs') &&
    /:has\(.ts-run-badge\) .ts-chat-msgs \{[^}]*padding-bottom:calc\(var\(--ts-composer-h, 72px\) \+ 34px\)/.test(styles) &&
    // 不能把基础留白也改大（不跑时会白留一块空白）
    styles.includes('.ts-mainchat .ts-chat-msgs { padding-bottom:calc(var(--ts-composer-h, 72px) + 14px); }'))
  const sub = readFileSync(join(root, 'client/src/session-subscribe.ts'), 'utf8')
  const dock = readFileSync(join(root, 'client/src/panel/composer-dock.ts'), 'utf8')
  check('左缘/宽度实测可见输入卡（apply 写 --ts-composer-left / --ts-composer-w）',
    dock.includes("querySelector<HTMLElement>('[data-composer-card]')") &&
    dock.includes("setProperty('--ts-composer-left'") &&
    dock.includes("setProperty('--ts-composer-w'"))
  check('卸载时清掉左缘/宽度变量（不把旧坐标留给下一次）',
    dock.includes("removeProperty('--ts-composer-left')") &&
    dock.includes("removeProperty('--ts-composer-w')"))
  check('readTurnStartMs 从事件窗口倒序找 turn/start.time',
    sub.includes("ev?.type === 'turn/start'") && sub.includes('Number(ev.time) || null'))

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
