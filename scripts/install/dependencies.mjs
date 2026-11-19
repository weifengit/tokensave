// 依赖准备：本地 checkout 被 link 安装后，宿主按自己的解析规则借给插件它的 dsh 包，
// 但 client 构建需要 esbuild、类型检查需要 typescript —— 这些在 devDependencies 里，
// 只有跑过 pnpm install 才有。全新 clone 必须先补这一步才能生成 dist/client.js。
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 判断依赖是否已就绪。
 * 只看 node_modules 是否存在：它缺失时构建必然失败，存在时就算版本不新也能出产物，
 * 安装器不再替用户做依赖升级判断。
 * @param {string} root 插件根目录。
 * @returns {boolean} 是否可以跳过安装。
 */
export function hasDependencies(root) {
  return existsSync(join(root, 'node_modules'))
}

/**
 * 在插件目录跑 pnpm install。
 * @param {string} root 插件根目录。
 * @param {(line: string) => void} [onLine] 逐行输出回调。
 * @returns {{ ok: boolean, error?: string }} 结果。
 */
export function installDependencies(root, onLine = () => {}) {
  try {
    const out = execFileSync('pnpm', ['install'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600_000,
    })
    for (const line of String(out).split('\n')) if (line.trim()) onLine(line.trim())
    return { ok: true }
  } catch (error) {
    const detail = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim()
    return { ok: false, error: detail || error?.message || String(error) }
  }
}

/**
 * 确认 pnpm 可用 —— 它是依赖安装和客户端构建的前置条件。
 * @returns {{ ok: boolean, version?: string, error?: string }} 探测结果。
 */
export function checkPnpm() {
  try {
    const version = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim()
    return { ok: true, version }
  } catch {
    return { ok: false, error: '未找到 pnpm；请先安装：npm i -g pnpm' }
  }
}
