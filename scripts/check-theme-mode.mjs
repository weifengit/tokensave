/**
 * 主题三态（跟随系统 / 深色 / 浅色）自检 —— 纯函数 + 假 ctx，不需要浏览器。
 *
 *   node scripts/check-theme-mode.mjs
 *
 * 需求是「参考 info_report 的『跟随系统 / 深色 / 浅色』，补进右上角齿轮的浮动面板」。
 * 参考实现与这里有一处关键差别，必须在断言里钉住，否则下次很容易照着抄回去：
 *
 *   info_report 是**独立页面**，自己存 `intel:theme.v1` 并解析 system；
 *   tokensave 是**挂在 DSH 里的插件**，宿主已经有主题运行时（`ctx.theme`）——
 *   偏好存在宿主用户设置里，`setTheme` 是唯一写入入口，`theme/change` 是唯一广播。
 *
 * 所以本模块的契约是「只桥接、不存第二份」。本自检钉五件事：
 *   A. 三态归一：认不出的值 → null（**不能**默认成 system，否则面板会高亮用户没选的按钮）；
 *   B. 读：取宿主 ctx.theme 的 preference；
 *   C. 写：只走 setTheme，失败返回 false（服务缺失 / setTheme 抛错都不假装成功）；
 *   D. 订阅：theme/change 与 inject 补读两条信号都挂，退订要把两条都摘掉；
 *   E. 接线：齿轮面板里真的有这一块（data-desk-set-block="theme"），且没有自建存储。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-theme-mode-'))

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

/** 假 cordis ctx：get(name) 取服务、on() 记监听、inject() 记依赖回调。 */
function fakeCtx(services = {}) {
  const handlers = new Map()
  const injects = []
  return {
    services,
    handlers,
    injects,
    get: (name) => services[name],
    on: (event, fn) => {
      handlers.set(event, fn)
      return () => handlers.delete(event)
    },
    inject: (names, fn) => {
      injects.push({ names, fn })
      return () => {
        const at = injects.findIndex((x) => x.fn === fn)
        if (at >= 0) injects.splice(at, 1)
      }
    },
  }
}

