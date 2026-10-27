/**
 * 脱敏设置自检（静态一致性 + 存储行为）。
 *
 *   node scripts/check-mask-settings.mjs
 *
 * 为什么需要它：设置页是三处协作的接缝——
 *   ① 宿主路由路径   ② 客户端请求路径   ③ Python 端 runtime.json 的键与默认值。
 * 任何一处改名/改默认值，脱敏会静默失效（面板显示已保存，Python 却读不到），
 * 所以把三处钉成可执行断言，并真的跑一次读/写/保留未知键。
 */
import { build } from 'esbuild'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `  → ${detail}` : ''}`)
}
const pick = (source, regex, what) => {
  const matched = source.match(regex)
  if (!matched) throw new Error(`无法从源码里解析 ${what}`)
  return matched[1]
}

// —— ① 路径三处一致 ——
const serverRoute = pick(read('src/mask/mask-route.ts'), /MASK_SETTINGS_ROUTE_PATH = '([^']+)'/, '宿主路由常量')
const clientRoute = pick(read('client/src/panel/mask-settings-api.ts'), /const ROUTE = '([^']+)'/, '客户端路由常量')
const boardRoute = read('src/board-web-route.ts')
check('宿主路由常量与客户端一致', serverRoute === clientRoute, `${serverRoute} != ${clientRoute}`)
check('路由已挂到 web 服务器', boardRoute.includes('MASK_SETTINGS_ROUTE_PATH') && boardRoute.includes('createMaskSettingsGuard(ctx)'))

// —— ② 开关字段与 Python 默认值一致 ——
const tsDefaults = Object.fromEntries(
  [...pick(read('src/mask/mask-settings.ts'), /MASK_RUNTIME_DEFAULTS[^{]*\{([\s\S]*?)\n\}/, 'MASK_RUNTIME_DEFAULTS')
    .matchAll(/(\w+):\s*(true|false|[\d.]+)/g)].map((m) => [m[1], m[2]]))
const pyRuntimeBlock = pick(read('mask/docmask/config.py'), /"runtime":\s*\{([\s\S]*?)\n    \}/, 'Python DEFAULT_CONFIG.runtime')
const pyDefaults = Object.fromEntries(
  [...pyRuntimeBlock.matchAll(/"(\w+)":\s*(True|False|[\d.]+)/g)]
    .map((m) => [m[1], m[2].replace('True', 'true').replace('False', 'false')]))
const normalize = (obj) => JSON.stringify(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
check('面板开关字段与 Python runtime 完全一致', normalize(tsDefaults) === normalize(pyDefaults),
  `${normalize(tsDefaults)} != ${normalize(pyDefaults)}`)

// —— ③ 客户端注册与开关数量 ——
const clientEntry = read('client/src/index.ts')
check('客户端注册到 settings.section', clientEntry.includes("'settings.section'") && clientEntry.includes("id: 'tokensave-docmask'"))
const switchRows = [...read('client/src/panel/MaskSettings.tsx').matchAll(/key: '(\w+)'/g)].map((m) => m[1])
const expectedSwitches = Object.keys(tsDefaults).filter((key) => key !== 'gliner_threshold')
check('开关行与运行字段一一对应',
  normalize(Object.fromEntries(switchRows.map((k) => [k, 'x']))) === normalize(Object.fromEntries(expectedSwitches.map((k) => [k, 'x']))),
  `rows=${switchRows.join(',')}`)

// —— ④ 构建产物里确实带上了这一页 ——
const bundle = read('dist/client.js')
check('客户端产物包含脱敏设置页', bundle.includes('tokensave-docmask') && bundle.includes(clientRoute))

// —— ⑤ 真的跑一次读 / 写 / 保留未知键（临时 HOME，不碰真实配置）——
const sandbox = mkdtempSync(join(tmpdir(), 'docmask-settings-'))
const saved = { HOME: process.env.HOME, DSH_HOME: process.env.DSH_HOME, DSH_HOME_DIR: process.env.DSH_HOME_DIR }
try {
  process.env.HOME = sandbox
  delete process.env.DSH_HOME
  delete process.env.DSH_HOME_DIR
  mkdirSync(join(sandbox, '.dsh', 'tokensave', 'docmask'), { recursive: true })
  const target = join(sandbox, '.dsh', 'tokensave', 'docmask', 'runtime.json')
  writeFileSync(target, JSON.stringify({ runtime: { enabled: false, note: 'keep-me' }, extra: 1 }), 'utf8')

  const outfile = join(sandbox, 'mask-settings.mjs')
  await build({
    entryPoints: [join(root, 'src/mask/mask-settings.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent'
  })
  const mod = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)

  const before = mod.readMaskSettings()
  check('读取已有文件并合并默认值', before.exists === true && before.values.enabled === false)

  const after = mod.writeMaskSettings({ gliner_threshold: 2, regex: false })
  check('阈值越界被夹到上限', after.values.gliner_threshold === mod.MASK_THRESHOLD_MAX, String(after.values.gliner_threshold))
  check('开关写入生效', after.values.regex === false)

  const written = JSON.parse(readFileSync(target, 'utf8'))
  check('保留文件顶层未知键', written.extra === 1)
  check('保留 runtime 内未知键', written.runtime.note === 'keep-me')
  check('保留未提交的已有开关值', written.runtime.enabled === false)
  check('写入路径与 Python 约定一致', after.path.endsWith(join('tokensave', 'docmask', 'runtime.json')), after.path)

  const coerced = mod.writeMaskSettings({ enabled: 'false', bogus: 'ignored' })
  check('字符串布尔被收敛', coerced.values.enabled === false)
  check('未知字段被丢弃', !('bogus' in JSON.parse(readFileSync(target, 'utf8')).runtime))
} finally {
  if (saved.HOME === undefined) delete process.env.HOME
  else process.env.HOME = saved.HOME
  if (saved.DSH_HOME !== undefined) process.env.DSH_HOME = saved.DSH_HOME
  if (saved.DSH_HOME_DIR !== undefined) process.env.DSH_HOME_DIR = saved.DSH_HOME_DIR
  rmSync(sandbox, { recursive: true, force: true })
}

console.log(fail === 0 ? '\n脱敏设置自检通过' : `\n脱敏设置自检失败：${fail} 项`)
process.exit(fail === 0 ? 0 : 1)
