# 维护与发版约定

> 本文件是给**后续维护者（包括 AI）**看的操作手册。目标：修完 bug / 做完功能后，
> 版本号与变更日志**自动**跟上，不需要用户提醒。

## 铁律（每次改完代码都要走）

1. **改行为必须同步改断言。** `scripts/check-*.mjs` 是对源码做正则断言的文本测试，
   它们会把旧写法「钉住」：改了行为却没改断言，`pnpm test` 必 FAIL。
   新增的用户可见行为，尽量补一条断言进去（回归护栏）。
2. **客户端源码改动必须重建。** `pnpm build:client` 重建 `dist/client.js`；
   源码改动不热重载，产物不刷新 = 用户看到的还是旧行为。
   判断「修了没生效」先对 `dist/client.js` 的 mtime。
3. **收尾必发版。** 确认 `pnpm check` + `pnpm test` 全绿、产物已重建后，执行：

   ```bash
   pnpm release patch   # 修 bug
   pnpm release minor   # 新功能 / 用户可见的界面改进
   pnpm release major   # 破坏性变更（改配置结构、删功能、迁移数据格式）
   ```

   脚本自动完成：semver 递增 → 收集上个 tag 以来的提交按「新增/修复/改进/文档」
   分组写入 CHANGELOG.md → git commit `release: v<x.y.z>` + 打同名 tag。
   需要人工补充上下文时加 `--notes "一句话"`。

## 档位怎么选（AI 判断标准）

| 本次改动 | 档位 |
| --- | --- |
| 只修 bug、改样式细节、文案调整 | patch |
| 新功能、新面板、用户可见的交互改进 | minor |
| 配置/数据格式不兼容、删除或重命名功能 | major |

一次改动同时含修复和功能 → 按 minor（功能为主）。

## commit 规范（变更日志的质量取决于它）

- 一句话、动词开头、说清「改了什么」：`修复切 tab 后主对话滚动位置丢失`；
- 变更日志正文直接取自 commit 标题，所以不要写 `fix` `wip` `tmp` 这类空标题；
- 纯文档/杂务用 `docs:` / `chore:` 前缀（会被归进「文档/其他」组）。

## 目录速查

| 路径 | 内容 |
| --- | --- |
| `client/src/panel/` | 工作台前端（React）：DeskDock 布局、MsgList 主对话、主题、样式 |
| `src/` | 插件服务端（cordis）：tokensave_delegate 工具、编排、黑板 |
| `scripts/check-*.mjs` | 自检断言（纯文本，不需要浏览器） |
| `scripts/build-client.mjs` | esbuild 打包客户端 → dist/client.js |
| `scripts/release.mjs` | 版本递增 + CHANGELOG + tag |
| `src/types.ts` / 各模块头注释 | 接口契约的唯一权威源（原 docs/CONTRACTS.md 已于 2026-10-16 删除，内容均为代码镜像或已过时） |

> 开发进度不再单独维护 PROGRESS.md：版本与变更以 `CHANGELOG.md` + git 历史为准。
> 架构/功能介绍见仓库根 `README.md`；`docs/prompts/step-13-dockview.md` 是 dockview 方案笔记（保留）。

## 接口冻结与环境提醒（原 docs/CONTRACTS.md 收纳，2026-10-16）

- **tokensave_delegate 输入/输出 schema 已冻结**（与 src/types.ts 的 DelegateInput/Output 一致：
  task_description 必填 / file_path 可选 / explorer_count 默认 3；输出 brief+scenario 双必填），不得单方面修改；
  接口类改动先改 types.ts + 本文档，再改实现（旧规则「先改 CONTRACTS.md」作废）。
- **EXPLORER_PRESETS 三槽经用户确认冻结**（当前值见 src/orchestration/parallel-explorer.ts）；
  用户可在工作台探索者设置里改选择，但预设本体改动需再次经用户确认。
- 仍有效的环境提醒：dsh-llm-call-inspector 激活失败（LLM Calls 视图不可用）；
  dsh-call-session@0.1.6 消息投毒（v4 拒 source.kind='plugin'，tokensave 已改 createUserMessage 直投绕过，不再依赖其消息路径）；
  opencode-zen 免费档凭据（OPENCODE_API_KEY）未配置。
- 黑板契约的语义对齐清单（TTL/工作区隔离/FIFO/保留主题拦截等）以 src/blackboard/store.ts
  头注释为唯一权威源；旧 CONTRACTS.md 中与之不同的表述均属过时。

## 排错备忘（历史踩坑）

- 宿主元素 class 是 hash 名（随版本变），选择器一律用稳定属性
  （`[data-composer-card]`、`button[aria-haspopup="listbox"]`）；
- 不覆盖宿主共享 token（如 `--dsw-alias-interactive-bg-hover-solid` 被十几处共用）；
- 改「装饰性外观」别顺手删功能性的辨识元素（外框/边界）；
- 项目中心列表时间类排序优先用真实文件 mtime（`fetchProjectInfo`），本地记录只作回退。
