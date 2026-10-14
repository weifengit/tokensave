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

## 黑板契约（2026-10-09 起自建：src/blackboard/store.ts + tools.ts）

> 此前黑板由第三方插件 dsh-call-session 提供（boardStore 服务 + board_post/board_list 工具），
> 已于 2026-10-09 以**同语义自建**取代：存储 `~/.dsh/tokensave/board.json`（原子落盘，300 条 FIFO），
> 同名工具 board_post / board_list / board_clear 自注册（探索者提示词零改动）。
> blackboard-ops 与 H 台 /board 路由均直读自建存储，不再经 ctx.get('boardStore')。
> 语义对齐项：TTL 默认 3600s/上限 86400s、惰性过期 active→expired、工作区隔离
> （authorWorkspace 不匹配即过滤，空 = global 全可见）、topic 精确/前缀匹配、保留主题
> （telemetry:/call:/sys:）拦截。实测：15 项行为断言全部通过。

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
    title?: string   // 2026-10-11：条目标题列（中文）；缺省时由 extractTitle 从正文首行提取
  }
  ttl?: number
}
```

### 标题提取规则（extractTitle，store 与 /board 路由共用同一实现）
1. 优先 `metadata.title`；
2. 否则正文首个非空、非 `<!--` 注释行（**跳过简报标记行**，避免标题变成
   `<!-- tokensave-brief:v1:start -->`）；
3. 去 markdown 前缀（`# `/`- `/`1. `）与强调记号（`**`/`__`/`~~`/反引号/`*`），
   截 60 字——黑板标题列是纯文本观测面，不渲染 markdown（黑板正文展开同样纯文本）；
4. 全空兑底 `'(无标题内容)'`。提取发生在读取时——存量条目无需迁移，改规则即时生效。

### 函数签名（ctx 参数保留但不再使用；内部直调自建存储）
```typescript
export async function postToBoard(ctx: Context, entry: BlackboardEntry): Promise<any>
export async function getBriefFromBoard(
  ctx: Context, topic: BoardTopic,
  opts?: { workspace?: string; full?: boolean }   // 2026-10-11：workspace=工作区收敛；full=带正文（评审用）
): Promise<any>
```

> 2026-10-11：`BlackboardEntry` 新增可选 `workspace?`——引擎帖（requirement/brief）带工作区，
> 在该项目板可见且可按轮归档；缺省仍为全局帖（旧行为）。

### 自建工具（src/blackboard/tools.ts，与原第三方同名）
```typescript
board_post:   { topic(必填), content(必填), tags?, ttl?(默认3600,上限86400), metadata? }
board_list:   { id?, topic?, topic_prefix?, tag?, active_only?(默认true),
                cross_workspace?(默认false), titles_only?(默认true), limit?(默认20,上限100) }
board_clear:  { id?, topic?, mode?('dismiss'|'purge', 默认 dismiss) }
```

> 2026-10-11 metadata 兑底（BUG-4）：`board_post` 在服务端统一补全 metadata——
> `title` ← 正文首行（extractTitle）、`source` ← 会话标题、`confidence` ← 'medium'、
> `digest` ← 首行截 80 字。提示词已要求探索者自带，但四模型遵守度不一（测试报告仅 MiMo 完整），
> 服务端补全保证交叉验证永远可归属信源。

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


### parallelExplore 签名（2026-10-06 Step 10 补记：新增 agent 透传参数；2026-10-11 返回值加 model）
```typescript
export async function parallelExplore(
  ctx: Context,
  taskDescription: string,
  codeContext: string | null,
  explorerCount: number,
  agent?: Agent   // 调用方 agent：仅用于回退解析探索者 cwd（agent.session.header.cwd）——
                  // 2026-10-09 去 dsh-call-session 化后不再透传给 session_create；
                  // 工作台项目作用域优先，其次此回退（官方 agents.create 的 meta.cwd 直传）
): Promise<Array<{ sessionId: string; label: string; model: string }>>
```
### 返回值
```typescript
// parallelExplore 返回（model 供简报标注未发帖者）
Array<{ sessionId: string; label: string; model: string }>
```

