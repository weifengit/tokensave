# Step 13：dockview 接管工作台布局（含多项目并存）

> 新开对话时把本文件整体贴进去作为任务说明。开工前先按「只看这些」把现状读完。

## 前置

- Step 69 完成（`client/src/composer-focus.ts`）；全量测试链 10 项 ALL GREEN。
- 参考实现已存在：`/Users/sonoma/code/info_report/packages/dsh-intel-plugin/web/`
  （vanilla dockview-core 的成熟用法，**本步要求尽量对齐它的视觉与交互**）。

## 目标（一句话）

把**项目中心与工作台合并为一个 tab**（一个 `conversation.view`），其内部布局**完全交给 dockview**：
删掉自研的「顶部项目预览 + H 型三列网格」，项目中心（项目列表）→ 黑板 / DSH 主对话 / 探索者 /
协作对话 / 协作收益 / 项目预览 都是 dockview 面板；并让**多个项目同时活着**（A、B 各自成组/浮窗，
切项目只切激活分组，不重挂 DOM，正在播放的媒体/长任务不中断）。

## 只看这些

- `client/src/panel/HDesk.tsx`（1283 行：布局机 + 停靠 + 业务逻辑，本步的主要改造对象）
- `client/src/panel/desk-layout.ts` / `desk-win-seed.ts` / `desk-types.ts`（自研布局持久化，将被 dockview 取代）
- `client/src/panel/styles.ts`（H 台 CSS 约 85 行将作废）
- `client/src/panel/{Blackboard,TalkColumn,SavingsColumn,MainChat,PreviewPanel,ExplorerWindow}.tsx`（6 个面板组件，**内部逻辑尽量不改**）
- `/Users/sonoma/code/info_report/packages/dsh-intel-plugin/web/workbench.js`（参考：dockOptions / createIconTab / createPaneRenderer / togglePanelArea / wireCrossDockDnd / pruneEmptyGroups）
- `/Users/sonoma/code/info_report/packages/dsh-intel-plugin/web/icons.js`（线条图标集）
- `/Users/sonoma/code/info_report/packages/dsh-intel-plugin/web/app.css`（皮肤令牌 + `--dv-*` 变量覆盖，重点 18-40 行与 2281-2320 行）
- `docs/CONTRACTS.md`（工作台/槽契约节）

## 硬约束（读宿主源码已核实，不要试图绕过）

1. **只保留一个 tab**（本步前提）：项目中心与工作台合并为**一个** `conversation.view`。
   宿主一次只挂一个 view（`renderSlot("conversation.view", …, { only: viewId })`）——但这只禁止
   「两个宿主 tab 同时可见」，不限制**一个 view 内部**摆多少个项目窗口。多项目并存就在这
   一个 view 里用 dockview 的分组/浮动组表达。
2. **不要用宿主原生输入条做多项目输入**：全页只有一座 `[data-conversation-region="composer"]`
   （当前会话那一座）。多项目正确做法是 **每个项目窗口自带输入框**，直接用已有的
   `sendToSession(sessionId, text)`（`panel/sessions.ts`，内部就是
   `sessions.scope(id).get('conversation').send(text)`）发送到**该项目自己的会话**——
   不抢、也不依赖宿主那一座输入条。**因此每个项目窗口的输入框天然对应自己的项目，不会串台。**
3. **会话级单例**：`panel/sessions.ts` 的 `currentSessionId`、`panel/chat-view.ts` 的
   阅读视图开关都是模块级单值 —— 多项目并存前必须改成按 projectId/sessionId 分键，
   否则会出现「A 的注入显示到 B」这类张冠李戴。
4. 数据面本身是项目隔离的（`/board?workspace=`、`/explorers?workspace=`、`desk-layout`
   按 projectId 分键），不要改动这套隔离口径。

## 可行性依据（已在本仓核实，新对话不必重查）

- **订阅非当前会话**：`panel/ExplorerWindow.tsx` 已经对探索者会话（不是宿主当前会话）调
  `subscribeSession(session.id, …)` 成功渲染消息流 —— 多项目并存的消息面是现成的。
