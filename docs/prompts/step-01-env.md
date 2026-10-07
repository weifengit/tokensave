# Step 01：环境搭建

## 前置
Step 00 完成，目录骨架存在。

## 目标
验证开发环境可用，安装所有依赖插件，不写业务代码。

## 只看这些
- docs/CONTRACTS.md（末尾"跨插件依赖"清单）
- 本文件

## 操作步骤

### 1. 验证 Node 与 pnpm
```bash
node --version   # >= 18，推荐 ^22.19.0 或 >=24.0.0
pnpm --version   # 最新稳定版
```

### 2. 确认 DSH 源码已就绪
```bash
cd /path/to/deepseek-harness
pnpm install
pnpm dsh --version   # 有输出即可
```

### 3. 安装开发知识库
```bash
dsh plugin --profile web add dsh-plugin-dev-kb
```
该知识库包含官方文档完整镜像和补充开发参考，是 vibecoding 时的"随身文档"。

### 4. 安装所有跨插件依赖
```bash
# 会话通信 + 黑板
dsh plugin --profile web add dsh-call-session

# 模型 fallback 链
dsh plugin --profile web add dsh-llm-fallbacks

# 编辑工具（二选一，推荐 hashline）
dsh plugin --profile web add dsh-hashline-edittool

# 浮窗外壳（必须 >= 0.2）
dsh plugin --profile web add dsh-float-window

# LLM 调用检查
dsh plugin --profile web add dsh-llm-call-inspector

# 免费模型接入
dsh plugin --profile web add dsh-deepseek-web-login
dsh plugin --profile web add dsh-llm-kimi
dsh plugin --profile web add qwen-web-arwaky
```

### 5. 验证插件列表
```bash
dsh plugin --profile web list
```
应该能看到上述所有插件。

### 6. 验证骨架
```bash
cd /path/to/tokensave
pnpm run check
```

## 不要做
- 不要写任何业务逻辑
- 不要修改 src/ 下的文件
- 不要配置 settings.yaml（Step 08 做）

## 验收标准
- [ ] `pnpm dsh --version` 有输出
- [ ] `dsh plugin --profile web list` 能看到 dev-kb 和所有依赖
- [ ] `dsh-float-window` 版本 >= 0.2
- [ ] `pnpm run check` 无错误

## 完成后
更新 PROGRESS.md：当前阶段改为 Step 02。