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
const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
const crCenter = readFileSync(join(root, 'client/src/panel/ProjectCenter.tsx'), 'utf8')
const explorerStatus = readFileSync(join(root, 'client/src/panel/explorer-status.ts'), 'utf8')
const sessionsSrc = readFileSync(join(root, 'client/src/panel/sessions.ts'), 'utf8')
const themeSrc = readFileSync(join(root, 'client/src/panel/theme.ts'), 'utf8')
const activitySrc = readFileSync(join(root, 'client/src/panel/activity.ts'), 'utf8')

/**
 * 「已删除」类断言要看**代码**，不能看注释：解释为何删掉的注释里必然会提到被删的
 * 标识符，直接对原文断言就会自己把自己判失败（本轮实测踩过）。
 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const dockCode = stripComments(dock)
const themeCode = stripComments(themeSrc)

// —— 1. 面板集合与真组件 ——
check('固定面板 kind 齐备（纯模块 desk-panes）',
  /KINDS = \['preview', 'board', 'chat', 'talk', 'save'\]/.test(panes))
check('探索者面板为动态 id（<projectId>:exp:<sessionId>）',
  /paneId\(project\.id, `exp:\$\{s\.id\}`\)/.test(dock) && /kind\.startsWith\('exp:'\)/.test(dock))
check('面板内容是真组件（非镜像）：黑板/协作对话/收益/主对话/预览/探索者',
  /<Blackboard workspace=\{project\.path\} \/>/.test(dock) &&
  /<TalkColumn\s+sessionId=\{sid\}\s+explorers=\{data\.explorers\}/.test(dock) &&
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
  // 停靠前的行内样式存在**模块级** WeakMap 里：effect 重跑时局部变量拿不到上一次的
  // saved，enabled→false 那次根本读不到原值（旧写法写回 undefined = 什么都不做）。
  /const PRE_DOCK_STYLES = new WeakMap<HTMLElement, Record<string, string>>\(\)/.test(composerDock) &&
  /let saved = PRE_DOCK_STYLES\.get\(seat\)/.test(composerDock))
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
check('编辑区/面板区也能收起（data-hide-center）',
  /data-hide-center=\{hiddenRegions\.includes\('center'\) \? '' : undefined\}/.test(dock) &&
  /\.ts-dock\[data-hide-center\] \{ grid-template-columns: minmax\(0,var\(--ts-side-l,220px\)\) 0px/.test(dock) &&
  /\.ts-dock\[data-hide-center\] \.ts-region\[data-region="center"\] \{ display: none; \}/.test(dock))
check('移动端（≤900px）：三栏 → 单栏 + 两侧栏改覆盖式抽屉',
  // 断点与远程插件的 mobile presets 一致；中间永远整宽，抽屉同时只开一个
  /@media \(max-width: 900px\) \{/.test(dock) &&
  /\.ts-dock \{ grid-template-columns: 0 minmax\(0,1fr\) 0 !important/.test(dock) &&
  /\.ts-dock\[data-ts-drawer="left"\] \.ts-region\[data-region="left"\] \{ display: block; left: 0; \}/.test(dock) &&
  /\.ts-drawer-mask \{/.test(dock) &&
  // 触屏上 8px 把手拖不动 → 窄屏隐藏，改用区域三键
  /\.ts-dock \.ts-resizer \{ display: none !important; \}/.test(dock) &&
  // JS 侧：matchMedia 判定 + 抽屉状态 + 区域键状态跟抽屉走
  /window\.matchMedia\('\(max-width: 900px\)'\)/.test(dock) &&
  /const \[drawer, setDrawer\] = useState<Region \| null>\(null\)/.test(dock) &&
  /data-ts-drawer=\{drawer \?\? undefined\}/.test(dock) &&
  /const regionShown = \(r: Region\) =>/.test(dock))
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
const skinsSrc = readFileSync(join(root, 'client/src/panel/skins.ts'), 'utf8')
check('皮肤：目录在 skins.ts（分组 + 分类，参考 info_report）+ 写到 :root 变量',
  // 分类：纯色 / 渐变 / 科技 / 艺术（info_report 同款分法），数量至少 15 套
  ['纯色 · 深色', '渐变 · 深色', '科技 · 深色', '艺术 · 深色', '纯色 · 浅色', '渐变 · 浅色'].every((g) => skinsSrc.includes(`group: '${g}'`)) &&
  (skinsSrc.match(/id: '/g) || []).length >= 25 &&
  /SKIN_KEY_LIGHT = 'tokensave:desk-skin-light\.v1'/.test(skinsSrc) &&
  // 不再有「深浅适配开关」：皮肤永远跟随系统/宿主主题
  !/SKIN_ADAPT_KEY/.test(skinsSrc) &&
  /mode: 'dark' | 'light'/.test(skinsSrc) &&
  /export function applySkin/.test(skinsSrc) &&
  /--ts-skin-color/.test(skinsSrc) && /--ts-skin-bg/.test(skinsSrc) &&
  /data-desk-set-block="skin"/.test(dock) &&
  /background-color: var\(--ts-skin-color, var\(--ts-surface\)\); background-image: var\(--ts-skin-bg, none\)/.test(dock) &&
  /SKIN_GROUPS\.filter\(\(g\) =>/.test(dock) &&
  // 没有开关：皮肤永远按当前主题取对应那一栏（用户明确要求）
  !/data-desk-skin-adapt/.test(dock) && !/readAdapt/.test(dock))

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
check('项目切换列表：按最近对话更新时间倒序（越新越靠前）',
  // 时间取宿主会话目录（与活跃点同口径），不是项目自身 updatedAt——用户要的是「对话更新越近的项目越靠前」
  /const projectLastActive = useProjectLastActivity\(projectList\)/.test(dock) &&
  /const sortedProjectList = useMemo\(\(\) => \{/.test(dock) &&
  /projectLastActive\[p\.id\] \|\| p\.updatedAt \|\| p\.createdAt \|\| 0/.test(dock) &&
  /\[\.\.\.projectList\]\.sort\(\(a, b\) => at\(b\) - at\(a\)\)/.test(dock) &&
  // 渲染循环走排序后的列表（未排序的 projectList 只用于计数展示）
  /\{sortedProjectList\.map\(\(p\) => \{/.test(dock) &&
  /useProjectLastActivity/.test(activitySrc))
check('状态栏承载：实时提示 · 布局(保存) · 恢复 · 会话控件',
  /data-desk-live=""/.test(dock) &&
  /data-desk-layout=""/.test(dock) && /data-desk-layout-default=""/.test(dock) &&
  /<SessionPicker/.test(dock))

// —— 9. 输入条黑覆盖 / 标题行会话控件 ——
const composerDockSrc = readFileSync(join(root, 'client/src/panel/composer-dock.ts'), 'utf8')
check('停靠时清掉宿主 composerSeat 的渐变遮罩（否则聊天区下方一块黑覆盖）',
  /'background',/.test(composerDockSrc) && /'backgroundImage',/.test(composerDockSrc) &&
  /seat\.style\.backgroundImage = 'none'/.test(composerDockSrc) &&
  // 座位底色跟主题（深色下 --ts-surface=transparent，与原来等效；浅色下有浅底）
  /seat\.style\.background = 'transparent'/.test(composerDockSrc))
check('聊天格底部不再挂渐变遮罩（会破坏背景一体性）',
  // 删掉原因：消息流自带 padding-bottom（为停靠输入条留位），内容永远不会滑到
  // 输入条底下，那条遮罩从没遮住任何东西，只在聊天区下方糊出一块渐变深色。
  !/data-desk-chat-fade/.test(dockCode) &&
  !/\.ts-dock-fade/.test(dockCode) &&
  // 主题里的渐隐变量也一并清掉，不留无人用的死变量
  !/--ts-fade-from/.test(themeCode) && !/--ts-fade-mid/.test(themeCode) &&
  // 宿主那条跟着输入条搬进来的渐变遮罩仍必须被清掉（那是另一回事）
  /seat\.style\.backgroundImage = 'none'/.test(composerDockSrc))
check('卸载时还原 seat 的全部接管样式（含 background）',
  // 还原口径：有原值就写回，没有就把我们写过的那项清空（回到宿主样式表）；
  // 不能像旧实现那样一律写 saved[k]（undefined 对 CSSStyleDeclaration 等于没写）。
  /for \(const k of KEYS\) \{[\s\S]{0,240}?const v = saved\?\.\[k\]/.test(composerDockSrc) &&
  /\(seat\.style as any\)\[k\] = ''/.test(composerDockSrc))
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
check('侧栏宽度可拖拽（1:1 跟手，无 SIDE_MIN 死区）',
  /const SIDE_MIN = 180/.test(dock) && /const SIDE_MAX = 720/.test(dock) &&
  // 旧版：显示宽度夹在 SIDE_MIN、却等 <56 才收 → 中间 124px 指针在动而宽度不动（用户反馈卡顿）
  /const PULL_OUT_EPS = 3/.test(dock) && /const COLLAPSE_HYST = 8/.test(dock) &&
  !/const COLLAPSE_W/.test(dock) && !/const PULL_OUT_W/.test(dock) &&
  // 宽度连续跟随指针（clamp 到 [SIDE_MIN, SIDE_MAX] 只是端点，不再是提前刹住的死区）
  /to = Math\.min\(SIDE_MAX, Math\.max\(SIDE_MIN, w\)\)/.test(dock) &&
  !/to = Math\.max\(SIDE_MIN, Math\.min\(SIDE_MAX, w\)\)/.test(dock) &&
  /const bindResizer = useCallback/.test(dock) && /data-desk-resizer=\{side\}|data-desk-resizer="left"/.test(dock))
check('拖到最小即收起；收起后拉一点点就出来（两个转折点都重锚）',
  // 展开：往里动 PULL_OUT_EPS(3) 立刻现身；收起：减到 SIDE_MIN 再错开 COLLAPSE_HYST(8)
  /if \(delta < PULL_OUT_EPS\) return/.test(dock) &&
  /if \(w < SIDE_MIN - COLLAPSE_HYST\)/.test(dock) &&
  // 两处都必须重锚指针，否则反向要重走一整段（info_report 记过的「拉一下又弹回」）
  /anchorX = x[\s\S]{0,60}anchorW = SIDE_MIN/.test(dock) &&
  /hidden = true[\s\S]{0,80}anchorX = x[\s\S]{0,60}anchorW = 0/.test(dock))
check('拖动只改 DOM（CSS 变量 + data-hide-*），松手才同步一次 React 状态',
  // 拖动期间不 setState：不然每个 pointermove 都重渲染整棵工作台（用户反馈卡顿）
  /root\.style\.setProperty\(varName, `\$\{to\}px`\)/.test(dock) &&
  /root\.style\.removeProperty\(varName\)/.test(dock) &&
  /root\.setAttribute\(attr, ''\)/.test(dock) &&
  /if \(raf\) return/.test(dock) && /requestAnimationFrame\(\(\) => \{/.test(dock) &&
  // 收起时**不能**把宽度写小：否则双击/拉出展开时只剩十几像素，得重拖一遍
  /applySideW\(\{ \.\.\.sideW, \[side\]: hidden \? sideW\[side\] : to \}\)/.test(dock) &&
  !/applySideW\(\{ \.\.\.sideW, \[side\]: to \}\)/.test(dock) &&
  !/to = clamped/.test(dock))
check('隐藏态双击把手直接展开（拉出来一点点也能）',
  // 只在隐藏时生效：可见态双击不动它，免得手快去拖时被误收起
  /const openSide = useCallback/.test(dock) &&
  /if \(!root \|\| !hiddenRef\.current\.includes\(side\)\) return/.test(dock) &&
  // 恢复到上次记住的宽度（没记过用 SIDE_MIN），而不是写回 0/十几像素
  /const w = Math\.max\(SIDE_MIN, Math\.min\(SIDE_MAX, sideW\[side\]\)\)/.test(dock) &&
  // 双击检测必须在 pointerdown 里自判：本处理器调了 preventDefault()，
  // 而 preventDefault 会连鼠标兼容事件一起算掉 —— 实测 dblclick 一次都不来。
  /const dblClickRef = useRef<null \| \{ side: 'left' \| 'right'; at: number; x: number; y: number \}>\(null\)/.test(dock) &&
  /now - dbl\.at < 300/.test(dock) && /Math\.abs\(dbl\.x - event\.clientX\) <= 4/.test(dock) &&
  /const wasHidden = hiddenRef\.current\.includes\(side\)/.test(dock) &&
  /const openSideRef = useRef<null \| \(\(side: 'left' \| 'right'\) => void\)>\(null\)/.test(dock) &&
  /openSideRef\.current = openSide/.test(dock) && /openSideRef\.current\?\.\(side\)/.test(dock) &&
  // 已改走 pointerdown 自判，组件上不再挂 onDoubleClick（两者共存会重复触发）
  !/onDoubleClick=\{/.test(dock))
check('收起/空白时清掉内联宽度（内联优先级高于 .hide-* 的 0px）',
  // 侧栏不再「无内容自动隐藏」（用户要求改回旧行为：空侧栏也占位、边界可拖开）
  !/emptyRegion/.test(dock) && !/data-empty-/.test(dock) &&
  /hiddenRegions\.includes\('left'\) \? \{\} : \{ \['--ts-side-l' as any\]/.test(dock))
check('区域收起状态按项目分键（不再跨项目传染）',
  /const REGIONS_KEY = \(projectId: string\) => `tokensave:desk-regions\.v1:\$\{projectId\}`/.test(dock) &&
  /localStorage\.setItem\(REGIONS_KEY\(project\.id\)/.test(dock) &&
  /'tokensave:desk-regions\.v1',/.test(dock))
check('标题行脱离列宽约束（收起编辑区后右上按钮不跑左边）',
  /\.ts-titlebar \{ position: absolute; left: 0; right: 0; top: 0; height: 42px/.test(dock) &&
  !/\.ts-titlebar \{ grid-area: title/.test(dock))
check('正文宽度：往外拖永不变窄（max 不低于当前宽度）',
  /Math\.max\(CONTENT_MIN, avail - CONTENT_EDGE_BUDGET, startW\)/.test(mainChat) &&
  // 旧写法只要 max < startW，任何方向的拖动都会把宽度夹小
  !/const max = Math\.max\(CONTENT_MIN, avail - CONTENT_EDGE_BUDGET\)$/.test(mainChat))
check('输入条停靠不会因 enabled 切换而永留 position:fixed',
  /PRE_DOCK_STYLES/.test(composerDock) &&
  /PRE_DOCK_STYLES\.set\(seat, saved\)/.test(composerDock) &&
  /PRE_DOCK_STYLES\.delete\(seat\)/.test(composerDock) &&
  // 退化锚点只认工作台内部的祖先：dockview 摘掉 cell 的那一瞬不能锚到无关盒子
  /if \(!node\.closest\?\.\('\.ts-dock'\)\) continue/.test(composerDock))
check('把手 z-index 压过 dockview sash(99) 与宿主输入条(35)，但低于浮层(110)',
  // 实测：dockview 横向 sash 是 z-index:99，恰好压在把手垂直中点上 —— 原先 50/51
  // 会留下一条 4px 死带（elementFromPoint 命中 sash），双击/拖动都失效。
  /\.ts-resizer \{[^}]*z-index: 100/.test(dock) &&
  /\.ts-dock\[data-hide-left\][^}]*z-index: 101/.test(dock) &&
  /\.ts-dock\[data-hide-right\][^}]*z-index: 101/.test(dock) &&
  // 浮层必须仍压在把手之上（否则把手那条 8px 会盖住浮层左缘，点不中）
  /\.ts-pop \{[^}]*z-index: 110/.test(dock))
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

// —— 12. 手机适配 + 本轮 9 条反馈的回归位（2026-10-14 第二批）——
check('移动端（≤900px）：三栏 → 单栏 + 抽屉（中间永远整宽）',
  /@media \(max-width: 900px\)/.test(dock) &&
  /grid-template-columns: 0 minmax\(0,1fr\) 0 !important/.test(dock) &&
  /data-ts-drawer=\{drawer \?\? undefined\}/.test(dock) &&
  /className="ts-drawer-mask"/.test(dock) &&
  /window\.matchMedia\('\(max-width: 900px\)'\)/.test(dock))
check('输入框不因「主对话是后台标签」被藏掉（info_report / compare-text 的 bug）',
  // 面板可能被拖到任一区，只在 center 里找会误判成「面板不在了」→ 整条藏掉输入条
  /const home = REGIONS\.find\(\(r\) => apis\[r\]\.getPanel\(chatId\)\)/.test(dock) &&
  /const shown = !!home && !hiddenRef\.current\.includes\(home\)/.test(dock) &&
  !/isVisible !== false && !centerHidden/.test(dock))
check('主对话留白 + 阅读宽度（宽面板不拉满）',
  /\.ts-chat-msgs \{ flex:1; min-height:0; overflow:auto; overflow-anchor:none; padding:16px max\(22px, calc\(\(100% - var\(--ts-chat-w, 920px\)\) \/ 2\)\)/.test(styles))
check('状态栏实时信息最多占一半',
  /\.ts-statusbar \.ts-sb-grow \{ flex: 0 1 50%; min-width: 0; \}/.test(dock))
check('项目清单悬浮即开（点击仍可用）',
  /const hoverProj = \(open: boolean\) =>/.test(dock) &&
  /onMouseEnter=\{\(\) => hoverProj\(true\)\}/.test(dock) &&
  /onMouseLeave=\{\(\) => hoverProj\(false\)\}/.test(dock) &&
  /open \? 110 : 260/.test(dock))
check('关掉的窗口不再自己回来（按项目持久化 + reconcile 跳过 + 卸载不记账）',
  /const CLOSED_KEY = \(projectId: string\) => `tokensave:desk-closed\.v1:\$\{projectId\}`/.test(dock) &&
  /if \(closedRef\.current\.has\(id\)\) return/.test(dock) &&
  /closedRef\.current\.add\(id\)\n\s+writeClosed\(project\.id, closedRef\.current\)/.test(dock) &&
  // ⚠️ unregister 里不得再推断「用户关掉了」（dockview 移动/重建/热重载也会 dispose）
  !/closedRef\.current\.add\(id\)[\s\S]{0,120}const unregister/.test(dock) &&
  /const unregister = \(id: string, el: HTMLElement\) => \{\n\s+if \(containersRef\.current\[id\] === el\) \{\n\s+delete containersRef\.current\[id\]/.test(dock))
check('探索者窗口：独立图标 + 去圆角边框 + 标题行无底色',
  /if \(kind\.startsWith\('exp:'\)\) return 'explorers'/.test(panes) &&
  /explorers: '<rect x="4\.5" y="7\.5"/.test(dock) &&
  /\.ts-win \{ border:0; border-radius:0; background:transparent;/.test(styles) &&
  /\.ts-win-head \{ display:flex; align-items:center; gap:6px; padding:6px 8px; border-bottom:1px solid/.test(styles))
check('探索者状态角标（跑 / 异常 / 新汇报）画在标签图标上',
  /export function useExplorerBadges/.test(explorerStatus) &&
  /tone: running \? 'run' : freshNotice \? 'notice' : unread \? 'new' : 'idle'/.test(explorerStatus) &&
  /\.dv-intel \.dv-tab\[data-tone="run"\]::after/.test(dock) &&
  /\.dv-intel \.dv-tab\[data-tone="notice"\]::after/.test(dock) &&
  /content: attr\(data-badge\)/.test(dock) &&
  // dockview 会自己重建标签 DOM，所以要有心跳兜底 + 建标签时补画
  /window\.setInterval\(\(\) => paintRef\.current\(\), 1500\)/.test(dock) &&
  /data-ts-pane/.test(dock))
check('全部停止探索者：宿主 cancel + 标题行按钮 + 主对话结束自动停',
  /export async function stopSession/.test(sessionsSrc) &&
  /get\('conversation'\)/.test(sessionsSrc) && /conv\.cancel\(\)/.test(sessionsSrc) &&
  /data-desk-stop-explorers=""/.test(dock) &&
  /const stopAllExplorers = useCallback/.test(dock) &&
  /autoStopTurnRef\.current !== turnKey/.test(dock))
check('项目中心不再单独设皮肤（皮肤只在工作台里选，两处共用同一份目录/变量）',
  !/data-desk-center-skin/.test(crCenter) &&
  !/SKIN_GROUPS/.test(crCenter) &&
  /installThemeCss\(\)/.test(crCenter) &&
  /background-color: var\(--ts-skin-color, transparent\);/.test(styles))

// —— 13. 浅色模式适配 + 手机端收尾（2026-10-14 第三批）——
check('主题探测：读 color-scheme → 退化到底色亮度 → 写 <html data-ts-theme>',
  /export function detectTheme/.test(themeSrc) &&
  /getComputedStyle\(document\.documentElement\)\.colorScheme/.test(themeSrc) &&
  /root\.setAttribute\('data-ts-theme', theme\)/.test(themeSrc) &&
  /startThemeWatch\(/.test(dock) &&
  /matchMedia\?\.\('\(prefers-color-scheme: light\)'\)/.test(themeSrc))
check('浅色模式：外壳换浅底深字（原来写死浅色前景 + 透明底 → 白底上看不见）',
  /html\[data-ts-theme="light"\] \{/.test(themeSrc) &&
  /--ts-fg: #1f2328;/.test(themeSrc) && /--ts-surface: #f7f8fa;/.test(themeSrc) &&
  /color: var\(--ts-fg\);/.test(dock) &&
  /background-color: var\(--ts-skin-color, var\(--ts-surface\)\)/.test(dock))
check('深色皮肤不跟随宿主浅色主题（否则深底 + 深字 = 看不见）',
  /root\.setAttribute\('data-ts-skin'/.test(skinsSrc) &&
  /html\[data-ts-skin="dark"\] \{/.test(themeSrc) &&
  // 必须在浅色覆盖之后（同权重靠源码顺序）
  themeSrc.indexOf('html[data-ts-theme="light"] {') < themeSrc.indexOf('html[data-ts-skin="dark"] {') &&
  // styles.ts 里那份重复的浅色覆盖已删（它会盖掉深色皮那条）
  !/html\[data-ts-theme="light"\] \{ --ts-fg: #1f2328/.test(styles))
check('手机端收尾：主对话自动最大化 + 设置面板里可跳到任意窗口',
  /const autoMaxRef = useRef<string \| null>\(null\)/.test(dock) &&
  /if \(p && !p\.api\.isMaximized\(\)\)/.test(dock) &&
  /p\.api\.exitMaximized\(\)/.test(dock) &&
  /const focusPane = useCallback/.test(dock) &&
  /data-desk-focus=\{id\}/.test(dock))

// —— 14. 正文宽度可调（复用宿主偏好）+ 浅色内容面 + 空侧栏自收 + 线条图标 ——
check('正文宽度随时可调，且复用宿主官方那份偏好',
  /const WIDTH_PREF_KEY = 'dsh\.conversation\.contentWidth'/.test(mainChat) &&
  /const CONTENT_MIN = 640/.test(mainChat) && /const CONTENT_EDGE_BUDGET = 176/.test(mainChat) &&
  /data-desk-chat-w="left"/.test(mainChat) && /data-desk-chat-w="right"/.test(mainChat) &&
  /document\.documentElement\.style\.setProperty\('--ts-chat-w'/.test(mainChat) &&
  /padding:16px max\(22px, calc\(\(100% - var\(--ts-chat-w, 920px\)\) \/ 2\)\)/.test(styles))
// —— 15. 浅色皮/预览/输入条三处修正（2026-10-14 第四批）——
check('项目预览 iframe 固定 color-scheme（宿主浅色时内嵌项目不再一片发白）',
  /\.ts-preview-frame \{ color-scheme: dark; \}/.test(styles))
check('输入条停靠：内容格没尺寸时退化到最近可见祖先（后台标签也有输入框）',
  /const pickRect = \(\): DOMRect \| null =>/.test(composerDock) &&
  /for \(let node = cell\.parentElement, i = 0; node && i < 6; node = node\.parentElement, i\+\+\)/.test(composerDock) &&
  /const r = pickRect\(\)/.test(composerDock))

// —— 16. 浮动面板统一主题化（浅色主题下不再是一堆深色卡片）——
check('弹层调色板集中一处（theme.ts），外壳/皮肤/弹层三组变量分开',
  /export const THEME_CSS/.test(themeSrc) &&
  /--ts-t-fg:/.test(themeSrc) && /--ts-pop-bg:/.test(themeSrc) &&
  /export function installThemeCss/.test(themeSrc) &&
  /installThemeCss\(\)/.test(crCenter) && /installThemeCss\(\)/.test(themeSrc) &&
  // 外壳那套变量不再在 DOCK_CSS 里重复定义
  !/--ts-fg: #e6e8eb;          \/\* 主前景 \*\//.test(dock))
check('所有浮动面板都吃弹层变量（底/字/描边/阴影），并重定向内部 --ts-fg*',
  ['.ts-pop', '.ts-sess-pop', '.ts-expset-pop', '.ts-warn-pop', '.ts-skin-pop', '.ts-win-overlay', '.ts-jump-latest', '.ts-modal', '.dv-context-menu[data-ts-hoisted="1"]']
    .every((sel) => themeSrc.includes(sel)) &&
  /--ts-fg: var\(--ts-pop-fg\);/.test(themeSrc) &&
  /--ts-fg-mute: var\(--ts-pop-fg-mute\);/.test(themeSrc))
check('项目中心/弹窗里的深色底已清空（不再有写死的深色卡片）',
  !/rgba\(24,27,33/.test(styles) && !/rgba\(14,16,21/.test(styles) && !/rgba\(20,23,29/.test(styles) &&
  !/rgba\(14,16,21/.test(dock) &&
  /background:var\(--ts-pop-bg\)/.test(styles) &&
  /background: var\(--ts-pop-bg\)/.test(dock))

// —— 17. 状态栏悬浮（参考 info_report 的 #statusbar）——
check('状态栏**真实占一行**（不浮在内容上），但视觉上悬浮（上边线 + 向上阴影 + 模糊）',
  // 关键：它不是覆盖层。旧版把这行塔成 0px 再 absolute 贴底 → 三个区域的「脚跟」
  // 被盖住（用户反馈底部已遮挡）。
  /grid-template-rows: 42px minmax\(0,1fr\) auto;/.test(dock) &&
  !/grid-template-rows: 42px minmax\(0,1fr\) 0px;/.test(dock) &&
  !/\.ts-statusbar \{[^}]*position: absolute/.test(dock) &&
  // 悬浮感只由视觉三件套提供
  /box-shadow: 0 -6px 18px rgba\(0,0,0,\.18\);/.test(dock) &&
  /background: var\(--ts-sb-bg\);/.test(dock) &&
  /border-top: 1px solid var\(--ts-line\);/.test(dock) &&
  /backdrop-filter: blur\(10px\) saturate\(1\.1\);/.test(dock) &&
  // 高度仍量出来写进 --ts-sb-h：现在只给窄屏抽屉/遮罩让位用
  /data-desk-statusbar/.test(dock) &&
  /document\.documentElement\.style\.setProperty\('--ts-sb-h'/.test(dock) &&
  // min-height 不能读自己写出去的变量（自反馈会把状态栏撑到整屏 —— 实测踩过）
  /min-height: 28px;/.test(dock) &&
  // 底部留白只需让开输入条，不再叠一个 --ts-sb-h（否则底部多出一块空白）
  /padding-bottom:calc\(var\(--ts-composer-h, 72px\) \+ 14px\)/.test(styles) &&
  !/padding-bottom:calc\(var\(--ts-composer-h, 72px\) \+ var\(--ts-sb-h, 28px\)/.test(styles) &&
  // 输入条也不再为它让位（状态栏已不在自己上方）
  !/const overlap = Math\.max\(0, r\.bottom - \(window\.innerHeight - sbH\)\)/.test(composerDock))
