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
