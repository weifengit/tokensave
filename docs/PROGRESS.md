# 开发进度

## 当前阶段
全部完成（Step 00–12 于 2026-10-06 发布 0.0.1；Step 13–69 工作台迭代于 2026-10-16 发布 v0.1.0，此后进入维护期，版本与变更以 CHANGELOG.md + git 历史为准）。

## 已完成
（Step 00–12 逐步实录与 Step 13–69 开发日志已删除——内容已分别沉淀进 CHANGELOG.md / docs/MAINTENANCE.md / MEMORY.md，全文见 git 历史或本地备份；不要再在此追加长篇实录。）
- [x] Step 00–12 完成于 2026-10-06：插件骨架、系统提示词注入、场景识别、tokensave_delegate 工具、并行探索、黑板读写、模型路由、编排、浮窗可观测、打包安装（验收细节见发布说明与 git 历史）
- [x] Step 13–69 完成于 2026-10-11~10-16：控制室 + H 型工作台 → dockview 工作台（多区布局 / 主题皮肤 / 输入条 / 状态栏 / 项目中心 / 会话控件 / 手机端适配 / 浅色模式），v0.1.0 已发版

## 接口冻结记录
（当某步冻结了某个接口，在这里记录。示例：`- 2026-10-XX Step 05 冻结 tokensave_delegate 输出 schema，后续步骤不得修改`）
- 2026-10-06 Step 05 冻结 tokensave_delegate 输入/输出 schema（与 CONTRACTS.md 逐字一致：task_description 必填 / file_path 可选 / explorer_count 默认 3；输出 brief+scenario 双必填字段），后续步骤不得修改
- 2026-10-06 Step 06 更新并冻结 EXPLORER_PRESETS 三槽（deepseek-web/deepseek-chat、our-free-model/mimo-v2.6-flash-free、opencode-zen/deepseek-v4-flash-free，经用户确认），后续步骤不得修改
- 2026-10-06 Step 09 更新并冻结 EXPLORER_PRESETS 第 3 槽为 our-free-model/nemotron-3-ultra-free（替换 opencode-zen/deepseek-v4-flash-free，经用户确认；前两槽不变），后续步骤不得修改

