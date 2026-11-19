# 变更日志

> 本文件由 `scripts/release.mjs` 自动维护：每次发版把 git 提交按
> 「新增/修复/改进/文档」分组追加到顶部。人工补充用 --notes。

## v0.6.2 — 2026-11-19

### 修复
- fix(desk): 去掉皮肤块下方的「跟随系统深浅自动切换」说明行

## v0.6.1 — 2026-11-19

### 修复
- fix(desk): 去掉主题块下方的「与宿主设置同一份偏好」提示

## v0.6.0 — 2026-11-19

### 新增
- feat(desk): 齿轮面板加主题三态（跟随系统/深色/浅色）
- feat(install): 桌面端支持零依赖安装（无需 dsh CLI / pnpm）

### 备注
- 齿轮「设置」面板新增主题三态（跟随系统 / 深色 / 浅色）：与宿主「设置 → 外观」共用同一份偏好，整个 DSH 界面一起切

## v0.5.0 — 2026-11-19

### 新增
- feat(install): 一行命令从源码装好两种模式
- feat(agent-preset): 工作台自带模式选择器 + 启动期清单诊断
- feat(changes-card): 轮末变更卡照搬原生对话 tab（清单 + 增删行数 + 悬浮 diff 预览）
- fix(expset): 面板整块夹在所属侧栏内（宽度占满栏、绝不压进编辑区），border-box 防 padding 撞出栏
- feat(desk): 标题行可放顶部/左侧/右侧（侧置收成 44px 竖轨），浮层落点随位置重算
- Revert "feat(mask): 本地离线文档/对话脱敏 + 侧边栏「脱敏」设置页"
- feat(mask): 本地离线文档/对话脱敏 + 侧边栏「脱敏」设置页
- feat(theme): 背景皮肤覆盖整页（对话/轨迹/项目中心/工作台四个 tab）

### 修复
- fix(install): 安装脚本改名 plugin:install，避开生命周期钩子
- fix(preview): 预览就绪不再被探索者请求和同步扫盘拖慢
- fix(composer-resize): 抓手/重置条跟随输入条座位显隐
- fix(desk): 修设置弹窗隐藏输入条、同组布局被拆栏、加载更早按钮被顶走
- fix(agent-preset): 模式不可用时不渲染 + 可用时右对齐输入框右缘
- fix(composer-status): 运行徽标对齐输入条上方的 dock 面板（任务/目标）
- fix(changes-card): 预览卡 portal 到 body + 视口内摆位 + 正确的开合生命周期
- fix(composer-status): 徽标出现时消息流多让位，不再压住最新回复
- fix(composer-status): 运行徽标左对齐可见输入卡并跟随宽度调节
- fix(expset): 接口网络层失败按退避自动重试（0.8s 起翻倍 3 次）+ 切回标签页/网络恢复再试，错误改成人话并保留原文
- fix(expset): 面板落点照抄齿轮设置面板（共用 popPlacement），改 300 固定宽 + 72vh + 内嵌细滚动条，删除挤成一团的紧凑版式
- fix(expset): 面板作为侧栏内容区里的卡片呈现——从标签条下方开始、窄栏换紧凑版式、窄到 150 也夹在栏内
- fix(expset): 探索者设置面板落点跟随按钮并夹在视口内，加载失败改用本地快照+重试（不再 Failed to fetch 白屏）
- fix(theme): 皮肤覆盖层不再把宿主「设置」浮层透明掉
- fix(startup): 探索者链路的常规日志静默
- fix(startup): 收敛启动期控制台输出

### 改进
- perf(install): 产物已随源码时跳过依赖安装，装完不再依赖网络

### 其他
- chore(auto): 会话第 4 轮结束自动提交 1 个文件（src/prompt/system-prompt.ts）
- chore(auto): 会话第 20 轮结束自动提交 4 个文件（client/src/panel/MsgList.tsx、client/src/panel/styles.ts、package.json…）
- chore(auto): 会话第 13 轮结束自动提交 4 个文件（client/src/panel/ControlRoomEntry.tsx、client/src/panel/MsgList.tsx、client/src/panel/composer-dock.ts…）
- test(chat-scroll,agent-preset): 补「回到最新」与模式清单超时的断言
- chore(auto): 会话第 16 轮结束自动提交 2 个文件（client/src/panel/MsgList.tsx、client/src/panel/agent-preset-chip.tsx）
- test(composer-status): 自检脚本同步 composer-status 改名 .tsx（含 JSX，esbuild entryPoints 与源码断言路径）
- chore(auto): 会话第 7 轮结束自动提交 4 个文件（scripts/check-composer-resize.mjs、scripts/check-composer-status.mjs、scripts/check-turn-edits.mjs…）
- chore(auto): 会话第 6 轮结束自动提交 13 个文件（client/src/composer-resize.ts、client/src/panel/ControlRoomEntry.tsx、client/src/panel/MainChat.tsx…）
- chore(auto): 会话第 3 轮结束自动提交 4 个文件（client/src/panel/DeskDock.tsx、client/src/panel/ExplorerSettings.tsx、client/src/panel/pop-anchor.ts…）

