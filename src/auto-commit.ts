/**
 * 会话结束自动提交（参考 info_report 的收尾约定，2026-10-25 用户要求）。
 *
 * 背景：info_report 的做法是「改完代码 → git add -A && git commit → pnpm release」，
 * 但那条规则靠模型每轮记得执行，忘一次就攒一堆未提交的改动。这里把它钉在宿主侧：
 * 会话轮次一结束（工具副作用全部落地之后），只要工作区有改动就自动提交。
 *
 * 触发点选 `agent/turn-stopping`（Claude Code 的 Stop 等价物，见 dsh-agent 事件表），
 * 它是「本轮即将结束」的串行闸口，比轮询或定时器都准。**后台执行、不阻塞轮次结束**：
 * git 慢不该拖住对话；同一仓库的多次提交用队列串行，避免并发 git 抢 index.lock。
 *
 * 过滤（不是每个会话都该提交）：
 *   - `origin === 'subagent'` / `delegationDepth > 0` 的子代理会话跳过；
 *   - tokensave 自己的探索者会话跳过（它们是只读分析用的 root 会话，见
 *     create-explorer-session.ts 的 isExplorerSession）；
 *   - 非 git 仓库、工作区干净、存在未解决的合并冲突 → 跳过（写日志，不报错）。
 *
 * 配置：`~/.dsh/tokensave/auto-commit.json`（首次启动落一份默认值，改完下一轮即生效）
 *   enabled   true  总开关
 *   mode      commit | release
 *             commit  = 只提交；release = 提交后若仓库有 scripts/release.mjs 就跑
 *                       `node scripts/release.mjs patch`（= info_report 的自动发版）
 *   push      false 提交后是否 git push
 *   timeoutMs 60000 单条 git 命令超时
 *
 * 日志：`~/.dsh/tokensave/auto-commit.log`（超过 512 KB 自动截断，只留最后 200 行）。
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { dshHomeDir } from './blackboard/store.ts'
import { isExplorerSession } from './session/create-explorer-session.ts'

export interface AutoCommitConfig {
  /** 总开关；默认 true。 */
  enabled: boolean
  /** `commit` = 只提交；`release` = 提交后再跑 scripts/release.mjs。 */
  mode: 'commit' | 'release'
  /** 提交后是否 push（默认 false，推送是外部副作用，交给用户决定）。 */
  push: boolean
  /** 单条 git 命令超时（毫秒）。 */
  timeoutMs: number
}

const DEFAULT_CONFIG: AutoCommitConfig = {
  enabled: true,
  mode: 'commit',
  push: false,
  timeoutMs: 60_000,
}

function dataDir(): string {
  return path.join(dshHomeDir(), 'tokensave')
}

function configFilePath(): string {
  return path.join(dataDir(), 'auto-commit.json')
}

function logFilePath(): string {
  return path.join(dataDir(), 'auto-commit.log')
}

/** 读配置：文件不存在 / 损坏 / 字段非法一律回退默认值（自动提交不该因配置错误停摆）。 */
export function readAutoCommitConfig(): AutoCommitConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configFilePath(), 'utf8'))
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG }
    const timeout = Number((raw as { timeoutMs?: unknown }).timeoutMs)
    return {
      enabled: (raw as { enabled?: unknown }).enabled !== false,
      mode: (raw as { mode?: unknown }).mode === 'release' ? 'release' : 'commit',
      push: (raw as { push?: unknown }).push === true,
      timeoutMs: Number.isFinite(timeout) && timeout >= 5_000 ? timeout : DEFAULT_CONFIG.timeoutMs,
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/** 首次运行落一份默认配置，方便用户改；已有配置绝不覆盖。 */
function ensureConfigFile(): void {
  try {
    const file = configFilePath()
    if (fs.existsSync(file)) return
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8')
  } catch { /* 写配置失败不影响插件加载 */ }
}

interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

/** 跑一条命令并捕获输出；**从不抛**（失败体现在 code 上），超时由 execFile 的 timeout 兜。 */
function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const raw = (error as NodeJS.ErrnoException | null)?.code
        const code = error ? (typeof raw === 'number' ? raw : 1) : 0
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      },
    )
  })
}

