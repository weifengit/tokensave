/**
 * 面板 UI 约束自检（静态检查，不需要浏览器）。
 *
 *   node scripts/check-panel-ui.mjs
 *
 * 为什么要有它：这次收到的 6 条反馈里有 4 条是**布局约束被违反**（面板被长文本撐宽、
 * 设置区与清单区不同宽、标签页重复信息、旧浮层没删干净）。约束写在 CSS 里很容易在
 * 下次改动时被无意破坏，所以把每条反馈钉成一个可执行断言。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
const tsx = readFileSync(join(root, 'client/src/panel/ControlRoomEntry.tsx'), 'utf8')

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

/** 取出某个选择器的规则体（第一个匹配） */
const ruleOf = (sel) => {
  const i = css.indexOf(`\n${sel} {`)
  if (i < 0) return null
  return css.slice(i + 1, css.indexOf('}', i) + 1)
}
/** 类名在 tsx / css 里各出现几次 */
const countIn = (hay, needle) => hay.split(needle).length - 1

// —— 反馈 1：旧的「点角标 → 另一个浮层」必须整体删掉 ——
check('旧浮层组件 ItemPopover 已删除', !tsx.includes('ItemPopover'))
check('旧浮层的挂载分支已删除', !/\{pop && \(/.test(tsx))
check('旧浮层状态 pop/setPop 已删除', !/\bpop\b\s*[,}]/.test(tsx) || !tsx.includes('setPop'))
check('PopKind 类型已删除', !tsx.includes('PopKind'))
check('旧浮层专用 CSS ts-warn-allread 已删除', !css.includes('ts-warn-allread'))
check('旧浮层专用 CSS ts-warn-cont 已删除', !css.includes('.ts-warn-cont '))
check('旧浮层专用 CSS ts-warn-mark-read-btn 已删除', !css.includes('ts-warn-mark-read-btn'))

// —— 反馈 2：不再分「活跃 / 需处理 / 已完成」三个 tab ——
check('tab 相关 CSS 已删除', !css.includes('ts-hover-tab'))
check('tab 相关状态已删除', !tsx.includes('activeTab') && !tsx.includes('setActiveTab') && !tsx.includes('hoverTab'))
check('tablist 角色已删除', !tsx.includes('role="tablist"') && !tsx.includes('role="tab"'))

// —— 反馈 5：宽度必须固定，任何一块都不能被内容撐开 ——
const hoverPop = ruleOf('.ts-hover-pop')
check('.ts-hover-pop 不再用 max-content（否则内容定宽）', !!hoverPop && !hoverPop.includes('max-content'))
check('.ts-hover-pop 是 100% 容器（宽度由 JS 固定给）', !!hoverPop && hoverPop.includes('width:100%'))
for (const sel of ['.ts-sound-body', '.ts-cont-block', '.ts-hover-pop']) {
  const r = ruleOf(sel)
  check(`${sel} 声明 width:100%`, !!r && r.includes('width:100%'))
}
// 播放条/清单行里的可变长文本必须能收缩
for (const sel of ['.ts-warn-body', '.ts-warn-title', '.ts-warn-tags', '.ts-warn-sub']) {
  const r = ruleOf(sel)
  check(`${sel} 有 min-width:0（防撐宽）`, !!r && r.includes('min-width:0'))
}
check('宽度改由 panel-width 模块决定（不再写死常量夹紧）',
  tsx.includes("from './panel-width'") && tsx.includes('panelWidth(left, hoverItems)'))
check('定位不再传 maxWidth，也不再传写死的 width',
  !/setHoverPos\([\s\S]*?maxWidth/.test(tsx) && /left, width \}/.test(tsx))
check('清单变化时宽度会跟着重算', tsx.includes('wantW') && /setHoverPos\(\{ \.\.\.hoverPos, width: wantW \}\)/.test(tsx))

// —— 反馈 3+6：长文本走 title 提示，面板里不出现解释段 ——
check('面板内已无说明性 hint 块（ts-cont-hint）', !css.includes('ts-cont-hint') && !tsx.includes('ts-cont-hint'))
check('已无「详细」折叠按钮（默认展开）', !tsx.includes('ts-cont-more') && !css.includes('ts-cont-more'))
check('自动继续的说明都在 title 上',
  (tsx.match(/className="ts-box-row"/g) || []).length >= 2 && countIn(tsx, '<label title=') >= 6)

// —— 反馈 6：结果反馈在清单行上（已发送 / 继续）——
check('行内状态元素存在（已发送 / 发送中）', css.includes('.ts-warn-done') && tsx.includes('ts-warn-done'))
check('autoStateOf 驱动行内按钮选择', tsx.includes('autoStateOf(it.sessionId)'))
check('短原因胶囊存在且挂在项目胶囊后', css.includes('.ts-warn-reason')
  && /ts-warn-sub[\s\S]{0,200}ts-warn-reason/.test(tsx))
// —— 反馈 1（本轮）：三个区域都要有自己的标题行 ——
const secHeads = [...tsx.matchAll(/<SectionHead title="([^"]+)"/g)].map((m) => m[1])
check('三个区域各有标题行', secHeads.length === 3, secHeads.join(' / '))
// 按**集合**比，不按源码顺序：ContinueSettingsBlock 定义在文件前面，
// 但它渲染在提示音之后 —— 源码顺序 ≠ 渲染顺序，按顺序比会假报错。
check('标题分别是 提示音 / 自动继续 / 对话清单',
  JSON.stringify([...secHeads].sort()) === JSON.stringify(['提示音', '自动继续', '对话清单'].sort()),
  secHeads.join(' / '))
check('每个区域都有 .ts-sec 包裹（分隔线靠它）', (tsx.match(/className="ts-sec"/g) || []).length === 3)
check('区域标题行样式存在', !!ruleOf('.ts-sec-head') && !!ruleOf('.ts-sec-title') && !!ruleOf('.ts-sec-note'))
check('区域之间才画分隔线（最后一个不悬空）', css.includes('.ts-sec + .ts-sec'))
check('各块不再自画 border-bottom（改由 .ts-sec 统一给）',
  !/ts-(sound-body|cont-block) \{[^}]*border-bottom/.test(css))
// 同一区域里标题行与内容要同边距，否则标题会与控件左右错开
check('标题行左内距与内容同为 12px（右侧 22px：让标题行控件与子行控件同列）',
  (ruleOf('.ts-sec-head') || '').includes('padding:9px 22px 8px 12px')
  && ['ts-sound-body', 'ts-cont-block', 'ts-list-body'].every((c) => (ruleOf(`.${c}`) || '').includes('padding:0 12px 10px')))

// —— 本轮反馈：开关上标题行 + 子内容用外框包住 ——
// 外框类名是 ts-box / ts-box-row / ts-box-list。
// 注意**不能用 ts-card**：那是 HDesk 桌面布局已有的类（.ts-card { display:flex; overflow:hidden }），
// 复用会让面板里的外框继承桌面卡片的行为。下面有一条专门守这个。
const boxes = (tsx.match(/className="ts-box( ts-box-list)?"/g) || []).length
const boxRows = (tsx.match(/className="ts-box-row(?=[ "])/g) || []).length
check('三个区域各有一张外框（提示音 / 自动继续 / 对话清单）', boxes === 3, `${boxes} 张`)
check('子内容行共 6 行（提示音 4 + 自动继续 2）', boxRows === 6, `${boxRows} 行`)
check('外框样式存在（底色+描边+圆角）',
  !!ruleOf('.ts-box') && /ts-box \{[^}]*border:1px solid/.test(css) && /ts-box \{[^}]*border-radius/.test(css))