try {
  const out = join(dir, 't.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/theme-mode.ts')],
    bundle: true,
    format: 'esm',
    outfile: out,
    platform: 'neutral',
    logLevel: 'silent',
  })
  const m = await import(out)

  // —— A. 三态归一 ——
  check('归一并：三个合法值原样返回',
    m.normalizeThemeMode('system') === 'system' &&
    m.normalizeThemeMode('dark') === 'dark' &&
    m.normalizeThemeMode('light') === 'light')
  check('归一：第三方主题 id / 脏值 / 空值一律 null（不能默认成 system）',
    m.normalizeThemeMode('solarized') === null &&
    m.normalizeThemeMode('') === null &&
    m.normalizeThemeMode(null) === null &&
    m.normalizeThemeMode(undefined) === null)
  check('三态顺序与文案：跟随系统在最前（宿主默认值）',
    m.THEME_MODES[0] === 'system' && m.THEME_MODES.length === 3 &&
    m.THEME_MODE_LABEL.system === '跟随系统' &&
    m.THEME_MODE_LABEL.dark === '深色' &&
    m.THEME_MODE_LABEL.light === '浅色')

  // —— B. 读偏好 ——
  const snap = (preference, scheme) => ({ preference, active: { colorScheme: scheme } })
  const c1 = fakeCtx({ theme: { getTheme: () => snap('light', 'light'), setTheme: () => {} } })
  check('读：拿到宿主偏好', m.readThemeMode(c1) === 'light')
  check('读：system 偏好原样返回（解析留给宿主）', m.readThemeMode(
    fakeCtx({ theme: { getTheme: () => snap('system', 'dark') } })) === 'system')
  check('读：生效配色单独可读（面板显示「跟随系统 · 当前深色」）',
    m.readActiveScheme(fakeCtx({ theme: { getTheme: () => snap('system', 'dark') } })) === 'dark')
  check('读：服务缺失 → null', m.readThemeMode(fakeCtx()) === null && m.readActiveScheme(fakeCtx()) === null)
  check('读：getTheme 抛错 → null（不把工作台带崩）',
    m.readThemeMode(fakeCtx({ theme: { getTheme: () => { throw new Error('boom') } } })) === null)
  check('读：未知偏好 → null（第三方主题不能把三枚按钮搞成全不高亮又乱点）',
    m.readThemeMode(fakeCtx({ theme: { getTheme: () => snap('solarized', 'dark') } })) === null)

  // —— C. 写偏好 ——
  const calls = []
  const c2 = fakeCtx({ theme: { getTheme: () => snap('system', 'dark'), setTheme: (id) => calls.push(id) } })
  check('写：只走宿主 setTheme（不自己 localStorage）', m.writeThemeMode(c2, 'dark') === true && calls.at(-1) === 'dark')
  check('写：system 也照样交给宿主（由宿主解析系统深浅）',
    m.writeThemeMode(c2, 'system') === true && calls.at(-1) === 'system')
  check('写：非法值被拦下、不调宿主', m.writeThemeMode(c2, 'solarized') === false && calls.length === 2)
  check('写：服务缺失 → false（面板据此不让按钮假装生效）', m.writeThemeMode(fakeCtx(), 'dark') === false)
  check('写：setTheme 抛错 → false 且不冒泡',
    m.writeThemeMode(fakeCtx({ theme: { setTheme: () => { throw new Error('boom') } } }), 'dark') === false)

  // —— D. 订阅 ——
  let hits = 0
  const c3 = fakeCtx({ theme: { getTheme: () => snap('system', 'dark'), setTheme: () => {} } })
  const off = m.subscribeThemeMode(c3, () => { hits++ })
  check('订阅：theme/change 与 inject 补读两条信号都挂',
    c3.handlers.has('theme/change') && c3.injects.length === 1 &&
    c3.injects[0].names.includes('theme'))
  c3.handlers.get('theme/change')()
  check('订阅：宿主切主题 → 通知一次', hits === 1)
  c3.injects[0].fn()
  check('订阅：服务后到（inject 就绪回调）也通知一次', hits === 2)
  off()
  check('退订：两条信号都摘掉',
    !c3.handlers.has('theme/change') && c3.injects.length === 0)

  // —— E. 接线与「不自建真相源」——
  const dock = readFileSync(join(root, 'client/src/panel/DeskDock.tsx'), 'utf8')
  const src = readFileSync(join(root, 'client/src/panel/theme-mode.ts'), 'utf8')
  check('面板：齿轮里多出「主题」块，三态各自一枚按钮',
    /data-desk-set-block="theme"/.test(dock) &&
    /data-desk-theme=\{mode\}/.test(dock) &&
    /THEME_MODES\.map\(\(mode\) => \(/.test(dock))
  check('面板：主题块排在皮肤**之前**（主题决定整页配色，皮肤是它上面的花纹）',
    dock.indexOf('data-desk-set-block="theme"') > 0 &&
    dock.indexOf('data-desk-set-block="theme"') < dock.indexOf('data-desk-set-block="skin"'))
  check('面板：服务缺失时按钮置灰 + 给原因（不是点了没反应）',
    /disabled=\{!themeMode\}/.test(dock) && /宿主未提供主题服务/.test(dock) &&
    /\.ts-set-opt\[disabled\]/.test(dock))
  check('面板：标题栏右侧直接显示当前态（跟随系统时还补实际深浅）',
    /data-desk-theme-status=""/.test(dock) && /当前\$\{themeScheme === 'light' \? '浅色' : '深色'\}/.test(dock))
  check('唯一真相源：模块不自己存偏好（只读宿主 ctx.theme）',
    // 注意只看**代码**：注释里会提到「不要存 tokensave:theme-mode.v1」这句反例。
    !/localStorage\.(get|set)Item/.test(src) &&
    !/THEME_KEY\s*=/.test(src) &&
    /readService<ThemeServiceLike>\(ctx, 'theme'\)/.test(src))
  check('唯一真相源：面板切换只调 bridged 入口，不直接碰 ctx.theme',
    /const switchThemeMode = \(next: ThemeMode\) => \{/.test(dock) &&
    /writeThemeMode\(getClientContext\(\), next\)/.test(dock) &&
    // 面板不直接调 ctx.theme.setTheme（绕过归一与失败处理的那条路）
    !/getClientContext\(\)\??\.theme\.setTheme/.test(dock))
  check('宿主主题变化后同步既有皮肤栏（两个监听器不打架）',
    /subscribeThemeMode\(ctx, sync\)/.test(dock) &&
    /window\.addEventListener\('ts-theme-changed', on\)/.test(dock))

  if (fail) {
    console.log(`\n${fail} 项未通过`)
    process.exitCode = 1
  } else {
    console.log('\n全部通过')
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
