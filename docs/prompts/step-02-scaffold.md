# Step 02：脚手架配置

## 前置
Step 01 完成，所有依赖插件已安装。

## 目标
让插件能被 DSH 加载，控制台打印加载日志，不实现功能。

## 只看这些
- docs/CONTRACTS.md（文件路径约定）
- 本文件
- src/index.ts

## 操作步骤

### 1. package.json 补齐字段
```json
{
  "name": "dsh-tokensave",
  "main": "src/index.ts",
  "dsh": {
    "bundle": {
      "patch": "cordis.patch.yml"
    },
    "client": "./client/src/index.ts"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*"
  }
}
```

**关键**：`dsh.client` 声明客户端入口，宿主的 Node 半区会扫描带 `dsh.client` 的包，把 `./client` 编进 `window.__DSH_BOOT__`，以 `/plugins/<id>/client.js` 形式提供。

### 2. cordis.patch.yml 内容
```yaml
- insert:
    - id: dsh-tokensave
      name: '/absolute/path/to/tokensave/src/index.ts'
```
把 `/absolute/path/to/` 替换为你的实际绝对路径。

### 3. src/index.ts 的 apply 内加一行日志
```typescript
export function apply(ctx: Context) {
  console.log('[dsh-tokensave] plugin loaded!')
  // 其他 TODO 保留
}
```

### 4. 启动调试
```bash
cd /path/to/deepseek-harness
pnpm dsh --profile web --patch /absolute/path/to/tokensave/cordis.patch.yml
```

## 不要做
- 不要注册工具
- 不要注入系统提示词
- 不要碰 client/ 下的文件（虽然 package.json 已声明入口，但客户端代码在 Step 11 才实现）

## 验收标准
- [ ] Web UI 在 http://127.0.0.1:3080 启动
- [ ] 终端打印 `[dsh-tokensave] plugin loaded!`
- [ ] 浏览器控制台无报错
- [ ] `dsh --profile web dump` 能看到 dsh-tokensave 的配置行

## 完成后
更新 PROGRESS.md：当前阶段改为 Step 03。