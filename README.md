# tokensave

**DSH（DeepSeek Harness）工作台增强插件** —— 把 DSH 的对话界面升级成多项目工作台：项目中心、可停靠面板、深浅主题、token 用量可视化，以及一套「免费模型探索者」并行探索链路，帮你省 token。

> 安装后打开工作台即可使用，无需配置。各功能的详细用法见后续发布的功能讲解视频。

## 功能一览

- **项目中心**：把常用代码目录登记成项目，卡片式管理，活跃对话 ①②③ 序号点一眼可见。
- **工作台（dockview 布局）**：主对话、预览、探索者浮窗各自成格，可拖拽重排；「保存/恢复布局」整块存取。
- **主题与外观**：深/浅色全局一份，皮肤、字体（字号档位 + 字族）集中在一个齿轮入口里调。
- **输入条适配**：停靠的原生输入条与工作台配色一致，悬停、聚焦不突兀。
- **主对话体验**：
  - 贴底跟随 + 上滚闩锁（流式输出不打扰阅读）；
  - 切换 tab 再回来，滚动位置原样保持；
  - 「加载更早」瀑布式回翻：新内容从顶部生长，**正在看的内容原地不动**。
- **切换项目**：按「最近对话更新时间」排序，最活跃的项目排最前。
- **tokensave 探索链路**：任意会话说「请调用 tokensave」，自动并行派发免费模型探索者（各挂浮窗）→ 共享黑板沉淀 → 交叉验证 → 简报回主对话执行。

## 安装

```bash
# DSH profile 目录下链接本插件（开发模式）
ln -s /path/to/tokensave ~/.dsh/profiles/web/dsh-tokensave
# 重启 dsh web 后生效
```

开发改动客户端代码后需要重建：

```bash
pnpm build:client   # 重建 dist/client.js，刷新页面生效（源码改动不热重载）
```

## 开发

```bash
pnpm install
pnpm check          # TypeScript 类型检查
pnpm test           # 全量自检（scripts/check-*.mjs，纯文本断言，不需要浏览器）
pnpm build:client   # 构建客户端产物
```

## 版本与发布

版本号由脚本自动递增，不需要手改 `package.json`：

```bash
pnpm release patch   # 修 bug / 小调整 → 0.0.x
pnpm release minor   # 新功能 / 用户可见改进 → 0.x.0
pnpm release major   # 破坏性变更 → x.0.0
```

脚本会自动：递增版本 → 收集上个 tag 以来的 git 提交、按「新增/修复/改进」分组写入 `CHANGELOG.md` → 提交并打 `v<x.y.z>` tag。可选 `--notes "补充说明"` 追加人工备注。

维护约定（含 AI 自动发版规则）见 [docs/MAINTENANCE.md](docs/MAINTENANCE.md)。

## 许可

见 [LICENSE](LICENSE)。