> 2026-10-11 轮次隔离（BUG-1/BUG-3/优化-6）：parallelExplore 内部依次调用
> `beginRun(cwd)`（归档上一轮 tokensave 帖 + 重置登记）→ 建会话 →
> `recordRunSessions(cwd, …)`（登记本轮会话，见下节 runs.ts）。
### 轮次登记（src/blackboard/runs.ts，2026-10-11 多探索者测试报告 BUG-1/优化-6）
```typescript
export interface RunSessionInfo { sessionId: string; label: string; model: string }
export interface RunRecord { runId: string; startedAtMs: number; sessions: RunSessionInfo[] }
beginRun(workspace: string): { runId: string; archived: number }
recordRunSessions(workspace: string, sessions: RunSessionInfo[]): void
currentRun(workspace: string): RunRecord | null
```
- 持久化：`~/.dsh/tokensave/runs.json`（每工作区一条当前轮记录，原子落盘）；
- `beginRun` 归档口径：上轮探索者帖（authorSessionId ∈ 上轮 sessions）+ 引擎 brief 帖
  （source=tokensave-engine 且工作区匹配/legacy 空）；他项目帖一律不动；无上轮记录不归档；
- `/explorers` 路由按 `currentRun(workspace).sessions` 过滤（无登记不过滤），响应带 `runId`；
- 探索者建完即登记 → 旧轮窗口在 H 台 8s 轮询内自动消失。


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
## 浮窗 storageKey 规则（已移除）
> 2026-10-09 Step 63：浮窗子系统（简报浮窗 + 已停用的探索者浮窗）整体删除，
> `tokensave:explorer:*` / `tokensave:brief` localStorage key 不再写入；
> 简报改为仅在对话（tokensave-brief 标记块）与黑板 brief 主题两处展示。

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
- 浮窗子系统（简报浮窗 + 探索者浮窗）已于 2026-10-09 Step 63 整体删除：简报只在对话与黑板展示，右下角浮窗/老板键 Alt+S 不复存在。
- **探索者会话零混入（2026-10-11 BUG-2，三道闸）**：
  ① `readProjectActivity`（activity.ts）跳过 `s.explorer`——探索者不进项目活动点、不进跑马灯；
  ② `sessions.ts` 新增 `isExplorerSessionId(sessionId)`（标题 tokensave- 前缀判定）；
  ③ HDesk 主对话卡：若当前绑定会话本身是探索者（用户从侧边栏点进），
  `mainChatSessionId` 回退到 `latestProjectSession`（项目自己的非探索者会话，无则空），
  探索者内容绝不渲染进「DSH 主对话」卡。历史会话选择器本就过滤 explorer（pickOwnSession）。

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

## 跨插件依赖（2026-10-09 去依赖改造后；Step 64 起 **零第三方硬依赖**）
- ~~dsh-call-session~~ **已彻底移除**（Step 62 去建会话、Step 64 去黑板）：
  黑板以同语义自建（src/blackboard/store.ts + tools.ts，同名工具自注册），详见「黑板契约」；
  **可以安全卸载 dsh-call-session**。注意其「看板」tab（conversation.view id=canvas）会随卸载消失。
