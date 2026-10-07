# Step 12：打包与全局安装

## 前置

Step 11 完成。

## 目标

打包插件，安装到 profile，验证跨项目可用。

## 只看这些

- docs/CONTRACTS.md（文件路径约定）
- 本文件

## 操作步骤

### 1. 确认 package.json 完整

```json
{
  "name": "dsh-tokensave",
  "main": "src/index.ts",
  "dsh": {
    "bundle": { "patch": "cordis.patch.yml" },
    "client": "./client/src/index.ts"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*"
  }
}
```

### 2. 本地安装

```bash
dsh plugin --profile web add /absolute/path/to/tokensave
```

### 3. 重启 DSH

```bash
# 停掉当前进程，重新启动
pnpm dsh --profile web
```

### 4. 跨项目验证

在**非 tokensave 目录**（比如一个全新的空目录）新建会话，说：

> "请调用 tokensave 帮我初始化一个 TODO 应用"

观察：

- 探索者浮窗是否出现
- 黑板是否有 pitfall/solution 条目
- DSH 是否收到简报并执行文件创建

### 5. 发布到 npm（可选，暂不发布）

```bash
cd /absolute/path/to/tokensave
pnpm publish
```

之后其他人可以用 `dsh plugin --profile web add dsh-tokensave` 安装。

## 使用方式（给最终用户的说明）

安装后，在任意项目的 DSH 聊天窗口中直接说：

- "请调用 tokensave 帮我初始化这个应用"
- "请调用 tokensave 分析这个 bug 的修复方案"
- "请调用 tokensave 帮我设计新功能的实现路径"

DSH 读取到全局系统提示词中的指令，调用 tokensave_delegate 工具；
工具内部根据 session.header.cwd 自动识别当前场景，完成并行探索和
黑板沉淀，返回简报给 DSH 执行。同时，每个探索者会以独立浮窗形式
出现在界面上，可实时观察它们的对话流。

## 验收标准

- [x] 跨项目可用（在非 tokensave 目录也能调用）（✓ /tmp/tokensave-xproj 空目录新会话自发调用 tokensave_delegate，PROBE PASS）
- [x] 浮窗、黑板、LLM Calls 三层可见性都正常（✓ 黑板 pit/sol 新 scope 写入+归档实测；浮窗 client 半区原生进 boot graph；LLM Calls 以会话日志标记代理，同上）
- [x] DSH 实际执行了文件操作（✓ index.html/app.js/style.css 落盘，turn/end reason=completed）
- [x] 重启 DSH 后插件仍生效（✓ 不带 --patch 连续 5 次启动 web profile 均 [dsh-tokensave] plugin loaded!）

## 完成后

更新 PROGRESS.md：标记全部完成，写一份"发布说明"。