check('外框行样式存在', !!ruleOf('.ts-box-row') && !!ruleOf('.ts-box-list'))
// 防类名碰撞：面板外框不能叫 ts-card（HDesk 桌面卡片已在用）
check('面板外框没有复用 HDesk 的 ts-card 类名',
  !/className="ts-card/.test(tsx))

// 开关必须在标题行里（用户要求：把原来第一行那颗开关挪到标题行右侧）
check('提示音开关在 SectionHead 内（不再占一行「提醒」）',
  /<SectionHead title="提示音">[\s\S]{0,2000}?ts-cont-sw/.test(tsx))
check('自动继续主开关在 SectionHead 内',
  /<SectionHead title="自动继续">[\s\S]{0,2000}?ts-cont-sw/.test(tsx))
check('已删除旧的「提醒」行', !/>提醒<\/label>/.test(tsx))
check('标题行开关右对齐（margin-left:auto）',
  /\.ts-sec-head > \.ts-mark-all-read-btn,[\s\S]{0,80}\.ts-sec-head > \.ts-cont-sw \{ margin-left:auto/.test(css))

// 文字改为「发送上限」「冷却基数」
check('文字为「发送上限」', tsx.includes('>发送上限</label>'))
check('文字为「冷却基数」', tsx.includes('>冷却基数</label>'))
check('旧文字「上限」「冷却」已不在 label 里',
  !/>上限<\/label>/.test(tsx) && !/>冷却<\/label>/.test(tsx))

// card 里不应再出现旧的「区域专用行」样式（统一到 ts-box-row）
check('提示音四行已换成 ts-box-row（不再用 ts-sound-row）',
  !/className="ts-sound-row"/.test(tsx))
check('自动继续行已换成 ts-box-row（不再用 ts-cont-row）',
  !/className="ts-cont-row"/.test(tsx))
// 这次差点踩的坑：把行的类名从 .ts-sound-row 换成 .ts-box-row 时，
// 挂在旧类名下的**控件样式**（下拉框/输入框统一身高）会静静地失效 ——
// 类型检查看不见，只有渲染出来才发现控件变得参差不齐。所以显式挂一条。
check('控件样式已重新挂到 ts-box-row 下（否则下拉框/输入框会掉样式）',
  /\.ts-box-row \.ts-select/.test(css) && /\.ts-box-row \.ts-sound-min/.test(css))
check('没有残留的旧行类样式（.ts-sound-row / .ts-cont-row）',
  !/\.ts-sound-row/.test(css) && !/\.ts-cont-row/.test(css))
check('数字输入框的箭头隐藏规则也跟过来了',
  /\.ts-box-row \.ts-sound-min::-webkit-outer-spin-button/.test(css))

// —— 宽度常量必须与实际 CSS 对得上（不然算出来的宽度是假的）——
// panel-width.ts 里的 ROW_PAD_W / ROW_GAP_W 是按这些实际数值估的：
//   .ts-warn-item padding 左右 8px、.ts-warn-row 右 1px、行间距 6px
check('行内边距与 ROW_PAD_W 对应（item 左右 8px）', /\.ts-warn-item \{[^}]*padding:7px 8px/.test(css))
check('行间距与 ROW_GAP_W 对应（gap:6px）', /\.ts-warn-row \{[^}]*gap:6px/.test(css))
// PANEL_PAD_W 是“非内容宽度”的累加：12(body) + 1(box边框) + 3(box内距) + 5(list) 单边。
// 任一层的 padding/border 改了而常量没跟上，面板宽度就会算错（内容被挤或面板过宽）。
const padTerms = [
  [/\.ts-sound-body \{[^}]*padding:0 12px/.test(css), 'body 12px'],
  [/\.ts-box \{[^}]*border:1px solid/.test(css), 'box 边框 1px'],
  [/\.ts-box-list \{[^}]*padding:3px/.test(css), 'box-list 内距 3px'],
  [/\.ts-warn-pop-list \{[^}]*padding:5px/.test(css), 'list 5px'],
]
const padOk = padTerms.every(([ok]) => ok)
check('面板内边距与 PANEL_PAD_W 的每一项都对得上', padOk,
  padTerms.filter(([ok]) => !ok).map(([, n]) => `不符: ${n}`).join(', '))
// 从源码里把每一项抠出来自己算：这样“常量改了但算式没改”也会被拓出来
const padDecl = /const PANEL_PAD_W = 2 \* \(([^)]+)\)/.exec(
  readFileSync(join(root, 'client/src/panel/panel-width.ts'), 'utf8'),
)?.[1] ?? ''
const padConst = 2 * padDecl.split('+').reduce((a, b) => a + Number(b.trim() || 0), 0)
check('PANEL_PAD_W 数值 = 2×(12+1+3+5) = 42', padConst === 42, `${padConst}（算式 ${padDecl}）`)

// —— 反馈 4：已读按钮做成带图标的牌按钮，不再是裸「✓」——
check('已读按钮含 SVG 对勾 + 文字', /ts-warn-read[\s\S]{0,400}<svg/.test(tsx) && /ts-warn-read[\s\S]{0,600}已读/.test(tsx))
check('头部一键已读与行内同款视觉', css.includes('.ts-mark-all-read-btn')
  && /\.ts-mark-all-read-btn \{[^}]*border-radius:999px/.test(css))

// —— 本轮反馈：鼠标还没挪到面板上就消失 ——
// 根因是面板与触发器之间有一道缝。修法是「走廊命中测试 + 到点时重查」。
check('引用了 hover-corridor 模块', tsx.includes("from './hover-corridor'"))
check('关闭走宽限倒计时（不再用裸 220ms 一收了之）',
  tsx.includes('scheduleClose') && tsx.includes('HOVER_CLOSE_MS') && !/}, 220\)/.test(tsx))
