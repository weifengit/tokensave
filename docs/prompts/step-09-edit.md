# Step 09：高效编辑工具集成

## 前置
Step 08 完成。

## 目标
集成高效编辑工具，让 DSH 执行阶段 token 消耗最小。

## 只看这些
- docs/CONTRACTS.md（跨插件依赖）
- 本文件

## 操作步骤（不写代码，只装插件）

### 1. 首选：哈希锚点编辑
```bash
dsh plugin --profile web add dsh-hashline-edittool
```

核心机制：每一行文件内容获得唯一短锚点。模型编辑时只需发送锚点，
**永远不需要回显旧代码**。编辑经服务端镜像（anchor + content）校验，
行内容已变化时返回 `[E_STALE]` 并附带新鲜锚点。单次调用 = 原子批量，
任何锚点失败则整个调用拒绝，不写入任何内容。

### 2. 备选：apply_patch 编辑
如果 hashline 与现有插件冲突，降级安装：
```bash
dsh plugin --profile web add @anionex/dsh-smarter-edit
```
用 Codex 兼容的 freeform apply_patch 替代原生 edit，模型直接以 diff
形式表达改动，消除 JSON 转义开销和精确字符串匹配失败导致的重试。

### 3. 手动验证
在 DSH 中打开一个测试文件，让模型做一次小编辑。观察输出：
- 如果模型输出中没有回显旧代码，只输出锚点或 diff → 说明生效
- 如果模型仍然输出 old_string/new_string → 检查插件是否被正确加载

## 不要做
- 不要修改 src/ 下的文件
- 不要同时安装两个编辑插件（二选一）

## 验收标准
- [ ] 插件安装成功，无冲突
- [ ] 编辑一个测试文件，模型输出中没有回显旧代码
- [ ] 编辑后文件内容正确

## 完成后
更新 PROGRESS.md：当前阶段改为 Step 10。