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

## Step 列表

| Step | 文件                 | 产出物            | 状态 |
| :--- | :------------------- | :---------------- | :--- |
| 00   | step-00-framework.md | 目录骨架 + 空实现 | ✅   |
| 01   | step-01-env.md       | 环境验证通过      | ✅   |
| 02   | step-02-scaffold.md  | 插件可加载        | ✅   |
| 03   | step-03-prompt.md    | 系统提示词注入    | ✅   |
| 04   | step-04-scenario.md  | 场景识别函数      | ✅   |
| 05   | step-05-tool.md      | 工具注册成功      | ✅   |
| 06   | step-06-parallel.md  | 并行探索可用      | ✅   |
| 07   | step-07-board.md     | 黑板读写可用      | ✅   |
| 08   | step-08-routing.md   | 模型路由配置      | ✅   |
| 09   | step-09-edit.md      | 编辑工具集成      | ✅   |
| 10   | step-10-workflow.md  | 编排引擎完整      | ✅   |
| 11   | step-11-float-ui.md  | 浮窗显示探索者    | ⬜   |
| 12   | step-12-package.md   | 打包安装成功      | ⬜   |

## 使用规则（每次 vibecoding 前必读）

1. 每次只让智能体读一个 step 文件 + CONTRACTS.md
2. 每步完成后必须更新 PROGRESS.md
3. 接口改动必须先改 CONTRACTS.md，再改实现
4. 不要跳过 Step 00，框架不稳后面必崩
5. 开场白模板："按 docs/prompts/step-XX.md 实现，先读 CONTRACTS.md
   确认接口，完成后更新 PROGRESS.md。不要读其他 step 文件。"

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
