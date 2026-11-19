# 安装

面向**从 git 下载源码**的用户。装完就能用，不需要读源码、不需要手改配置。

## 一行安装

```bash
git clone https://github.com/weifengit/tokensave.git && cd tokensave && node scripts/install.mjs
```

默认 `--profile all`：装 dsh web（端口模式）；桌面端 profile 存在时一并装，不存在则跳过。

也可以让 dsh 自己装（等价，但少做几步前置，见下节）：

```bash
dsh plugin --profile web add /path/to/tokensave
```

## 前置条件

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node | ≥ 22 | 插件入口是 TypeScript，靠 Node 的类型剥离直接加载 |
| pnpm | ≥ 10 | 装依赖、构建客户端产物 |
| dsh | 0.2.0-rc.2 系列 | `npm i -g @deepseek-ai/dsh` |

## 参数

```bash
node scripts/install.mjs --profile web        # 只装 dsh web
node scripts/install.mjs --profile desktop    # 只装桌面端
node scripts/install.mjs --profile all        # 都装（默认）
node scripts/install.mjs --dry-run            # 只报告，不写文件
```

等价的 pnpm 脚本：`pnpm install`（注意这里的 `install` 是本项目的安装脚本，不是安装依赖）。

## 为什么不能「下载后直接选文件夹安装」

这是一个**源码插件**：入口是 `src/index.ts`，客户端是 `client/src/**`。全新 clone 直接 link 安装会**装得上但不生效**，有两处静默失败：

1. **`dist/client.js` 缺失** —— 客户端产物被 git 忽略过，没有它宿主会跳过客户端半边：工作台界面完全不出现，**且不报任何错**。安装器会先 `pnpm install` 再 `pnpm build:client` 补上。
2. **dsh 包声明位置** —— 这些包必须是 `peerDependencies`。写在 `dependencies` 里时，link 安装下宿主的 peer 拦截不认它，插件 import 直接失败（启动日志里是 `dsh-tokensave (dsh-tokensave): failed to import`）。

`pnpm test:install` 会把上面两条钉死，防止回归。

## 装到了哪里

| 目标 | 位置 | 机制 |
| --- | --- | --- |
| web | `~/.dsh/profiles/web/` | `dsh plugin --profile web add <目录>`，dsh 自己维护依赖与 bundles |
| 桌面端 | `~/.dsh/profiles/desktop/` | 直接改该 profile 的清单并跑 `pnpm install`（CLI 拒绝管理 desktop） |

桌面端 profile 由 Electron 应用独占：`dsh plugin --profile desktop ...` 会被直接拒绝
（`profile "desktop" is managed exclusively by the Electron application`）。
所以安装器改它的清单前会先备份为 `package.json.bak-tokensave-install`，任何一步失败都回滚。

`$DSH_HOME` 会覆盖 `~/.dsh`，安装器与 dsh 使用同一套解析规则。

## 安装后

```bash
dsh web        # 启动端口模式
```

桌面端直接打开应用即可。卸载：

```bash
dsh plugin --profile web remove dsh-tokensave
```

桌面端在应用的插件管理里移除。

## 常见问题

**安装显示成功，但界面没有工作台**

对一下 `dist/client.js` 是否存在、以及页面里有没有 `dsh-tokensave` 这条 client 入口。缺失时执行：

```bash
node scripts/build-client.mjs
```

然后刷新页面。这是唯一一类「装上了但看不见」的故障。

**启动日志出现 `failed to import`**

检查 `package.json` 的 `peerDependencies` 是否含 `@deepseek-ai/dsh-tools` / `dsh-llm` / `dsh-brand` / `cordis`，以及 `dependencies` 里没有它们。

**桌面端提示 profile 尚未初始化**

先在桌面端应用里启动一次，让它建好 `~/.dsh/profiles/desktop/`，再重跑安装器。

**改了源码要不要重装**

不用。装的是 link，源码即生效，但**重启 dsh web**；客户端改动要 `node scripts/build-client.mjs` 后刷新页面。