- ~~dsh-float-window~~ **已移除**（Step 63 随浮窗子系统整体删除，vendor 目录一并清理；
  更早的 Step 62 曾 vendor 过，消费方消失后已无存在必要）
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
│   ├── session/create-explorer-session.ts  # 探索者建会话（官方原语直建）
│   ├── blackboard/store.ts     # 自建黑板存储（~/.dsh/tokensave/board.json）
│   ├── blackboard/tools.ts     # board_post/board_list/board_clear 同名工具
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
│       └── panel/                # 项目中心 + H 型工作台
│       │   ├── ControlRoom.tsx   # 项目列表 + 添加项目
│       │   ├── AddProjectDialog.tsx
│       │   ├── HDesk.tsx         # H 型布局
│       │   ├── Blackboard.tsx
│       │   ├── ExplorerWindow.tsx
│       │   ├── MsgList.tsx
│       │   ├── api.ts / store.ts / styles.ts
│       │   └── ...
└── tests/
```
## 工作台布局契约（2026-10-12 Step 13 起：dockview 接管，单项目）

> 取代原「H 型网格」契约（HDesk 与 desk-layout.ts 已删除）。核心：**项目中心独立 tab
> → 选项目 → 工作台**；工作台外壳参考 info_report：**三个 dockview 实例分区**
> （主侧栏 / 编辑区+面板区 / 辅助侧栏）+ 标题行 + 状态栏。

**区域与面板归属**

- 区域：`left`（主侧栏）/ `center`（编辑区 + 面板区，**同一实例**）/ `right`（辅助侧栏）。
- 默认落点：预览→left；主对话→center（编辑区）；黑板/协作对话/收益→center（面板区，下方分组）；
  探索者→center。落点只是**首次**位置，拖拽/⋯菜单可改。
- 区域收起 = **列宽塌陷到 0**（`--ts-side-l/-r`），不销毁面板；状态存
  `tokensave:desk-regions.v1`。
- 跨实例拖拽（**四个必要件，缺一即拖不动** —— 第 4 件是 2026-10-14 Step 13-M 补的）：
  1. `theme.dndOverlayMounting: 'absolute'` —— 不设它根级落点容器被禁用、浮层永不显示；
  2. **每个实例至少一个组**（空实例要 `addGroup` 预置，否则 drop 无处可去）；
  3. 回调必须用**运行时 API** 注册（`api.onUnhandledDragOver` / `api.onDidDrop`，
     放构造选项不生效），且**只 accept 外来载荷**（无条件 accept 会破坏同实例落点判定）；
  4. **dragend 兜底**：dockview 只在落点是**空组**时才把外来载荷交给我们的
     `onDidDrop`；落在**已有窗口的内容区**上时，事件被那个面板自己的落点吃掉
     （面板级 `_onDidDrop` 没人监听）就 return 了、组的 `handleDropEvent` 不跑。
     因此必须自己接：每实例 `onWillDragPanel` 记下拖动中的面板 id，document 捕获
     `dragend`（+ `pointerup` 兼容触摸）→ 按松手坐标 `elementFromPoint` 找
     `[data-desk-host]` → `moveWindowTo(id, region)`；已在目标区（dockview 已搬过）
     跳过、落在工台之外不动作。拖动期间 `body.ts-dock-dragging` 把 iframe 的
     `pointer-events` 关掉（预览面板是全插件唯一的 iframe）。
- ⋯ 菜单：每窗口三个区域按钮（点当前区=收起，点别区=搬过去）+ 全部打开 + 恢复默认布局。

**面板 id 命名（client/src/panel/desk-panes.ts，纯模块，可单测）**

- `<projectId>:<kind>` —— kind ∈ `preview | board | chat | talk | save`（单个项目）
- `<projectId>:exp:<sessionId>` —— 每个探索者一个面板
- 两个项目的面板因此天然不撞名（多项目不串台的第一道保障）。

**存储键**

| 键 | 内容 | 谁写 |
| --- | --- | --- |
| `tokensave:desk-dock.v2:<projectId>` | 该项目布局快照（dockview `toJSON`），300ms 节流 | DeskDock |
| `tokensave:desk-dock-lock.v1:<projectId>` | 该项目的布局锁（`1` = 锁定）—— **按项目分键**（旧全局单键首次读时迁移） | DeskDock |
| `tokensave:desk-saved.v2:<projectId>` | 用户「保存的默认布局」= `{regions, hidden, sideW}`（面板排布 + 收起区 + 两侧栏宽度） | DeskDock |
| `tokensave:desk-regions.v1` | **当前**收起的区域（全局一份，项目间共用） | DeskDock |
| `tokensave:desk-side-w.v1` | **当前**两侧栏宽度（全局一份） | DeskDock |
| `tokensave:desk-skin.v1` | 背景皮肤（全局一份） | DeskDock |
| `tokensave:desk-font.v1` | 界面字号档位 `s|m|l|xl`（全局一份） | DeskDock |
| `tokensave:desk-font-family.v1` | 字族 `default|sans|mono`（全局一份） | DeskDock |
| `tokensave:chat-view.v1:<sessionId>` | 每会话的阅读镜头（**按会话分键**；不带后缀 = 旧全局单值，向后兼容） | chat-view.ts |

**输入条策略（单项目）**

- **只用宿主原生 composer**（`[data-conversation-region="composer"]`，全页一座）：
  由 `client/src/panel/composer-dock.ts` 的 `useDockNativeComposer` 把它
  `position:fixed` **停靠进「DSH 主对话」面板**（向下锚定、内容向上生长）；
  面板关闭/组件卸载即还原原始行内样式，宿主在其它 tab 行为不变。
- 自建输入框（ProjectComposer / `sendToSession` 那条路）已按用户要求删除；
  `sendToSession` 本身仍在（黄灯「继续」等场景继续用）。
- `MainChat` 只读镜像本项目会话流；**会话由 DeskDock 决定并写回宿主**（2026-10-14
  Step 13-M 修正）：因为原生输入条永远属于**宿主当前会话**，两者不一致时草稿跟着
  宿主会话走、发消息也进宿主会话（「在 A 项目写的内容跑到 B 项目」）。因此：
  - `sid`（工作台主对话显示哪条）= 宿主当前会话**若属于本项目且非探索者**，
    否则回退「本项目最近的非空白会话」，本项目一条都没有时回退**空串**；
  - 一条对齐副作用：`sessionId !== sid` 时 `rememberOpenedProject(sid, project.id)` +
    `openSession(sid)` 把宿主切过去（本项目无会话则先开一条空白会话）。
  - `replaceMain` / `primeViewPreference` 仍不由 DeskDock 调用。

**dockview 使用口径（vendor 见 client/src/vendor/dockview.ts）**

- `vendor/dockview-core.min.js` 是 **UMD**，必须按文本取源 + `new Function(src)()`
  在全局作用域执行才会挂到 `globalThis['dockview-core']`（直接 import 会走 CJS 分支）。
- 实例参数：`theme:{name:'intel',className:'dv-intel',colorScheme:'dark',gap:0}`、
  `defaultRenderer:'always'`（非激活面板 DOM 不摘 → 背景项目保活）、
  `noPanelsOverlay:'emptyGroup'`、`disableDnd`（布局锁）、`tabComponent:'iconTab'`
  （只画线条图标）。
- 面板内容用 `createPortal` 渲染进 dockview 容器（单棵 React 树、无额外 root）。
- 能力（v8.5.1）：`addFloatingGroup`/`addPopoutGroup`/`createTabGroup`/`toJSON`/`fromJSON`/
  `dndCapabilities`/`setVisible`；**无** `api.options` 与 `api.floatingGroups`
  （读回锁状态用 `dndCapabilities`）。

**不变量**

- 引擎只有一个：`ControlRoom` 直接渲染 `DeskDock`（旧的 `grid` 回退开关已移除）。
- 快照按「整块」存（不是每项目一份）：多项目同屏时相对排布才有意义。
- 数据面仍按项目隔离（黑板/探索者/收益按 `workspace=`；消息按 `sessionId`）。

**UI 约定（2026-10-14 Step 13-M）**

- **窗口标题不出现拟物 emoji**：六类面板的标题条（`.ts-head-title` / `.ts-win-name` /
  `.ts-preview-title`）只写文字（「DSH 主对话 / 协作对话 / 协作收益 / 共享黑板 /
  探索者 / 项目预览」）；dockview 标签本身只画线条图标（`tabComponent:'iconTab'`）。
  测试 `窗口标题条无拟物 emoji` 会扫这六个文件的标题文本。
- 共享黑板标题行**没有**手动刷新按钮（原来那颗 emoji 图标已删）：黑板每 20s
  自动 `load(true)`。
- 状态栏左侧实时提示：只跑文字（不加「· 对话已完成」之类话尾，完成态由 `.ts-sb-dot`
  由蓝转灰表达）；异常结束仍加「· 本轮异常结束」；**不再固定截 42 字**（只压平换行 +
  400 字兜底），显示多少交给 CSS `text-overflow:ellipsis`，完整内容在 `title` 里。
- 会话控件（历史会话 / 新建会话）在**状态栏右侧**：「未锁定」左侧；它的下拉面板
  **自动向上/向下翻转**（控件在视口底部 → 向上弹），定位用 portal + `position:fixed`，
  内联必须显式写 `top:'auto'`（样式表里写死了 `top:calc(100%+6px)`）。

**UI 约定（2026-10-14 Step 13-N）**

- 右上角只有**一个「设置」齿轮**（`data-desk-settings`，图标 `gear`）——原来的 ⋯ 与
  皮肤两个按钮已合并；浮层 `data-desk-settings-panel`（class `.ts-set`）分三块：
  `data-desk-set-block="windows|skin|font"`（显示/隐藏窗口 · 背景皮肤 · 字体）。
  旧的 `data-desk-more` / `data-desk-skin-toggle` / `data-desk-pop` / `data-desk-skin-panel`
  已废弃（测试同步改了）。
- **字体调控**：`--ts-fs`（字号，默认 12.5px）与 `--ts-font`（字族）写到 `:root`；
  插件所有视图的 CSS 一律用 `font-size:calc(var(--ts-fs, 12.5px) * 比例)` 与
  `font-family:var(--ts-font, inherit)` —— 大小比例 = 原始 px / 12.5，改字号时全 UI 等比缩放。
- **侧栏把手照 info_report**：命中区 8px 全透明（没有整条背景色块）；悬停/拖动只显示
  `::after` 中性短杠（2×40 → 悬停 62px）；区域收起后改成 `::before` 4×26 小短杠
  （灰 → 悬停主题蓝）提醒「可从窄缝拉出」。
- **锁定按项目**：状态栏「已锁定/未锁定」读写的都是 `…lock.v1:<projectId>`。

**UI 约定（2026-10-14 Step 13-O）**

- **标题行左侧**：图标即「项目切换器」（`data-desk-projswitch` → 浮层 `data-desk-projsw-panel`，
  每行 `data-desk-projsw-item=<projectId>`，点击 `enterProjectWorkbench(id)`）；
  项目名只留文字（`.ts-title-proj` 无边框无底色，**没有** `workbench` 后缀）。
- **右上角按钮**：区域三键（`data-desk-region-toggle=left|center|right`，class `ts-tg--region`）+
  探索者设置（`<ExplorerSettings variant="icon" />`，`data-desk-explorers` + `.ts-tg-badge` 计数）+
  设置齿轮（`data-desk-settings` → 浮层 `data-desk-settings-panel`，宽 238px）。
- **区域三键的状态表达**：只看图标内部那块**填充**（`regionIconSvg(region, on)`：显示 =
  `fill="currentColor"`，隐藏 = `fill="none"`）；**不用蓝色、不用外框**
  （`.ts-tg--region[data-on]` 已显式压掉通用 `[data-on]` 的蓝底蓝框）。
- **一体化**：区域之间不画分割线（`.ts-region` 无 border）、标题行无 `border-bottom`、
  状态栏无 `border-top`；三张面板卡（`.ts-board`/`.ts-talk`/`.ts-save`）透明无边框，
  只留一条很淡的表头下边线。改外观请沿用这个口径，别再往卡片上加底色。
- **窗口标签右键菜单**：为跳出 `overflow:hidden` 会被搬到 `body`（`data-ts-hoisted="1"`），
  因此外观**必须**由 `.dv-context-menu[data-ts-hoisted="1"]` 自己写死（dockview 的 `--dv-*`
  变量在 body 上不继承），关闭也由 DeskDock 自己的监听负责（点外部 / Esc / scroll /
  resize / blur / 点菜单项后 `setTimeout(0)`），坐标要夹进视口。
- **项目预览默认落编辑区**：`KIND_REGION.preview = 'center'`，并且**分屏**摆在主对话左边
  （`buildDefault` 与 reconcile 的 `ensure` 两处都按 `{direction:'left', referencePanel: chat}`），
  绝不允许当标签页塞进主对话那一组（会把主对话盖住 → 宿主输入条悬在预览上）。
  存量布局由一次性迁移 `tokensave:desk-preview-in-editor.v1:<projectId>`（值 `v2`）归位。
- **输入条可见性兜底**：主对话卡不可见时加 `body.ts-desk-nochat`（与 H 台的
  `ts-hdesk-nochat` 同一套 CSS），把宿主 `[data-conversation-region="composer"]` 整条藏掉。
- **侧栏拖拽性能口径**：拖动期间**禁止 setState**——只写 `--ts-side-l/-r` 与 `data-hide-*`，
  `pointermove` 用 rAF 合并，松手（含「同帧内按下即松手」）才 `applyRegions`/`applySideW`
  同步一次 React 状态。`PULL_OUT_W = 12`。