## 已知问题
（记录阻塞项，下个 Step 开始前先解决）
- qwen 接入已关闭（2026-10-06 Step 06 定案）：qwen-web-arwaky 为 Python 项目无法作为插件加载（历史经过见 Step 01 记录）；经用户确认 EXPLORER_PRESETS 无需独立 Qwen 接入，新组合为 deepseek-web + our-free-model + opencode-zen（详见 CONTRACTS 变更注记），本条不再阻塞后续步骤
- 兼容豁免：@phillarmonic/dsh-llm-kimi@0.1.6-alpha.1 已因启动故障于 2026-10-06 卸载并撤销豁免（见下条）；现存豁免仅 dsh-llm-call-inspector@0.2.1（peer 钉 dsh-llm 0.1.2-alpha.2 ≠ 运行时 0.2.0-rc.2，已按用户指示显式接受风险）。若出现崩溃/异常，先从 bundles 禁用 call-inspector 排查
- 2026-10-06 事故记录：@phillarmonic/dsh-llm-kimi 导致刷新页面后 DSH 无法启动（其宿主半区在启动日志中可正常激活，故障发生在 client 半区的 manifest 合成/执行环节），用户已执行 `dsh plugin --profile web remove @phillarmonic/dsh-llm-kimi` 卸载。核验：dependencies / bundles（19→18）/ pnpm-lock 均已清；孤儿空目录 node_modules/@phillarmonic 已删；compatibility.json 的 kimi 豁免条目已手动移除（CLI 无撤销命令，JSON 已验证）。实测 client manifest 为实时合成：卸载立即生效（kimi 0 出现、dsh-tokensave 条目完好），干净 profile 重启后仅剩 call-inspector 警告。影响：EXPLORER_PRESETS 的 kimi-web/free 彻底无提供方，Step 06/08 需与 DeepSeek/Qwen 一并重新选型免费模型接入
- EXPLORER_PRESETS 模型 id 问题已解决（2026-10-06 Step 06）：CONTRACTS 已按用户指示更新为三组真实 id（deepseek-web/deepseek-chat、our-free-model/mimo-v2.6-flash-free、opencode-zen/deepseek-v4-flash-free），headless 实测三 id 均顺利通过 session_create 创建与派发；注意创建不校验 provider 真实可用性——Zen 档凭据问题见下，Step 08 路由配置时以本组 id 为准
- 客户端 bundle 完整契约（2026-10-06 补充：3081 实测报 `dsh-tokensave: import failed` 后查实并修复）：client-modules 直接 readFileSync 原样下发入口字节，无任何转译；且 bundle 以 **classic script** 执行，必须是 `window.__ModuleLoader__.load({ id, factory })` 注册格式（`factory(require) → exports`，参照 dsh-deepseek-web-login/lib/client.js），裸 ESM `export` 会在浏览器报 import failed（此前只测了 ESM 解析，漏了这一层）。client/src/index.ts 已按注册格式手写并通过三层验证：tsc、node --check（经典脚本解析）、模拟 __ModuleLoader__ 注册执行（id/factory/exports.inject、exports.apply 均正确）；实测服务端实时下发新 rev、字节与源码一致。字面违反 step-02「不碰 client/」，属文档约束与运行时能力冲突，已备案。Step 11 必须遵守：零 TS 语法 + 注册格式，或引入构建产物（共享 tsdown client preset / exports `./client` 指向编译后 JS）
- dsh-llm-call-inspector 启动时激活失败（warning，不阻断启动）：`cannot get property "webServer" without inject`——Step 01 豁免的 peer 不匹配在 0.2.0-rc.2 的具体兑现，该插件功能当前不可用。等上游修复或从 bundles 移出
- 主 GUI（127.0.0.1:3080，PID 66642）未加载 tokensave（其启动不含 --patch 调试层）；Step 02 的 3081 调试实例已按用户要求于 2026-10-06 关闭，后续步骤验证改用 `dsh --profile headless --patch ...`（不占端口、开销更低）；需要 Web UI 调试时用 `dsh --profile web --patch /Users/sonoma/code/tokensave/cordis.patch.yml --port 3081 --no-open` 重起；Step 12 打包安装进 profile 后主 UI 才会原生加载
- 宿主端运行时导入契约（Step 03踩坑）：插件源码由 Node ESM + type stripping 直接 import，**相对导入必须带 .ts 扩展名**（如 `./prompt/system-prompt.ts`，否则 failed to import；tsconfig 已开 allowImportingTsExtensions），type-only 导入会被擦除不影响运行时。后续 Step 接线新模块时必须遵守
- Step 04 实现偏差（文档 API 过时第 3 例）：`ctx.tools.call('list_dir', {path})` 在 0.2.0-rc.2 不存在——ToolRuntime 无 call 方法（公开 API 为 execute(exec)），且全库查无 list_dir 工具。已改用 node:fs/promises.readdir 读 cwd 根目录，检测行为与策略表一致；读取失败按无项目标记处理（文档未覆盖的边界）。CONTRACTS 未冻结读取机制，接口契约未变。后续 Step 需程序化调用工具时，按 KB cordis-tutorial/07-into-the-harness.md：`ctx.tools.execute({ callId: brandString<ToolCallId>(...), name, arguments, signal })`（brandString 来自 @deepseek-ai/dsh-brand，ToolCallId 来自 @deepseek-ai/dsh-llm——均需装为运行时依赖才能 import）
- Step 05 实现偏差（文档 API 过时第 4 例）：exec.sessionId 在 0.2.0-rc.2 的 ToolRunContext/ToolExecution 上不存在；正道是 `exec.agent?.session.id`（Agent.session: Session 为活会话，SessionId 品牌类型可直接赋给 string）。另注：模型收到的是 render 投影（按 CONTRACTS 仅 brief 文本），规范值含 brief+scenario 双字段、已经过 output.schema 校验后才渲染——测试中模型疑惑「没有两个字段」属预期行为，非 bug
- opencode-zen 免费档凭据未配置（2026-10-06 Step 08 实测加深）：插件激活正常，但路由注册以凭据为门槛——无 OPENCODE_API_KEY 时 adapter 根本不注册，直调返回 NO_ADAPTER（连 MISSING_CREDENTIAL 都到不了）。Step 10 真跑探索者简报前需用户在设置页/env 配置 key（密钥不经过本会话），或临时将 EXPLORER_PRESETS 第 3 槽换为其他免费模型。同批实测：deepseek-web 登录态 ✓（真实回复 3391ms）、our-free-model ✓（真实回复 3268ms）
- Step 06 实现偏差（文档 API 过时第 5 例）：session_create 真实参数为 title / initial_message / model（无 workspace/prompt），返回 { success, sessionId, ... }（非 .id）；session_call 真实参数为 target_session_id / message / call_type（枚举 task_dispatch/task_report/notice，非 mode:'steer'）。另：dsh-call-session 的 session-directory.mjs:74 用无守卫的 ctx.get('workspaceRegistry')，在缺 dsh-workspace 提供方的 profile（如裸 headless）session_create 会抛 'cannot get property workspaceRegistry without inject'——web profile 组件齐全不受影响；headless 复现测试需补 dsh-workspace insert（本次已验证可行，临时叠加层测后已删）
- Step 07 实现偏差（文档 API 过时第 6 例）：board_list 无 `mode:'digest'` 参数——真实参数为 id / topic / topic_prefix / tag / active_only / cross_workspace / titles_only（默认 true）/ limit。语义映射：digest → titles_only:true（返回标题+tags+metadata，不含 content 正文）。**Step 10 注意**：titles_only 投影不含正文，届时消费 L3 简报正文需 titles_only:false 或按 postId 拿全量（metadata.digest 始终随行可作摘要）。board_post 参数（topic/content/metadata/ttl）与文档吻合 ✓，黑板为工作区作用域（cross_workspace 默认 false）
- Step 08 实现偏差（文档结构过时第 7 例）：① settings.yaml 在 0.2.0-rc.2 是一次性迁移通道（启动时改名 .imported 并按 section→entry 导入），section 名必须等于 profile entry id——`fallbacks:` 必须写成 `llm-fallbacks:`（无 legacy 映射，旧名被静默跳过，首试踩实）；② 0.6.5 真实结构为 rootChain + roles.list[]（id/persona/chain/fallback），文档的 roles:{name:{chain,tail}} 与 per-role tail 不存在；③ 链尾 deepseek-v4-flash 已退役，合法尾为 deepseek-official/deepseek-flash 或 deepseek-v4-pro（本配置取后者）；④ roles 无 rules 时仅声明不生效，而 rules 只匹配子代理——Step 06 探索者是 root 会话，实际故障切换走 rootChain（README: Rules never match root requests）；⑤ 官方链尾 deepseek-v4-pro 需 DEEPSEEK_API_KEY（当前未配置）——仅当三个免费模型全挂才会走到，暂不阻塞；⑥ deepseek-web 对 one-shot 纯字符串 content 映射为空（回复内容可辨），连通性/鉴权/流式均已证实，非阻塞
- **探索者轮次驱动缺失（Step 10 核心发现，Step 11 必须验证）**：session_create 的 initial_message 经 followup 入队，但 dsh 0.2.0-rc.2 下程序化创建的 root 会话**没有 driver 认领**——无论是否透传 callerAgent（实测均 4 事件死会话：header+权限，无 inbox/splice、无任何轮次事件；主会话有完整 splice+turn 事件可对比）。KB 证实 followup 只保证 inbox 持久插入，轮次需 driver 认领（root 会话的 driver 来自附着/接管）。`dsh --profile headless --session-id <id> "任务"` 接管可驱动（实测探索者轮次逻辑完全正常，pit/sol 产出 ✓）。影响：Step10 验收3经接管达成；生产链路预计 Step11 浮窗附着后驱动探索者——Step 11 必须实测附着能否启动已创建探索者的首轮，否则需向平台/上游确认后台 root 会话 driver 机制
- **探索者死会话根因已定位并绕过（2026-10-06 Step 11 实测 / Step 11.1 解决）——上条「缺 driver」结论已修正**：① 首轮不缺 driver：web profile 探针实测 session_create 的 initial_message 派发即唤醒（claim 事件先于 session_call 返回、session_call 应答 targetStatus=running 且 deliveryMode=steer）——「需附着驱动首轮」前提被推翻；② 真正阻塞：dsh-call-session@0.1.6 的全部消息（initial_message 见 peer-bootstrap.mjs:77、session_call 见 session-call.mjs userMessage）source.kind='plugin'，被 dsh-session-format-v3-to-v4@0.2.0-rc.2 lib/index.js:126 显式拒绝（"format v4 message requires a producer-owned source kind"，kind==='plugin' 在黑名单）→ pre-step 认领批次被拒、turn 空转（agent/error→turn/end，无 user/assistant/request 事件；持久日志停留 header+权限 4 事件，与 Step 10 签名逐字一致；日志与 inbox 插入进程内未刷盘，杀进程即丢——Step 10 headless「无 splice」部分源于该观测口径）；③ 附着（promote→resolveAgent）唤醒挂起消息：代码面 wakeDriver 仅由 send / runMaintenance 收尾 / kick 续跑三处触发，resume 路径无唤醒点（静态分析；首轮不依赖附着，此项仅跨重启场景才有意义）；④ npm 最新即 0.1.6（2026-09-23）无修复版。⑤ **已按用户决策以宿主侧绕过解决（Step 11.1，见已完成条目）**：parallelExplore 改为 createUserMessage(kind:'user') 直投 followup/steer，端到端实测两探索者真实轮次、零 agent/error、日志 source={'kind':'user'} 落盘、黑板产出并自行归档；tokensave 已不依赖 dsh-call-session 的消息路径（session_create 仅用于建会话），上游仍待修复（对其他调用方仍投毒）
- 会话日志是多帧拼接的 .jsonl.zstd：Node 的 zstdDecompressSync 只解首帧（曾导致“会话无消息”误判）——诊断用 `zstd -d -c`（Homebrew 已装）解开全部帧（主会话 25-39 事件 vs 死会话 4 事件即此法看出）
- 黑板语义补充（Step 10 实测）：① 有会话上下文时 board_list 按工作区作用域过滤且 scope 取会话 cwd（规范化 /private/tmp 与进程 cwd /tmp 不一致会互相看不见），无会话上下文（插件 root 查询）scope=unknown 全局可见；② 黑板跨进程持久（历史条目可见，验证需时间窗防 stale）；③ 会话任务完成后的内置“清理提醒”会把条目归档——查询历史需 active_only:false
- our-free-model 已升级 1.3.1→1.4.6（2026-10-06 Step 12 排查 fetch failed 反复发作时执行，经插件自带升级器：jsdelivr **tag 钉源**（@main 的 client.js 已被作者新提交漂移、哈希对不上清单——上游清单未钉 commit 的小缺陷）+ 逐文件 sha256 校验 + 内置回滚备份，32 文件安装成功）。代码级根因：本机 1.3.1 用裸 fetch 直连 opencode.ai，出网路径在本网络间歇被断（同机直连测试 5/5 与 10 并发均 200、失败呈时间簇状——上游/链路侧抖动）；1.4.6 新增 src/egress.js 出网层（egressFetch：可配 http/socks5 代理客户端或 mihomo 订阅出口、10s 拨号超时）+ src/recovery.js + 错误分类修正（HTML 错误页/签名拒收→transport，issue #50/#63），落后上游 15 个版本一并补齐。注意：① 运行中进程持有旧代码，需重启 DSH 才生效（与 tokensave 原生加载同一时机）；② 本机当前无代理监听，egress 暂为直连——后续如有代理客户端/订阅可在 our-free-model 设置页开启出口进一步加固；③ github 直连被墙、升级走 jsdelivr（与 Step 06 一致）

