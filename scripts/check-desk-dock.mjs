/**
 * dockview 工作台自检（Step 13 · 单项目 + dockview 布局，静态 + 结构断言）。
 *
 *   node scripts/check-desk-dock.mjs
 *
 * 钉六件事：
 *   1. 面板集合与真组件（六类面板都是真组件，不是镜像）；
 *   2. 关键机制：portal / defaultRenderer:always / 整块快照 / 布局锁 / 关闭 chips；
 *   3. 单项目语义：项目中心是独立 tab（不在 dock 内）、宿主原生输入条**停靠进**
 *      「DSH 主对话」面板（不自建输入框）、不导航宿主会话、镜头按会话分键；
 *   4. 引擎开关：默认 dockview，flag=grid 一键回退；
 *   5. 数据口径：按项目分桶轮询；
 *   6. 产物包含 dockview（体积门槛）。
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

const panes = readFileSync(join(root, 'client/src/panel/desk-panes.ts'), 'utf8')
const dock = readFileSync(join(root, 'client/src/panel/DeskDock.tsx'), 'utf8')
const composerDock = readFileSync(join(root, 'client/src/panel/composer-dock.ts'), 'utf8')
const chatView = readFileSync(join(root, 'client/src/panel/chat-view.ts'), 'utf8')
const mainChat = readFileSync(join(root, 'client/src/panel/MainChat.tsx'), 'utf8')
const cr = readFileSync(join(root, 'client/src/panel/ControlRoom.tsx'), 'utf8')
const sessSrc = readFileSync(join(root, 'client/src/panel/SessionPicker.tsx'), 'utf8')

// —— 1. 面板集合与真组件 ——
check('固定面板 kind 齐备（纯模块 desk-panes）',
  /KINDS = \['preview', 'board', 'chat', 'talk', 'save'\]/.test(panes))
check('探索者面板为动态 id（<projectId>:exp:<sessionId>）',
  /paneId\(project\.id, `exp:\$\{s\.id\}`\)/.test(dock) && /kind\.startsWith\('exp:'\)/.test(dock))
check('面板内容是真组件（非镜像）：黑板/协作对话/收益/主对话/预览/探索者',
  /<Blackboard workspace=\{project\.path\} \/>/.test(dock) &&
  /<TalkColumn sessionId=\{sid\} explorers=\{data\.explorers\} \/>/.test(dock) &&
  /<SavingsColumn sessionId=\{sid\} explorers=\{data\.explorers\} \/>/.test(dock) &&
  /<MainChat sessionId=\{sid\} \/>/.test(dock) &&
  /<PreviewPanel/.test(dock) && /<ExplorerWindow/.test(dock))

// —— 2. 关键机制 ——
check('面板内容走 createPortal（单棵 React 树，无额外 root）',
  /import \{ createPortal \} from 'react-dom'/.test(dock) && /createPortal\(node, el, id\)/.test(dock))
check('defaultRenderer: always（非激活面板 DOM 不摘，媒体/状态保活）',
  /defaultRenderer:\s*'always'/.test(dock))
check('布局快照（每区一份）+ 300ms 节流写盘',
  /SNAPSHOT_KEY = \(projectId: string\) => `tokensave:desk-dock\.v2:\$\{projectId\}`/.test(dock) &&
  /snap\[rr\] = apis\[rr\]\.toJSON\(\)/.test(dock) && /apis\[r\]\.fromJSON\(/.test(dock) &&
  /if \(saveTimer\) window\.clearTimeout\(saveTimer\)/.test(dock) && /\}, 300\)/.test(dock))
check('布局锁已删（功能 + 显示），面板/分隔条始终可拖',
  /disableDnd: false,/.test(dock) && /dnd: \(\) => apis\.center\.dndCapabilities/.test(dock) &&
  !/readLocked/.test(dock) && !/data-desk-lock/.test(dock) &&
  // 遗留的锁键要清掉，不留孤儿
  /'tokensave:desk-dock-lock\.v1:'/.test(dock))
check('关闭面板可恢复（标题行 chips + ⋯ 菜单的「全部打开」）',
  /data-desk-reopen=\{id\}/.test(dock) && /closedRef/.test(dock) &&
  /＋ \{kindLabel\(id\)\}/.test(dock) && /data-desk-open-all=""/.test(dock))
check('图标标签 + 透明主题（与 info_report 的 dv-intel 对齐）',
  /tabComponent:\s*'iconTab'/.test(dock) && /className:\s*'dv-intel'/.test(dock) &&
  /\.dv-intel \.dv-dockview[^}]*transparent/.test(dock))

// —— 3. Step C：多项目并存 ——
check('面板 id 按项目命名空间（<projectId>:<kind>）',
  /paneId\(project\.id, k\)/.test(dock) && /export function paneId\(projectId: string, kind: string\)/.test(panes) &&
  /export function parsePaneId/.test(panes))
check('项目中心是独立 tab（dock 内无项目开关 / 无回退链接）',
  !/data-desk-open=/.test(dock) && !/data-desk-center/.test(dock) &&
  !/data-desk-back=""/.test(dock) &&
  /PROJECT_CENTER_VIEW_ID/.test(readFileSync(join(root, 'client/src/index.ts'), 'utf8')))
check('布局快照按 projectId 持久化（刷新恢复），且有用户保存的默认布局一份',
  /SNAPSHOT_KEY\(project\.id\)/.test(dock) && /SAVED_KEY\(project\.id\)/.test(dock) &&
  /tryRestore\(SAVED_KEY\(project\.id\)\) \|\| tryRestore\(SNAPSHOT_KEY\(project\.id\)\)/.test(dock))
check('dockview 实例按**项目**重挂（依赖 [project.id] → 换项目载入各自快照）',
  /\}, \[project\.id\]\)/.test(dock) || /\}, \[project\.id\]\)/.test(dock))
check('宿主原生输入条停靠进「DSH 主对话」面板（不自建输入框）',
  /import \{ useDockNativeComposer \} from '\.\/composer-dock'/.test(dock) &&
  /useDockNativeComposer\(chatCellRef, liveIds\.includes\(chatPaneId\), false,/.test(dock) &&
  !/ProjectComposer/.test(dock))
check('停靠实现在独立模块 composer-dock.ts（HDesk 删除后仍可用）',
  /export const COMPOSER_SEAT = '\[data-conversation-region="composer"\]'/.test(composerDock) &&
  /export function useDockNativeComposer\(/.test(composerDock) &&
  // 宽度只受面板约束：不再引用带 680px 下限的宿主宽度 helper
  !/hostContentWidthPx/.test(composerDock))
check('停靠卸载即还原宿主输入条原始行内样式',
  /for \(const k of KEYS\) \(seat\.style as any\)\[k\] = saved\[k\]/.test(composerDock))
check('默认会话只读解析（回退口径）；历史/新建会话按用户点击才导航',
  // 本项目没会话时退回空串（不是宿主那条）——别的项目的会话绝不接进本工作台
  /return latestProjectSession\(ctx, project\.path\)\?\.id \?\? ''/.test(dock) &&
  /if \(!openSession\(id\)\) setSessionError/.test(dock))
check('项目隔离：进工作台时把宿主会话切到本项目会话（草稿/发送不串项目）',
  /rememberOpenedProject\(sid, project\.id\)/.test(dock) &&
  /if \(openSession\(sid\)\) console\.log\('\[tokensave\] 宿主会话已切到本项目会话'/.test(dock) &&
  // 本项目一条会话都没有 → 开一条空白会话再把宿主切过去（否则输入条连着别的项目）
  /void startProjectSession\(project\.path, project\.id, sessionId\)/.test(dock) &&
  /const autoSessionRef = useRef\(false\)/.test(dock))
check('跨区拖拽兜底：落在已有窗口的内容区也能搬（dockview 只在空组才回 onDidDrop）',
  /onWillDragPanel\(\(e: any\) => \{/.test(dock) &&
  /document\.addEventListener\('dragend', onDragEnd, true\)/.test(dock) &&
  /document\.elementFromPoint\(x, y\)\?\.closest\?\.\('\[data-desk-host\]'\)/.test(dock) &&
  /document\.addEventListener\('pointerup', onPointerUp, true\)/.test(dock) &&
  /body\.ts-dock-dragging iframe \{ pointer-events: none !important; \}/.test(dock))
check('镜头按会话分键（A 切镜头不改到 B）',
  /export function useChatView\(scope\?: string\)/.test(chatView) &&
  /scopeKey\(scope\)/.test(chatView) && /useChatView\(sessionId\)/.test(mainChat))

// —— 4. 引擎开关 ——
check('ControlRoom 只渲染 DeskDock（Step D 收口后不再有引擎开关/旧网格分支）',
  /<DeskDock\s/.test(cr) && !/readDeskEngine/.test(cr) && !/<HDesk\s/.test(cr))
check('旧网格机已删除（HDesk / desk-layout 不在仓内）',
  !existsSync(join(root, 'client/src/panel/HDesk.tsx')) &&
  !existsSync(join(root, 'client/src/panel/desk-layout.ts')))

// —— 5. 数据口径 ——
check('探索者按 workspace 8s 轮询（与预览探测同一拍）',
  /fetchExplorers\(project\.path\)/.test(dock) && /8_000/.test(dock) && !/10_000/.test(dock))
check('项目预览探测 + devUrl 可用才建面板（**默认落编辑区**）',
  /fetchProjectInfo\(project\.path\)/.test(dock) && /devUrl/.test(dock) &&
  // 用户要求：进项目就能在编辑区看到预览 → 默认与主对话左右并排
  /if \(data\.devUrl\) addTo\('center', 'preview', \{ direction: 'left', referencePanel: chat \}\)/.test(dock) &&
  // 旧默认（主侧栏）已作废；旧快照里还在主侧栏的由一次性迁移搬过去
  !/addTo\('left', 'preview'\)/.test(dock) &&
  /desk-preview-in-editor\.v1/.test(dock) &&
  // 迁移到位后要**分屏**（否则把主对话盖住 → 输入条悬在预览上）
  /\{ direction: 'left', referencePanel: anchor \}/.test(dock) &&
  /const anchor = paneId\(project\.id, 'chat'\)/.test(dock) &&
  /if \(hit\.region === 'left' \|\| sameGroup\) \{/.test(dock) &&
  // 同区但挤在同一组的（旧版本踩过的坑）先摘下来再按分屏位摆回
  /apis\.center\.removePanel\(hit\.panel\)/.test(dock) &&
  /apis\.center\.addPanel\(paneOptsRef\.current\(pid, pos\)\)/.test(dock))
check('数据只用本项目一份（单项目语义，无跨项目分桶）',
  /setData\(\(prev\) => \(\{ \.\.\.prev, \.\.\.next \}\)\)/.test(dock) || /setData\(\(prev\) => \(\{ \.\.\.prev/.test(dock))
check('自建输入框已删除（ProjectComposer 不在仓内）',
  !existsSync(join(root, 'client/src/panel/ProjectComposer.tsx')))

// —— 7. 拖拽指示 / 区域开关 / 布局存取 / 皮肤（参考 info_report）——
check('拖拽落点指示：主题蓝底 + 蓝描边（官方默认几乎看不见）',
  /--dv-drag-over-background-color: rgba\(79,142,247,\.22\)/.test(dock) &&
  /--dv-drag-over-border-color: #4f8ef7/.test(dock) &&
  /\.dv-intel \.dv-drop-target-anchor[^}]*border: 1px solid var\(--dv-drag-over-border-color\)/.test(dock))
check('拖拽抓手可见性与光标（点击命中反馈）',
  /\.dv-intel \.dv-sash:hover \{ background: rgba\(79,142,247,\.5\)/.test(dock) &&
  /\.dv-intel \.dv-tab \{ cursor: grab/.test(dock))
check('区域开关：主侧栏 / 编辑区面板区 / 辅助侧栏（状态持久化）',
  /data-desk-region-toggle=\{r\}/.test(dock) && /hiddenRegions/.test(dock) &&
  /localStorage\.setItem\(REGIONS_KEY/.test(dock) && /data-hide-left=\{hiddenRegions\.includes\('left'\)/.test(dock))
check('区域收起不销毁面板（列宽塌陷；同 info_report 的 hide-panel）',
  /data-hide-left=\{hiddenRegions\.includes\('left'\) \? '' : undefined\}/.test(dock) &&
  /--ts-side-l: 0px/.test(dock) && !/regionSnapshotRef/.test(dock))
check('被收起区域的面板不会被 reconcile 立刻补回（否则收起无效）',
  /const inHidden = \(id: string\) => hiddenRegions\.includes\(defaultRegionOf\(id\)\)/.test(dock) &&
  /if \(inHidden\(id\)\) return/.test(dock))
check('布局：拖动只点亮不自动覆盖；状态栏按钮已合并为「布局 + 恢复」',
  /const saveLayout = useCallback/.test(dock) && /const restoreDefaultLayout = useCallback/.test(dock) &&
  /suppressDirtyRef/.test(dock) && /data-dirty=\{layoutDirty \? '1' : undefined\}/.test(dock))
check('保存/恢复布局是**全局快照**（面板排布 + 收起区 + 侧栏宽度）',
  /interface LayoutSnapshot \{/.test(dock) &&
  /return \{ regions, hidden: \[\.\.\.hiddenRegions\], sideW: \{ \.\.\.sideW \} \}/.test(dock) &&
  /function normalizeSnapshot\(raw: any\): LayoutSnapshot \| null \{/.test(dock) &&
  // 恢复时同时套用保存的收起状态与宽度（旧实现硬把 hidden 清空 → 收起的主侧栏总被拉回来）
  /applyRegions\(snap\?\.hidden \?\? \[\]\)/.test(dock) &&
  /if \(snap\?\.sideW\) applySideW\(snap\.sideW\)/.test(dock) &&
  !/setHiddenRegions\(\[\]\)/.test(dock))
check('皮肤：内置若干套 + 持久化 + 写入 dock 背景',
  /const SKIN_KEY = 'tokensave:desk-skin\.v1'/.test(dock) &&
  /data-desk-set-block="skin"/.test(dock) &&
  /\.\.\.\(skin \? \{ background: skin \} : \{\}\)/.test(dock))

// —— 8. 多区外壳（参考 info_report）——
check('三个 dockview 实例分区：主侧栏 / 编辑区 / 辅助侧栏',
  /const REGIONS = \['left', 'center', 'right'\] as const/.test(dock) &&
  /left: DVC\.createDockview\(hosts\.left/.test(dock) &&
  /center: DVC\.createDockview\(hosts\.center/.test(dock) &&
  /right: DVC\.createDockview\(hosts\.right/.test(dock))
check('CSS Grid 分区 + 区域收起 = 列宽塌陷到 0（不用 removePanel）',
  /grid-template-areas: "title title title" "left center right" "status status status"/.test(dock) &&
  /\.ts-dock\[data-hide-left\] \{ --ts-side-l: 0px; \}/.test(dock))
check('标题行 + 状态栏 + 面板区与编辑区同实例',
  /data-desk-titlebar=""/.test(dock) && /data-desk-statusbar=""/.test(dock) &&
  /addTo\('center', 'board', \{ direction: 'below'/.test(dock))
check('watermark 组件契约完整（element + init + dispose；缺 init 会 TypeError）',
  /createWatermarkComponent: \(\) => \{[\s\S]{0,400}?init\(\) \{/.test(dock) &&
  /createWatermarkComponent: \(\) => \{[\s\S]{0,600}?dispose\(\) \{/.test(dock))
check('跨实例拖拽用**运行时 API 注册**（同 info_report，放构造选项不生效）',
  /apis\[r\]\.onUnhandledDragOver\(\(event: any\) => \{/.test(dock) &&
  /apis\[r\]\.onDidDrop\(\(event: any\) => \{/.test(dock) &&
  /const isForeign = \(data: any, api: any\)/.test(dock))
check('只 accept **外来**载荷（无条件 accept 会搅乱同实例落点判定）',
  /if \(isForeign\(data, apis\[r\]\)\) event\.accept\(\)/.test(dock))
check('空实例预置空组作为落点（否则空区拖不进去）',
  /const ensureDropTarget = \(region: Region\) => \{/.test(dock) &&
  /if \(!api\.groups\.length\)/.test(dock) && /api\.addGroup\(\{ direction:/.test(dock) &&
  /REGIONS\.forEach\(ensureDropTarget\)/.test(dock))
check('开启根级落点容器（dndOverlayMounting；不设则浮层永不显示）',
  /dndOverlayMounting: 'absolute'/.test(dock) && /dndPanelOverlay: 'group'/.test(dock))
check('顶部「项目中心」超链接已移除（恢复入口在项目中心 tab）',
  !/data-desk-back=""/.test(dock))
check('设置浮层锚定在齿轮按钮下方，且**夹在工作台内部**（不会弹到侧边栏上）',
  /const placePop = \(anchor: HTMLElement \| null, width: number\) => \{/.test(dock) &&
  /const minLeft = \(dock \? dock\.left : 0\) \+ 8/.test(dock) &&
  /const left = r/.test(dock) &&
  /const top = r \? r\.bottom \+ 6 : 48/.test(dock) &&
  /style=\{popPos \?\? \{ left: 12, top: 48 \}\}/.test(dock))
check('⋯ 菜单：每窗口一行 + 三个区域按钮（当前区高亮，再点收起）+ 全部打开',
  /data-desk-pop-row=\{id\}/.test(dock) && /data-desk-move=\{id\}/.test(dock) &&
  /if \(cur === r\) closePanel\(id\)/.test(dock) && /data-desk-open-all=""/.test(dock))
check('标题行图标化（区域三键 + 设置齿轮），不再是一堆文字按钮',
  /data-desk-region-toggle=\{r\}/.test(dock) && /data-desk-settings=""/.test(dock) &&
  /iconSvg\('gear', 16\)/.test(dock) && /dangerouslySetInnerHTML/.test(dock))
check('右上角「设置」浮层分三块：显示/隐藏窗口 · 皮肤 · 字体',
  /data-desk-settings-panel=""/.test(dock) &&
  /data-desk-set-block="windows"/.test(dock) &&
  /data-desk-set-block="skin"/.test(dock) &&
  /data-desk-set-block="font"/.test(dock) &&
  /data-desk-font=\{f\.id\}/.test(dock) &&
  /data-desk-font-family=\{f\.id\}/.test(dock))
check('字体调控：字号档位 + 字族写到 :root 变量（各条 CSS 用 var(--ts-fs)）',
  /const FONT_LEVELS = \[/.test(dock) && /const FONT_FAMILIES = \[/.test(dock) &&
  /const FONT_KEY = 'tokensave:desk-font\.v1'/.test(dock) &&
  /function applyFont\(font: FontId, family: FontFamilyId\): void \{/.test(dock) &&
  /root\.setProperty\('--ts-fs'/.test(dock) && /root\.setProperty\('--ts-font'/.test(dock) &&
  /font-family:var\(--ts-font, inherit\)/.test(dock))
check('项目切换面板：列出全部项目 + 标注哪些项目有进行中的对话',
  /const projectList = useMemo\(\(\) => \(projOpen \? loadProjects\(\) : \[\]\)/.test(dock) &&
  /const projectActivity = useProjectsActivity\(projectList\)/.test(dock) &&
  /data-busy=\{running \? '1' : undefined\}/.test(dock) &&
  /ts-projsw-tag run">● 运行中/.test(dock) &&
  /\{!running && !pending \? <span className="ts-projsw-tag idle">无进行中对话/.test(dock) &&
  /if \(!current\) enterProjectWorkbench\(p\.id\)/.test(dock))
check('状态栏承载：实时提示 · 布局(保存) · 恢复 · 会话控件',
  /data-desk-live=""/.test(dock) &&
  /data-desk-layout=""/.test(dock) && /data-desk-layout-default=""/.test(dock) &&
  /<SessionPicker/.test(dock))

// —— 9. 输入条黑覆盖 / 标题行会话控件 ——
const composerDockSrc = readFileSync(join(root, 'client/src/panel/composer-dock.ts'), 'utf8')
check('停靠时清掉宿主 composerSeat 的渐变遮罩（否则聊天区下方一块黑覆盖）',
  /'background',/.test(composerDockSrc) && /'backgroundImage',/.test(composerDockSrc) &&
  /seat\.style\.backgroundImage = 'none'/.test(composerDockSrc) &&
  /seat\.style\.background = 'transparent'/.test(composerDockSrc))
check('保留「滚到输入条上沿看不见底下」：聊天格底部有独立渐变条',
  /data-desk-chat-fade=""/.test(dock) &&
  /\.ts-dock-fade \{[^}]*position:\s*absolute/.test(dock) &&
  /\.ts-dock-fade \{[^}]*height:\s*calc\(var\(--ts-composer-h/.test(dock) &&
  /\.ts-dock-fade \{[^}]*linear-gradient\(to top/.test(dock))
check('卸载时还原 seat 的全部接管样式（含 background）',
  /for \(const k of KEYS\) \(seat\.style as any\)\[k\] = saved\[k\]/.test(composerDockSrc))
check('历史会话 / 新建会话复用 SessionPicker（放在状态栏）',
  /import \{ SessionPicker \} from '\.\/SessionPicker'/.test(dock) &&
  /<SessionPicker/.test(dock) && /useProjectSessions\(project\.path\)/.test(dock) &&
  /startProjectSession\(project\.path, project\.id, sessionId \|\| sid\)/.test(dock) &&
  // 排除当前会话：否则 startProjectSession 会「复用」到当前这条空白会话，
  // 导航到自身 = 什么都没发生（用户反馈的「点新建会话不能新建出来」）
  /const res = await startProjectSession\(project\.path, project\.id, sessionId \|\| sid\)/.test(dock) &&
  /rememberOpenedProject\(res\.id, project\.id\)/.test(dock))
check('工作台主对话跟随**宿主当前会话**（属于本项目且非探索者时）',
  // 旧实现一律取 latestProjectSession → 宿主切到刚新建的空白会话后工作台不跟
  /isExplorerSessionId\(prop\)/.test(dock) &&
  /sessionBelongsToProject\(ctx, prop, project\.path\)/.test(dock) &&
  /return prop/.test(dock))

// —— 10. 浮动面板自动关闭 / 侧栏宽度拖拽 / 菜单与状态栏调整 ——
check('浮动面板：点页面其它位置 / Esc 自动关闭（设置与项目切换两个浮层）',
  /if \(!settingsOpen && !projOpen\) return/.test(dock) &&
  /t\.closest\('\[data-desk-settings-panel\]'\)/.test(dock) &&
  /t\.closest\('\[data-desk-settings\]'\)/.test(dock) &&
  /t\.closest\('\[data-desk-projsw-panel\]'\)/.test(dock) &&
  /t\.closest\('\[data-desk-projswitch\]'\)/.test(dock) &&
  /e\.key === 'Escape'/.test(dock))
check('侧栏宽度可拖拽（同 info_report 的 bindSideResizer 口径）',
  /const SIDE_MIN = 180/.test(dock) && /const SIDE_MAX = 720/.test(dock) &&
  /const COLLAPSE_W = 56/.test(dock) && /const PULL_OUT_W = 12/.test(dock) &&
  /const bindResizer = useCallback/.test(dock) && /data-desk-resizer=\{side\}|data-desk-resizer="left"/.test(dock))
check('拖到很窄自动收起；收起后从边框拉出（两件事成对）',
  /if \(w < COLLAPSE_W\)/.test(dock) && /if \(delta < PULL_OUT_W\) return/.test(dock) &&
  /from = SIDE_MIN[\s\S]{0,80}start = x/.test(dock))
check('拖动只改 DOM（CSS 变量 + data-hide-*），松手才同步一次 React 状态',
  // 拖动期间不 setState：不然每个 pointermove 都重渲染整棵工作台（用户反馈卡顿）
  /root\.style\.setProperty\(varName, `\$\{to\}px`\)/.test(dock) &&
  /root\.style\.removeProperty\(varName\)/.test(dock) &&
  /root\.setAttribute\(attr, ''\)/.test(dock) &&
  /if \(raf\) return/.test(dock) && /requestAnimationFrame\(\(\) => \{/.test(dock) &&
  /applySideW\(\{ \.\.\.sideW, \[side\]: to \}\)/.test(dock) &&
  !/to = clamped/.test(dock))
check('收起时清掉内联宽度（内联优先级高于 .hide-* 的 0px）',
  /hiddenRegions\.includes\('left'\) \? \{\} : \{ \['--ts-side-l' as any\]/.test(dock))
check('收起态把手外移 + 抬 z（压过宿主输入条 35，否则抓手命不中）',
  /\.ts-resizer \{[^}]*z-index: 50/.test(dock) &&
  /\.ts-dock\[data-hide-left\][^}]*z-index: 51/.test(dock))
check('历史会话 / 新建会话在**状态栏**（不在标题行）',
  /data-desk-titlebar[\s\S]{0,3000}<SessionPicker/.test(dock) === false &&
  /data-desk-statusbar[\s\S]{0,2500}<SessionPicker/.test(dock))
check('布局按钮合并：状态栏「布局(保存)」+「恢复」，菜单里不再有恢复默认布局',
  /data-desk-layout=""/.test(dock) && /data-desk-layout-default=""/.test(dock) &&
  !/data-desk-pop-default/.test(dock))
check('菜单：标题行右侧「全部打开」，删掉「关闭菜单」',
  /ts-set-head/.test(dock) && /data-desk-open-all=""/.test(dock) &&
  !/data-desk-pop-close/.test(dock) && !/关闭菜单/.test(dock))

// —— 11. 实时提示 / 会话控件位置 / 预览 / 右键菜单 / 把手视觉 ——
check('状态栏左侧实时显示对话（过程/完成只靠小圆点，不再拼「对话已完成」）',
  /data-desk-live=""/.test(dock) && /subscribeSession\(sid, \(list\) => \{/.test(dock) &&
  // 只压平换行 + 400 字极端兜底，宽度够就多显示（真正的截断交给 CSS 省略号）
  /raw: string, cap = 400/.test(dock) &&
  /slice\(0, cap\)/.test(dock) && /ts-sb-dot/.test(dock) &&
  /gotNotice \? ' · 本轮异常结束' : ''/.test(dock) &&
  // 断言的是**代码**（字符串字面量），注释里可以提这句话
  !/' · 对话已完成'/.test(dock))
check('历史会话浮动面板在状态栏时**向上弹出**（下方没有空间）',
  /const openUp = below < Math\.min\(h, 340\) && above > below/.test(sessSrc) &&
  /bottom: Math\.max\(margin, window\.innerHeight - r\.top \+ gap\)/.test(sessSrc) &&
  /visibility: pos \? undefined : 'hidden'/.test(sessSrc) &&
  // 样式表里写死了 top:calc(100%+6px)，内联必须显式压住它
  /top: pos\?\.top \?\? 'auto'/.test(sessSrc))
check('历史会话 / 新建会话在状态栏右侧，且用线条图标（无 emoji）',
  /<SessionPicker/.test(dock) &&
  /ICON_HISTORY/.test(readFileSync(join(root, 'client/src/panel/SessionPicker.tsx'), 'utf8')) &&
  !/🕘/.test(readFileSync(join(root, 'client/src/panel/SessionPicker.tsx'), 'utf8')))
check('预览面板修复：referencePanel 必须属于**同一个实例**（跨实例引用会抛错）',
  /const hasOwnAnchor = !!apis\[region\]\.panels\.length/.test(dock) &&
  /referencePanel: String\(apis\[region\]\.panels\[0\]\.id\)/.test(dock))
check('右键菜单逃出 transform 层叠上下文（否则 z-index 被困、项被遮挡点不到）',
  /const hoistContextMenu = \(\) => \{/.test(dock) && /document\.body\.appendChild\(menu\)/.test(dock) &&
  /hoistContextMenu\(\)/.test(dock))
check('侧栏把手照 info_report：静止态只是一小段中性短杠，不再铺一整条色块',
  // 命中区透明；可见的 ::after 平时透明、悬停/拖动才上色拉长
  /\.ts-resizer \{[^}]*background: 0 0/.test(dock) &&
  /\.ts-resizer::after \{[\s\S]{0,200}?background: transparent/.test(dock) &&
  /\.ts-resizer:hover::after, body\.ts-resizing \.ts-resizer::after \{ background: rgba\(127,127,127,\.8\); height: 62px/.test(dock) &&
  // 收起态：原地留一条 4×26 小短杠（灰 → 悬停主题蓝），并收起悬停长杠
  /\.ts-resizer::before \{[\s\S]{0,220}?height: 26px/.test(dock) &&
  /:hover::before \{ background: #4f8ef7/.test(dock) &&
  /\.ts-resizer::after \{ display: none/.test(dock) &&
  // 蓝色仍不得出现在 .ts-resizer 自身的规则里
  !/\.ts-resizer \{[^}]*rgba\(79,142,247/.test(dock))

// —— 12. 窗口标题去拟物图标（emoji）——
const titleSrcs = ['MainChat', 'TalkColumn', 'SavingsColumn', 'Blackboard', 'ExplorerWindow', 'PreviewPanel']
  .map((n) => [n, readFileSync(join(root, `client/src/panel/${n}.tsx`), 'utf8')])
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u
check('窗口标题条无拟物 emoji（主对话/协作对话/协作收益/共享黑板/探索者/项目预览）',
  titleSrcs.every(([, src]) => {
    // 取标题元素（ts-head-title / ts-win-name / ts-preview-title）的文本，不能带 emoji
    const m = src.match(/className="(?:ts-head-title|ts-win-name|ts-preview-title)"[^>]*>([^<]*)</)
    return !!m && !EMOJI.test(m[1]) && m[1].trim().length > 0
  }))
check('共享黑板标题行去掉刷新图标按钮（自动 20s 轮询仍在）',
  !/🔄/.test(titleSrcs.find(([n]) => n === 'Blackboard')[1]) &&
  !/title="刷新"/.test(titleSrcs.find(([n]) => n === 'Blackboard')[1]) &&
  /setInterval\(\(\) => load\(true\), 20_000\)/.test(titleSrcs.find(([n]) => n === 'Blackboard')[1]))
check('startProjectSession 导航失败要上报（不能静默成功）',
  /let navigated = false/.test(readFileSync(join(root, 'client/src/panel/sessions.ts'), 'utf8')) &&
  /if \(!navigated\) return \{ ok: false, error: '会话导航服务不可用' \}/.test(
    readFileSync(join(root, 'client/src/panel/sessions.ts'), 'utf8')))

// —— 6. 产物 ——
const dist = join(root, 'dist/client.js')
if (existsSync(dist)) {
  const size = statSync(dist).size
  const src = readFileSync(dist, 'utf8')
  check('产物含 dockview + 本宿主 + 输入条停靠',
    src.includes('.dv-dockview') && src.includes('ts-dock-pane') && src.includes('data-conversation-region'))
  check('产物体积（含 vendor ~709KB）', size > 1_100_000, `${size} 字节`)
} else {
  console.log('SKIP  dist/client.js 不存在（先跑 pnpm build:client）')
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exitCode = fail === 0 ? 0 : 1
