#!/usr/bin/env node
// 安装器自检：钉住「一行安装」必须成立的那几条事实。
// 纯断言、不需要真跑安装（真实的端到端安装见 docs/INSTALL.md 的手工步骤），
// 因为安装会写用户 home、耗时几十秒，不适合放在 pnpm test 里。
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

/**
 * 断言 helper：失败时收集，不在第一个错误处中断（一次跑完看全部问题）。
 * @param {boolean} condition 断言条件。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function check(condition, message) {
  if (!condition) failures.push(message)
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

// 1. dsh 包必须是 peerDependencies —— link 安装下宿主的 peer 拦截只认这个声明，
//    写在 dependencies 里会导致插件 import 失败（failed to import）。
for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-brand']) {
  check(pkg.peerDependencies?.[name] !== undefined, `peerDependencies 缺少 ${name}（link 安装会解析失败）`)
  check(pkg.dependencies?.[name] === undefined, `${name} 不应出现在 dependencies（会被 pnpm 装成独立副本并解析失败）`)
}

// 2. 客户端产物必须是导出的一部分，且声明在 dsh.client 里。
check(pkg.exports?.['./client'] === './dist/client.js', 'exports["./client"] 必须是 ./dist/client.js')
check(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform 必须是 web')
check(pkg.dsh?.bundle?.patch !== undefined, 'dsh.bundle.patch 必须声明（否则 profile 不会挂载该层）')

// 3. dist/client.js 必须能随源码分发（被 .gitignore 反忽略），否则全新 clone 客户端半边是死的。
const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
check(/^!dist\/client\.js$/m.test(gitignore), '.gitignore 必须含 "!dist/client.js"（否则产物不随源码分发）')
check(existsSync(join(ROOT, 'dist', 'client.js')), 'dist/client.js 不存在：先跑 pnpm build:client')

// 4. 安装脚本本体与入口必须在。
for (const file of ['scripts/install.mjs', 'scripts/install/detect.mjs', 'scripts/install/build.mjs', 'scripts/install/profile.mjs', 'scripts/install/dependencies.mjs', 'scripts/install/report.mjs']) {
  check(existsSync(join(ROOT, file)), `缺少安装模块 ${file}`)
}
check(pkg.scripts?.['plugin:install'] !== undefined, 'package.json 缺少 scripts["plugin:install"]')
// "install" 是 npm/pnpm 的生命周期钩子名：叫这个名字会被依赖安装顺带触发，
// 而安装脚本自己又要跑 pnpm install —— 两者巧到一起就是递归。
check(pkg.scripts?.install === undefined, 'scripts.install 是生命周期钩子名，会随 npm/pnpm install 触发；用 plugin:install')

// 5. 桌面端只能改它自己的清单，不能走 `dsh plugin --profile desktop`（CLI 会拒）。
const profileSource = readFileSync(join(ROOT, 'scripts/install/profile.mjs'), 'utf8')
check(profileSource.includes('installIntoDesktopProfile'), 'profile.mjs 必须提供桌面端专用安装路径')
check(!/installViaCli\([^)]*'desktop'/.test(profileSource), 'web 的 CLI 安装路径不应被复用到 desktop')
// 6. 桌面端必须能在「没有 dsh CLI / 没有 pnpm」的机器上装：只装了 Electron
//    桌面端的机器两者都没有，而宿主解析 bundle 只需 node_modules 里有链接。
check(profileSource.includes('symlinkSync'), '桌面端必须用符号链接落地，不能依赖 pnpm install')
check(!/execFileSync\('pnpm'/.test(profileSource), 'profile.mjs 不应再调 pnpm（桌面端要零外部依赖）')
const installSource = readFileSync(join(ROOT, 'scripts/install.mjs'), 'utf8')
check(
  !/if \(!environment\.dsh\.ok\) \{\s*\n\s*report\.profiles\.push/.test(installSource),
  'dsh CLI 不能作为全局前置：桌面端不需要它，否则只装桌面端的机器直接卡死',
)

if (failures.length > 0) {
  console.error('[check-install] FAIL')
  for (const message of failures) console.error(`  ✗ ${message}`)
  process.exit(1)
}
console.log('[check-install] OK')
