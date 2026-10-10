/**
 * 面板宽度策略自检（纯函数，不需要浏览器）。
 *
 *   node scripts/check-panel-width.mjs
 *
 * 这次反馈是「面板太宽了，宽度应该根据对话的最长来」。上一版的 bug 正是宽度
 * 与内容完全无关（永远顶到上限），所以这里把「跟着内容走」钉成断言。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-width-'))

try {
  const out = join(dir, 'w.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/panel-width.ts')],
    bundle: true, format: 'esm', outfile: out, platform: 'neutral', logLevel: 'silent',
  })
  const m = await import(out)

  let fail = 0
  const check = (label, ok, detail = '') => {
    if (!ok) fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  }
  /** 无 canvas 环境 → textWidth 走字符估算分支（正是我们要顺带验证的退化路径） */
  const row = (title, extra = {}) => ({ title, ...extra })

  const W = (rows, avail = 1200) => m.clampPanelWidth(m.widestRowWidth(rows), avail)

  // —— 核心：宽度必须跟着内容走 ——
  const short = W([row('修 bug')])
  const medium = W([row('把面板宽度改成跟着内容走')])
  const long = W([row('太长不看'.repeat(30))])
  // 短标题必须**正好**落在下限：这才能拓住「凭空多一段固定宽度」这类 bug。
  // （之前只写 `short < MAX`，结果 clamp 里多加 150px 也能过 —— 拓不住真问题）
  check('短标题 → 正好是最窄宽度', short === m.POP_W_MIN, `${short}px (min ${m.POP_W_MIN})`)
  check('内容变长 → 面板变宽（单调）', medium >= short && long >= medium, `${short} → ${medium} → ${long}`)
  check('长标题 → 封顶在上限', long === m.POP_W_MAX, `${long}px (max ${m.POP_W_MAX})`)
  // 中间档必须真的出现（否则等于“非最小即最大”，等于没跟内容走）
  const mid = medium
  check('存在中间宽度（不是非最小即最大）', mid > m.POP_W_MIN && mid < m.POP_W_MAX, `${mid}px`)
  // —— 上限必须比旧版（440）紧，否则「太宽」没解决 ——
  check('上限不超过 380px（比旧的 440 更紧凑）', m.POP_W_MAX <= 380, `${m.POP_W_MAX}px`)
// —— 下限必须放得下设置区（固定控件不缩，不像清单行能靠省略号收）——
check('最窄宽度 ≥ 设置区所需的宽度', m.POP_W_MIN >= m.SETTINGS_MIN_W - 0.001,
  `min=${m.POP_W_MIN} need=${Math.round(m.SETTINGS_MIN_W)}`)
check('设置区最小宽度是个非零的实数（说明真的算出来了）',
  m.SETTINGS_MIN_W > 100 && Number.isFinite(m.SETTINGS_MIN_W),
  `${Math.round(m.SETTINGS_MIN_W)}px`)
// 换了标签文案 / 控件宽度，下限要跟着变 —— 写死就会出现“字变长了面板还是旧宽度”
check('下限不是写死的 236（会随设置区宽度自调）', m.POP_W_MIN > 236, `${m.POP_W_MIN}px`)

  // —— 宽度由最长那条决定，短的条目不拉低 ——
  const mixed = W([row('短'), row('比较长的一个标题需要更宽的面板'), row('中')])
  check('取最长的那条决定宽度', mixed >= W([row('比较长的一个标题需要更宽的面板')]), `${mixed}px`)

  // —— 标签行也能撐宽（否则「继续」按钮会被挤出去）——
  const withTags = W([row('短', { sub: '一个相当长的项目名称在这里', shortReason: '上下文' })])
  check('长项目名 + 原因标签会撑宽', withTags > W([row('短')]), `${W([row('短')])} → ${withTags}`)
// 注意：这里要比**未夹紧**的 rowOuterWidth。下限涨到 272 之后，
// 上面那种短行无论有没有「继续」都会夹到下限，比 clamp 后的值永远相等。
check('有「继续」按钮的行更宽',
  m.rowOuterWidth(row('同样的标题', { canContinue: true })) > m.rowOuterWidth(row('同样的标题')),
  `${Math.round(m.rowOuterWidth(row('同样的标题')))} → ${Math.round(m.rowOuterWidth(row('同样的标题', { canContinue: true })))}`)
// 反向：两者都在下限以下时，夹紧后的面板宽度应当相等（宽的是**行**，不是面板）
check('低于下限时两种行夹出同一个面板宽度（面板宽度是全局的）',
  W([row('同样的标题', { canContinue: true })]) === W([row('同样的标题')]))

  // —— 直接拓「装饰是否被重复计算」：宽度必须与内容宽度**线性**对应 ——
  // 重复加常量的话，内容宽差 Δ 而面板宽也差 Δ，但绝对位置会整体偏移；
  // 用 rowOuterWidth 与 clamp 的关系直接验：clamp 不能自己再加东西。
  // 取一个正好能放进区间的行，clamp 后应当**等于** rowOuterWidth（不夹紧、不偏移）。
  {
    const r = row('刚好放得下的标题')
    const outer = m.rowOuterWidth(r)
    const got = m.clampPanelWidth(outer, 1200)
    const inRange = outer > m.POP_W_MIN && outer < m.POP_W_MAX
    check('clamp 不加料：区间内时 宽度 === rowOuterWidth', !inRange || got === outer,
      `outer=${Math.round(outer)} got=${got}`)
  }
  // 两条只差一个「继续」按钮的行：宽度差应当等于操作区之差，而不是任意值
  {
    const a = m.rowOuterWidth(row('一样的标题'))
    const b = m.rowOuterWidth(row('一样的标题', { canContinue: true }))
    const delta = Math.round(b - a)
    check('「继续」按钮只加操作区那点宽度（≤ 50px）', delta > 0 && delta <= 50, `Δ=${delta}px`)
  }

  // —— 边界与健壮性 ——
  check('空清单 → 最窄（不撑宽）', W([]) === m.POP_W_MIN, `${W([])}px`)
  check('可用空间不足 → 不超出窗口右缘', W([row('很长'.repeat(40))], 200) <= 200, `${W([row('很长'.repeat(40))], 200)}px`)
  check('可用空间极小时下限让位（不溢出窗口）', W([row('x')], 10) <= 10, `${W([row('x')], 10)}px`)
  check('NaN 内容宽 → 退化成下限而不是 NaN', m.clampPanelWidth(NaN, 800) === m.POP_W_MIN)
  check('负数内容宽 → 退化成下限', m.clampPanelWidth(-999, 800) === m.POP_W_MIN)
  check('NaN 可用宽 → 不产生 NaN', Number.isFinite(m.clampPanelWidth(300, NaN)))
  check('宽度总是整数（避免亚像素抖动）', Number.isInteger(W([row('小数宽度测试标题')])))

  // —— 文本估算本身 ——
  check('空串宽 0', m.textWidth('', 12) === 0)
  // 中文比 ASCII 宽 —— 但不拿等字符数比：CJK 一个字 ≈ 1em，ASCII 一个字母只 ≈ 0.55em。
  // 这里比**相同字符数**下的宽度，验证退化估算的 CJK 判定真的生效。
  check('同为 4 字符时 CJK 比 ASCII 宽', m.textWidth('中文标题', 12.5) > m.textWidth('abcd', 12.5),
    `${m.textWidth('中文标题', 12.5)} vs ${m.textWidth('abcd', 12.5)}`)

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
