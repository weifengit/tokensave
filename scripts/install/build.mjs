// 客户端产物构建：负责「dist/client.js 存不存在、要不要重建」。
// 单独成模块的理由：这是全新 clone 上唯一会失败的环节，且失败是**静默**的
// （宿主读到 dsh.client 声明却找不到文件时，只跳过该客户端半边，不报错），
// 所以判定逻辑必须集中、可断言，不能散在编排流程里。
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 客户端产物相对插件根的位置，与 package.json 的 exports["./client"] 必须一致。 */
export const CLIENT_ARTIFACT = 'dist/client.js'

/**
 * 检查产物现状。
 * @param {string} root 插件根目录。
 * @returns {{ path: string, exists: boolean, size: number, mtimeMs: number }} 产物事实。
 */
export function inspectArtifact(root) {
  const path = join(root, CLIENT_ARTIFACT)
  if (!existsSync(path)) return { path, exists: false, size: 0, mtimeMs: 0 }
  const stat = statSync(path)
  return { path, exists: true, size: stat.size, mtimeMs: stat.mtimeMs }
}

/**
 * 跑 `pnpm build:client` 生成产物。
 * 用 pnpm 而不是直接调 esbuild，是为了和仓库里唯一的构建入口保持一致
 * （构建脚本自身决定外部包、envelope 格式等约定，安装器不该复制这些知识）。
 * @param {string} root 插件根目录。
 * @param {(line: string) => void} [onLine] 逐行输出回调。
 * @returns {{ ok: boolean, error?: string }} 构建结果。
 */
export function buildArtifact(root, onLine = () => {}) {
  try {
    const out = execFileSync('pnpm', ['run', 'build:client'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    for (const line of String(out).split('\n')) if (line.trim()) onLine(line.trim())
    return { ok: true }
  } catch (error) {
    const detail = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim()
    return { ok: false, error: detail || error?.message || String(error) }
  }
}

/**
 * 确保产物可用：已存在就直接复用，缺失才构建。
 * 复用优先，是因为重复构建会让每次安装都无谓地花十几秒；
 * 而产物缺失时构建是必需的——没有它客户端半边等于没装。
 * @param {string} root 插件根目录。
 * @param {{ force?: boolean, onLine?: (line: string) => void }} [options] force 强制重建。
 * @returns {{ ok: boolean, built: boolean, reason?: string, size?: number }} 结果。
 */
export function ensureArtifact(root, options = {}) {
  const before = inspectArtifact(root)
  if (before.exists && !options.force) return { ok: true, built: false, size: before.size }

  // 构建需要 esbuild 与 client/src；两者都在 devDependencies 里，
  // 所以没有 node_modules 时必须先装依赖，否则构建必然失败。
  if (!existsSync(join(root, 'node_modules'))) {
    return { ok: false, built: false, reason: 'missing-node-modules' }
  }

  const result = buildArtifact(root, options.onLine)
  if (!result.ok) return { ok: false, built: false, reason: result.error }

  const after = inspectArtifact(root)
  if (!after.exists) return { ok: false, built: false, reason: 'build produced no artifact' }
  return { ok: true, built: true, size: after.size }
}
