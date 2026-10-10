# 接口契约（实现前必读，改动需先改此文件）

## 工具：tokensave_delegate

### 输入 schema
```typescript
{
  task_description: string   // required
  file_path?: string         // 可选，目标文件路径
  explorer_count?: number    // 默认 3
}
```

### 输出 schema
```typescript
{
  brief: string              // required，最终任务简报（含 tokensave-brief 标记）
  scenario: string           // required，'from_scratch' | 'edit_existing'
}
```

### 完整 defineTool 结构（供参考，具体实现见 Step 05）
```typescript
ctx.tools.register(defineTool({
  name: 'tokensave_delegate',
  description: '...',
  parameters: { task_description: {...}, file_path: {...}, explorer_count: {...} },
  output: {
    schema: {
      type: 'object',
      properties: {
        brief: { type: 'string', required: true },
        scenario: { type: 'string', required: true },
      },
      additionalProperties: false,
    },
    render: (_args, value) => [{ type: 'text', text: value.brief }],
  },
  async execute(args, exec) { /* 见 Step 10 */ },
}))
```

## 场景类型（src/scenario/detector.ts）

```typescript
export type Scenario = 'from_scratch' | 'edit_existing'

export async function detectScenario(
  ctx: Context,
  sessionId: string,
  userMessage: string
): Promise<{ scenario: Scenario; cwd: string | null }>
```

### PROJECT_MARKERS（用于场景识别）
```typescript
const PROJECT_MARKERS = [
  'package.json', 'Cargo.toml', 'pyproject.toml',
  'go.mod', 'pom.xml', 'build.gradle', '.git'
]
```

### 编辑意图关键词
```typescript
const editKeywords = ['修改', '修复', '改一下', '优化', '重构', '更新', '替换', '删除']
```

## 黑板契约（src/tools/blackboard-ops.ts）

### Topic 枚举
```typescript
export type BoardTopic = 'requirement' | 'pitfall' | 'solution' | 'brief'
```

### 条目结构
```typescript
export interface BlackboardEntry {
  topic: BoardTopic
  content: string
  metadata: {
    source: string
    confidence: 'high' | 'medium' | 'low'
    digest: string
    explorerLabel?: string
  }
  ttl?: number
}
```

### 函数签名
```typescript
export async function postToBoard(ctx: Context, entry: BlackboardEntry): Promise<any>
export async function getBriefFromBoard(ctx: Context, topic: BoardTopic): Promise<any>
```

## 探索者预设（src/orchestration/parallel-explorer.ts）

```typescript
interface ExplorerConfig {
  model: string
  label: string
  focus: string
}

const EXPLORER_PRESETS: ExplorerConfig[] = [
  { model: 'deepseek-web/deepseek-chat', label: 'DeepSeek探索者', focus: '整体方案可行性' },
  { model: 'our-free-model/mimo-v2.6-flash-free', label: 'MiMo探索者', focus: '边界条件与异常处理' },
  { model: 'our-free-model/nemotron-3-ultra-free', label: 'Nemotron探索者', focus: '性能与实现复杂度' },
```

> 2026-10-06 变更（Step 06，经用户确认）：原 deepseek-web/free、kimi-web/free、qwen-web/free 三模型在当前环境全部不可用（kimi 插件故障已卸载、qwen 插件不存在、deepseek-web 实际模型为 deepseek-chat/deepseek-reasoner）。新组合：保留 deepseek-web + dsh-our-free-model 免费模型 + dsh-opencode-zen 免费档（npm 0.3.5 / github:xiaozhe7772222/dsh-opencode-zen）。火山方舟 asd 网关（GLM/豆包）已取消订阅，不再考虑。

> 2026-10-06 变更（Step 09，经用户确认）：第 3 槽由 opencode-zen/deepseek-v4-flash-free 换为 our-free-model/nemotron-3-ultra-free——Zen 免费档凭据（OPENCODE_API_KEY）待用户后续配置，届时可换回；llm-fallbacks 的 rootChain 免费链保留 zen 条目不受影响（凭据到位即生效）。

