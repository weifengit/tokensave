/**
 * 刷新后左侧边栏自动收起自检（纯函数 + 假 DOM，不需要浏览器）。
 *
 *   node scripts/check-sidebar-collapse.mjs
 *
 * 反馈原话：「当页面刷新之后，左侧边栏会展开，我希望保持左侧边栏是关闭的状态。」
 *
 * 这里钉四件事：
 *   1. 决策口径 —— 已收起不重复收；已展开必收；帧未渲染时按 store 初始值
 *      推断（宽视口默认展开→收，窄视口默认收起→不动，动了反而展开）；
 *   2. DOM 读法 —— 收起属性在=true / 帧已渲染无属性=false / 帧未渲染=null，
 *      且选择器锚定宿主 AppFrame 的真实标记；
 *   3. 幂等 —— 同一次页面加载只处理一次（HMR 重应用不重复 toggle）；
 *   4. 挂载点 —— index.ts 必须在 apply() 里调用它。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-sidebar-'))

try {
  const out = join(dir, 't.mjs')
  await build({
    entryPoints: [join(root, 'client/src/sidebar-collapse.ts')],
    bundle: true,
    format: 'esm',
    outfile: out,
    platform: 'neutral',
    logLevel: 'silent',
    // session-subscribe 被 readService 拖进来（仅 type 级 cordis import，打包无外部依赖）
  })
  const m = await import(out)

  let fail = 0
  const check = (label, ok, detail = '') => {
    if (!ok) fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  }

  const decide = (collapsed, innerWidth) =>
    m.decideSidebarCollapse({ collapsed, innerWidth })

  // —— 1. 决策口径 ——
  check('已收起 → skip（不重复收，幂等）',
    decide(true, 1440).action === 'skip' && decide(true, 1440).reason === 'already-collapsed')
  check('已展开 → toggle（核心需求：收起）',
    decide(false, 1440).action === 'toggle' && decide(false, 1440).reason === 'expanded')
  check('帧未渲染 + 宽视口（store 初始 280 展开）→ toggle（首帧前收掉，不闪宽栏）',
    decide(null, 1440).action === 'toggle' && decide(null, 1440).reason === 'boot-default-expanded')
  check('帧未渲染 + 窄视口（store 初始收起）→ skip（toggle 会反向展开）',
    decide(null, 1023).action === 'skip' && decide(null, 1023).reason === 'narrow-default-collapsed')
  check('帧未渲染 + 恰在分界 1024 → toggle（与宿主 SIDEBAR_AUTO_COLLAPSE 同口径）',
    decide(null, m.NARROW_AUTO_COLLAPSE).action === 'toggle')
  check('窄视口但帧已渲染且展开 → 仍 toggle（宿主逻辑展开了就该收）',
    decide(false, 800).action === 'toggle')

  // —— 2. DOM 读法 ——
  const fakeRoot = (hit) => ({
    querySelector: (sel) => {
      if (hit.includes(sel)) return {}
      return null
    },
  })
  check('收起属性在 → true',
    m.readSidebarCollapsed(fakeRoot([m.SIDEBAR_COLLAPSED_SEL])) === true)
  check('帧已渲染但无收起属性 → false（展开）',
    m.readSidebarCollapsed(fakeRoot([m.FRAME_PROOF_SEL])) === false)
  check('两者皆无（帧未渲染）→ null',
    m.readSidebarCollapsed(fakeRoot([])) === null)
  check('querySelector 抛异常 → null（不炸）',
    m.readSidebarCollapsed({ querySelector: () => { throw new Error('x') } }) === null)
  check('选择器锚定宿主 AppFrame 标记',
    m.SIDEBAR_COLLAPSED_SEL === '[data-sidebar-collapsed]' &&
    m.FRAME_PROOF_SEL.includes('[data-rightbar-collapsed]') &&
    m.FRAME_PROOF_SEL.includes('.ts-side-entry'))
  check('分界常量与宿主一致（SIDEBAR_AUTO_COLLAPSE = 1024）',
    m.NARROW_AUTO_COLLAPSE === 1024)

  // 宿主源文件存在时校验属性确实由 AppFrame 挂出（缺失则跳过，不强绑机器路径）
  let hostFile = null
  try {
    const req = createRequire(join(homedir(), '.dsh', 'profiles', 'x.js'))
    hostFile = join(dirname(req.resolve('@deepseek-ai/dsh-client-ui-layout/package.json')), 'lib/client.js')
  } catch {
    try {
      const req = createRequire(join(root, 'x.js'))
      hostFile = join(dirname(req.resolve('@deepseek-ai/dsh-client-ui-layout/package.json')), 'lib/client.js')
    } catch { /* 找不到宿主包 → 跳过 */ }
  }
  if (hostFile && existsSync(hostFile)) {
    const src = readFileSync(hostFile, 'utf8')
    check('宿主 AppFrame 确实按属性挂收起态（data-sidebar-collapsed ≥ 3 处）',
      (src.match(/data-sidebar-collapsed/g) || []).length >= 3)
    check('宿主 store 无 persist（根因未变：刷新必回默认值）',
      /defineStore/.test(src) && !/persist:\s*["'`]/.test(src))
    check('宿主分界常量 1024 与我们一致', /SIDEBAR_AUTO_COLLAPSE = 1024/.test(src))
  } else {
    console.log('SKIP  宿主 dsh-client-ui-layout 包不可解析，跳过源码锚定校验')
  }

  // —— 3. 幂等（window 标记） ——
  {
    // installSidebarCollapse 直接摸 window/DOM/定时器，这里用最小桩验证
    // 「同一次页面加载只处理一次」这条不变量。
    const g = globalThis
    const saved = { window: g.window, document: g.document }
    let toggled = 0
    const fakeLayout = { toggleSidebar: () => { toggled++ } }
    const frameAttrs = new Set([m.FRAME_PROOF_SEL]) // 帧已渲染、展开
    g.window = {
      innerWidth: 1440,
      document: undefined,
      setInterval: () => 0,
      clearInterval: () => {},
      setTimeout: () => 0,
    }
    g.document = { querySelector: (sel) => (frameAttrs.has(sel) ? {} : null) }
    try {
      const ctx = { get: (name) => (name === 'layout' ? fakeLayout : undefined) }
      m.installSidebarCollapse(ctx)
      check('首装：帧已渲染且展开 → toggle 一次', toggled === 1)
      m.installSidebarCollapse(ctx)
      check('HMR 重应用：不重复 toggle（同一次页面加载只处理一次）', toggled === 1)
      const marker = g.window.__tsSidebarCollapse
      check('标记落位：handled/action/reason 可诊断',
        !!marker && marker.handled === true && marker.action === 'toggle' && marker.reason === 'expanded')
    } finally {
      g.window = saved.window
      g.document = saved.document
    }
  }

  // —— 4. 挂载点 ——
  const idx = readFileSync(join(root, 'client/src/index.ts'), 'utf8')
  check('index.ts 引入了 sidebar-collapse', /from '\.\/sidebar-collapse'/.test(idx))
  check('index.ts 在 apply() 里调用了它', /installSidebarCollapse\(ctx\)/.test(idx))
  check('挂在 try/catch 里（失败不阻断插件其它功能）',
    /try \{\s*\n\s*installSidebarCollapse\(ctx\)\s*\n\s*\} catch/.test(idx))

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