check('到点时重查指针位置（停住不动也能续期）',
  /const zone = pointerZone\(\)/.test(tsx) && tsx.includes("'corridor'"))
check('指针在面板/触发器上时绝不收（不会从鼠标底下消失）',
  /zone === 'panel' \|\| zone === 'trigger'/.test(tsx))
check('续期有上限（不会在缝里赖着不走）', tsx.includes('RENEW_MAX') && tsx.includes('renewRef'))
check('面板与触发器都挂了 ref（走廊要用真实矩形）',
  /ref=\{panelRef\}/.test(tsx) && /ref=\{triggerRef\}/.test(tsx))
check('记录了指针位置供定时器回查',
  tsx.includes('pointerRef') && tsx.includes('pointerRef.current = { x: e.clientX, y: e.clientY }'))
// —— 收尾：tsx 里用到的 class 都要有定义（防手滑写错类名）——
// 直接按“非类名允许字符”切分即可：
//   "ts-pulse-dot"                        → ts-pulse-dot
//   `ts-pulse${c ? ' ts-pulse-run' : ''}`  → ts-pulse, ts-pulse-run
// 引号、$、括号都是分隔符，不会把 `ts-pulse-run'` 这类碎片带进来。
const used = new Set()
for (const m of tsx.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
  for (const tok of (m[1] ?? m[2] ?? '').split(/[^A-Za-z0-9_-]+/)) {
    if (tok.startsWith('ts-')) used.add(tok)
  }
}
const undef = [...used].filter((c) => !css.includes(`.${c}`))
check('tsx 用到的 ts-* 类名都有 CSS 定义', undef.length === 0, undef.length ? `缺: ${undef.join(', ')}` : `已核对 ${used.size} 个`);