- **向指定会话发送**：`panel/sessions.ts` 的 `sendToSession(sessionId, text)` 已在用
  （黄灯清单「继续」与 auto-continue），内部 `sessions.scope(id).get('conversation').send(text)`。
  每个项目窗口自带输入框就接它。
- **数据面隔离**：黑板/探索者/收益都按 `workspace=` 取数；布局按 `projectId`；消息按 `sessionId`。
- **唯一真障碍**：`HDesk` 用 `key={opened.id}` 强制重挂（源码注释：换项目必须重挂，否则 A 的布局
  会回写进 B）+ `openSession` 会导航宿主会话 —— 这两条是「切项目打断 A」的根因，也是本步主要要拆的东西。

## 参考实现的要点（尽量照搬）

### dockview 初始化（workbench.js:175-216）

```js
DVC.createDockview(el, {
  createComponent: (o) => (o.name === 'pane' ? createPaneRenderer() : null),
  createTabComponent: (o) => (o.name === 'iconTab' ? createIconTab() : undefined),
  theme: { name: 'intel', className: 'dv-intel', colorScheme: 'dark', gap: 0 },
  defaultRenderer: 'always',      // 默认 onlyWhenVisible 会把非激活面板摘出文档
  noPanelsOverlay: 'emptyGroup',
  getTabContextMenuItems: () => [/* 中文菜单：关闭/关闭其他/关闭全部/最大化/浮动/移到某区 */],
})
```

### 媒体不中断的关键手法（workbench.js:396-436）

面板区「收起」= `api.toJSON()` 存快照 + `removePanel()`；「展开」= `fromJSON(snapshot, { reuseExistingPanels: true })`。**渲染器 dispose 时把 DOM 搬去 park 容器而不是丢弃**，
iframe / 播放器状态因此不丢。本步移植这条到项目切换：切项目 = 存快照 + 换分组，
**不 unmount iframe**。

### 面板规格（workbench.js:51-69 的 VIEWS 同构）

- 标签只画线条图标（`tabComponent: 'iconTab'`），不带关闭键；关闭走右键菜单。
- 面板标题用中文 title，图标取自图标集。
- `defaultRenderer: 'always'` 必须开，否则非激活面板的 DOM 查不到。

### 图标（icons.js）

24 视窗、`fill="none"`、`stroke="currentColor"`、`stroke-width="1.6"`、圆头圆角；
**不用 emoji**。API：`window.IntelIcon(name, size)`、`hydrateIcons(root)`。
本步把这套搬成 TS 模块（`client/src/panel/icons.ts`），尺寸默认 15。

### 皮肤与透明（app.css）

- 颜色令牌：`--bg #0b0e14 / --panel #141922 / --panel-2 #1a2029 / --line #242b36 / --text #e6e8eb / --text-dim #9aa4b2 / --accent #4f8ef7 / --accent-soft rgba(79,142,247,.16)`。
- `--dv-*` 覆盖（app.css:2281-2320）：tabs 容器与 group 背景 `transparent`、
  标签高度 33px / 字号 12.5px、分隔条与 sash `transparent`（拖拽中 sash 用 accent）、
  `--dv-floating-box-shadow: 0 18px 48px rgba(0,0,0,.5)`、圆角 0。
- 皮肤背景层：独立 `#skinBg` 元素 + `opacity` 控制，`localStorage` 持久化（SKIN_KEY），
  面板本身保持透明（`background: transparent`），不另垫底色。

## 任务分解

### Step A（spike，先做，做完汇报再继续）

1. 引入 dockview-core：优先 vendored（复制 `dockview-core.min.js` + `dockview.css` 到
   `client/src/vendor/`），由 `styles.ts` 同款方式注入；若走 npm 需评估 esbuild 打包体积。
2. 在 `ControlRoom` 挂一个**空 dockview**，验证：产物可加载、HMR、与宿主样式无冲突、
   透明背景成立。
3. 验证 dockview 是否提供「禁拖/锁布局」（`disableDnd` 类）与 panel 隐藏 API；
   现有「布局锁」语义要映射过去。