## 发布说明（Step 12，2026-10-06）

**dsh-tokensave 0.0.1** —— DSH 多探索者任务委派插件：并行免费模型探索（DeepSeek/MiMo/Nemotron）+ 黑板沉淀（requirement/pitfall/solution/brief）+ 交叉验证简报回流（tokensave-brief 标记）+ 浮窗可观测（N 探索者实时对话流、storageKey 隔离、老板键 Alt+S→X→Z、几何持久化）。

### 本机安装状态
- 已安装：`dsh plugin --profile web add /Users/sonoma/code/tokensave`（link 形态，dsh.profile.bundles 自动注册，cordis.patch.yml 包名形态自动加载）
- 生效验证：启动 web profile 见 `[dsh-tokensave] plugin loaded!` 即可；跨项目实测（/tmp 空目录）全链路通过
- 开发调试：安装后不再需要 `--patch`（直接 `dsh --profile web --port 3081 --no-open`）

### 发布到 npm（可选，暂未执行）
1. package.json 移除 `"private": true`（当前阻止 publish）
2. `pnpm publish`（注意先 `pnpm run build:client` 确保 dist/client.js 为最新，无 files 字段默认全量打包）
3. 他人安装：`dsh plugin --profile web add dsh-tokensave`

### 最终用户使用方式
安装后在任意项目的 DSH 聊天窗口直接说：
- “请调用 tokensave 帮我初始化这个应用”
- “请调用 tokensave 分析这个 bug 的修复方案”
- “请调用 tokensave 帮我设计新功能的实现路径”
DSH 读取全局系统提示词段（tokensave-delegation）→ 调用 tokensave_delegate → 按 cwd 场景识别 → 并行探索 → 黑板沉淀 → 简报回流 → DSH 按简报执行；探索者以独立浮窗实时显示对话流。

### 已知限制（继承自已知问题清单）
- dsh-llm-call-inspector 未修复前 LLM Calls 视图不可用（简报以会话日志可搜 tokensave-brief 为代理证据）
- dsh-call-session@0.1.6 对第三方调用方仍投毒（v4 拒 source.kind='plugin'），tokensave 已宿主侧绕过不依赖其消息路径
- our-free-model mimo 通道偶发上游抖动（fetch failed/高 TTFT），rootChain 与探索者重试可部分自愈
- 浮窗实机外观/Alt 键交互为浏览器目检项（源码与冒烟已验，见 Step 11 验收）

## 历史逐步实录（已归档）

原第 77–3955 行为 Step 13–69 的逐篇开发实录（约 30 万字符），2026-10-16 瘦身删除。
- 版本级变更摘要：CHANGELOG.md（release.mjs 自动维护）
- 维护规则与踩坑速查：docs/MAINTENANCE.md
- 宿主接口契约实测记录：docs/CONTRACTS.md
- 全文：git 历史（本文件瘦身前的提交）
