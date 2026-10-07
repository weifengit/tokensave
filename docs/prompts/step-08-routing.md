# Step 08：模型路由配置

## 前置
Step 07 完成。

## 目标
配置免费模型 fallback 链，让探索者能用上免费模型。

## 只看这些
- docs/CONTRACTS.md（跨插件依赖）
- 本文件

## 操作步骤（不写代码，改配置文件）

### 1. 确认 dsh-llm-fallbacks 已安装
```bash
dsh plugin --profile web list | grep fallbacks
```

### 2. 编辑 $DSH_HOME/settings.yaml
在文件末尾添加：
```yaml
fallbacks:
  roles:
    free_explorer:
      chain:
        - deepseek-web/free
        - kimi-web/free
        - qwen-web/free
      tail: deepseek-official/deepseek-v4-flash
    executor:
      chain:
        - deepseek-official/deepseek-v4-pro
      tail: deepseek-official/deepseek-v4-flash
```

**注意**：fallback 链的链尾必须是恰好一个官方 V4 模型——
`deepseek-official/deepseek-v4-flash` 或 `deepseek-official/deepseek-v4-pro`
（二选一）。

### 3. 验证每个免费 provider 独立可用
在 DSH 中新建会话，分别测试：
- 用 deepseek-web/free 发一条消息
- 用 kimi-web/free 发一条消息
- 用 qwen-web/free 发一条消息

三个都通了再继续。

### 4. 免费模型接入插件
| 免费模型 | 插件 |
|:---|:---|
| DeepSeek 网页版 | dsh-deepseek-web-login（将 chat.deepseek.com 注册为 LLM Provider） |
| Kimi | dsh-llm-kimi（支持 kimi-code、kimi-cn、kimi-global） |
| Qwen | qwen-web-arwaky（将 chat.qwen.ai 变为可编程自动化引擎） |

## 不要做
- 不要修改 src/ 下的文件
- 不要配置多个 DeepSeek 免费账号（会触发封禁）

## 验收标准
- [ ] settings.yaml 中 free_explorer 链完整
- [ ] 链尾是恰好一个官方 V4 模型
- [ ] 手动测试：用 deepseek-web/free 发一条消息能通
- [ ] 三个免费 provider 都能独立工作

## 完成后
更新 PROGRESS.md：当前阶段改为 Step 09。