> 2026-10-08 变更（Step 46）：新增**探索者设置**——用户可在工作台标题行打开面板，按
> 「默认 / 免费 / 收费」三组逐个或整组开关探索者，至少保留 1 个。涉及：
> - 新模块 `src/explorer-catalog.ts`（纯数据：分组口径 `EXPLORER_GROUPS` / 免费 provider 白名单
>   `FREE_PROVIDERS` / 免费回退清单 `KNOWN_MODELS` / `buildCatalog` / `sanitizeSelection` / `selectionToConfigs`）；
>   免费 / 收费的候选**来自真实模型目录**：对已注册 provider 调 `ctx.llm.listModels()`（4s 超时 + 60s 缓存，
>   失败/为空回退 `KNOWN_MODELS`），并用 `LlmModelInfo.name` / `.description`。**三组互不重复**：默认组先入，
>   其 model 从免费/收费里排除；
> - 新路由 `GET|POST /plugins/dsh-tokensave/explorer-settings`（读目录 / 写选择，写入 `~/.dsh/tokensave/explorers.json`，
>   空选择返回 400）；
> - `parallelExplore` 的探索者集合改为：**存过选择就完全按选择跑**（不再受 explorer_count 截取），
>   从未配置时保持旧行为（`EXPLORER_PRESETS.slice(0, explorerCount)`）。`EXPLORER_PRESETS` 本体与签名不变；
> - `POST /projects` 加固：请求体缺 `projects` 数组一律 400（避免误写把项目注册表清空）。


### parallelExplore 签名（2026-10-06 Step 10 补记：新增 agent 透传参数）
```typescript
export async function parallelExplore(
  ctx: Context,
  taskDescription: string,
  codeContext: string | null,
  explorerCount: number,
  agent?: Agent   // 调用方 agent：仅用于回退解析探索者 cwd（agent.session.header.cwd）——
                  // 2026-10-09 去 dsh-call-session 化后不再透传给 session_create；
                  // 工作台项目作用域优先，其次此回退（官方 agents.create 的 meta.cwd 直传）
): Promise<Array<{ sessionId: string; label: string }>>
```
### 返回值
```typescript
// parallelExplore 返回
Array<{ sessionId: string; label: string }>
```


> 2026-10-06 Step 11.1 变更（经用户决策的宿主侧绕过）：parallelExplore 不再使用
> session_create.initial_message 与 session_call 投递探索者消息——dsh-call-session@0.1.6
> 构造的消息 source.kind='plugin' 会被 0.2.0-rc.2 的 v4 格式校验拒绝（见 PROGRESS
> 已知问题）。现行实现：session_create（不带 initial_message）创建后，宿主以
> createUserMessage({ content, source: { kind: 'user' } })（@deepseek-ai/dsh-llm，
> 平台 dsh-acp 同款构造）构造消息，按 agent.status 直调 followup（空闲，唤醒首轮）
> / steer（运行中），镜像原 dispatchNativeMessage 语义；投递失败直接抛出（不再
> allSettled 静默吞错）。签名与返回值不变，EXPLORER_PRESETS 不变。
>
> 2026-10-09 变更（去 dsh-call-session 化，方案①）：探索者会话创建不再经
> `ctx.tools.execute('session_create')`——新模块 `src/session/create-explorer-session.ts`
> 直调官方原语：`agents.create`（meta.cwd 原生指定工作区，withProjectCwd Proxy hack 退役；
> agentOptions 直传 provider/model）+ `agentPresets.resolve/mount`（预设装配，同官方
> sessionController.composeAgent）+ `sessionTitle.rename`（标题持久化，回退 session/title 事件）。
> 探索者仍是普通 root 会话（侧边栏可见，非 subagent）。`agent` 参数语义变更：仅作 cwd 回退。
> 端到端实测通过（5 探索者并行建会话/真实轮次/黑板产出/简报回收；黑板 session:bootstrap
> 零公告证实走新路径）。消息投递路径（followup/steer 直投）不变。
## 浮窗 storageKey 规则
```
tokensave:explorer:${sessionId}
```

