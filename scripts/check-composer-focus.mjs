/**
 * 点击输入条任意空白即聚焦自检（纯函数 + 假 DOM，不需要浏览器）。
 *
 *   node scripts/check-composer-focus.mjs
 *
 * 需求原话：「鼠标点了输入框（第一行/第二行/第三行）的中下行时不出现光标，
 * 希望点输入框任意位置（除了发送、更换模型、权限控制等按钮开关）都能进入可编辑状态。」
 *
 * 这里钉四件事：
 *   1. 决策口径 —— 盒子空白处 focus；按钮/表单件、编辑面内原生区、拖选中、
 *      不可编辑态一律 skip，且各给唯一 reason（可被诊断读出）；
 *   2. 选择器 —— 锚定宿主 ui-conversation 的真实标记
 *      （data-input-scroll / data-composer-input），宿主源存在时校验；
 *   3. 动作 —— focus 走 preventScroll，光标 API 落空时收拢到文末，不抛异常；
 *   4. 挂载点 —— index.ts 必须在 apply() 里调用它（try/catch 内）。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-cfocus-'))

try {
  const out = join(dir, 't.mjs')
  await build({
    entryPoints: [join(root, 'client/src/composer-focus.ts')],
    bundle: true,
    format: 'esm',
    outfile: out,
    platform: 'neutral',
    logLevel: 'silent',
  })
  const m = await import(out)

  let fail = 0
  const check = (label, ok, detail = '') => {
    if (!ok) fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  }

  // —— 假 DOM：一棵最小的输入条结构 ——
  // scroll > grow > input(contenteditable) ；按钮在 scroll 之外
  const makeDom = ({ editable = true } = {}) => {
    const input = {
      isContentEditable: editable,
      contains: () => false,
      focusCalls: [],
      focus(opts) { this.focusCalls.push(opts ?? 'plain') },
      ownerDocument: null,
    }
    const scroll = {
      querySelector: (sel) => (sel === m.COMPOSER_INPUT_SEL ? input : null),
      contains: () => true,
    }
    const el = (kind) => ({
      kind,
      closest(sel) {
        if (kind === 'input' && sel.includes('data-composer-input')) return this
        if (kind === 'button' && sel.startsWith('button')) return this
        if (kind === 'button' && sel.includes('role')) return null
        if (kind === 'outside') return null
        if (sel.includes('data-input-scroll')) return scroll
        return null
      },
    })
    const rootDom = { querySelector: (sel) => (sel === m.INPUT_SCROLL_SEL ? scroll : null) }
    input.ownerDocument = {
      getSelection: () => ({ isCollapsed: true, anchorNode: null, removeAllRanges() {}, addRange() {} }),
      createRange: () => ({ selectNodeContents() {}, collapse() {} }),
      querySelector: (sel) => rootDom.querySelector(sel),
    }
    return { rootDom, scroll, input, el }
  }

  const click = (target, extra = {}) => ({
    target,
    selectionCollapsed: true,
    selectionInScroll: false,
    ...extra,
  })

  // —— 1. 决策口径 ——
  {
    const d = makeDom()
    const r = m.decideComposerFocus(click(d.el('grow')), d.rootDom)
    check('点盒子空白（grow 背景）→ focus',
      r.action === 'focus' && r.reason === 'click-to-focus' && r.input === d.input)
  }
  {
    const d = makeDom()
    const r = m.decideComposerFocus(click(d.el('button')), d.rootDom)
    check('点按钮（发送/换模型/权限等）→ skip interactive-control',
      r.action === 'skip' && r.reason === 'interactive-control')
  }
  {
    const d = makeDom()
    const r = m.decideComposerFocus(click(d.el('input')), d.rootDom)
    check('点编辑面内（原生会放光标）→ skip native-focus',
      r.action === 'skip' && r.reason === 'native-focus')
  }
  {
    const d = makeDom()
    const r = m.decideComposerFocus(
      click(d.el('grow'), { selectionCollapsed: false, selectionInScroll: true }),
      d.rootDom,
    )
    check('拖选中/刚拖选完 → skip selecting（不打断选区）',
      r.action === 'skip' && r.reason === 'selecting')
  }
  {
    const d = makeDom({ editable: false })
    const r = m.decideComposerFocus(click(d.el('grow')), d.rootDom)
    check('编辑面不可编辑（空态/禁用）→ skip editor-not-editable',
      r.action === 'skip' && r.reason === 'editor-not-editable')
  }
  {
    const d = makeDom()
    const r = m.decideComposerFocus(click(d.el('outside')), d.rootDom)
    check('滚动口之外 → skip outside-scroll',
      r.action === 'skip' && r.reason === 'outside-scroll', `(reason=${r.reason})`)
  }
  {
    const noScroll = { querySelector: () => null }
    const r = m.decideComposerFocus(click(null), noScroll)
    check('页面上根本没有输入条 → skip outside-scroll（不炸）',
      r.action === 'skip' && r.reason === 'outside-scroll')
  }

  // —— 2. 选择器锚定 ——
  check('选择器锚定宿主标记',
    m.INPUT_SCROLL_SEL === '[data-input-scroll]' &&
    m.COMPOSER_INPUT_SEL === '[data-composer-input]')
  check('交互控件排除面覆盖发送/模型/权限按钮形态',
    m.INTERACTIVE_SEL.includes('button') && m.INTERACTIVE_SEL.includes('select') &&
    m.INTERACTIVE_SEL.includes('[role="switch"]') && m.INTERACTIVE_SEL.includes('[role="menuitem"]'))

  // 宿主源文件存在时校验标记（缺失则跳过，不强绑机器路径）
  let hostFile = null
  for (const base of [join(homedir(), '.dsh', 'profiles', 'x.js'), join(root, 'x.js')]) {
    try {
      const req = createRequire(base)
      hostFile = join(dirname(req.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json')), 'lib/client.js')
      break
    } catch { /* 下一个候选 */ }
  }
  if (hostFile && existsSync(hostFile)) {
    const src = readFileSync(hostFile, 'utf8')
    check('宿主确有 data-input-scroll / data-composer-input 标记',
      src.includes('"data-input-scroll": true') && src.includes('"data-composer-input": true'))
    check('占位符 pointer-events:none（点击穿透到背景，即不聚焦的根因）',
      src.includes('pointer-events:none') && src.includes('data-composer-placeholder'))
  } else {
    console.log('SKIP  宿主 dsh-client-ui-conversation 包不可解析，跳过源码锚定校验')
  }

  // —— 3. 动作 ——
  {
    const d = makeDom()
    const ok = m.focusComposerAt(d.input, 10, 20)
    check('focus 走 preventScroll（不跳视口）',
      ok === true && d.input.focusCalls.length === 1 && d.input.focusCalls[0]?.preventScroll === true)
  }
  {
    const input = {
      isContentEditable: true,
      calls: [],
      focus(opts) { this.calls.push(opts) },
      ownerDocument: null,
    }
    input.focus = function (opts) {
      this.calls.push(opts)
      if (opts && opts.preventScroll) throw new Error('no preventScroll support')
    }
    input.ownerDocument = {
      getSelection: () => ({ isCollapsed: true, removeAllRanges() {}, addRange() {} }),
      createRange: () => ({ selectNodeContents() {}, collapse() {} }),
    }
    const ok = m.focusComposerAt(input, 0, 0)
    check('preventScroll 不被支持时回落普通 focus', ok === true && input.calls.length === 2)
  }

  // —— 4. 挂载点 ——
  const idx = readFileSync(join(root, 'client/src/index.ts'), 'utf8')
  check('index.ts 引入了 composer-focus', /from '\.\/composer-focus'/.test(idx))
  check('index.ts 在 apply() 里调用了它', /installComposerFocus\(\)/.test(idx))
  check('挂在 try/catch 里（失败不阻断插件其它功能）',
    /try \{\s*\n\s*installComposerFocus\(\)\s*\n\s*\} catch/.test(idx))
  check('模块内有 installed 幂等闸（重复 apply 不重复挂监听）',
    /let installed = false/.test(readFileSync(join(root, 'client/src/composer-focus.ts'), 'utf8')))

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
