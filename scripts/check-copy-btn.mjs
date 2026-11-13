/**
 * 消息复制按钮自检（纯文本断言，不需要浏览器）。
 *
 *   node scripts/check-copy-btn.mjs
 *
 * 用户连续反馈「复制按钮还是没实现，还没看到」三次，每次的根因都不同，
 * 这里把三条一起钉住，防止后续改动把它们任何一个改回去：
 *
 * 根因 1（样式根本没进 DOM）：
 *   styles.ts 的 injectProjectCenterStyles 原先只在 ControlRoom / ProjectCenter
 *   的 useEffect 里调用。MsgList 被主对话卡片与探索者窗口使用，而这两个宿主
 *   不保证渲染过那两个组件 —— 于是 .ts-copy-btn 的规则在 DOM 里压根不存在，
 *   按钮带 display:none 就永远不显形。修复：MsgList 自己也 inject（函数按
 *   style id 幂等，多处调用不重复插）。
 *
 * 根因 2（按钮跟着时间一起消失）：
 *   MsgTime 开头 `if (!time) return null`，而 copyContent 是后来才加的参数。
 *   宿主事件没带 time 的消息 → 整个组件返回 null → 复制按钮也没了。
 *   修复：把复制按钮拆成独立的 CopyButton，MsgTime 在无时间戳时仍渲染它。
 *
 * 根因 3（要悬停才现身，等于永远看不见）：
 *   原样式 display:none，只有 .ts-msg-time:hover 才 display:inline-flex。
 *   时间那行小字很小，用户几乎不可能正好悬停到 → 反复说「看不到」。
 *   修复：改为常显 display:inline-flex，悬停只提不透明度。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const msgs = readFileSync(join(root, 'client/src/panel/MsgList.tsx'), 'utf8')
const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')

let fail = 0
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) fail++
}

/** 取出某个选择器的声明块（第一个匹配） */
function block(sel) {
  const i = styles.indexOf(sel + ' {')
  if (i < 0) return ''
  const j = styles.indexOf('}', i)
  return j < 0 ? '' : styles.slice(i, j + 1)
}

// —— 根因 1：样式注入 ——
check('MsgList 引入并调用了 injectProjectCenterStyles',
  /import \{ injectProjectCenterStyles \} from '\.\/styles'/.test(msgs) &&
  /useEffect\(\(\) => \{ injectProjectCenterStyles\(\) \}, \[\]\)/.test(msgs))
check('注入函数按 style id 幂等（多处调用不重复插样式）',
  /if \(document\.getElementById\(STYLE_ID\)\) return/.test(styles))

// —— 根因 2：复制与时间解耦 ——
check('存在独立的 CopyButton 组件',
  /function CopyButton\(\{ text \}: \{ text: string \}\)/.test(msgs))
check('MsgTime 无时间戳时不整块返回 null，仍有复制出口',
  /if \(!hasTime\) \{[\s\S]{0,260}?CopyButton text=\{copyContent\}/.test(msgs))
check('有正文就有按钮（两个分支都渲染 CopyButton）',
  (msgs.match(/<CopyButton text=\{copyContent\} \/>/g) || []).length === 2)
check('复制失败有 execCommand 兜底（非安全上下文无 clipboard）',
  /function fallbackCopyText/.test(msgs) &&
  /document\.execCommand\('copy'\)/.test(msgs))
check('复制后 1.5s 还原 ✓',
  /window\.setTimeout\(\(\) => setCopied\(false\), 1500\)/.test(msgs))
check('按钮点击不冒泡（不触发外层折叠/跳转）',
  /const handleCopy = \(e: React\.MouseEvent\) => \{\s*\n\s*e\.stopPropagation\(\)/.test(msgs))

// —— 根因 3：常显 + 用户点名的三条视觉要求 ——
const btn = block('.ts-copy-btn')
check('按钮常显（display 不是 none）',
  /display:inline-flex/.test(btn) && !/display:none/.test(btn))
check('去掉背景色（background:transparent）',
  /background:transparent/.test(btn))
check('去掉边框',
  /border:none/.test(btn))
check('与时间同字号（同一个 --ts-fs 系数 0.84）',
  /font-size:calc\(var\(--ts-fs, 12\.5px\) \* 0\.84\)/.test(btn) &&
  /\.ts-msg-time \{[^}]*font-size:calc\(var\(--ts-fs, 12\.5px\) \* 0\.84\)/.test(styles))
check('与时间的间距拉大到 10px',
  /margin-left:10px/.test(btn))
check('图标尺寸跟字号走，不写死 px',
  /width:1em; height:1em/.test(block('.ts-copy-btn svg')))
check('悬停只提不透明度，不加底色',
  /\.ts-copy-btn:hover[^{]*\{[^}]*opacity:1[^}]*background:transparent/.test(styles))

// —— 根因 4：容器 opacity 会把按钮一起乘半（0.5 × 0.5 = 0.25，等于看不见）——
const timeBlock = block('.ts-msg-time')
const procBlock = block('.ts-proc-time')
check('容器不再带 opacity（否则按钮被乘半）',
  !/opacity:/.test(timeBlock) && !/opacity:/.test(procBlock))
check('透明度下沉到文字元素上',
  /\.ts-msg-time-text \{[^}]*opacity:\.5/.test(styles) &&
  /\.ts-proc-time \.ts-msg-time-text \{[^}]*opacity:\.5/.test(styles))
check('时间文字包在自己的 span 里（按钮不当容器的 opacity 受害者）',
  /<span className="ts-msg-time-text">\{text\}<\/span>/.test(msgs))

// —— 传给哪些地方：不能漏掉最常看的两处 ——
check('用户气泡带复制', /<MsgTime time=\{m\.time\} copyContent=\{m\.content\} \/>/.test(msgs))
check('模型回答带复制', /<MsgTime time=\{t\.answer\.time\} copyContent=\{t\.answer\.content\} \/>/.test(msgs))
check('过程项 / 注入行 / 排队气泡都带复制',
  (msgs.match(/copyContent=\{msg\.content\}|copyContent=\{m\.content\}/g) || []).length >= 4)
check('不嵌进 <button>（ProcessGroup 头部不传 copyContent，button 套 button 非法）',
  /<MsgTime time=\{items\[items\.length - 1\]\?\.time\} className="ts-proc-time" \/>/.test(msgs))

if (fail) {
  console.log(`\n${fail} FAILED`)
  process.exit(1)
}
console.log('\nALL PASS')
