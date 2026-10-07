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