### 备注
- 安装器支持桌面端零依赖安装；修 CHANGELOG 头部重复累积

## v0.4.0 — 2026-10-25

### 新增
- feat(auto-commit): 会话轮次结束自动提交（agent/turn-stopping）
- ``` feat(client): 修复移动端预览和音频同步问题
- ``` feat(panel): 统一跨端提示音停止机制并修复探索者归属问题
- feat(panel): 提示音跨端同步、移动端 sheet 布局与项目卡片状态翻牌
- ``` feat(tokensave): 添加项目移除墓碑机制和删除源代码功能

### 改进
- ``` refactor(explorer): 移除已废弃的 deepseek-web provider 相关配置

## v0.3.2 — 2026-10-18

### 修复
- 修复发出去的消息看不见：新会话流失败自愈重试 + 忙时排队消息折叠显示

### 备注
- 两个根因：① 会话流只在首次订阅时打开一次，新会话 binding 未物化时三源全失败后通道永久停在空列表——加 streamState + 退避定时器/目录变化双路重试；② 会话忙时发的消息先进宿主收件箱队列（agent/inbox/spliced 事件），下一轮才成为 user/message——折叠成带「排队中」标的弱化气泡挂在流末尾，消费后自动转正不重复

## v0.3.1 — 2026-10-18

### 修复
- 修复停靠输入条浮在所有窗口之上常显、以及主对话面板被重挂后输入条留在旧坐标

### 文档
- 更新readme文档

### 备注
- 输入条停靠改为候选集+双门判定：面板隐藏/被盖时输入条跟着藏，dockview 重挂面板后按稳定选择器回查活节点跟到新坐标；补两条回归断言并同步旧断言到新签名

## v0.3.0 — 2026-10-16

### 新增
- 改进：添加项目图标改用线条风格，并支持从我的 GitHub 仓库清单直接选择

### 备注
- 「从 GitHub 克隆」新增仓库清单：直接列出你 GitHub 账号下的仓库（含私有，走本机 gh 登录态）按最近推送排序，可搜索、显示语言与描述，点选即填地址；来源按钮与标题的 emoji 图标全部换成与工作台统一的线条图标

## v0.2.0 — 2026-10-16

### 新增
- 新增：项目中心支持从 GitHub 克隆项目（公开/私有仓、实时进度）

### 修复
- chore: 删除 PROGRESS.md 与 docs/README.md，冻结记录收纳进 CONTRACTS 并修正引用

### 文档
- 删除无用文档
- chore: 删除 docs/CONTRACTS.md，冻结规则与环境提醒收纳进 MAINTENANCE，契约以代码注释为唯一权威源
- chore: 清理开发残留文件与过期文档（.ab2/.abhome CDP 沙箱、.DS_Store、tests 空目录、孤儿自检脚本、step-00~12 提示词、PROGRESS 逐步实录瘦身）

### 其他
- chore: 从版本库剔除误提交的 .ab2 Chrome 缓存二进制

### 备注
- 项目中心的「添加项目」新增从 GitHub 克隆：支持公开与私有仓库（走本机 gh 登录态，凭据经 URL 限定的环境变量注入、不进 argv 也不落盘），实时显示克隆阶段与进度，克隆完成即可加入项目

## v0.1.0 — 2026-10-16

### 新增
- 修复主对话滚动丢失与加载更早跳顶，切换项目按对话更新时间排序，新增发版自动化与 README

### 修复
- 修复界面侧栏收缩、状态栏遮挡下层页面内容
- 修复对话遮挡问题
- 跑马灯面板布局问题解决
- 跑马灯修复
- 修复添加项目目录选择：Windows 盘符根下重命名的父目录规范化
- 修复界面消失
- 依赖修复2
- 依赖修复
- 修复回复显示问题

### 改进
- 深浅色主题适配切换问题
- 界面布局优化
- 继续优化界面
- 提示音优化
- 优化左侧边栏跑马灯浮动面板，加入音效通知设置
- 界面优化2
- 界面优化

### 其他
- 对话框透明效果
- 项目界面布局改用dockview
- 左侧边栏默认为收起状态
- 项目初步完成20261011
- 任务清单处理1
- 后台提示音问题
- 提示音问题
- 插件依赖去除黑板会话等他人插件
- 左侧边栏跑马灯浮动面板整合加强
- 一键继续按钮
- 完成提醒与定位
- 中断提醒与定位
- 标题行与闪屏滚动探索者设置等
- 项目中心新会话跳转工作台实现
- 界面美化9
- 界面美化8
- 界面美化7
- 界面美化6
- 界面美化5
- 界面美化4
- 界面美化3
- 界面美化2
- 界面美化1
- chore: 初始化仓库，忽略 node_modules/dist/.DS_Store

### 备注
- 首次开源发布准备：新增 README 与维护约定文档，版本号/变更日志改为脚本自动维护
