# 开发进度

## 当前阶段
全部完成（Step 00–12，2026-10-06）

## 已完成
（每完成一步，在这里追加一行，格式：`- [x] Step XX 完成于 YYYY-MM-DD，产出：xxx，遗留：xxx`）
- [x] Step 00 完成于 2026-10-05，产出：目录骨架 + 空实现（src/ 9 个文件 + client/src/ 4 个文件 + tests/ 目录），package.json（仅 check 脚本 + 基础依赖，无 dsh 字段）+ tsconfig.json，`pnpm run check` 通过，types.ts 与 CONTRACTS.md 一致，遗留：无（业务逻辑按约定留待后续 Step）
- [x] Step 01 完成于 2026-10-05，产出：环境验证全部通过（node v24.14.0 / pnpm 12.5.1 / dsh 0.2.0-rc.2，`pnpm dsh --version` 有输出）；web profile 安装 dev-kb + dsh-call-session 0.1.6 + dsh-llm-fallbacks 0.6.5 + dsh-hashline-edittool 0.9.5 + dsh-float-window 0.4.1（≥0.2）+ dsh-deepseek-web-login 0.6.38 + dsh-llm-call-inspector 0.2.1 + @phillarmonic/dsh-llm-kimi 0.1.6-alpha.1，CONTRACTS 四项核心依赖全部就位；hashline/deepseek-web-login/call-inspector/kimi 已登记 dsh.profile.bundles（共 19 项，profile 树按 bundles 组装），float-window 为共享组件库按普通依赖形态安装；tree-sitter 构建脚本已批准（pnpm-workspace.yaml allowBuilds）；`pnpm run check` 通过。遗留：qwen-web-arwaky 无法安装（见已知问题）
- [x] Step 02 完成于 2026-10-06，产出：package.json 补齐 main / dsh.bundle.patch / dsh.client / peerDependencies（dsh.client 按运行时 0.2.0-rc.2 要求改为对象 `{"platform":"web"}` 并新增 `exports["./client"]`，step 文档的字符串形态是旧版写法，见已知问题）；项目 cordis.patch.yml（insert 挂载宿主入口）；src/index.ts 加载日志；调试实例 `dsh --profile web --patch .../cordis.patch.yml --port 3081 --no-open` 启动成功：终端打印 `[dsh-tokensave] plugin loaded!`、页面 HTTP 200、`__DSH_BOOT__` 含 dsh-tokensave 条目、client bundle 通过 JS 模块解析、`--dump-config` 含配置行、`pnpm run check` 通过。遗留：3080 被现有 GUI 占用（调试实例在 3081）；浏览器控制台为静态验证（见已知问题）
- [x] Step 03 完成于 2026-10-06，产出：registerSystemPrompt 按 CONTRACTS 实现（`ctx.systemPrompt.section({name:'tokensave-delegation', order:150, text:…})`，以 `satisfies PromptSection` 钉官方位约）；src/index.ts apply 中调用；新增 devDep @deepseek-ai/dsh-system-prompt@0.2.0-rc.2（Context.systemPrompt 声明合并来源，type-only 引入不产生运行时依赖）；修复宿主相对导入缺 .ts 扩展导致的 failed to import（tsconfig 加 allowImportingTsExtensions，见已知问题）。验证：`pnpm run check` ✓；3081 重启后插件激活、无新报错（仅剩已知 call-inspector 警告）；**headless 端到端实测通过**（用临时叠加层 /tmp/tokensave-headless-model-overlay.yml 借 web 免费模型，未改 headless profile）——新会话问「你能看到 tokensave 吗」，模型回答「能——我在系统提示的 tokensave 能力说明和工作目录 … 中看到的」，证明 section 已注入并进入新会话组装后的系统提示。遗留：设置→系统提示词视图可浏览器抽查（与实测同源）
- [x] Step 04 完成于 2026-10-06，产出：detectScenario 实现（ctx.sessions.get 取冻结 cwd → 读 cwd 根目录检测 PROJECT_MARKERS → editKeywords 判定编辑意图，与检测策略表四行一一对应）；PROJECT_MARKERS / editKeywords 从 types.ts 契约单一来源导入（避免双源漂移）；devDep 新增 @deepseek-ai/dsh-session@0.2.0-rc.2（Context.sessions 声明合并 + SessionId 品牌类型，type-only 引入）与 @types/node。验收：临时测试 3 用例全过（空 sessionId → from_scratch；真实项目目录 +「修复登录bug」→ edit_existing；真实项目 + 无意图 → from_scratch），测试文件已按验收标准第 3 条删除；`pnpm run check` 通过。遗留：文档 ctx.tools.call('list_dir') 在 0.2.0-rc.2 不存在（见已知问题）
- [x] Step 05 完成于 2026-10-06，产出：tokensave_delegate 工具按 CONTRACTS 完整实现（parameters / output.schema / render 与 0.2.0-rc.2 的 ParameterSchemaSpec、ObjectValueSchemaSpec 逐字吻合），工厂函数形态 createTokensaveDelegateTool(ctx)（step-05 注意事项方案二，execute 需闭包 ctx），src/index.ts apply 中 ctx.tools.register 接线，execute 只调 detectScenario 返回占位 brief；runtime dep 新增 @deepseek-ai/dsh-tools@0.2.0-rc.2（defineTool 为值导入）。验收（headless 端到端 ×2，含完整工具注册链路）：① 新会话模型成功看到并调用工具（工具列表可见）；② 返回「[占位] 场景=edit_existing，任务=修复登录bug」；③ 两次调用均无 schema 校验错误（exit 0）；④ 同参数在空目录 cwd 返回 from_scratch——scenario 随 cwd 变化。`pnpm run check` 通过。遗留：exec.sessionId 文档 API 过时（见已知问题）
- [x] Step 06 完成于 2026-10-06，产出：parallelExplore 实现（Promise.all 并行 session_create → Promise.allSettled 派发 session_call → 返回 {sessionId,label}[]，prompt/message 构造按文档原文；经 ctx.tools.execute + brandString<ToolCallId> 走 0.2.0-rc.2 正规调用路径，callTool 统一封装错误处理）；EXPLORER_PRESETS 经用户确认更新（CONTRACTS 先行 + types.ts 同步）：deepseek-web/deepseek-chat + our-free-model/mimo-v2.6-flash-free + opencode-zen/deepseek-v4-flash-free，asd 网关（GLM/豆包）已退订作废；环境：dsh-opencode-zen@0.3.5 装入 web profile（npm 镜像装因 github 直连被墙、peer <0.1.8 豁免经用户指示接受、@google/genai+protobufjs 构建已批、bundles 经 remove+re-add 补登）；runtime dep +@deepseek-ai/dsh-brand、devDep +@deepseek-ai/dsh-llm。验收（headless 探针端到端，测试文件/叠加层测后已删）：① session_query 看到 3 新会话；② 3 会话分别 3 个不同 model；③ 并行总耗时 20ms < 1.5×最慢单个 16ms（比值 1.25）；④ `pnpm run check` 通过。遗留：opencode-zen 凭据未配置（见已知问题）
- [x] Step 07 完成于 2026-10-06，产出：postToBoard / getBriefFromBoard 实现（封装 board_post / board_list 工具，本地 callTool 走 ctx.tools.execute + brandString<ToolCallId>；ttl 可选、undefined 不下发让工具落默认 3600；getBriefFromBoard 的 mode:'digest' 按等价语义映射为 titles_only:true），BoardTopic / BlackboardEntry 类型保持 CONTRACTS 原样未动。验收（headless 探针端到端，测后文件已删）：① 3 个 topic 各发一帖后按 topic 全部查到（postIds 齐验）；② metadata 完整（source/confidence/digest 三字段实测匹配）；③ topic 互不隔离验证过（每 topic count=1、两两交集为空）；④ 附加：ttl 透传生效（expiresAt 有值）、摘要模式 titlesOnly=true、`pnpm run check` 通过。遗留：board_list 无 mode 参数（见已知问题）
- [x] Step 08 完成于 2026-10-06，产出：模型路由配置落库（纯配置步，src/ 未动）。经 $DSH_HOME/settings.yaml 官方迁移通道写入 dsh-llm-fallbacks@0.6.5 配置，web profile 启动导入激活：rootChain = deepseek-web/deepseek-chat → our-free-model/mimo-v2.6-flash-free → opencode-zen/deepseek-v4-flash-free → deepseek-official/deepseek-v4-pro（链尾恰好一个官方 V4）；roles.list 声明 free_explorer（三免费模型链）与 executor（官方 V4 Pro）两个角色。验收：① free_explorer 链完整（settings.yaml.imported 留档 + dump-config 实测激活双确认）✓；② 链尾恰为官方 V4 模型（v4-pro，doc 二选一中 v4-flash 已退役的存活者）✓；③ deepseek-web 发消息实测通（3391ms 真实中文回复）✓；④ 三个免费 provider：our-free-model ✓（3268ms 回复 OK）+ deepseek-web ✓ + opencode-zen ✗ NO_ADAPTER（凭据门槛）= 2/3，zen 阻塞项见已知问题。附：旧 settings.yaml.imported 已备份为 settings.yaml.imported.bak-20261006；测试探针/叠加层测后已删；`pnpm run check` 通过。遗留：zen 凭据与官方链尾 key（见已知问题）
- [x] Step 09 完成于 2026-10-06，产出：hashline 编辑插件集成验证（dsh-hashline-edittool@0.9.5 已于 Step 01 装入并登记 bundles，本步纯验证：src/ 未动、未装第二个编辑插件，smarter-edit 未装 ✓）；另按用户指示将 EXPLORER_PRESETS 第 3 槽由 opencode-zen/deepseek-v4-flash-free 换为 our-free-model/nemotron-3-ultra-free（CONTRACTS 先改 + types.ts 同步 + 变更注记追加；zen 凭据后续再配置，rootChain 免费链保留 zen 条目）。验收（headless 探针 ×2，测后文件/叠加层已删）：① 插件安装成功无冲突（list ✓、经 insert 注入 headless 无任何激活警告）；② 模型编辑无旧代码回显——两轮对话模型均只回复 DONE、输出无旧代码；推理显示使用 hashline 锚点 edit（'replace op' 语义，源码证实其参数为 path/edits/line_numbers 无 old_string；agent 自有层注册遮蔽全局原生 old_string 编辑器，探针全局视图所见 edit=原生属预期而非冲突）；③ 编辑后文件内容正确（line-B→line-B-EDITED，A/C 完好，两轮均验）；附加：nemotron 新槽直调 PASS（5959ms 回复 OK）；`pnpm run check` 通过。遗留：our-free-model 对 nemotron 要求 content=blocks 数组（字符串报 content.some 错，探针已修）；zen 凭据待用户后续配置
- [x] Step 10 完成于 2026-10-06，产出：executeWorkflow 完整实现（阶段1 node:fs 读文件→requirement 上板（超长截断当 relevant）；阶段2 parallelExplore；阶段3 crossValidate=有界等探索者写板 240s + 评审模型 mimo 直取文本 + 失败兑底拼摘要；阶段4 wrapBriefWithMarker→brief 上板 ttl3600）；smart-delegator execute 接线 detectScenario→executeWorkflow→{brief,scenario}（explorers 不入 schema 返回值，见已知问题）；parallelExplore 增加 agent 透传（CONTRACTS 补记签名；devDep +@deepseek-ai/dsh-agent 类型）。验收（全链路 headless 实测，探针/叠加层/fixture 测后已删）：① brief 含 tokensave-brief 标记 ✓（场景一/二双验、模型原文输出、黑板 hasMarker、会话日志 2 hits）；② 场景二先读文件→并行→简报 ✓（requirement=app.ts 真实内容预览、顺序 req t9s < brief t310s、评审者全程真实产出）；③ 黑板四类同框 ✓（requirement=3/pitfall=2/solution=2/brief=3，active_only:false 全量核验；pit/sol 由 --session-id 接管驱动探索者产出，其轮次逻辑本身正常）；④ tokensave-brief 入会话日志可搜 ✓（多帧 zstd 解码验证；LLM Calls UI 视图依赖已知损坏的 call-inspector，以日志可搜性为代理证据）。过程排雷：agent 曾误入 arguments 致序列化失败（已修正为 execute 顶层字段）、探针 stale-brief/就绪竞态（已修）、探索者无 driver（见已知问题）。遗留：探索者轮次驱动待 Step 11 附着验证；评审者空数据时简报质量下降（已如实标注待探索状态）
- [x] Step 11 完成于 2026-10-06，产出：客户端浮窗可观测性按 step 文档实现（client/src/index.ts 会话作用域 Probe + float/mount.tsx（shell.overlay 主挂载点、8s 未就绪降级 header.actions）+ ExplorerStream + BriefViewer + 新增 session-subscribe.ts 订阅层）；构建链路兑现 Step 02 已知问题预留的「构建产物」路径（scripts/build-client.mjs：esbuild 打包为 __ModuleLoader__ classic-script 注册格式 → dist/client.js，package.json exports["./client"] 指向之，build:client 脚本；devDep +esbuild / @types/react / react@18.3.1 / dsh-float-window@0.4.1），产物外部仅 react + react/jsx-runtime（均为平台种子词）；**关键契约修正**：binding.eventSource 为 ObservableSnapshot——subscribe 回调是不带数据的失效通知、须 getSnapshot() 读 {entries} 全量重建，文档占位 subscribeSession 的首版实现（在回调里取 x.event）永远收不到消息，已按 0.2.0-rc.2 真实类型重写（durable 事件投影 + transient text-delta 按 attemptId 累积、settle 自然去重 + 同会话共享流退订不关闭）；step 文档 ctx.on('tool/result') 挂窗方案偏离为 Probe 槽位发现（tool/result 是会话事件非 Cordis 事件、且 explorers 不在冻结输出 schema——useSessions 按 tokensave-* 标题前缀发现探索者挂 N 窗，订阅当前会话流捕获 tokensave-brief 标记挂简报窗，同一简报只挂一次）。验收：① pnpm run check ✓；② bundle 冒烟 ×6 ✓（classic-script 注册 / factory 物化仅种子外部 / apply 接线 / N=3 浮窗原子挂 shell.overlay + 无关会话过滤 / storageKey=tokensave:explorer:${sessionId} 逐字合规 + title/accent/bossKey 透传 / 幂等）；③ 订阅契约测试 ✓（窗口投影、简报标记可见、失效→getSnapshot→全量重推、退订停推）；④ 3081 服务链路实测 ✓（__DSH_BOOT__ 含 dsh-tokensave 于 application 批次、/plugins/dsh-tokensave/client.js 下发=本地构建+平台 sourcemap 尾巴逐字一致、仅剩已知 call-inspector 警告）；⑤ 老板键/几何持久化源码级确认 ✓（BOSS_KEY_POOL 自动分配 + window.__dshFloatWindows 注册表 + localStorage[storageKey] 隔离）；⑥ 驱动探针实测（见新已知问题：首轮创建即唤醒、死会话根因=v4 拒绝 plugin source）。遗留：真实浏览器浮窗出现/实时流/Alt 键交互为手动核验（3081 已关，重起命令见已知问题）；LLM Calls 视图验收项依赖已知损坏的 call-inspector（代理证据=Step 10 日志可搜 + 本次订阅投影含标记）；工作区留有探针空壳会话「tokensave-驱动探针」（session-cfd19e5a，4 事件）可在 GUI 归档删除
- [x] Step 11.1 完成于 2026-10-06（用户决策：宿主侧绕过），产出：parallelExplore 改造——session_create 不再带 initial_message；新增 dispatchExplorerMessage：createUserMessage({ content:[{type:'text',text}], source:{kind:'user'} })（@deepseek-ai/dsh-llm，平台 dsh-acp 同款构造）+ 按 agent.status 直调 followup（空闲，唤醒首轮）/ steer（运行中），镜像原 dispatchNativeMessage 语义；agents 经 ctx.get('agents') 免 inject 获取；投递失败由 Promise.all 直接抛出（弃用 allSettled 吞错——Step 10 死会话未被及时发现的原因之一）；@deepseek-ai/dsh-llm 升为 runtime dep；CONTRACTS 已补变更注记（签名/返回值/EXPLORER_PRESETS 均不变）。验收（web profile 探针端到端 explorerCount=2 = deepseek-web + mimo，探针测后已删）：① 两探索者全链路真实轮次 turn/start→step/start→request/header→assistant/message→turn/end；② user/message 持久落盘 source={'kind':'user'}（v4 校验零拒绝，agent errors: none，PROBE PASS）；③ 探索者自主黑板产出 pitfall×3+solution×2，且完成后按 board:remind 自行归档（5 条 status=archived，零残留）；④ runtime-context/skill-catalog 等平台 producer kind 注入共存正常；⑤ pnpm run check 通过。遗留：测试会话 4 个（驱动探针×2 + 探索者×2，均在 tokensave 工作区，可在 GUI 归档删除）；dsh-call-session 对其他调用方仍投毒，等上游修复
- [x] Step 12 完成于 2026-10-06，产出：打包安装与跨项目验收全过（详见文末「发布说明」）。① package.json 完整性核对 ✓（name/main/exports["./client"]→dist/client.js/dsh.bundle.patch/dsh.client 对象形态——step 文档字符串形态为旧写法按 Step 02 已知问题保持/peerDependencies；注意 private:true 阻止 npm publish，发布时需移除）；② `dsh plugin --profile web add /Users/sonoma/code/tokensave` 安装成功 ✓（link: 依赖 + dsh.profile.bundles 第 20 项 + profile node_modules 符号链接，nodeLinker=hoisted，关键插件齐全）；③ cordis.patch.yml 改为平台约定包名形态 name: dsh-tokensave（对照 dsh-compare-text/dsh-call-session 等已装插件；安装后 --patch 调试流自此不再需要）；④ 原生加载×重启 ✓：不带 tokensave --patch 连续 5 次启动 web profile 均打印 `[dsh-tokensave] plugin loaded!`，__DSH_BOOT__ 含 dsh-tokensave、client.js 原生下发（注册格式 ✓，36789B=本地 36719+平台 sourcemap 尾巴）；⑤ 跨项目端到端 ✓（全新空目录 /tmp/tokensave-xproj 启动实例+驱动探针，测后已删）：模型自发调用 tokensave_delegate → 3 探索者在该目录 scope 建会话、Nemotron 写板 pit/sol（后按内置提醒归档）→ tool/result 回流含 tokensave-brief 标记（会话日志 2 hits=LLM Calls 代理证据）→ 模型真实执行文件操作（index.html/app.js/style.css 落盘、turn/end reason=completed）——验收 4 项全过；三层可见性：黑板 ✓ 实测，浮窗=client 半区原生进 boot graph（实机外观待浏览器目检），LLM Calls=已知损坏 call-inspector 用日志代理。过程排雷：驱动会话先用 mimo 撞上游抖动卡死（TTFT 62s/FAIL，换 deepseek-web 后 rootChain 回落 mimo 靠重试扛过）；连4次漏传 workdir 致 cwd 错误重启（教训：用命令内 cd）。遗留：测试会话约 15+ 个（tokensave 与 /private/tmp/tokensave-xproj 两工作区，GUI 按 tokensave-*/跨项目验证 标题归档）；/tmp/tokensave-xproj 三文件保留为验收证据；主 GUI(3080) 需重启才能原生加载（会中断当前会话，留待用户手动）；npm 未发布（可选，见发布说明）

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
## 控制室 + H 型工作台（Step 13，2026-10-07）

**界面归属修正**：此前 dsh 界面里的「看板（Canvas）」实为 dsh-call-session 的 conversation.view tab（英文、跨工作区、只读），与 tokensave 无关；tokensave 自此拥有自己的 tab「控制室」（conversation.view id=tokensave-control-room，order 20，位于 chat/trajectory/canvas 之后）。call-session 的 Canvas 保留不动，其 locale 经 profile 覆盖为 zh（settings 无 locale 时 config 生效）。

### 结构
- **控制室**：项目卡片列表（localStorage `tokensave:projects.v1`，同路径去重）+「添加项目」弹窗 = ① 选择项目文件夹（目录浏览器，含面包屑/上级/项目特征徽标）② 选择布局模式（固定仅 1 种：H 型工作台）
- **H 型工作台**：左右两竖 = 免费大模型探索者窗口（telemetry 发现 tokensave-* 会话按奇偶均分；最小化/最大化/双击全屏（requestFullscreen 降级工作台浮层）/隐藏恢复 chip）；中上 = 共享黑板（board 路由按项目路径拉取，主题 tab 全部/需求/坑/方案/简报，点击展开正文，20s 自动刷新）；中下 = DSH 主对话（当前会话 subscribeSession 消息流 + `sessions.scope(id).get('conversation').send(text)` 发送，Enter 发送/Shift+Enter 换行，「原生视图 ↗」切回 chat tab）——横线（中上 border-bottom）即 H 中横
- 探索者浮窗（shell.overlay）停用，简报浮窗保留（计数改由 H 台 reportExplorerCount 上报）

### 宿主路由（src/board-web-route.ts）
- `GET /plugins/dsh-tokensave/board?workspace=`（黑板条目，中文 topicLabel，主题序+时间倒序）+ `GET /plugins/dsh-tokensave/fs?path=`（目录浏览，isProject=PROJECT_MARKERS 特征）
- Node 风格 handler(req,res)（此前误用 Fetch Request/Response 形态已修）；connection.requestRejection 鉴权闸门（401/403/503 与 telemetry 同形态）；GET-only（405）；ctx.effect 注册并返回双路由 disposer

### 热重载（本日打通，改码不再需要重启 3080）
- **客户端**：dsh-client-hmr stat-poll 每个 graph 行的 bundle → 改 `pnpm build:client` 后数秒内 rev 变更（实测 246300ad973d→f08bf8f2b436），本地 dist 是线上服务内容严格子集
- **宿主**：base bundle 的 `hmr` entry 默认 `root: []`（模块根监视 opt-in）——profile cordis.patch.yml 已加 `hmr.config.root: [/Users/sonoma/code/tokensave]`；touch src 即插件热重载（board 路由 404→401 实测）。配置改动（locale/hmr root）走 patchReload: live 配置热重载
- 验证技巧：graph/rev 从无鉴权 SSE `GET /plugins/events` 取；宿主路由是否注册看「401 vs 404」（401=已注册被闸拦，404=未注册）

### 验收（2026-10-07 实测）
- `npx tsc --noEmit` 全绿；`pnpm build:client` 通过；bundle ModuleLoader 冒烟通过
- board/fs/telemetry 三路由一致 401；POST board 401（闸门在 method 判定前，无写通道）
- 线上 bundle 含 tokensave-control-room/reportExplorerCount 标识；本地 ⊆ 线上
- 浏览器目检项：控制室 tab 外观、添加项目弹窗目录浏览、H 台双击全屏、主对话发送回流

## 项目中心改版（Step 14，2026-10-07）

按用户三轮反馈调整，全部已构建并经 HMR 热上线（rev 28511571eb95，本地 ⊆ 线上）：

1. **改名**：tab「控制室」→「项目中心」（label/标题/文案/文档全量；slot id `tokensave-control-room` 保留——宿主视图偏好按 id 存 localStorage，改 id 使旧偏好悬空）。
2. **添加项目弹窗**：删除「② 选择布局模式」——布局固定仅 H 型 1 种，无选择项；弹窗只剩「选择项目文件夹（目录浏览器）+ 可选项目名称」。`addProject(name, path)` 不再收 layout 参数（内部固定 `h-desk`）。
3. **中下改用宿主原生聊天**：删除自造 `MainChat.tsx`（输入框+消息流）。宿主 DOM 事实：`scrollBody = [当前视图, composerSeat]`，原生输入条（`[data-conversation-region="composer"]`，conversation.composer 座位）**每个 tab 常驻**——即用户所说"每页自带的聊天窗口"；消息记录只在「对话」tab，发送不自动切 tab。实现：`useDockNativeComposer`（HDesk 内 useLayoutEffect）把输入条 position:fixed 停靠进中下格（getBoundingClientRect 定位、向下锚定内容向上生长、z-35），ResizeObserver + resize + scroll(capture) + 1s 兜底重测，卸载/切 tab 还原行内样式。中下格仅留提示行。
4. **去中横线 + 高度协调**：删除 `.ts-desk-board` 的 `border-bottom`+`padding-bottom`（原先造成黑板比两侧矮 10px 的错位）。改为全台共享 `R = max(左窗口数, 右窗口数, 2)` 行 1fr 网格：JSX 注入 `gridTemplateRows`，黑板跨 `1 / R`（即 1..R-1 行）、中下格占第 R 行、左右两竖 `grid-row: 1/-1` 跨满。列内窗口 flex:1 等高均分 → 探索者增多自动均分；探索者数为偶数时左右列缝与黑板底缝完全对齐（如 4 探索者全缝 50%），奇数时（3 探索者）黑板底缝与左列中缝对齐（50%）。
5. **z 层级**：原生输入条 35 < 探索者最大化浮层 40 < 添加项目弹窗 45（全屏/弹窗时输入条被正确盖住）。

浏览器目检项：项目中心 tab 外观、H 台比例/对齐（3 与 4 个探索者各看一次）、原生输入条停靠位置与多行输入向上生长、切 tab 后输入条在其它视图还原、探索者全屏盖住输入条。

## 404 事故修复 + 四项体验改进（Step 15，2026-10-07）

**事故**：用户刷新页面后「选择项目文件夹」「探索者探测」全挂——board/fs/telemetry 三路由齐 404（`/plugins/events` 200 证明 webServer 活着）。

**根因**：Step 13 给 profile 加的 `hmr.root: [/Users/sonoma/code/tokensave]` 使编辑 client/src 触发 dsh-hmr **full reload**——插件 fiber 被卸载（effect disposer 注销路由），但模块未重执行 → 模块级 `registered=true` 跨重载存活 → 重新 apply 时 `tryRegister` 误判「已注册」跳过 → 路由不再重挂。第三方 dsh-call-session 的 telemetry 是同款自身 bug（其模块级布尔同样不复位），**未修改第三方包**。

**修复（src/board-web-route.ts）**：
1. **身份制注册**：模块级状态改为 `registeredServer`（server 实例引用）而非布尔；disposer 内带实例比对复位为 null；tryRegister 以实例身份判断是否需重挂。full reload 后无论模块是否重执行都能正确重挂。
2. **guard 闭包**：鉴权闸门 + GET-only 统一收敛，三路由复用。
3. **新增自有 `/plugins/dsh-tokensave/explorers` 路由**：直读 `agents` 服务（ctx.get 降级链），按 `tokensave-` 标题前缀过滤，返回 `{id, shortId, title, workspace, state}`——客户端 `fetchExplorers` 切到该路由，彻底摆脱对第三方 telemetry 的依赖（其 404 不再影响本项目）。
4. 实测：改码 → HMR 热重载 → 三路由全部 401（已注册、闸门形态正常）。

**四项体验改进（用户 2026-10-07 反馈）**：
1. ~~选择文件夹不可用~~ → 404 修复（见上）。
2. ~~看不到探索者~~ → 自有 explorers 路由（见上）。
3. **删突兀提示文字**：中下格 `💬 DSH 主对话 · 原生输入条…` 一行删除；`.ts-desk-chat` 加与其它卡片同款 border/bg/padding（问题 3 的建议一并采纳）；停靠定位改为按格子 computed border+padding **内缩**，输入条落在卡片边框内。
4. **宽度把手整页联动（零 JS）**：宿主把手把 `--dsh-chat-user-width` 写在 body 父元素，`--dsh-chat-content-width` 定义在 body 上继承给全部后代。`.ts-cr` 改 `width:min(100%, var(--dsh-chat-content-width, 920px)); margin-inline:auto` → 拖动把手时控制室列表 + H 台全部卡片实时同步伸缩，把手悬停区恰在容器外 24px 留白无冲突。配套：`.ts-modal-mask` 改 `position:fixed`（容器变窄后 absolute 蒙层不再盖全屏）；停靠兜底轮询 1s→300ms（拖拽时更快跟随）。

**验证（2026-10-07）**：tsc 全绿；build 通过；线上 bundle（rev f619d5a21b53）本地 ⊆ 线上，含宽度绑定/explorers 路由/停靠内缩，无 dock-hint 文字、无旧 telemetry 依赖；三路由 401。

**浏览器目检项**：刷新页面后选择文件夹、探索者两列恢复；中下卡片边框 + 输入条在框内；拖动对话宽度把手 → 整页卡片随之伸缩；切 tab 输入条还原。

## 左栏协作对话 + 右栏协作收益（Step 16，2026-10-07）

**任务来源**：用户排队消息（`session.v4.jsonl.zstd` seq 1922，被 HMR 顶掉后从日志找回）——在 H 型两条竖线的探索者**上方**各加一栏：左＝主 agent ↔ 探索者沟通对话；右＝省 token/省费用（优势）+ 等待时间占用（劣势）。

**数据基础核实**（不造数）：`SessionEvent` 信封带 `time`（Unix ms）；`assistant/message` 带 `usage { inputTokens, outputTokens, reasoningTokens }`（提供方上报）；`tool/call` → `tool/result` 带 `callId` 可配对。据此扩展 `StreamMsg` 并新增 `SessionMetrics` 折叠，两者共用同一窗口快照——**零额外请求、零估算**。

**新增/改动**：
- `client/src/session-subscribe.ts`：`StreamMsg` 增 `time`/`usage`/`type`；新增 `ToolSpan`、`SessionMetrics`、`emptyMetrics()`、`metricsFromWindow(snap)`、`subscribeSessionMetrics(id, cb)`；`Channel` 增 `metrics`/`metricSubs`，`publish` 同时广播消息与指标。
- `client/src/panel/TalkColumn.tsx`（新）：左栏时间轴。真实事件 → 友好对白：探索者首条 user（主 agent 下发的任务原文）→ 首条 assistant（「收到，开始干活了 🚀」）→ 后续 assistant（进度/完成汇报，原文截断）→ 含报错特征的 tool 结果（「遇到问题」，限 2 条）→ 主会话 `tokensave_delegate` 跨度（派发 / 等待中 / 收齐简报）。按时间排序、末 120 条、自动滚底。
- `client/src/panel/SavingsColumn.tsx`（新）：右栏报告。**优势**＝探索者实际用量（提供方上报）按主 agent 单价折算（输入 ¥2.0/M、输出 ¥8.0/M，界面明标口径；DSH 无价格表，已核实 llm / session-stats / token-meter 均无单价），实际支出 ¥0，节省占比 = 省下 /（主 agent 自身 + 省下）。**劣势**＝主 agent 等待（`tokensave_delegate` 的 `tool/call → tool/result` 墙钟累计，进行中按当前时刻计）+ 探索者并行人时 + 会话墙钟占比。两栏各带进度条。
- `client/src/panel/HDesk.tsx`：左右竖顶部各挂一栏；`fetchExplorers(project.path)` 改为按工作区收敛。
- `client/src/panel/api.ts`：`fetchExplorers(workspace?)` → `/explorers?workspace=`，过滤后为空**自动回退全量**。
- `src/board-web-route.ts`：`/explorers` 支持 `?workspace=` 过滤（与 board 同口径）。
- `client/src/panel/styles.ts`：`.ts-talk*` / `.ts-save*` 全套样式；两栏 `flex: 0 1 38%/42%` + `max-height`，探索者窗口仍 `flex:1` 等高均分。

**验证（2026-10-07）**：tsc 全绿；bundle 104653B；线上 rev `e179c50c0411` 本地 ⊆ 线上，解码转义后中文串（协作对话/协作收益/省费用/等待时间占用）全部在位；三路由 200；`?workspace=/Users/sonoma/code/info_report` → 3 个探索者，`?workspace=/tmp` → 0 个（收敛生效）。

**浏览器目检项**：左竖顶部出现「💬 协作对话」、右竖顶部出现「📊 协作收益」；跑一次 `tokensave_delegate` 后左栏应按时间出现派发→开工→汇报→收齐；右栏数字随探索者产出增长；探索者窗口仍等高均分、三列横缝对齐。

## 优化轮次（Step 17，2026-10-07）：五项体验修正

1. **左右两栏等高**：`.ts-talk` / `.ts-save` 统一 `flex: 0 0 40%; min-height:104px`（原为 38%/42% 不对称），内部列表 `overflow:auto` 各自滚动；探索者窗口仍 `flex:1` 等高均分。
2. **右栏精简**：文案压缩为短标签（探索者用量 / 实际支出 / 省下 / 主 agent 等待 / 探索者人时 / 会话时长），数字改为 `↑1.2k ↓340` 与 `≈62%` 紧凑形式；「计价口径」等说明全部移入 `title` 悬浮提示，界面只留一个 `ⓘ 计价口径` 角标。
3. **黑板正文富文本**：新增 `client/src/panel/RichText.tsx`（零依赖）——能 `JSON.parse` 的走语法着色格式化 JSON；含 Markdown 特征（标题/列表/围栏代码/引用/表格/链接/行内码）的走块级+行内渲染；其余保留换行纯文本。```json 代码块同样走 JSON 着色。`Blackboard` 展开区改用 `<RichText>`。
4. **宽度把手联动改到工作台**：`.ts-cr` 去掉 `width:min(100%,var(--dsh-chat-content-width))`，新增 `.ts-hdesk` 承载该约束，仅 `HDesk` 根节点使用——项目中心恢复全宽。
5. **「选择当前文件夹」选中态**：「选中」与「未选」循环——再次点击同一目录取消选择。选中态 `ts-btn-picked`（绿色实心 + 描边 + 加粗）文案变为「✓ 已选中（点击取消）」，未选中为浅蓝「选择当前文件夹」，并各带 title 提示。

**验证**：tsc 全绿；bundle 115,019B；线上 rev `18fb48130b93`，本地 ⊆ 线上；解码校验 9 个关键串（已选中（点击取消）/ 选择当前文件夹 / 计价口径 / ts-hdesk / ts-btn-picked / ts-rich-json / ts-json-key / 探索者用量 / 主 agent 等待）全部在位。

## Step 18（2026-10-07）：工作台对话可见性 + 会话切换 + 去宽度控件 + 卡片三键 + 项目中心美化

**任务来源**：用户两轮反馈（先 3 条，后追加 4 条）。

### 第一轮（3 条）

1. **中下卡片看不到对话内容**（根因确认）：中下格此前只有宿主原生输入条 fixed 停靠，**消息记录本身只渲染在宿主的「对话」tab**（发送不会自动切 tab），所以工作台里看起来是空的。修法：新增 `client/src/panel/MainChat.tsx` —— 复用 `session-subscribe` 的会话事件窗口订阅（与探索者窗口同一套 `messagesFromWindow`），把当前会话的消息流就地渲染进中下卡片；输入条仍停靠在卡片底部（`.ts-mainchat .ts-chat-msgs { padding-bottom:72px }` 预留位置）。只读，不复制宿主的发送/停止逻辑，避免与原生 composer 抢职责。
2. **顶部会话条**：新增 `client/src/panel/sessions.ts`（项目会话访问层）+ `client/src/panel/SessionPicker.tsx`（下拉 UI）。
   - 数据源全部是宿主客户端服务，**不走 HTTP**：`ctx.sessions.list`（会话目录，含 `cwd`/`displayTitle`/`updatedAt`/`blank`/`running`）、`ctx.workspaces.list`（工作区路径 + 归档集）、`ctx.uiWorkspace`（导航）。服务一律经 `ctx.get()`（reflect 层）取得并兜住异常，与 `src/board-web-route.ts` 的 boardStore 同款处理。
   - 列表范围＝该项目（工作区目录）下**全部历史会话**（含非 tokensave 的普通对话），排除子代理与已归档，按最近活动倒序；目录匹配先比规范化全等、再退化尾部路径段逐段相等（容忍 `/tmp/x` 与 `/private/tmp/x`），无匹配时兜底用工作区登记的 `sessionIds`。
   - 切换＝`uiWorkspace.openSession(id)`；新建＝`startProjectSession(path)`：先复用该项目已有空白会话，没有则 `sessions.create({ workspaceId })`（无工作区登记时按 `cwd`），再 `openSession` 导航过去。
   - **新会话预写视图偏好**：新建会话是空白会话，宿主在空白期不渲染任何 `conversation.view`（Hero 界面），因此 `primeViewPreference` 预写 `localStorage['dsh.conversation.<id>'].view = 'tokensave-control-room'`，让它发出第一条消息后直接落在「项目中心」。
   - **会话切换后保持在工作台**：新增 `rememberOpenedProject` / `recallOpenedProject`（`store.ts`，按会话 id 记忆打开的项目，localStorage + 模块内 Map 双写）。切会话/刷新页面后宿主重挂 `conversation.view`，`ControlRoom` 读记忆恢复同一项目的 H 台；点「← 项目中心」清除记忆。
3. **工作台默认铺满**：删除 `client/src/panel/width.ts`（整文件）与 HDesk 里的宽度控件（滑块 + 「铺满」按钮 + `availW`/`widthPref` 状态）。`.ts-hdesk` 固定 `width:100%`，宿主那套全局宽度把手仍在进入工作台期间隐藏（`body.ts-hdesk-open [data-width-handle] { display:none }`）。

### 第二轮（4 条）

4. **去掉「H 型工作台」标签**：项目卡片删掉布局标签（含 `LAYOUT_OPTIONS` 相关展示），工作台顶部删掉「布局：H 型工作台」，添加项目弹窗的按钮 title 也删掉。`store.ts` 的 `layout` 字段保留（旧数据兼容），仅不再展示。
5. **项目中心美化（参照 dsh-worktable 的「控制室」）**：下载并解包 `dsh-worktable@0.4.0` 研读其 `lib/client.js` 中的控制室样式，抽取其视觉语言落到本项目（**未复制其代码**，只借鉴设计手法）：
   - 流光玻璃背景：30px 网格底 + 三个 52vmax 模糊彩光光晕（紫/青/粉）缓慢漂移（`tsBlob1..3` keyframes）。
   - 玻璃卡：半透明渐变底 + 内高光 + 圆锥渐变描边（`conic-gradient` + `mask-composite:exclude` 的 1px 环挖空）+ hover 上浮；新增卡为虚线玻璃底 + 居中加号，永远排在网格末尾。
   - 头部改为「标题 + 副标题 + 添加项目」双列布局；卡片信息层次改为 图标 + 名称 / 目录尾段 + 完整路径 / 创建时间 / 操作。
   - 配色**只用半透明中性色 + 少量主题蓝/绿/黄**，因此深浅主题都自适应 —— 已核实宿主未暴露稳定的主题标记（无 `data-theme`/`color-scheme` 可读），故不走主题探测分支。
6. **协作收益**：删掉底部 `ⓘ 计价口径` 角标，`PRICE_TIP` 悬浮提示直接挂到「优势 · 省 token · 省费用」标题上（`title={PRICE_TIP}`）；`.ts-save-block` 改 `flex:1 1 0` + `.ts-save-rows` 改 `flex:1; justify-content:center`，优势/劣势两卡铺满整卡，底部不留白。
7. **四张卡支持最小化 / 最大化 / 关闭**：共享黑板、DSH 主对话、协作对话、协作收益统一走 HDesk 的 `CardState`（`collapsed`/`hidden`/`maximized`）与 `CardActions` 三键。
   - 三键渲染在**各卡片自己的标题条**里（HDesk 构造 `actions` 节点传入，避免与卡片自带标题重复）；最大化时只留 ✕ 退出浮层（与探索者窗口一致）。
   - 最大化＝`.ts-card-overlay` 覆盖整个工作台（同一时刻只允许一张），且铺满时普通格子不再渲染该卡（`cardShell` 里 `if (st.hidden || st.maximized) return null`），避免同组件双实例双订阅。
   - 关闭的卡片不占位，改以「已关闭：＋ 名称」chip 形式出现在台顶，点击恢复。
   - 最小化＝只留标题条（`.ts-card-collapsed` 隐藏内层列表）。
   - **输入条联动**：`useDockNativeComposer` 增加 `enabled` 参数与 `overlayChatRef` —— 主对话卡收起/关闭时输入条还原宿主原位（不再悬在空格里）；主对话铺满时输入条改停靠到浮层内那张卡上。

**新增/改动文件**：`client/src/panel/MainChat.tsx`（新）、`client/src/panel/sessions.ts`（新）、`client/src/panel/SessionPicker.tsx`（新）；`HDesk.tsx`（重写）、`ControlRoom.tsx`（重写）、`styles.ts`（重写）、`store.ts`、`Blackboard.tsx`、`TalkColumn.tsx`、`SavingsColumn.tsx`、`MsgList.tsx`、`AddProjectDialog.tsx`；删除 `client/src/panel/width.ts`。

**验证（2026-10-07）**：`pnpm run check`（tsc --noEmit）全绿；`pnpm run build:client` 产出 `dist/client.js` 146,367B；`node --check dist/client.js` 经典脚本解析通过；模拟 `__ModuleLoader__.load` 注册 + `factory(require)` 物化通过（`id=dsh-tokensave`、`exports={apply,inject}`、`inject={slots:true}`、`apply` 为函数、外部依赖仅 react 系列）；3080 线上 bundle 经批量 URL（`/plugins/??dsh-tokensave/client.js&rev=...`）下发 146,479B（本地 146,367 + 平台 sourcemap 尾巴），HTTP 200。

**浏览器目检项**：中下卡片出现「💬 DSH 主对话」并实时显示消息（发送后不再空白）；顶部「🕘 历史会话（N）」下拉可切换、切换后仍停在同一项目、「＋ 新建会话」开启新对话并同样留在本项目；工作台无宽度滑块且默认铺满；项目卡片与工作台顶部均无「H 型工作台」字样；项目中心为流光玻璃背景 + 玻璃卡；协作收益两卡铺满无留白、悬停「优势 · 省 token · 省费用」出现计价口径提示；四张卡的 —/⛶/✕ 三键生效（含关闭后的台顶恢复 chip、铺满时输入条跟随）。

## Step 19（2026-10-07）：第二轮反馈修复 —— 订阅根因 / 会话绑定隔离 / 卡片三键位置

**任务来源**：用户第二轮反馈 8 条。其中 #1/#6 是**同一个根因**，#2/#7 同属会话绑定。

### 根因一（#1 #6）：客户端服务访问被 cordis inject 闸门挡住

`client/src/session-subscribe.ts` 的 `openStream` 原本直接读 `ctx.sessions`（写成 `ctx.sessions` + `if (!ctx?.sessions)`）。但本插件只声明 `inject = { slots: true }`，而 cordis 的 context 代理对**未声明的服务**会直接 `throw new Error('cannot get property "sessions" without inject')`（源码 cordis/lib/index.js:676）——**可选链拦不住 throw**，于是 `openStream` 一进入就抛，`subscribeSession` 的流永远打不开：

- 表现 #1：中下「DSH 主对话」永远空白；
- 表现 #6：探索者窗口与协作对话永远停在「等待该探索者响应…」「暂无协作记录」（它们共用同一条流）。

修法：新增并导出 `readService(ctx, name)`（`ctx.get()` reflect 层 + try/catch，与 `src/board-web-route.ts` 的 boardStore 同款处理），`session-subscribe.ts` 与 `panel/sessions.ts` 一律经它取服务。这是**真 bug 修复**，不是兜底。

### 根因二（#5）：RichText 列表/引用解析死循环

`panel/RichText.tsx` 的三处 `while` 只 push、**从不推进 `i`**：

```ts
while (i < lines.length && UL.test(lines[i])) items.push(UL.exec(lines[i])![1])   // i 永不增
```

只要黑板条目正文含 `- ` / `1. ` / `> ` 行（简报几乎必然含），点开该条目即浏览器主线程死循环 → **页面卡死**。已核实线上简报正文确有这些行。修法：改为显式块并在块内 `i++`；附回归验证（UL 2 项后停在 i=2、OL/QUOTE 各正确前进）。

### 根因三（#2 #7）：会话 ↔ 项目绑定顺序错误 + 无归属校验

- **#2（点「新建会话」脱离工作台）**：`startProjectSession` 原本**先导航、后写记忆**。导航会让宿主动用新会话 binding、`ControlRoom` 随之重挂并立即读记忆，此时记忆还是空的 → 落到项目列表。修法：调整顺序为 **先写 `primeViewPreference` + `rememberOpenedProject`，再导航**；并把 `projectId` 作为参数传入。
- **#7（隔离）**：新增 `sessionCwd` / `sessionBelongsToProject`（`panel/sessions.ts`），用与列表同口径的 `sameDir`（含尾部路径段容差）校验会话 cwd 是否属于该项目。`ControlRoom` 恢复工作台前先校验，**不一致就不展示该项目的视图**并退回列表（带提示），同时清除陈旧记忆。隔离的真相是**工作区路径**，不是 localStorage 记忆。
- **探索者跨项目污染**：`panel/api.ts` 的 `fetchExplorers` 原本在按工作区过滤后为空时**回退全量**，把别的项目的探索者显示到当前工作台。已删除该回退，改为严格按项目收敛。实测：`?workspace=<tokensave>` → 0 个、`?workspace=<dsh>` → 3 个（隔离生效）。
- **探索者 cwd 落错**：`session_create` 无 cwd 参数，工作区取自 `exec.agent` 的 `session.header.cwd`（call-session `resolveCwd`）。主 agent 在哪个项目调用，探索者就落在哪个项目——这与黑板/探索者路由的工作区过滤是同一条链，已一并收敛。

### 表现层（#3 #4 #8）

- **#3 卡片三键位置**：三键本就渲染在标题条里且 `.ts-card-actions { margin-left:auto }`，但黑板标题条里 `tabs` 也是 `margin-left:auto`，两个 auto 竞争导致三键被挤到中间。修法：`.ts-board-head .ts-board-tabs { margin-left:auto }`（tabs 吃掉弹性空隙）+ `.ts-board-head .ts-card-actions { margin-left:8px }`，三键稳定落在最右，其余内容一律在其左侧。
- **#4 标题换行**：把「N 位探索者 · M 条发言」「N 次派发 · M 位」从标题条移出，改为正文首行的 `.ts-card-count`；标题条统一 `flex-wrap:nowrap` 且首个子元素 `white-space:nowrap`。
- **#8 顶部标题行**：删除「模型窗口 N」文字；「历史会话 / 新建会话」移入顶部标题行右侧（`.ts-bar-right.ts-bar-sessions`，`flex-wrap:nowrap`）；路径改为可截断的 `.ts-bar-path`，不再把右侧操作挤换行。

**改动文件**：`client/src/session-subscribe.ts`、`client/src/panel/sessions.ts`、`client/src/panel/RichText.tsx`、`client/src/panel/api.ts`、`client/src/panel/ControlRoom.tsx`、`client/src/panel/HDesk.tsx`、`client/src/panel/TalkColumn.tsx`、`client/src/panel/SavingsColumn.tsx`、`client/src/panel/styles.ts`。

**验证（2026-10-07）**：`pnpm run check` 全绿；bundle 148,696B，`node --check` 通过；解码核验新符号（readService / sessionBelongsToProject / sessionCwd / 不属于 / ts-card-count / ts-bar-sessions）全部在位；探索者隔离实测 0 vs 3；RichText 三处循环终止回归通过。

**浏览器目检项**：中下「DSH 主对话」发送后实时出内容；探索者窗口与协作对话跑一次 delegate 后出派发/开工/汇报；点开黑板条目不再卡死；「新建会话」后仍在本项目工作台；把某会话切到不属于它的项目时退回列表并提示；四张卡三键在各自标题条最右、标题不换行；顶部无「模型窗口 N」且会话操作在标题行右侧不换行。

## Step 20（2026-10-07）：探索者强制跟随「当前打开的工作台项目」

**用户指令**：探索者应强制跟随**当前打开的工作台项目**，而非**发起会话所在的项目**。

### 机制确认（读源码得出，非推测）

`dsh-call-session` 的 `session_create` **没有 cwd 参数**，工作区完全取自**调用方 agent**：

```
session-create.mjs:232  const callerCwd = directory.resolveCwd(callerAgent) || process.cwd()
session-directory.mjs:99  resolveSessionCwd(agent) = agent?.session?.header?.cwd || agent?.session?.cwd || ''
dsh-host-gateway.mjs:449/466/479  cwd → createRootAgent({ cwd }) → agents.create({ cwd, meta:{cwd} })
```

所以默认行为是「在哪个项目的会话里发起 delegate，探索者就落在哪个项目」。若在 A 项目发起、却期待探索者归属 B 项目，就会错位——黑板与探索者路由都按工作区过滤，两边互相看不见（这正是上一轮实测到的 `tokensave` 项目 0 个 / `dsh` 项目 3 个）。

### 实现：宿主侧项目作用域 + Proxy 注入 cwd

**宿主侧**（`src/board-web-route.ts`）：
- 新增 `SCOPE_ROUTE_PATH = '/plugins/dsh-tokensave/scope'`，GET 读 / POST 写；
- 进程内 `projectScope = { workspace, updatedAt }` + `readProjectScope()` / `writeProjectScope()`；
- 该路由**单独开 POST 写通道**（其余路由仍走 GET-only 闸门），但同样过 `rejectionFor` 鉴权；`req.on` 不可用时明确回 501 而非挂死。
- 进程内即可：它表达的是「此刻 UI 在看哪个项目」，重启后由客户端重新发布。

**探索者侧**（`src/orchestration/parallel-explorer.ts`）：
- 新增 `withProjectCwd(agent, cwd)`：用 `Proxy` **只改写 cwd 读取路径**（`agent.session.header.cwd` 与 `session.cwd`），`id`/`title`/`ctx`/`options`/`session.title`/`requestHeader` 等一律 `Reflect.get` 透传。
- `parallelExplore` 读 `readProjectScope()`；有作用域时把 `scopedAgent` 传给 `session_create`，无作用域时保持原行为（跟随发起会话）并打日志。
- 选择 Proxy 而非新造假 agent 的理由：`session_create` 除了 cwd，还要读 `callerAgent` 的 **title**（标题去重）、**options/preset**（模型与预设装配）、**session.requestHeader**（模型回落）、**ctx.root**（解析 agents 服务）以及 `safeguard.admit` 的 callerSessionId。新造假 agent 会把这些一起弄丢；Proxy 只改一个字段，其余全部保真。

**客户端侧**（`client/src/panel/api.ts` + `HDesk.tsx`）：
- 新增 `publishProjectScope(workspace)`（POST；失败只告警不抛，不阻断 UI）；
- `HDesk` 挂载/切换项目时发布 `project.path`，卸载时清除（避免陈旧归属被新探索者复用）。

**Proxy 取值链实测**（复刻 `resolveSessionCwd`/`resolveSessionTitle` 真实验证）：原始 cwd `/Users/sonoma/code/dsh` → 作用域后 `/Users/sonoma/code/tokensave`；标题、id、options、header 其它字段、`'cwd' in header` 全部正确透传。

**验证**：`pnpm run check` 全绿；宿主模块经 `--experimental-strip-types` 直接加载成功，`readProjectScope`/`writeProjectScope` 读写往返正确；bundle 149,522B + `node --check` 通过。

**⚠️ 需要重启 DSH**：本轮改了**宿主侧**（`src/board-web-route.ts`、`src/orchestration/parallel-explorer.ts`）。client bundle 会热重载，但宿主代码只在进程启动时加载——实测线上 `/plugins/dsh-tokensave/scope` 目前仍 404（客户端新代码已下发，但宿主没这个路由）。**重启后**该路由才生效，探索者才会强制跟随当前工作台项目。

**浏览器目检项**：重启后进入项目 A 的工作台 → 在该工作台里发起 `tokensave_delegate`（即使发起会话属于项目 B）→ 探索者窗口应出现在 A、黑板写入 A、`?workspace=<A>` 能查到；退出工作台（回项目列表）后再发起 → 探索者跟随发起会话。

## Step 21（2026-10-07）：第三轮反馈修复 —— 会话归属 / 消息呈现 / 卡片内滚动

### #1 不同项目的工作台显示同一个会话（结构性 bug）

**根因**：`conversation.view` 收到的 `sessionId` 是**宿主全局当前会话**，而中下格（MainChat）与探索者窗口都订阅这个全局会话。于是从 A 项目切到 B 项目后，B 的工作台仍然显示 A 的会话（实测表现为「dsh / info_report / tokensave 三个项目显示的都是 tokensave 最近一次会话」）。上一轮加的 `sessionBelongsToProject` 校验被绕过了——它只在「恢复记忆」路径上校验，而点「进入工作台」按钮时直接 `setOpenedId(p.id)`，从不校验。

**修法**（把归属判定从「恢复路径」提到「工作台自身的生命周期」）：
- `panel/sessions.ts` 新增 `latestProjectSession(ctx, projectPath)`：取该项目**最近活动的非空白会话**（真正有内容的那个），没有非空白会话时退回空白会话，都没有返回 null。
- `HDesk` 挂载后（依赖 `project.path` / `sessionId`）：
  - 当前会话**已属于本项目** → 不动（避免把用户手动切到的历史会话抢回最新）；
  - 否则取本项目自己的会话 → 先写记忆 → `openSession(own.id)` 把宿主切过去。
  - 这样 MainChat、探索者窗口、宿主原生输入条三者指向**同一个本项目会话**（输入条属于宿主，必须切会话才能一致）。
  - 无会话时提示「点右上角＋新建会话开始」；导航失败复位守卫并提示，可重试。
- `ControlRoom` 不再做归属校验（那是 UI 记忆恢复），只负责记忆恢复与列表；移除随之失效的 `getClientContext` / `sessionBelongsToProject` / `VIEW_ID` 导入。

### #2 消息流一股脑平铺（英文工具输出淹没界面）

`MsgList` 原样渲染全部消息。改为对齐 DSH 默认对话的呈现：
- user / assistant 正常渲染（真实对话内容）；
- **tool / system 默认折叠成一行预览**（120 字截断），点 `▾/▴` 才展开全文（展开区自身 `max-height:220px` 内滚）；
- 只渲染**最近 120 条**，更早的折成「更早的 N 条已折叠」提示（避免 DOM 爆炸）。

探索者窗口共用同一个 `MsgList`，因此同样受益。

### #3 工作台整体长滚动条

根因：`.ts-desk-col` 是 `overflow:auto`（整列滚），`.ts-cr` 也没锁溢出。改为：
- `.ts-cr` 加 `overflow:hidden`；`.ts-desk-col` 改 `overflow:hidden`；
- `.ts-card` 加 `overflow:hidden`，并显式让卡内列表（`.ts-chat-msgs` / `.ts-board-list` / `.ts-talk-list` / `.ts-save-body`）承担滚动（`min-height:0; overflow:auto`）。

即：**工作台自身不滚动，滚动发生在各卡片内部**。

### #4 项目中心右上角「添加项目」重复

网格末尾本来就有「＋ 添加项目」新建卡（空列表时是居中大卡），右上角那个是重复入口。已删除头部按钮及其失效样式 `.ts-center-add`（保留注释说明）。

**验证**：`pnpm run check` 全绿；bundle 152,288B + `node --check` 通过；解码核验 `latestProjectSession` / `sessionBelongsToProject` / 「该项目还没有会话」/「更早的…已折叠」/ `ts-msg-toggle` / `ts-msg-preview` / `ts-msg-full` 全部在位，右上角按钮类名已消失。

**浏览器目检项**：项目 A 与项目 B 的工作台分别显示各自项目的会话（默认最新）；主对话里工具调用只占一行、点击可展开；探索者窗口同样折叠；工作台本身无长滚动条、各卡片内部滚动；项目中心右上角无「添加项目」。

## Step 22（2026-10-07）：项目中心背景覆盖到输入框及其下方区域

**用户反馈**：项目中心界面里，DSH 主聊天输入框及其以下区域没有被流光玻璃背景覆盖，整体不协调。

### 根因（读宿主 DOM/CSS 得出）

宿主 `ui-conversation` 的实际结构是：

```
[data-conversation-scroll]        ← 共享滚动容器（flex column）
├─ [data-slot=conversation.session] → viewArea ← **我们的项目中心视图在这里**
└─ [data-conversation-region="composer"]       ← 输入条座位（**兄弟节点**）
```

即输入条座位与本视图是**兄弟**，不是后代。因此视图内部的 `.ts-center-bg`（`position:absolute; inset:0`）**在结构上永远盖不到输入框**。

雪上加霜：宿主给输入条座位加了自带的不透明渐变底（`composerSeat{ background:linear-gradient(180deg, transparent 0px, var(--dsw-alias-bg-base) 36px) }`），用来遮住从下方滚过的内容。

### 修法

把背景上提到**两者共享的父容器**，并把输入条座位的底色放开：

1. `ControlRoom` 在**列表态**给 `document.body` 加 `ts-center-open`（进入工作台时 `openedKey` 非空 → 不添加；effect 位于早返回之前，hooks 顺序稳定）。
2. `body.ts-center-open [data-conversation-scroll]` 铺三层径向渐变（紫/青/粉，与光晕同色系）+ 30px 网格，`background-size` 逐层对应。
3. `body.ts-center-open [data-conversation-region="composer"] { background: transparent !important }` —— 让容器背景透上来。
   - 之所以敢直接置透明：宿主那层渐变是为了遮「从下方滚过的内容」，而项目中心的滚动发生在**卡片内部**（`.ts-center-inner` / 各卡片），输入框下方没有内容会滚过，不存在穿透问题。
4. `.ts-center-bg::after` 的网格**移除**（网格已上提到共享容器），只保留流动光晕，避免两层网格错位出现摩尔纹。

工作台（HDesk）不受影响：`ts-center-open` 只在列表态添加，且与 `ts-hdesk-open` 互斥。

**验证**：`pnpm run check` 全绿；bundle 154,404B + `node --check` 通过；CSS 大括号平衡校验为 0；解码核验 `ts-center-open` / `data-conversation-scroll` / `data-conversation-region` 均在位。

**浏览器目检项**：项目中心列表态下，输入框及其下方区域与上方卡片区背景连成一片（网格 + 光晕连续）；输入框本体仍清晰可读；进入工作台后背景恢复原样、H 台不受影响。

## Step 23（2026-10-07）：主对话卡片仍撑长 + 会话↔工作台全面绑定

### #1 重启后主对话卡片仍然内容极多、界面很长

**根因（读宿主 CSS 得出，上一轮只治了症状）**：宿主在**激活相**下显式让视图容器随内容长高：

```
.wSkVaW_scrollBody { flex:1; min-height:0; overflow-y:auto }
.wSkVaW_root[data-phase=active] .wSkVaW_viewArea { flex:1 0 auto; min-height:auto }   ← 元凶
```

即 `viewArea` 是 `flex:1 0 auto` + `min-height:auto`——**内容多高它就多高**，于是外层 `scrollBody` 长出长滚动条。我上一轮只在卡片层加 `overflow:hidden`，而卡片在一条「允许无限长高」的链里，**根本轮不到生效**。

**修法（把整条链都改成可收缩，并压过宿主的 !important 级规则）**：

```
body.ts-hdesk-open/ts-center-open [data-conversation-scroll]                      { overflow:hidden }
body.… [data-conversation-scroll] > :not([data-conversation-region=composer])      { flex:1 1 0; min-height:0; overflow:hidden; display:flex; flex-direction:column }
body.… [data-conversation-scroll] [class*="viewArea"]                             { flex:1 1 0 !important; min-height:0 !important; overflow:hidden }
body.… [data-conversation-scroll] :has(.ts-cr)                                     { 同上 }
.ts-cr                                                                             { flex:1 1 0; min-height:0; overflow:hidden }
```

要点：
- `viewArea` 用 `!important` 压过宿主的 `flex:1 0 auto`（宿主类名带哈希前缀，用 `[class*="viewArea"]` 子串匹配）；
- 用 `:has(.ts-cr)` 而不是写死层级——宿主 slot 可能有多层包裹（宿主自己也在用 `:has`），只要「装着我们的根节点」就统一压成可收缩容器；
- 滚动最终落在**各卡片内部**（`.ts-chat-msgs` / `.ts-board-list` / `.ts-talk-list` / `.ts-save-body` 各自 `overflow:auto`）。

### #2 会话与「项目中心→项目→工作台」的全面对应

**需求**：不论从**左侧边栏**点会话/新建会话，还是从**工作台顶部**选历史会话/新建会话，只要该会话属于某个已登记项目，都应落到那个项目的**工作台**，而不是宿主默认的纯对话窗口。

**机制**：宿主按**会话作用域**从 localStorage 读视图偏好（键 `dsh.conversation.<sessionId>`，`ui-conversation` 的 `readConversationViewPreference`）。只要在宿主激活视图**之前**写入 `view = tokensave-control-room`，宿主就会激活我们的 `conversation.view`。

**两条互补路径**：

1. **确定性拦截（主路径）**——`client/src/index.ts` 包装宿主服务，在导航/创建**之前**写好偏好：
   - `wrapSessionNavigation()` 包装 `uiWorkspace.openSession`：调用前 `bindSessionToItsProject(id)`，再走原函数。覆盖「侧边栏点会话」「工作台内切会话」。
   - `wrapSessionCreate()` 包装 `sessions.create`：创建返回后立即绑定。**必要**，因为新建流程是 `create → openSession`，而 `openSession` 时机该会话可能还没进 `sessions.list`（读不到 cwd）→ 绑定失败；在 `create` 返回时 cwd 已由宿主写入。
   - 两者都经 `ctx.inject([...], cb)` 等服务就绪后再包装，**不依赖插件 apply 顺序**；包装幂等（`__tokensaveWrapped` 标记）；绑定失败只告警、**不阻断导航**。
2. **兜底扫描**——`sweepProjectSessionBindings(ctx)` 在 **Probe**（挂在会话头部 actions 槽，**始终挂载**）里跑一次 + 每 5s 轮询，把「属于已登记项目的会话」全部补写偏好，覆盖包装没拦到的路径。

**为什么扫描必须放在 Probe**：`ControlRoom` 只在本插件视图**已激活**时才挂载（实测宿主 `renderSlot("conversation.view", …, { only: viewId })` 只渲染激活的那个），因此放在 ControlRoom 里**无法自举**。Probe 常驻，才能保证首次进入就绑好。

`primeViewPreference` 改为**幂等且返回是否变更**（已绑过就不重复写，避免每 5s 无谓的 localStorage 写）；新增 `recallViewPreference` 读当前偏好。

**验证**：`pnpm run check` 全绿；CSS 大括号平衡 0；bundle 161,814B + `node --check` 通过；关键符号各仅 1 处定义（无重复）；**运行时冒烟**：`apply(无服务 ctx)` 不抛异常并优雅降级（`ctx.get` 只尝试 `uiWorkspace` / `sessions`）；解码核验「已接管 sessions.create」/「已接管 uiWorkspace.openSession」/`bindSessionToItsProject` / `has(.ts-cr)` 均在位。

**浏览器目检项**：主对话卡片内容不再撑长整页，卡片内部出现自己的垂直滚动条（黑板/协作对话/协作收益同理）；从左侧边栏点某个项目的会话 → 直接进该项目工作台；从左侧边栏新建会话 → 同样进工作台；工作台顶部切换/新建会话 → 保持在工作台。

## Step 24（2026-10-07）：第五轮反馈修复（5 项）

### #1「新建会话 / 新会话」仍进默认 DSH 会话 —— 根因与修法

上一轮只包了 `uiWorkspace.openSession`，**漏了一条路**。读宿主 `ui-workspace` 源码确认：

```
openSession(target)            → replaceMain(target, …)            ← 我上轮包的
startSession(wsId)             → openWorkspace(wsId) → replaceMain(…)   ← 没包到！
connectWorkspace / 默认恢复     → replaceMain(…)
```

侧边栏「新建会话」走的是 **`startSession` → `openWorkspace` → `replaceMain`**，**根本不经过 `openSession`**。所以上一轮的包装对新建会话完全无效。

**修法**：改包 **`replaceMain`** —— 它是所有导航路径的**唯一汇合点**，且内部在 `selection.set`（即视图激活）之前会回调 `beforeOpen(resolvedId)`：

```js
const hooked = (resolvedId) => { bindSessionToItsProject(resolvedId); beforeOpen?.(resolvedId) }
original(target, signal, panel, hooked)
```

这样拿到的是**已解析**的会话 id（`target` 可能是 workspaceId），且在宿主读偏好之前写好。`openSession` 包装降级为兜底（`replaceMain` 不可用时才用）。

另外补上 `sessions.create` 的**入参定位**：宿主新建流程是 `create({workspaceId})`，刚返回的会话**还没进 `sessions.list` 快照**，靠 `sessionCwd` 查不到 cwd（这正是之前绑定失败的直接原因）。改为从入参的 `workspaceId`/`cwd` 反查项目（`bindByCreateOptions`），不等列表刷新。

还有一处关键：侧边栏新建会**复用已存在的空白会话**（`reuseOrCreateBlank`），该会话的 binding 可能**已经物化**且视图已是 `chat` —— 此时只写 localStorage 不会重激活，必须显式 `uiConversation.binding(id).activate(VIEW_ID)`（新增 `activateView`）。

**验证**：用模拟宿主（三条路径 + 宿主自带 `beforeOpen`）跑包装逻辑 —— 三个场景激活的视图都是 `tokensave-control-room`，且宿主自己的 `beforeOpen` 仍被正常调用（未破坏宿主行为）。

### #2 历史会话列表超出界面

根因：下拉 `position:absolute; left:0`，而按钮在工作台标题行**最右侧**，向下展开时右边超出视口；且祖先 `.ts-cr` 是 `overflow:hidden`，就地渲染还会被**裁掉**。

修法：改用 **portal 挂到 `body`**，坐标由 `useLayoutEffect` 按按钮 `getBoundingClientRect()` 算成 `fixed`（**右对齐**，留 12px 边距）；宽度 `min(520px, calc(100vw - 32px))`。点击外部判定要同时排除 portal 容器（`popRef`），否则点列表项会被当成点外部而先关闭。

### #3 三键位置（右上角）+ 其它信息居中

标题条统一改为 **`[标题][中间信息][三键]`** 三段式：
- 新增 `.ts-head-title`（靠左）、`.ts-head-mid`（`margin:0 auto` 居中 + 省略号）；
- `.ts-card-actions` 加 `order:9`，**无论 DOM 顺序如何**三键都排最右；
- 黑板把 tabs（全部/需求/坑/方案/简报/刷新/条数）移到标题与三键**之间**；协作对话/协作收益把计数从正文移回标题中间；探索者窗口加「N 条消息」中间信息。

### #4 输入框遮住对话末尾几行

根因：`.ts-mainchat .ts-chat-msgs { padding-bottom:72px }` 是**写死的**，输入条多行/换行时高度超过 72px，末尾几行就被盖住。

修法：停靠时实测输入条高度写入 CSS 变量，消息流底部留白跟随：

```js
const seatH = Math.ceil(seat.getBoundingClientRect().height)
if (seatH > 0) root.style.setProperty('--ts-composer-h', `${seatH}px`)
```
```css
.ts-mainchat .ts-chat-msgs { padding-bottom: calc(var(--ts-composer-h, 72px) + 14px); }
```
卸载时 `removeProperty` 复原。

### #5 主对话/探索者窗口「过程未折叠」，要对齐「对话」tab

**先说结论：无法字面复用宿主组件**，依据（都读了源码）：
1. `ChatView` **未导出**（`ui-chat` 的 `lib/types/client/index.d.ts` 只导出 `apply`/`inject` 和类型）；
2. 宿主只渲染**激活**的那个 view：`renderSlot("conversation.view", …, { only: viewId })`；
3. `ChatView` 需要约 25 个宿主内部 props（`useChat`/`useChatNode`/`useChatGroup`/`renderSlot`/`usePresentation`/`chatScroll`…），外部拿不到。

**修法**：重写 `MsgList`，**对齐「对话」的呈现语义**（这才是用户要的观感）：
- 按 user 消息切「轮」；
- 每轮里 user → 气泡；**其余中间过程**（工具调用、中间文字）→ 折叠成一行「过程 N 步 · 工具 M 次」，点开才看细节；
- 该轮**最后一条** assistant 文本 → 视为最终回答，用 `RichText` 展开渲染；
- 只渲染最近 `MAX_TURNS = 40` 轮，更早的折成提示。

主对话与各探索者窗口**共用**这一个组件，所以两边观感一致。边界已验证：工具未收尾（无最终回答）时全部折叠为过程、空输入 0 轮、仅 user 不误判回答。

### 验证
`pnpm run check` 全绿；CSS 大括号平衡 0；bundle 171,583B + `node --check` 通过；`function <name>` 各仅 1 处（无重复）；运行时冒烟 `apply(无服务 ctx)` 不抛异常；`react-dom` 已确认是宿主运行时模块表提供的平台种子（官方 trajectory/attachment/subagent 等插件同样 `require("react-dom")`）；为 tsc 补了 `types/react-dom.d.ts` 垫片并把 `types/**/*.d.ts` 加进 tsconfig include。

## Step 25（2026-10-07）：工作台右侧被裁 ~40%（仅 tokensave / dsh 项目）

### 现象与关键线索
4 个项目里只有 **tokensave、dsh** 的工作台右侧被挡掉约 40%，另两个正常。
关键区别：tokensave/dsh **有真实会话内容**（消息、工具输出、黑板条目），另两个是空项目。

### 根因：CSS Grid 裸 `1fr` 的自动最小值是 `min-content`
```
.ts-desk { grid-template-columns: minmax(190px,250px) 1fr minmax(190px,250px) }   ← 旧
```
`1fr` 等价于 `minmax(auto, 1fr)`，而 `auto` 的**最小值是 min-content**（内容的最小不可断宽度）。
中列卡片里一旦有长不可断内容——工具输出、`white-space:pre` 的代码块、长 URL、长 token——
中列就被撑到内容宽度，整个网格超出容器；而 `.ts-cr` 是 `overflow:hidden`，
于是**右列（250px）连同部分中列被裁掉**。空项目没有长内容 → 看起来正常。

数学验证（容器 1400px、内容最小宽度 1800px、两侧各 250px、gap 8px）：
```
1fr             中列=1800  总宽=2316  溢出 916px  ← 右侧被裁 65%
minmax(0,1fr)   中列= 884  总宽=1400  溢出   0px  ← 正常
```
与「约 40% 被挡住」的现象吻合（实际比例取决于内容宽度）。

### 修法（把整条尺寸链的 `min-width:auto` 全部解开）
1. **列轨道**：`1fr` → `minmax(0,1fr)`（核心修复）；
2. **行轨道**：JSX 里 `repeat(R, 1fr)` → `repeat(R, minmax(0,1fr))`（同款纵向陷阱）；
3. **网格项**：`.ts-desk > * { min-width:0 }`，`.ts-desk-board/.ts-desk-chat { min-width:0 }`；
4. **容器**：`.ts-desk { min-width:0; overflow:hidden }`、`.ts-card { min-width:0 }`、
   `.ts-card > * { min-width:0 }`；
5. **长内容宿主**：`.ts-mainchat/.ts-board/.ts-talk/.ts-save/.ts-win/.ts-chat-msgs/.ts-win-body/
   .ts-board-list/.ts-talk-list/.ts-save-body { min-width:0 }`，
   以及 `.ts-rich-code/.ts-rich-plain/.ts-rich-table-wrap/.ts-rich-p/.ts-msg-full/
   .ts-msg-preview/.ts-entry-body/.ts-entry-title { min-width:0 }`；
6. 卡片内滚动容器补 `overflow-x:hidden`（横向只在卡片内滚，不外溢）。

### 顺带核对（排除其它嫌疑）
- 宿主宽度把手：选择器 `[data-width-handle]` 与宿主实际渲染的属性**一致**（宿主确实输出 `data-width-handle`），不是漏选；
- 宿主 `max-width` 规则：全部只作用于 **composer**（`.wSkVaW_composerHero` / `.pXSMma_stack` / `.uV2eYG_dock`），不约束我们的 view → 排除；
- `.ts-center-grid` 的 `minmax(248px,1fr)` 最小值是显式的，无此陷阱。

### 验证
`pnpm run check` 全绿；CSS 大括号平衡 0；bundle 173,630B + `node --check` 通过；
运行时冒烟 `apply(无服务 ctx)` 不抛异常；产物内 CSS 已确认为 `minmax(0,1fr)`；
线上 rev 本地 ⊆ 线上。

## Step 26（2026-10-07）：主对话 / 探索者对话的 Markdown 与 JSON 渲染

### 反馈
「大模型回复里很多 `**`、`-`、` ``` ` 没渲染，JSON 也希望能用更好的形式」。

### 定位方式：写探针跑真实样本，而不是猜
把 `RichText` 单独用 esbuild 打成 CJS，喂 33 个真实模型输出样本，
把 React 元素树展开成纯文本，再检测残留标记。这样能**精确**知道哪些没渲染、而不是凭感觉改。

首轮探针暴露的问题（也正是用户看到的）：
| 样本 | 症状 |
|---|---|
| `**a*b**` | 粗体内部含单个 `*` → 旧正则 `\*\*[^*]+\*\*` 不匹配 → **整段退化为纯文本** |
| `result: {"ok":true}` | 句中夹 JSON → 旧判据只认**行首** `{` → 不渲染 |
| 用 ` ``` ` 包围代码块 | 行内三反引号 → 旧正则只认成对单反引号 → 原样裸露 |
| `~~已废弃~~` | 删除线完全不支持 |
| `- [x] 已完成` | 任务列表不支持 |

### 根因（最关键的一条）
`MD_HINT` 是**总开关**：它不匹配 → `RichText` 直接走 `ts-rich-plain`（纯文本），
**里面所有标记原样显示**。所以「正则漏一种语法」的后果不是「那一种不渲染」，
而是**整段都不渲染**——这就是为什么用户看到 `**`、`-`、` ``` ` 全都裸露。

### 修法
1. **`MD_HINT` 与渲染器口径对齐**：支持 `**a*b**`、`~~删除~~`、行内 ` ``` `、
   行内任意位置链接、句中 JSON（`{...:"`）。并让它跑在**折叠换行后**的文本上，
   使跨行的 `**加粗**`（模型常把一段话折行）也能配对。
2. **过程项（ProcItem）展开后走 `RichText`**：此前展开只输出 `msg.content` 原文——
   工具输出里的 Markdown/JSON 全部裸露。这是「探索者对话里还是很多 `**`」的直接原因。
3. **折叠预览用新的 `stripMarkdown()`**：预览行先去掉 `** / ` / ``` / # / > / 列表号 / 链接语法`，
   再截断。用户扫一眼看到的那些 `**` 多来自预览行。
4. **行内三反引号**当作行内代码渲染，不再裸露。
5. **刻意不支持的**：`__粗__` / `_斜_` —— 下划线在标识符里极常见
   （`__init__`、`my_file_name`），渲染会把代码标识符弄坏；这是取舍，已在代码注释写明。

### JSON：按结构选更好的形式
- **同构扁平对象数组**（含 JSONL 同构）→ **表格**（键作表头、值作单元格，数字等宽对齐）；
  列数 > 8 或含嵌套值时**自动退回**着色的 JSON，避免把结构信息压扁丢掉；
- 其余 JSON / JSONL（异构）→ 语法着色（键/字符串/数字/布尔/null 分色），JSONL 逐块排列；
- **正文里夹带的 JSON**（`result: {...}`）→ 就地抽出来单独渲染成块，前后文字各自成段；
  用括号配对 + `JSON.parse` 双重校验，且要求长度 ≥ 6，避免把普通花括号误判。

### 验证
- 33 个样本探针：**残留标记 0**（修复前 5 类）；
- JSON 形式探针：同构数组→表格、嵌套→着色 JSON、9 列→着色 JSON、JSONL 同构→表格，全部符合预期；
- `stripMarkdown` 探针：`## 标题 **重点**` → `标题 重点`，列表/代码块/链接均正确剥离；
- `pnpm run check` 全绿；CSS 大括号平衡 0；bundle 181,499B + `node --check` 通过；
- 线上 rev 本地 ⊆ 线上；新符号（`stripMarkdown`/`splitEmbeddedJson`/`ts-rich-tasks`/
  `ts-rich-jsonl`/`ts-rich-jsontable`）均在产物中。
- 黑板条目共用同一 `RichText`，一并受益。

## Step 27（2026-10-07）：项目中心入口移到侧边栏 + 新建会话直达工作台

### ①「项目中心」按钮放进左侧边栏

**槽位调研**（读宿主 ui-sidebar 的契约）：
- 侧边栏 shell 自己拥有 brand 行、New Session、全局 panel 行；可用槽有
  `sidebar.panellist`（全局面板图标，需配 `main` 面板）、`sidebar.footer.action`（底部动作）、
  `sidebar.workspaces`（会话浏览区，已被 ui-workspace 占用）；
- `sidebar.footer.action` 是 **list + root 作用域**，渲染点是
  `renderSlot("sidebar.footer.action", { wide })` —— 正好把 wide/rail 两态传进来。

**关键约束与解法**：root 作用域**拿不到 sessionId**（sessionId 由宿主动态注入
`conversation.*` 槽）。因此让**始终挂载**的 Probe（在会话头部 actions 槽）把当前会话 id
经 `setCurrentSessionId` 写到 sessions.ts 的模块级变量，侧边栏按钮读它。

新增 `client/src/panel/ControlRoomEntry.tsx`：wide 显示「🗂️ 项目中心」，rail 只显示图标。

**`openControlRoom()` 三级降级**（保证点下去一定有反应）：
1. 当前会话属于某已登记项目 → 绑到该项目（直接落工作台）；
2. 当前会话不属于任何项目 → 仍激活本插件视图（落项目列表态）；
3. 没有当前会话（如刚开应用）→ 打开第一个项目的最新会话。

**诚实说明**：`conversation.view` 的 tab **无法隐藏**。查宿主 `viewTabs()`：tab 数组直接由
`slots.entries("conversation.view")` 生成，没有 hidden 过滤；而**注册本身**是视图可渲染的前提
（`resolveActiveView` 从 tab 里挑，未注册则该会话没有我们的 view）。所以侧边栏按钮是**新增的主入口**，
tab 保留为次入口。

### ②「新建会话 / 新会话」直达工作台

补强两处（此前只靠 `replaceMain` 包装 + 5s 轮询，有时序窗口）：
1. **Probe 立即绑定当前会话**：`sid` 一变就 `bindSessionToItsProject(sid)`，不依赖列表快照与轮询时机。
   这是「新建后直接跳工作台」最关键的一步。
2. **`scheduleActivate` 延迟重试激活**（0/60/200/600/1500ms）：
   新建会话刚返回时 `uiConversation.binding(id)` 可能**还没物化**（抛错），只试一次会静默失败。
   而且**空白会话**下宿主 `DefaultConversationViews` 直接 `return null`
   （`session.blank && conversationPhase()==='blank'`）——一个 view 都不渲染；
   只有把我们的 view 加进 `activeTargets`，`conversationPhase` 才变 `'active'`，工作台才显示。

### 验证
- **导航模拟**（5 个场景）：属于 tokensave → 视图=工作台；属于 dsh → 工作台；
  不属于任何项目 → 仍激活（落列表）；无当前会话 → 打开首个项目最新会话；无项目 → 返回 false 不静默；
- **槽位注册核对**：实际调用 `apply` 抓到三个槽
  `conversation.session.header.actions` / `conversation.view` / `sidebar.footer.action`，id 与 order 正确；
- 确认宿主渲染点确实传 `wide`：`renderSlot("sidebar.footer.action", { wide })`；
- `pnpm run check` 全绿；CSS 大括号平衡 0；bundle 185,200B + `node --check` 通过；
- 运行时冒烟 `apply(无服务 ctx)` 不抛异常；线上 rev 本地 ⊆ 线上。

## Step 28（2026-10-07）：思考可见 + 滚动不再抢（工作台主对话）

### ① 思考（thinking）看不见

**根因**：投影层只收了 `text-delta`，把 `reasoning-delta` 整条丢弃。
读 `dsh-llm` 的 `StreamChunk` 定义确认两类增量同构：
```
{ type:'text-delta',      index, text }   → 正文
{ type:'reasoning-delta', index, text }   → 思考
```
durable 侧同理：`AssistantMessage.content` 是 `ContentBlock[]`，其中
`{type:'reasoning', text}` 是思考、`{type:'text', text}` 是正文；而原来的
`textOf` 把两者**拼成一段**，所以思考要么消失、要么混进正文。

**修法**：
- `messagesFromWindow` 同时收两类 delta，并按 `slot`（reasoning/text）分开累积
  （否则思考与正文会混成一条）；`StreamMsg` 加 `kind:'reasoning'` 标记；
- durable `assistant/message` 拆成两条（思考在前）：`reasoningOf()` 单独抽 reasoning 块，
  `visibleTextOf()` 抽正文并**排除** reasoning 块（避免重复显示）；
- `splitTurn` 只把**非思考**的最后一条 assistant 文本当最终回答——否则「只跑了思考、
  还没出正文」的那一步会被当成回答展开，与收纳意图相反。

**呈现**：思考走与「工具」完全相同的收纳（`ProcItem` + `ProcessGroup`），
并在折叠条上直接报数：`过程 N 步 · 思考 K 段 · 工具 M 次`。
这样消息发出去后**不必展开**就能确认模型已开工（用户的核心诉求）。
展开后思考带紫色左边条 + 斜体 + 「思考」标签，弱化不抢正文注意力。

### ② 展开后每次刷新都被拉回底部

**根因**：`MsgList` 的 effect 无条件 `el.scrollTop = el.scrollHeight`，
内容一变（流式追加/新事件）就把视图拉到底，用户往上滚看细节根本读不了。

**修法（粘性跟随）**：
- 用 `pinnedRef` 记录「用户是否在底部附近」（阈值 24px，给流式追加留余量）；
- 只在 `pinned` 为真时才跟随新内容；用户一旦手动往上滚，**不再自动调整**；
- 滚回底部即恢复跟随；
- 未贴底时显示「↓ 回到最新」按钮（`position:sticky`），由用户主动决定何时回去；
- 切换会话时重置为贴底（新会话应看最新）。

### 验证
- **投影单测**（三个场景全过）：transient 流式中「思考 delta 与正文 delta 交替」→
  产出 `kind=reasoning` 与普通两条；durable `assistant/message` 含 reasoning+text 块 →
  拆成两条且内容不重复；只跑了思考 → 仍产出 reasoning 行（能确认已开工）；
- `pnpm run check` 全绿；CSS 大括号平衡 0；bundle 189,466B + `node --check` 通过；
- 线上 rev 本地 ⊆ 线上；新符号（`reasoning-delta`/`reasoningOf`/`visibleTextOf`/
  `ts-proc-think`/`ts-jump-latest`）均在产物中。

## Step 29（2026-10-07）：侧边栏位置/响应 + 渲染修复没生效的真因

### 用真实会话数据定位（不再靠猜）
从 `~/.dsh/sessions/` 取出真实会话（`session.v4.jsonl.zstd`，用 `zstd -dc` 解压），
抽 420 条 assistant 正文做回归样本，写探针跑 `RichText` 并展开 React 树检查残留标记。
这一步直接暴露了两个此前靠读代码没发现的问题。

### ③ Markdown/JSON 渲染「没生效」的真因（最关键）

**真因：围栏正则拒绝带连字符的语言标识。**
```js
const FENCE = /^\s*```(\w+)?\s*$/     // 旧
```
`\w+` 不匹配 `dsh-ui`（含连字符）、`c++`（含加号）。于是
` ```dsh-ui ` 这类围栏**不被识别为代码块**，整段（含围栏本身与 JSON）被当普通段落渲染，
标记原样裸露。实测 420 条样本里 **12 条**都是这个原因——而且都是本插件自己的输出格式
（` ```dsh-ui `），所以“改了渲染却看不到效果”。

**修法**：`/^\s*```([^\s`]*)\s*$/` —— 语言标识允许任意非空白非反引号字符。
修复后同一批样本：残留标记从 **12 → 1**（剩下 1 条是英文正文里讨论正则字面量的假阳性）。

**验证方法**：`zstd -dc session.v4.jsonl.zstd > sess.jsonl`，抽 `assistant/message` 的
`data.message.content` 里 `type==='text'` 的块，喂给 `RichText` 并检查输出。

### ① 侧边栏位置 + 点击无响应

**位置**：用户要放在 worktable 的【工作台 / 控制室 / 子项目】**上方**，不是左侧。
读宿主 `ui-sidebar` 的 `footerActions` CSS 确认它是 `display:flex`（横向），
而 `dsh-worktable` 与我们都注册在 `sidebar.footer.action` —— 所以默认并排。
修法：`[class*="footerActions"]:has(.ts-side-entry) { flex-direction:column }`，
我们的入口（order 10，先渲染）即落在 worktable 那一组之上。

**点击无响应（真因）**：宿主渲染的是**持久化 store 的 `view` 字段**
（`useStore(s => s.view)` → `resolveActiveView`），而 localStorage 偏好
**只在会话首次绑定时读一次**。用户已经身处某个会话时，写偏好 + `binding.activate()`
（数据层激活）都**不会**改 `store.view` → 界面不动。
修法：新增 `selectHostView()`，点宿主自己的 tab
（DOM 为 `[data-conversation-tabs] button[role=tab]`，按文案匹配「项目中心」，
已选中则不重复点）。已核对宿主确实渲染 `data-conversation-tabs` / `role="tab"` / `aria-selected`。
`scheduleActivate` 也一并多次调用它，兼顾新会话切换后 tab 才渲染的时序。

### ② 顶部 tab 保留
按用户要求不动：`conversation.view` 注册保留，tab 仍可点。

### 验证
- **真实数据回归**：420 条样本 → 渲染 420 / 回退 0 / 残留标记 1（假阳性）；
- **端到端投影**：1705 条消息、**380 条 reasoning**、27 轮；最后一轮 proc 10 项
  （reasoning/assistant/tool 混合）、answer 正常；
- 函数唯一性核对：`selectHostView` / `openControlRoom` / `activateView` / `scheduleActivate` 各 1 处；
- `pnpm run check` 全绿；CSS 大括号平衡 0；bundle 191,687B + `node --check` 通过；
- 线上 bundle 核对：**是当前版本**（与本地逐字节一致，仅差服务器追加的
  `sourceMappingURL` 注释 70 字节）。

## Step 30（2026-10-07）：侧边栏「项目中心」应进入**项目列表**（而非上次的工作台）

### 反馈
点侧边栏「项目中心」后，正确行为是进入含
【添加项目文件夹 → 进入工作台：并行免费模型探索 + 共享黑板 + 协作收益】的**列表界面**，
而不是直接回到上次的工作台。

### 真因（两处叠加把界面拉进了工作台）
1. `ControlRoom` 有「恢复上次打开的工作台」的记忆逻辑：挂载时
   `recallOpenedProject(sessionId)` 有值就 `setOpenedId(remembered)`；
2. 上一版按钮会**把当前会话绑到它所属项目**（`bindSessionToItsProject`），
   而这会**重新写上工作台记忆** —— 于是两者合力，永远进工作台。

### 修法
按钮语义改为「总是先看项目列表」，**不再**绑会话到项目：
1. 新增 `requestProjectList()` / `onRequestProjectList()` 信号；
2. `ControlRoom` 订阅该信号 → `setOpenedId(null)` + 清掉该会话的工作台记忆；
3. 按钮：发信号 → 清记忆 → 写视图偏好 + 激活视图 → 点宿主 tab。

**为什么用订阅而不是一次性标记**：用户可能**已经**在本视图的工作台里，
此时 `ControlRoom` 不会重挂——只在挂载时读标记的写法收不到信号，界面不动。
订阅才能覆盖「已在工作台 → 点按钮 → 退回列表」这条路径。

### 验证
- **交互模拟**：点击前 `openedId='proj-tokensave'` → 点击后 `null` 且记忆清空 →
  渲染项目列表；且「重挂时恢复」不会把它拉回工作台；
- 确认列表态确实含用户描述的那行文案（`ControlRoom.tsx` 的 `ts-center-sub`：
  「添加项目文件夹 → 进入工作台：并行免费模型探索 + 共享黑板 + 协作收益」）与
  「添加项目」卡片；
- `pnpm run check` 全绿；CSS 大括号平衡 0；bundle 192,289B + `node --check` 通过；
- 线上 bundle 核对：新符号 `requestProjectList` / `onRequestProjectList` / `selectHostView`
  均已在线上（HTTP 200，192,477B 含服务器追加的 sourceMappingURL）。

## Step 31（2026-10-07）：侧边栏按钮改为**列表 ⇄ 工作台**切换

### 需求
当前在工作台时点按钮 → 进入项目列表（ControlRoom）；再点一次 → 回到原来的工作台。

### 实现
- `sessions.ts` 新增状态与双向信号：
  - `setControlRoomScreen` / `getControlRoomScreen`：ControlRoom 上报当前屏（`'list' | 'desk'`）；
  - `requestProjectList()` / `requestWorkbench()`：两个方向的切换信号（各自可订阅）；
  - `isForceList()`：独立的“强制列表”标记。
- `openControlRoom()` 改为切换：读当前屏决定方向，两方向都保证「视图被激活 + 点宿主 tab」。
- `ControlRoom` 上报当前屏，并订阅两个信号：列表信号 → `openedId=null`；
  工作台信号 → 恢复上次打开的项目。
- 侧边栏按钮的文字/图标随当前屏变化（列表态显示「项目中心 🗂️」，工作台态显示
  「回到工作台 🧭」），让“再点一次能回去”自解释。

### 自己踩到并修掉的 bug（重要）
第一版为了“切到列表”而**清掉了工作台记忆**，结果再点回来时不知道回哪个项目，
退化成第一个项目。**用模拟测出**：从 `dsh` 工作台 → 列表 → 再点，回到了 `tokensave`（错）。
修法：改用独立的 `forceList` 标记——它只控制“挂载时不要自动恢复工作台”，
**工作台记忆原封不动留着**，供切回时使用。

### 验证（模拟）
- 连点 4 次正确交替：工作台 → 列表 → 工作台 → 列表；
- 关键场景：从 dsh 工作台 → 列表（记忆仍为 p2）→ 再点 → **回到 dsh**（修复后）；
- 重挂时不误恢复：处于列表态（forceList）时重挂仍停在列表；
- `pnpm run check` 全绿；CSS 大括号平衡 0；bundle 194,212B + `node --check` 通过；
- 运行时冒烟 `apply(无服务 ctx)` 不抛异常，三个槽注册正确；
- 线上 bundle 核对：`requestWorkbench` / `isForceList` / 「回到工作台」/「查看项目列表」均在。

## Step 32（2026-10-07）：项目中心 —— 展示方式 / 排序方式 / 卡片与列表两种形态

### 需求
1. 展示方式切换【卡片模式 / 列表模式】+ 排序方式切换【按名称 / 按创建时间 / 按更新时间】；
2. 卡片模式：**点卡片直接进工作台**，去掉「进入工作台」按钮；补充
   【上次更新时间、项目介绍（添加项目时可填）】；新增「展示」按钮 → 跳到该项目的宿主 UI；
3. 列表模式：表格呈现【序号 / 名称 / 路径 / 创建时间 / 上次更新时间 / 项目介绍 / 操作（展示、移除）】。

### 数据层（store.ts）
- `ProjectRecord` 增加 `description`、`updatedAt`；
- **旧数据兼容**：`loadProjects` 里 `updatedAt` 缺失时回退到 `createdAt`，
  `description` 缺失时为空串（实测验证）；
- `addProject(name, path, description)`；同路径去重时**空介绍不覆盖已有介绍**
  （否则重添项目会把填好的介绍清掉——已用测试固定这个行为）；
- `touchProject(id)`：进入工作台 / 点「展示」时刷新 `updatedAt`（“使用过”的语义）；
- `ViewPrefs`（`mode` + `sort`）单独持久化到 `tokensave:project-view.v1`——
  纯 UI 偏好，与项目数据分开，清掉不影响项目列表；
- `sortProjects()`：按名称用 `localeCompare(..., 'zh-Hans-CN')`（中文排序正确）；
  时间类**倒序**（最近的在最前，符合使用直觉）。返回新数组，不改原数组。

### 「展示」= 跳到宿主的原生 UI（sessions.ts 的 `revealProject`）
三级降级保证一定有反应：
1. 该项目已有会话 → `openSession` 打开，并先 `clearViewPreference`（把 `view` 置 null），
   让宿主回落**它自己的**默认对话视图（而不是我们的工作台）；
2. 已有工作区登记 → `uiWorkspace.openWorkspace(workspaceId)`；
3. 都没有 → `workspaces.create({ path })` 登记后再 `openWorkspace`。

### 界面（ControlRoom.tsx）
- 工具条：两组分段控件（`ts-seg`）——展示方式 + 排序方式，右侧显示项目数；
- **卡片模式**：整卡 `role="button"` + `tabIndex=0` + Enter/Space 键支持；
  悬停右上角淡入「进入 →」；显示项目介绍（两行截断）与「更新于 N 分钟前」；
  操作区改为【展示 / 移除】；`stopPropagation` 防止点按钮时误触进工作台；
- **列表模式**：`<table>` 表头 sticky，7 列齐全；路径/介绍单行省略号 + `title` 全量；
- 无会话上下文时卡片置灰且不可进入（`disabled` 类 + 拦截点击）。

### 验证
- **store 单测**：添加带介绍、去重不覆盖介绍、三种排序结果、偏好持久化、
  **旧数据兼容**（无 description/updatedAt）、移除 —— 全部符合预期；
- `pnpm run check` 全绿；CSS 大括号平衡 0 且无未转义反引号；
  bundle 211,486B + `node --check` 通过；
- 线上 bundle 核对：`ts-plist` / `revealProject` / 「按创建时间」/「项目介绍」/「展示」均在。

## Step 33（2026-10-07）：工具条/表格美化 + 移除确认 + 真实 mtime + 展示语义修正

### 1. 工具条与表格美化（“挤在左边一点点太难看了，希望一行控制”）
- 工具条改为**撑满一行的玻璃条**（`.ts-center-toolbar`）：左侧两组分段控件、
  右侧「N 个项目」用 `margin-left:auto` 推到最右；带边框/渐变/阴影，窄屏自动换行；
- 表格：行高与内边距加大（`12px 16px`）、圆角 14px、表头 sticky + 毛玻璃、
  行悬停高亮、操作列右对齐；
- **列宽分配**：名称/路径/介绍设 `min-width` 给足空间，时间列固定 150px，
  不再全部挤在左边。

### 2. 移除前弹确认弹窗
新增 `client/src/panel/ConfirmDialog.tsx`（`role="alertdialog"`）：
- 沿用项目中心玻璃视觉，danger 变体用红色标题 + 实心红确认按钮；
- **默认焦点在「取消」**——破坏性操作不该让回车直接生效；
- Esc 取消、点遮罩取消；
- 内容给出项目名 + 路径 + 明确说明「仅从项目中心移除，**不会删除磁盘上的任何文件**」。

### 3. 「上次更新」= 项目内部文件最后一次修改时间（用户纠正）
之前用的是「我在 DSH 里用过它的时间」，**不符合要求**。改为真实文件 mtime：
- 宿主新增路由 `PROJECT_INFO_ROUTE_PATH = /plugins/dsh-tokensave/project-info`；
- `latestMtimeMs()` 递归扫描，取最大 `mtimeMs`；忽略
  `node_modules/.git/dist/build/target/.next/...` 等噪声目录，不跟随符号链接，
  带 20000 项上限防大目录卡死；
- 客户端 `fetchProjectInfo()`（失败返回 null，不阻断列表）；排序也改用真实 mtime，
  拿不到时回退到本地记录。

### 4. 「展示」= 打开项目自身启动后的 UI（用户纠正）
之前是跳到宿主原生 DSH 界面，**理解错了**。改为：
- 从 `package.json` 的 `dev/start/serve/preview` 脚本推断**显式**端口
  （`--port 3000` / `-p 5173` / `PORT=8080`）；不猜默认端口，避免打开无关地址；
- 用 `net.connect` **真实探测**端口是否在监听（超时 400ms），得到 `devRunning`；
- 前端：`devUrl && devRunning` → `window.open(url)`；否则**无响应**
  （用户明确说“暂时无响应即可”），仅在控制台留一条日志；
- 卡片上对已启动的项目显示绿色「● 已启动」标记。

### 验证
- **路由已在线并实测**（宿主热加载生效）：
  - mtime 与真实文件对照**完全一致**（`styles.ts` = 1791361697 → 路由返回 1791361697740.523）；
  - 起一个真实监听端口 + 写 `dev` 脚本 → `devRunning:true`；服务器停掉后 → `false`；
  - 边界：不存在路径 → 404「目录不存在」；缺 path → 400「缺少 path」；
- `devUrl` 推断单测：`vite --port 5173` / `next dev -p 3000` / `PORT=8080` /
  `vite preview --port 4173` 全部正确；无端口或无 package.json → 空串；
- `pnpm run check` 全绿；CSS 大括号平衡 0 且无未转义反引号；
  bundle 217,890B + `node --check` 通过；线上已含 `ConfirmDialog` / `devRunning` /
  「确认移除」/「不会删除磁盘上的任何文件」等。

## Step 34（2026-10-07）：添加项目弹窗 —— 介绍输入框与名称输入框等宽

### 问题
「项目介绍」的多行输入框比上方「项目名称」输入框窄。

### 真因
名称输入框带**内联** `style={{ width:'100%' }}`，而 textarea 没有；
且项目里根本没有 `.ts-textarea` 的 CSS 规则——`<textarea>` 因此退回
`cols` 属性的默认宽度（约 20 字符），自然比 input 窄。

### 修法（用共享规则，避免以后又只有一边有宽度）
```css
.ts-modal-body .ts-input, .ts-modal-body .ts-select, .ts-modal-body .ts-textarea { width:100%; }
.ts-textarea { min-height:74px; resize:vertical; font:inherit; font-size:13px; line-height:1.55; }
```
同时**删掉**名称输入框上的内联 `width:100%` —— 宽度改由这一条共享规则统一负责，
两个控件必然一致（不再依赖“两处都记得写”）。
顺带给 textarea 补上：允许纵向拖拽、继承字体（否则 textarea 默认等宽字体，与 input 不一致）、
行高放松、最小高度。

### 验证
`pnpm run check` 全绿；CSS 大括号平衡 0；bundle 218,491B + `node --check` 通过；
线上已含 `ts-textarea` / `.ts-modal-body .ts-input` / `resize:vertical`。

## Step 35（2026-10-07）：探索者窗口最大化看不清 + 窄列标题条/过程条换行

### ① 最大化后透明度太高、看不清
**根因**：`.ts-win-overlay` 只加了 `box-shadow`，**没有自己的背景**；而 `.ts-win`
的底色是 `rgba(127,127,127,.09)`（9% 透度，玻璃效果）。全屏铺开后，文字直接压在
底下的内容上 → 看不清。

**修法**：最大化态补一层近实底：
```css
.ts-win-overlay { background:rgba(14,16,21,.97); color:#e6e8eb; border:1px solid …;
  backdrop-filter:blur(8px) saturate(1.1); }
.ts-win-overlay .ts-win-head { background:rgba(255,255,255,.07); }      /* 标题条分层 */
.ts-win-overlay .ts-win-head:hover { background:rgba(255,255,255,.13); } /* 悬停仍有效 */
```
注意：`head:hover` 必须单独写——`.ts-win-overlay .ts-win-head` 在 `.ts-win-head:hover`
**之后**，同权时后者被覆盖，悬停效果会失效（已实测核对线上产物含该规则）。

### ② 窄列标题条溢出换行
两处，都是 flex 子项内部的文字换行（flex 层并未 wrap）：

**探索者窗口标题条**（`ts-win-head`）：
- 尾部按钮组原本是普通 `<span>`（`flex:0 1 auto`）→ 被挤压时**按钮内部换行**、
  标题条变高。改 `flex:none + inline-flex`，永不被压缩；
- 整条补 `flex-wrap:nowrap; overflow:hidden`；名称/中间信息本来就有省略号（沿用）。

**「过程 N 步 · 思考 K 段 · 工具 M 次」**（`ts-proc-head`）：
- 子 span 没有 nowrap → 数量多时文字在 span 内换行。补：
  `flex-wrap:nowrap; overflow:hidden; white-space:nowrap` + 子 span
  `min-width:0; overflow:hidden; text-overflow:ellipsis`；
- **裁剪顺序**：`过程 N 步` 设 `flex:none` 优先保留，「思考/工具」`flex:0 1 auto`
  先缩、先省略（用户允许省略、不允许换行）；
- 整条加 `title` —— 被截断后悬停仍可看到完整计数。

**协作对话/协作收益的中间计数**（`ts-head-mid.ts-card-count`）：
- 原 `flex:none`（不可缩）→ 补 `flex:0 1 auto; min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap`，同样改省略号。

### 验证
`pnpm run check` 全绿；CSS 大括号平衡 0、无未转义反引号；
bundle 220,347B + `node --check` 通过；线上产物核对含
`rgba(14,16,21,.97)` / `ts-proc-lead` / `ts-win-head > span:last-child` /
`.ts-win-overlay .ts-win-head:hover`。

## Step 36（2026-10-07）：DSH 工作区点任意会话 → 直接进入对应项目工作台

### 反馈
在 DSH 自带工作区（侧边栏会话列表）点击任意对话时，没有跳到
【项目中心 → 该项目 → 工作台 → 相匹配会话】。

### 真因（导航链路本身是通的，卡在两个“状态”问题上）

链路回顾：侧边栏点会话 → `openSession`/`openWorkspace` → **`replaceMain`（已包装）**
→ `bindSessionToItsProject` → 写偏好 + 工作台记忆 + 激活视图。这条链早就在。

卡点 1 —— **`forceList` 是粘性的**：
`requestProjectList()` 把 `forceList=true` 置位后，只有侧边栏按钮自己再切回工作台时才清。
用户只要点过一次「项目中心」按钮（停在列表态），之后**点任何会话**，
ControlRoom 的恢复逻辑第一行 `if (isForceList()) return` 就短路 → 永远停在列表。

卡点 2 —— **点“当前已在列表态的同一个会话”时 effect 不重跑**：
恢复逻辑挂在 `useEffect(..., [sessionId])` 上，点同一个会话 sessionId 不变 → 不触发。

### 修法
1. **绑定即清标记**（`bindToProject`）：绑定发生在真实导航（replaceMain 包装 /
   Probe 随会话切换），此时用户意图就是看工作台 → 清 `forceList` 并发工作台信号。
   注：`sweep`（5s 轮询）**不走** bindToProject，因此不会误清——否则轮询会和“停在列表”打架。
2. **信号带目标会话 id**（`emitDesk(sessionId)` → `onRequestWorkbench((targetSid)=>…)`）：
   - 目标 == 当前 prop → ControlRoom 立即恢复（覆盖“点同一个会话”）；
   - 目标 != 当前 prop → 忽略，等 `[sessionId]` 恢复 effect 接手（避免用旧会话的记忆去恢复）。
   两条路互为兜底：`bindToProject` 先于 React 更新清了 `forceList`，所以 prop 到位后的
   恢复 effect 一定能通过 `isForceList()` 检查。

### 验证（模拟 4 场景全过）
- 点过按钮停在列表 → 点 sB 会话 → **工作台(s2)**、forceList 已清 ✓
- 列表态点**同一个**会话（prop 不变）→ 信号直接恢复到 s1 工作台 ✓
- 无记忆时点会话 → 绑定写入新记忆后恢复 ✓
- 非项目会话 → 不绑、forceList 不动（不影响列表态）✓

`pnpm run check` 全绿；bundle 220,714B + `node --check` 通过；
运行时冒烟 OK（三个槽注册正常）；线上产物已含 `emitDesk` / `targetSid && sessionId`。

## Step 37（2026-10-07）：列表模式全左对齐 + 未唤醒时单窗口模式

### ① 列表模式：表头与记录全部左对齐；`#` → `序号`
- `<th className="ts-plist-idx">#</th>` → `序号`（列头语义化）；
- `.ts-plist td` 显式 `text-align:left`；`.ts-plist-idx`（原右对齐）、
  `.ts-plist-ops`（操作列原右对齐）都改为左对齐；
- idx 列宽 52px → 64px（容纳两字表头）。
- 表头 `.ts-plist th` 本来就是 `text-align:left`，无需改。

### ② 未唤醒 tokensave → 单窗口模式（只留 DSH 主对话并铺满）
**判定**：`idle = explorers.length === 0`（该项目没有任何 tokensave-* 探索者会话）。

**关键设计：idle 是纯派生态，不写入任何卡片状态**：
- 若把 `hidden/maximized` 写进 cards，探索者出现时要回滚，会与用户手动操作打架；
- 派生分支直接决定渲染形态，探索者一出现（8s 轮询或首探）立即还原 H 台，零残留。

渲染分支：
```
{idle ? (
  单列单行网格：ts-desk-chat 铺满 → MainChat（actions=null，三键无意义）
) : (
  原 H 台（左竖/黑板/主对话/右竖 + 浮层）
)}
```

配套派生（避免双实例/空台面）：
- `maximizedCard = idle ? null : rawMax` —— idle 下主对话已在网格里铺满，
  浮层一律不上（否则同一 MainChat 双实例、双订阅消息流）；
- `chatMaximized = !idle && …`、`chatDocked = idle || …` —— 输入条停靠到网格里的
  chat cell（即使此前 chat 被 hidden/collapsed，idle 也必须停靠）；
- `{!idle && <ClosedCardsBar/>}` —— 恢复 chip 在单窗口模式下点了也无效，隐藏；
- **不走 cardShell**：idle 分支直接渲染。cardShell 对 `hidden|maximized` 返回 null，
  会让台面空掉；三键在只剩一个窗口时也无意义（`actions={null}`）。

### 验证
- 派生逻辑 6 场景模拟 **6/6**：未唤醒时无论卡片此前被最大化/隐藏/收起 →
  一律单窗口+铺满+停靠开+无浮层+无恢复条；有探索者时 H 台正常（含 chat 最大化/关闭）；
- `pnpm run check` 全绿；CSS 平衡 0；bundle 221,489B + `node --check`；
- 线上产物已核对含 `序号` / `text-align:left` / `gridTemplateColumns:"minmax(0,1fr)"`。
- 已知取舍：进入工作台首次探测返回前（~100ms）会先显示单窗口再展开 H 台
  —— 对“从不唤醒”的项目零闪烁（idle 即首帧），对有探索者的项目有一瞬切换。

## Step 38（2026-10-07）：接入已安装的 GenUI 插件 —— 工作台卡片里的 dsh-ui 围栏不再是一坨 JSON

### 用户要求
已装插件 `@changfenhuang/dsh-genui`，能否用它美化「DSH 主对话 / 探索者对话」里的相关内容显示。

### 先查清楚它到底怎么渲染（结论决定了接法）
1. **它是围栏驱动的**：渲染 `` ```dsh-ui `` 围栏（布局/表格/图表/mermaid/表单/3D…）。
   不是"自动美化任意 markdown"——正文要拿到美化，得让内容包含 dsh-ui 围栏。
2. **两条通道，本宿主走 DOM 通道**：
   - registry 通道需要宿主 `@deepseek-ai/dsh-client-ui-primitives` 暴露
     `registerFenceRenderer` —— **全量搜索该符号在 DSH 安装里为零**，所以
     `useRegistry=false`，插件安装的是 DOM 通道（插件自身也会打印 `fence-channel=dom`）；
   - DOM 通道 `observer.observe(document.body)` + 1s sweep 调
     `findFenceCandidates()`（默认 scope = **document**）——**我卡片里的节点也在扫描范围内**。
3. **它按结构识别围栏**（结构兜底，不依赖宿主类名）：
   *一个叶子元素、文本恰为 `dsh-ui`（且在代码体之外）+ 同级一个 `<pre>`*，
   且该容器必须"可疑似围栏表面"（只含 1 个 `<pre>`、代码体之外无 p/ul/table/标题等块级内容）。
4. **它不在浏览器里可 import**：`./embed` 导出指向**未打包的 TS 源码**（`lib/` 下没有
   `embed.js`），客户端拿不到 —— 所以不能直接调它的 React 组件。

### 接法：只输出它能识别的结构（零耦合、零新增依赖）
`RichText.tsx` 新增 `GenuiFenceSlot`：dsh-ui 围栏渲染成
`div.ts-genui-slot > (div.ts-genui-lang:text=dsh-ui) + pre.ts-rich-code > code`。
- 标签用 CSS `display:none`（接管前不显示字样；**插件被卸载时回落成普通代码块**）；
- `<pre>` 保留**原文**：护栏拒绝/JSON 非法时，插件会在原文上方挂诊断，原文照常可读；
- **未收尾的围栏不交给它**（`const closed = i < lines.length`）：插件把"无 `data-streaming`"
  视为已结算，流式中的半截 JSON 会被判成坏围栏并闪诊断；
- 只收 `dsh-ui`（它的 `svg` 围栏会改变普通 svg 代码块的语义）；json 仍走我自己的 JSON 渲染。

### 验证（真实页面 + 真实插件，非模拟）
用 `agent-browser` 驱动线上 GUI：
1. **形状探针**：往 document 注入与 TSX 完全同构的节点（含一份普通 `<pre>` 作对照）→
   3s 后：我的块 `display:none` + `data-genui-rendered`，其后出现 `genui-dom-fence`，
   渲染出 callout+table 文本；**对照块不受影响**（无误判）。
2. **端到端**：进入真实工作台（`ts-hdesk`）→ 主对话卡片里
   `.ts-genui-slot` ×1、`data-genui-rendered` ×1、`.ts-desk-chat .genui-dom-fence` ×1，
   容器内是真实 React 树（`data-genui="true"`、`V1MMBW_block/_banner/_col/_list`…），
   `rawJsonVisible=false`，无诊断。
3. 服务端产物已含 `ts-genui-slot` / `ts-genui-lang` / `GENUI_FENCE_LANGS`。

### 覆盖范围（诚实说明）
- 主对话卡（MainChat → MsgList → RichText）**已实测**；
- 探索者窗口 / 共享黑板走**同一个 RichText**，且 DOM 通道是 document 级扫描，同一路径适用；
- 但**探索者输出通常没有 dsh-ui 围栏**（子 agent 的纯 markdown），所以那边主要仍是我自己的
  markdown/JSON 渲染 —— 要美化得让内容带上 dsh-ui 围栏。
- 客户端改动需**刷新页面**（当前没有 `pnpm run dev:web` 监听在跑）。

## Step 39（2026-10-08）：预览 ↔ DSH 主对话 的上下分隔条卡顿/闪屏

### 反馈
拖动「预览 / DSH 主对话」之间的上下调节把手时卡顿、闪屏。

### 三个真因（都在拖动路径上）
1. **每个 pointermove 都 setState**：`onSplitDown` 里直接 `setPreviewH(last)`，
   而 pointermove 在高刷鼠标/触控板上可达 100–1000Hz；工作台是一棵很重的树
   （黑板 + 主对话消息流 + 探索者窗口 + iframe），每个事件重渲染一次 → 丢帧。
2. **停靠 hook 每次都被重建**：`useDockNativeComposer` 的依赖里有 `previewH`，
   于是每次拖动都重装 ResizeObserver / MutationObserver / 300ms 轮询并重算输入条位置。
3. **iframe 抢事件 + 反复重绘**：拖得快时指针会滑进 iframe，命中区丢事件（一跳一跳）；
   跨源 iframe 还会拿走焦点；加上文字被选中高亮 —— 观感上就是「闪」。

### 修法
- **按帧合并**：pointermove 只更新 `last`，用 `requestAnimationFrame` 一帧最多提交一次
  `setPreviewH`；pointerup 时若还有未 flush 的帧，先取消再补一次提交（不会丢最后位置）。
- **停靠依赖去掉 `previewH`**：拖动时 chat cell 自身尺寸在变，它自己的 ResizeObserver
  会触发重定位（已实测对齐无误），不需要把高度写进依赖里反复重建观察器。
- **拖动期间 body 加 `.ts-vsplit-dragging`**：
  - `iframe { pointer-events:none !important }` —— 命中区不再丢事件；
  - `user-select:none` + `cursor:ns-resize` —— 不出现选中高亮；
  - `transition/animation:none` —— 过渡动画不再和指针竞争；
  - **握柄保持可见**（`opacity:1`）：拖动时指针会离开分隔条，否则「把手中途消失」。

### 验证（真实页面 + 真实预览）
起了个本地站点（`package.json` 里 `vite --port 4571`）+ 临时项目，走真实
「项目中心 → 卡片 → 工作台」，用 agent-browser 在页面里注入 200 个 pointermove：
| 指标 | 结果 |
|---|---|
| 200 个 pointermove 引起的 style 写入 | **1 次**（改前 = 200 次 React 更新） |
| 同步读 `strip.style.height` | 仍是旧值（证明没逐事件写） |
| 拖动中 body 类 / iframe pointer-events / user-select | `true` / `none` / `none` |
| 握柄 opacity（拖动中） | 0 → **1**（保持可见） |
| pointerup 后 | 类移除、高度生效、**只在此时**写入 localStorage（`321`） |
| 输入条停靠 | 卡片变高后仍对齐：`seat.position=fixed`，`delta=0` |

`pnpm run check` 全绿；CSS 大括号平衡 0；bundle 262,681B + `node --check` 通过。

### 附注
验证期间观察到 `client/src/panel/sessions.ts` 被**另一个会话并发修改**
（出现非我新增的 `bindSessionEventually`，且行号在两次读取间变化；
中途一次 `tsc` 报的 698 行语法错是**读到写入中的半成品**，重跑即恢复）——
本次未触碰该文件的并发改动。

## Step 40（2026-10-08）：分隔条松手后没固定住（往上挤会回弹）

### 反馈
往**下**挤压：松手后停在原地 ✓；往**上**挤压：松手后鼠标落到更下的位置，分界线又跟着往下
—— 没固定住。

### 真因
症状「松手后鼠标一动分界线又跟着走」= **拖动根本没结束**：`pointerup` 丢了，而 window 上的
`pointermove` 监听还挂着 → 之后的每一次鼠标移动都被当成拖动。
为什么会丢：往上拖时指针终点落在**预览 iframe / 宿主顶栏**一带，若该处有元素对指针事件
`stopPropagation`，或者松手发生在窗口外，我们挂在 window 上（非捕获阶段）的 `pointerup`
就收不到。往下拖时终点在主对话区，恰好没这个问题 —— 这就是「只有一个方向不回弹」的原因。

### 修法：结束拖拽三重保险
- **A. `setPointerCapture`**：在分隔条上捕获指针 —— 指针滑出元素/窗口，`pointerup` 也一定
  回到它（再冒泡到 window）。
- **B. 捕获阶段监听**：`pointerup` / `pointercancel` 用 `addEventListener(..., true)`，
  中间元素 `stopPropagation` 也拦不住；再加 `window blur` 与 `visibilitychange`
  （切走应用/最小化时收尾）。
- **C. `buttons` 兜底**（最关键的一条）：松手后再来的 `pointermove` 必然带
  `buttons === 0`（没有任何键按下）—— 这就是“已松手”的铁证，**立即结束**，不再跟随鼠标。
  这条不依赖任何事件能否送达，所以即使 A/B 都失效也不会再出现「跟着走」。
- `end()` 幂等（`done` 标志）：up / cancel / blur / buttons 多路信号只跑一次；
  且**无条件**提交最终值（原先只在有待提交帧时才提交），保证拖到一半松手也停在松手处。

### 验证（真实页面，全部用真实 pointer 事件）
| 场景 | 结果 |
|---|---|
| 上拖 60px | 321 → **261**（Δ 精确） |
| 下拖 100px | 261 → **321**（= rootH-180，正确触顶钳位） |
| 上拖 1000px | → **120**（= PREVIEW_H_MIN，正确触底钳位） |
| 下拖 2000px | → **321**（触顶钳位） |
| **复现原 bug**：上拖后不派发 pointerup，直接派发 `buttons:0` 的 move 到更低处 | 高度**保持 261 不变**、`dragging=false`、持久化 261 —— 不再回弹 ✓ |
| 正常「上拖 + pointerup」后，再派发 `buttons:0` 的远距离下移 | 高度**保持 181 不变** ✓ |

每条路径都在 pointerup 时写入 localStorage，且拖动过程中不写。
`pnpm run check` 全绿；bundle 263,357B + `node --check` 通过。

## Step 41（2026-10-08）：侧边栏收起后，入口按钮去掉外框（与设置/搜索同风格）

### 反馈
左侧边栏收纳（rail）后，「项目中心 / 工作台」切换按钮还带着外框，和「设置 / 搜索」等
图标按钮风格不一致。

### 实测宿主的 rail 图标按钮
用 agent-browser 把侧边栏收起后读计算样式：
| | 我的按钮（改前） | 宿主图标按钮 |
|---|---|---|
| 尺寸 | 20×30 | **36×36** |
| border | `1px solid rgba(127,127,127,.32)` | **`0px none`** |
| background | `rgba(127,127,127,.1)` | **transparent** |
| radius | 8px | **12px** |
| padding | `7px 0` | **0** |

### 修法
组件本来就拿到了槽契约里的 `wide`（收起时 false，已加 `.rail` 类），所以只需给 rail 换一套皮：
```css
.ts-side-entry.rail { justify-content:center; padding:0; width:36px; height:36px;
  border:0; background:transparent; border-radius:12px; }
.ts-side-entry.rail .ts-side-icon { font-size:16px; }   /* 图标放大，和宿主图标同量级 */
.ts-side-entry.rail:hover { background:rgba(127,127,127,.18); border:0; }  /* 悬停只给底色，不再冒边框 */
.ts-side-entry.rail:active { transform:none; background:rgba(127,127,127,.24); } /* 图标按钮不做按压位移 */
```
（`.ts-side-entry.rail` 比 `.ts-side-entry:hover` 更具体，悬停态不会把边框又带回来。）

### 验证（真实页面，收起/展开都测）
- **收起**：我的按钮 = `36×36 / border 0px none / background transparent / radius 12px / padding 0`
  —— 与宿主图标按钮逐项一致 ✓
- **展开**：仍为原卡片样式（`256 宽 / border 1px solid / bg rgba(127,127,127,.1) / radius 8px /
  文案「🗂️项目中心」）→ 无回归 ✓
- `pnpm run check` 全绿；CSS 平衡 0；bundle 264,459B + `node --check`；线上产物含 rail 规则。

## Step 42（2026-10-08）：三处「新建会话」按钮全部接管 —— 徽标 → 项目中心，项目文件夹 → 工作台

### 反馈（多次修复无果）
用户要求 tokensave 接管 DSH 原生全部「新建会话」入口：
1. 侧边栏**徽标下**的「新会话」→ 进 tokensave「项目中心」（选/建项目后再进工作台）；
2. **项目文件夹行悬浮**出现的「新会话」→ 直接进对应项目的工作台（未登记的工作区自动登记为项目）；
3. 工作台顶部「＋ 新建会话」→ 就在当前工作台的项目下开新对话，不跳走。

### 先查清宿主的真实实现（不再靠猜）
读 `@deepseek-ai/dsh-client-ui-sidebar` 与 `@deepseek-ai/dsh-client-ui-workspace` 的 client 源码：
- 侧边栏拥有 brand 行与 New Session，**没有 slot 可以替换**它们；点击一律走
  `workspaceNavigation.startSession(workspaceId)`（`workspaceNavigation = ctx.get('uiWorkspace')`）；
- 徽标下 / 收起态 rail 图标 / 快捷键 Mod+N：`startSession()`（**无** workspaceId）；
- 项目文件夹行（`Rows` 组件）的悬浮图标：`onCreate()` → `startSession(group.workspaceId)`；
- 宿主 `startSession(wid)`：`target = wid ?? 当前会话工作区 ?? 最近工作区` → `openWorkspace(target)`
  → `reuseOrCreateBlank` → `replaceMain`。
→ 两处按钮的**唯一汇合点**就是 `uiWorkspace.startSession`，包住它即可分流。

### 真因 2：空白会话根本不渲染任何 conversation.view（最关键，之前的修补全部落在这里）
宿主 `conversationPhase(session, conversation)`：
```js
conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
  ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
```
而 ConversationRoot 里 `if (session.blank && conversationPhase(...) === 'blank') return null;`。
`activeTargets` 来自 `activityTargets()`：**只装注册过 view target 且 `isActive()` 为真**的视图
（ui-chat 注册 `'chat'`、ui-trajectory 注册 `'trajectory'`）。

**tokensave 只做了 slot 注册（`conversation.view`），没有注册 target** →
`uiConversation.binding(sid).activate('tokensave-control-room')` 是**空操作** →
新建出来的**空白会话**永远停在 Hero「选择一个工作区」——这正是用户看到的
「新建会话后进不了工作台」。浏览器实测：`views.entries()` 只有
`tool-todo-history / trajectory / chat`，没有我们的两个 id；手工补一个 target 后
同一个会话立即渲染出工作台。

### 修法（`client/src/panel/sessions.ts` + `client/src/index.ts`）
1. **`wrapSessionStart()`**：包装 `uiWorkspace.startSession`（与已有 `replaceMain`/`sessions.create`
   包装同一套思路，幂等 + `ctx.inject` 等就绪）：
   - **无 workspaceId** → `openProjectCenterList()`（不建会话，直接把视图切到「项目中心」列表）；
   - **有 workspaceId** → `ensureProjectForWorkspace()`（已登记直接用；**未登记则按工作区路径/标题
     自动 `addProject` 登记**）→ `startProjectSession(project.path, project.id)` 进工作台；
   - 拿不到项目 / 无项目 / 服务不可用 → **原样回落** `original(workspaceId)`，绝不阻断原生能力。
2. **`registerViewTargets()`**：用 `ctx.uiConversation.views.register` 为 `tokensave-control-room` 与
   `tokensave-project-center` 注册 target（`isActive: () => true`，`create()` 给最小快照构造器），
   挂在 `ctx.effect` 上以便 HMR full reload 先注销再重装。有了 target，
   宿主自己的 `restoreView`（读 `dsh.conversation.<id>.view`）与本插件的 `scheduleActivate`
   才能真正把空白会话拉成 `'active'`，工作台/项目中心随即渲染。
3. **`openProjectCenterList()` / `skipNextBindFor()`**：徽标路径若**没有当前会话**，
   先打开一个已登记项目的会话以取得视图上下文，再用一次性豁免（TTL 4s）阻止自动绑定
   把视图偏好改写成「工作台」，保证停在项目列表。

### 验证
① **逻辑仿真**（esbuild 打包 sessions.ts → node 桩环境，假 ctx/假 DOM）**21/21 通过**：
接管安装、徽标→项目中心（写偏好 + 点 tab + 不叫原生）、文件夹→工作台（workspaceId 透传建会话、
偏好=工作台、点 tab）、未登记工作区自动登记、未知工作区回落原生、无会话时开最新会话且停在项目中心、
豁免 TTL 到期后恢复正常绑定。
② **真实浏览器端到端**（agent-browser 驱动 3080，真实点击，非模拟）：

| 入口 | 期望 | 实测 |
|---|---|---|
| `views.entries()` | 含我们的两个 target | `["tokensave-control-room","tokensave-project-center",...]` ✓ |
| `uiWorkspace.startSession` / `replaceMain` 包装 | 已接管 | `{start:true, main:true}` ✓ |
| 侧边栏徽标「新会话」 | 项目中心列表 | `center="🎛 项目中心" / activeTab=项目中心 / desk=false` ✓ |
| 项目文件夹「tokensave」新会话 | tokensave 工作台 | `desk=true / project=tokensave / activeTab=工作台` ✓ |
| 工作台顶部「＋ 新建会话」 | 仍在本项目工作台 | `desk=true / project=tokensave / activeTab=工作台` ✓ |
| 项目文件夹「ai」（未登记）新会话 | 自动登记 + 进其工作台 | `desk=true / project=ai / activeTab=工作台` ✓ |

③ `pnpm run check` 全绿；`pnpm build:client` 通过；`node --check dist/client.js` 通过；
3080 经 client HMR 已下发新 bundle（graph rev `39691ea7a0c3` → `f34502250ff6`）。

### 遗留 / 副作用
- 验证过程自动把 `/Users/sonoma/Desktop/测试/ai` 登记进了项目中心（即所选「自动登记」行为），
  可在项目中心「移除」；验证还留下少量空白会话（标题「新会话」，tokensave / ai 工作区），可归档。
- 徽标路径在**完全没有当前会话**时的分支（先开一个项目会话再切列表）只能靠逻辑仿真验证，
  真机难构造，留待后续目检。

### 追加（同日）：项目中心卡片 / 列表的「进入工作台」→「＋ 新会话」

用户反馈：徽标下的「新会话」只能到「项目中心」，希望在那里点一下就能开新对话进工作台。
因此把卡片模式与列表模式里的「进入工作台」按钮**统一改成「＋ 新会话」**
（`ProjectCenter.tsx`）：

- onClick → `startProjectSession(p.path, p.id)`（与工作台顶部那个「＋ 新建会话」同一个函数）：
  复用该项目已有空白会话，没有则在 `{ workspaceId }` 下建一个，再写视图偏好并进入工作台；
- 加 `busyId` 防连点（按钮文案变「新建中…」并禁用）+ 失败提示（`notice`，4s 自消，落在工具条下方）；
- **点整张卡片 / 整条记录行仍是「进入工作台」**（进该项目当前会话），点序号点仍是进那条指定对话；
  这样「新会话」与「回旧对话」两个能力都保留，不会每次误点都造出空白会话。
- 顶部文档注释同步更新。

实测（agent-browser 真实点击 3080）：

| 入口 | 实测 |
|---|---|
| 项目中心・卡片模式・卡内「＋ 新会话」（第 2 张卡） | `desk=true / project=preview-demo / activeTab=工作台` ✓ |
| 项目中心・列表模式・行内「＋ 新会话」（第 1 行） | `desk=true / project=ai / activeTab=工作台` ✓ |

`pnpm run check` 全绿；`pnpm build:client` + `node --check` 通过。

## Step 43（2026-10-08）：侧边栏「项目中心」呼吸灯（3 个小圆点）

### 需求
在左侧边栏的「项目中心」入口上加一个**呼吸灯**：3 个小圆点表示是否有项目还在活动。
- 有对话存活才显示；所有对话都完成时**不显示**圆点；
- 正在跑 = 绿点；弹选择框 / 被故障中断（调用失败、任务未完成验收）= 黄点（黄覆盖绿）；
- **有对话在跑时 3 个点依次闪烁**（跑马灯）；只有待处理/失败时同相呼吸；
- 圆点右对齐；侧边栏收起后**直接用圆点顶替图标**，没有存活对话才回到原图标；
- 收起态实在挤不下 3 个时允许降为 2（展开也跟 2）。

### 数据源（关键：宿主没有「上一轮失败」字段）
- `running` / `pendingInteraction`：`uiSession.sessionStatus`（与项目卡片 ①②③ 同源）。
- 「上一轮是否正常结束」：SessionSummary 只有 running/blank/updatedAt，sessionStatus 只有
  running/pendingInteraction/completionUnread——**无失败标志**。因此只能读会话事件窗口里
  最后一条 `turn/end.reason.kind`：`completed` / `forked` / `aborted`（用户主动停）以外
  （`error` / `interrupted` / `blocked` / `max-tokens`）算「被故障中断」。
  读窗口要 `sessions.using(id, { source:'gateway' }, ref => …)`（retain → 读
  `binding.eventSource.getSnapshot()` → release），**有成本**，所以做成：
  - 只扫「已停下来、非空会话、updatedAt 在 1 小时内」的候选；
  - 一次最多 retain 5 个；扫描间隔 ≥10s；
  - 结论按 `sessionId + updatedAt` 缓存 → 同一个会话每个版本只判一次，稳态几乎零开销。

### 实现
- 新增 `client/src/panel/pulse.ts`：`useActivityPulse()`（订阅 sessions.list +
  uiSession.sessionStatus + 4s 兜底轮询，与 activity.ts 同款）→ `{ alive, warn, running, tip }`；
  内部 `scanOutcomes()` / `sessionTurnFailed()` 负责失败判定。
- `activity.ts`：把 `statusSnapshot()` 改成导出（pulse 复用，避免双份实现）。
- `ControlRoomEntry.tsx`：wide 时图标 + 文字 + 圆点（`margin-left:auto` 右对齐）；
  收起时**圆点顶替图标**；`title` 里列出存活对话（`● 进行中 / ⏳ 待你确认 / ⚠️ 上一轮未正常结束`）。
  圆点数默认 3，用 ResizeObserver 量按钮宽度，<30px 才降 2（实测 rail 36px → 保持 3）。
- `styles.ts`：`.ts-pulse*` + `@keyframes ts-pulse-chase`（依次闪烁）/ `ts-pulse-breathe`
  （同相呼吸）；`animationDelay` 由 JSX 按序号 0/.16/.32s 给出；尊重 `prefers-reduced-motion`。

### 验证（真实浏览器 3080）
| 项 | 实测 |
|---|---|
| 入口圆点 | `.ts-side-entry` 内 3 个 `.ts-pulse-dot`，`ts-pulse ts-pulse-run` ✓ |
| 圆点样式 | `6×6`，`rgb(34,197,94)`，`animation=ts-pulse-chase` ✓ |
| 跑马灯相位 | 三个点 `animation-delay` = `0s / .16s / .32s` ✓ |
| 黄色（warn）样式 | 合成节点 `ts-pulse-warn` → `rgb(245,158,11)` + chase ✓ |
| 收起态 | `ts-side-entry rail`（36px）→ 3 个圆点、**`icon=null`**（顶替图标）✓ |
| 展开态 | icon=🗂️ + 文字「项目中心」+ 3 个圆点 ✓ |
| `sessions.using` 运行时可用 | `USING_OK`，读到 `turn/end.reason=completed` ✓ |
| 悬停说明 | `● 进行中：新建会话按钮跳转逻辑` ✓ |

**诚实说明**：黄色分支的**触发器**没有真实数据可演——当前 1 小时内活动的会话里
`turn/end` 全是 `completed`、也没有待确认弹窗，所以实测只能盖到绿色；黄色是
`warn>0` 到 CSS 的一段映射（已用合成节点逐项验过），以及失败判定的取数路径
（`sessions.using` 已实跑通）。
「无存活对话 → 不显示圆点 + 收起时回落图标」是 `{alive && …}` / `{(!alive || wide) && 图标}`
两个条件式，真机不好构造（需全部对话停完），靠代码保证。

`pnpm run check` 全绿；`pnpm build:client`（307,269B）+ `node --check` 通过。

## Step 44（2026-10-08）：主对话标题条——统计居中 + 细化为 msg / user / agent

### 反馈
DSH 主对话标题行里的消息条数：① 不居中；② 想要更细的统计（总数 / user / agent）。

### ① 不居中的真因（实测量出来的）
标题条三段式是 `[标题][中间信息][三键]`，而 `.ts-head-mid` 用 `margin:0 auto` 居中——
那是“在标题与三键**之间**的剩余空间里”居中，不是整条居中。标题（「💬 DSH 主对话」
≈87px）与三键（三个按钮 ≈78px）宽度不等，中间信息就会偏。
改成三段式 **grid**（`grid-template-columns:1fr auto 1fr`）后两侧列等宽，
中间那段就是整条的正中：
```css
.ts-mainchat-head { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; }
.ts-mainchat-head > * { min-width:0; }          /* 两侧列可被压缩，1fr 才真对称 */
.ts-mainchat-head > .ts-head-mid { justify-self:center; margin:0; }
.ts-mainchat-head > .ts-card-actions { justify-self:end; margin-left:0; order:0; }
```
实测：`headCenter 776.5 / midCenter 776.5`，`deltaPx = 0`（改前用 flex + margin:auto）。

### ② 统计细化：`msg N · user N · agent N`
口径（与 MsgList 的收纳一致）：
- `msg`   = **已载入**的会话流行数（工具结果/上下文注入也算一行；`messages.length`）
  —— 窗口是分页的，往上滚动加载更早历史后它会变大（行数本来就与旧版「N 条消息」同源）；
- `user`  = `role==='user' && !injected`：你发出的消息，**不算**宿主自动注入的
  `runtime-context / user-approval / skill-catalog` 等（实测本会话窗口里 4 条 user/message
  中有 2 条是注入，只有 2 条是真人）；
- `agent` = `role==='assistant' && kind!=='reasoning'`：助手**有正文**的回复，
  不算思考片段与只跑工具的步骤（实测窗口里 assistant/message 有 51 条，但真正出正文的只有 6 条）。
悬停 `title` 里逐项写明了这三个口径。样式：标签小一号、数字 `tabular-nums`。

### 验证（真实浏览器 3080）
| 项 | 实测 |
|---|---|
| 标题条布局 | `display:grid`，列宽 `393.97px / 137.06px / 393.97px`（两侧相等）✓ |
| 居中偏差 | `midCenter − headCenter = 0.0px` ✓ |
| 文案 | `msg 112 · user 2 · agent 6`（随消息流实时变化：101 → 112）✓ |
| 口径交叉核对 | 窗口 870 事件：user/message 4 条（2 条注入）/ assistant/message 51 条 → 投影出行 101 条 ✓ |
| 悬停说明 | `msg：已载入的会话流行数… / user：… / agent：…` ✓ |

`pnpm run check` 全绿；`pnpm build:client`（310,524B）+ `node --check` 通过。

## Step 45（2026-10-08）：过程 / 上下文注入——展开后点正文任意位置即收起

### 反馈
「过程」与「上下文注入」展开后只能滚回顶部点折叠头才能收起，太麻烦。
要求：展开后点击里面任意位置（**子折叠/展开按钮除外**）都能收起。

### 修法（`MsgList.tsx`）
新增 `collapseOnBodyClick(close)`，只挂在**已展开的正文容器** `.ts-proc-body` 上
（`ProcessGroup` 与 `InjectionRow` 各一处）：
- 不挂折叠头：头部本身就是切换按钮，挂上去会双触发（点一下开+关）；
- 跳过可交互元素：`button / a / input / select / textarea / [role="button"] /
  [contenteditable]` —— 子折叠按钮（ProcItem 的 ▾▴）与 RichText 里的链接照常工作；
- 有文本选区时不收起：否则正文里的文字永远选不中（`window.getSelection()` 非空则跳过）。

### 验证（真实浏览器 3080）
| 场景 | 期望 | 实测 |
|---|---|---|
| 展开一个「过程 N 步」（69 条子项） | 正文出现 | `bodyPresent=true, items=69` ✓ |
| 点子折叠按钮（ProcItem ▾） | 不收起，只展开那条 | `groupStillOpen=true, itemExpanded=true` ✓ |
| 点正文里的普通文字 | 收起 | `groupCollapsed=true` ✓ |
| 先拖选文字再点 | **不**收起（选区保护） | `sel len=126 → stillOpen=true` ✓ |
| 「上下文注入」展开后点正文 | 收起 | `injectCollapsed=true` ✓ |

`pnpm run check` 全绿；`pnpm build:client`（311,000B）+ `node --check` 通过。

## Step 46（2026-10-08）：标题行增强 —— 隐藏窗口明示 / 项目名徽标 / 一键切换

### 需求（四条）
1. 「已关闭：＋ …」恢复区固定显示在标题行，位置移到「历史会话」左侧；只有全部窗口都呈现时才消失。
2. 标题行最左侧去掉「← 项目中心」按钮与项目路径，只留项目名，并做显著标识。
3. 标题行加一个快捷按钮，在「显示全部窗口」与「仅显示预览（如有）+ DSH 窗口」之间一键切换。
4. 标题行区域顺序固定：项目名称 → 已关闭列表 → 一键切换 → 历史会话 → 新建会话。

### 改动落点（`client/src/panel/HDesk.tsx`、`styles.ts`）

1. **已关闭区升格为标题行组件**：`ClosedCardsBar` → `ClosedWindowsBar`（`<div>` → `<span>`），
   新增 `ClosedWindowItem`（`{ id, label, kind: 'card' | 'explorer' }`），把**卡片（含预览）+ 被隐藏的探索者窗口**
   统一收进一个恢复条；`closedItems` 为空即不渲染（= 全部窗口都呈现）。
   同时删除列底的 `renderHiddenChips()`（探索者恢复 chip 不再在列尾重复一份）与旧的 `closedCards`。
2. **左侧只留项目名**：删掉 `← 项目中心` 按钮与 `.ts-sub.ts-bar-path` 路径；项目名改为
   `.ts-title-proj` 徽标（蓝色渐变底 + 描边 + 19px/700 + 🗂 图标，超长省略号）。`onBack` 仍留在 `Props`
   （调用方照传）但不再渲染按钮——返回项目列表改由左侧边栏的「项目中心」入口承担。
3. **一键切换按钮**（`.ts-btn-mode`）：`allShown = closedItems.length === 0`；已全部呈现则收起为
   「仅保留预览（如有）+ DSH 主对话」（并把探索者最大化浮层一并退出），否则全部放出。
4. **默认态改为「已关闭」**：`cards` 初始把 `board / talk / save` 置 `hidden: true` —— 未唤醒 tokensave
   时只呈现 DSH 主对话，隐藏的黑板 / 协作对话 / 协作收益**列在标题行可选择性恢复**；
   探索者一出现（`autoRevealed` 一次性 effect）自动把三张卡放出，保持「跑起来自动还原 H 台」的既有行为。
5. **派生态改名**：`idle`（`explorers.length === 0`）→ `compact`，含义扩为「黑板 / 协作对话 / 协作收益 三个
   都关闭且无可见探索者」——恢复任意一个窗口即可退出单窗口态（支持选择性恢复）。
6. **样式**：`.ts-bar-right` 改 `flex:0 1 auto`；新增 `.ts-bar-tools`（右对齐、可换行）、`.ts-title-proj*`、
   `.ts-btn-mode`；`.ts-closed-bar` 改 `flex:0 1 auto; max-width:100%` 并压矮内边距以适配标题行。

### 验证
- `pnpm run check`（tsc --noEmit）全绿；`pnpm build:client` → `dist/client.js` 316,458B；`node --check` 通过。
- 线上 bundle 经 `/plugins/events` 取 rev（6c2d984c2206 → **35c8c9448ea5**，HMR stat-poll 已自动感知，**无需重启**），
  `GET /plugins/??dsh-tokensave/client.js&rev=35c8c9448ea5` HTTP 200、`node --check` 通过，本地 dist 为线上前缀；
  解码核验 `ts-title-proj` / `ts-bar-tools` / `ts-btn-mode` / `ClosedWindowsBar` / `toggleAllWindows` /
  `restoreWindow` / 「显示全部窗口」/「仅显示预览 + DSH」/「已关闭：」均在位（esbuild 把非 ASCII 转写为 `\uXXXX`）。
- 逻辑自检：首屏（无探索者）`closedItems=[共享黑板, 协作对话, 协作收益]` → 按钮「▣ 显示全部窗口」；
  点 chip 恢复单个 → `compact=false` 退出单窗口态；「显示全部窗口」→ 三卡 + 探索者全放；
  「仅显示预览 + DSH」→ 只留 chat(+preview) 且清 `overlayId`。

**浏览器目检项（未能自动执行，需人工看一眼）**：标题行左→右为「项目名徽标 | 已关闭列表 | 一键切换 |
历史会话 | 新建会话」；无探索者时「已关闭：＋ 共享黑板 ＋ 协作对话 ＋ 协作收益」在列、点任一即可放出对应窗口；
点「显示全部窗口」后整个 H 台出现且恢复条消失；再点「仅显示预览 + DSH」回到单窗口（预览可用时带预览条）。

### 追加调整（同一轮反馈）
1. **按钮文案**：一键切换按钮**固定显示「一键切换」**（不再在两个模式名之间切换文案）；当前模式与点击结果仍由 `title` 悬浮说明。
2. **无探索者时的左右两栏**：
   - 删除左列「左列暂无模型窗口 / 运行 tokensave_delegate 后自动出现」提示；
   - `.ts-card-talk` / `.ts-card-save` 在该列没有探索者窗口时加 `ts-card-talk-solo` / `ts-card-save-solo`
     （`flex:1 1 0`）——**铺满整列可用高度**（原来固定 40%，下方留 60% 空档）；
   - 铺满时**不再拉伸内部卡片**：`.ts-save-block` 由 `flex:1 1 0` 改 `flex:0 0 auto`、`.ts-save-rows`
     由 `flex:1; justify-content:center` 改 `flex:0 0 auto` —— 优势/劣势两卡按内容自然高度，多余空间留在下方；
     装不下时由 `.ts-save-body` / `.ts-talk-list` 自身的垂直滚动条承担（`overflow:auto` 既有）；
   - 多窗口并存时两栏仍固定 `flex:0 0 40%`（不被压扁），内容超出即内部滚动，不互相挤压。

验证：`pnpm run check` 全绿；`pnpm build:client`（324,952B）+ `node --check` 通过；bundle 冒烟通过；
线上 rev `0f5febb95fbd` 本地 ⊆ 线上，含 `一键切换` / `ts-card-talk-solo` / `ts-card-save-solo`，`左列暂无` 已消失。

## Step 46（2026-10-08）：侧边栏入口连点闪屏修复 + 工作台显示「本轮异常中止」

### ① 侧边栏「项目中心」快速连点闪屏
**用户反馈**：点击较频繁快速时容易闪屏（从项目中心快速变为工作台后又立即切回项目中心，然后才定住）。

**根因**（两处叠加）：
1. `sessions.ts` 的切 tab 靠一串延迟点击（`[0,120,400,900]`ms）等宿主异步回流；旧动作的**尾随定时器**
   不作废，会在新动作之后触发，把界面拨回上一个目标。
2. `openControlRoom()` 用 `getControlRoomScreen()` 判方向，而该值由视图**挂载时**上报——
   连点时它滞后一整拍，第二次点击会算出反方向。

**修法**：
- **导航代次**（`navEpoch` + `beginNavigation()` / `runIfCurrent()`）：每次导航 +1，
  所有延迟回调（`scheduleActivate` / `scheduleSelectHostView`）带上发起时代次，过期即自废 → 最后一次点击胜出。
- **意图即真值**：`requestProjectList()` / `requestWorkbench()` 当场同步 `controlRoomScreen`，
  按钮点击瞬间也乐观落定目标屏（不等宿主回流）。
- **`getLiveScreen()`**：优先读宿主 DOM 的 `aria-selected`（即时真值），并有 `NAV_SETTLE_MS=700` 的
  意图生效窗口——窗口内以意图为准，避免拿旧 DOM 顶回刚发起的导航。
- **连点防抖**（`ControlRoomEntry` 的 `NAV_LOCK_MS=700`）：导航在途忽略重复点击。

**A/B 对照（真实浏览器 3080，同一脚本）**：

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 2 次点击，间隔 250/320/500ms | 1 次切换 | 1 次切换 |
| 2 次点击，间隔 **700ms** | **4 次切换**（尾随定时器互斗） | **2 次切换** ✓ |
| 4 次点击，间隔 50ms | 1 次 | 1 次 |
| 4 次点击，间隔 1100ms | 双向正常往返 | 双向正常往返 ✓ |

宿主真实切换耗时实测：tab 选中 8–29ms、视图挂载 1–3ms（故 700ms 窗口足够且不吞有意的二次点击）。

### ② 项目中心页整条隐藏聊天输入条
**用户要求**：项目中心页隐藏聊天输入框及其状态信息（模型名 · 费用 · 上下文占比 · 步数 · token 缓存…）。

**修法**（`styles.ts`）：输入条座位与本视图是兄弟节点（同在 `[data-conversation-scroll]` 内），
因此 `body.ts-center-open [data-conversation-region="composer"] { display:none !important }`。
用 `display:none` 而非卸载节点——切回工作台时输入条原样恢复，宿主不重排、不丢状态。

### ③ 工作台明示「本轮异常中止」（用户反馈：只有原生「对话」tab 能看出）
**根因**：`session-subscribe.ts` 的 `messagesFromWindow` 把 `turn/end` **整个丢弃**，
于是工作台里「被故障中止的一轮」与「正常结束」外观完全一致。
（此前只有侧边栏呼吸灯读 `turn/end`，消息流本身没有。）

**修法**：
- `session-subscribe.ts` 新增 `TurnNotice` + `noticeFromEvent()`，语义对齐宿主
  `dsh-client-ui-chat` 的 turn-error / turn-max-tokens 节点：
  `error` → 用 `reason.error.{message,code}`（如 `REASONING_LOOP`）；`max-tokens` → 输出被截断；
  `aborted` → **用户主动停止不报**，钩子/登出等异常中止要报；`completed`/`forked` 不产出行。
  `messagesFromWindow` 与逐事件路径 `emitEvent` 都产出该行（role=`system`，带 `notice`）。
- `MsgList.tsx`：`splitTurn` 把 notice 单独收口（不埋进「过程」折叠），轮末渲染 `TurnNoticeRow`
  —— 琥珀色警示块（error/blocked 转红）、带错误码徽章、正文可展开。
- `styles.ts`：`.ts-turn-notice*` 样式。

**验证**：
- 逻辑单测（对照真实会话日志）：真实 `turn/end` 2 条 → 均判为需提示（`REASONING_LOOP`）；
  边界全对（completed/forked/用户主动停止 → 不提示；登出中止/max-tokens/agent-error → 提示）。
- 投影测试（esbuild 打包 `session-subscribe.ts` 后跑真实日志 91 事件）：投影 113 条消息，
  2 条带 notice，且正确落在第 1、2 轮轮末（轮 3 正常结束无 notice）。
- 真实浏览器 3080：工作台渲染出 `⛔ 本轮运行失败 REASONING_LOOP ▾`，展开可见完整判据原文。

`pnpm run check` 全绿；`pnpm build:client`（323,477B）+ `node --check` 通过。

## Step 47（2026-10-08）：探索者设置（默认 / 免费 / 收费 三组开关，自行控制探索者）

### 需求
标题行【一键切换、历史会话】之间加一个「探索者设置」按钮；点击展开浮动面板，内部三个大区
「默认 / 免费 / 收费」列出可用探索者，每个探索者后面一个 toggle switch 可自由开关（包括默认的
也能取消），但至少保留 1 个选中；三个大区后面也有 toggle，控制其包含探索者的快速全选 / 取消。

### 实现
- **宿主 `src/explorer-catalog.ts`（新）**：纯数据层，无 ctx。`EXPLORER_GROUPS`（默认/免费/收费）、
  `FREE_PROVIDERS` 白名单、`KNOWN_MODELS`、`buildCatalog(providerEntries)` → 三组候选、`sanitizeSelection`、
  `selectionToConfigs`。默认组 = 内置三个预设（沿用其 label/focus）；免费/收费 = 已声明 provider 的已知模型。
  刻意不调 `ctx.llm.listModels()`（per-provider 异步探测可能打网络、会拖慢面板），用已知清单，快且确定。
- **宿主路由**：新增 `GET|POST /plugins/dsh-tokensave/explorer-settings`（新增 `explorerSettingsGuard`，
  与 scope/projects 同款自行鉴权 + 方法判定）。GET 返回 `{ groups, selected, configured }`（provider 目录 =
  `ctx.llm.listProviders()`（live）+ `listConfigurableProviders()`（含休眠），后者让「收费」即使未配凭据也列得出，
  并标 `available:false`）。POST `{ selected }` → 写入 `~/.dsh/tokensave/explorers.json`（原子替换），空选择 400。
- **编排 `parallelExplore`**：读 `readExplorerSelection()`；存过选择 → `selectionToConfigs(saved)` **完全按选择跑**，
  从未配置 → 保持旧行为 `EXPLORER_PRESETS.slice(0, explorerCount)`。
- **客户端**：`api.ts` 新增 `fetchExplorerSettings` / `saveExplorerSettings`；新组件
  `client/src/panel/ExplorerSettings.tsx`（按钮 + portal 浮动面板 + `role=switch` 小开关；逐个/整组开关，
  最后一个不允许取消并提示「至少保留 1 个」；乐观更新 + 失败回滚）；HDesk 标题行在【一键切换】与
  【历史会话】之间插入 `<ExplorerSettings />`；styles.ts 新增 `.ts-expset*` / `.ts-switch`。

### 验证
- `pnpm run check` 全绿；`pnpm build:client`（340,981B）+ `node --check` 通过。
- **宿主逻辑 headless 实测**（DSH_HOME 指向临时目录）：`buildCatalog` 三组归位正确（默认 3 预设 / 免费 1 / 收费 2，
  休眠 provider 标 `available:false`）；`writeExplorerSelection` → `readExplorerSelection` 往返一致；空选择被拒
  （「至少保留 1 个探索者」）；非法项（无 `/`）被过滤；`selectionToConfigs` 映射正确。
- **焦点修复**：预设模型必须用自己的 `focus`（否则 Nemotron 的「性能与实现复杂度」被 provider 默认值盖掉）——
  实测默认组 focus = 整体方案可行性 / 边界条件与异常处理 / 性能与实现复杂度。
- **线上实测（3080）**：`GET /explorer-settings` 200，返回三组目录（默认/免费/收费）+ `configured`；
  面板实际被使用并落库（`~/.dsh/tokensave/explorers.json` 有选择）。宿主改码经 HMR 已生效（无需重启）。

### ⚠️ 事故与修复（本人造成）
探测新路由时对存量写路由误发了 `POST /projects -d '{"selected":[]}'`，而 `handleProjectsWrite` 当时把
「缺 projects 字段」当作空列表处理 → 把服务端项目注册表（`~/.dsh/tokensave/projects.json`）写成了空表。
处置：① 立即把该文件移走，使服务端回到 `initialized:false`，触发客户端既有的「本地有数据就反向播种」
路径；客户端随后的同步把注册表按**浏览器缓存**原样重建（已恢复）；② 加固 `POST /projects`：请求体缺 `projects`
数组一律 400（真正的清空必须显式 `projects: []`）。教训：探测写路由必须用与真实语义一致的最小体，或先 GET。
（当前注册表内容 = 恢复后的 1 条：tokensave，与浏览器缓存一致。）

`pnpm run check` 全绿；`pnpm build:client` + `node --check` 通过。

### 追加（同日第二轮反馈）
1. **分组开关换色**：三个大区（默认/免费/收费）后面的 switch 改蓝色（`.ts-switch-group.on`），
   与单个探索者的绿色开关在视觉上分开。
2. **三组互不重复**：默认组的 model 一律从免费/收费里排除（`buildCatalog` 的 `seen` 去重，
   默认组先入）——所以 our-free-model 上即使也广告了同 id，也不会在两组各冒一个。
3. **不再用手写清单：改用真实模型目录**（用户指出 our-free-model 还有很多可用免费模型）。
   `ctx.llm.listModels(provider)` 对**已注册** provider 逐个取它当下广告的模型（our-free-model 的
   adapter 就是返回其目录 / picker membership；`LlmModelInfo.name` 与 `description` 一并用于标签与悬浮说明）；
   每 provider 4s 超时 + 结果缓存 60s（避免每次开面板都打网络），失败/为空时回退 `KNOWN_MODELS`。
   实测（3080 GET /explorer-settings）：默认 3 / **免费 30** / **收费 56**——免费里 now 有 Jev 1.13、Exo、
   Space Bunny、Longcat 2.5、Nemotron 3.5 Lightning、Kimi K2.6/K3、GPT-OSS 20B、GLM 5.3、Kilo 系列等。
   注：`listModels` 是“目录/成员”口径，核心路由也接受未列入的 model id——实测 `mimo-v2.6-flash-free` /
   `nemotron-3-ultra-free` 仍在 adapter 的 `src/catalog.js` 里，只是不在当前 membership，默认组照用无碍。

`pnpm run check` 全绿；`pnpm build:client`（342,035B）+ `node --check` 通过；线上 rev `3ef31b78cccd`。

## Step 48（2026-10-08）：工作台「时不时刷一下、对话跳回更早」——定位到布局翻转重挂聊天卡

### 反馈
在工作台看对话时，界面会时不时刷新一下；原本滚到最下面（正在看最新回复）的
DSH 主对话，刷新后变成停在更早的聊天内容，每次都得重新拉到底。

### 真因（真实浏览器 3080 实测，非推测）
工作台的「未唤醒 tokensave = 单窗口铺满」与「有探索者 = H 台」是**两棵不同的 JSX 树**：
```tsx
compact ? <单窗口树> : <H 台树>   // 旧写法：两个分支
```
React 见到分支切换会**卸载重建整棵子树**，中下格的 `MainChat`/`MsgList` 连同
其内部滚动容器 `.ts-chat-msgs` 一起被换掉——新节点的 `scrollTop` 从 0 开始，
于是视图回到最早的消息。

为什么「时不时」：HDesk 每 8s 探测一次探索者（`setInterval(probe, 8_000)`），
探索者会话一旦增/减（派发、完成、被清理），`compact` 就翻转一次，界面就“刷”一次。

**实测证据**（给 `.ts-chat-msgs` 装 `scrollTop` setter 陷阱 + 节点身份探针）：
翻转前后节点身份由 `msgs#1` 变为 `msgs#2`（`containerAttached` 事件伴随），
新节点 `scrollTop = 0`；不翻转时节点身份稳定不变。

### 修法
1. **单棵稳定树**（`HDesk.tsx`）：不再用 `compact ? A : B` 两个分支，只留一棵树，
   切换布局只改 grid 样式；主对话固定渲染在**同一个 child index**，其余格子用
   `{!compact && …}` 渲染成 `false`（不占位、不挤动兄弟）。这样布局翻转不再重挂卡片，
   滚动位置、展开态、已加载历史全部保留。
2. **滚动位置记忆**（`MsgList.tsx`）：组件重挂仍是可能发生的（最大化/还原等），
   因此把位置按会话存到模块级 `SCROLL_MEMO`（卸载前 `useEffect` 清理函数里写，
   挂载时 layout effect 恢复），并新增 `followKey`（= sessionId）区分「同会话重挂」
   与「切到别的会话」——后者仍应贴底看最新。
3. **贴底稳定化**（`MsgList.tsx`）：布局切换时宿主输入条会重新停靠，
   `.ts-chat-msgs` 的 `padding-bottom`（`--ts-composer-h`）分几步异步变化，中间态会把
   `scrollTop` 夹到一个较小的值且**不会**自己恢复。新增一段有界 rAF 窗口
   （1.5s 内反复贴底、尺寸稳定即停），只在 `pinnedRef` 为真时动手。
4. **用户意图与布局钳位的区分**：这是最容易搞错的一步——布局钳位产生的 scroll 事件
   与「用户往上翻」长得一模一样（实测正是它把 `pinned` 误置为 false，留下 98px 偏差）。
   现在只有**真实输入事件**（wheel / touch / keydown / pointerdown / mousedown，捕获阶段）
   才算用户意图；程序化改 `scrollTop` 不算。

### 验证（真实浏览器 3080，headless Chrome + CDP 驱动）
| 场景 | 期望 | 实测 |
|---|---|---|
| 连续翻转 5 次 | 聊天卡/消息流节点身份不变 | `replacements: []`（始终 `N1`）✓ |
| 贴底时翻转 | 仍贴底（gap≈0） | `gap=0` → `gap=0` ✓ |
| 用户往上翻后翻转 | 位置保持、不跟随 | `st=878 → 878`，`gap=305` 不变 ✓ |
| 点「回到最新」 | 贴底 | `gap=0` ✓ |
| 最大化 / 还原（真实重挂） | 仍贴底 | `gap=0` / `gap=0` ✓ |
| 布局本身 | compact 单窗口 / H 台各自正确 | `deskKids 1→4`、左竖/右竖/黑板按预期出现 ✓ |

`pnpm run check` 全绿；`pnpm build:client`（340,981B）+ `node --check` 通过。

**说明**：本次同时清理了过程中试错引入、最终未采用的哨兵元素与相关 CSS（`.ts-msgs-end`），
最终实现只保留上述 4 点。

## Step 49（2026-10-08）：项目注册表被清空的事故与加固（数据固化）

### 事故（本人造成，已恢复）
用户反馈「多个对话同时跑，不知道更新了什么，项目中心很多项目都删掉了」。
排查结论：**我在 Step 48 用浏览器做验证时，往注册表写了一条探针项目，把原有的 8 条覆盖成了 1 条**。
证据：
- 注册表内容只剩 `p-tokensave`，其 `description` = `"探针"`（我手填的测试字符串）；
- 该记录 `createdAt` 与 `updatedAt` 相差 86812619ms（≈1 天），恰好是我 seed 表达式的指纹
  （`createdAt: now - 86400000`，之后被 `touchProject` 刷新过 `updatedAt`）；
- 文件 mtime `16:16:57` 与我的验证时段完全重合。

### 根因（架构缺陷，不只是误操作）
`POST /plugins/dsh-tokensave/projects` 是**整表覆盖**语义：客户端每次增删都回推
「我这边看到的全部」，服务端原样替换。于是：
> 任何一个来源（另一个浏览器 / 另一个 origin / 被清过 localStorage 的 profile / 探测脚本）
> 只要它的缓存**残缺或陈旧**，一次同步就能把整张注册表冲成它那一份。
客户端 `doSyncProjects` 同样单向：`writeCache(remote)` 会用服务端的残缺内容覆盖本地更全的缓存，
把事故从一台机器放大到每一台。

### 加固（两层，均已实测）
**服务端**（`src/board-web-route.ts`）：
1. **并集合并** `mergeProjects(current, incoming, removed)`：服务端已有的项目一律保留，
   只有出现在 `removed` 名单里的 id 才会真的消失；同一路径以提交的版本为准。
2. **显式删除**：`POST /projects` 新增 `removed: string[]` 字段，真正的删除必须点名 id，
   并在响应里回显 `removed` 供审计。
3. **自动备份** `backupProjectsFile()`：每次内容**确实要变**时，先把旧内容存档到
   `~/.dsh/tokensave/projects-backups/projects-<ISO>.json`，保留最近 40 份。
**客户端**（`client/src/panel/store.ts` + `api.ts`）：
4. `publishProjects(projects, removed)` 带上删除名单；`removeProject` 传 `[id]`。
5. **并集水合**：`doSyncProjects` 不再直接 `writeCache(remote)`，而是按 id 并集；
   本地独有的项目保留并回推服务端，同时告警（“服务端偏少”）。

### 数据恢复
从两个权威来源反推（程序化，非手工推断）：
- `~/.dsh/storages/workspace.json` 的 `tables.workspaces` → 真实工作区路径与创建时间；
- 浏览器 `tokensave:opened-project.v1` 的 session→projectId 映射 + `~/.dsh/sessions/<cwd编码>/` 反推 projectId→路径。
恢复结果：**8 条**（tokensave / dsh / compare-text / info_report / ai / summer / preview-demo / Downloads），
projectId 沿用原值（session→项目映射不失效）。

### 验证（真实 3080 服务）
| 场景 | 期望 | 实测 |
|---|---|---|
| 恢复写入 | 8 条 | HTTP 200，磁盘 `count: 8` ✓ |
| **事故重演**：只带 1 条的残缺缓存 POST | 不能清库 | 返回 **9 条**（原 8 条全保留 + 新增 1）✓ |
| 显式删除 `removed:[id]` | 只删点名那条 | 9 → 8，`removed` 回显正确 ✓ |
| 自动备份 | 覆盖前存档 | `projects-backups/` 出现 3 份快照 ✓ |

`pnpm run check` 全绿；`pnpm build:client`（342,035B）+ `node --check` 通过。

### 教训
「整表覆盖」的写接口在多来源/多标签场景下等同于「谁最后同步谁说了算」，而“最后同步的”
往往是缓存最残缺的那个。写接口要么做并集，要么把删除显式化；两者都做，才能让
残缺数据无法造成破坏。另外：**验证写路由时不要向生产数据里写测试记录**——
这次本可以用只读 GET 验证。

## Step 50（2026-10-09）：黄灯不亮——「上一轮未正常结束」改成事件沿即时判定

**用户反馈**：对话里出现「输出被截断 ▾ 本轮达到输出长度上限被截断，回答可能不完整。」时，
侧边栏【项目中心/工作台】呼吸灯**没有变黄**。

**排查（数据 + 真机都过了一遍）**
1. **数据没问题**：写了个小工具逐帧解压 `~/.dsh/sessions/**/*.session.v4.jsonl.zstd`
   （多帧 zstd，`zlib.zstdDecompressSync` 只吃第一帧，要按帧头 `28 b5 2f fd` 切开逐帧解），
   扫出 `session-af27707a`（tokensave 项目）最后一条 `turn/end.reason.kind = "max-tokens"`
   （06:19:12）——`FAILED_TURN_KINDS` 里本来就有 `max-tokens`。
2. **判定也没问题**：`agent-browser connect 9333` 挂上无头 Chrome 打开 3080，
   用页面里的 `window.__DSH_CLIENT_CTX__` 复跑同一段 `sessions.using(...)`
   → 返回 `failed:true`（窗口 430 条、5 个 turn/end、最后一条 kind=max-tokens）。
3. **真凶是时序**：原先只有一条「10s 节流 + 4s 轮询」的兜底扫描 → 从停跑到亮黄最多
   **14~18 秒**；而这条对话 06:19:12 被截断、**06:19:28 就发了下一条**（仅隔 16s），
   黄灯要么还没出现、要么一闪而过。黄色分支此前从未用真实数据验过（Step 43 已注明），
   这是第一次走到真机。

**修法（`client/src/panel/pulse.ts`，两条路）**
1. **即时路（新增）**：`uiSession.sessionStatus` 观察到某会话 `running true → false`
   （宿主推的「这轮停了」）→ 记录停止时刻 → **0.9s 后立刻 retain 读结局**（不等节流）
   → 写结局缓存并**立即重算**呼吸灯（新增 `outcomeListeners`：缓存一变就 `read()`，
   不再等 4s 轮询）。读到「负结论但窗口还是旧的」（结局时间落后停止时刻 >5s）→ 2.6s 后
   重读，最多 2 次——防 `api-session/status` 比 `turn/end` 先到导致负结论被写死。
2. **口径与原语义对齐**：只对**已登记项目**下的非空会话下即时结论
   （`belongsToRegisteredProject`）——否则探索者/子代理一报错黄灯就常亮；
   `aborted` 仅在 `reason.reason.kind !== 'user'` 时算故障（用户主动按停止仍不亮黄）。
3. **每次观察到的停止都重判**（不做「已有结论就跳过」）：自动续轮不改 `updatedAt`，
   同一缓存键下可能已经跑过新的一轮，旧黄灯必须被新结局覆盖。
4. **兜底扫描加固**：单次读 8s 超时 + `scanning` 超 60s 强制复位（一次卡住的 retain
   不再把扫描永久顶死）；读不到结局记 miss、**连读 3 次**才按「无异常」结案
   （读不到 ≠ 正常结束）；负结论要「新鲜」（停止后 30s 宽限内不落旧结局的负缓存）。
5. **排查钩子**：`__tokensavePulse`（`check(id)` / `cache` / `refresh()`），
   浏览器 console 可手动判一次结局、看/清缓存、手算呼吸灯。

**浏览器目检（headless Chrome + agent-browser 连 3080，页面重载后执行）**
| 项 | 实测 |
|---|---|
| 黄灯渲染（手动判一条真实失败会话 cfd19e5a） | `.ts-pulse` 出现 `ts-pulse-warn`、title 出现 `⚠️ 上一轮未正常结束：…` ✓ |
| 清缓存后回落 | 删掉该条 + `refresh()` → `ts-pulse-warn` 消失 ✓ |
| 即时路真机触发 | 重载后缓存里出现 `af27707a` / `ea49abb4` 的结论（均来自真机停止沿）✓ |
| 页面错误 | `errors` 空、控制台无 `[tokensave] 扫描会话结局失败` ✓ |
| `tsc --noEmit` / `node --check` | 全绿 / 通过（bundle 360,962B）✓ |

**教训**
「检测型」的状态灯不能只靠定时轮询：轮询周期 + 节流的总延迟一旦接近用户的操作窗口，
灯就等于没亮。**状态变化的「沿」（running true→false）本身就是最好的触发器**——
轮询只留作兜底（页面加载前发生的事、订阅丢失）。

## Step 51（2026-10-09）：黄灯修完仍「不亮 / 一直亮」——正结论也要复核 + 黄灯角标定位

**用户反馈（两件事）**
1. 出现「输出被截断」时**仍然没有变黄**；
2. 而且现在**一直黄着**，却**找不到哪里有中断的任务**。

**根因（两个，都在结局缓存的生命周期上）**

1. **正结论（failed=true）写进去后就再也不被重读**：
   - 缓存键是会话的 `updatedAt`，而**自动续轮不改 updatedAt**（续轮没有新的用户消息）；
     于是普通候选被 `hit.at === s.updatedAt` 挡掉，黄灯永远熄不掉；
   - 另一半：停止瞬间事件窗口可能还没写进刚结束的 `turn/end`，读到的是**上一轮**的旧结局
     ——把旧的 max-tokens 当成本轮结论写死，就成了「一直黄着、可对话其实早就正常结束了」。
   - 实测数据佐证：`session-0061817a` 08:16 被 interrupted、08:41 又 completed；
     只认第一次结论的客户端会一直黄，复核后的客户端正确显示绿色。
2. **找不到任务**：悬停 tip 只有对话标题，没有项目名，也没有任何可点的入口。

**修复（`client/src/panel/pulse.ts` + `ControlRoomEntry.tsx` + `styles.ts`）**
1. **失败条目周期复核**：`OutcomeEntry.checkedAt`，距上次判定 ≥30s 的 failed 条目**无条件**
   进候选（绕过 1h 窗口与 `at` 相同的跳过），复核到 completed 就写回 false → 黄灯自己熄灭。
2. **正负结论都做「新鲜度」判定**：结局时间落后停止时刻 >5s（30s 宽限内）→ 窗口还没更新，
   **一律不落缓存**，稍后重读（即时路重读 2 次；兜底扫描 10s 后再来）。
3. **口径收紧**：不在任何已登记项目里的会话（归档 / 移除）→ 直接丢掉它的结论；
   连续 3 次读不到结局 → 按「无异常」结案（黄灯不能由“读不到”支撑）。
4. **tip 带项目名**：`⚠️ 上一轮未正常结束：【tokensave】<标题>`。
5. **黄灯角标 + 定位清单（新增）**：`warn>0` 时圆点旁挂黄色计数角标，点它弹出
   「需要处理的对话（N）」清单（⏳ 待确认 / ⚠ 上一轮未正常结束 + 标题 + 项目名），
   **点条目直达那条对话的工作台**（`enterProjectWorkbench(projectId, sessionId)`，
   与项目中心序号点同一入口）；Esc / 点外部 / warn 归零即收起。
   - 浮层 portal 到 body + `position:fixed`：横向=按钮右缘+8（rail 与展开态都向右飞出）、
     纵向=贴按钮下方，放不下改用 bottom 锚到按钮上方（贴住不留缝）→ 56px rail 与
     展开态同一套算法，不受侧边栏宽度 / overflow 影响；
   - rail 里角标固定 15px、圆点降为 2 个 → 36px 按钮内不横向溢出（实测 scrollWidth=36=clientWidth）；
   - 角标 `stopPropagation`，主按钮「项目中心↔工作台」切换语义不变。

**浏览器目检（无头 Chrome + agent-browser 连 3080，1280×800）**
| 项 | 实测 |
|---|---|
| 注入一条 failed 结论 → 角标 | `.ts-warn-badge` 出现「1」、pulse 变 `ts-pulse-warn` ✓ |
| 点角标 → 清单 | `需要处理的对话（1）`，条目 `⚠️ <标题> / tokensave · 上一轮未正常结束` ✓ |
| 展开态定位 | 浮层 left = 按钮 right+8；按钮贴底时改锚到按钮上方，bottom = 按钮 top−6（贴住）✓ |
| rail 态定位 | 按钮 36×36，浮层在其右侧、完全在视口内、与按钮贴合 ✓；角标 15px、圆点 2 个、不溢出 ✓ |
| 点条目 | 浮层关闭、发起导航、控制台无报错 ✓ |
| **复核自熄**（本轮回归重点） | 注入的假黄灯在下一轮扫描（≤10s，条目已过 30s 复核线）被复核成 false → 角标消失、回绿 ✓ |
| 停止沿端到端演练 | 伪造 running true→false → 控制台出现「会话停止 → 立即判定结局」→ 即时判定写入 failed → 角标亮 ✓ |
| 错误 | `errors` 空，无「扫描会话结局失败」；`tsc --noEmit` 全绿，bundle 370,635B ✓ |

**教训**
状态灯是**会被用户看见的真相**，它的缓存必须能自我修正：负结论不复核会“漏报”，
正结论不复核会“报死”。凡是“写进去就不再看”的结论，都会在数据后来变了之后变成谎言。
另外：光亮没用，还得**能点着找到那条对话**——告警的价值一半在显示，一半在可达。

## Step 52（2026-10-09）：已读标注闭环 —— 黄灯一键标注回绿 + 第 3 个圆点改成「正常结束」清单

**用户需求（两方面）**
1. 黄灯角标点开的浮层里，**每条加「已读」按钮 + 头部「全部已读」**；全部标注完跑马灯**回绿**，
   不必非得去对话框发消息才算处理完（不发消息就一直黄是不对的）。
2. **改造第 3 个圆点**：提醒哪些会话**正常结束**了、方便定位，同样带已读标注。

### 设计
**已读标注（`readMarks`，pulse.ts）**
- 键绑定「事件身份」而不是会话，保证“新一轮会重新提醒”：
  - 失败：`w:f:<sessionId>:<turnAt>`（出问题的那一轮 `turn/end` 时间）
  - 待确认：`w:p:<sessionId>:ep`，并用状态沿作废——**pending 每重新出现一次**（新会话期）
    就删掉该会话的旧标注，新弹窗一定重新亮黄
  - 完成：`d:<sessionId>:<turnAt>`（同一轮只提醒一次）
- 持久化：localStorage `tokensave:pulse-read.v1`（TTL 7 天、上限 400 条、超量按时间淘汰），
  同源多标签经 `storage` 事件互相同步；`markPulseRead(kind, key?)` 缺省 key = 全部标注。
- 标注后这些项**不计入 warn / done**：`warn=0` → tone 回 `ok`（绿跑马灯 / 或无任务时回落图标）。

**「正常结束」清单（`doneCache`，第 3 个圆点）**
- 录入来源：① 即时路（观察到的停止）判定为正常结束；② 兜底扫描在“停止 ≤1 分钟内”读到正常结束。
- 只收 `completed / forked` —— **用户主动停止（aborted-user）不算“完成”**，不产生提醒。
- 生命周期：同 `session+turnAt` 去重、最多 30 条；**该会话又开始跑 → 作废**它的完成通知
  （对话又活了）；会话被归档 / 移出项目 → 随 `seen` 一并清理。

### UI（ControlRoomEntry.tsx + styles.ts）
- `ItemPopover` 统一承载两份清单：头部标题 + **「全部已读」**胶囊按钮；每行 = 条目
  （图标 + 标题 + `项目 · 状态`，点击 = 直达那条对话的工作台 **并标为已读**）+ 右侧 **「已读」**
  小按钮（只标注不跳转）；footer 说明；Esc / 点外部 / 对应提醒清零即收起。
- **第 3 个圆点**改为 `.ts-pulse-done`：蓝色 `#38bdf8`、`role="button"`、`::after` 把点击热区撑到
  20px（视觉仍是 6px 圆点）；选择器特异性 `(0,3,0)` 压过 `.ts-pulse-run/.ts-pulse-warn (0,2,0)`，
  因此绿/黄、跑马灯与否都保持自己的颜色与节奏；未读完成为 0 时不渲染，第 3 点消隐。
- 呼吸点数规则：**只有真有活动（跑 / 待处理）才画呼吸点**，只剩完成通知时只画第 3 点；
  rail 有角标时总点数降到 2（36px 内不溢出）。

### 浏览器目检（无头 Chrome + agent-browser 连 3080，1280×800，**真实数据**）
| 项 | 实测 |
|---|---|
| 真实黄灯 | dsh 项目 4 条失败会话 → 角标「4」，清单 4 行（标题 + `dsh · 上一轮未正常结束` + 已读按钮）✓ |
| 单条已读 | 点行内「已读」→ 角标 4→3、清单剩 3 行；localStorage 写入 `w:f:…` ✓ |
| 全部已读 | 点头部「全部已读」→ 角标消失、`.ts-pulse-warn` 消失（**回绿**）、tip 里 ⚠ 清零、浮层自动收起 ✓（未发任何消息） |
| 第 3 点 | 注入完成通知 → 第 3 点 `rgb(56,189,248)`、`role=button`、title「最近正常结束的对话（1）」✓ |
| 完成清单 | 点第 3 点 → 「最近正常结束的对话（1）｜全部已读」+ ✅ 行 + 已读按钮 ✓ |
| 完成已读 | 点「已读」→ 第 3 点消隐、标注入 localStorage ✓ |
| 真实停止沿 | 伪造 `running true→false`（停止时刻对齐该轮 completed）→ 控制台「会话停止 → 立即判定结局」→ 结局 false + **done 自动记录**、第 3 点出现 ✓ |
| rail（36px） | 角标 1 + 1 呼吸点 + 第 3 点同排不挤出可见区域；点第 3 点浮层向右飞出、完全在视口内 ✓ |
| 错误 / 构建 | `errors` 空；`tsc --noEmit` 全绿；`dist/client.js` 381,413B ✓ |

### 教训
告警要**闭环**：提醒（亮灯）→ 定位（清单 + 跳转）→ 标注（已读 / 全部已读），
缺最后一环，灯就会变成“赶不走的噪声”，用户只能靠发消息把它冲掉。
标注的键必须绑到**事件身份**（那一轮的时间 / 那一次待确认会话期），绑到会话本身的话，
新一轮的提醒会被旧标注一起吞掉。

## Step 53（2026-10-09）：黄灯清单加「继续」—— 不跳转直接把消息发进那条对话

**用户需求**：黄角标浮层里加一个按钮，点它直接给对应对话输入「继续」并发送，
省掉“跳转到那条对话 → 找输入框 → 打字 → 回来”的一整套操作
（宿主 max-tokens 的官方提示本来就是“发送「继续」可让模型接着输出”）。

### 实现
1. **发送面（`sessions.ts` 新增 `sendToSession(sessionId, text)`）**
   走宿主 scoped conversation 面（与 `dsh-client-ui-conversation` 内部同一配方）：
   `sessions.scope(id).get('conversation').send(text)`。
   - 会话已有 scope → 直接发；否则先 `sessions.using(id, {source:'tokensave'}, …)`
     （retain 即 materialize scope）发完释放；
   - 任一环节缺失（sessions/scope/conversation 不可用、空文本、宿主业务失败）都**原样抛错**，
     由按钮侧展示并允许重试；不切 tab、不改当前会话（纯后台投递）。
2. **按钮（`ControlRoomEntry.tsx`）**
   - `PopItem.canContinue`：只给 `kind === 'failed'`（上一轮没正常结束）的行——
     ⏳ 待确认的行**不给**（该行是让你去点选择框，不是续写）；✅ 完成清单也不给。
   - 行内动作区变成 `[条目][继续][已读]`：`继续` 发送中显示 `…`、成功 `✓`（禁用）、
     失败 `重试`（title 带宿主错误信息）；`已读` 仍是只标注不跳转。
   - 发送成功后**该会话立刻变“进行中”** → 它自动从 warn 清单里消失（黄灯计数随之减，
     减到 0 就回绿），无需再点已读；若新一轮又失败（新 turnAt）则会以新条目重新亮黄。
3. **样式（`styles.ts`）**：`.ts-warn-cont` 琥珀描边小按钮，`is-sent` 绿、`is-error` 红；
   与 `已读` 并排时条目 `flex:1` + 标题省略号，长标题不会把按钮挤出浮层。

### 浏览器目检（无头 Chrome + agent-browser 连 3080，**真实发送**）
| 项 | 实测 |
|---|---|
| 行结构 | `[⚠️你好 / dsh · 上一轮未正常结束][继续][已读]`，footer 改为「「继续」= 不跳转直接发消息…」✓ |
| 点「继续」 | 按钮瞬间消失（会话变进行中）→ running 集合 6→7，新增的正是目标会话 ✓（未发生任何跳转） |
| **投递真值** | 目标会话 journal 出现 `turn/start` → `step/start` → `user/message [{"type":"text","text":"继续"}]` ✓ |
| 黄灯联动 | 角标消失、tip 里该条从 ⚠ 变成 `● 进行中` ✓ |
| 长标题挤压 | 注入两条超长标题 → 浮层 302px 内容不溢出（rowRight573 ≤ popRight578）、标题走省略号 ✓ |
| 错误 / 构建 | console 无 warn、`errors` 空；`tsc --noEmit` 全绿，`dist/client.js` 385,360B ✓ |

**说明**：本轮真机验证确实往 `dsh` 项目的「你好」那条对话里真发了一条「继续」（用于确认投递链路），
那条对话随后自行跑完；如不需要可在其会话里忽略该轮。

### 教训
“减少跳转”的功能要挑对**投递通道**：不能先切到那条会话再借宿主输入框（会打断用户当前上下文），
要走宿主自己的 scope 化发送面——它本来就是为“给指定会话发消息”准备的，路径最短、副作用最小。

### 变更（同日）：去掉浮层底部说明文字
用户要求：黄角标与蓝点弹出的浮层**删掉底部那行说明**（「「继续」= 不跳转直接发消息…」
/ 「点条目直达那条对话并标为已读；标完该点消隐 · Esc 关闭」），**悬停 tooltip 保留**。
实现：删 `ItemPopover` 里的 `.ts-warn-pop-foot` 节点 + 对应 CSS 规则；按钮 `title` 全部保留。
目检：两个浮层 `hasFoot=false`、正文中无 “Esc 关闭”，头部「…（N）｜全部已读」与三条
按钮 title（全部已读 / 打开…直达这条对话 / 不跳转：直接给这条对话发一条「继续」）原样在；
`tsc` 全绿，`dist/client.js` 384,747B。

## Step 54（2026-10-09）：蓝色「正常结束」指示改成计数角标（与黄角标同款）

**用户反馈**：蓝色的第 3 个圆点太不明显，希望像黄角标那样**用数字角标**呈现，有几条就显示几。

### 改法
1. **角标统一成 `.ts-side-badge` 两色变体**（原 `.ts-warn-badge` 重构）：
   - `.is-warn` 琥珀 `#f59e0b`＝需要处理的对话（计数 = warn）；
   - `.is-done` 天蓝 `#38bdf8`＝未读的正常结束（计数 = done.length）；
   两枚都 `role="button"`、同款呼吸动画与 hover/focus 反馈，各自点开对应清单
   （黄→需要处理的对话，蓝→最近正常结束），rail 里同为 15px 宽。
2. **第 3 个圆点回归纯粹的活跃指示**：`PulseDots` 只画呼吸/跑马灯点，
   `.ts-pulse-done`（蓝点 + ::after 热区）整块删除；3 个点不再被占用。
3. **rail（36px）排布规则：角标优先** —— 无角标 3 个点、1 枚角标 2 个点、2 枚角标 0 个点
   （15+3+15=33 ≤36，角标本身在呼吸仍有动效）；wide 不受影响（始终有活动就 3 个点）。

### 浏览器目检（无头 Chrome + agent-browser 连 3080）
| 项 | 实测 |
|---|---|
| 展开态并存 | 蓝角标「2」`rgb(56,189,248)` + 黄角标「1」`rgb(245,158,11)` + 3 个呼吸点，无溢出 ✓ |
| 点蓝角标 | 浮层「最近正常结束的对话（2）｜全部已读」、2 行、**0 个「继续」按钮**（完成清单不给继续）、无底部说明文字、位于按钮右侧且在视口内 ✓ |
| 蓝角标全部已读 | 蓝角标消隐、浮层自动收起、localStorage 写入 2 条 `d:` 标注；黄角标仍在（互不影响）✓ |
| rail 1 枚角标 | 2 个呼吸点，`scrollWidth=clientWidth=36` 不溢出 ✓ |
| rail 2 枚角标 | 0 个点，黄「1」+ 蓝「1」并排，仍 `36=36` 不溢出 ✓ |
| 旧样式清理 | 页面里已无 `.ts-pulse-done`；`errors` 空；`tsc` 全绿，`dist/client.js` 383,921B ✓ |

**踩坑记录**：测试注入完成通知时选了**已归档**会话，条目被 `seen` 清理规则在下一轮扫描里正确地
丢掉了（黄/蓝角标随即消失）——那不是 bug，是“归档的会话不该再提醒”；改用未归档会话后复测通过。
（判断口径：`readProjectSessions` = 项目 cwd + 非空 + 非子代理 + **非 archivedSessionIds**。）

## Step 55（2026-10-09）：清单行改极简 —— 去掉状态描述，只留对话 + 项目名

**用户反馈**：浮层里去掉「上一轮未正常结束 / 已正常结束」这类文字，极简风格；
突出**对话**（看不全时鼠标悬浮显示全文）和**项目名**，减少阅读负担。

### 改法
1. **第二行只剩项目名**：`sub` 从 `项目 · 状态` 改为 `项目`（空项目时整行不渲染）；
   状态语义全部交给**左侧图标**（⚠️ / ⏳ / ✅），不再重复成文字。
2. **项目名做成轻胶囊**：`.ts-warn-sub` = 10.5px + `border-radius:999px` + 1px 描边 +
   半透明底，`align-self:flex-start` 只占所需宽度；标题与胶囊间距 4px。
3. **悬浮看全文**：条目 `title` 改为三行 —— `完整对话标题 / 项目名 / 点击：打开这条对话
   的工作台（并标为已读）`；列表里标题仍是单行省略号。
   （浮层**外部**的角标悬浮提示 `pulse.tip` 原样保留 —— 用户明确要求“鼠标浮动弹出的不用去掉”。）

### 浏览器目检（无头 Chrome + agent-browser 连 3080）
| 项 | 实测 |
|---|---|
| 黄浮层无状态词 | `textContent` 不含「上一轮未正常结束」✓；第二行 = `dsh`（胶囊 radius 999px、border 1px）✓ |
| 蓝浮层无状态词 | `textContent` 不含「已正常结束 / 上一轮」✓；头部「最近正常结束的对话（2）｜全部已读」不变 ✓ |
| 长标题 | 列表显示「一个故意特别长的对话标题…」（省略号截断）；悬浮 title 第 1 行是**完整标题**，第 2 行项目、第 3 行操作提示 ✓ |
| 其它不变 | 行内 [条目][继续][已读] 结构、完成清单无「继续」、无底部说明文字；errors 空 |
| 构建 | `tsc` 全绿；`dist/client.js` 388,611B（含并行会话的 chat-view 改动），需刷新页面 |

### 教训
一行里同时给「标题 + 项目 + 状态」是三重信息，图标已经表达了状态，再写一遍纯属噪音；
**能用图形编码的就不要占文字**——省下的宽度正好让标题更长、悬浮再兜住溢出。

## Step 56（2026-10-09）：主对话「阅读视图」开关 —— 全部 / 我的 / 回复

**用户需求**：主对话窗口（msg0·user0·agent0 那格）加一个三档切换：
「默认」（我发的 + 你的回复，按对话顺序排、工具与上下文折叠）→「只看我发的」→「只看你发的」。
用户原话里第三档叫「默认-user」，并主动说“名称取的不好，你调整一下”。

### 取名
三档定为 **全部 / 我的 / 回复**（`all` / `user` / `agent`）：
- 两个词、平级、自解释，读一眼就知道是“看哪一侧”；
- 避开「默认」——它不是一种视角，而是“什么都没筛”，切到另两档后「默认」也就没意义了；
- 避开「user / agent」这种内部术语直译（用户看不懂“user 是谁”），也避开「默认-user」这种
  用减号表达“去掉什么”的命名（减号读不出“只剩”的语义）。

### 改法
1. **`chat-view.ts`（新文件）：模块级订阅小仓库**
   - `useChatView()` 返回 `[view, setView]`，写入 → 通知所有实例 → 落 localStorage
     （`tokensave:chat-view.v1`，同 store.ts / pulse.ts 口径，跨刷新、同源多标签共享）。
   - **为什么不放 MainChat 的 useState**：同一份消息流会同时存在两个 MainChat 实例
     （工作台中下格那张卡 + 「最大化/铺满」浮层里的那张）。各持一份 state 会出现
     「浮层里切了、退出浮层又变回去」。
2. **`MsgList` 新增 `view?: ChatView`（缺省 `all`，探索者窗口/简报行为不变）**：
   - 先对 `parsed` 过滤成 `visible`，**再**渲染：`.ts-turn + .ts-turn` 靠相邻兄弟选择器
     画分隔线，滤空的轮若留在 DOM 里会留一段空当 + 一条虚线；
   - 过滤口径：`user` → 只留我的气泡；`agent` → 只留过程折叠 + 回复 + 轮末异常提示；
     上下文注入（既不是“我”发的也不是模型说的）只在 `全部` 出现；
   - 「消息在、只是被口径滤空了」时给一句明说的空态，别让人以为会话没内容。
3. **`MainChat` 标题条**：`.ts-head-mid` 从「msg·user·agent 三个数」改成
   「**当前那一档**的数 + 三档开关」，两者同一 grid 格（grid 仍是 [标题][中][三键]）。
   - 统计跟着视图走：切到「我的」就报 `user 2`——固定报 `msg 137` 会让人以为切换没生效；
   - 开关是分段控件（共一个底槽、当前档亮起），比三个独立按钮更能读出“互斥三选一”；
   - `role="group"` + `aria-pressed` + 逐档 title（键盘可达、悬停有语义说明）。
4. **样式（`styles.ts`）**：`.ts-view-tabs` / `.ts-view-tab` / `.is-on`；中间段
   `overflow-x:auto` 让窄卡片下滑动而不是把三键挤出去。顺手删掉已无引用的
   `.ts-msgstat-sep` 与 `.ts-mainchat-sub`。

### 浏览器目检（无头 Chrome + agent-browser 连 3080，真实会话）
| 项 | 实测 |
|---|---|
| 三档过滤（`我有一个疑问…` 会话，msg22） | 全部 `msg22`（2 气泡/1 回复/1 过程/1 注入）；我的 `user2`（2 气泡，其余全 0）；回复 `reply1`（1 回复/1 过程，气泡与注入 0）✓ |
| 逐会话扫描（7 条真实会话） | 每档计数与 DOM 逐项对得上（`你好哦哦` 2 轮 msg6→user2→reply0 等）✓ |
| 切换与高亮 | 点击后 `aria-pressed` 与 `.is-on` 同步迁移，统计前缀随档变（`msg`/`user`/`reply`）✓ |
| 持久化 | 切到「回复」→ 刷新页面 → 仍是「回复」、`localStorage = "agent"` ✓ |
| 两实例一致性 | 最大化后浮层里的实例与卡片读同一份真值（模块级仓库，无分叉）✓ |
| 滤空提示 | 临时把过滤强制成“全滤掉”→ 全部「等待会话消息…」/我的「本会话里还没有你发的消息…」/回复「本会话里还没有模型的回复…」，验证后**已还原**✓ |
| 标题条布局 | 1280×800 下 title[34,120] / mid[297,452] 居中 / actions[637,715]，无溢出、三键不被挤 ✓ |
| 空会话 | 空白会话三档都走原空态文案，不误报“没有你发的消息”✓ |
| 错误 / 构建 | console 无本次改动相关 warn、`errors` 空；`tsc --noEmit` 全绿；`dist/client.js` 388,631B ✓ |

### 教训
同一份 UI 的“镜头”（看哪一侧）和“计数”（这一侧有多少）必须**绑在一起**：
只换内容不换计数，用户会以为切换失灵；只换计数不换内容，则是数字在骗人。
另外，组件**同时存在多个实例**时（卡片 + 最大化浮层），状态不能放在组件里——
模块级订阅仓库是这类“同一真相、多处渲染”的最低成本解。

## Step 56（2026-10-09）：跑马灯悬浮面板 —— 项目 + 标题、可点击跳转，去掉「进行中」

**用户反馈**：鼠标浮动在绿色跑马灯上弹出的提示里是 `进行中：对话1标题，进行中：对话2标题…`，
要求 ①改成**项目 + 对话标题**；②**点得动**——点击直达那条对话的工作台；③「进行中」三个字别再出现（都知道的）。

### 为什么必须换成自绘面板
原生 `title` tooltip **无法承载点击**（它不是 DOM 节点，没有事件），所以把它升级成自绘
`HoverPanel`（portal + fixed，与两枚角标清单同款定位）：信息一样、但现在每行可点。

### 实现
1. **`pulse.ts`**：新增 `PulseState.active`（正在跑的对话：sessionId / projectId / project / title）；
   tip 行改为 `【项目】标题` —— 跑着的行不再写「● 进行中：」，待确认行同步改成 `⏳ 待你确认：【项目】标题`。
2. **`ControlRoomEntry.tsx`**：
   - `PulseDots` 接 `onHoverIn/onHoverOut`；圆点悬停 → `openHover()`（定位算法与角标清单同款：
     贴按钮右缘 +8，放不下改锚上方），移开 **220ms 后**再收起（鼠标挪到面板上不闪断）；
   - `HoverPanel`：头部「对话清单（N）」+ 每行 `图标 + 标题 + 项目胶囊`，**只有跳转**（没有
     已读 / 继续——那里的对话本来就活着）；点条目 `enterProjectWorkbench` 后自动收起；
   - 清单 = 跑着的（●）+ 需处理的（⏳/⚠️）+ 已完成的（✅），与原 tip 同序（信息不减）；
   - **按钮原生 title 不再附带 tip**（只留导航提示），避免原生 tooltip 与面板叠罗汉；
     两枚角标自己的 title 保留。
3. 点击语义不变：点圆点/按钮其它区域仍是 项目中心↔工作台 切换（面板在按钮**右侧**，不会挡住）。

### 浏览器目检（无头 Chrome + agent-browser 连 3080，真实 7 条进行中会话）
| 项 | 实测 |
|---|---|
| 无「进行中」 | 按钮原生 title 与面板 textContent 均不含「进行中」✓ |
| 悬停打开 | 鼠标移到 `.ts-pulse`（宽栏 244,728 / rail 37,722 两态都测）→ 「对话清单（7）」✓ |
| 项目 + 标题 | 每行 `●` + 标题 + 项目胶囊（tokensave / info_report 混排正确）✓ |
| 点击跳转 | 点首行 → 面板收起、发起导航、控制台无报错 ✓（未标记已读，语义正确） |
| 移开收起 | 鼠标移开 → 220ms 后面板消失 ✓ |
| 定位 | 两种态都 `left ≥ 按钮右缘` 且完全在视口内 ✓；errors 空；`tsc` 全绿，`dist/client.js` 392,994B |

### 教训
原生 tooltip 是“只能看”的最便宜方案；一旦需求里出现**点击**，就别再往 title 上堆字段——
直接换成同款自绘浮层，信息结构与交互一次到位，也不用去和浏览器的 tooltip 延时、遮挡较劲。

## Step 57（2026-10-09）：跑马灯悬浮面板四项增强（灵敏 / 分色 / 去提示 / 自适应宽度）

**用户反馈（四连）**：①弹出要及时灵敏，鼠标在这片区域就该出现；②不同项目的胶囊给不同颜色；
③每条对话行上的悬浮提示去掉；④面板宽度按清单里最长的对话自适应。

### 实现
1. **灵敏度（热区从 6px 扩到整片右侧簇）**
   - 悬停触发点从 `.ts-pulse`（实测只有 **26×6px**，既难点中又迟钝）改为整个 `.ts-side-right`
     （角标 + 圆点，实测 **68×31px**）；再用 `padding:8px 7px + 对应负 margin` 把热区向四周扩一圈，
     视觉尺寸不变、可触达范围变大。
   - 事件用 `onMouseOver`（会随子元素间移动重复触发，从角标滑到圆点也能开）+ `onMouseLeave`
     关闭（220ms 缓冲，鼠标挪到面板上不闪断）；进入角标时不唤出（角标自带 title + 点击面板）。
   - 打开**零延迟**（enter 即开，实测 move 后立即可见）。
2. **项目胶囊分色**：`pillStyle(projectKey)` 按 `项目 id` 稳定散列出 0–359 色相 →
   同项目永远同色、不同项目不同色，分别给 `background / borderColor / color` 三通道
   （hsla 70% 饱和、18% 底），三份清单（黄/蓝/悬浮）共用。
3. **去掉行内悬浮提示**：悬浮面板每行不再有 `title`（它本身就是悬浮才出现的，再叠原生提示很吵）；
   角标清单（黄/蓝）的行内 title **保留** —— 那里的对话标题会被省略号截断，需要悬浮看全文。
4. **宽度自适应**：新增 `.ts-hover-pop { width:max-content; max-width:min(560px, 100vw-24px) }`
   —— 短清单 229px（原固定 300px），长标题顶到 560px 上限才出省略号；定位 clamp 用 `HOVER_POP_W=560`。

### 浏览器目检（无头 Chrome + agent-browser 连 3080）
| 项 | 实测 |
|---|---|
| ① 灵敏 | 热区 68×31（圆点仅 26×6）；鼠标进热区左上角（**不在圆点上**）→ 面板立即出现 ✓；移开 220ms 后收起、再进可重开 ✓；rail 同样一进即开且在视口内 ✓ |
| ② 分色 | tokensave `rgba(79,221,60,.18)` / info_report `rgba(146,60,221,.18)` / dsh `rgba(221,111,60,.18)` —— 三项目三色 ✓ |
| ③ 无行内提示 | 面板内 `rowsWithTitleAttr = 0` ✓（黄/蓝清单的 title 仍保留） |
| ④ 自适应宽 | 短清单 229px；注入超长标题 → 562px（560 + 2×1px 边框）、最长标题出省略号、仍在视口内 ✓ |
| 其它 | errors 空；`tsc` 全绿，`dist/client.js` 395,721B，需刷新页面 |

### 教训
“不灵”多半不是状态机的问题，而是**热区太小**：一个 6px 高的目标，用户以为是 bug。
把热区从“元素本身”扩大到“语义区域”，灵敏度问题往往一行 CSS 就解决了；
而一旦面板宽度改自适应，定位 clamp 也要跟着用新的宽度上限，否则窄窗口下会顶出视口。

## Step 58（2026-10-09）：项目卡片「已启动」升级为去调试超链接（预览 + 主对话两窗并存）

**用户需求**：项目中心卡片模式里那枚【已启动 / 未启动】小标，表示该项目的「项目预览」服务
是否已跑起来。现在要把它增强成**超链接**：已启动时鼠标悬浮其上显示为「去调试」，
点它跳到对应工作台，且工作台里要**同时**包含【项目预览 + DSH 主对话】两个窗口。

### 实现
1. **超链接（ProjectCenter.tsx + styles.ts）**
   - 已启动 → 渲染 `<a class="ts-dev-chip on ts-dev-chip-link">`，内里两段文字叠在同一个格子里：
     `● 已启动`（常态）与 `去调试 →`（悬停/键盘聚焦）。用 `position:absolute` 叠放而不是替换文本，
     **宽度取两者较大者**，悬停时不挤动旁边的「＋ 新会话 / 移除」按钮。
   - 未启动 → 仍是不可点的灰标（没跑起来就没什么可调试的），文案与提示不变。
   - 点它 `e.stopPropagation()`（否则卡片自己的「进工作台」也接一手，会按默认布局再进一次）
     并 `enter(p, undefined, 'debug')`；带 Enter/Space 键盘可达。
2. **意图传递（sessions.ts）**：`enterProjectWorkbench(projectId, targetSessionId?, intent?)`
   新增第三参 `WorkbenchIntent = 'debug'`，经 `requestWorkbench(sessionId, intent, projectId)` 广播。
3. **工作台呈现（HDesk.tsx）**：新增 `debug?: boolean` prop——为 true 时主对话卡**不**按
   「有预览就默认收起」的规则隐藏（初始 `hidden: !debug && cachedPreviewAvailable(...)`），
   并在预览探测/意图后到时把主对话放回来，于是预览条 + 分隔条 + 中下格主对话同时在场。

### 关键坑：意图为什么不能用「一次性、读完即清」
点「去调试」后 HDesk 的绑定 effect 会把会话换成**本项目自己的**会话，那一步会让 ControlRoom
整个重建。第一版用「一次性意图」（读走即清）→ **第一个实例把意图读走了，真正渲染出来的
那个实例什么也读不到**（实测：卡片点了、也进了工作台，但主对话没出来，仍是默认的只看预览）。
改成 `peekWorkbenchIntent(projectId)`：**不清除**，带 15s TTL + 按项目过滤，
清除点交给「下一次进入工作台」（`enterProjectWorkbench` 每次都调 `requestWorkbench`，
普通进入不带 intent → 当场清空）。这样既不丢，也不会把「去调试」粘到之后每次进入。

### 浏览器目检（无头 Chrome + agent-browser 连 3080，真实点击）
| 项 | 实测 |
|---|---|
| 超链接形态 | 已启动的两张卡（compare-text / info_report）`chip` 的 tagName = `A`；未启动的 dsh / tokensave 仍是 `SPAN` ✓ |
| 悬浮换字 | 移入前 state=1 / go=0；移入后 state=0 / go=1，`去调试 →` 变蓝（rgb(147,197,253)）、底色转蓝 ✓ |
| 不挤动按钮 | 悬浮前后 chip 尺寸恒为 64×25，后面按钮位置不变 ✓ |
| 点击进工作台 | 点 compare-text 的「去调试」→ 工作台 tab 激活、项目名 compare-text ✓ |
| 两窗并存 | `preview: true` + `chat: true`，且「已关闭」条只剩 共享黑板/协作对话/协作收益（主对话不再列在里面）✓ |
| 布局 | 预览条 [288,172,977,260] → 分隔条 → 主对话 [297,461,959,322]；输入条 fixed 停靠 [437,613,680,170]，body 带 `ts-hdesk-dock` ✓ |
| 普通进入不受影响 | 点卡片正文 → preview=true / chat=false（仍是默认只看预览）✓ |
| 不粘车 | 去调试 compare-text → 回中心普通点 info_report → chat=false；再点 info_report 去调试 → chat=true ✓（四例连测均正确）|
| 其它 | console errors 空；`tsc` 全绿，`dist/client.js` 473,719B，需刷新页面 |

### 教训
「一次性」是个陷阱：只要这条路上任何一步会**重建组件**，第一个读到它的实例就是被卸载的那个，
真正的消费者永远读不到。凡是跨导航传递的意图，要么用**不清除 + TTL + 作用域键**（本步的做法），
要么把清除点明确地钉在“下一次同类导航”上，不能指望“读到即消费”。

## Step 58（2026-10-09）：结局提示音（类 dsh-complete-notify）——完成/中断两套音、时长可调、面板可设、设置固化

**用户需求**：①不同状态不同提示音；②完成与中断**不同音效且可自定义**；③**持续时长可自定义**；
④设置入口放在**跑马灯悬浮面板「对话清单」上方**；⑤中断音效要我**从网络取**（用户没有）、
完成音效可选、时长＝一声响/一分钟/一直响/自定义（分钟数手输）；⑥**设置固化**。

### 素材（网络获取，公有领域）
从 Wikimedia Commons 下载两段 **Public domain** 录音，ffmpeg 截取约 2 秒（尾部淡出）、
单声道 44.1kHz、loudnorm 到 I=-16 LUFS、MP3 64kbps，再 base64 内嵌进 `sounds-data.ts`（免网络/免宿主路由）：
- 完成：`File:Doorbell-classic-dingdong.ogg`（PD，原 266KB→21.4KB）
- 中断：`File:Alarm or siren.ogg`（PD，原 279KB→18.2KB）
另有两段 Web Audio 合成音（清脆提示 / 双短音，零文件）与「静音」。出处注释写在 `sounds-data.ts`。

### 实现
1. **`sound.ts`（新）**：设置（enabled / doneId / failId / duration / customMinutes / volume）
   + 播放内核（录音走 `new Audio(dataUri)`，合成走 WebAudio 振荡器）+ 循环控制
   （`once`=0ms、`minute`=60s、`forever`=直到手动停、`custom`=N×60s；`stopSound()` 随时掐断）。
   - **播放代次 token**：新播放顶掉旧循环时，旧循环的 finally **不能**清掉新标签
     （否则刚一切歌/新告警就把「正在响」状态清空——实测踩到过）。
   - autoplay 约束：首次出声前需用户与页面交互过一次；被拦截时该声记 0ms 并**停止循环**（不空转）。
   - 排查钩子 `__tokensaveSound`（get/set/play/stop/playing）。
2. **`pulse.ts`**：新增 `onPulseAlert`（fail=中断/失败、done=正常完成）；在 `applyOutcome`
   （**只在“观察到的停止”那条即时路上**）emit；`alertedKeys` 按 `session:turnAt:kind` 去重
   ——同一轮绝不响第二次；**用户主动停止（aborted-user）不响**；历史结论（兜底扫描补出来的）不响。
3. **`SoundPanel.tsx`（新）**：提醒开关 + 音量、完成/中断各一排（下拉 + ▶ 试听）、
   时长下拉（自定义时出现分钟数输入）+ ■ 停止、一行提示；**改动即写 localStorage
   `tokensave:sound.v1`**（刷新/重开都在）；点外部或 Esc 关闭。
4. **`ControlRoomEntry.tsx`**：悬浮面板顶部加 `.ts-hover-tools` 工具行 ——
   「🔔 提示音」在「对话清单」**上方**；正在响时同排出现「■ 停止完成/中断」；
   挂载时 `initSoundBridge()` 一次 + 订阅 playing 状态。

### 浏览器目检（无头 Chrome + agent-browser 连 3080，真实音频数据）
| 项 | 实测 |
|---|---|
| 入口位置 | 悬浮面板第一行 = `🔔 提示音`，其下才是「对话清单（N）」✓ |
| 设置面板 | 提醒[开|关]+音量滑条；完成/中断各[5 项下拉+▶]；时长[一声响/一分钟/一直响/自定义]+■；自定义时出现分钟数输入 ✓（252px、在视口内） |
| 两套音效确实不同 | Audio 探针：完成=dingdong（len 28,503 / hash 364,945,806），中断=alarm（len 24,323 / hash 45,285,0063）✓ |
| 播放/停止 | 可信点击 ▶ → `playing='完成'`、循环计数增长；点「■ 停止完成」→ 立刻 `playing=''` ✓ |
| 告警桥 | `check(失败会话)` → 响**中断音**；伪造停止沿 + `completed` → 响**完成音**；同一轮第二次触发被去重不响 ✓ |
| aborted-user | 伪造「用户主动停止」→ **不响** ✓ |
| 时长 | `once`=播完即停；`forever`=循环到手动停（停后 units 不再增长）✓ |
| 固化 | 改 成=chime/时长=自定义3分钟 → localStorage 立即写入；**刷新后** `get()` 与面板显示都还原 ✓ |
| 错误 / 构建 | `errors` 空；`tsc` 全绿；`dist/client.js` ≈474KB（含两段 base64 音频，约 +52KB） |

**踩坑记录**：①无头测试里 `el.click()`（JS 合成点击）**不算** autoplay 手势，必须用 CDP 真点击解锁，
否则 `play()` 被拒 → 我们的循环会把这一声当 0ms 并停止（这是刻意设计，防止后台空转刷屏）；
②HMR 会在重打包时重载页面，测试用的 `window.__played` 等全局会被清掉，取样前后要打标记确认没被重载；
③期间并行会话把 HDesk.tsx 改到语法不完整，esbuild 构建失败约 1 分钟，等他们改完才出包（tsc 也一度只报他们的错）。

### 教训
「提示音」这种**不可见**的功能，验证必须换成可观测的量：用 Audio 探针记录 (长度, 哈希) 区分音源、
用 `playing` 标签观察生命周期、用 localStorage 断言固化——否则“响没响、响的哪个、停没停”全靠耳朵，
自动化里根本没法验。另外**切歌竞态**（旧播放的 finally 清掉新播放的标签）是异步状态机的经典坑，
代次 token 一劳永逸。


## Step 59（2026-10-09）：工作台「项目布局锁」——从别处回到本项目保持同一份布局

**用户需求**：从别处（项目中心 / 侧边栏 / 同项目的另一条对话）跳回工作台时，窗口布局总是
回到默认状态，每次都要重新摆一遍。要求：

1. 标题行项目名后面一个按钮在【锁定布局 / 解锁布局】之间切换；
2. 锁定与非锁定的**项目名胶囊用不同颜色**标注；
3. 锁定后从任何入口回到本项目，布局都一样（**同项目的不同对话共享同一份**）；
4. 锁定**不限制**台内操作：一键切换、【＋共享黑板 / ＋协作对话】等照常可用；
5. **默认锁定**，只有用户解锁之后才回归默认；
6. 状态**跟项目绑定并固化**，直至用户自行更改，再以用户定义的布局固化。

### 实现
1. **持久层（新增 `client/src/panel/desk-layout.ts` + `desk-types.ts`）**
   - 每项目一条 `{ locked, layout: { cards, winState, previewH }, updatedAt }`，键是**项目 id**
     （不是会话 id）——所以同项目的不同对话天然共享一份布局。
   - 所有读入数据都逐字段归一化（`sanitizeCard` / `sanitizeLayout`）：手工改坏的
     localStorage 不能让工作台崩。
   - `loadDeskPref` 未存过返回 `null`（调用方回落「默认布局 + 默认锁定」）；
     `setDeskLocked` **只翻开关、保留快照**——再锁回来时能恢复用户上次摆好的布局。
   - `store.removeProject` 顺手 `forgetDeskPref`，不留孤儿条目。
2. **恢复（HDesk.tsx）**：`cards` / `winState` / `previewH` 的 useState 惰性初始化直接
   从快照落座——**首帧就是对的**，不会先闪一下默认布局再跳变。
   快照里缺的卡片用默认值补齐，所以旧快照能安全升级。
3. **固化（HDesk.tsx）**：一个以 `cards / winState / previewH` 为依赖的 effect 把当前布局
   写回项目。放在一处而不是每个改动的 handler 里，是因为那些 handler 同时改 `cards` 与
   `winState`，各自落库会用「另一半还是旧值」的快照互相覆盖。
4. **按钮与配色**：项目名胶囊按锁定态分色（锁定=青绿 `ts-proj-locked`，未锁定=琥珀
   `ts-proj-unlocked`）；紧贴其后的锁按钮与胶囊同色系（`ts-lock-btn.ts-lock-on/off`）。

### 关键坑
- **「默认规则」会把刚恢复的布局当场改掉**：HDesk 原本有两条自动规则——有预览就收起主对话、
  探索者一出现就放出黑板/协作对话/协作收益。恢复快照时必须同时把 `chatChoiceRef` 与
  `autoRevealed` 置位把这两条压住，否则「锁定」瞬间就失效。
- **固化写盘必须节流**：拖预览分隔条时 `previewH` 每帧都在变（rAF 合帧），直接写就是每帧
  一次 localStorage 同步写。改成 300ms 节流 + 尾包（`latestLayout` 存最新值），并在卸载时
  flush 一次——「拖完就切走」是最常见的路径，不能让它吞掉最后一次改动。
- **`debug`（「去调试」）不落库**：那是一次临时的进入意图（要预览 + 主对话两窗并存，
  Step 58），若当成用户布局固化下来，点一次「去调试」就会静默改写他锁定的布局。
- **换项目必须重挂 HDesk**（`ControlRoom` 加 `key={opened.id}`）：布局锁状态是在首次渲染的
  惰性初始化里定下的，复用同一实例会把 A 项目的布局回写进 B 项目。

### 验证
无头 Chrome 在本环境的沙箱里建 target 后停在 `about:blank`（`Page.navigate` / 建带 URL 的
target 都不可靠），因此本轮**没有做浏览器目检**，改为对持久层跑真实验证脚本：用真实源码 +
localStorage 桩，覆盖默认态 / 写读回环 / 解锁保留快照 / 按项目隔离 / 脏数据归一化 / 移除清理
共 17 项断言，全绿；`tsc --noEmit` 全绿；`dist/client.js` 已重建（478,098B，需刷新页面）。

### 未验的部分（需一次目检）
浏览器里的三件事仍应人工确认：①锁定/解锁时胶囊与按钮的配色切换；②改完布局切走再回来是否
原样恢复（含同项目另开一条对话）；③「去调试」进入时锁定布局不被改写。

## Step 59（2026-10-09）：提示音设置内嵌 + 控件统一 + 声画同步

**用户反馈（三连 + 补一条）**：①设置要**直接出现在跑马灯浮动面板上**（与对话清单同面板同现，
而不是点「🔔 提示音」再弹一层）；②音乐相关**字号偏大、有挤压感**，自定义时长那行尤其；
③**声音比数字角标先出现**，要求同步；④自定义时长的输入框与其他选择框**不协调**，要统一。

### 实现
1. **设置内嵌**：删掉「🔔 提示音」按钮、独立的 `SoundPanel.tsx`（整文件删除）与 `.ts-sound-pop/.ts-hover-tools`
   样式；四行设置（提醒+音量 / 完成 / 中断 / 时长）直接排在悬浮面板顶部，其下才是「对话清单」。
   面板宽度 = `max(设置区 272px, 清单 max-content)`，`max-width` 动态按剩余空间给。
2. **控件统一（含自定义输入框）**：同一行内所有控件**同高 22px、同字号 10.5px、同圆角 6px、
   同描边 `rgba(127,127,127,.35)`、同底色 `.1`**；数字输入框额外做三件事：
   `text-align:center`、`appearance:textfield`、隐藏 `::-webkit-inner/outer-spin-button`
   —— 原生上下箭头正是它「跟下拉框不像」的元凶。实测两控件计算样式完全一致（h22/10.5px/6px/同色）。
3. **声画同步（两处一起改）**：
   - `pulse.ts` 的 `applyOutcome` 里把 **`notifyOutcome()` 提到 `emitAlert()` 之前**（先前顺序相反）；
   - `sound.ts` 的告警桥把起音放进**双 rAF**（≈16-32ms），保证角标那一帧先绘制。
   - 实测（MutationObserver 测角标插入 + Audio 探针测起音）：`badge+done@43724` → `audio@43743`，
     **角标先、声音后 19ms**（原来相反）。
4. 顺带修掉一个真机 bug：浮层定位此前按固定宽（300/560）夹紧 `left`，**窄窗口下面板会被推回
   侧边栏底下、左半边被盖住**（截图实锤）。现改为：`left = 侧边栏容器右缘 + 8`（新增
   `sidebarRightOf()`：在「不宽于视口一半」的祖先里取最大右缘，跳过按钮自身内边距），
   宽度上限按 `innerWidth - left - 12` 动态给 —— 宁可让内容省略号，也不藏到侧边栏后面。

### 浏览器目检（无头 Chrome + agent-browser；窄 756×356 与宽 1280×800 都测）
| 项 | 实测 |
|---|---|
| 内嵌结构 | 面板第一块即 `ts-sound-body`（提醒/完成/中断/时长四行），其下才是「对话清单（N）」；无 🔔 按钮、无 `.ts-hover-tools`、无底部说明文字 ✓ |
| 控件一致 | 下拉框与数字输入框：`h=22 / font=10.5px / radius=6px / border=1px rgba(127,127,127,.35) / bg=rgba(127,127,127,.1)` 完全一致；输入框 `text-align:center`、`appearance:textfield`、无原生箭头 ✓ |
| 不挤压 | 自定义模式下整行 `rowRight ≤ popRight`（面板 272px 内放得下 select+输入框+「分钟」+■）✓ |
| 声画同步 | `badge+done@43724` → `audio@43743`：**角标先、声音后 19ms** ✓ |
| 真实鼠标可用 | 鼠标从圆点移入面板**不闪断**；原生点击「▶ 试听」→ `playing='完成'`、循环开始 ✓ |
| 播放/停止 | 时长行 ■ 在播放时高亮（`is-playing`），点它立即 `playing=''` ✓ |
| 定位修复 | 窄视口下 `popLeft(329) > sidebarRight(321)`、完全在视口内 ✓（修前是 184，左半边藏在侧边栏后） |
| 构建 | `errors` 空；`tsc` 全绿；`dist/client.js` 479,780B |

### 教训
- **内联 ≠ 挤压**：把设置塞进同面板后，真正要统一的是「行内控件的度量」（高度/字号/圆角/描边），
  而不是逐个调 padding；数字输入框的原生 spinner 是最容易被忽略的“不一致来源”。
- **“先听到后看到”是顺序问题**：状态更新与副作用在同一条同步路径上时，顺序（谁先）远比耗时更重要；
  必要时用双 rAF 把「画一帧」明确排在「出声」之前。
- 定位 clamp 不能只按「面板自身宽度上限」算，还要考虑**锚点所在容器的边界**，否则窄窗口会把浮层
  藏到侧边栏后面 —— 这类问题用截图一眼可见，DOM 断言不一定抓得到。

## Step 60（2026-10-09）：H 台底部三项改造 —— 禁宽度把手 / 固定 1.5:7:1.5 / 区块缺失补位 + 中列可拖分高

**任务来源**：用户三条要求（参考项目 `info_report` 的 web 控制台页面：那里的 `.desk` 就是
3:4:3 + 整列全关时移出网格、份额并给邻列的同一套语义）。

1. **禁用宿主宽度把手**：鼠标在对话两侧变左右双向箭头、拖动即改「聊天内容宽度」的那个功能，
   在工作台里必须失效。
2. **固定左中右比例 1.5 : 7 : 1.5**（原来是 `minmax(190px,250px) / 1fr / 同左`，实际约 19:60:19）。
3. **区块缺失补位**：左右任一侧全关 → 中间扩展过去；中间全关 → 左边扩展；中列上下（共享黑板 /
   DSH 主对话）也互相补位；并给中列加一条可拖的上下分隔条（可调窗口高度）。

### 实现

**① 宽度把手（HDesk + 既有 CSS）**
- `body.ts-hdesk-open [data-width-handle]{display:none}` 这条闸门**从 Step 14 起就只有 CSS、
  从未有类名**（历史遗留：JS 侧一直没挂 `ts-hdesk-open`），所以把手在工作台里一直是活的。
  本次在 HDesk 里补上 `useLayoutEffect` 挂/摘该 body 类，并把样式里那条「随内容长高」的
  视图链规则一并激活（实测链路几何完全不变：`.ts-desk` 仍是 288,128,1297,764）。
- 生效范围只限工作台：切到「对话」tab 时 HDesk 卸载、类名摘除，把手原样回来（已实测）。

**② 列轨道（HDesk 的 `DESK_COLUMNS` + styles.ts 的 `.ts-desk`）**
- `.ts-desk` 不再用固定像素列宽，改为按「哪几列还有可见窗口」注入 `gridTemplateColumns`：
  `left,mid,right → 1.5:7:1.5`；`mid,right → 8.5:1.5`；`left,mid → 1.5:8.5`；
  `left,right → 8.5:1.5`（中列空了由**左列**吸收，用户明确要求）；只剩一列 → `1fr` 铺满。
- “某列在不在”的口径：**这一列里当前有没有可见窗口**（`hidden` 或被铺满浮层占走都不算）。
- 三列共存于一棵稳定树（列容器永远渲染，空的挂 `.ts-desk-empty{display:none}`）——
  保住原有不变量：列内组件实例、消息流滚动位置不因布局切换而重建（旧 `compact ⇄ H 台`
  两分支写法已被这一套吸收，`compact`/`rows` 两个派生量删除）。
- 行轨道不再是「全台共享 R 行」：左右两竖本来就是单列 flex，行只服务于中列对齐；
  中列改自由分高后，原来的「黑板底缝与左右列缝对齐」自然取消（用户要的就是可调高度）。

**③ 中列补位 + 可拖分高（HDesk 的 `onMidSplitDown`）**
- 中列 = 上格（共享黑板）+ `.ts-hsplit` + 下格（DSH 主对话），两格共用列高、靠 `flex-grow`
  按比例分（`flex-basis:0`）：所以「任一方被关掉/收起 → 另一方铺满整列」与「拖分隔条换高」
  是同一套机制（`.ts-desk-cell-collapsed` 负责收起时只占标题条）。
- 比例存进布局快照（`DeskLayout.midSplit`，0.12–0.88 钳位，0 = 没存过 → 对半分），
  锁定态下切走再回来仍是同一条分界线。
- 拖动性能：台面很重（黑板/主对话/探索者/iframe），拖动期间**一次 setState 都不做**——
  按帧把两个格子的 `flex-grow` 直接写 DOM，松手才提交比例值；结束沿用预览分隔条那套
  三重保险（setPointerCapture + 捕获阶段 pointerup + `buttons===0` 兜底）。

### 关键坑
- **flex-grow 之和 < 1 会被“按比例缩水”**：两格用 `0.5 / 0.5` 时，单格独存（另一格被关掉）
  只拿到中列的一半高度（实测 764px 的列只剩 391px，即 flex 规范的 “sum < 1” 规则）。
  改成 `× MID_GROW_SCALE(1000)` 后比例分配与「只剩一格就铺满」都正确。
- **`.ts-desk-empty` 被后写的 `.ts-desk-mid{display:flex}` 盖掉**（同权重比先后）：
  结果中列没移出网格，三个格子被自动排到第二行（左列与右列重叠在同一格）。
  改成 `.ts-desk-col, .ts-desk-mid` 一条规则、`.ts-desk-empty` 写在它之后。
- **改动落点容易错**（这次编辑时误把 `if (!layoutLocked || debug)` 与
  `const showSplitter = …` 当成相邻行删改，靠 tsc 当场发现并回修）——
  批量编辑后必跑 `tsc --noEmit`，不要只看 diff 行号。
- **握柄方向是语义的一部分**（用户反馈）：这条分隔条调的是上下高度、光标也是 `ns-resize`，
  握柄却写成竖向 2×36 —— 一眼看上去像「左右拖」。改为**水平 72×2**（与 `.ts-vsplit-grip`
  同度量），并确认它落在两格之间的缝正中：实测黑板底 422 / 缝中 430 / 主对话顶 438，
  握柄（72×2）中心 429.5，命中区盒 [425,435] 完全落在 16px 缝内、不压到任一张卡。

### 验证（无头 Chrome + agent-browser，1600×900 / 1200×800）
| 项 | 实测 |
|---|---|
| 宽度把手 | 工作台内 `[data-width-handle]` 为 `display:none`（两支）；切到「对话」tab 后恢复 `block/10px` ✓ |
| 固定比例 | `.ts-desk` 1297px 宽 → `192.14 / 896.70 / 192.16`（= 1.5:7:1.5）；897px 宽 → `132 / 617 / 132` ✓ |
| 左列全关 | 中 1095.64 : 右 193.34 = 8.5:1.5 ✓ |
| 右列全关 | 左 193.34 : 中 1095.64 = 1.5:8.5 ✓ |
| 中列全关 | 左 1095.64 : 右 193.34 = 8.5:1.5（左列吸收）✓；中列 `display:none` 不再占格位 |
| 中列上下补位 | 只开黑板 → 黑板 764px 铺满；只开主对话 → 主对话 764px 铺满；两格都关 → 中列移出网格 ✓ |
| 中列拖高 | 鼠标从 y=501 拖到 y=300：board 365→160、chat 383→588，`body.ts-hsplit-dragging` 挂/摘正常；松手落库 `midSplit=0.2192513…`，刷新后仍是 160/588 ✓ |
| 收起补位 | 最小化黑板 → 上格 40px（只标题条）、主对话 708px；分隔条自动撤掉 ✓ |
| 构建 | `tsc --noEmit` 全绿；`dist/client.js` 487,255B |

### 待人工目检
1. 有探索者窗口时左右两竖的补位（本次 tokensave 工作区探索者数为 0，未跑到该分支；
   奇偶分发逻辑与窗口渲染未改，风险在“整列判定”与窗口同列共存）。
2. 有「项目预览」的项目：预览条 + 新列轨道共存（预览条本身逻辑未改）。

## Step 61（2026-10-09）：宿主输入条「自动加高 + 上沿抓手手动拉高」

**用户需求（两条）**：① 输入文本多时看不全，希望未发送前输入框**自动加高**到能一眼看全；
② 也能**手动拖到一个高度**，松手后固定在这个高度。

### 实现
新增 `client/src/composer-resize.ts`（约 420 行），在 `client/src/index.ts` 的 `apply` 最开始调用
`installComposerResize()` —— 与 slots/uiWorkspace 无关，因此任何视图（含宿主默认纯对话窗口、
工作台 H 台、其它插件视图）都生效。

宿主输入区结构（dsh-client-ui-conversation 的 DraftEditor）：
```
[data-input-scroll]        ← 滚动口，max-height: var(--dsh-composer-text-max-height)，默认 336px
  └ .grow
      └ [data-composer-input]   ← contenteditable / Lexical 宿主
```
本模块只做三件事，全部围绕宿主的那个 CSS 变量：
1. **自动加高**：量「滚动口内边距 + 内容盒 scrollHeight」→ 把 `--dsh-composer-text-max-height`
   写成 `max(视口-160, 160)`（余量留给头部/工具栏）。内容装得下就没有内部滚动条（一眼看全），
   超过上限才回到滚动。
2. **手动拉高**：滚动口上沿一条 16px 抓手（`position:fixed` 挂在 body，**不进宿主 React 树**，
   因此不会被 React 重排打断）。按住拖动改的是**固定盒**：`max-height`（CSS 变量）与
   `min-height` 成对写 —— 只写 max 的话，内容比目标矮的盒子根本不会变高，空输入框往上拖
   毫无反应。松手写入 localStorage（`tokensave:composer-height.v1`，每 origin 一份：
   桌面 127.0.0.1 与手机网关各记各的）。
3. **交还自动**：抓手右侧「重置」按钮或双击抓手，把固定盒交还给自动加高（同时移除 min-height）。
   手动高度一旦拖出来就**固定住**（内容变少也不自动收回）——「松手后固定为这个高度」
   是用户的明确意图，不替他改；要回自动就点重置。

### 返工二（用户反馈「没有实现哦」—— 只写 max-height，短内容拖不动）
首版把手动高度只写进了 `--dsh-composer-text-max-height`（max）。`box = min(content, cap)`，
所以**内容比目标矮时，往上拖 cap 再大 box 也不动**：空/短输入框拖高全程零视觉反馈，
看起来就是「功能没做」。改成 `applyLimits()` 成对写 `min-height` + `max-height`（固定盒），
拖动中 box 即时 = 目标值（WYSIWYG），松手保持；内容变少也不缩（符合「固定」），
内容超出固定高度则在盒内滚动（固定是用户自己的选择，悬停出「重置」可退回自动）。
同时把自动上限从「视口×70%」放宽为「视口-160」，长文本更少触发内部滚动。

### 关键坑（真机测出来的）
- **抓手不能跟盒子一起动**：拖动时滚动口高度在变，抓手又钉在它上沿 —— 指针位移会被
  盒子自己的位移吃掉（实测拖 120px 只涨 0px，像是"拖不动"）。修法：按下时**冻结**抓手视口矩形，
  拖动期间 `positionHandle()` 走 `drag` 分支不再读实时 rect。
- **抓手命中区与文字重叠**：滚动口没有任何内边距，而内部 `[data-composer-input]` 有 4px 上内边距。
  抓手（16px）下沿压在滚动口上沿 → 露出的正是那 4px，不遮第一行字。
- **停靠态**：工作台把输入条 `position:fixed; bottom:…` 停靠，从下沿向上生长，
  自动加高/拖高都自然向上展开，不需要额外分支（只用于判断是否抬抓手，最终统一按 rect 摆位）。
- **`Input.insertText` 只成功一次**：CDP 里连续 `Input.insertText` 只有第一次进 Lexical，
  拖拽/排版验证因此一度被误判。改用「每次输入前重新点一次真鼠标」或直接看 DOM。

### 视觉返工（用户反馈「浅蓝粗线突兀、圆角处出线露头」）
首轮实现的抓手线是 3px、且 `data-ts-manual=1` 时整条变浅蓝，位置又恰好压在卡片顶边
（滚动口无内边距，线画在 `scrollTop-8` = 卡片顶边）—— 圆角处必然超出卡片轮廓。改法：
1. **圆角内缩**：按滚动口父卡片的 `borderTopLeftRadius`（实测 28px）写 `--ts-grab-inset = radius+2`
   （钳到 `[10, 宽/3]`），线与「重置」胶囊两端都吃这个变量 —— 实测 grip 左内缩 30px、右内缩 34px（含滚动口右 4px 边距）。
2. **线落在顶边内侧**：抓手浮层从 `scrollTop-12` 改为 `scrollTop-8`，2px 的线画在 `cardTop+4`
   —— dy=4 处圆角边界仅在离边 5.4px 内，30px 内缩下完全不出线（截图复核过左上角）。
3. **降噪**：2px、默认中性灰 `rgba(127,127,127,.16)`（内容已装下时 `.10`），悬停 `.42`；
   固定过的状态不改色，由悬停浮出的「重置」表达。
4. **全程无蓝**（用户追加要求「不要出现蓝色那条线」）：拖动中的瞬时反馈也改为**压深的灰**
   `rgba(127,127,127,.6)`（保持 2px 不变粗），px 数字胶囊与「重置」描边同步去蓝。
   该组件内已无任何蓝色值；`dist/client.js` 里剩余的 `96,165,250` 全部来自
   `panel/styles.ts`（工作台开关等既有配色），与抓手无关。

### 返工四（用户反馈三连：拖动残影 / 页面一直“刷新”抖动 / 切 tab 丢滚动位）

**1. 拖动残影**：拖动中 `positionHandle()` 曾把抓手冻结在按下时的视口矩形，盒子顶边
   实时上移 → 2px 横线连同胶囊滞留原地。而高度数学是 origin 基准（`originH +
   (originY-clientY)`，从不读抓手位置），冻结对跟手毫无贡献 —— 直接去掉 drag 分支，
   抓手按实时 rect 跟随盒顶；`DragState` 删掉 left/width/top；`sync()` 加
   `if (drag) return`（拖动中禁止重绑丢 pointer capture）。

**2. 抖动/“刷新”**：先排查了外部因素（无 `dev:web`/vite 进程、DSH 日志无 HMR 刷屏），
   再锁定自身四处空转：① `setInterval(sync,1000)` 每秒轮询；② `apply()/positionHandle()/reflect()`
   **无条件写** DOM，且 scroll 事件直写未 rAF 合并；③ attach 重绑时抓手整颗摘除重插（闪动）；
   ④ 拖动中每次 pointermove 同步写 localStorage（掉帧）。全部修掉：差量写助手
   `setStyle/setDs`（值不变不碰 DOM）+ scroll 布局 rAF 合并 + 删轮询 + 抓手常驻
   （`hideHandle` 只切 display，卸载插件才 `removeHandle`）+ 拖动中只改内存、松手一次落盘。
   诊断计数挂 `window.__TS_COMPOSER_STATS`（apply/styleWrites/attach/sync/detach）。

**3. 切 tab 丢滚动位**：新增 `client/src/scroll-memory.ts`（与 composer 同在 `apply()` 安装）：
   - **记账**：scroll(capture) 按 `{会话id, scrollTop, 贴底≤48px}` 实时记；容器首次挂载补基线
     （覆盖“从未滚动就贴底”的场景）。
   - **离开保护**：点 tab（白名单：对话/轨迹/看板/项目中心/工作台）离开「对话」或 conv-scroll
     被卸载 → `frozen`，期间回填的滚动事件不许覆盖账本。
   - **回来恢复**：conv-scroll 重挂（或点回「对话」）→ rAF 等内容稳定（3 帧不变；空态最多
     等 2s）→ 贴底则 pin 到底并**贴底跟随**（800ms 慢轮询 + 150ms 自我标记，用户上滚一次退出），
     否则 clamp 回原 scrollTop。
   - **恢复键**：两侧都是真实会话 id 且不同才丢弃（切会话不串位置）；空键领养 ——
     基线常记在 Probe 上报会话 id 之前，首版严格比对会把恢复全打回（实测 discarded:2）。
     诊断挂 `window.__TS_SCROLL_MEMORY`。

**验证（无头 Chrome + 裸 CDP，最终构建 507,979B）**

| 项 | 实测 |
|---|---|
| 静置防抖 | 10s/15s 两轮静置：styleWrites **14→14 / 12→12（零写入）**；navs=1（全程零 reload）✓ |
| 无残影 | 拖动逐帧采样 `scrollTop - grabberTop`：pressed/-60/-150/松手 **恒为 8px**（贴实时盒顶）✓ |
| 无蓝 | 拖动中 grip `rgba(127,127,127,.6)`、松手 `.42`（全程灰）✓ |
| 固定/重置 | 拖后 stored=186 + min-height=186；重置 → stored null + min-height 移除、cap 回 540 自动 ✓ |
| 中位恢复 | 滚到 966 → 切「轨迹」→ 切回「对话」：**966→966**（restored 累计、discarded 0）✓ |
| 贴底恢复 | 滚到 1931(max) → 切「看板」→ 切回：**st=1931=max（回到最新）** ✓ |
| 贴底跟随 | 恢复到底后插入 400px 块：2.5s 内 st 回到新 max（pin 计数有记录；宿主同场景也会拉回，双保险）✓ |
| 重绑次数 | 全程 attach≤2、sync≤3（无重绑风暴）✓ |
| tsc/build | `tsc --noEmit` 全绿；`dist/client.js` 507,979B ✓ |

**教训**：CDP 里的「页面卡死」可能是假的 —— `pkill -f "Google Chrome for Testing"` 会把
浏览器的子渲染进程一起杀掉，`/json/list` 仍留着指向死渲染器的条目，evaluate 永远无响应，
看起来像“页面主线程死循环”。先用 `about:blank`/`data:` 控制页做对照实验，再判页面本身。

### 返工五（用户反馈：拖动仍闪屏留横线残影 / 要求彻底去掉横线）

**1. 横线彻底移除**（用户明确要求）：删除 `.ts-composer-grip` 元素及其全部 CSS
   （含 hover/拖动态变色、透明度过渡 —— 过渡本身就是拖动中的“淡出重影”来源）。
   抓手只保留一条**不可见**的 16px 命中区（background/border/shadow 全无），
   可发现性靠 `cursor:ns-resize` + title 提示；拖动反馈靠 px 数字胶囊，
   固定高度的退路靠悬停浮出的「重置」。`reflect()` 同步删掉无人消费的 `tsOverflow`。

**2. 拖动闪屏**：`onPointerMove` 原来**每次鼠标移动都同步改 min/max-height + 摆位**，
   pointermove 频率可高于刷新率，等于把消息区/座位连续重排。改为逐帧合并：
   move 只算 `pendingPx` 并排一个 rAF（`applyDrag`），每帧最多应用一次；
   `pointerup` 若先于 rAF 到达则同步冲刷，保证松手值不丢。

| 验证（真机，最终构建 507,279B） | 实测 |
|---|---|
| 无横线 | `document.querySelector('.ts-composer-grip') === null`；抓手子元素只剩 [size, reset]；computed bg=transparent / border=0 / shadow=none；拖动中与松手后截图目检均无任何横线 ✓ |
| 拖动正常 | 逐帧合并后 box 36→176→236 跟手；cap/min-height=236；stored=236；px 胶囊实时显示 ✓ |
| 重置 | stored→null、min-height 移除、上限回自动 ✓ |
| 防抖未回退 | 静置 8s：styleWrites 14→14（零写入）；navs=1 无 reload ✓ |
| tsc/build | `tsc --noEmit` 全绿；`dist/client.js` 507,279B ✓ |

### 验证
本环境 `agent-browser` 的 socket 目录 `~/.agent-browser` 被沙箱拒绝写，改用
「Chrome for Testing + 裸 CDP（Node 内置 WebSocket）」；宿主页面上无法可靠模拟中文键击，
因此**同时**用两条证据链：
- **真机（127.0.0.1:3080，宿主真实输入条）**：增强已挂载（抓手/样式/上限变量都在）；
  自动加高把输入框从 36px 长到 249px（= 视口 356×70%）后进入滚动；
  抓手按下 → 拖动 → 松手：上限从 249 → 289 → 332（夹到视口-24）并在按住期间**冻结在
  同一 y**，`localStorage` 写入 332，刷新后 `manual=1`、上限保持 332；「重置」清空存储并回到自动。
- **布局沙箱（`composer-harness`，用真实 `dist/client.js` 产物 + 复刻宿主 CSS 结构）**：

| 项 | 实测 |
|---|---|
| 空 | box 36 / content 36 / cap 490（=700×70%）/ 无内部滚动 ✓ |
| 3 行 | box 76 = content 76，无内部滚动（一眼看全）✓ |
| 10 行 | box 244 = content 244，无内部滚动 ✓ |
| 25 / 60 行 | box 490 = 上限，content 604 / 1444 → 回到内部滚动 ✓ |
| 内容变少（未手动设高） | box 244 → 52 自动收回 ✓ |
| 抓手拖动 | 拖动期间上限 52→102→152，抓手 y 恒为 580（冻结，不跟盒子跑）✓ |
| 松手固定 | 拖到 36 后松手：`manual=1`、stored=36、内部滚动开启（真正的"固定高度"，内容变少也不自动收回）✓ |
| 刷新 | 重新载入后 cap 仍为存储值 ✓ |
| 重置 | 点「重置」→ cap 回自动、`localStorage` 为 null ✓ |
| 真机·自动加高 | 输入 12 行中文（578 字）：box 36 → **490**（=700×70%），卡片 98 → 552 ✓ |
| 真机·圆角不露头 | grip 左内缩 30 / 右内缩 34（卡片圆角 28），`gripTop = cardTop+4` 恒成立；2px 中性灰，拖动中才是蓝（0.8），松手回灰 ✓ |
| 真机·拖动 | 拖 120px：cap 490 → 550 → 610，抓手 y 冻结在 127（卡片已上移），stored=610、manual=1；重置后回 490 ✓ |
| 返工二·沙箱 | 短内容（52px）往上拖：box **52→102→152** 实时变高（min-height 生效）；松手固定 152；内容缩到 36 仍是 152；重置 → min-height 移除、box=内容、cap 回自动 ✓ |
| 返工二·真机 | 空/短输入框（36）拖 +80/+160：box **36→116→196** 即时跟手，minH 同步；刷新后仍固定 196；重置回 36/自动（cap=视口-160=540）✓ |
| 返工二·圆角 | 真机 radius=28 → inset 30/34，`gripTop-cardTop=4`，2px 灰线 ✓ |
| 返工三·无蓝 | 真机逐状态读 computed style：idle `.10` / hover `.42` / **dragging `.6`（灰，非蓝）** / 松手回 `.42`；拖动中盒 36→126 正常、松手固定、重置回自动；size 胶囊与重置描边均为中性灰 ✓ |

`tsc --noEmit` 全绿；`dist/client.js` 已重建（499KB，需刷新页面生效）。

## Step 60（2026-10-09）：提示音「一操作就自动停」

**用户需求**：现在只能手动点 ■ 停；希望**在 DSH 页面里一操作就自动停**。

### 实现（`sound.ts`）
- 新增全局监听（**惰性**：首次播放才挂，capture 阶段先于业务处理）：
  `pointerdown`（覆盖鼠标与触屏）/ `keydown` / `touchstart` / `wheel` —— 任一发生即 `stopSound()`。
- **250ms 宽限**：起音后这段内的操作不算，避免“正在操作时刚好响了一声”被当场抹掉
  （`lastStartAt` 记录起音时刻）。设置区 ■ 的 title 也补了这句说明。

### 浏览器目检（无头 Chrome + agent-browser）
| 项 | 实测 |
|---|---|
| 鼠标操作 | `playing='完成'`（60s 循环中）→ 原生 `mousedown/up` 于页面任意处 → `playing=''` ✓ |
| 键盘操作 | `playing='中断'` → `keydown` → `playing=''` ✓ |
| 宽限期 | 起音后 <250ms 派发 `pointerdown` → **仍在响**；过宽限期再派发 → 停 ✓ |
| 构建 | `errors` 空；`tsc` 全绿；`dist/client.js` 499,953B |

### 教训
「自动停」这类副作用要挂**全局捕获**监听而不是绑在某个按钮上，并留一个短宽限，
否则用户正在打字/滚动时刚好响起的提醒会被瞬间抹掉，等于没提醒。

## Step 62（2026-10-09）：去 dsh-call-session 化（会话创建半边）——官方原语直建探索者

**用户需求**：tokensave 不再受第三方插件（dsh-call-session）更新/失联拖累；两条候选路线
（①官方 dsh-session API 自建会话 / ②官方 subagent continuable）都确认后择优实现，不行就用②。

### 调查结论（dsh 0.2.0-rc.2 安装源码逐层核实）
- `session_create`（dsh-call-session）内部 = 三步官方原语编排：`agentsService.create()`
  （dsh-agent 服务 + dsh-agent-loop 工厂：建会话/装配/启动 loop）→ `agentPresets.resolve/mount`
  （预设装配，官方 `sessionController.composeAgent` 同款）→ `sessionTitle.rename`（ADR-0017 标题事件）；
  另两步（attachWorkspace、黑板引导公告）是协作特性，探索者不需要。
- 官方 `ctx.sessionController`（dsh-api-session-controller，profile 已启用）暴露 create/selectModel/
  prompt/rename，其 createOrAdopt 内部即 `ctx.agents.create({ sessionId, agentOptions, meta:{cwd}, setup })`
  ——`meta.cwd` 原生支持，`AgentOptions` 即 `{provider, model}`。**方案①完全成立且优于②**
  （②的 continuable sendMessage 只允许直接父子路由，改造面大且探索者不再是侧边栏独立会话）。

### 实现
- 新模块 `src/session/create-explorer-session.ts`：`createExplorerSession(ctx, {cwd,title,model})`
  直调官方三原语（服务经 ctx.get reflect 层免 inject 取得并兜异常）；agents 服务缺席即抛、
  agentPresets 缺席降级不挂 setup（与官方 composeAgent 降级一致）、标题失败不阻断。
- `parallel-explorer.ts`：`callTool('session_create')` 删除；新增 `resolveExplorerCwd()`
  （工作台项目作用域优先、调用方 session.header.cwd 回退）；**withProjectCwd Proxy hack 退役**
  （meta.cwd 原生）。dead code 清理：callTool/nextCallId/SessionCreateValue。
- `agent` 参数语义收窄：仅作 cwd 回退（CONTRACTS 已注记）。

### 端到端实测（web profile，HMR 热加载后真实委派）
- 探针经 tokensave_delegate 真实运行：探索者设置存过选择 → 5 探索者并行经**新路径**建会话，
  真实轮次跑完、黑板产出（post-1791587086848-g200y1）、简报回收成功。
- 新路径判别：黑板 `session:bootstrap` 主题 **0 条**（旧 call-session 路径建会话必发引导公告）。
- 持久化抽查（session-59c2063d…/session.v4.jsonl.zstd）：header `{cwd:/Users/sonoma/code/tokensave,
  agentPreset:standard, delegationDepth:0}` ✓（meta.cwd + 预设装配都生效）；
  `session/title` 事件 seq=3 source.kind='user' ✓（标题持久化生效）。
- `pnpm run check` 全绿；dsh-call-session 依赖从「建会话+黑板」收敛为**仅黑板**
  （boardStore/board_post/board_list，黑板自集成为下一步候选）。

### 教训
「第三方工具只是官方原语的编排壳」——去依赖前先把它的实现逐层读完：session_create 拆开全是官方
`agents.create` + preset + title 三件套，直接复刻比绕道 subagent 改造便宜一个数量级；且旧路径
「往公共黑板发引导公告」这个副作用，反过来成了端到端验证新旧路径的天然判别器。

## Step 63（2026-10-09）：浮窗子系统整体删除 —— 右下角「任务简报」按钮 + Alt+S 老板键不再存在

**用户需求**：右下角有个按钮，点开是「任务简报」，老板键 Alt+S——问对应哪个插件，要删掉。

**归属确认**：不是外部插件，是 **dsh-tokensave 自己的简报浮窗**（`client/src/float/mount.tsx`
的 `mountBriefWindow`，storageKey `tokensave:brief`；Alt+S 是 vendored FloatWindow 的默认老板键）。
触发链：`watchBrief` 订阅当前会话流 → 捕获 `tokensave-brief` 标记 → 挂浮窗。

### 删除面（删前先做了孤立性验证：float/mount 与 components 的外部引用数 = 0）
- `client/src/index.ts`：`watchBrief` + `BRIEF_START/END` + Probe 内简报监听 useEffect +
  `mountBriefWindow/mountedExplorerCount/subscribeSession` 导入，全部移除（-47 行）；
  头部注释同步改写。
- `client/src/float/mount.tsx` 整文件删除（`mountExplorerWindows` 自项目中心上线后本就零调用）。
- `client/src/components/`（BriefViewer.tsx + ExplorerStream.tsx）整目录删除——唯一消费方是 float。
- `client/vendor/dsh-float-window/` 整目录删除（唯一消费方是 float/mount；上一轮刚 vendor 进来，
  本轮随浮窗一起消失——vendor 的意义只存在于有消费方时）。
- `client/src/panel/HDesk.tsx`：`reportExplorerCount` 导入 + 调用移除。
- `tsconfig.json`：`client/vendor/**` include 移除；`scripts/build-client.mjs` 注释同步。
- 样式残留检查：styles.ts 无 brief-viewer / boss-key-hint / data-shell 规则（浮窗样式全在组件内联）。

### 简报去哪了（功能未丢）
1. 对话里照常显示（`tokensave-brief` 标记块，工具返回值）；
2. 黑板 `brief` 主题照常落帖（workflow 阶段 4 未动）。
删的只是「再弹一个浮窗副本」这层重复展示。

### 验证状态
- `pnpm run check`：我改动的所有文件零错误（5 个错误全部位于用户并行编辑中的
  `ControlRoomEntry.tsx`，系其 JSX 未闭合的进行中状态，与本次删除无关——该文件不 import 任何被删模块）。
- 构建因同一文件（esbuild 报 ControlRoomEntry.tsx:607 Unterminated regular expression）暂未出新产物；
  **等用户完成该文件编辑后重跑 `pnpm run build:client` + 刷新页面即生效**。
- 零残留 grep：`mountBriefWindow|BriefViewer|ExplorerStream|float/mount|FloatWindow|__dshFloatWindows`
  在 src/client/scripts 中 0 命中。

### 教训
删一个 UI 元素前先跑「孤立性验证」（消费方 grep = 0）再整链删除，比逐个删导出快且不会留半死代码；
vendored 依赖同理——vendor 不是资产，是**活代码**，消费方消失就该跟着消失，否则就是新的维护负担。

## Step 64（2026-10-09）：黑板自集成 —— 彻底移除 dsh-call-session 的最后一块

**用户需求**：做一个黑板，彻底删掉 dsh-call-session（Step 62 已去建会话，黑板是最后的硬依赖）。

### 调查（dsh-call-session@0.1.6 源码逐层核实）
- board-store.mjs（1069 行）= 内存 Map + 防抖落盘 board.json + FIFO 容量 + 备份恢复；
  语义要点：TTL 默认 3600s/上限 86400s、惰性过期（读时 active→expired）、
  工作区隔离（authorWorkspace 不匹配即过滤，空 = global 全可见）、topic 精确或前缀匹配、
  倒序 + limit（工具层上限 100）、titlesOnly 摘要映射（title+metadata 无正文）、
  保留主题拦截（telemetry:/call:/sys: 前缀，ADR-0012）。
- 工具注册（index.mjs）：board_post/board_list/board_clear 三件套的完整参数/返回 schema。

### 实现（同语义、同工具名自建 → 消费方零改动）
- **`src/blackboard/store.ts`**：`TokensaveBoardStore` 类——内存 Map + 每次变更原子落盘
  （tmp+rename）、300 条 FIFO、损坏文件改名留档从空板起步；`post/list/clear` 全量对齐原语义；
  落库 `~/.dsh/tokensave/board.json`（与 projects.json/explorers.json 同约定）。
- **`src/blackboard/tools.ts`**：同名注册 board_post/board_list/board_clear（defineTool），
  参数/返回结构对齐原版；exec.agent 解析 authorSessionId/authorWorkspace；逐个兜错注册
  （若 call-session 未卸载，同名冲突只降级单工具不拖垮插件）。
- **`src/tools/blackboard-ops.ts`**：postToBoard/getBriefFromBoard 改为直调自建存储
  （原经 ctx.tools.execute 绕第三方），返回形状不变（{ posts } 供 workflow 轮询）。
- **`src/board-web-route.ts`**：H 台 /board 路由 fetchBoardEntries 直读自建存储，
  彻底摆脱 `ctx.get('boardStore')`。
- **`src/index.ts`**：apply() 注册黑板三工具。
- 类型坑：defineTool 的 object 节点要求显式 `additionalProperties`（metadata/posts.items 均补 true）。

### 验证
- esbuild 语法 + tsc：宿主端 src/ 零错误（client 侧错误均为用户并行编辑中的文件，与本次无关）。
- **存储行为实测 15 项断言全过**（esbuild 打包 store.ts 到 /tmp 独立跑）：post 形状/TTL 默认、
  titlesOnly 摘要 vs 全文、workspace 隔离 + global 条目处处可见 + crossWorkspace、
  topic 前缀匹配、tag 过滤、惰性过期（active 查不到/all 变 expired）、保留主题拦截、
  archive/purge 语义、落盘重载持久化（含归档态）、容量 FIFO 上限 300、损坏文件容错留档。
- 探针测试脚本自身两处断言 bug（条目数算错、属性名写错）已定位为测试问题非存储问题，修正后全绿。

### 卸载指引（用户执行）
1. `dsh plugin --profile web remove dsh-call-session`（或手动从 profile package.json + bundles 移除）；
2. 重启 DSH。重启后：tokensave 的同名黑板工具接管（启动日志见「黑板工具已注册 3/3」）；
   顶部「看板」tab（conversation.view id=canvas）随插件消失——这是预期行为。
3. 旧黑板数据（call-session 的 board.json 在其插件目录）不迁移：条目 TTL 1 小时量级、
   300 条 FIFO，属 ephemeral 数据，新板从空起步即可。

### 教训
「同语义自建替代第三方」的关键是**先数清原语义的每一个角落**（TTL 边界/惰性过期/工作区空值口径/
保留主题/limit 上限差异——工具层 100 vs 路由层 200），再同名注册让所有消费方零改动；
比改每个调用点便宜且不会漏。行为断言测试要对着**真实语义**写，我自己前两版断言就写错了期望值。

## Step 65（2026-10-11）：黑板工具不生效的根因——TS 参数属性炸掉宿主 strip-only 加载

**现象**：黑板自建（Step 64）代码全绿（esbuild 语法/tsc/defineTool 真实执行/独立实例 boot 3/3 注册/
HTTP 端到端 200 全过），但用户的主服务里 board_post 报 unknown tool，HMR 反复重载也无效。

**根因**（决定性探针链）：
1. `src/blackboard/store.ts` 的 `constructor(private readonly filePath: string)` —— TS **参数属性**
   是不可擦除语法；dsh 宿主加载器 = Node 24 原生 **strip-only** TS，直接 SyntaxError：
   "TypeScript parameter property is not supported in strip-only mode"（`node --input-type=module
   -e "await import('.../src/index.ts')"` 一发命中）。
2. esbuild（客户端构建/tsc/我的独立测试）都接受参数属性 → 全绿假象；唯独真实加载器拒绝。
3. 导入失败 → 整插件不 apply → 黑板工具/路由/delegate 全无。旧服务里 HMR 每次重载都撞同一
   SyntaxError → 静默回退旧 fiber（旧 fiber 里 board_post 本就没注册过）→ unknown tool 恒态。

**误判复盘**：曾把「未授权请求 401」当作路由存活证据；后设对照组（不存在的插件路径也回 401）
证伪——401 是全局未授权响应，不证明任何路由存在。教训：**探测信号必须配对照组**。

**修复**：显式字段声明（`private readonly filePath: string` + constructor 赋值）；全 src 扫描
非擦除语法（参数属性/enum/namespace）零残留；node strip 导入实测通过。

**验证**（不重启主服务）：新起临时实例（端口 18991，--trusted-host + token 换 cookie）——
boot 无 failed to import、`黑板工具已注册 3/3`、marker `tools_ok=3/3 errors=[]`、
黑板/项目注册表路由 200 且种子条目映射正确；验毕杀实例清痕迹。
随后用户重启主服务（marker 04:48 tools_ok=3/3 确认），黑板进入真实生产（snake 项目委派数据上板）。

**新增诊断设施**：apply 每次执行覆写 `/tmp/tokensave-apply.marker`（时间戳 + tools_ok/3 + errors）——
mtime 新鲜 = 重载确实发生；tools_ok=3 = 黑板三工具在注册表。今后排查「改动没生效」先看它。

## Step 66（2026-10-11）：黑板标题两处体验修复（用户反馈）

**用户反馈**：① 标题列出现 markdown `**` 记号（不知是否故意）；② 简报条目标题显示成
`<!-- tokensave-brief:v1:start -->` 原始标记，要求改中文标题。

**定位**：两处根因都在 extractTitle——(a) 它剥 `#`/`-`/`1.` 前缀但不剥强调记号；
(b) 它取正文首行，而简报正文首行恰是 wrapBriefWithMarker 包的标记行。
另有隐藏问题：store 与 /board 路由各有一份 extractTitle（同名同逻辑双份维护）。

**修复**（CONTRACTS 标题提取规则已先行更新）：
- `src/blackboard/store.ts`：新增 `stripMarkdownEmphasis`（`**`/`__`/`~~`/反引号/成对`*`）；
  extractTitle 跳过 `<!--` 开头的行（标记行永不作标题）；metadata.title 也过同一剥离。
- `src/board-web-route.ts`：删除本地重复 extractTitle，改从 store 导入——标题规则只有一份。
- `src/orchestration/workflow.ts`：简报帖 metadata 增 `title: '任务简报'`（BlackboardEntry.metadata
  类型同步加 `title?: string`）——简报标题确定性中文化，不再依赖正文首行。
- 回归保障：不成对 `*`（如 "5 * 3 = 15"）不误剥；`#`/列表/序号/inline code/删除线用例全过。

**验证**：extractTitle 13 用例全过（含用户板上真实形态：`**加粗**` 首行、标记行简报）；
tsc 全绿；node strip 导入 OK；**HMR 热应用确认**（编辑期间 marker 被重写 05:43:39，
tools_ok=3/3）——存量条目标题提取在读取时发生，H 台刷新即见效，无需再重启。

## Step 67（2026-10-11）：多探索者 3 轮实测报告的 5 BUG + 1 优化全部修复

用户在 /Users/sonoma/code/dsh 用 explorer_count=3 连跑 3 轮，产出测试报告（主链路
全通、交叉验证质量递增；5 个 BUG + 耗时/污染优化项）。全部定位到根因并修复：

### BUG-1 旧轮次探索者窗口残留 → 轮次登记（src/blackboard/runs.ts 新模块）
根因：/explorers 路由只按「tokensave- 前缀 + 工作区」列会话，不识轮次。
修复：每工作区一条当前轮登记（~/.dsh/tokensave/runs.json）；parallelExplore 开跑
beginRun（归档上一轮 tokensave 帖）→ 建会话 → recordRunSessions；路由按登记过滤
（响应带 runId），无登记不过滤。旧轮窗口 8s 轮询内自动消失。单测：归档 3/3、
他项目帖保留、登记/重置语义全过。

### BUG-2 探索者混入 DSH 主对话 → 三道闸
① readProjectActivity 跳过 s.explorer（活动点/跑马灯不再出现探索者）；
② sessions.ts 新增 isExplorerSessionId；③ HDesk 主对话卡 mainChatSessionId 回退
latestProjectSession——用户从侧边栏点到探索者时，工作台主对话卡绝不渲染探索者内容。

### BUG-3 发帖率不稳（1/3、1、2/3）→ 等全员 + 显式标注
根因：waitForExplorerPosts「1 pitfall + 1 solution 即早退」——1 个探索者发完就进评审，
其余还在跑；沉默者无任何记录。
修复：改为等**全部**预期探索者发过帖（全员到齐即早退），上限放宽 240s→480s；
未发帖者按 agent 即时状态三分标注（仍在运行/已结束未写/会话不可用），置顶写进简报
（「⚠️ 本轮未发帖探索者…结论未覆盖」）+ metadata.silentExplorers。

### BUG-4 metadata 规范落实不均（仅 MiMo 完整）→ 提示词 + 服务端双保险
提示词强制 metadata（title/source/confidence/digest）且要求「没坑也要写明」；
board_post 服务端 normalizePostMetadata 统一补默认值（title←正文首行、source←会话
标题、confidence←medium、digest←首行截 80 字）——四模型遵守度不一也不影响交叉验证。

### BUG-5 评审只见标题 → 评审读正文
getBriefFromBoard 加 opts{workspace, full}；等待轮询仍用摘要模式（便宜），定稿时
full 拉正文，digest 每主题最多 12 帖、每帖截 1500 字——评审 prompt 有界。

### 优化-6 耗时增长 & 黑板污染 → 轮次隔离 + 输入有界
旧帖混入是考古与膨胀的主因：beginRun 归档上轮帖 + 引擎帖带 workspace（按项目收敛）
+ 评审输入定界（12 帖 × 1500 字）→ prompt 不再随轮次/板上条数增长。
耗时 75s→7min→21min 的观察中，评审考古与旧帖等待占比下降；探索者模型本身耗时
（链路 fallback 到慢档）不在本次修复面，待后续用 runId 统计精确定位。

**验证**：tsc 全绿；node strip-only 导入 OK；runs/store/tools 新逻辑 11 项单测全过
（含他项目不误伤、full/摘要双模式、工作区收敛）；客户端产物重建（522KB）；
HMR 热应用确认（marker 06:43:21 重写 tools_ok=3/3）。CONTRACTS 已同步
（runs.ts 契约、parallelExplore 返回值 +model、getBriefFromBoard opts、
board_post metadata 兜底、BUG-2 三道闸）。

## Step 68（2026-10-12）：刷新后左侧边栏保持关闭（自动收起）

用户反馈：「当页面刷新之后，左侧边栏会展开，我希望保持左侧边栏是关闭的状态。」

### 根因（宿主缺陷，非本插件）

侧边栏宽/收起状态存在 `@deepseek-ai/dsh-client-ui-layout` 的根 store：
`createLayoutStore()` 用 `defineStore({ init, actions })` 定义，**没有 persist 键**；
`dsh-client-store` 只有声明 persist 才 `attachPersistence`（写 localStorage）。
于是每次刷新 `layoutInfo.sidebar` 回到初始 280（展开）、`narrowExpanded` 回到
false；窄视口（<1024 = SIDEBAR_AUTO_COLLAPSE）默认收起、宽视口默认展开。
已 grep 全部 client 包与前端产物的 localStorage 键，无别处持久化；config-catalog
里 ui-layout 也无配置项（"—"）。宿主 LayoutController 只暴露 `toggleSidebar()`，
无状态读取 → 状态判定走 DOM（AppFrame 只在收起时挂 `data-sidebar-collapsed`）。

### 修法（用户选定「总是收起」）

新增 `client/src/sidebar-collapse.ts`（`installSidebarCollapse(ctx)`，在
`index.ts` apply() 里 try/catch 挂载）：

- **等服务**：`readService(ctx,'layout')` → `ctx.inject(['layout'])` → 100ms 轮询，
  5s 上限（与 wrapSessionNavigation 同口径），超时只 warn 不阻断其它功能。
- **判态**（纯函数 `decideSidebarCollapse`）：已收起→skip；已展开→toggle；
  帧未渲染→按 store 初始值推断（≥1024 视为展开→toggle，首帧前收掉不闪宽栏；
  <1024 默认收起→skip，盲目 toggle 会反向展开）。帧是否渲染用
  `data-rightbar-collapsed` / `.ts-side-entry` 旁证（`readSidebarCollapsed`
  三态：true/false/null）。
- **一次语义**：`window.__tsSidebarCollapse` 标记——同一次页面加载（含 HMR
  热重应用）只处理一次；真刷新标记消失→重新收起，正是要的语义；会话中你
  手动展开绝不被再按回去。toggle 后 3s 轮询校验属性落位，失败只 warn 不重试。

### 验证

- `pnpm check`（tsc）全绿；全量测试链 9 项 ALL PASS（新增
  `test:sidebar` → `scripts/check-sidebar-collapse.mjs`：决策表 6 项、
  DOM 三态 4 项、选择器/常量锚定宿主源码 3 项、幂等 3 项、挂载点 3 项）。
- 运行时冒烟（真实 `dist/client.js` 产物 eval）：注册 id=dsh-tokensave ✓；
  无服务 ctx 下 apply 不抛异常（marker pending、优雅降级）✓；
  有 layout 服务 + 帧已渲染 → toggle 一次、reason=boot-default-expanded/expanded ✓；
  二次 apply（模拟 HMR）仍为 1 次 ✓。
- `pnpm build:client` 重建 `dist/client.js`（529,118B）+ `node --check` 通过。

**注意**：本修复在客户端产物里，需刷新页面（或 HMR 推送）后生效；宿主侧
布局 store 无 persist 的根因仍待上游修复（届时本补丁自动变为 no-op：
判态已是收起 → skip）。

## Step 69（2026-10-12）：点击输入条任意空白即聚焦可编辑面

用户反馈：「当我鼠标已经点了对话框区域（假设输入框分最顶部的第一行、第二行、
第三行）的中下行时，是不会出现光标的……只要鼠标点击了输入框任意位置（除了那些
发送、更换模型、权限控制等按钮开关），都能实现进入可编辑状态。」

### 根因（读宿主 ui-conversation 源码确认）

可见输入框盒子 = `[data-input-scroll]`（.scroll，max-height+overflow）> `.grow`
> `[data-composer-input]`（contenteditable）+ 覆盖其上的占位符层。contenteditable
只有内容那么高（min-height:36px），而盒子被 composer-resize 自动加高/手动固定撑到
几百 px —— **中下行是 .grow/.scroll 的空白背景，普通 div 点了不聚焦**；占位符层
CSS 明确 `pointer-events:none`，点击穿透到背景同样不聚焦；点不可聚焦区域还会把
已聚焦的编辑面 blur 掉。发送/换模型/权限按钮在 scroll 之外或本身是 button，天然
不受影响（也正应排除）。

### 修法（新增 client/src/composer-focus.ts）

document **捕获阶段**单 click 委托（不 stopPropagation / 不 preventDefault，
不碰宿主 React 树）：`decideComposerFocus()` 纯决策按序判 ——
① 不在滚动口 → skip `outside-scroll`；② 命中 `INTERACTIVE_SEL`
（button/a/select/input + role=button|menuitem|option|switch|tab|combobox|listbox）
→ skip `interactive-control`；③ 目标在编辑面内 → skip `native-focus`（浏览器原生）；
④ 拖选中（选区非折叠且锚点在口内）→ skip `selecting`；⑤ 编辑面不可编辑
（workspaceTrigger 空态/disabled）→ skip `editor-not-editable`；
⑥ 其余 = 点盒子空白 → `focus`。动作 `focusComposerAt()`：`focus({preventScroll:true})`
（失败回落普通 focus）+ `caretRangeFromPoint`/`caretPositionFromPoint` 落光标到点击点，
落点不在编辑面内则收拢到文末。每次现查 DOM，会话/Tab 重挂载、HDesk 停靠、
resize 改高度天然适配；诊断 `window.__tsComposerFocus.last` 记录最近一次 reason。

### 验证

- `pnpm check`（tsc）全绿；全量测试链 **10 项 ALL PASS**（新增
  `test:composer-focus` → `scripts/check-composer-focus.mjs`：决策表 7 项、
  选择器/宿主源锚定 4 项、focus 动作 2 项、挂载点 3 项、幂等 1 项）。
- 运行时冒烟（真实 `dist/client.js` eval）：apply 挂载 capture click 监听 1 个、
  二次 apply 幂等仍 1（另一监听属既有 scroll-memory）✓；模拟点盒子空白 →
  `focus({preventScroll:true})` + last=click-to-focus ✓；点按钮 → focus 0 次 +
  last=interactive-control ✓。
- `pnpm build:client` 重建 `dist/client.js`（532,953B）+ `node --check` 通过。

## Step 13-A（2026-10-12）：dockview 接管布局 —— Step A spike 通过

按 `docs/prompts/step-13-dockview.md` 的 Step A 落地并**在真机 GUI（127.0.0.1:3080）
用 agent-browser 实测**。结论：**四个验证点全通过，方案可以继续**。

### 做了什么

- vendor 引入：`client/src/vendor/dockview-core.min.js`（UMD，v8.5.1，549KB）+
  `dockview.css`（160KB），取自 info_report 的同一份。
- `client/src/vendor/dockview.ts`：**按文本取源 + `new Function(src)()` 全局执行**
  —— UMD 在 CJS 信封里会被认成 CJS 分支（API 进 bundle exports，拿不到），必须在
  全局作用域跑才会挂到 `globalThis['dockview-core']`。CSS 注入一次性 `<style>`（幂等）。
  构建侧：`scripts/build-client.mjs` 加 `loader:{'.css':'text'}` + vendor `*.min.js`
  文本插件；`types/vendor.d.ts` 补声明。
- `client/src/panel/dock-spike.tsx`：一次性验证容器（vanilla DOM 建面板，避开本仓未装的
  react-dom/client），挂在 `shell.overlay`，**只在 `?dockview-spike=1` 或
  localStorage `tokensave:dock-spike.v1=1` 时渲染**，平时完全不进 DOM。
  含两个「假项目」各带 预览(ticker iframe) + 主对话(自带输入框)，加项目中心列表，
  工具栏有 锁布局/浮动/隐藏/显示，诊断挂 `window.__tsDockSpike`。
- `scripts/check-dockview-spike.mjs`（26 项，已入 `test` 链 → 全量 11 项 ALL PASS）。

### 实测结果（真机）

| 验证点 | 结果 |
| --- | --- |
| ① 产物可加载 | ✓ bundle 1,265,721 B（533,933 → +731KB，含 vendor ~709KB）；UMD 全局分支拿到 API |
| ② 样式无冲突 + 透明 | ✓ `.dv-groupview` 计算背景 `rgba(0,0,0,0)`；5 个 tab **0 个关闭键**（图标标签）；spike 外壳 0.28 透明，底层页面可见 |
| ③ 锁布局 / 隐藏面板 | ✓ `updateOptions({disableDnd:true})` 后 `api.dndCapabilities` 由 `{html5:true,pointer:true}` 变 `{false,false}`，可读回；`panel.api.setVisible()` 可用 |
| ④ 两项目输入互不影响 | ✓ A/B 草稿各自独立（`{A:'A草稿', B:'B草稿'}`） |
| **⑤ 媒体/长任务不重载** | ✓ ticker iframe 经历「真实鼠标拖拽改分隔条 + 浮动 + 隐藏/显示 + toJSON/fromJSON 往返」，计数 **1079→5215→7577→9390 一路只增不减** |

其他 API 事实（本版 8.5.1）：有 `addFloatingGroup` / `addPopoutGroup` / `createTabGroup` /
`moveTabGroup` / `dndCapabilities` / `toJSON`/`fromJSON`；无 `api.options` 与
`api.floatingGroups`（读回锁状态要用 `dndCapabilities`）；组 API 有 `setVisible`/`isVisible`/
`maximize`/`isMaximized`/`moveTo`/`location`。

### 结论 / 遗留

- 方案成立：`disableDnd` 可承接现有「布局锁」，`setVisible` + `defaultRenderer:'always'`
  可承接「切项目不重挂」，`toJSON/fromJSON(reuseExistingPanels)` 可承接按项目持久化。
- 遗留 1：**点分隔条会 blur 输入框**（原生行为，info_report/VSCode 同样如此）；
  草稿存在面板之外的状态里，所以拖动/切分组不丢内容（已验）。Step C 若要「拖拽中不丢焦点」，
  只能在拖拽期间临时把焦点还给原输入框，属可选优化。
- 遗留 2：`addFloatingGroup` 调用后该面板进新组，但本版无 `floatingGroups` 读数，
  Step B 要浮动的行为细节需在 Step B 里边做边确认。
- spike 保留在仓内（默认关闭），Step B 起可直接用它做回归对照；Step D 收口时删除。

## Step 13-B（2026-10-12）：工作台交给 dockview 接管（面板化替换，默认生效）

Step A 通过后按 `docs/prompts/step-13-dockview.md` 的 Step B 落地。**工作台现在默认由
dockview 渲染**（flag 一键回退），六类真组件全部面板化，真机验证通过。

### 做了什么

- `client/src/panel/DeskDock.tsx`（新，约 430 行）：dockview 宿主。
  - 面板：`preview/board/chat/talk/save` 常驻 + `exp:<sessionId>` 每个探索者一个；
    内容全部是**真组件**（Blackboard/TalkColumn/SavingsColumn/MainChat/PreviewPanel/
    ExplorerWindow），用 `createPortal` 挂进 dockview 容器 —— 单棵 React 树，无额外 root，
    因此面板移动不丢 React 状态。
  - 数据管线照抄 HDesk 口径：探索者按 workspace 8s 轮询、项目预览 10s 探测、
    主对话会话 = 探索者会话时回退本项目最新会话。
  - 布局快照 = dockview `toJSON/fromJSON`，按 **projectId** 分键（`tokensave:desk-dock.v1:<id>`），
    300ms 节流写盘 —— 替代 `desk-layout.ts` 的自研持久化。
  - 布局锁 = `updateOptions({ disableDnd })`（Step A 证明可用 `dndCapabilities` 读回）。
  - 关闭的面板以「已关闭：＋」chips 恢复（dockview 无此概念，照 info_report 补）；
    「重置布局」清快照回默认。
  - 输入条停靠**复用** HDesk 的 `useDockNativeComposer`（本次只把它 `export`，未复制实现；
    Step B2 再搬成独立文件）。
- `ControlRoom.tsx`：新增引擎开关 `readDeskEngine()` —— 默认 `dockview`，
  `localStorage['tokensave:desk-engine.v1']='grid'` 可**一键回退**旧 HDesk（应急用）。
- `types/react-dom.d.ts`：createPortal 补带 key 的重载声明。
- `scripts/check-desk-dock.mjs`（18 项，已入 test 链 → 全量 **12 项 ALL PASS**）。

### 真机验证（127.0.0.1:3080，agent-browser）

| 检查 | 结果 |
| --- | --- |
| 工作台已切换引擎 | ✓ `.ts-desk`（旧网格）不在，`[data-desk-dock]` 在 |
| 面板齐备 | ✓ `[chat, preview, board, talk, save]`，5 tabs / 5 groups |
| **输入条仍正确停靠** | ✓ 宿主导入条 `position:fixed`，且矩形**完全落在聊天面板内** |
| 布局锁 | ✓ `dndCapabilities` true→false→true（可读回） |
| 关闭→恢复 | ✓ 关「协作收益」→ 出现 chip「＋ 协作收益」→ 点击后面板回位 |
| 刷新持久化 | ✓ 快照 1163B 落盘（键按 projectId），刷新后 5 面板完整恢复、无关闭项 |
| 应急回退 | ✓ flag=grid → `.ts-hdesk` 回归、dockview 元素为 0；清 flag 后恢复 dockview |

### 遗留（Step B2 / C 待办）

- **B2 未做**：HDesk 的网格机（三列轨道/midSplit/分隔条/恢复 chips）、`desk-layout.ts`
  自研持久化、`styles.ts` 里 H 台 CSS 仍保留 —— 因为回退开关还指着它。等真机用一阵
  确认 dockview 路线无回退需求后再删（那时 `test:desk` 一并重写）。
- **关闭面板会销毁 DOM**（媒体随之停）：与「切项目保活」不同 —— 后者靠 dockview 的
  隐藏/tab（`defaultRenderer:'always'`），Step A 已证明 DOM 不摘；要连「关闭也能保活」
  就得加 info_report 那种 park 容器，属可选优化。
- 跨实例拖拽（`wireCrossDockDnd`）**不需要**：本方案只有一个 dockview 实例。
- 空分组清理由 `noPanelsOverlay:'emptyGroup'` 承接。

## Step 13-C（2026-10-12）：多项目并存 —— 一个 dock 里同时活着 A/B

按 `docs/prompts/step-13-dockview.md` 的 Step C 落地，**真机验证通过**。

### 做了什么

- `DeskDock.tsx` 重写为**多项目宿主**（不再是「一个项目一个实例」）：
  - 面板 id 命名空间 `<projectId>:<kind>`（kind ∈ preview|board|chat|talk|save|exp:<sid>），
    A/B 面板天然不撞名；`center` 是项目中心面板，可开关项目。
  - **dockview 实例只建一次**（依赖刻意收窄为 `[]`），项目开关只增删面板、不重建实例；
    「打开的项目集合」存 `tokensave:desk-open.v1`，刷新原样恢复。
  - 布局整块快照存 `tokensave:desk-dock.v2`（含所有项目），300ms 节流；关闭面板用 chips 恢复。
  - 数据**按项目分桶**轮询（`data[projectId]`，探索者 8s / 预览 10s），互不共用。
- `ProjectComposer.tsx`（新）：**每个项目窗口自带输入框**，发送走已有的
  `sendToSession(sessionId, text)` → 天然对应本项目会话。多项目模式**不再停靠宿主那一座
  composer**（全页只有一座，必串台），也**不导航宿主会话**（不调 openSession/replaceMain）。
- `chat-view.ts`：镜头改成**按会话分键**（`useChatView(scope)`，键 `tokensave:chat-view.v1:<sessionId>`），
  不带 scope 时退化为旧全局单值（向后兼容）；`MainChat` 传 `sessionId`。
- `ControlRoom.tsx`：默认渲染多项目 `DeskDock`（不再按项目 `key` 重挂）；flag=grid 仍回退旧 HDesk
  （旧引擎保留「单项目 + 重挂」老语义）。

### 真机验证（3080 + agent-browser）

| Step C 验收项 | 结果 |
| --- | --- |
| A/B 同时活着 | ✓ 打开 tokensave + info_report → **10 个面板**（各 4-5 个）、2 个聊天格 |
| 输入框正确对应 | ✓ 两个输入框 `data-composer-target` 是**各自不同的会话 id**（session-2e4f… / session-35bf…） |
| 来回切 10 次不重挂 | ✓ 预置标记的 iframe 经过 10 次 `focusProject` 切换后**标记仍在**、面板数不变（DOM 未重建） |
| 刷新恢复 | ✓ 重载后两个项目、2 个聊天格、2 个输入框、10 面板全部原样回来 |
| 项目中心降级为面板 | ✓ `center` 面板列出 10 个登记项目，逐个「打开/关闭」，已开显示「● 已打开」 |
| 不导航宿主会话 | ✓ DeskDock 源码零 `openSession`/`replaceMain`/`primeViewPreference`；只读 `latestProjectSession` |
| 镜头不串台 | ✓ 切 A 的镜头只写 `tokensave:chat-view.v1:session-2e4f…`，B 的状态不变 |

测试链 **12 项 ALL PASS**（`check-desk-dock.mjs` 扩到 26 项，含 Step C 的 8 项）；`pnpm check` 全绿；
产物 1,292,791 B。

### 遗留

- HDesk 网格机、`desk-layout.ts`、H 台 CSS 仍保留（回退开关要用）——**B2 待做**：确认不再需要
  回退后删除，并重写 `test:desk`。
- 路由机器（`replaceMain` 接管）未停用：它只影响「从侧边栏点会话时的宿主导航」，多项目模式下
  不参与项目切换，暂无冲突；B2 可一并处置。
- 关闭面板仍会销毁 DOM（媒体随之停）；「背景项目保活」靠的是同 dock 内隐藏/tab（已验）。

## Step 13-D（2026-10-12）：收口 —— 删旧网格机、重写测试、真机回归

Step 13（dockview 接管工作台）的收口。**B2 删除已执行**，测试与契约同步。

### 做了什么

- **删除旧网格机**：`HDesk.tsx`（1283 行）、`desk-layout.ts`、`desk-win-seed.ts`、
  `desk-types.ts` 全部移除；`ControlRoom` 不再有引擎开关 / 旧分支，直接渲染 `DeskDock`。
  `store.removeProject` 的 `forgetDeskPref` 改为从 `tokensave:desk-open.v1` 摘除该项目。
  顺带清掉 styles.ts 里随之作废的 H 台 CSS（`.ts-desk*`/`.ts-closed-bar`/`.ts-chip`/
  `.ts-hsplit` 等 20 行；brace 平衡仍为 0）。
- **抽出纯模块** `client/src/panel/desk-panes.ts`：面板 id 命名/解析、标题/图标映射、
  `desiredPaneIds()`（「应当存在哪些面板」的推导）。DeskDock 改为复用它——面板增删逻辑
  因此**可单测**（不需要 DOM/dockview）。
- **修掉两处真问题**：① 探索者窗口的三键接到 dockview（最小化→隐藏面板 / 最大化→组最大化 /
  关闭→关面板可 chips 恢复），此前是空函数（点了没反应）；② 合并 8s/10s 两条定时器为一条
  轮询（原先重复请求探索者+预览探测）。
- **测试重写**：`check-desk-ux.mjs` 旧网格断言全部作废 → 改为「面板纯逻辑单测 + 桌面外壳断言」；
  `check-desk-dock.mjs` 同步到新模块布局（面板 id 来自 desk-panes、旧网格必须不存在、
  全仓不再有宿主输入条停靠）。

### 真机回归（127.0.0.1:3080 + agent-browser）

| 项 | 结果 |
| --- | --- |
| 旧网格已消失 | ✓ `.ts-desk` 不在；`.ts-desk`/`desk-layout` 文件不在仓内 |
| **拖拽** | ✓ 鼠标真拖分隔条，面板数不变、无异常 |
| **最大化 / 还原** | ✓ `hasMaximizedGroup()` true → `exitMaximized()` false |
| **双项目切换** | ✓ 两项目 10 面板；切 10 次后预置标记的 iframe **仍在**、面板/iframe 数不变（DOM 未重建） |
| **刷新恢复** | ✓ 重载后 2 项目、10 面板、2 聊天格、2 输入框（info_report / tokensave）原样回来 |
| 产物 | ✓ 1,215,695 B（删 HDesk 后较 Step C 的 1,292,791 **减少 77KB**）；`node --check` 通过 |

`pnpm check` 全绿；全量测试链 **12 项 ALL PASS**。

### 遗留（可选，不影响使用）

- styles.ts 仍有少量 H 台时代的选择器（`.ts-preview*`/`.ts-vsplit`/`.ts-bar` 等）——
  它们**仍被 PreviewPanel/MsgList/TalkColumn 等在用**，不是死代码，故保留。
- 关闭单个面板会销毁其 DOM（媒体随之停）；「背景项目保活」靠同 dock 内隐藏/tab（已验）。
- spike（`dock-spike.tsx` + `?dockview-spike=1`）保留作对照，可随时删。

## Step 13-E（2026-10-12）：撤回多项目并屏 —— 还原「项目中心 + 工作台（单项目 + dockview）」

用户反馈：「新的交互逻辑比较混乱，想还原为【项目中心 + 工作台 + dockview】的模式，
也就是最初那种状态，只是把工作台中窗口的布局（顶部项目预览 + 下面 H 型布局）换成 dockview。」

### 做了什么

- **`DeskDock.tsx` 回到单项目形态**（`DeskDockProps = { project, sessionId, onBack }`）：
  - 一次只呈现一个项目；面板 id 仍带项目前缀（`<projectId>:<kind>`），但只含本项目。
  - 项目中心**不再**是 dock 内部面板（`center` 从 desired 集合里删掉）——它回到独立 tab。
  - 布局快照回到**按项目分键**：`tokensave:desk-dock.v1:<projectId>`，300ms 节流。
  - 数据单桶轮询（探索者 + 预览探测同拍 8s，取消原先 8s/10s 两条定时器）。
  - 恢复 chips / 布局锁 / 重置布局 / 探索者三键接 dockview，全部保留。
  - 挂载时一次性清理并屏时代遗留键 `tokensave:desk-open.v1` 与 `tokensave:desk-dock.v2`。
- **`ControlRoom.tsx` 还原入口语义**：`if (sessionId && opened)` → `<DeskDock key={opened.id} …/>`；
  没选项目时仍是「引导去项目中心」。项目中心 → 工作台链路不变（`enterProjectWorkbench`）。
- 测试同步：`check-desk-dock.mjs` / `check-desk-ux.mjs` 的并屏断言改写为单项目语义
  （项目中心独立 tab、实例按 project.id 重挂、快照按项目分键、数据单桶）。

### 真机验证（3080 + agent-browser）

| 项 | 结果 |
| --- | --- |
| tab 结构 | ✓ `对话 / 轨迹 / 项目中心 / 工作台` 四个 tab 并存（项目中心回到独立 tab） |
| 面板集合 | ✓ `[<pid>:chat, :preview, :board, :talk, :save]` 共 5 个；1 个本项目输入框 |
| 遗留键清理 | ✓ `desk-open.v1` / `desk-dock.v2` 均为 null；只剩 `desk-dock.v1:<pid>` |
| 拖拽 | ✓ 鼠标真拖分隔条，面板数不变、iframe 标记保留（未重建） |
| 关闭 → 恢复 | ✓ 关「协作收益」→ chip 出现 → 点击恢复回 5 面板 |
| 刷新恢复 | ✓ 重载后 5 面板、无关闭项、本项目输入框在 |
| 布局锁 | ✓ `dndCapabilities` 可读回 |

`pnpm check` 全绿；全量测试链 **12 项 ALL PASS**；产物 **1,210,968 B**（较并屏版再减约 5KB）。

### 说明

- 「顺序保留、避免串台」的那批基础设施没有回退、继续保留：每项目自带输入框
  （`ProjectComposer` → `sendToSession`）、面板纯逻辑模块（`desk-panes.ts`）、
  镜头按会话分键（`chat-view.ts`）。它们让单项目模式同样干净，也为将来需要并屏时留好口子。

## Step 13-F（2026-10-12）：只保留 DSH 原生输入条，并绑进「DSH 主对话」面板

用户反馈：「我看到两个聊天输入框（DSH 原生 + 我那个简陋的）。请不要简陋版，
只留 DSH 原生那个，但原生那个要和 DSH 主对话**绑在同一个窗口里**，而不是一直显示在页面中下位置。」

### 做了什么

- **删除自建输入框** `ProjectComposer.tsx`（连同 DeskDock 里的 `.ts-pc-*` 样式与
  DeskDock 内的引用）——「简陋版」彻底移除。
- **恢复原生输入条停靠**：从 git 取回旧实现（原在 HDesk.tsx 内，随 HDesk 删除而失去），
  迁到新模块 `client/src/panel/composer-dock.ts`：
  - `COMPOSER_SEAT = '[data-conversation-region="composer"]'`；
  - `useDockNativeComposer(ref, enabled, aboveOverlay, deps)`：把原生输入条 `position:fixed`
    停靠到给定容器矩形内（向下锚定、内容向上生长），**卸载即还原原始行内样式**；
  - `hostContentWidthPx()`：读宿主横向拖拽宽度，让主对话内容与输入条同步变窄并居中；
  - 跟随机制：容器 `ResizeObserver` + window resize/scroll(capture) + 300ms 轮询兜底 +
    祖先链 style MutationObserver（宿主拖拽只改 CSS 变量、不改尺寸）。
- **DeskDock 接线**：聊天面板容器挂 `chatCellRef`，`useDockNativeComposer(chatCellRef,
  liveIds.includes(chatPaneId), false, [liveIds, reloadKey])` —— 面板存在才停靠，关闭即交还宿主。
- 底部留白沿用既有 CSS（`--ts-composer-h` 由停靠逻辑写入 → `.ts-chat-msgs` padding-bottom），
  末尾几行不被输入条遮住。

### 真机验证（3080 + agent-browser）

| 项 | 结果 |
| --- | --- |
| 输入条数量 | ✓ `[data-conversation-region="composer"]` **1 个**；自建输入框节点 **0 个** |
| 绑进面板 | ✓ 原生输入条 `position:fixed`，矩形**完全落在**「DSH 主对话」面板内 |
| 拖拽跟随 | ✓ 真鼠标拖分隔条：面板高 198→252，输入条 bottom 294→400，仍在面板内 |
| 卸载还原 | ✓ 切到「对话」tab：行内样式清空、回到宿主的 `sticky` 原位、CSS 变量也清除 |
| 切回重停靠 | ✓ 回「工作台」自动恢复 `fixed` + 面板内 + `--ts-composer-h` 写回 |

`pnpm check` 全绿；全量测试链 **12 项 ALL PASS**；产物 1,211,609 B。

### 说明

- `composer-focus.ts`（点击输入条任意空白即聚焦）**保留**——它服务的正是这个原生输入条；
  之前一度误删其测试脚本 `check-composer-focus.mjs`，已重建并回到测试链。
- 停靠仍是 DOM 级 hack（源自旧实现），但它现在只服务**一个**目标容器，比并屏时代的
  多处停靠更简单可控。

## Step 13-G（2026-10-12）：DSH 主对话消息宽度跟**自己的面板**自适应

用户反馈：「主对话消息要按自己这个窗口的宽度比例调节显示。现在只能在原生『对话』tab
里鼠标变双向箭头时缩放；面板很小时，主对话内容右侧会被截断。」

### 根因（实测确认，不是猜）

`.ts-chat-msgs` 是 `box-sizing:content-box` + `width:100%` + 左右 `padding:10px`，
而本项目**没有全局 `*{box-sizing:border-box}` 重置** → 实际占位比面板宽 **20px**
（实测 `clientWidth 632` vs 面板 `612`），右侧被裁；再叠加它原本还吃
`--ts-chat-content-w`（取自宿主 `--dsh-chat-user-width`，**带 680px 下限**），
面板变窄时那个值不会跟着变小，于是「窄面板下右侧截断」被放大。

### 修法

- `styles.ts`：`.ts-mainchat .ts-chat-msgs` 改为
  `box-sizing:border-box; width:100%; max-width:100%; margin-inline:0` ——
  **只受本面板约束**，不再引用 `--ts-chat-content-w`。
- `composer-dock.ts`：输入条宽度同口径改为「只受面板约束」
  （原来借宿主宽度的 680px 下限，同样会宽出面板、右侧被截）；
  随之删掉已无引用的 `hostContentWidthPx()` helper。
- 底部留白（`--ts-composer-h`）与停靠跟随逻辑不变。

### 真机验证（3080 + agent-browser）

| 项 | 结果 |
| --- | --- |
| 修复后贴合 | ✓ `box-sizing:border-box`；消息区 `612` == 面板 `612`，`scrollWidth <= clientWidth` |
| **窄面板（模拟 180px）** | ✓ 消息区 `180` == 面板 `180`，**无溢出**；输入条同宽且仍在面板内 |
| 消息气泡 | ✓ 逐个量 `getBoundingClientRect().right`，**无右侧溢出** |
| 宽面板 | ✓ 恢复后同样贴合（612），输入条在位 |

`pnpm check` 全绿；全量测试链 **12 项 ALL PASS**；产物 1,211,640 B。

## Step 13-H（2026-10-12）：参考 info_report —— 拖拽落点指示 / 区域开关+皮肤 / 布局存取

用户三项要求（均以 info_report 的实现为参照）。

### 1. 拖拽落点指示（「拖动不顺畅、看不清落点」）

**根因**：dockview 官方默认落点是半透明灰底 `rgba(83,89,93,.5)` +
`--dv-drag-over-border-color: transparent` —— 落点几乎看不出来；
info_report 靠 `--dv-drag-over-*` 覆盖来解决。

**改法**：DeskDock 主题里覆盖两个变量（蓝底 `rgba(79,142,247,.22)` + 蓝描边
`#4f8ef7`），并给 `.dv-drop-target-anchor` 补描边/圆角/内投影；另加
`.dv-tab{cursor:grab}` / `.dv-sash:hover{background:rgba(79,142,247,.5)}` ——
拖动抓手本身可见（「不顺畅」很多时候是**抓不到**分隔条）。

### 2. 右上角区域开关 + 皮肤（参考 info_report 标题行）

- **区域开关**：按面板 kind 划三区 —— 主侧栏（preview）/ 面板区（board·talk·save·探索者）/
  辅助侧栏（chat）。点一下收起该区：记下该区面板规格快照 → `removePanel`；
  再点展开：按快照原样放回（同 info_report 的 hide-panel 手法）。
  状态存 `tokensave:desk-regions.v1`。
- **关键坑**：`reconcile` effect 会把「不是 desired 的面板」补回来，于是收起立刻被撤销——
  已加闸门 `inHiddenRegion()`：被收起区域的固定面板与探索者面板**不补**。
- **皮肤**：5 套内置（无 / 深蓝 / 墨绿 / 暗红 / 光晕），选中即写 dock 背景并持久化
  `tokensave:desk-skin.v1`。

### 3. 默认布局 / 保存布局（参考 info_report 状态栏）

- **保存布局**：把当前 dock 快照存为默认（`tokensave:desk-saved.v1:<projectId>`）。
- **默认布局**：优先恢复用户保存过的那份；没保存过则回内置摆位。
- **语义对齐 info_report**：拖动/关闭**不再自动覆盖**已保存的默认布局，只把「保存布局」
  按钮点亮（`●`）提醒；程序化恢复期间用 `suppressDirtyRef` 抑制误点亮
  （否则 `fromJSON` 会触发 layout 事件、恢复完又亮灯）。

### 真机验证（3080 + agent-browser）

| 项 | 结果 |
| --- | --- |
| 落点变量 | ✓ `--dv-drag-over-background-color: rgba(79,142,247,.22)`、`--dv-drag-over-border-color: #4f8ef7` 已解析生效 |
| 拖拽光标 | ✓ tab `cursor: grab`；sash 悬停变蓝 |
| 区域收起 | ✓ 点「面板区」：4 面板 → 1（只剩辅助侧栏 chat） |
| 区域展开 | ✓ 再点：完整还原 4 面板（快照放回） |
| 保存布局 | ✓ 944B 落盘、按钮熄灯 |
| dirty 提醒 | ✓ 关一个面板 → 按钮亮 `●`「保存布局 ●」 |
| 默认布局 | ✓ 恢复后与保存内容一致、按钮熄灯 |
| 皮肤 | ✓ 选「深蓝」→ dock 背景生效 + 持久化 |

`pnpm check` 全绿；全量测试链 **12 项 ALL PASS**；产物 1,221,952 B。

## Step 13-I（2026-10-12）：参考 info_report 重做外壳 —— 多区布局 + 图标 chrome + ⋯ 菜单

用户两项要求：①界面分成【主侧栏、辅助侧栏、编辑区、面板区、状态栏】；
②标题行/⋯菜单/皮肤**照 info_report 抄作业**。

### 骨架：三个 dockview 实例 + 标题行 + 状态栏

```
┌──────────────────────────────────────────────┐
│ 标题行：[图标] 项目名 │ 已关闭 chips │ 区域键 ⋯ 皮肤 │
├──────────┬──────────────────────┬───────────┤
│ 主侧栏   │ 编辑区（预览/主对话） │ 辅助侧栏  │
│ dockview ├──────────────────────┤ dockview  │
│          │ 面板区（黑板/协作）   │           │
├──────────┴──────────────────────┴───────────┤
│ 状态栏：当前面板 · 面板数 · 锁 · 保存 · 默认  │
└──────────────────────────────────────────────┘
```

- CSS Grid 三行三列（`grid-template-areas`），左右列宽走 `--ts-side-l/-r`。
- **编辑区与面板区共用一个实例**（同 info_report）：面板区「向上扩充」只盖编辑区，
  两侧侧栏不受影响；两者之间的把手是原生 sash。
- **区域收起 = 列宽塌陷到 0**（同 info_report 的 hide-panel），
  **不 removePanel** —— 比上一版「记快照 + 移除」干净得多，面板 DOM 不销毁。
- 跨实例拖拽：`onUnhandledDragOver` accept + `onDidDrop` 搬面板（info_report 同款）。

### 标题行 / ⋯ 菜单 / 状态栏（照抄 info_report）

- 标题行：左边 `[区域图标] 项目名` + 已关闭 chips；右边**图标化**三个区域键 + `⋯` + 皮肤
  （全部走 `iconSvg` 线条图标，不再是一排文字按钮）。
- `⋯` 菜单：每窗口一行（图标 + 名称 + **三个区域按钮**）——点当前所在区 = 收起，
  点别的区 = 搬过去（未打开则打开）；底部「全部打开 / 恢复默认布局 / 关闭菜单」。
- 状态栏：当前面板 · 面板数（打开/关闭）· 锁定 · **保存布局** · **默认布局**。

### 踩坑（真错误，非猜测）

`TypeError: this._watermark.init is not a function` —— 我给的 `createWatermarkComponent`
只返回了 `{ element }`，而 dockview 的组件契约是 `{ element, init(params), dispose() }`
（默认类 `pr` 的实现就是 `init(e){}`）。补上 init/dispose 后外壳正常渲染。

### 真机验证（3080 + agent-browser，零 page error）

| 项 | 结果 |
| --- | --- |
| 三实例 | ✓ left/center/right 各有 `.dv-dockview` |
| 默认摆位 | ✓ chat@center、board/talk/save@center（预览有 devUrl 时落 left） |
| 区域收起 | ✓ 点左区键 → `data-hide-left`、左列宽 **220 → 0**，面板仍在实例里（不销毁） |
| 区域展开 | ✓ 再点 → 左列宽恢复 220 |
| ⋯ 菜单 | ✓ 4 行窗口、每行三区域按钮（当前区高亮）、含「全部打开」 |
| **搬区** | ✓ 菜单里把黑板点去主侧栏 → `board@left`、`apis.left.getPanel` 持有它 |
| 保存布局 | ✓ 1401B 落盘（含三区结构）、按钮熄灯 |
| 默认布局 | ✓ 精确恢复保存时的布局（含 `board@left` 自定义位置）、熄灯 |
| dirty 提醒 | ✓ 关一个面板 → 状态栏按钮亮 `●` |
| 皮肤 | ✓ 选「墨绿/暗红」→ dock 背景生效；**刷新后仍保留**（`desk-skin.v1`） |
| 持久化 | ✓ 刷新后 `desk-saved.v2:p-tokensave` 与皮肤都在（探针验证新版键未被 STALE 清理误删） |

`pnpm check` 全绿；全量测试链 **12 项 ALL PASS**（`check-desk-dock.mjs` 扩到 34 项，
含新增的多区外壳 8 项）；产物 1,236,782 B。

## Step 13-J（2026-10-12）：修三处 —— 去超链接 / ⋯ 定位 / 自由拖动（根因三个）

用户三项反馈。第三项「窗口拖不动」排查出**三个独立根因**，逐一定位（都有实测证据，非猜测）。

### ① 去掉顶部「项目中心」超链接

标题行不再渲染 `data-desk-back`；`onBack` 能力保留但默认不显示。
恢复入口 = 项目中心 tab 本身（原设计如此）。

### ② ⋯ / 皮肤浮动面板定位到右上角

原实现是 `<div>` 无定位信息 → 落在左上角。改为**锚定触发按钮**：
`placePop(anchor, width)` 读按钮 rect，`left = clamp(anchor.right - width)`（右缘对齐）、
`top = anchor.bottom + 6`；未定位时兜底 `{right:12, top:48}`。
实测：⋯ 按钮 rect.right=1240，菜单 rect.right=1254，锚在按钮下方且在视口内。

### ③ 窗口不能自由拖动（三个根因）

用真实鼠标拖拽 + 事件探针逐层排查，依次定位：

**根因 A：`theme.dndOverlayMounting` 未设 → 根级落点容器被禁用。**
读 vendor 源码：`updateTheme()` 里 `switch(dndOverlayMounting) default: rootDropTargetContainer.disabled = true`。
不设它，拖动时**落点浮层永不出现**。→ 加 `dndOverlayMounting: 'absolute'`（外加
`dndPanelOverlay:'group'`、`dndOverlayBorder:'2px solid var(--dv-active-sash-color)'`）。

**根因 B：空实例没有 group，drop 无处可去。**
实测右侧栏 `api.groups.length === 0`：dockview 的落点是**组**，没有组时仅根上有一个
`dv-watermark-container`，drop 落在那里但无人接收（探针实锤：`drop@dv-watermark-container`）。
→ `ensureDropTarget()`：任何没有面板的实例预置一个空组（`addGroup({direction})`），
并在每次 layout 变化后补一次（用户把某区关空时重新有落点）。

**根因 C：跨实例回调放错了位置。**
我最初把 `onUnhandledDragOver` / `onDidDrop` 当**构造选项**传（不生效），
info_report 是创建后用 **运行时 API** 注册。且必须**只 accept 外来载荷**
（无条件 accept 会搅乱同实例的 center 落点判定）。
→ 改为 `apis[r].onUnhandledDragOver(...)` / `apis[r].onDidDrop(...)`，
以 `isForeign = data?.panelId && !api.getPanel(data.panelId)` 为条件 accept。

### 真机验证（3080 + agent-browser，零 page error）

| 项 | 结果 |
| --- | --- |
| 超链接 | ✓ 标题行无 `data-desk-back` |
| ⋯ 定位 | ✓ 锚在按钮下方、右缘对齐、在视口内 |
| **手动拖动** | ✓ 「DSH 主对话」从 center **拖到辅助侧栏** → `chat@right`，`apis.right.getPanel` 持有 |
| **反向拖动** | ✓ 再从辅助侧栏拖回主侧栏 → `chat@left` |
| 空区落点 | ✓ 左/右实例各有 1 个空组（作为落点） |
| 刷新持久化 | ✓ 重载后仍是 `chat@left`（拖动结果写进快照） |
| 落点浮层 | ✓ 拖动中出现 `.dv-drop-target-anchor` |

`pnpm check` 全绿；全量测试链 **12 项 ALL PASS**（desk-dock 扩到 40 项，含本次 6 条新断言）；
产物 1,239,306 B。

## Step 13-K（2026-10-12）：去输入条下的黑覆盖 / 标题行加会话控件

### ① 输入条下面的黑色覆盖

**根因（读宿主 CSS 确认）**：宿主的 `wSkVaW_composerSeat` 自带一条渐变遮罩 ——
`linear-gradient(transparent 0px, rgb(21,21,23) 36px)`，用途是让滚到输入条上沿的消息淡出。
我把输入条 `position:fixed` 停靠进聊天格后，这条**按宿主原位置算高度**的遮罩**跟着一起被搬走**，
于是在聊天区下方留下一块黑（用户看到的"黑色覆盖"）。

**修法（两块）**：
- `composer-dock.ts`：停靠时把 `background` / `backgroundImage` 也纳入接管键，
  写入 `none` / `transparent`（卸载时随其余键一起还原）。
- `DeskDock.tsx`：新增 `.ts-dock-fade` —— 贴在**聊天格底部**的独立渐变条
  （`height: calc(var(--ts-composer-h) + 18px)`，随输入条实测高度自适应），
  **保留了「内容到达输入框上边缘时看不见底下」的能力**，只是位置正确了。

### ② 标题行加【历史会话 / 新建会话】

复用既有 `SessionPicker`（旧工作台用它，HDesk 删除后失去入口），搬到标题行：
- `useProjectSessions(project.path)` 取本项目会话列表（只读）；
- 选择：`rememberOpenedProject(id, project.id)` → `openSession(id)`；
- 新建：`startProjectSession(project.path, project.id)` → 成功后同样记项目记忆；
- 失败信息显示在标题行（`data-desk-session-error`）。

### 真机验证（3080 + agent-browser，零 page error）

| 项 | 结果 |
| --- | --- |
| 黑覆盖消除 | ✓ composerSeat `backgroundImage: none` / `backgroundColor: rgba(0,0,0,0)` |
| 遮挡能力保留 | ✓ `.ts-dock-fade` 在，`linear-gradient(to top, rgba(21,21,23,.94) …)`，高度 124px（跟随输入条） |
| 几何关系 | ✓ 渐变 top=210 覆盖到聊天格底 334，**越过输入条上沿 228**（即上沿以上的滚动内容被遮） |
| 历史会话 | ✓ 标题行控件在位；点开 31 条会话列表（含时间与操作菜单） |
| 新建会话 | ✓ 「＋ 新建会话」在位可点 |

`pnpm check` 全绿；全量测试链 **12 项 ALL PASS**；产物 1,263,648 B。

## Step 13-L（2026-10-12）：浮动面板自动关闭 / 侧栏宽度拖拽 / 菜单与状态栏整理

用户五点反馈，全部照 info_report 口径实现。

### ① 浮动面板点外部自动关闭

⋯ 与皮肤面板打开时挂 document 级 `mousedown`(capture) + `keydown`：
点击目标不在面板内、也不在触发按钮上 → 关闭两者；Esc 同样关闭。
（同 info_report 的 `closePopMenu` 行为。）

### ② 侧栏宽度拖拽（同 info_report 的 `bindSideResizer`）

- 常量照抄：`SIDE_MIN 180` / `SIDE_MAX 720` / **收起阈值 `COLLAPSE_W 56`** / **拉出阈值 `PULL_OUT_W 18`**。
- 两侧各一条把手，贴在自己那条边上；往里拖 = 加宽（delta 按方向取反）。
- **拖到 56 以下整条收起**；**收起后从边框往里拉过 18px 重新展开**
  （拉出时必须把起点重锚到 `SIDE_MIN`，否则当前宽度只有十几像素、立刻又低于阈值 → 表现为「拉一下又弹回」，info_report 注释里记过这个坑）。
- 宽度存 `tokensave:desk-side-w.v1`；收起状态存 `tokensave:desk-regions.v1`。

**三个实测踩到的坑（都有 elementFromPoint 证据）**：
1. 把手放在区域**外侧**（`right:-4px`）→ 被区域的 `overflow:hidden` 裁掉，命中的是区域本身。
   → 区域改 `overflow:visible`，把裁切下放到 `.ts-region-host`。
2. 收起后区域宽 0，把手落在边界外被**中区**盖住（命中的是 `.ts-region`）→ 外移到 `-5px` 并抬 z。
3. 抬到 z=14 仍命不中，因为**宿主停靠的输入条**（z-index 35）浮在那块上方（命中的是 `uV2eYG_root`）
   → 把手 z 抬到 **50/51**（压过 35），并让中区在侧栏收起时让出 8px 命中带。
- 另外：**收起时必须不写内联宽度**（`--ts-side-l`），否则内联优先级压过 `.hide-*` 里的 `0px`，收起不生效。

### ③ 历史会话 / 新建会话移到状态栏右侧

从标题行移到状态栏（仍在右侧组），复用 `SessionPicker`；选择/新建逻辑不变。

### ④ 去重：菜单里的「恢复默认布局」删掉；状态栏两个布局按钮合成一套

- 菜单（⋯）不再有「恢复默认布局」。
- 状态栏改为**「布局」**（点击存为默认，改动时显示 `●`）+ **「恢复」**（恢复默认）。

### ⑤ 菜单头右侧「全部打开」，删掉底部按钮区与「关闭菜单」

`.ts-pop-head` 用 flex `space-between`：标题左、「全部打开」右；底部那三个按钮（全部打开 /
恢复默认布局 / 关闭菜单）整体移除。

### 真机验证（3080 + agent-browser，零 page error）

| 项 | 结果 |
| --- | --- |
| ① 点外部关闭 | ✓ 菜单开着时点页面其它处 → `closedByOutside: true` |
| ② 拖拽调宽 | ✓ 左栏 220 → 299px |
| ② 拖窄收起 | ✓ 拖到阈值下 → `data-hide-left`、左列宽 **0** |
| ② 从边框拉出 | ✓ 收起态把手可命中（z 51 > 输入条 35）→ 拖出后 `hideLeft:false`、宽 252 |
| ③ 会话控件 | ✓ 在状态栏（`sessionInStatusbar:true`）、不在标题行 |
| ④ 去重 | ✓ 菜单无 `data-desk-pop-default`；状态栏「布局 + 恢复」 |
| ⑤ 菜单头 | ✓ `openAllInHeader:true`；无 `data-desk-pop-close`、无「关闭菜单」 |

`pnpm check` 全绿；全量测试链 **12 项 ALL PASS**；产物 1,272,343 B。
（测试期间拖动的宽度/收起状态已复原为 220/260 且未收起。）

## Step 13-M（2026-10-14）：会话控件归位后的七处体验修复

用户一次报了 7 条（前 4 条是上一轮遗留、后 3 条是本轮新发现）。逐条按「根因 → 修法」记。

### ① 点「新建会话」没反应（根因两个，缺一不可）

**根因 A（显示侧）**：`DeskDock` 的 `sid` 旧口径是
`latestProjectSession(...) ?? sessionId` —— **一律取「本项目最近的非空白会话」**，
把宿主注入的当前会话只当兼容兵。于是宿主切到刚新建的空白会话后，工作台仍停在旧
对话上（实锤：`dsh.sessions.current` = 空白会话，工作台显示 msg234）。

**根因 B（创建侧）**：`startProjectSession` 会「复用本项目已有的空白会话」；
状态栏那个「＋ 新建会话」没把**当前会话**排除掉，而复用到的恰好就是当前这条 →
`openSession(自身)` = 什么都没发生。

**修法**：
- `sid`：宿主当前会话属于本项目（且非探索者）就**用它**；否则才回退到
  「本项目最近的非空白会话」；本项目一条会话都没有则回退 **空串**（不再退给宿主
  那条属于**别的项目**的会话）。
- 状态栏新建：`startProjectSession(path, id, sessionId || sid)` —— 排除当前这条。
- `startProjectSession`：`navigated` 标记，两个导航入口都不可用时返回
  `会话导航服务不可用`，不再静默 `ok:true`。

### ② 历史会话浮动面板弹到视口外（用户原话「我改到底部了，面板应该出现在上方」）

会话控件从标题行搬到状态栏后，面板仍按 `top: r.bottom + 6` 向下弹：状态栏
`r.bottom ≈ 576`、视口高 577 → 整块面板在视口之外（实测 `rect.y=582`，`innerH=577`）。

**修法**（SessionPicker）：按**实测面板高度**自动翻转 —— 下方放不下且上方更宽裕就
改为 `bottom: innerHeight - r.top + gap` 向上弹；同时给 `maxHeight`（不超过 60vh 与
可用空间），首帧先 `visibility:hidden`，layout effect 在绘制前写好真坐标。
另：`.ts-sess-pop` 样式表里写死了 `top:calc(100%+6px)`，内联必须显式给 `top:'auto'` 压住它，
只靠不写 top 是无效的。

### ③ 窗口标题的拟物 emoji 全部去掉 + 黑板刷新图标按钮删除

- `💬 DSH 主对话` / `💬 协作对话` / `📊 协作收益` / `📋 共享黑板` / `🔍 探索者` / `🖥 项目预览`
  —— 六个窗口标题里的拟物 emoji 全部删掉（保留文字；探索者窗口标题不再加放大镜）。
- 共享黑板标题行那颗 `🔄` 刷新按钮**整个删掉**（它就是那个 emoji 图标本身）：
  黑板本来每 20s 自动 `load(true)`，不需要手动刷新入口。

### ④ 状态栏实时提示去掉「· 对话已完成」

完成态本来就由左侧那个小圆点表达（`data-done` + `.ts-sb-dot` 由蓝转灰）。
每轮都拼一句相同的话尾只是噪音 → 后缀改为 `gotNotice ? ' · 本轮异常结束' : ''`
（异常结束保留，那有信息量）。**截断长度（42 字）未动**，按用户要求保持原样。

### ⑤ 项目预览拖不到别的区（根因：dockview 只在**空组**上把外来载荷交给我们）

实测（3080 + 注入 `onWillDragPanel/onWillDrop/onDidDrop` 探针）：

| 落点 | 事件 | 结果 |
| --- | --- | --- |
| 空区（侧栏无窗口） | `onDidDrop` 触发 | ✓ 面板搬过去 |
| 已有窗口的内容区 | 只 `onUnhandledDragOver`（已 accept），**`onWillDrop`/`onDidDrop` 永不触发** | ✗ 松手什么都没发生 |

读 vendor 源码定位：落到**面板内容区**时，drop 被那个面板自己的落点接收
（`PanelContainer.onDrop` → 面板级 `_onDidDrop`，**没人监听**）就 return 了，
组的 `handleDropEvent` 根本不跑。空区没有面板，才轮到组 → dockview 的 `onDidDrop`。
所以六类窗口的跨区拖拽一直是坏的，只是「项目预览」最常用到跨区拖拽才先被报出来。

**修法（兜底，与 dockview 自身的处理幂等共存）**：
- 每实例注册 `onWillDragPanel` 记下正在拖的面板 id；
- document 捕获 `dragend`（+ `pointerup` 兼容触摸拖拽）：按松手坐标 `elementFromPoint`
  找到 `[data-desk-host]` → 目标区；面板还在别区就 `moveWindowTo(id, region)`；
  已在目标区（dockview 已经搬过）直接跳过；松手点在工台之外（Esc 取消等）不动作。
- 同区拖动（组内换序 / 分屏）仍由 dockview 自己处理，这条兜底不插手。
- 拖动期间给 `body` 加 `ts-dock-dragging`：`iframe { pointer-events:none }`，
  否则鼠标一进预览 iframe，父文档再也收不到 dragover（落点浮层在 iframe 上方不显示）。

### ⑥ 项目隔离：宿主会话必须与工作台显示的那条一致

宿主的原生输入条（停靠进「DSH 主对话」）**永远属于宿主当前会话**，而工作台显示的是
`sid`。两者不一致时：草稿跟着宿主会话走、发消息也进宿主会话 —— 用户看到的就是
「在 A 项目里写的内容，切到 B 项目后还在输入框里」（容易发错位置）。

**修法**：`DeskDock` 加一条对齐副作用 —— 宿主不在本项目会话上时，
`rememberOpenedProject(sid, project.id)` 后 `openSession(sid)` 切过去；本项目一条
会话都没有时，在本项目下开一条空白会话再切（`autoSessionRef` 只试一次，防循环）。

### 真机验证（3080 + agent-browser）

| 项 | 结果 |
| --- | --- |
| ① 新建会话 | ✓ 点后宿主会话切到空白会话、主对话 `msg0`、选择器显示空白会话、无错误条 |
| ② 浮动面板 | ✓ `rect 690,200,349,348`、`inView:true`、内联 `inset: auto 241.5px 29.5px auto` |
| ③ 窗口标题 | ✓ 六个标题依次为「DSH 主对话 / 协作对话 / 协作收益 / 共享黑板 / 项目预览」，无 emoji |
| ③ 刷新按钮 | ✓ 标题行只剩 `全部/需求/坑/方案/简报` 五个标签 |
| ④ 实时提示 | ✓ 状态栏尾部无「· 对话已完成」（保留 42 字截断） |
| ⑤ 拖动（左→中，中区有窗口） | ✓ `previewRegion: center`（旧版本此步失败） |
| ⑤ 拖动（中→右，空区） | ✓ `previewRegion: right` |
| ⑤ 拖动（右→左） | ✓ 回到 `left` |
| ⑥ 隔离 | ✓ 在 tokensave 输入草稿 → 切到 info_report：宿主会话切到 info_report 会话、输入框**空** |

`pnpm check` 全绿；全量测试链 **12 项 ALL PASS**（desk-dock 扩到 70 项，含本次 8 条新断言）；
产物 1,282,641 B。

## Step 13-N（2026-10-14）：外观与状态的全局化 —— 锁定分项目 / 布局整块存 / 设置合并 / 字体可调

用户又报 5 条，指向同一类问题：**哪些状应当按项目分、哪些应当全局一份、哪些应当一起存**。

### ① 锁定状态改为**按项目分键**

旧实现只有一个 `tokensave:desk-dock-lock.v1` —— A 项目一锁，B 项目打开也是「已锁定」。

**修法**：`LOCK_KEY(projectId)` =`tokensave:desk-dock-lock.v1:<projectId>`；
`readLocked(projectId)` / `disableDnd: readLocked(project.id)` / 按钮写键三处同步；
旧全局单键做**一次性迁移**（首次读某项目时当作它的初值并清掉）。

### ② 保存/恢复布局要控「全局」

旧实现只存三个区的 dockview JSON，收起状态与侧栏宽度另存两个键，而且 `恢复` 里硬
写 `setHiddenRegions([])` —— 于是「存了含有主侧栏收起的布局，一点恢复主侧栏又被拉回来」。

**修法**：快照升级为 `LayoutSnapshot = { regions, hidden, sideW }`（`normalizeSnapshot`
兼容旧格式）；`保存` 存整块，`恢复` 三个一起套用；宽度拖拽落盘也改成写**最终**宽度
（旧代码写的是起始值 `from`，拖完一刷新就回到旧宽度）。
重载时的分工保持清楚：**面板排布**读 SAVED→SNAPSHOT（同旧行为），**收起/宽度**读
REGIONS_KEY / SIDE_W_KEY 这两个「当前状态」键 —— 否则重载会拿「保存的默认」盖掉
用户后来改过的收起状态。

### ③ 侧栏把手换成 info_report 的样式

旧样式是悬停/拖动就铺**一整条**浅色块（用户嫌难看）。改成 info_report 那一套：

| 状态 | 可见物 |
| --- | --- |
| 静止 | 命中区 8px 透明（一无所有） |
| 悬停 / 拖动中 | `::after` 2×40px 中性短杠 → 62px、`rgba(127,127,127,.8)` |
| 收起 | `::before` 4×26px 小短杠（灰，悬停变主题蓝 #4f8ef7）提示「从这里拉出来」 |

### ④ 右上角「⋯ + 皮肤」合并为「设置」齿轮，三块：显示/隐藏窗口 · 皮肤 · **字体**

- 旧的两个浮层（`.ts-pop` / `.ts-skin`）合并成一个 `.ts-set` 浮层（`data-desk-settings-panel`），
  块间一条细分隔线；`data-desk-more` / `data-desk-skin-toggle` / `data-desk-pop` 三个钩子
  退场，换成 `data-desk-settings`（齿轮按钮，图标 `gear`）。
- **字体（新功能）**：字号四档（小/标准/大/特大 = 11.5/12.5/14/15.5px）+ 字族三项
  （默认/黑体/等宽），存 `tokensave:desk-font.v1` / `tokensave:desk-font-family.v1`。
  实现：`applyFont()` 把 `--ts-fs` / `--ts-font` 写到 `:root`（项目中心也要跟着变），
  并把工作台 + 项目中心 CSS 里 **150 条 `font-size:<N>px`** 机械换成
  `calc(var(--ts-fs, 12.5px) * N/12.5)`（一条脚本改完，真机比过两档），
  `font-family` 统一走 `var(--ts-font, inherit)`。插件一加载就套上一次，不留首帧回跳。

### ⑤ 状态栏实时提示不再过早截断

旧实现 `shorten(raw, 42)` 固定截 42 字。现在只压平换行 + 400 字极端兜底，
真正「显示多少」交给 CSS `text-overflow: ellipsis`（区域多宽就显示多少），
完整内容仍在 `title` 悬停提示里。实测：文本 401 字 / 容器 537px / `scrollWidth` 2163 →
可视约 135 字（旧版只能看 42 字）。

### 真机验证（3080 + agent-browser）

| 项 | 结果 |
| --- | --- |
| ① 锁定分项目 | ✓ tokensave 锁定 → `…lock.v1:p-tokensave=1`；切到 info_report 显示「未锁定」且无该项键 |
| ② 收起主侧栏 → 保存 → 展开 → 恢复 | ✓ 恢复后又收起（`data-hide-left`、`regions=["left"]`、`--ts-side-l:0px`） |
| ② 快照形状 | ✓ `{regions:{left,center,right}, hidden:[left], sideW:{left,right}}` |
| ② 宽度落盘 | ✓ 拖 220→319，SIDE_W 写 319（旧版写回 220） |
| ③ 把手静止 | ✓ `.ts-resizer` 背景 `rgba(0,0,0,0)`；`::after` 2×40 透明 |
| ③ 把手悬停 | ✓ `::after` 62px / `rgba(127,127,127,.8)` |
| ③ 收起短杠 | ✓ `::before` 4×26 灰；悬停 `rgb(79,142,247)`；从窄缝拖出 → 展开宽 220 |
| ④ 设置浮层 | ✓ 一个齿轮按钮；三块 `windows/skin/font`；面板 972,115 在视口内 |
| ④ 字体生效 | ✓ 选「特大」→ `--ts-fs:15.5px`、状态栏 11.5→14.26px，`localStorage` 存 `xl` |
| ④ 字族生效 | ✓ 选「等宽」→ `.ts-dock` font-family 变等宽，存 `mono` |
| ④ 窗口开关仍可用 | ✓ 面板里把「共享黑板」放到辅助侧栏 → `board@right`，再移回 center |
| ④ 外部点击 / Esc | ✓ 都能关面板 |
| ⑤ 实时提示 | ✓ 401 字进状态栏，可视约 135 字（旧版 42） |

`pnpm check` 全绿；全量测试链 **12 项 ALL PASS**（desk-dock 扩到 75 项，含本次 12 条新断言）；
产物 1,295,260 B。

## Step 13-O（2026-10-14）：一体化外观 / 项目切换器 / 设置合并 / 探索者设置回归 / 拖拽顺滑

用户一次报了 8 条外观交互问题，另加一条「侧栏拖拽卡顿」（见 ⑨）。

### ① 探索者设置回归 + 搬到右上角

HDesk 删除后 `<ExplorerSettings/>` 失去挂载点（组件还在、没人渲染）——所以「看不到」。
修法：`ExplorerSettings` 加 `variant='icon'`（图标按钮 + 右上角计数徽标），
在标题行右上角渲染 `<ExplorerSettings variant="icon" />`。实测面板照旧分
默认 / 免费 / 收费 三组、116 行可选，位置在视口内。

### ② 窗口标签右键菜单：看不清 / 点不中 / 字体太大 / 关不掉

**根因**：为了跳出面板链路的 `overflow:hidden`（否则菜单在区域边缘被裁），菜单被搬到
`document.body`；但 dockview 的外观全靠 `--dv-*` 变量，搬走后**变量不再继承** ——
实测 `background: rgba(0,0,0,0)`、`font-size: 16px`（回退到 body 默认），
而且 dockview 自己的「点外部关闭」也失效（菜单永远留着）。

修法（两头都补）：
- CSS：`.dv-context-menu[data-ts-hoisted="1"]` 兜底写死外观（深色底、描边、10px 圆角、
  阴影、`font-size: calc(var(--ts-fs) * .96)`、菜单项 26px 高 + 悬停底色）；
- 行为：搬出去时把坐标**夹进视口**；关闭交给我们自己的监听（点外部 mousedown /
  Esc / scroll / resize / blur / 点菜单项后 `setTimeout(0)` 收菜单——先让动作跑完）。

实测：背景 `rgba(14,16,21,.97)`、字 12px、z 120、在视口内；
点外部关、Esc 关、点「最大化」动作生效且菜单自动收。

### ③ 项目名左侧图标改成「项目切换器」

点它弹出浮层，列出「项目中心」里的全部项目（名称 + 路径 + 更新于 + 当前标记），
点一行即进那个项目的工作台。同时按要求删掉项目名后的 `workbench` 与那圈蓝色胶囊
（`styles.ts` 里 H 台时代的 `.ts-title-proj` 徽标样式 + `.ts-proj-locked/unlocked`）。

**顺带修掉一个真根因**：`enterProjectWorkbench` 原先是「先广播信号、再写『上次打开的项目』
记忆」，而 ControlRoom 收到信号时是**按记忆**决定打开哪个项目的 → 在**已经挂着工作台**的
情况下（正是从工作台内切换项目的场景）读到旧记忆，点了没反应。改成**先写记忆再广播**。

### ④ 区域三键：不用蓝色 / 外框，只看图标细节

新增 `regionIconSvg(region, on)`：外框 + 分割线固定，内部那块色块**显示时填充、隐藏时不填充**。
`.ts-tg--region[data-on]` 显式压掉通用 `[data-on]` 的蓝色描边与底色。
实测：显示 `fill="currentColor"`、隐藏 `fill="none"`，按钮自身 border / bg 全透明。

### ⑤ 设置浮层收窄

`.ts-pop.ts-set { min-width: 0 }` + `.ts-set { width: 238px; box-sizing: border-box }`
（box-sizing 很关键：不然 238 + 内边距 + 描边会超出锚点算出的右边缘 6px），
`placePop(..., 238)`。实测宽 238、右 / 下都不溢出。

### ⑥ 状态栏实时提示与右侧会话控件之间留白

`.ts-statusbar .ts-sb-grow { padding-right: 26px }`。实测实时提示右边缘到「历史会话」
左边缘 **36px**。

### ⑦ 一体化：不留区域分界与背景填充

删掉：左右区域的 `border-right/left`、标题行 `border-bottom`、状态栏 `border-top`；
三张面板卡（`.ts-board` / `.ts-talk` / `.ts-save`）的描边 + 圆角 + 半透明底色，
只保留一条很淡的表头下边线分标题与内容（同 info_report 的「靠留白分界」）。

### ⑧ 项目预览默认落在编辑区

- 默认落点从 `left` 改成 `center`，并且**分屏**摆在主对话左边（`buildDefault` 与
  reconcile 的 `ensure` 两处都改）；
- 存量布局一次性归位（键 `tokensave:desk-preview-in-editor.v1:<projectId>`，值 `v2`）：
  旧默认在主侧栏、或旧实现把它当标签页塞进主对话那一组（**把主对话盖住**）的，
  都搬到主对话左边的分屏位。放在 reconcile 里做 —— 挂载时预览面板可能还没建出来
  （devUrl 是轮询拿到的），在挂载时做会白跑一次。
- 顺带补一条兜底：主对话卡**不可见**（被关 / 被同组别的窗口挡住）时给 body 加
  `ts-desk-nochat`，把宿主输入条整条藏掉 —— 否则那条 fixed 的输入条会悬在别的窗口上
  （实测盖在预览上）。

实测：预览 `regionOf=center`、与主对话**不同组**（`sameGroup:false`）、主对话可见。

### ⑨ 侧栏拖拽卡顿 / 拉出迟钝

**根因**：每个 `pointermove` 都 `setSideW` / `setHiddenRegions` → 每帧重渲染整棵工作台
（三个 dockview 实例 + 所有面板），手感就是一顿一顿的。

修法：拖动期间**只写 DOM**（`--ts-side-l/-r` 变量 + `data-hide-*` 属性），
`pointermove` 用 `requestAnimationFrame` 合并（一帧最多一次写入），
**松手时才同步一次 React 状态**（`applyRegions` / `applySideW`）；
松手若 rAF 还没跑（同一帧内快速一甩）补跑一次，避免这次拖动白做。
`PULL_OUT_W` 18 → **12**：收起后再拉出来起步更快。

实测：连续派发 200 个 `pointermove` 只花 1ms（0.006ms/次，等同「不重渲染」）；
同帧内按下即松手也能落到 420px；拖到很窄 `hide=true` + `REGIONS_KEY=["left"]`、
从窄缝拉出 `hide=false` + 宽 255px 且落盘。

### 真机验证（3080 + agent-browser）

| 项 | 结果 |
| --- | --- |
| ① 探索者设置 | ✓ 右上角图标按钮 + 徽标；面板三组 116 行，在视口内 |
| ② 右键菜单外观 | ✓ 深色底 / 12px 字 / z 120 / 在视口内 |
| ② 右键菜单关闭 | ✓ 点外部关、Esc 关、点菜单项（最大化生效）后自动关 |
| ③ 项目切换器 | ✓ 列出项目（名称+路径+更新于+当前）；点 info_report → 真的切过去 |
| ③ 去 workbench/外框 | ✓ 标题只剩项目名，border 0、背景透明 |
| ④ 区域三键 | ✓ 显示 = 内部填充、隐藏 = 不填充；无蓝无框 |
| ⑤ 设置浮层 | ✓ 宽 238，右 / 下都不溢出 |
| ⑥ 状态栏留白 | ✓ 实时提示与「历史会话」之间 36px |
| ⑦ 一体化 | ✓ 区域无分割线、面板卡无底色 |
| ⑧ 预览落编辑区 | ✓ `sameGroup:false`、主对话可见、输入条停靠在主对话格里 |
| ⑨ 拖拽流畅度 | ✓ 200 次 pointermove = 1ms；收起 / 拉出 / 落盘都对 |

`pnpm check` 全绿；全量测试链 **12 项 ALL PASS**（desk-dock 75 项）；产物 1,321,265 B。
