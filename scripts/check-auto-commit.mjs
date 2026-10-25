/**
 * 会话结束自动提交自检（真实 git 仓库端到端，不需要浏览器）。
 *
 *   node scripts/check-auto-commit.mjs
 *
 * 背景：src/auto-commit.ts 在 `agent/turn-stopping` 时把工作区改动自动提交
 * （参考 info_report 的收尾约定）。它直接跑 git，所以断言不能只 grep 源码——
 * 这里建一个一次性仓库，用假 ctx 截住监听器，验证三条真实行为：
 *
 *   1. 有改动 → 提交一次，消息带 `chore(auto)`；
 *   2. 没改动 → 不再产生提交（每轮都触发，不能每轮都造空提交）；
 *   3. 配置 enabled=false → 有改动也不提交（配置下一轮即生效）；
 *   4. 非 git 目录 → 静默跳过，不抛错。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'ts-auto-commit-'))
const repo = join(tmp, 'repo')
const home = join(tmp, 'dsh')

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const commitCount = () => Number(git(repo, 'rev-list', '--count', 'HEAD'))
const lastMessage = () => git(repo, 'log', '-1', '--pretty=%s')

/** 轮询等待后台队列把提交落下来（监听器是异步的，不阻塞调用方）。 */
async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return predicate()
}

try {
  // —— 一次性 git 仓库 ——
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q')
  git(repo, 'config', 'user.name', 'tokensave-test')
  git(repo, 'config', 'user.email', 'tokensave-test@example.invalid')
  writeFileSync(join(repo, 'a.txt'), 'one\n', 'utf8')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'init')
  const baseline = commitCount()

  // DSH_HOME 必须在调用 registerAutoCommit 之前生效（配置落在这个目录下）
  process.env.DSH_HOME = home
  const { registerAutoCommit } = await import('../src/auto-commit.ts')

  const handlers = []
  registerAutoCommit({ on: (event, fn) => { handlers.push({ event, fn }) } })

  check('挂到 agent/turn-stopping', handlers.length === 1 && handlers[0].event === 'agent/turn-stopping')

  const trigger = (cwd, turn = 1) =>
    handlers[0].fn({ agent: { session: { header: { cwd, id: 'session-test' } } }, turn })

  // 1. 有改动 → 提交
  writeFileSync(join(repo, 'a.txt'), 'two\n', 'utf8')
  trigger(repo)
  const committed = await waitFor(() => commitCount() === baseline + 1)
  check('有改动时自动提交一次', committed, `commits=${commitCount()}`)
  check('提交信息带 chore(auto) 前缀', lastMessage().startsWith('chore(auto):'), lastMessage())
  check('提交信息说明是第 1 轮', lastMessage().includes('第 1 轮'), lastMessage())

  // 2. 没改动 → 不造空提交
  trigger(repo, 2)
  await new Promise((r) => setTimeout(r, 400))
  check('没有改动时不产生空提交', commitCount() === baseline + 1, `commits=${commitCount()}`)

  // 3. enabled=false → 有改动也不提交（配置每轮重读）
  mkdirSync(join(home, 'tokensave'), { recursive: true })
  writeFileSync(join(home, 'tokensave', 'auto-commit.json'), JSON.stringify({ enabled: false }), 'utf8')
  writeFileSync(join(repo, 'a.txt'), 'three\n', 'utf8')
  trigger(repo, 3)
  await new Promise((r) => setTimeout(r, 400))
  check('配置 enabled=false 时不动 git', commitCount() === baseline + 1, `commits=${commitCount()}`)

  // 4. 非 git 目录 → 静默跳过
  writeFileSync(join(home, 'tokensave', 'auto-commit.json'), JSON.stringify({ enabled: true }), 'utf8')
  const plain = join(tmp, 'plain')
  mkdirSync(plain, { recursive: true })
  writeFileSync(join(plain, 'b.txt'), 'x\n', 'utf8')
  let threw = false
  try {
    trigger(plain, 4)
    await new Promise((r) => setTimeout(r, 300))
  } catch {
    threw = true
  }
  check('非 git 目录不抛错', !threw)

  // 5. 探索者会话过滤：普通 sessionId 不被误判
  const { isExplorerSession } = await import('../src/session/create-explorer-session.ts')
  check('未登记的会话不判为探索者', isExplorerSession('session-user-1') === false)
  check('空 id 不判为探索者', isExplorerSession('') === false)

  // 6. 子代理会话不提交（origin=subagent）
  writeFileSync(join(repo, 'a.txt'), 'four\n', 'utf8')
  handlers[0].fn({ agent: { session: { header: { cwd: repo, id: 'session-child', origin: 'subagent' } } }, turn: 5 })
  await new Promise((r) => setTimeout(r, 400))
  check('子代理会话不触发提交', commitCount() === baseline + 1, `commits=${commitCount()}`)
} catch (error) {
  fail++
  console.error('FAIL  自检异常:', error?.stack ?? error)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(fail === 0 ? '\n✅ 自动提交自检全部通过' : `\n❌ ${fail} 条断言失败`)
process.exit(fail === 0 ? 0 : 1)