## 简报标记（用于 LLM Calls 视图搜索）
```
<!-- tokensave-brief:v1:start -->
...brief 内容...
<!-- tokensave-brief:v1:end -->
```

## Web 路由（src/board-web-route.ts，宿主只读观测面）

三条路由均挂宿主 WebServer（`webServer`/`httpServer` 服务键），Node 风格
`handler(req, res)`，GET-only，请求先过 `connection.requestRejection` 鉴权闸门，
`ctx.effect` 注册并返回三路由 disposer。

```
GET /plugins/dsh-tokensave/board?workspace=<路径>   # 黑板条目（按工作区过滤）
GET /plugins/dsh-tokensave/fs?path=<目录>            # 目录浏览（选择项目文件夹）
GET /plugins/dsh-tokensave/explorers                 # 探索者快照（直读 agents 服务）
```

board 响应：`{ workspace, timestamp, entries: BoardRouteEntry[] }`，其中
BoardRouteEntry = `{ id, topic, topicLabel(中: 需求/坑/方案/简报), title, content,
metadata, createdAtMs, expiresAtMs, status, workspace }`，按主题顺序（需求→坑→
方案→简报）+ 创建时间倒序。fs 响应：`{ timestamp, path, entries: FsEntry[] }`，
FsEntry = `{ name, path, isProject }`（isProject = 子目录含 PROJECT_MARKERS 任一）；
隐藏目录不列出；路径不存在 404、非目录 400。explorers 响应：`{ timestamp,
sessions: [{ id, shortId, title, workspace, state }] }`，宿主侧按 `tokensave-` 标题
前缀过滤（不依赖 dsh-call-session 的 telemetry 路由）。

**身份制注册（防 full-reload 丢路由，2026-10-07 事故修复）**：模块级状态记
`registeredServer`（已挂载的 server 实例）而非布尔——dsh-hmr full reload 会卸载
插件 fiber（disposer 注销路由）而不重执行本模块，模块级布尔若不复位，重新 apply
时会误判「已注册」而跳过（404）。故：① disposer 内复位 `registeredServer = null`
（带实例比对防误清）；② tryRegister 以实例身份判断；③ guard 闭包统一鉴权+GET-only。

## 项目中心 / conversation.view 槽（client/src/panel/）

```typescript
// 注册（client/src/index.ts）
slots.register({
  name: 'conversation.view',
  id: 'tokensave-control-room',   // id 稳定（宿主视图偏好存 localStorage）
  order: 20,        // chat=0, trajectory=10, canvas=15
  label: '项目中心',
  inject: (sessionId) => ({ sessionId }),
}, ControlRoom)
```

- **布局模式：固定仅 1 种 `h-desk`（H 型工作台），无选择 UI**；「添加项目」弹窗
  只含：选择项目文件夹（目录浏览器）+ 可选项目名称。
- H 台结构（**无中横线**）：全台共享 `R = max(左窗口数, 右窗口数, 2)` 行的 1fr
  网格（JSX 注入 gridTemplateRows）——左右两竖 `grid-row: 1/-1` 跨满，列内窗口
  flex:1 等高均分；黑板跨 1..R-1 行（底边与列缝平齐，不加 border）；中下格占
  最后一行。探索者增多 → R 增大 → 自动均分高度，偶数时三列横缝完全对齐。
- 探索者窗口（**自有 /explorers 路由发现** tokensave-* 按奇偶分左右）：最小化/
最大化（工作台浮层 z-40）/双击全屏（requestFullscreen，失败降级浮层）/隐藏恢复 chip。
- **中下 = 宿主原生输入条停靠**（不自造聊天组件）：HDesk 挂载时用
  `useDockNativeComposer` 把 `[data-conversation-region="composer"]`（宿主
  conversation.composer 座位，每个 tab 常驻）置为 position:fixed，按中下卡片
  getBoundingClientRect **内缩 border+padding**（输入条落在卡片边框内）、向下锚定
  内容向上生长、z-35；ResizeObserver/resize/scroll(capture)/300ms 兜底重测；卸载/
  切 tab 还原行内样式。消息记录仍在「对话」tab。卡片本体 = `.ts-desk-chat`（与
  其它卡片同款 border/bg，无提示文字）。
