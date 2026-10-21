/**
 * 「移除项目」两条增强的自检（源码正则断言，不需要浏览器）。
 *
 *   node scripts/check-project-remove.mjs
 *
 * 锁死这次改动的**安全与固化口径**——改代码时最容易顺手改坏的：
 *   A. 弹窗的「删除项目源代码」可选项：
 *      1. 勾选后才删盘，且删盘失败必须中断（项目保持原样，不能既没删成又从清单消失）；
 *      2. 服务端删除通道闸门最多：绝对路径 / 必须是目录 / 拒绝符号链接 /
 *         受保护根（HOME、~/.dsh、cwd、tmp）拒绝 / 根目录拒绝；
 *      3. 长操作要锁按钮（busy），确认按钮文案随勾选变化。
 *   B. 移除固化（防复活）：
 *      1. 移除必须记「墓碑」（id + 归一路径），本地 localStorage + 服务端
 *         projects.removed.json 各一份；
 *      2. 服务端并集合并、GET 下发、按路径/按 id 的显式删除、恢复名单全部尊重墓碑；
 *      3. 自动登记（addProjectAuto）对墓碑路径一律拒绝——用户手动「添加项目」才可恢复；
 *      4. 本地缓存读取与水合对账都要过滤墓碑（「恢复」以服务端注册表为准）。
 *   C. 删盘「真的删掉了」（用户反馈：勾了删除、code/test 还在）：
 *      1. 删完必须复核目录真的不在（确认 → 退避重删 → 再确认）；
 *      2. 复核不过就 500 + ok:false —— 宁可不移除，也不能「既没删干净又从清单消失」；
 *      3. 不许把已移除项目的目录再 mkdir 回来（探索者会话的 cwd 守卫）；
 *      4. 弹窗文案要写明「连文件夹本身一起删」——旧文案只说「该文件夹下的全部内容」，
 *         读起来像是只清空内容、留下空文件夹。
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

const route = readFileSync(join(root, 'src/board-web-route.ts'), 'utf8')
const api = readFileSync(join(root, 'client/src/panel/api.ts'), 'utf8')
const store = readFileSync(join(root, 'client/src/panel/store.ts'), 'utf8')
const sessions = readFileSync(join(root, 'client/src/panel/sessions.ts'), 'utf8')
const center = readFileSync(join(root, 'client/src/panel/ProjectCenter.tsx'), 'utf8')
const dialog = readFileSync(join(root, 'client/src/panel/ConfirmDialog.tsx'), 'utf8')
const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const explorer = readFileSync(join(root, 'src/session/create-explorer-session.ts'), 'utf8')

console.log('— A. 删除项目源代码（服务端闸门）—')

check('独立路由常量（POST /project-delete）',
  /export const PROJECT_DELETE_ROUTE_PATH = '\/plugins\/dsh-tokensave\/project-delete'/.test(route))

check('已登记进 writeRoutes 且 POST-only（危险写通道不进只读闸门）',
  /\[PROJECT_DELETE_ROUTE_PATH, projectDeleteGuard\]/.test(route) &&
  /if \(req\.method !== 'POST'\) return methodNotAllowed\(res\)[\s\S]{0,80}handleProjectDelete\(req, res\)/.test(route))

check('只接受绝对路径，且必须是已存在目录',
  /!raw \|\| !path\.isAbsolute\(raw\)/.test(route) &&
  /项目路径必须是绝对路径/.test(route) &&
  /项目路径不是文件夹/.test(route))

check('拒绝符号链接（lstat 判定，不删链接背后的真身）',
  /fs\.lstatSync\(target\)/.test(route) &&
  /stat\.isSymbolicLink\(\)/.test(route) &&
  /项目路径是符号链接，拒绝删除/.test(route))

check('受保护根拒绝（目标包含 HOME / ~/.dsh / cwd / tmp 一律 403）',
  /function protectedRoots\(\)/.test(route) &&
  /dshHomeDir\(\)/.test(route) &&
  /process\.cwd\(\)/.test(route) &&
  /os\.tmpdir\(\)/.test(route) &&
  /function isInsideOrEqual\(/.test(route) &&
  /function assertDeletableTarget\(/.test(route) &&
  /拒绝删除：目标包含受保护目录/.test(route) &&
  /拒绝删除文件系统根目录/.test(route))

check('递归删除 + 目录已不存在时返回 gone（幂等，不拦移除流程）',
  /fs\.rmSync\(target, \{ recursive: true/.test(route) &&
  /gone: true/.test(route) &&
  /gone: false/.test(route))

check('os 模块已引入（tmpdir 保护根用）', /import os from 'node:os'/.test(route))

console.log('— A. 删除项目源代码（客户端弹窗）—')

check('弹窗有「同时删除项目源代码」复选框 + 独立状态',
  /const \[deleteSource, setDeleteSource\] = useState\(false\)/.test(center) &&
  /className="ts-confirm-opt"/.test(center) &&
  /同时<b>删除项目源代码<\/b>/.test(center))

check('勾选后提示语切换为「永久删除 / 不可恢复」',
  /ts-confirm-note-warn/.test(center) &&
  /永久删除/.test(center) &&
  center.includes('不可恢复'))

check('确认按钮文案随勾选变化 + busy 锁按钮',
  /confirmText=\{deleteSource \? '删除并移除' : '确认移除'\}/.test(center) &&
  /busy=\{removing\}/.test(center) &&
  /if \(!pendingRemove \|\| removing\) return/.test(center))

check('先删盘成功才固化移除；删盘失败中断（项目保持原样）',
  /deleteProjectSource\(victim\.path\)/.test(center) &&
  /\.then\(\(\) => \{[\s\S]{0,200}removeProject\(victim\.id\)/.test(center) &&
  /删除源代码失败/.test(center) &&
  /项目未移除/.test(center))

check('ConfirmDialog 支持 busy（禁用两个按钮）',
  /busy\?: boolean/.test(dialog) &&
  /disabled=\{busy\}/.test(dialog))

check('api.ts 导出 deleteProjectSource 且路径与后端一致',
  /export async function deleteProjectSource\(path: string\)/.test(api) &&
  /fetch\('\/plugins\/dsh-tokensave\/project-delete', \{/.test(api) &&
  /if \(!res\.ok\) throw new Error/.test(api))

check('复选框样式齐全（危险描边卡 + 红色 accent）',
  /\.ts-confirm-opt \{/.test(styles) &&
  /\.ts-confirm-opt input\[type="checkbox"\] \{/.test(styles) &&
  /\.ts-confirm-note-warn \{/.test(styles))

console.log('— B. 移除固化（墓碑）—')

check('服务端墓碑文件（projects.removed.json）读写齐备',
  /projects\.removed\.json/.test(route) &&
  /function readRemovedFile\(\)/.test(route) &&
  /function writeRemovedFile\(/.test(route) &&
  /原子替换/.test(route))

check('GET /projects 一并下发墓碑（客户端本机也要拦）',
  /\.\.\.state, removed: readRemovedFile\(\)/.test(route) &&
  /removed: ServerRemovedEntry\[\]/.test(api) &&
  /removed: \(Array\.isArray\(data\.removed\) \? data\.removed : \[\]\)/.test(api))

check('并集合并尊重墓碑（旧快照回推无法复活已移除项目）',
  /tombstones: RemovedEntry\[\] = \[\],/.test(route) &&
  /const blocked = \(p: StoredProject\) => tombstones\.some\(\(t\) => tombstoneHits\(t, p\)\)/.test(route) &&
  /if \(blocked\(p\)\) continue/.test(route))

check('写通道解析 removedPaths / restorePaths 并维护墓碑',
  /const removedIds = stringList\(parsed\.removed\)/.test(route) &&
  /stringList\(parsed\.removedPaths\)/.test(route) &&
  /stringList\(parsed\.restorePaths\)/.test(route) &&
  /writeRemovedFile\(tombstones\)/.test(route))

check('墓碑按 id 或归一路径任一命中',
  /function tombstoneHits\(entry: RemovedEntry, p: StoredProject\): boolean/.test(route) &&
  /entry\.id === p\.id/.test(route) &&
  /entry\.path === p\.path/.test(route))

check('store：墓碑存储（localStorage）+ id/路径双口径判定',
  /tokensave:projects-removed\.v1/.test(store) &&
  /export interface RemovedTombstone \{/.test(store) &&
  /export function isProjectTombstoned\(id: string, path: string\): boolean/.test(store) &&
  /export function isPathTombstoned\(path: string\): boolean/.test(store) &&
  /function normProjectPath\(raw: string\): string/.test(store))

check('store：removeProject 记墓碑并随推送上报（id + 路径）',
  /const victim = list\.find\(\(p\) => p\.id === id\)/.test(store) &&
  /addTombstones\(\[\{ id: victim\.id, path: normProjectPath\(victim\.path\)/.test(store) &&
  /removedPaths: \[victim\.path\]/.test(store))

check('store：手动「添加项目」= 恢复（清墓碑 + restorePaths 上报）',
  /const restored = isPathTombstoned\(path\)/.test(store) &&
  /if \(restored\) clearTombstonesForPaths\(\[path\]\)/.test(store) &&
  /restorePaths: \[path\]/.test(store))

check('store：本地缓存读取即过滤墓碑（防复活第一环）',
  /normalizeProjects\(JSON\.parse\(raw\)\)\.filter\(\(p\) => !isProjectTombstoned\(p\.id, p\.path\)\)/.test(store))

check('store：水合对账（服务端墓碑 ∪ 本机墓碑；恢复以服务端注册表为准）',
  /const aliveKeys = new Set<string>\(\)/.test(store) &&
  /const serverTombstones = \(Array\.isArray\(payload\.removed\) \? payload\.removed : \[\]\)/.test(store) &&
  /!\(t\.id && aliveKeys\.has\(t\.id\)\) && !\(t\.path && aliveKeys\.has\(t\.path\)\)/.test(store) &&
  /saveTombstones\(tombstones\)/.test(store) &&
  /\.filter\(\(p\) => !blocked\(p\)\)/.test(store))

check('store：publishProjects 透传 removedPaths / restorePaths',
  /extra: \{ removedPaths\?: string\[\]; restorePaths\?: string\[\] \} = \{\},/.test(api) &&
  /JSON\.stringify\(\{ projects, removed, \.\.\.extra \}\)/.test(api))

check('sessions：自动登记走 addProjectAuto（墓碑路径拒绝复活）',
  /export function addProjectAuto\(name: string, path: string\): ProjectRecord \| undefined/.test(store) &&
  /if \(isPathTombstoned\(path\)\) return undefined/.test(store) &&
  /return addProjectAuto\(name, row\.path\)/.test(sessions) &&
  !/return addProject\(name, row\.path\)/.test(sessions))

check('publishProjects 的 extra 参数在 store 侧透传',
  /function pushProjects\(list: ProjectRecord\[\], removed: string\[\] = \[\], extra: PushExtra = \{\}\): void/.test(store) &&
  /publishProjects\(snapshot, ids, extra\)/.test(store))

console.log('— C. 删盘复核（「勾了删除、文件夹还在」的收口）—')

check('服务端：删完先确认目录真的不在，才报成功（gone / verified 两个标记）',
  /for \(let attempt = 0; attempt < 3 && fs\.existsSync\(target\); attempt\+\+\)/.test(route) &&
  /verified: true/.test(route) &&
  /verified: false/.test(route))

check('服务端：复核重删用 force:true（已不在也不报错）并退避重试',
  /await new Promise\(\(resolve\) => setTimeout\(resolve, 150\)\)/.test(route) &&
  /fs\.rmSync\(target, \{ recursive: true, force: true, maxRetries: 2, retryDelay: 100 \}\)/.test(route))

check('服务端：复核不过就 500 + ok:false（客户端据此不把它从清单里抹掉）',
  /writeJson\(res, 500, \{\s*ok: false,/.test(route) &&
  /目录仍然存在：删除没有真正生效/.test(route) &&
  /if \(!pendingRemove \|\| removing\) return/.test(center) &&
  /项目未移除/.test(center))

check('服务端：墓碑只读查询（isRemovedProjectPath）—— 禁止把已删目录造回来',
  /export function isRemovedProjectPath\(raw: string\): boolean/.test(route) &&
  /readRemovedFile\(\)\.some\(\(t\) => Boolean\(t\.path\) && t\.path === target\)/.test(route))

check('探索者建会话前不再 mkdir 已移除项目的 cwd（移除不再是「删了又回来」）',
  /import \{ isRemovedProjectPath \} from '\.\.\/board-web-route\.ts'/.test(explorer) &&
  /if \(isRemovedProjectPath\(opts\.cwd\)\) \{/.test(explorer) &&
  /\} else \{\s*\n\s*await mkdir\(opts\.cwd, \{ recursive: true \}\)/.test(explorer) &&
  /跳过 mkdir（不把删掉的目录造回来）/.test(explorer))

check('弹窗文案写明「连文件夹本身一起删」（旧文案只说“文件夹下的全部内容”）',
  /整个文件夹/.test(center) &&
  /把项目文件夹从磁盘上整棵删掉/.test(center) &&
  !/该文件夹下的<b>全部内容<\/b>/.test(center))


check('自检已接入 pnpm test 链', pkg.scripts['test:project-remove'] !== undefined && pkg.scripts.test.includes('test:project-remove'))

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
