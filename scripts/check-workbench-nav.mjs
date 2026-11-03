/**
 * 工作台导航穿透自检（源码断言 + 宿主源码锚定，不需要浏览器）。
 *
 *   node scripts/check-workbench-nav.mjs
 *
 * 需求原话：「左侧边栏的呼吸灯……当在左侧栏中点击了插件、便笺等内容之后，
 * 再次去点击这个呼吸灯（或者包裹图标）时，会没有效果，不能切换，请加强。」
 *
 * 根因（读宿主 dsh-client-ui-layout 源码核对）：宿主主区域是 keyed main 槽，
 * activePanelId 非 null（'plugins' / 'schedules'…）时渲染全局面板、Conversation
 * 整个卸载 —— 对话 tab 条从 DOM 消失，而本插件的导航只操作 conversation.view
 * 层（写偏好 + 点 tab），够不到顶级页面，于是「点了没反应」。
 *
 * 这里钉五件事：
 *   1. sessions.ts 有 activeHostPanelId（读 layout.panelInfo 快照）与
 *      ensureConversationSurface（selectPanel(null) 回对话页）；
 *   2. 四个导航入口全部先穿透：openControlRoom / enterProjectWorkbench /
 *      openProjectCenterList / switchToView；
 *   3. openControlRoom 支持 target 意图屏（全局面板下「回上次的屏」而非机械交替）；
 *   4. ControlRoomEntry 轮询 panelInfo 判定 offSurface，并把它传给 openControlRoom；
 *   5. 宿主源存在时锚定 layout.selectPanel(null) 语义与 panelInfo 的快照契约。
 */
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'

const root = dirname(import.meta.url)
const read = (p) => readFileSync(join(root, p), 'utf8')

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

const sessions = read('client/src/panel/sessions.ts')
const entry = read('client/src/panel/ControlRoomEntry.tsx')

// —— 1. 穿透函数本体 ——
check('sessions.ts 定义 activeHostPanelId（读 layout.panelInfo 快照）',
  /export function activeHostPanelId\(/.test(sessions)
  && /readService<any>\(ctx, 'layout'\)\?\.panelInfo/.test(sessions))
check('activeHostPanelId 读取 activePanelId 并归一化为 null',
  /snap\?\.activePanelId/.test(sessions) && /return id == null \? null : String\(id\)/.test(sessions))
check('sessions.ts 定义 ensureConversationSurface（selectPanel(null) 回对话页）',
  /export function ensureConversationSurface\(ctx: any\): boolean \{/.test(sessions)
  && /layout\.selectPanel\(null\)/.test(sessions))
check('selectPanel 前判定已在对话页（幂等：active === null 直接跳过）',
  /if \(active === null\) return false/.test(sessions))
check('selectPanel 调用有 try/catch（失败只 warn，不炸导航）',
  /try \{\s*\n\s*layout\.selectPanel\(null\)/.test(sessions))

// —— 2. 四个入口都先穿透 ——
for (const [name, pattern] of [
  ['openControlRoom', /export function openControlRoom\(target\?: 'list' \| 'desk'\): boolean \{[^]*?ensureConversationSurface\(ctx\)/],
  ['enterProjectWorkbench', /export function enterProjectWorkbench\([^]*?\{[^]*?ensureConversationSurface\(getClientContext\(\)\)/],
  ['openProjectCenterList', /export function openProjectCenterList\(\): boolean \{[^]*?ensureConversationSurface\(ctx\)/],
  ['switchToView', /export function switchToView\([^]*?\{[^]*?ensureConversationSurface\(getClientContext\(\)\)/],
]) {
  check(`导航入口先穿透：${name}`, pattern.test(sessions))
}

// —— 3. openControlRoom 的 target 意图屏 ——
check('openControlRoom 接受 target 意图屏（全局面板下回上次的屏）',
  /target \?\? \(getLiveScreen\(\) === 'list' \? 'desk' : 'list'\)/.test(sessions))

// —— 4. 呼吸灯入口的「回家」语义 ——
check('ControlRoomEntry 维护 offSurface（是否停在宿主全局面板）',
  /const \[offSurface, setOffSurface\] = useState\(false\)/.test(entry))
check('offSurface 来自 activeHostPanelId 的周期探测',
  /setOffSurface\(activeHostPanelId\(getClientContext\(\)\) !== null\)/.test(entry)
  && /window\.setInterval\(probe, 500\)/.test(entry))
check('全局面板下点击 = 回上次的屏（offSurface ? screen : 交替）',
  /offSurface \? screen : \(screen === 'list' \? 'desk' : 'list'\)/.test(entry))
check('点击把意图屏传给 openControlRoom(target)',
  /openControlRoom\(target\)/.test(entry))

// —— 5. 宿主源锚定（存在才校验，不强绑机器路径） ——
let hostLayout = null
for (const base of [join(homedir(), '.dsh', 'profiles', 'x.js'), join(root, 'x.js')]) {
  try {
    const req = createRequire(base)
    hostLayout = join(dirname(req.resolve('@deepseek-ai/dsh-client-ui-layout/package.json')), 'lib/client.js')
    break
  } catch { /* 下一个候选 */ }
}
if (hostLayout && existsSync(hostLayout)) {
  const src = readFileSync(hostLayout, 'utf8')
  check('宿主 layout.selectPanel(null) = 回到 Conversation（官方语义）',
    src.includes('Select a global panel or return to the Conversation'))
  check('宿主 main 槽是 keyed 且 activePanelId 驱动（呼吸灯失效的根因存在）',
    src.includes('activePanelId') && src.includes('entryKey'))
  check('宿主 panelInfo 是可快照/可订阅的共享源（getSnapshot + subscribe）',
    src.includes('getSnapshot: () => instance.getSnapshot().panelInfo')
    && src.includes('subscribe: (listener) => instance.subscribe(listener)'))
} else {
  console.log('SKIP  宿主 dsh-client-ui-layout 包不可解析，跳过源码锚定校验')
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exitCode = fail === 0 ? 0 : 1
