/**
 * 「换个设备 / 刷新后黄蓝角标还在」的护栏（源码断言，不需要浏览器）。
 *
 *   node scripts/check-badge-restore.mjs
 *
 * 用户反馈原话：「手机端连接时……左侧栏上只能看到呼吸灯，当项目完成或者卡住的
 * 那些蓝色黄色数字角标提醒没有了，请回归复原。」
 *
 * 根因（这次锁死的就是它）：
 *   - 黄 = 需处理（待确认 / 未正常结束），蓝 = 未读的正常结束，都来自 pulse.ts；
 *   - 黄灯靠 10s 兜底扫描重建，但原窗口只扫「最近 1 小时有活动」的会话；
 *   - 蓝灯更窄：scanOutcomes 只有在**本页观察到**一次 running→false（stoppedAt > 0）
 *     时才 recordDone。手机是另一个 origin、页面刚打开，观察不到电脑上早已发生的
 *     停止，于是蓝角标在新设备上恒为 0；隔一小时再看手机，黄角标也扫不到。
 *   - 用户看到的现象就是「只有呼吸灯（running 来自服务端实时状态），数字角标全没了」。
 *
 * 口径：
 *   1. 扫描窗口放宽到 6 小时，覆盖「隔了一会儿拿起手机」；
 *   2. 正常结束按这一轮的 turnAt 是否新鲜收口，不再要求本页观察到停止；
 *   3. 已读标注仍按 sessionId:turnAt 去重（看过的不会因为重连反复提醒）；
 *   4. 角标仍渲染在侧栏入口（黄/蓝两枚），不因 wide / rail 而消失。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

const pulse = readFileSync(join(root, 'client/src/panel/pulse.ts'), 'utf8')
const entry = readFileSync(join(root, 'client/src/panel/ControlRoomEntry.tsx'), 'utf8')

console.log('— 1. 扫描窗口：跨设备连接也能重建结局 —')

check('扫描窗口是 6 小时（不再只扫最近 1 小时）',
  /const SCAN_WINDOW_MS = 6 \* 60 \* 60 \* 1000/.test(pulse))

check('窗口注释写明「手机新开页面」的场景（不是随手放大）',
  /手机新开页面时/.test(pulse) && /复原成蓝黄角标/.test(pulse))

console.log('— 2. 蓝角标不再依赖「本页观察到停止」—')

check('旧条件 stop > 0 + 60s 已移除',
  !/stop > 0 && Date\.now\(\) - stop < 60_000/.test(pulse))

check('改为按本轮结束时间收口（endedAgo < 扫描窗口）',
  /const endedAgo = Date\.now\(\) - o\.turnAt/.test(pulse) &&
  /endedAgo >= 0 && endedAgo < SCAN_WINDOW_MS/.test(pulse))

check('扫描到正常结束仍走 recordDone（会话 + 项目 + turnAt 齐全）',
  /recordDone\(\{ sessionId: c\.id, project: c\.project, projectId: c\.projectId, title, turnAt: o\.turnAt \}\)/.test(pulse))

check('只收 completed / forked（用户主动停止不算完成）',
  /!o\.failed && \(o\.kind === 'completed' \|\| o\.kind === 'forked'\)/.test(pulse))

console.log('— 3. 已读语义不被放宽吞掉 —')

check('蓝角标的已读键仍是 sessionId:turnAt',
  /function doneKey\(sessionId: string, turnAt: number\): string \{[\s\S]{0,80}?return `d:\$\{sessionId\}:\$\{turnAt\}`/.test(pulse))

check('渲染前仍过滤已读标注（重连不会重复提醒看过的）',
  /const key = doneKey\(d\.sessionId, d\.turnAt\)[\s\S]{0,120}?if \(readMarks\.has\(key\)\) continue/.test(pulse))

console.log('— 4. 侧栏入口照旧渲染两枚角标 —')

check('黄角标：需要处理的对话数',
  /className="ts-side-badge is-warn"/.test(entry) && /\{pulse\.warn\}/.test(entry))

check('蓝角标：未读的正常结束数',
  /className="ts-side-badge is-done"/.test(entry) && /\{pulse\.done\.length\}/.test(entry))

check('角标不受 wide / rail 门控（手机抽屉和窄轨都能看到）',
  !/\{wide &&[\s\S]{0,200}?ts-side-badge/.test(entry) &&
  /\{alive && \(/.test(entry))

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exitCode = fail === 0 ? 0 : 1