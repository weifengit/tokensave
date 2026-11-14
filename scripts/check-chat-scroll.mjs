/**
 * 主对话滚动「记账 / 回翻锚定」自检（纯文本断言，不需要浏览器）。
 *
 *   node scripts/check-chat-scroll.mjs
 *
 * 钉住两个用户报过的 bug 的修复点，防止后续改动把它们改回去：
 *
 * 问题 A（切 tab 回落到中间）：
 *   反馈原话：「先把对话拉到最底部，然后从工作台 tab 切到『对话』/『项目中心』
 *   再回来，DSH 主对话定位到中间某处（不在原来的底部位置）」。
 *   根因：onScroll 只在「用户往上滚」时记账（rememberScroll），回到最底部
 *   却从不再记 → 账本永远留着上滚时的 {bottom:false, top:中间值}；而卸载时
 *   的 cleanup 又是 passive effect、跑的时候 DOM 已移除（ref 为 null）写不进。
 *   修复：onScroll 的三条路径（中间 / 闩锁带 / 贴底）都在真实滚动时当场记账，
 *   贴底路径写 {bottom:true}。
 *
 * 问题 B（「加载更早」跳到 B 顶部）：
 *   反馈原话：「定位在 C 点，点『加载更早』后直接定位到 B 的最顶部……误以为
 *   没点按钮」。根因：宿主 loadOlder 是异步请求，点击后第一次渲染内容还没到，
 *   恢复 effect 在那一帧消费锚点 → 修正量 0、锚点白丢；内容真到时视口被顶到
 *   新段顶部。修复：scrollHeight 没真的长高就保留锚点（loadingOlder 或短窗口
 *   内），长高了才结算 scrollTop += 长高量（下方内容原地不动）。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'client/src/panel/MsgList.tsx'), 'utf8')
const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

// —— 问题 A：三条滚动路径都当场记账 ——
// 中间路径：没到底时，真实用户滚动（freshIntent）无论上下都重写备忘
check('中间位置：真实滚动即记账（切走再切回才是原样恢复）',
  /if \(!atBottom\) \{[\s\S]{0,400}?if \(freshIntent\) rememberScroll\(\)/.test(src))
// 闩锁带路径：快到底但闩锁没解时也记一笔（否则切走会用更早的旧账）
check('闩锁带：未解锁也记账',
  /if \(upwardRef\.current && downPxRef\.current < UNLATCH_DOWN_PX\) \{[\s\S]{0,400}?rememberScroll\(\)/.test(src))
// 贴底路径：到底后立刻把备忘写成 {bottom:true}——这是「回到底部」的唯一真值来源
check('贴底：到底后立刻重写备忘（bottom=true）',
  /pinnedRef\.current = true[\s\S]{0,200}?setPinned\(true\)[\s\S]{0,600}?rememberScroll\(\)/.test(src))
// 记账以 pinnedRef 为真值（不在 rememberScroll 里重算几何，避免布局抖动误判）
check('记账真值取 pinnedRef（不重算几何）',
  /const bottom = pinnedRef\.current/.test(src))

// —— 问题 C：「回到最新」的出现条件与寿命（用户反馈两件事）——
// ① 内容不足一屏（可滚距离≈0）时不该出现：对话只有几行、下面一大片空白，
//    用户根本没有「回到最新」的诉求。判据必须是可滚距离，不能是「距底距离」
//    —— 后者在内容不足一屏时会因 padding-bottom 恒为一个大值而让按钮常驻。
check('「回到最新」按可滚距离判定（内容不足一屏不显示）',
  /scrollHeight - el\.clientHeight <= NEAR_BOTTOM/.test(src))
// ② 显示 5 秒后自动隐藏（它是提醒，不是常驻控件；旧实现「不在底部就一直显示」）
check('「回到最新」5 秒后自动隐藏',
  /JUMP_SHOW_MS = 5_000/.test(src) &&
  /setTimeout\(\(\) => \{[\s\S]{0,120}?setJumpVisible\(false\)[\s\S]{0,60}?\}, JUMP_SHOW_MS\)/.test(src))
// ③ 回到底部立即收起，不等计时器
check('回到底部立即收起（不等 5s）',
  /pinnedRef\.current = true[\s\S]{0,80}?hideJump\(\)/.test(src) &&
  /forceBottom\(\)[\s\S]{0,120}?hideJump\(\)/.test(src))
// ④ 每种"离开底部"的路径都提示，不只方向确认为向上那一种
check('离开底部的两条路径都会提示（上滚 + 拖滚动条/键盘翻页）',
  /suspendFollow\(\)[\s\S]{0,80}?revealJump\(\)/.test(src))
// ⑤ 可见性用独立的 jumpVisible，不再直接绑 pinned（pinned 必须立刻为假，
//    而按钮还该满足「内容可滚 + 只活 5 秒」两个额外条件）
check('按钮可见性用 jumpVisible 而非 pinned',
  /data-visible=\{jumpVisible \? '' : undefined\}/.test(src) &&
  !/data-visible=\{pinned \? undefined : ''\}/.test(src))

// —— 问题 B：回翻锚定必须用「活节点」+ 逐帧平移（一次性像素锚会在第一批就被消费）——
check('锚点是活节点 + 稳定 key（key/node/nodeTop/startedAt/until）',
  /anchorRef = useRef<\{ key: string; node: Element; nodeTop: number; startedAt: number; until: number \} \| null>\(null\)/.test(src))
check('回翻先锁定首可见轮节点为锚（按 data-turn-key 选择）',
  /const turns = Array\.from\(el\.querySelectorAll\('\[data-turn-key\]'\)\)/.test(src) &&
  /for \(const t of turns\) \{[\s\S]{0,200}?if \(tr\.bottom > r\.top \+ 8\) \{ node = t; break \}/.test(src))
check('轮 key 取**尾**消息（回翻只往轮头插，尾不动；取头会在窗口扩到真开头时变 key）',
  /const last = t\.answer \?\? t\.proc\[t\.proc\.length - 1\]/.test(src) &&
  /data-turn-key=\{visibleKeys\[ti\]\}/.test(src) &&
  /key=\{visibleKeys\[ti\] \?\? ti\}/.test(src))
check('锚循环每帧按 key 重解析节点（索引 key 会按位复用，只有 key 跟内容）',
  /const cur = a\.key \? box\.querySelector\(`\[data-turn-key="\$\{a\.key\}"\]`\) : a\.node/.test(src))
check('逐帧平移：把锚节点偏移拉回 nodeTop（下方内容不动）',
  /const want = cur\.getBoundingClientRect\(\)\.top - cr\.top/.test(src) &&
  /box\.scrollTop = box\.scrollTop \+ d/.test(src))
check('用户自己滚了立即交还视口（不抢滚动条）',
  /if \(userIntentAtRef\.current > a\.startedAt\) \{ anchorRef\.current = null; return \}/.test(src))
check('截止/节点离 DOM 两路退出 + 刻意**不**设静止提前退（批次间隙会误退）',
  /if \(Date\.now\(\) > a\.until\) \{ anchorRef\.current = null; return \}/.test(src) &&
  /if \(!cur \|\| !box\.contains\(cur\)\) \{ anchorRef\.current = null; return \}/.test(src) &&
  !/a\.still >= 12/.test(src) &&
  /刻意\*\*不\*\*用「scrollTop 与上一帧我们写的值不同」判用户滚动/.test(src))
check('两条回翻路径（本地窗口/宿主拉页）都走 startOlderAnchor',
  (src.match(/startOlderAnchor\(\)/g) || []).length >= 2 &&
  /const startOlderAnchor = useCallback\(\(\) => \{/.test(src))
check('程序化写入带锤定时间戳（防 onScroll 误判用户滚到顶）',
  /restoredAtRef\.current = Date\.now\(\)/.test(src))
check('卸载时取消锚 rAF（不留孤儿循环）',
  /if \(anchorRafRef\.current\) cancelAnimationFrame\(anchorRafRef\.current\)/.test(src))

// —— 回归护栏：卸载 cleanup 不能是唯一的记账点（它跑的时候 DOM 已移除）——
check('卸载 cleanup 仍在但只是兜底（onScroll 当场记账才是保命线）',
  /useEffect\(\(\) => rememberScroll, \[rememberScroll\]\)/.test(src) &&
  /真正的保命线是「用户一滚动就当场记账」/.test(src))
check('「加载更早」控制条在滚动容器之外（回翻后不被顶出可视区，随时可点）',
  // 放在滚动内容里时，回翻把内容插到顶部 → 视口锚定 → 按钮被一并顶走（用户反馈），
  // 所以 MsgList 必须用 .ts-chat-wrap 把控制条包在 .ts-chat-msgs 外面：
  /<div className="ts-chat-wrap">/.test(src) &&
  /className="ts-msgs-topbar"/.test(src) &&
  src.indexOf('ts-chat-wrap') < src.indexOf('className="ts-chat-msgs"') &&
  // 理由必须写在 CSS 里
  /按钮被顶走/.test(styles) &&
  /\.ts-chat-wrap \{ flex:1; min-height:0/.test(styles))

if (fail) {
  console.error(`\n${fail} 项 FAIL`)
  process.exit(1)
}
console.log('\nALL PASS')
