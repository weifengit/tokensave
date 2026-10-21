/**
 * 「危险操作等『允许一次』时也要响铃」自检（源码正则断言，不需要浏览器）。
 *
 *   node scripts/check-pending-alert.mjs
 *
 * 用户反馈原话：「当卡在危险操作需要『允许一次』的那类权限时，呼吸灯变成了黄色，
 * 但是我没有听到提示音。」
 *
 * 根因（这次改动锁死的就是它）：黄灯由「项目里有 state === 'pending' 的活动」点亮
 * （activity.ts / pulse.ts 的 activity 循环），而提示音原先**只**挂在 applyOutcome
 * （「观察到的停止」那条路）上 —— 卡在半路等用户点「允许一次」的那一轮**永远不会结束**，
 * 于是永远走不到结局告警，安静地等成了默认行为。修法：在会话进入 pendingInteraction
 * 的**跃迁**那一拍起音。
 *
 * 锁死的口径：
 *   A. 有这条告警通道：
 *      1. PulseAlert.kind 增加 'pending'；
 *      2. emitPendingAlert 独立于结局告警（它没有「轮次」维度，不去重按 sessionId:turnAt）；
 *      3. 起音点在 statuses 循环的 pending 跃迁处（黄灯从同一处数据点亮）。
 *   B. 别变成噪音：
 *      1. 只认 false → true 的跃迁（wasPending === undefined 是「我第一次看到就已经弹着」，
 *         那是切页面/刷新撞上已有弹窗，不该对着它响铃）；
 *      2. 判据比同处的「作废已读标注」严格一档 —— 那条是 !wasPending（含首次观测）。
 *   C. 落到声音上：
 *      1. 桥接把 pending 映射到 fail 音效（用户已在设置里给「中断」挑好了曲子）；
 *      2. 显示标签单独给「待确认」（否则面板里会说成「中断」，像有一轮报错了）；
 *      3. playRole 支持 label 覆盖，试听路径不受影响（不传就是原标签）。
 *   D. 不误伤别的机制：
 *      1. 自动继续只认 kind === 'fail' 早退，新增 pending 不会触发自动发消息；
 *      2. 用户一操作就停（pointerdown/keydown/touchstart/wheel），答完弹窗铃声不会响不停。
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
const sound = readFileSync(join(root, 'client/src/panel/sound.ts'), 'utf8')
const cont = readFileSync(join(root, 'client/src/panel/auto-continue.ts'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

console.log('— A. 有一条「待确认」告警通道 —')

check('PulseAlert.kind 含 pending（不再是只有 done / fail 两种）',
  /kind: 'done' \| 'fail' \| 'pending'/.test(pulse))

check('emitPendingAlert：与结局告警分开（没有轮次维度，不按 sessionId:turnAt 去重）',
  /function emitPendingAlert\(sessionId: string, title: string\): void \{/.test(pulse) &&
  /l\(\{ kind: 'pending', sessionId, title \}\)/.test(pulse))

check('起音点就在 statuses 循环的 pending 判定处（与黄灯同源）',
  /const isPending = row\?\.pendingInteraction != null/.test(pulse) &&
  /if \(wasPending === false && isPending\) \{[\s\S]{0,200}?emitPendingAlert\(id,/.test(pulse))

console.log('— B. 只响「刚弹出来」这一拍（不做噪音）—')

check('判据是 false → true 跃迁（首次观测 undefined 不响）',
  /if \(wasPending === false && isPending\) \{/.test(pulse) &&
  !/if \(!wasPending && isPending\) \{[\s\S]{0,200}?emitPendingAlert\(/.test(pulse))

check('同处的「作废已读标注」仍是 !wasPending（不因起音改动而被收窄）',
  /if \(!wasPending && isPending\) \{[\s\S]{0,300}?persistReadMarks\(\)/.test(pulse))

check('只在跃迁这一拍查标题（不在每轮轮询里逐个会话查）',
  /if \(wasPending === false && isPending\) \{[\s\S]{0,200}?const pendingRow = sessionRow\(ctx, id\)/.test(pulse))

console.log('— C. 落到声音上（有声、标签也对）—')

check('声音桥：pending 映射到 fail 那一段音效',
  /else if \(a\.kind === 'pending'\) void playRole\('fail', false, '待确认'\)/.test(sound) &&
  /if \(a\.kind === 'done'\) void playRole\('done'\)/.test(sound) &&
  /else void playRole\('fail'\)/.test(sound))

check('起音仍走 scheduleAlertKick（隐藏标签页也能响，不被 rAF 冻结吞掉）',
  /scheduleAlertKick\(\(\) => \{[\s\S]{0,500}?playRole\('fail', false, '待确认'\)/.test(sound))

check('playRole 支持 label 覆盖，且默认标签不变（试听路径不受影响）',
  /export async function playRole\(role: SoundRole, force = false, label\?: string\): Promise<void> \{/.test(sound) &&
  /setPlaying\(label \?\? \(role === 'done' \? '完成' : '中断'\)\)/.test(sound))

console.log('— D. 不误伤别的机制 —')

check('自动继续只认 fail（新增 pending 不会触发自动发消息）',
  /if \(a\.kind !== 'fail'\) \{/.test(cont) &&
  /noteUserActivity\(a\.sessionId\)\s*\n\s*return/.test(cont))

check('用户一操作就停（答完弹窗，铃声不会响不停）',
  /const INTERACTION_EVENTS = \['pointerdown', 'keydown', 'touchstart', 'wheel'\] as const/.test(sound) &&
  /function onUserInteraction\(\): void \{[\s\S]{0,200}?stopSound\(\)/.test(sound))

check('自检已接入 pnpm test 链',
  pkg.scripts['test:pending-alert'] !== undefined && pkg.scripts.test.includes('test:pending-alert'))

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)