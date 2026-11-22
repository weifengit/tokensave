/**
 * 定位本机的 GitHub CLI（`gh`）可执行文件。
 *
 * ## 为什么需要单独一个模块
 *
 * 用户反馈（Windows）：「本机未安装 gh，无法列出仓库（仍可手动填地址），
 * 但是我在 vscode 中时可以进行仓库管理的，应该是安装过的」。
 *
 * 根因：`execFileSync('gh', …)` 靠 **PATH** 找可执行文件。Windows 上装 GitHub CLI
 * 的默认位置是
 *
 *   C:\Program Files\GitHub CLI\gh.exe
 *
 * 而它**默认不写进系统 PATH**（安装器只在「Add to PATH」勾选时才写）。
 * 于是：
 *   · 用户在终端 / VSCode 里能敲 `gh`（VSCode 继承的是**用户级**环境变量，
 *     安装器常常写进用户级 PATH，而 DSH 桌面端是从**登录前**的进程树起来的，
 *     拿到的是旧的环境变量快照）；
 *   · DSH 服务端进程里 `execFileSync('gh')` 却拿到 **ENOENT** → 报「未安装 gh」。
 *
 * 也就是说：不是「没装」，是「没在 PATH 里找到」。这里按固定安装位置补一次探测，
 * 把「未安装」与「没在 PATH 里」这两种情况区分开。
 *
 * ## 设计约束
 *
 * - **只做探测，不做安装**：找不到就返回 null，调用方给可读文案（用户仍可手填地址）。
 * - **不走 shell**：只用绝对路径调 `execFileSync(cmd, args)`（不经 shell，无注入面）。
 * - **结果缓存**：探测一次即可（安装位置不会在进程生命周期内变），缓存到模块级。
 * - 探测顺序：PATH → 环境变量里的安装目录 → 各平台默认安装位置。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** 探测结果缓存（进程内一次即可）。 */
let cached: { cmd: string | null } | null = null

/** Windows 上 GitHub CLI 的标准安装位置（按优先级）。 */
export function windowsCandidates(): string[] {
  const out: string[] = []
  // 安装器允许改路径；这两个环境变量是官方约定的自定义安装目录。
  for (const key of ['GH_INSTALL_DIR', 'ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']) {
    const base = String(process.env[key] || '').trim()
    if (!base) continue
    if (key === 'GH_INSTALL_DIR') out.push(path.join(base, 'gh.exe'))
    else if (key === 'LOCALAPPDATA') out.push(path.join(base, 'Programs', 'GitHub CLI', 'gh.exe'))
    else out.push(path.join(base, 'GitHub CLI', 'gh.exe'))
  }
  // 没有环境变量时的兜底（系统盘不一定在 C:）。
  const systemDrive = String(process.env.SystemDrive || 'C:').replace(/\\+$/, '')
  out.push(path.join(`${systemDrive}\\`, 'Program Files', 'GitHub CLI', 'gh.exe'))
  out.push(path.join(`${systemDrive}\\`, 'Program Files (x86)', 'GitHub CLI', 'gh.exe'))
  return out
}

/** POSIX 上的常见安装位置。 */
export function posixCandidates(): string[] {
  const home = os.homedir()
  return [
    '/usr/local/bin/gh',
    '/usr/bin/gh',
    '/opt/homebrew/bin/gh',
    '/usr/local/opt/gh/bin/gh',
    path.join(home, '.local', 'bin', 'gh'),
  ]
}

/** 候选可执行文件路径（当前平台）。 */
export function ghCandidates(): string[] {
  const list = process.platform === 'win32' ? windowsCandidates() : posixCandidates()
  // 安装目录也可能在 PATH 的某一段里（但 PATH 已被 execFileSync 覆盖过一次，
  // 这里只是**多找几个目录**，不重复 PATH 本身）。
  for (const key of ['GH_INSTALL_DIR']) {
    const base = String(process.env[key] || '').trim()
    if (base) list.unshift(process.platform === 'win32' ? path.join(base, 'gh.exe') : path.join(base, 'bin', 'gh'))
  }
  return list
}

/** 这个路径是不是一个可执行文件（存在且是文件）。 */
function isExecutableFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * 找到 `gh` 的调用方式。
 *
 * @returns 可直接交给 `execFileSync(cmd, args)` 的命令名；找不到返回 null。
 *   返回的可能是裸名 `gh`（PATH 里有）或绝对路径（按安装位置找到的）。
 */
export function resolveGh(): string | null {
  if (cached) return cached.cmd
  let found: string | null = null
  // ⓪ 显式指定（用户把 gh 装在非常规位置时用；自检脚本也靠它做确定性验证）
  const override = String(process.env.TOKENS_SAVE_GH_PATH || '').trim()
  if (override) {
    cached = { cmd: isExecutableFile(override) ? override : null }
    if (!cached.cmd) {
      console.warn('[dsh-tokensave] TOKENS_SAVE_GH_PATH 指向的文件不存在：', override)
    }
    return cached.cmd
  }
  // ① PATH 里（绝大多数机器走这一支）
  try {
    execFileSync(process.platform === 'win32' ? 'gh.exe' : 'gh', ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    found = process.platform === 'win32' ? 'gh.exe' : 'gh'
  } catch {
    // ② PATH 里没有 → 按常见安装位置找（Windows 的主诉场景）
    for (const cand of ghCandidates()) {
      if (!isExecutableFile(cand)) continue
      try {
        execFileSync(cand, ['--version'], {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore'],
        })
        found = cand
        break
      } catch {
        /* 存在但跑不起来（权限/损坏）→ 继续找下一个 */
      }
    }
  }
  cached = { cmd: found }
  if (!found) {
    console.warn(
      '[dsh-tokensave] 未找到 gh 可执行文件（PATH 与常见安装位置都没有）——' +
        '仓库清单不可用，用户仍可手动填写仓库地址',
    )
  }
  return found
}

/** 测试用：清掉探测缓存。 */
export function resetGhCache(): void {
  cached = null
}