// —— 反向：CSS 里定义的 ts-* 类名不能是死代码（没人用）——
// 只查面板相关的（这个文件里还有侧边栏等其他样式，由别的组件消费）。
const defined = new Set([...css.matchAll(/^\.(ts-[a-z0-9-]+)/gm)].map((m) => m[1]))
const PANEL_PREFIXES = ['ts-sec', 'ts-cont-', 'ts-warn-', 'ts-sound-', 'ts-mark-all-read-btn', 'ts-hover-pop']
const panelClasses = [...defined].filter((c) => PANEL_PREFIXES.some((p) => c.startsWith(p)))
// 有些类只作为组合选择器的一部分出现（如 .ts-warn-row.is-active），按子串匹配即可
const dead = panelClasses.filter((c) => !tsx.includes(c))
check('面板相关 CSS 无死代码', dead.length === 0,
  dead.length ? `无人用: ${dead.join(', ')}` : `已核对 ${panelClasses.length} 个`)

// —— 本轮反馈 1/6：三个区域的外框必须同边距 ——
// 根因不是 CSS 写错，而是 styles.ts 里一段注释只开了头没收尾，
// 下一行的「宽度 100%… */」成了游离文本，浏览器把紧跟其后的
// `.ts-sound-body {…}` 整条规则当成「非法选择器」丢掉 —— 于是提示音外框
// 没了 12px 内距，直接贴上浮动面板边缘（其他两块正常）。
const commentScan = (() => {
  let inComment = false
  for (let i = 0; i < css.length; i++) {
    if (!inComment && css.startsWith('/*', i)) { inComment = true; i++ }
    else if (inComment && css.startsWith('*/', i)) { inComment = false; i++ }
    else if (!inComment && css.startsWith('*/', i)) return i
  }
  return inComment ? -1 : -2
})()
check('CSS 注释配对（无游离的 */，否则会吞掉后面的规则）', commentScan === -2,
  commentScan === -1 ? '有注释没闭合' : commentScan >= 0 ? `位置 ${commentScan}` : '')
