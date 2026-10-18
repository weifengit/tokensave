/**
 * 「发出去的消息看不见」自检（纯文本断言，不需要浏览器）。
 *
 *   node scripts/check-msg-queue.mjs
 *
 * 钉住两个用户报过的 bug 的修复点，防止后续改动把它们改回去：
 *
 * 问题 A（新会话第一句 / 自动继续的「继续」发出去看不见）：
 *   根因：subscribeSession 的底层流只在通道首建时 openStream 一次；新会话刚创建
 *   binding 未物化 → retain 三源全失败 → 通道永久停在空列表，之后消息虽已落盘
 *   永远读不到。修复：openStream 维护 ch.streamState，失败走 markStreamFailed
 *   （退避定时器 + 会话目录变化双路重试），订阅入口对 failed 通道再拉一把。
 *
 * 问题 B（会话忙时发的第二条消息看不见，宿主原生「对话」的 QueueDock 却有）：
 *   根因：忙时 conversation.send 的消息先进收件箱队列——durable 事件是
 *   agent/inbox/spliced（inserted 带全文），下一轮开始才成为 user/message；
 *   messagesFromWindow 以前不认识这个事件，直接丢了。修复：折叠 spliced 成
 *   queued 气泡（虚线弱化 +「排队中」标）挂在流末尾；消费时 spliced(removedCount)
 *   把它摘走、同 seq 的 user/message 转正，全量重放不重不漏。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sub = readFileSync(join(root, 'client/src/session-subscribe.ts'), 'utf8')
const msgs = readFileSync(join(root, 'client/src/panel/MsgList.tsx'), 'utf8')
const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')

let fail = 0
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) fail++
}

// —— A. 流失败自愈 ——
check('openStream 维护 streamState（connecting/open/failed）',
  /ch\.streamState = 'connecting'/.test(sub) &&
  /ch\.streamState = 'open'/.test(sub) &&
  /function markStreamFailed/.test(sub))
check('两条打开路径的失败出口都登记重试（sessions 不可用 / 全路失败）',
  (sub.match(/markStreamFailed\(sessionId, ch\)/g) || []).length >= 2)
check('重试双保险：退避定时器 + 会话目录变化钩子',
  /STREAM_RETRY_MS/.test(sub) &&
  /ch\.retryTimer = setTimeout/.test(sub) &&
  /function hookListRetry/.test(sub) &&
  /list\.subscribe\(\(\) =>/.test(sub))
check('重订阅时 failed 通道立即再拉一把（两个订阅入口都接）',
  (sub.match(/if \(ch\.streamState === 'failed'\) \{ hookListRetry\(\); retryOpenStream\(sessionId, ch\) \}/g) || []).length === 2)
check('重试不复活无人订阅的通道',
  /if \(ch\.subs\.size === 0 && ch\.metricSubs\.size === 0\) return/.test(sub))

// —— B. 队列消息折叠 ——
check('spliced 事件折叠成 queued 消息（StreamMsg 有 queued 字段）',
  /queued\?: boolean/.test(sub) &&
  /function queuedMsgOf/.test(sub) &&
  /function applySplice/.test(sub) &&
  /data\.target !== 'next-turn'/.test(sub))
check('全量路径：spliced 进队列、队列拼在流末尾',
  /if \(ev\.type === 'agent\/inbox\/spliced'\) \{/.test(sub) &&
  /applySplice\(queue, ev\.data/.test(sub) &&
  /return out\.concat\(queue\)/.test(sub))
check('增量路径：队列就地维护（base+queue 重拼，不重复）',
  /const base = ch\.msgs\.filter\(\(m\) => !m\.queued\)/.test(sub) &&
  /const queue = ch\.msgs\.filter\(\(m\) => m\.queued\)/.test(sub) &&
  /ch\.msgs = base\.concat\(queue\)/.test(sub))
check('MsgList：queued 单独收口、不开新轮、agent 档隐藏',
  /if \(m\.queued\) \{ queued\.push\(m\); continue \}/.test(msgs) &&
  /m\.role === 'user' && !m\.injected && !m\.queued/.test(msgs) &&
  /queued: view === 'agent' \? \[\] : t\.queued/.test(msgs))
check('排队气泡有专属样式（虚线弱化 +「排队中」标）',
  /\.ts-msg-queued \{/.test(styles) && /\.ts-queued-tag \{/.test(styles) &&
  /data-turn-queued=""/.test(msgs) && /排队中/.test(msgs))

if (fail) {
  console.error(`\n${fail} 项 FAIL`)
  process.exit(1)
}
console.log('\nALL PASS')
