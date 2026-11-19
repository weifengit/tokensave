// 安装环境探测：只回答「这台机器上有什么」，不做任何修改。
// 独立成模块，是因为探测逻辑要在 cli 编排、报告、桌面端分支三处复用，
// 且每一条判定都要能在自检脚本里单独断言。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 支持的最低 Node 主版本（类型剥离与 ESM 钩子在此之上才稳定）。 */
const MIN_NODE_MAJOR = 22

/**
 * 在 PATH 里找 dsh 可执行文件。
 * @returns {{ ok: true, command: string } | { ok: false }} 找到时给出可直接调用的命令名。
 */
export function findDsh() {
  try {
    const out = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()
    return out ? { ok: true, command: out } : { ok: false }
  } catch {
    return { ok: false }
  }
}

/**
 * 宿主 home 目录：显式 `$DSH_HOME` 优先，否则 `~/.dsh`（与 dsh 自身的解析规则一致）。
 * @returns {string} home 的绝对路径。
 */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/**
 * 读某个 profile 目录，返回它的安装状态。
 * @param {string} home 宿主 home 目录。
 * @param {string} name profile 名。
 * @returns {{ dir: string, exists: boolean, initialized: boolean, bundles: string[], linkedTo: string | null }} 该 profile 的现状。
 */
export function readProfile(home, name) {
  const dir = join(home, 'profiles', name)
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return { dir, exists: existsSync(dir), initialized: false, bundles: [], linkedTo: null }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const dep = manifest?.dependencies?.['dsh-tokensave']
    return {
      dir,
      exists: true,
      initialized: true,
      bundles: Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [],
      // link:/file: 前缀都说明装的是本地 checkout，而不是注册表版本。
      linkedTo: typeof dep === 'string' ? dep.replace(/^(?:link|file):/, '') : null,
    }
  } catch {
    return { dir, exists: true, initialized: false, bundles: [], linkedTo: null }
  }
}

/**
 * 判断本进程能否承担安装任务。
 * @param {string} [version] Node 版本串，默认取当前进程。
 * @returns {{ ok: boolean, major: number, reason?: string }} 不满足时给出可直接展示的原因。
 */
export function checkNode(version = process.versions.node) {
  const major = Number.parseInt(version.split('.')[0] ?? '0', 10)
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    return { ok: false, major, reason: `需要 Node >= ${MIN_NODE_MAJOR}（当前 ${version}）` }
  }
  return { ok: true, major }
}

/**
 * 一次性收集安装要用的全部环境事实。
 * @returns {object} 探测结果，供 cli 决定走哪条分支。
 */
export function detectEnvironment() {
  const home = resolveDshHome()
  return {
    home,
    dsh: findDsh(),
    node: checkNode(),
    web: readProfile(home, 'web'),
    // 桌面端 profile 只由 Electron 应用初始化；目录不存在 = 还没装过桌面端。
    desktop: readProfile(home, 'desktop'),
  }
}
