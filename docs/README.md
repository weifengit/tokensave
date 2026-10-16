# tokensave 开发导航

## 项目定位

全局注册的 token 节省能力基础设施。安装到 DSH profile 后，在任意项目
的会话中说"请调用 tokensave"即可触发多智能体并行探索 + 黑板沉淀 +
DSH 执行。每个免费模型探索者挂独立浮窗，可实时观察。

## 架构一句话

系统提示词引导 DSH 调用 → tokensave_delegate 工具 → 并行派发免费探索者
（各挂浮窗）→ 共享黑板 → 交叉验证 → 简报回 DSH 执行。

```
用户消息
   ↓
全局系统提示词段（tokensave 注入）
   ↓
DSH 主会话 → tokensave_delegate
   ↓
┌─ tokensave 插件 ────────────────────┐
│ 场景识别 → 并行调度 → 黑板管理 → 浮窗管理 │
└──────────────────────────────────┘
   ↓ 并行派发
┌─ 免费模型层 ─────────────────────┐
│ DeepSeek / Kimi / Qwen（各挂浮窗） │
└────────────────────────────────┘
   ↓ 黑板沉淀
交叉验证 → 任务简报 → DSH 执行
```

## 核心设计原则

- 全局注册，跨项目可用（挂在 profile 的 cordis.patch.yml）
- 系统提示词引导调用（ctx.systemPrompt.section）
- 自动场景识别（session.header.cwd）
- 并行探索 + 共享黑板（dsh-call-session）
- 浮窗可观测（dsh-float-window >= 0.2）
- 不绑定 worktable

## 文档地图（维护期）

| 文件 | 用途 |
| :--- | :--- |
| `MAINTENANCE.md` | 维护铁律：改断言、重建产物、收尾发版、commit 规范、排错备忘 |
| `CONTRACTS.md` | 宿主接口契约实测记录（接口改动先改这里再改实现） |
| `PROGRESS.md` | 进度概览 + 接口冻结 + 已知问题 + 发布说明（逐步实录已删，勿再追加长篇） |
| `prompts/step-13-dockview.md` | dockview 布局方案的参考笔记（代码注释有引用，保留） |

> 历史 step-00~12 任务提示词是一次性开发档案，已于 2026-10-16 删除（全文见 git 历史）。

## 使用规则（改代码前必读）

1. 先读 `MAINTENANCE.md`（铁律 + 目录速查），接口相关再读 `CONTRACTS.md`。
2. 不要通读 `PROGRESS.md` 全文，只查「接口冻结记录」与「已知问题」两段。
3. 接口改动必须先改 CONTRACTS.md，再改实现。
4. 客户端改动后必须 `pnpm build:client`；收尾必跑 `pnpm release <档位>`。

## 依赖插件清单

| 功能                     | 插件名                    |
| :----------------------- | :------------------------ |
| 会话通信+黑板            | dsh-call-session          |
| 模型 fallback 链         | dsh-llm-fallbacks         |
| 哈希锚点编辑             | dsh-hashline-edittool     |
| apply_patch 编辑（备选） | @anionex/dsh-smarter-edit |
| 开发文档知识库           | dsh-plugin-dev-kb         |
| 浮窗外壳                 | dsh-float-window (>= 0.2) |
| LLM 调用检查             | dsh-llm-call-inspector    |
| DeepSeek 网页版免费      | dsh-deepseek-web-login    |
| Kimi                     | dsh-llm-kimi              |
| Qwen                     | qwen-web-arwaky           |
