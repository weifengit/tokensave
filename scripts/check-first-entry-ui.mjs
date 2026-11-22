/**
 * 首次进入界面 / 侧边栏入口 / 皮肤格子 / 添加项目弹窗 —— 五条反馈的回归护栏。
 *
 *   node scripts/check-first-entry-ui.mjs
 *
 * 钉的都是**容易被下次改动无意破坏**的口径：
 *   1. 首次进入：主侧栏收起 + 面板区（预览 & 主对话相邻）+ 辅助侧栏（三块竖排）；
 *   2. 侧边栏入口：线条图标（无 emoji）+ **自己注入样式**（否则启动时是半截宽的空框）；
 *   3. 皮肤格子：min-width 不能是硬下限（否则低分辨率下被拆成一行一个）；
 *   4. 添加项目弹窗：两列 + 弹窗本体**不纵向滚动**；
 *   5. Windows：装了 gh 却报「未安装」的坑（按安装位置找）。
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

const dock = readFileSync(join(root, 'client/src/panel/DeskDock.tsx'), 'utf8')
const entry = readFileSync(join(root, 'client/src/panel/ControlRoomEntry.tsx'), 'utf8')
const dialog = readFileSync(join(root, 'client/src/panel/AddProjectDialog.tsx'), 'utf8')
const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
const icons = readFileSync(join(root, 'client/src/panel/icons.ts'), 'utf8')
const ghCli = readFileSync(join(root, 'src/gh-cli.ts'), 'utf8')
const route = readFileSync(join(root, 'src/board-web-route.ts'), 'utf8')
const layoutSrc = readFileSync(join(root, 'client/src/panel/desk-first-layout.ts'), 'utf8')

console.log('— 1. 首次进入的界面布局 —')

check('两套首次进入布局：唯一权威源是 desk-first-layout.ts（纯模块）',
  // 两套表都在纯模块里（不再散落在 DeskDock 的 buildDefault / reconcile / ensureById）
  /const LAYOUT_WITH_PREVIEW: DeskLayout = \{/.test(layoutSrc) &&
  /const LAYOUT_NO_PREVIEW: DeskLayout = \{/.test(layoutSrc) &&
  /export function layoutFor\(hasPreview: boolean\): DeskLayout/.test(layoutSrc) &&
  // DeskDock 只调纯函数，不再自带一份表
  /import \{ layoutFor, regionOfKind, stackAnchorOf \} from '\.\/desk-first-layout'/.test(dock) &&
  !/const KIND_REGION_WITH_PREVIEW/.test(dock) && !/const KIND_REGION:/.test(dock))

check('有预览：面板区只放预览，4 个窗口全在辅助侧栏',
  /layout\.region\.preview === 'center'|preview: 'center'/.test(layoutSrc) &&
  // 有预览那套表里 chat/board/talk/save 都是 right
  /WITH_PREVIEW: DeskLayout = \{\s*region: \{ preview: 'center', chat: 'right', board: 'right', talk: 'right', save: 'right' \}/.test(layoutSrc) &&
  /stack: \{ chat: undefined, board: 'chat', talk: 'board', save: 'talk' \}/.test(layoutSrc))

check('无预览：主对话占面板区，三个面板在辅助侧栏',
  /NO_PREVIEW: DeskLayout = \{\s*region: \{ preview: 'center', chat: 'center', board: 'right', talk: 'right', save: 'right' \}/.test(layoutSrc) &&
  /stack: \{ board: undefined, talk: 'board', save: 'talk' \}/.test(layoutSrc))

check('主侧栏首次进入默认收起（只在没进过这个项目时）',
  /const DEFAULT_HIDDEN_REGIONS: Region\[\] = \['left'\]/.test(dock) &&
  /function readInitialHiddenRegions/.test(dock) &&
  // 用户自己存过偏好就一律按偏好（哪怕是「全展开」）
  /const stored = readHiddenRegions\(projectId\)\s*\n\s*if \(stored\.length\) return stored/.test(dock) &&
  /FIRST_ENTRY_KEY = \(projectId: string\) => `tokensave:desk-first-entry\.v1:\$\{projectId\}`/.test(dock) &&
  /useState<Region\[\]>\(\(\) => readInitialHiddenRegions\(project\.id\)\)/.test(dock))

check('「恢复默认布局」也回到内置收起区（不是全展开）',
  /applyRegions\(DEFAULT_HIDDEN_REGIONS\)/.test(dock))

check('预览归位迁移改成「预览独占面板区 + 主对话搬去辅助侧栏」',
  /\/\/ ① 预览归位到面板区/.test(dock) &&
  /\/\/ ② 主对话若还在面板区/.test(dock) &&
  /if \(chatHome && chatHome !== 'right'\) \{/.test(dock))

console.log('— 2. 左侧边栏入口（图标 + 外框宽度）—')

check('入口图标改线条（不再用 emoji 🧭 / 🗂️）',
  /iconSvg\(toDesk \? 'compass' : 'folder', 15\)/.test(entry) &&
  !/🧭/.test(entry) && !/🗂/.test(entry) &&
  // 图标本体在共享的 icons.ts
  /compass: '<circle cx="12" cy="12" r="8\.5"/.test(icons) &&
  /folder: '<path d="M3\.5 7\.5a2 2 0 0 1 2-2h4l2 2\.5/.test(icons))

check('入口**自己注入样式**（DSH 刚启动时其它视图还没挂载 → 否则是半截宽的空框）',
  /import \{ injectProjectCenterStyles \} from '\.\/styles'/.test(entry) &&
  /useEffect\(\(\) => \{ injectProjectCenterStyles\(\) \}, \[\]\)/.test(entry))

check('入口外框撑满侧栏宽度（width:100%，不留半截）',
  /\.ts-side-entry \{[^}]*width:100%/.test(styles) &&
  // 宿主 footerActions 在我们注册后改成纵向（否则并排 → 只占一半）
  /\[class\*="footerActions"\]:has\(\.ts-side-entry\) \{ flex-direction:column/.test(styles))

console.log('— 3. 背景皮肤格子（低分辨率不拆成一行一个）—')

check('皮肤格子 min-width 为 0（硬下限会让低分辨率下变成一行一个）',
  /\.ts-skin-cell \{ flex: 1 1 46%; min-width: 0;/.test(dock) &&
  /\.ts-skin-pop \.ts-skin-cell \{ flex:1 1 46%; min-width:0;/.test(styles) &&
  // 旧写法（min-width:96px / 88px）不得复活
  // 旧写法（min-width:96px / 88px）不得复活（只看 CSS 规则，不看注释里提到的字样）
  !/min-width: ?96px;/.test(dock) && !/min-width: ?88px;/.test(styles))

check('皮肤格子仍按百分比基准两列排（flex-basis 46%）',
  /\.ts-skin-cell \{ flex: 1 1 46%/.test(dock) &&
  /\.ts-skin-pop \.ts-skin-cell \{ flex:1 1 46%/.test(styles))

console.log('— 4. 添加项目弹窗（不纵向滚动 + 两列 UI）—')

check('弹窗本体不滚动（内容超出时各列自己滚）',
  /\.ts-modal-addproj \.ts-modal-body \{ flex:1 1 auto; min-height:0; overflow:hidden; \}/.test(styles) &&
  /\.ts-modal-addproj \{[^}]*height:min\(620px,90vh\)/.test(styles))

check('两列布局：左目录浏览器 / 右表单（比例列宽，不用写死 px）',
  /\.ts-addproj-body \{ display:grid; grid-template-columns:minmax\(0,1\.05fr\) minmax\(0,1fr\)/.test(styles) &&
  /\.ts-addproj-col \{[^}]*min-width:0;[^}]*min-height:0;[^}]*overflow:auto/.test(styles) &&
  /className="ts-addproj-col ts-addproj-col-left"/.test(dialog) &&
  /className="ts-addproj-col ts-addproj-col-right"/.test(dialog))

check('目录列表占满剩余高度（内部滚动，不写死 260px）',
  /\.ts-addproj-col-left \.ts-fs-list \{ flex:1 1 auto; height:auto; min-height:120px; overflow:auto; \}/.test(styles) &&
  /\.ts-addproj-picker \{ flex:1 1 auto; min-height:0; display:flex; flex-direction:column; \}/.test(styles) &&
  /className="ts-addproj-picker"/.test(dialog))

check('窄屏退化成单列（两列上下排，仍不滚动）',
  /@media \(max-width: 780px\) \{/.test(styles) &&
  /\.ts-addproj-body \{ grid-template-columns:minmax\(0,1fr\); grid-template-rows:auto minmax\(0,1fr\) minmax\(0,1fr\); \}/.test(styles))

check('弹窗里的目录项用线条图标（不再用 emoji 📁）',
  // 只看 JSX（文件头注释里提到旧图标不算）
  !/📁/.test(dialog) && !/🖥/.test(dialog) && !/✏️/.test(dialog) &&
  // 目录项：图标 + 名称（图标必须在名字前面）
  /<Icon name="folder" size=\{13\} \/> \{entry\.name\}/.test(dialog) &&
  /<Icon name="folder" size=\{13\} \/>/.test(dialog) &&
  /<Icon name="pencil" size=\{12\} \/>/.test(dialog))

check('「新建文件夹 / 选择当前文件夹」已归到**右列**，且不再占提示文字',
  /className="ts-addproj-folderops"/.test(dialog) &&
  dialog.indexOf('ts-addproj-col-right') < dialog.indexOf('ts-addproj-folderops') &&
  /\.ts-addproj-folderops \{ display:flex; flex-direction:column; gap:8px; flex:none; \}/.test(styles) &&
  /\.ts-addproj-pickbtn \{ flex:none; white-space:nowrap; align-self:flex-start; \}/.test(styles) &&
  // 旧提示文字不得复活（用户明确要求去掉）
  !/浏览到目标文件夹后/.test(dialog) &&
  !/ts-addproj-picked-path/.test(dialog) &&
  // 旧提示「将建在：」也不在界面上（只保留 title）
  !/将建在：/.test(dialog))

check('仓库清单只留**一根**滚动条（外层列藏、内层列表显）',
  // 外层列可滚但滚动条隐藏
  /\.ts-addproj-col-right \{[^}]*overflow-y:auto;[^}]*scrollbar-width:none;/.test(styles) &&
  /\.ts-addproj-col-right::-webkit-scrollbar \{ width:0; height:0; \}/.test(styles) &&
  // 内层列表以 clamp 限高并自带滚动（不再写死 190px，也不会被压成 2px）
  /\.ts-repo-items \{ height:clamp\(140px, 22vh, 200px\); overflow-y:auto;/.test(styles) &&
  !/\.ts-repo-items \{ height:190px/.test(styles))

check('克隆区控件不被压缩（面板矮时不会把选择按钮顶出可视区）',
  /\.ts-clone > \.ts-clone-head,/.test(styles) &&
  /\.ts-clone > \.ts-clone-progress \{ flex:none; \}/.test(styles) &&
  /\.ts-addproj-col-right \.ts-clone \{ flex:none; \}/.test(styles))

console.log('— 6. 呼吸灯面板：对话清单的归档 —')

const entrySrc = readFileSync(join(root, 'client/src/panel/ControlRoomEntry.tsx'), 'utf8')

check('单一归档：每条对话后面有归档图标按钮（无文字）',
  // 三个动作共用 .ts-warn-icon-btn（继续 / 已读 / 归档），靠图标区分
  /className="ts-warn-icon-btn"/.test(entrySrc) &&
  /onArchive\(it\)/.test(entrySrc) &&
  /归档这条对话/.test(entrySrc) &&
  /iconSvg\('archive', 12\)/.test(entrySrc))

check('所有归档：标题行「归档」图标按钮，且与行内同列',
  /onArchiveAll/.test(entrySrc) &&
  /className="ts-warn-headops"/.test(entrySrc) &&
  // 标题行三个槽位（两枚按钮 + 一枚占位），与逐行的三个槽位同宽同位置
  /<span className="ts-warn-slot" aria-hidden="true" \/>/.test(entrySrc) &&
  // 标题行与行内的槽位/按钮同为 22px + 4px 间隔 —— 每列中心严格一致
  /\.ts-warn-slot \{[^}]*width:22px; height:22px/.test(styles) &&
  /\.ts-warn-icon-btn \{[^}]*width:22px; height:22px/.test(styles) &&
  /\.ts-warn-headops \{[^}]*gap:4px/.test(styles))

check('同类图标同列：标题行占位槽在最左（对上行的「继续」列），已读/归档跟在其后',
  // 行内槽位顺序固定为【继续 / 已读 / 归档】；标题行若把两枚按钮挤在前两列，
  // 列就对成了「已读↔继续」，扫一眼就是错位。
  /className="ts-warn-headops">\s*<span className="ts-warn-slot" aria-hidden="true" \/>\s*<button/.test(entrySrc) &&
  // 行内三槽位依次是：可选的继续 → 已读 → 归档
  /className="ts-warn-actions">[\s\S]{0,2400}?标为已读[\s\S]{0,900}?归档这条对话/.test(entrySrc))

check('归档走宿主 uiWorkspace.archiveSession（复用 sessions.ts 的封装）',
  /archiveSession/.test(entrySrc) &&
  /import \{[\s\S]{0,400}?archiveSession[\s\S]{0,200}?\} from '\.\/sessions'/.test(entrySrc) &&
  // 正在运行被拒 → 弹确认框「停止并归档」
  /pendingArchive/.test(entrySrc) &&
  /停止并归档/.test(entrySrc) &&
  // 归档当前会话后留在本项目工作台（不掉回 Hero）
  /stayInProjectAfterArchive/.test(entrySrc))

check('三个动作统一图标按钮 + 固定槽位（不挤压内容、垂直对齐）',
  /\.ts-warn-icon-btn \{[^}]*width:22px; height:22px/.test(styles) &&
  /\.ts-warn-slot \{ flex:none; width:22px; height:22px/.test(styles) &&
  /\.ts-warn-headops \{[^}]*gap:4px/.test(styles) &&
  // 图标在共享 icons.ts，且都是线条 SVG（无 emoji）
  /archive: '<rect x="3\.5" y="4\.5" width="17" height="4\.5"/.test(icons) &&
  /check: '<path d="M4\.5 12\.5l5 5 10-11"\/>/.test(icons) &&
  /play: '<path d="M8 5\.5l11 6\.5-11 6\.5z"\/>/.test(icons) &&
  !/📥/.test(entrySrc))

console.log('— 7. Windows 默认盘符：E → D → C —')

check('盘符优先级 E → D → C，且默认起点取首选盘',
  /const PREFERRED_DRIVES = \['E', 'D', 'C'\] as const/.test(route) &&
  /function fsDefaultRoot\(\): string \| null/.test(route) &&
  // 默认起点先试首选盘（而不是直接跳 HOME / C:）
  /if \(IS_WINDOWS\) \{[\s\S]{0,200}?const preferred = fsDefaultRoot\(\)/.test(route) &&
  // 排序：首选盘在前，其余保持字母序
  /\.sort\(\(a, b\) => rank\(a\.root\) - rank\(b\.root\) \|\| a\.index - b\.index\)/.test(route))

console.log('— 5. Windows：装了 gh 却报「未安装」 —')

check('gh 的位置由 gh-cli.ts 解析（PATH 里没有 → 按安装位置找）',
  /export function resolveGh\(\): string \| null/.test(ghCli) &&
  /execFileSync\(process\.platform === 'win32' \? 'gh\.exe' : 'gh'/.test(ghCli) &&
  // Windows 标准安装位置
  ghCli.includes("'GitHub CLI', 'gh.exe'") && ghCli.includes('ProgramFiles') &&
  ghCli.includes('GH_INSTALL_DIR'))

check('探测不走 shell（绝对路径调，不经 shell → 无注入面）',
  !/shell: true/.test(ghCli) &&
  /execFileSync\(cand, \['--version'\]/.test(ghCli))

check('找不到 gh 时给可读原因（不是「未安装」这种误导说法）',
  /未找到 gh 可执行文件/.test(ghCli) ||
  /未找到 gh 可执行文件/.test(readFileSync(join(root, 'src/board-web-route.ts'), 'utf8')))

check('仓库清单与 token 都走解析出来的 gh 路径',
  /execFileSync\(gh, \[/.test(readFileSync(join(root, 'src/board-web-route.ts'), 'utf8')))

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exitCode = fail === 0 ? 0 : 1