/** 追加一行审计日志；文件过大时只留最后 200 行。日志失败不影响提交。 */
function appendLog(line: string): void {
  try {
    const file = logFilePath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`, 'utf8')
    if (fs.statSync(file).size > 512 * 1024) {
      const kept = fs.readFileSync(file, 'utf8').split('\n').slice(-200).join('\n')
      fs.writeFileSync(file, kept, 'utf8')
    }
  } catch { /* 日志失败无妨 */ }
}

/** 同一仓库的提交串行排队（并发 git 会抢 index.lock 报错）。 */
const chains = new Map<string, Promise<void>>()

function enqueue(key: string, job: () => Promise<void>): Promise<void> {
  const previous = chains.get(key) ?? Promise.resolve()
  const next = previous.then(job, job).catch(() => {})
  chains.set(key, next)
  void next.finally(() => {
    if (chains.get(key) === next) chains.delete(key)
  })
  return next
}

/** 提交信息：一句话、前缀 `chore(auto)`，正文带文件数与前三个文件名。 */
function buildMessage(files: string[], turn: number): string {
  const shown = files.slice(0, 3).join('、')
  const more = files.length > 3 ? '…' : ''
  const where = shown ? `（${shown}${more}）` : ''
  return `chore(auto): 会话第 ${turn > 0 ? turn : 1} 轮结束自动提交 ${files.length} 个文件${where}`
}

/** 解析 `git status --porcelain` 的文件路径（`XY path` 的 path 从第 4 个字符起）。 */
function statusFiles(rows: string[]): string[] {
  return rows.map((row) => row.slice(3).trim()).filter(Boolean)
}

async function runRelease(repo: string, cfg: AutoCommitConfig): Promise<void> {
  const script = path.join(repo, 'scripts', 'release.mjs')
  if (!fs.existsSync(script)) {
    appendLog(`release 模式：${repo} 没有 scripts/release.mjs，只提交不发版`)
    return
  }
  const result = await run(process.execPath, [script, 'patch'], repo, cfg.timeoutMs)
  const last = result.stdout.trim().split('\n').filter(Boolean).pop() ?? ''
  appendLog(result.code === 0 ? `发版完成 @ ${repo}: ${last}` : `发版失败 @ ${repo}: ${result.stderr.trim()}`)
  if (result.code === 0) console.log(`[dsh-tokensave] 自动发版 @ ${repo}: ${last}`)
}

/** 一次提交尝试：仓库判定 → 改动判定 → add → commit（→ 可选发版/push）。 */
async function commitOnce(cwd: string, cfg: AutoCommitConfig, turn: number): Promise<void> {
  const top = await run('git', ['rev-parse', '--show-toplevel'], cwd, 15_000)
  if (top.code !== 0) return // 不是 git 仓库（或 git 不可用）：静默跳过

  const repo = top.stdout.trim()
  if (!repo) return

  const status = await run('git', ['status', '--porcelain'], repo, cfg.timeoutMs)
  if (status.code !== 0) {
    appendLog(`status 失败 @ ${repo}: ${status.stderr.trim()}`)
    return
  }

  const rows = status.stdout.split('\n').map((line) => line.replace(/\s+$/, '')).filter(Boolean)
  if (!rows.length) return // 工作区干净：这一轮没改代码

  // 合并冲突中的工作区不提交：把冲突标记当改动提交会污染历史，交给用户自己解。
  if (rows.some((row) => /^(UU|AA|DD|AU|UA|DU|UD)/.test(row))) {
    appendLog(`跳过（工作区存在未解决的合并冲突）@ ${repo}`)
    return
  }

  const files = statusFiles(rows)
  const message = buildMessage(files, turn)

  const add = await run('git', ['add', '-A'], repo, cfg.timeoutMs)
  if (add.code !== 0) {
    appendLog(`add 失败 @ ${repo}: ${add.stderr.trim()}`)
    return
  }

  const commit = await run('git', ['commit', '-m', message], repo, cfg.timeoutMs)
  if (commit.code !== 0) {
    appendLog(`commit 失败 @ ${repo}: ${commit.stderr.trim()}`)
    return
  }

  console.log(`[dsh-tokensave] 自动提交 ${files.length} 个文件 @ ${repo}: ${message}`)
  appendLog(`提交 ${files.length} 个文件 @ ${repo}: ${message}`)

  if (cfg.mode === 'release') await runRelease(repo, cfg)

  if (cfg.push) {
    const push = await run('git', ['push'], repo, cfg.timeoutMs)
    appendLog(
      push.code === 0
        ? `push 完成 @ ${repo}`
        : `push 失败 @ ${repo}: ${push.stderr.trim()}`,
    )
  }
}

/** 一轮结束的入口：过滤子代理/探索者/无 cwd，然后交给队列在后台提交。 */
function handleTurnStopping(payload: unknown): void {
  const cfg = readAutoCommitConfig()
  if (!cfg.enabled) return

  const agent = (payload as { agent?: any } | null)?.agent
  const header = agent?.session?.header
  if (!header) return

  // 子代理（含 fork 出来的探索者）不改主工作区，不该替用户提交。
  if (header.origin === 'subagent') return
  if (Number(header.delegationDepth ?? 0) > 0) return

  const sessionId = String(header.id ?? agent?.id ?? '')
  if (sessionId && isExplorerSession(sessionId)) return

  const cwd = typeof header.cwd === 'string' ? header.cwd.trim() : ''
  if (!cwd) return

  const turn = Number((payload as { turn?: unknown } | null)?.turn ?? 0)
  void enqueue(cwd, () => commitOnce(cwd, cfg, Number.isFinite(turn) ? turn : 0))
}

/**
 * 挂载自动提交：监听 `agent/turn-stopping`（每轮即将结束时触发一次）。
 *
 * 监听器**同步返回、不 await 后台提交**——cordis 的串行事件会等待返回的 Promise，
 * 让它等 git 会把「本轮结束」拖慢几十到几百毫秒；这里只需要把活排进队列。
 */
export function registerAutoCommit(ctx: Context): void {
  ensureConfigFile()
  const on = (ctx as any).on
  if (typeof on !== 'function') return
  try {
    ctx.on('agent/turn-stopping', (payload: unknown) => {
      handleTurnStopping(payload)
    })
  } catch (error) {
    console.warn('[dsh-tokensave] 自动提交挂载失败（agent/turn-stopping 不可用）:', error)
  }
}
