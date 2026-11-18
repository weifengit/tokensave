/**
 * 项目探测：dev server 地址推断 + 端口存活探测 + 文件修改时间扫描。
 *
 * 从 `board-web-route.ts` 抽出来（那个文件已 2000+ 行，路由与探测混在一起）。
 * 这一层只做纯探测，不碰 HTTP/res，因此可独立复用与验证。
 *
 * 性能约定（用户反馈「有项目预览的界面要等很久，先卡在『预览未就绪』」）：
 *   - **扫描必须是异步的**：旧的同步 readdirSync+statSync 会把宿主事件循环按住；
 *     实测 10 个项目并发时（项目中心一进页面就全量拉一遍），单个 project-info
 *     请求从 3ms 被拖到 ~1s —— 预览就绪判定就排在这条队后面。
 *   - **结果按 root 缓存几秒并合并同刻并发**：项目中心并发 10 个、工作台每 8s
 *     一轮，同一 root 的重复请求不该反复走盘。
 *   - **端口探测只做 in-flight 合并，不做结果缓存**：dev server 可能随时起来，
 *     缓存 false 会让「刚启动」白白多等一轮。
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'

/** 扫描时忽略的目录（体积大、与“项目代码改动”无关）。 */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', '.next', '.nuxt',
  '.cache', 'coverage', '.venv', 'venv', '__pycache__', '.idea', '.vscode',
  'vendor', '.turbo', '.parcel-cache', 'tmp', 'logs',
])

/** 单次扫描最多看这么多条目（防超大目录拖死；与旧实现同口径）。 */
const MAX_ENTRIES = 20000

/** 并发 stat 的批大小：一次 128 个，既不让句柄爆掉也不逐文件串行等。 */
const STAT_CHUNK = 128

/** mtime 扫描结果缓存有效期：5s 内重复请求（项目中心 10 连发 / 8s 轮询）直接复用。 */
const MTIME_TTL_MS = 5_000

/** 缓存条目上限：正常项目数远小于它，越界就整体丢弃（不做 LRU，够用且无状态）。 */
const CACHE_LIMIT = 256

export interface ProjectMtimes {
  /** 项目内文件的最新 mtime（毫秒）；扫不到为 0 */
  newest: number
  /** 项目内文件的最老 mtime（毫秒）；扫不到为 0 */
  oldest: number
}

/**
 * 项目的「展示」地址。
 *
 * 优先读 package.json 的 `previewUrl`（项目自带的显式声明）：可为完整 URL，
 * 也可为宿主自身的相对路径（如 `/api/intel/site/console/`）——后者由 DSH 自己
 * 托管，宿主换端口也不会失效。
 *
 * 没声明时回退到**显式**端口推断（`--port 3000` / `-p 5173` / `PORT=3000`）——
 * 不猜默认端口：猜错会让「展示」打开一个不相干的地址。
 */
export function guessDevUrl(root: string): string {
  try {
    const pkgPath = path.join(root, 'package.json')
    if (!fs.existsSync(pkgPath)) return ''
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const declared = pkg && typeof pkg.previewUrl === 'string' ? pkg.previewUrl.trim() : ''
    if (declared) return declared
    const scripts = pkg && typeof pkg.scripts === 'object' ? pkg.scripts : {}
    const text = ['dev', 'start', 'serve', 'preview']
      .map((k) => (typeof scripts[k] === 'string' ? scripts[k] : ''))
      .join(' ')
    const m = /(?:--port[= ]|-p\s+|PORT=)(\d{2,5})/.exec(text)
    if (!m) return ''
    return `http://localhost:${m[1]}`
  } catch {
    return ''
  }
}

/** 探测一次：端口通不通（不等 HTTP 响应）。 */
function probeOnce(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(false)
      return
    }
    let host = '127.0.0.1'
    let port = 0
    try {
      const u = new URL(url)
      host = u.hostname || host
      port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
    } catch {
      resolve(false)
      return
    }
    if (!port) {
      resolve(false)
      return
    }
    const socket = new net.Socket()
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      try { socket.destroy() } catch { /* noop */ }
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    try {
      socket.connect(port, host)
    } catch {
      finish(false)
    }
  })
}

/** 同刻同 URL 的探测合并成一次（项目中心会把同一地址问好几遍）。 */
const probeInflight = new Map<string, Promise<boolean>>()

/**
 * 探测该 URL 是否真的有人在监听（“项目已启动”的诚实判定）。
 * 用 net.connect 而不是 fetch：只关心端口通不通，不等 HTTP 响应；
 * 超时 400ms，避免就绪判定被拖慢。
 */
export function probeUrl(url: string, timeoutMs = 400): Promise<boolean> {
  if (!url) return Promise.resolve(false)
  const running = probeInflight.get(url)
  if (running) return running
  const task = probeOnce(url, timeoutMs).finally(() => {
    if (probeInflight.get(url) === task) probeInflight.delete(url)
  })
  probeInflight.set(url, task)
  return task
}

/**
 * 走一遍项目目录，收集文件路径（不 stat，先把目录遍历做完）。
 * 忽略噪声目录与点文件/点目录，不跟随符号链接（避免大目录或环卡死）。
 */
async function collectFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const stack: string[] = [root]
  let visited = 0
  while (stack.length > 0 && visited < MAX_ENTRIES) {
    const dir = stack.pop() as string
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (++visited > MAX_ENTRIES) break
      const name = entry.name
      if (name.startsWith('.')) continue
      if (IGNORE_DIRS.has(name)) continue
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      files.push(full)
    }
  }
  return files
}

/**
 * 扫一遍项目目录，同时取**最新**与**最老**的文件修改时间。
 *
 * 「上次更新」= 最新（项目是否还在动）；「创建于」= 最老（项目里第一个文件是什么时候写的，
 * 比“加入项目中心的时间”更接近“项目创建时间”——用户要求两者同口径）。
 */
async function scanOnce(root: string): Promise<ProjectMtimes> {
  let newest = 0
  let oldest = 0
  const files = await collectFiles(root)
  for (let i = 0; i < files.length; i += STAT_CHUNK) {
    const chunk = files.slice(i, i + STAT_CHUNK)
    const stats = await Promise.all(
      chunk.map(async (file) => {
        try {
          return await fs.promises.stat(file)
        } catch {
          return null // 单个文件读不到：跳过
        }
      }),
    )
    for (const st of stats) {
      if (!st) continue
      if (st.mtimeMs > newest) newest = st.mtimeMs
      if (oldest === 0 || st.mtimeMs < oldest) oldest = st.mtimeMs
    }
  }
  return { newest, oldest }
}

/** root → 未过期的扫描结果（含同刻并发合并）。 */
const mtimeCache = new Map<string, { at: number; task: Promise<ProjectMtimes> }>()

/**
 * 取项目文件的 mtime 极值（异步 + 短缓存 + 并发合并）。
 *
 * 失败（目录读不到等）返回 {newest:0, oldest:0} 而不是抛错：这只是展示用附加信息，
 * 不该让整个 project-info 500。
 */
export function projectMtimes(root: string): Promise<ProjectMtimes> {
  const now = Date.now()
  const hit = mtimeCache.get(root)
  if (hit && now - hit.at < MTIME_TTL_MS) return hit.task
  if (mtimeCache.size > CACHE_LIMIT) mtimeCache.clear()
  const task = scanOnce(root).catch(() => ({ newest: 0, oldest: 0 }))
  mtimeCache.set(root, { at: now, task })
  return task
}