- **宽度把手联动（问题 4 修正：只作用于工作台）**：宿主拖拽把手把 `--dsh-chat-user-width`
  写在 body 的父元素，`--dsh-chat-content-width: var(--dsh-chat-user-width, clamp(...))`
  定义在宿主 body 上并继承给全部后代。**仅 H 台根节点** `.ts-hdesk`（HDesk 的 `.ts-cr`
  附加类）取 `width: min(100%, var(--dsh-chat-content-width, 920px))` + `margin-inline:auto`；
  `.ts-cr` 本身不再限宽 —— 项目中心列表保持全宽。
- **左栏 = 协作对话（`TalkColumn`）**：主 agent ↔ 探索者时间轴。数据全部来自真实
  事件流（主会话 + 各探索者 `subscribeSession` / `subscribeSessionMetrics`），组件只做
  措辞包装：探索者首条 user 消息（主 agent 实际下发的任务原文）→ 首条 assistant
  （「收到，开始干活了」）→ 后续 assistant（进度 / 完成汇报，原文截断）→ 含报错特征的
  tool 结果（「遇到问题」，仅取前 2 条）→ 主会话 `tokensave_delegate` 工具跨度
  （派发 / 等待中 / 收齐简报）。按时间排序、末 120 条、自动滚底。
- **右栏 = 协作收益（`SavingsColumn`）**：
  - **优势（省 token / 省费用）**：口径已与用户确认——「同量 token 若由主 agent 承担
    的成本」。探索者实际用量取自 `assistant/message.usage`（提供方上报，非估算），按主
    agent 单价折算（输入 ¥2.0/M、输出 ¥8.0/M，界面标注口径；DSH 无价格表，已核实
    llm / session-stats / token-meter 均不含单价）。实际支出 ¥0（免费模型），节省占比 =
    省下 /（主 agent 自身 + 省下）。
  - **劣势（等待时间占用）**：主 agent 等待 = 主会话 `tokensave_delegate` 的
    `tool/call → tool/result` 墙钟累计（进行中的按当前时刻计），另给探索者并行人时与会话
    墙钟占比。
- **两栏等高（`flex: 0 0 40%; min-height:104px`）**：左右两栏高度严格一致，内容超出各自
  内部滚动（`.ts-talk-list` / `.ts-save-body` 均 `overflow:auto`），余下空间由探索者窗口
  `flex:1` 等高均分——H 台原有均分网格与三列横缝对齐不受影响。
- **探索者按工作区收敛**：`fetchExplorers(project.path)` → `/explorers?workspace=`；宿主侧
  过滤后为空则客户端自动回退全量（宁可多显示，也不让窗口凭空消失）。
- **`StreamMsg` 扩展**：`time`（`SessionEvent.time`）、`usage`（`assistant/message.usage`）、
  `type`（事件原文）；`SessionMetrics`（`inputTokens`/`outputTokens`/`reasoningTokens`/
  `toolSpans`/`pendingTools`/`firstMs`/`lastMs`/…）由 `metricsFromWindow` 与消息共用同一
  窗口快照折叠——零额外请求、零估算。
