// profile 安装：把一个本地 checkout 注册进 dsh 的某个 profile。
//
// 两条路径是**机制不同**，不是一个的特例：
//   - web 等普通 profile 走 `dsh plugin --profile <name> add <dir>`，由 dsh 自己
//     维护 package.json 依赖、bundles 列表与锁文件，是最稳的官方入口。
//   - desktop 是 Electron 应用的保留 profile，CLI 会直接拒绝
//     （`profile "desktop" is managed exclusively by the Electron application`），
//     所以只能在它自己的目录里手写清单再跑 pnpm。手写要复刻 dsh 的做法，
//     因此这里按「备份 → 写依赖 → 写 bundles → pnpm install」逐步做，
//     任何一步失败都回滚到备份，避免把用户桌面端搞成启动不了的半成品。
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 插件在 profile 依赖里的键名（= package.json 的 name）。 */
export const PACKAGE_NAME = 'dsh-tokensave'

/**
 * 走官方 CLI 安装到普通 profile。
 * @param {string} dshCommand dsh 可执行文件路径。
 * @param {string} profile profile 名。
 * @param {string} root 插件根目录的绝对路径。
 * @param {(line: string) => void} [onLine] 逐行输出回调。
 * @returns {{ ok: boolean, error?: string }} 结果。
 */
export function installViaCli(dshCommand, profile, root, onLine = () => {}) {
  try {
    const out = execFileSync(dshCommand, ['plugin', '--profile', profile, 'add', root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
    })
    for (const line of String(out).split('\n')) if (line.trim()) onLine(line.trim())
    return { ok: true }
  } catch (error) {
    const detail = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim()
    return { ok: false, error: detail || error?.message || String(error) }
  }
}

/**
 * 把插件挂进桌面端 profile 的清单，并在该目录跑 pnpm。
 * 调用前必须确认 profile 已被 Electron 应用初始化过（有 package.json），
 * 否则这里凭空造一份清单会和桌面端自己的初始化逻辑打架。
 * @param {string} dir 桌面端 profile 目录。
 * @param {string} root 插件根目录的绝对路径。
 * @param {(line: string) => void} [onLine] 逐行输出回调。
 * @returns {{ ok: boolean, changed: boolean, error?: string }} 结果。
 */
export function installIntoDesktopProfile(dir, root, onLine = () => {}) {
  const manifestPath = join(dir, 'package.json')
  const backupPath = `${manifestPath}.bak-tokensave-install`

  if (!existsSync(manifestPath)) return { ok: false, changed: false, error: `桌面端 profile 尚未初始化：${dir}` }

  const original = readFileSync(manifestPath, 'utf8')
  let manifest
  try {
    manifest = JSON.parse(original)
  } catch (error) {
    return { ok: false, changed: false, error: `profile 清单不是合法 JSON：${error.message}` }
  }

  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  if (bundles.includes(PACKAGE_NAME)) {
    // 幂等：已经登记过就只补一次 pnpm（用户可能删了 node_modules）。
    return { ok: runPnpmInstall(dir, onLine), changed: false }
  }

  copyFileSync(manifestPath, backupPath)
  const updated = {
    ...manifest,
    dependencies: { ...(manifest.dependencies ?? {}), [PACKAGE_NAME]: `link:${root}` },
    dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...bundles, PACKAGE_NAME] } },
  }

  try {
    writeFileSync(manifestPath, `${JSON.stringify(updated, undefined, 2)}\n`)
    const installed = runPnpmInstall(dir, onLine)
    if (!installed.ok) {
      copyFileSync(backupPath, manifestPath)
      return { ok: false, changed: false, error: 'pnpm install 失败，已回滚清单' }
    }
    return { ok: true, changed: true }
  } catch (error) {
    copyFileSync(backupPath, manifestPath)
    return { ok: false, changed: false, error: error?.message ?? String(error) }
  }
}

/**
 * 在 profile 目录里跑一次安装，让 link 依赖真正落到 node_modules。
 * @param {string} dir profile 目录。
 * @param {(line: string) => void} onLine 逐行输出回调。
 * @returns {{ ok: boolean, error?: string }} 结果。
 */
function runPnpmInstall(dir, onLine = () => {}) {
  try {
    if (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    }
    const out = execFileSync('pnpm', ['install'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
    })
    for (const line of String(out).split('\n')) if (line.trim()) onLine(line.trim())
    return { ok: true }
  } catch (error) {
    const detail = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim()
    return { ok: false, error: detail || error?.message || String(error) }
  }
}

/**
 * 确认安装结果真的落到了 profile 上（而不是只「命令没报错」）。
 * @param {string} dir profile 目录。
 * @param {string} root 插件根目录，用来核对 link 指向。
 * @returns {{ linked: boolean, registered: boolean }} 两项关键事实。
 */
export function verifyProfile(dir, root) {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const dep = manifest?.dependencies?.[PACKAGE_NAME]
    const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
    return {
      linked: typeof dep === 'string' && dep.replace(/^(?:link|file):/, '') === root,
      registered: bundles.includes(PACKAGE_NAME),
    }
  } catch {
    return { linked: false, registered: false }
  }
}
