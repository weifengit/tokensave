/**
 * 工作台会话图片的回归护栏。
 *
 *   node scripts/check-chat-images.mjs
 *
 * 钉两件事：
 *   1. 数据层：user / assistant / tool-result / 队列消息里的 image 块都投影成
 *      StreamMsg.images（图片-only 消息不能因为正文为空被丢掉）；
 *   2. 呈现层：图片在用户气泡、最终回答、折叠过程之外、排队气泡四处都渲染，
 *      且读取走宿主 uiConversation 的授权缓存（不自己拼附件路径）。
 *
 * 数据层跑的是真实投影函数（esbuild 现编现跑），不是源码正则；
 * 呈现层是静态断言（没有 DOM 测试环境，与仓库其它 check 脚本同口径）。
 */
import { readFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

const msgList = readFileSync(join(root, 'client/src/panel/MsgList.tsx'), 'utf8')
const imagesSrc = readFileSync(join(root, 'client/src/panel/message-images.tsx'), 'utf8')
const sub = readFileSync(join(root, 'client/src/session-subscribe.ts'), 'utf8')
const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')

console.log('— 1. 数据层：四类事件里的图片都要进 StreamMsg —')

const ref = (name) => ({
  type: 'image',
  attachment: { attachmentId: `sha256:${name}`, mediaType: 'image/png', bytes: 12, width: 10, height: 8, name },
})
const snapshot = {
  entries: [
    { type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: { role: 'user', source: { kind: 'user' }, content: [ref('u.png'), { type: 'text', text: '看图' }] } } },
    { type: 'event', event: { type: 'assistant/message', seq: 2, time: 2, data: { content: [{ type: 'text', text: '收到' }, ref('a.png')] } } },
    { type: 'event', event: { type: 'tool/result', seq: 3, time: 3, data: { message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: '<path>x</path>' }, ref('t.png')] } } } },
    { type: 'event', event: { type: 'agent/inbox/spliced', seq: 4, time: 4, data: { target: 'next-turn', start: 0, removedCount: 0, inserted: [{ role: 'user', content: [ref('q.png')] }] } } },
  ],
}

const out = join(mkdtempSync(join(tmpdir(), 'ts-chat-img-')), 'sub.mjs')
await build({
  entryPoints: [join(root, 'client/src/session-subscribe.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
})
const { messagesFromWindow } = await import(pathToFileURL(out).href)
const msgs = messagesFromWindow(snapshot)
const byName = (name) => msgs.find((m) => (m.images || []).some((i) => i.name === name))

check('用户附件图片进用户消息', byName('u.png')?.role === 'user' && byName('u.png')?.content === '看图')
check('模型回复里的图片进 assistant 消息', byName('a.png')?.role === 'assistant')
check('工具结果里的图片进 tool 消息（read_image / 截图）', byName('t.png')?.role === 'tool')
check('队列里图片-only 的消息不被丢掉', byName('q.png')?.queued === true && byName('q.png')?.content === '')
check('形状不完整的 image 块被丢弃而不是抛错',
  messagesFromWindow({ entries: [{ type: 'event', event: { type: 'user/message', seq: 1, data: { role: 'user', content: [{ type: 'image', attachment: { mediaType: 'image/png' } }] } } }] }).length === 0)

console.log('— 2. 呈现层：四处渲染 + 授权读取 —')

check('用户气泡渲染图片（靠右）',
  /\{m\.images\?\.length \? <MessageImages sessionId=\{sessionId\} images=\{m\.images\} align="end" \/> : null\}/.test(msgList))
check('最终回答渲染图片（靠左）',
  /\{t\.answer\.images\?\.length \? <MessageImages sessionId=\{sessionId\} images=\{t\.answer\.images\} align="start" \/> : null\}/.test(msgList))
check('过程折叠之外的图片常显（工具结果不被埋进「过程 N 步」）',
  /const withImages = items\.filter\(\(m\) => \(m\.images\?\.length \?\? 0\) > 0\)/.test(msgList) &&
  /className="ts-proc-images"/.test(msgList) &&
  /\{withImages\.length > 0 && \(/.test(msgList))
check('排队中的消息也渲染图片', /data-turn-queued=""/.test(msgList) && /排队中/.test(msgList))
check('图片-only 的 assistant 消息也算最终回答',
  /\(m\.content\.trim\(\) \|\| \(m\.images\?\.length \?\? 0\) > 0\)/.test(msgList))
check('图片读取走宿主 uiConversation 授权缓存（不是自己拼路径）',
  /readService<any>\(clientCtx, 'uiConversation'\)/.test(sub) &&
  /conv\.imageUrl\(sessionId, attachment\)/.test(sub) &&
  !/attachments?\//.test(sub))
check('读取失败的图片可点击重试', /加载失败，点击重试/.test(imagesSrc))
check('灯箱：Esc 关闭 + 文档级 portal',
  /createPortal\(/.test(imagesSrc) && /e\.key === 'Escape'/.test(imagesSrc))
check('单图外框按图片自身尺寸：长边 240 / 比例钳 [0.25,4] / 不放大 / 不铺满容器',
  /function singleFit\(image: StreamImageAttachment\)/.test(imagesSrc) &&
  /const ratio = Math\.min\(4, Math\.max\(0\.25, natural\)\)/.test(imagesSrc) &&
  /const scale = Math\.min\(1, image\.width \/ box\.width, image\.height \/ box\.height\)/.test(imagesSrc) &&
  /aspectRatio: `\$\{fit\.width\} \/ \$\{fit\.height\}`/.test(imagesSrc) &&
  /\.ts-msg-image\.is-single \{ flex:0 1 auto; height:auto; \}/.test(styles) &&
  /\.ts-msg-image img \{ position:absolute; inset:0; display:block; width:100%; height:100%; object-fit:cover; \}/.test(styles))
check('多图收成 64px 方块',
  /\.ts-msg-image\.is-tile \{ flex:none; width:64px; height:64px; \}/.test(styles))

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
