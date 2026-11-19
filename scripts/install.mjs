#!/usr/bin/env node
// 一行安装入口：把当前 checkout（或指定路径）注册进 dsh 的 profile。
//
//   dsh plugin --profile web add /path/to/tokensave   ← 单行版（推荐，需先满足构建前置）
//   node scripts/install.mjs --profile all            ← 本脚本：把前置一步做完再装
//
// 本脚本存在的原因：全新 clone 直接 link 安装会**装得上但不生效**。
// 两处静默失败必须在这里补齐（详见 docs/INSTALL.md）：
//   1. dist/client.js 被 .gitignore 忽略 → 客户端半边不注册，界面完全不出现且不报错；
//   2. 没有 node_modules 时构建不了产物 → 所以先 pnpm install 再 build:client。
//
// 设计约定：本脚本只做「编排 + 报告」，探测/构建/装 profile 各在自己的模块里，
// 每步都能单独断言（见 scripts/check-install.mjs）。
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { detectEnvironment } from './install/detect.mjs'
import { checkPnpm, hasDependencies, installDependencies } from './install/dependencies.mjs'
import { ensureArtifact } from './install/build.mjs'
import { installIntoDesktopProfile, installViaCli, verifyProfile } from './install/profile.mjs'
import { printReport } from './install/report.mjs'

/** 插件根目录：本文件在 scripts/ 下一层。 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 命令支持的 profile 目标。`all` = web + 桌面端（桌面端不存在就跳过）。 */
const TARGETS = new Set(['web', 'desktop', 'all'])

/**
 * 解析命令行。
 * @param {string[]} argv 进程参数（不含 node 与脚本名）。
 * @returns {{ profile: string, dryRun: boolean, help: boolean }} 解析结果。
 */
function parseArgs(argv) {
  const options = { profile: 'all', dryRun: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--profile') {
      const value = argv[index + 1]
      if (value !== undefined) {
        options.profile = value
        index += 1
      }
    } else if (arg.startsWith('--profile=')) options.profile = arg.slice('--profile='.length)
  }
  return options
}

/**
 * 给用户打印用法。
 * @returns {void}
 */
function printUsage() {
  process.stdout.write(
    [
      '',
      'tokensave 安装器',
      '',
      '  node scripts/install.mjs [--profile web|desktop|all] [--dry-run]',
      '',
      '  --profile web      只装 dsh web（端口模式）',
      '  --profile desktop  只装 dsh 桌面端（需先在桌面端应用里启动过一次）',
      '  --profile all      两个都装（桌面端 profile 不存在时自动跳过） 默认',
      '  --dry-run          只报告将要做什么，不写任何文件',
      '',
    ].join('\n'),
  )
}

/**
 * 按顺序完成一次安装。
 * @param {{ profile: string, dryRun: boolean }} options 命令选项。
 * @returns {{ ok: boolean, report: object }} 结果与报告数据。
 */
function runInstall(options) {
  const environment = detectEnvironment()
  const report = {
    root: ROOT,
    home: environment.home,
    dryRun: options.dryRun,
    node: environment.node,
    dsh: environment.dsh,
    artifact: null,
    profiles: [],
    skipped: [],
  }

  if (!TARGETS.has(options.profile)) {
    report.profiles.push({ profile: options.profile, ok: false, error: `未知 profile：${options.profile}（支持 web / desktop / all）` })
    return { ok: false, report }
  }

  // 前置条件：Node 版本、dsh、pnpm。任一缺失就停下，不写任何文件。
  if (!environment.node.ok) {
    report.profiles.push({ profile: options.profile, ok: false, error: environment.node.reason })
    return { ok: false, report }
  }
  if (!environment.dsh.ok) {
    report.profiles.push({ profile: options.profile, ok: false, error: '未找到 dsh 命令；请先安装 DeepSeek Harness CLI' })
    return { ok: false, report }
  }
  const pnpm = checkPnpm()
  if (!pnpm.ok) {
    report.profiles.push({ profile: options.profile, ok: false, error: pnpm.error })
    return { ok: false, report }
  }
  report.pnpm = pnpm

  // 决定要装哪些 profile。桌面端目录不存在 = 没装过桌面端，跳过而不是报错。
  const targets = []
  if (options.profile === 'web' || options.profile === 'all') targets.push('web')
  if (options.profile === 'desktop' || options.profile === 'all') {
    if (environment.desktop.initialized) targets.push('desktop')
    else if (options.profile === 'desktop') {
      report.profiles.push({
        profile: 'desktop',
        ok: false,
        error: `桌面端 profile 尚未初始化（${environment.desktop.dir}）：请先打开一次 dsh 桌面端应用，再重跑本命令`,
      })
      return { ok: false, report }
    } else {
      report.skipped.push({ profile: 'desktop', reason: '未检测到已初始化的桌面端 profile' })
    }
  }

  if (options.dryRun) {
    report.artifact = { exists: existsSync(resolve(ROOT, 'dist/client.js')), action: 'dry-run' }
    report.profiles = targets.map((profile) => ({ profile, ok: true, action: 'dry-run' }))
    return { ok: true, report }
  }

  // 第 1 步：依赖。没有它构建不出客户端产物。
  if (!hasDependencies(ROOT)) {
    const installed = installDependencies(ROOT)
    if (!installed.ok) {
      report.profiles.push({ profile: targets.join('+'), ok: false, error: `pnpm install 失败：\n${installed.error}` })
      return { ok: false, report }
    }
  }

  // 第 2 步：客户端产物。缺失时宿主会静默跳过客户端半边，所以这里是硬前置。
  const artifact = ensureArtifact(ROOT)
  report.artifact = { exists: artifact.ok, built: artifact.built, size: artifact.size }
  if (!artifact.ok) {
    report.profiles.push({ profile: targets.join('+'), ok: false, error: `客户端产物构建失败：${artifact.reason}` })
    return { ok: false, report }
  }

  // 第 3 步：逐个 profile 安装。web 走官方 CLI，desktop 直接改它自己的清单。
  let allOk = true
  for (const profile of targets) {
    const target = profile === 'desktop' ? environment.desktop : environment.web
    const result = profile === 'desktop'
      ? installIntoDesktopProfile(target.dir, ROOT)
      : installViaCli(environment.dsh.command, 'web', ROOT)
    const verified = result.ok ? verifyProfile(target.dir, ROOT) : { linked: false, registered: false }
    const ok = result.ok && verified.linked && verified.registered
    if (!ok) allOk = false
    report.profiles.push({
      profile,
      ok,
      dir: target.dir,
      error: ok ? undefined : result.error ?? '安装后校验未通过（依赖或 bundles 未登记）',
      verified,
    })
  }

  return { ok: allOk, report }
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  printUsage()
  process.exit(0)
}

const { ok, report } = runInstall(options)
printReport(report)
process.exit(ok ? 0 : 1)