- **黑板正文富文本（`RichText.tsx`，零依赖）**：能 `JSON.parse` 的 → 语法着色格式化
  JSON（`ts-json-key/str/num/bool/null`）；含 Markdown 特征的 → 块级 + 行内渲染
  （标题 h1–h6 / 有序无序列表 / 围栏代码块 / 引用 / 表格 / 链接 / 行内码 / 加粗斜体 / 分隔线）；
  其余 → 保留换行的纯文本。围栏标注 ```json 的代码块同样走 JSON 着色。
- **右栏文案克制**：界面只留短标签与紧凑数字（`↑1.2k ↓340`、`≈62%`）；「计价口径」等说明
  一律走 `title` 悬浮提示，正文只保留一个 `ⓘ 计价口径` 角标。
- **「选择当前文件夹」选中 / 取消循环**：选中态 `.ts-btn-picked`（绿色实心 + 描边 + 加粗）
  文案为「✓ 已选中（点击取消）」，未选中为浅蓝「选择当前文件夹」；再次点击同一目录即取消选择。
- 黑板：board 路由按项目路径拉取，主题 tab + 点击展开 + 20s 自动刷新。
- 项目仓库：localStorage `tokensave:projects.v1`，ProjectRecord =
  `{ id, name, path, layout: 'h-desk', createdAt }`（同路径去重）。
- 探索者浮窗（shell.overlay）自项目中心上线后停用；简报浮窗保留。

## 系统提示词段契约（src/prompt/system-prompt.ts）

```typescript
export function registerSystemPrompt(ctx: Context): void
// 内部调用：
// ctx.systemPrompt.section({
//   name: 'tokensave-delegation',
//   order: 150,
//   text: '...'
// })
```

## 跨插件依赖（2026-10-09 去依赖改造后）
- dsh-call-session >= 0.1.6（**仅剩黑板依赖**：boardStore/board_post/board_list 读写；
  session_create 建会话已于 2026-10-09 去除——`createExplorerSession`（src/session/create-explorer-session.ts）
  直调官方原语 agents.create + agentPresets.resolve/mount + sessionTitle.rename，实测通过）
- ~~dsh-float-window~~ **已移除**：v0.4.1 源码快照 vendor 进 `client/vendor/dsh-float-window/`（含 LICENSE 与
  [vendor-patch] labels 可选+默认合并），构建时直接打包，npm 依赖已删；升级/换实现完全自控
- dsh-llm-fallbacks（**配置级零代码耦合**：代码从不 import/调用，仅 profile 配置给探索者/执行者配模型回退链；
  卸载不影响编译与运行，仅失去自动故障切换）
- dsh-hashline-edittool 或 dsh-smarter-edit（UI 编辑体验，无代码耦合）
- 免费 provider（deepseek-web / our-free-model / opencode-zen 等）：**硬编码已解除**——
  `parallelExplore` 建会话前经 `llm.listProviders()` 探测，provider 未注册的预设/选择项降级剔除并告警，
  全部不可用时抛出可读错误（llm 未就绪时探测跳过、保持原行为）；探索者设置面板本就按 live 目录列候选

## 文件路径约定
```
tokensave/
├── package.json                  # 声明 dsh.bundle.patch 和 dsh.client
├── cordis.patch.yml              # 开发调试挂载
├── src/                          # 宿主端
│   ├── index.ts
│   ├── board-web-route.ts        # /board + /fs 只读路由
│   ├── prompt/system-prompt.ts
│   ├── scenario/detector.ts
│   ├── tools/smart-delegator.ts
│   ├── tools/blackboard-ops.ts
│   ├── orchestration/parallel-explorer.ts
│   ├── orchestration/workflow.ts
│   ├── routing/model-router.ts
│   └── types.ts
├── client/                       # 客户端
│   └── src/
│       ├── index.ts              # 槽位注册（Probe + 项目中心）
│       ├── session-subscribe.ts
│       ├── float/mount.tsx       # 简报浮窗（探索者浮窗已停用）
│       ├── panel/                # 项目中心 + H 型工作台
│       │   ├── ControlRoom.tsx   # 项目列表 + 添加项目
│       │   ├── AddProjectDialog.tsx
│       │   ├── HDesk.tsx         # H 型布局
│       │   ├── Blackboard.tsx
│       │   ├── ExplorerWindow.tsx
│       │   ├── MsgList.tsx
│       │   ├── api.ts / store.ts / styles.ts
│       │   └── ...
│       └── components/
│           ├── ExplorerStream.tsx
│           └── BriefViewer.tsx
└── tests/
```