4. **关键验证**：假面板 + 自建输入框（`sendToSession`）在 dockview 面板里，拖动/缩放 10 秒
   ——输入框不丢焦点、不跑位；同时验证两个面板（两项目）同时可输入、互不影响。
5. （可选遗留）现有 `useDockNativeComposer` 是否还需要：单项目模式下可保留，多项目模式下不用。
6. 汇报：能/不能，以及体积实测数字。

### Step B：面板化替换

1. 6 个组件注册为 dockview 面板（组件内部逻辑不改，只换挂载容器）。
2. 删 HDesk 的网格机（三列轨道 / midSplit / 分隔条 / 恢复 chips 约 600 行）、
   `desk-layout.ts`（172 行自研持久化 → dockview `toJSON/fromJSON`，仍按 projectId 分键）、
   `styles.ts` 中 H 台 CSS；顶部项目预览条降级为普通面板。
3. 移植参考实现的三件套：跨实例拖拽（`wireCrossDockDnd`）、空分组清理
   （`pruneEmptyGroups`）、面板区存快照收起（媒体保活）。
4. 「布局锁」映射到 dockview 交互开关；关闭面板的恢复入口用参考实现的 chips 方案。

### Step C：多项目并存（本步的架构核心）

1. 一个 dockview 实例内，按 projectId 组织分组（或浮动组）；切项目 = 切激活分组 +
   恢复该项目的 `fromJSON` 快照，**不重挂**任何面板 DOM（媒体/长任务不断）。
2. **不再导航宿主会话**：每个项目窗口自己持有 `latestProjectSession(project.path)` 得到的
   sessionId，用自己的订阅（`subscribeSession(sessionId)`，探索者窗口已证明可订阅非当前会话）
   和**自己的输入框**（`sendToSession(sessionId, text)`）——切项目完全不碰宿主导航，
   A 才不会被 B 打断。路由机器（`replaceMain` 接管）在多项目模式下**停用**。
3. 消除会话级单例污染：`currentSessionId`、`chat-view` 改为按会话/项目分键。
4. 项目中心作为**一个面板**（项目列表 + 打开新项目窗口），不再是一个独立 tab；
   「打开 A」「打开 B」= 各建一个项目分组/浮窗，同时活着。
4.
5. 回归：A/B 两项目来回切 10 次 —— A 的 iframe（音乐/视频）不重载、B 的探索者流不断、
   在 A 的输入框发的消息只进 A 的会话（B 同理）。

### Step D：收口

- 重写 `scripts/check-desk-ux.mjs` 中作废的网格断言；新增 dockview 面板注册/快照往返的
  纯函数测试；`package.json` 的 `test` 链同步。
- `pnpm check` + 全量测试链 + 真机目检（拖拽 / 最大化 / 刷新恢复 / 双项目切换）。
- `docs/PROGRESS.md` 追加 Step 13 条目；`docs/CONTRACTS.md` 同步布局契约与 projectId 分键口径。

## 验收

- [ ] 工作台不再有自研网格：三列轨道 / midSplit / 分隔条 / 恢复 chips 代码已删。
- [ ] 6 个面板均可拖拽/浮动/最大化/关闭，标签是线条图标且不带关闭键。
- [ ] 透明无背景 + `--dv-*` 覆盖与 info_report 视觉一致（深浅主题都可读）。
- [ ] 切项目不重挂 iframe：媒体/长任务不中断。
- [ ] 多项目并存时无串台：A 的数据不出现到 B（注入、探索者、黑板、收益逐项核对）。
- [ ] 布局快照按 projectId 持久化，刷新后恢复。
- [ ] `pnpm check` 全绿 + 全量测试链全过 + bundle 重建通过 `node --check`。

## 不要做

- 不要试图同时挂两个 conversation.view（宿主不支持，见硬约束 1）。
- 不要给非激活项目也停靠真输入条（只有一座，见硬约束 2）。
- 不要改动数据面的项目隔离口径（`workspace=` 过滤那套）。
- 不要碰路由机器（`replaceMain` 接管、视图偏好）——那是另一个独立议题。
- 不要为了少写代码而放弃 `defaultRenderer: 'always'`（会踩「非激活面板 DOM 查不到」）。