for (const sel of ['.ts-sound-body', '.ts-cont-block', '.ts-list-body']) {
  check(`${sel} 与另两块同边距（padding:0 12px 10px）`,
    (ruleOf(sel) || '').includes('padding:0 12px 10px'))
}

// —— 本轮反馈 2+5：三个子开关等距，且首项左缘 / 末项右缘与下一行对齐 ——
check('第二行改为 space-between（每格等宽，不用 flex:1 居中）',
  /\.ts-cont-sw-row \{[^}]*justify-content:space-between/.test(css))
check('子开关项不再 flex:1（否则首项左缩、末项右缩，对不上上下两行）',
  /\.ts-box-row > \.ts-cont-sw-item \{[^}]*flex:0 0 auto/.test(css) &&
  !/\.ts-box-row > \.ts-cont-sw-item \{[^}]*flex:1/.test(css))
check('第二行用了 ts-cont-sw-row 类', /className="ts-box-row ts-cont-sw-row"/.test(tsx))

// —— 本轮反馈 3：计时器挪到「项目名称」同一行（原来被挤到第三行）——
check('计时器渲染在标签行内（与项目胶囊同行，不在下面另起一行）',
  /<span className="ts-warn-tags">[\s\S]*?<Timer at=/.test(tsx))
check('标签行下方不再有计时器兄弟节点',
  !/\n\s*\{it\.icon === '●' && <Timer at=\{it\.lastPromptAt\} \/>\}\n\s*<\/span>/.test(tsx))

// —— 本轮反馈 4+5：标题行控件与子行控件同列（右侧一律落在 22px 内距上）——
check('标题行右内距 22px（= 12 区块 + 1 边框 + 3 + 5 + 1 行内距）',
  (ruleOf('.ts-sec-head') || '').includes('padding:9px 22px 8px 12px'))
check('清单行右内距 1px（行内「已读」与标题行「全部已读」同列）',
  /\.ts-warn-row \{[^}]*padding-right:1px/.test(css))
check('操作区有样式定义（继续 + 已读，5px 间隔与 ACTIONS_CONTINUE_W 对应）',
  !!ruleOf('.ts-warn-actions') && /\.ts-warn-actions \{[^}]*gap:5px/.test(css))
const widthSrc = readFileSync(join(root, 'client/src/panel/panel-width.ts'), 'utf8')
check('ROW_PAD_W 与清单行右内距对得上（8×2 + 1 = 17）',
  /const ROW_PAD_W = 17\b/.test(widthSrc), widthSrc.match(/const ROW_PAD_W = \d+/)?.[0] ?? '未找到')

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exitCode = fail === 0 ? 0 : 1
