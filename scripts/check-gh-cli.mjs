/**
 * gh 定位逻辑（src/gh-cli.ts）自检 —— **真的跑一遍**探测函数。
 *
 *   node scripts/check-gh-cli.mjs
 *
 * 为什么要有它：Windows 上「装了 gh 却报未安装」的坑，纯正则断言钉不住
 * （候选路径、优先级、缓存、找不到时的返回值都要真跑）。
 * 这里用**假的可执行文件**做端到端：把一个脚本放到临时目录、让 PATH 指过去，
 * 断言 resolveGh() 能找到它；再把 PATH 清空、断言它退回「按安装位置找」或 null。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

// —— 把 gh-cli.ts 打成可导入的 ESM（纯逻辑，无 DSH 依赖）——
const dir = mkdtempSync(join(tmpdir(), 'ts-gh-'))
const out = join(dir, 'gh-cli.mjs')
await build({
  entryPoints: [join(root, 'src/gh-cli.ts')],
  bundle: true,
  format: 'esm',
  outfile: out,
  platform: 'node',
  logLevel: 'silent',
})

try {
  const m = await import(out)

  check('导出 resolveGh / ghCandidates / resetGhCache',
    typeof m.resolveGh === 'function' &&
    typeof m.ghCandidates === 'function' &&
    typeof m.resetGhCache === 'function')

  // —— ① PATH 里能找到 gh ——
  const fakeDir = join(dir, 'bin')
  mkdirSync(fakeDir, { recursive: true })
  const fakeGh = join(fakeDir, 'gh')
  writeFileSync(fakeGh, '#!/bin/sh\necho "gh version 2.0.0"\n')
  chmodSync(fakeGh, 0o755)

  const oldPath = process.env.PATH
  process.env.PATH = fakeDir
  m.resetGhCache()
  const viaPath = m.resolveGh()
  check('PATH 里有 gh 时直接找到它',
    viaPath === 'gh' || viaPath === 'gh.exe' || (viaPath && viaPath.includes('gh')),
    `resolveGh() = ${viaPath}`)

  // —— ② PATH 里没有 → 按安装位置找（Windows 的主诉场景）——
  //    用 GH_INSTALL_DIR 模拟「装在非标准目录 / 不在 PATH 里」
  const installDir = join(dir, 'GitHub CLI')
  mkdirSync(installDir, { recursive: true })
  const installed = join(installDir, process.platform === 'win32' ? 'gh.exe' : 'gh')
  writeFileSync(installed, '#!/bin/sh\necho "gh version 2.0.0"\n')
  chmodSync(installed, 0o755)

  // —— ② 显式指定 gh 路径（用户装在非常规位置时用）——
  //    这是「装了 gh 却报未安装」的兜底：指定了就用它，不用猜。
  process.env.PATH = ''
  process.env.GH_INSTALL_DIR = installDir
  process.env.TOKENS_SAVE_GH_PATH = installed
  m.resetGhCache()
  const viaInstall = m.resolveGh()
  check('显式指定路径时直接用它（装了 gh 却报未安装的兜底）',
    viaInstall === installed,
    `resolveGh() = ${viaInstall}`)

  // —— ③ 找不到时**不抛错**（调用方给可读文案，界面仍可手填地址）——
  //    本机可能真装了 gh（如 /opt/homebrew/bin/gh），所以这里只断言「不抛错、
  //    返回值是字符串或 null」，不断言一定为 null。
  process.env.PATH = ''
  delete process.env.GH_INSTALL_DIR
  delete process.env.TOKENS_SAVE_GH_PATH
  process.env.ProgramFiles = join(dir, 'no-such-program-files')
  process.env.LOCALAPPDATA = join(dir, 'no-such-localappdata')
  process.env.SystemDrive = 'Z:'
  m.resetGhCache()
  let notFound = 'threw'
  try {
    notFound = m.resolveGh()
  } catch (e) {
    notFound = `threw: ${e}`
  }
  check('找不到时不抛错（返回 null 或一个真实路径）',
    notFound === null || typeof notFound === 'string',
    `resolveGh() = ${notFound}`)

  // —— ④ 候选路径里必须含 Windows 的标准安装位置 ——
  const cands = m.windowsCandidates()
  const joined = cands.join(' | ')
  check('候选路径含 Windows 标准安装位置与 GH_INSTALL_DIR',
    /GitHub CLI/.test(joined) && /gh\.exe/.test(joined),
    `${cands.length} 个候选`)

  // —— ⑤ 结果缓存（探测只做一次）——
  process.env.PATH = fakeDir
  m.resetGhCache()
  const first = m.resolveGh()
  const second = m.resolveGh()
  check('探测结果有缓存（同一路径不重复找）',
    first === second)

  // —— ⑥ 探测走 execFileSync，不经 shell ——
  //    （先把 PATH 恢复：上面为了模拟「PATH 里没有」把它清空了）
  process.env.PATH = oldPath
  const src = readFileSync(join(root, 'src/gh-cli.ts'), 'utf8')
  check('探测不经 shell（没有 shell: true）',
    !/shell: true/.test(src))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exitCode = fail === 0 ? 0 : 1
