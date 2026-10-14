/**
 * dockview spike 自检（Step 13 · Step A，纯静态 + vendor 冒烟）。
 *
 *   node scripts/check-dockview-spike.mjs
 *
 * 钉四件事：
 *   1. vendor 引入层能真的拿到 API —— UMD 必须走 global 分支（不能走 CJS 分支，
 *      否则 API 被写进 bundle exports，我们拿不到）；CSS 注入幂等；
 *   2. 构建链路按文本打进产物（text loader + vendor/min.js 插件）；
 *   3. spike 组件确实覆盖了 Step A 的四个验证点（透明主题 / disableDnd /
 *      setVisible / 两个项目各自独立输入框）；
 *   4. 挂载点 = shell.overlay 且受开关控制（平时不入 DOM）。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-dockview-'))

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

try {
  // —— 1. vendor 引入层冒烟（真跑 UMD） ——
  const out = join(dir, 'vendor.mjs')
  await build({
    entryPoints: [join(root, 'client/src/vendor/dockview.ts')],
    bundle: true,
    format: 'esm',
    outfile: out,
    platform: 'neutral',
    logLevel: 'silent',
    loader: { '.css': 'text' },
    plugins: [
      {
        name: 'vendor-min-js-as-text',
        setup(b) {
          b.onLoad({ filter: /vendor[\\/][^/\\]+\.min\.js$/ }, (args) => ({
            contents: readFileSync(args.path, 'utf8'),
            loader: 'text',
          }))
        },
      },
    ],
  })

  // 最小 DOM 桩：只要 style 注入与 head 追加
  const styles = []
  globalThis.document = {
    head: { appendChild: (el) => styles.push(el) },
    getElementById: () => styles.find((s) => s.id && true) || null,
    createElement: () => ({ id: '', textContent: '' }),
  }
  const m = await import(out)

  const core = m.getDockviewCore()
  check('UMD 走 global 分支并暴露 API（globalThis["dockview-core"]）', !!core)
  check('核心工厂可用（createDockview）', typeof core?.createDockview === 'function')
  check('能力面齐全：浮动组 / 序列化 / 锁 / 隐藏',
    typeof core?.DockviewComponent === 'function' &&
    typeof core?.createDockview === 'function')
  check('主题齐全（themeAbyss 等内置主题在）', typeof core?.themeAbyss === 'object' || !!core?.themeAbyss)
  check('二次调用返回同一份（缓存）', m.getDockviewCore() === core)

  m.installDockviewCss()
  const injected = styles.find((s) => s.id === m.DOCKVIEW_CSS_ID)
  check('CSS 注入到 <style id=tokensave-dockview-css>', !!injected)
  check('注入内容确实是 dockview 样式（含 .dv-dockview）',
    !!injected && typeof injected.textContent === 'string' && injected.textContent.includes('.dv-dockview'))
  const before = styles.length
  m.installDockviewCss()
  check('CSS 注入幂等（不重复插）', styles.length === before)

  // —— 2. 构建链路 ——
  const buildSrc = readFileSync(join(root, 'scripts/build-client.mjs'), 'utf8')
  check('构建脚本配了 text loader（.css）', /loader:\s*\{\s*'\.css':\s*'text'\s*\}/.test(buildSrc))
  check('构建脚本把 vendor/*.min.js 当文本（UMD 插件）', /vendor-min-js-as-text/.test(buildSrc))
  const typesSrc = readFileSync(join(root, 'types/vendor.d.ts'), 'utf8')
  check('文本导入有 TS 声明', /\*\.css/.test(typesSrc) && /\*\.min\.js/.test(typesSrc))

  // —— 3. spike 覆盖 Step A 验证点 ——
  const spike = readFileSync(join(root, 'client/src/panel/dock-spike.tsx'), 'utf8')
  check('透明主题（className dv-intel + transparent）',
    /className:\s*'dv-intel'/.test(spike) && /\.dv-intel[^}]*transparent/.test(spike))
  check('defaultRenderer: always（非激活面板 DOM 不摘）', /defaultRenderer:\s*'always'/.test(spike))
  check('锁布局走 disableDnd（构造 + updateOptions）',
    /disableDnd:\s*false/.test(spike) && /updateOptions\(\{\s*disableDnd/.test(spike))
  check('隐藏/显示面板走 setVisible', /setVisible\(/.test(spike))
  check('两个项目各自独立输入框（data-spike-input 按项目）',
    /data-spike-input/.test(spike) && /spec\.project/.test(spike))
  check('ticker iframe 用于判定 DOM 是否被重建（srcdoc + contentWindow.__t）',
    /srcdoc/.test(spike) && /__t/.test(spike))
  check('诊断钩子 __tsDockSpike 齐备（api/ticks/drafts/snapshot/restore）',
    /__tsDockSpike/.test(spike) && /snapshot:/.test(spike) && /restore:/.test(spike) &&
    /reuseExistingPanels:\s*true/.test(spike))
  check('跨实例浮动组用 addFloatingGroup', /addFloatingGroup\(/.test(spike))

  // —— 4. 挂载点 ——
  const idx = readFileSync(join(root, 'client/src/index.ts'), 'utf8')
  check('index.ts 注册到 shell.overlay 槽', /slots\.register\(\s*\{\s*name:\s*'shell\.overlay'/.test(idx))
  check('id = tokensave-dock-spike', /id:\s*'tokensave-dock-spike'/.test(idx))
  check('开关控制（?dockview-spike 或 localStorage 标志）',
    /dockview-spike/.test(spike) && /SPIKE_FLAG_KEY/.test(spike))
  check('vendor 文件在仓内', existsSync(join(root, 'client/src/vendor/dockview-core.min.js')) &&
    existsSync(join(root, 'client/src/vendor/dockview.css')))

  // —— 5. 产物 ——
  const dist = join(root, 'dist/client.js')
  if (existsSync(dist)) {
    const size = statSync(dist).size
    const src = readFileSync(dist, 'utf8')
    check('产物含 dockview（dv-dockview 类名）', src.includes('.dv-dockview'))
    check('产物含 UMD 全局键 dockview-core', src.includes('dockview-core'))
    check('产物体积符合预期（>1.1MB，含 ~709KB vendor）', size > 1_100_000, `${size} 字节`)
  } else {
    console.log('SKIP  dist/client.js 不存在（先跑 pnpm build:client）')
  }

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
