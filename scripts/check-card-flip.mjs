/**
 * 「项目卡片翻牌（进行中 ⇄ 完成）」自检（源码正则断言，不需要浏览器）。
 *
 *   node scripts/check-card-flip.mjs
 *
 * 需求原话：「项目中心的卡片我想实现一种翻牌效果，用于呈现项目的状态【进行中、完成】的
 * 相互切换，翻牌之后，还可以翻回去，翻牌之后卡片的颜色使用另外一种用于标识」。
 *
 * 锁死这次改动的口径 —— 改代码时最容易顺手改坏的四处：
 *
 *   A. 状态是**数据**，不是动画临时态：
 *      1. ProjectRecord.status ∈ {active, done}，老缓存/老注册表缺省 active；
 *      2. 服务端 sanitizeProject 的白名单要认它 —— 漏了就一跨来源同步被抹平，
 *         表现为「手机端翻过牌的项目又变回进行中」；
 *      3. 切换必须走同一份存储并回推（toggleProjectStatus → saveProjects → 服务端），
 *         不能只改本地 useState —— 否则刷新就弹回正面，翻牌成了纯动画。
 *
 *   B. 翻牌的三块拼图缺一不可（缺一块就是「翻过去背面是空白的/歪的/点不回来」）：
 *      1. 场景 perspective + 内层 preserve-3d + rotateY(180deg)；
 *      2. 两面同格叠放（grid-area:1/1）—— 高度由较高的一面决定，不写死高度、不露底；
 *      3. 两面 backface-visibility:hidden（含 -webkit- 前缀，WebKit 上少了会两面同时可见）。
 *
 *   C. 用户能看见「哪一面」和「怎么翻回去」：
 *      1. 背面换一套配色（绿）+ 正面一套（蓝）—— 用户要的「另一种标识色」；
 *      2. 翻牌按钮在卡片右上角（标题行最右），且 stopPropagation（不误触「进入工作台」）；
 *      3. 列表模式也有状态胶囊（否则切到列表就完全看不到状态）。
 *
 *   D. 几何静止（二次反馈后收紧）：hover **不许动几何**。.ts-center-card:hover 的
 *      translateY(-2px) 原本对所有卡片生效，翻牌卡两面就会在 preserve-3d 里多出一层
 *      位移动画，与内层 180° 旋转打架（悬停抖 / 翻回来时抖）。现在那条位移只留给
 *      .ts-center-addcard:hover，两面的 transform 是写死的常数。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

const store = readFileSync(join(root, 'client/src/panel/store.ts'), 'utf8')
const center = readFileSync(join(root, 'client/src/panel/ProjectCenter.tsx'), 'utf8')
const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
const route = readFileSync(join(root, 'src/board-web-route.ts'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

console.log('— A. 状态是数据（不是动画临时态）—')

check('store：ProjectStatus 只有 active / done 两个值',
  /export type ProjectStatus = 'active' \| 'done'/.test(store))

check('store：ProjectRecord 带 status 字段',
  /interface ProjectRecord \{[\s\S]{0,400}?status: ProjectStatus/.test(store))

check('store：老缓存水合时缺省 active（不把未知值当真）',
  /status: p\.status === 'done' \? 'done' : 'active'/.test(store))

check('store：新建项目即为进行中',
  /const record: ProjectRecord = \{[\s\S]{0,300}?status: 'active'/.test(store))

check('store：toggleProjectStatus 双向翻转并回推（saveProjects）',
  /export function toggleProjectStatus\(id: string\): ProjectStatus \| undefined/.test(store) &&
  /hit\.status = hit\.status === 'done' \? 'active' : 'done'/.test(store) &&
  /hit\.status = hit\.status === 'done' \? 'active' : 'done'\s*\n\s*saveProjects\(list\)/.test(store))

check('服务端：StoredProject 带 status，且 sanitizeProject 白名单认它',
  /interface StoredProject \{[\s\S]{0,400}?status: string/.test(route) &&
  /status: raw\.status === 'done' \? 'done' : 'active',/.test(route))

check('ProjectCenter：切换走 store（不是本地 useState 的假翻牌）',
  /toggleProjectStatus,/.test(center) &&
  /toggleProjectStatus\(id\)/.test(center) &&
  !/useState\([^)]*\)\s*\/\/\s*翻牌/.test(center))

console.log('— B. 翻牌三块拼图（缺一块就翻车）—')

check('卡片：场景 + 内层 + 两面（正面/背面都在 DOM 里）',
  /className=\{`ts-flip-scene ts-center-card-click/.test(center) &&
  /className=\{`ts-flip-inner\$\{p\.status === 'done' \? ' is-done' : ''\}`\}/.test(center) &&
  /className="ts-center-card ts-flip-face ts-flip-front"/.test(center) &&
  /className="ts-center-card ts-flip-face ts-flip-back"/.test(center))

check('CSS：场景给透视（放宽到 1600px）、内层给 3D 旋转（preserve-3d + transition）',
  /\.ts-flip-scene \{ perspective:1600px; \}/.test(styles) &&
  /\.ts-flip-inner \{ display:grid; width:100%; height:100%; transform-style:preserve-3d; will-change:transform; transition:transform/.test(styles))

check('CSS：内层撑满场景行高（同一排卡片仍然等高，不被翻牌拆成高低不齐）',
  /\.ts-flip-inner \{[^}]*height:100%;/.test(styles))

check('CSS：完成态把内层转到 180°（rotateY）',
  /\.ts-flip-scene \.ts-flip-inner\.is-done \{ transform:rotateY\(180deg\); \}/.test(styles))

check('CSS：两面同格叠放（grid-area:1/1，高度不写死）',
  /\.ts-flip-face \{ grid-area:1\/1;/.test(styles) &&
  !/\.ts-flip-face \{ position:absolute/.test(styles))

check('CSS：两面背向隐藏（含 -webkit- 前缀）',
  /backface-visibility:hidden; -webkit-backface-visibility:hidden;/.test(styles) &&
  /\.ts-flip-back \{ transform:rotateY\(180deg\); \}/.test(styles))

console.log('— C. 能看见哪一面、也能翻回去 —')

check('CSS：完成态换一套配色（背面绿底 + 绿描边，与进行中的蓝面对照）',
  /\.ts-flip-back \{ border-color:rgba\(74,222,128,\.42\); background:linear-gradient/.test(styles) &&
  /\.ts-flip-back::after \{ background:conic-gradient\(from 45deg,rgba\(74,222,128/.test(styles))

check('CSS：进行中也有一套自己的色（正面蓝描边，与背面成对）',
  /\.ts-flip-front \{ border-color:rgba\(96,165,250,\.30\); \}/.test(styles))

check('卡片上不再有「✓ 已完成」横条（用户反馈：又多一行、卡片变高）',
  !/ts-flip-doneband/.test(center) &&
  !/ts-flip-doneband/.test(styles) &&
  // 状态改由图标表达：项目名前 📁 → ✅ 一眼可辨（用户说这个 ✓ 已经很明显）
  /back \? '✅' : '📁'/.test(center))

check('卡片上不再有状态胶囊（用户反馈：胶囊把卡片顶高了）',
  /卡片上\*\*不放\*\*状态胶囊/.test(center) &&
  !/ts-status-chip\$\{back/.test(center) &&
  // 列表模式仍然保留胶囊（那里是唯一能看到/切换状态的地方）
  /\.ts-status-chip \{/.test(styles))

check('卡片：翻牌按钮在标题行最右（= 卡片右上角），且不误触「进入工作台」',
  /className="ts-center-name"[\s\S]{0,600}?className="ts-flip-btn"/.test(center) &&
  /className="ts-flip-btn"[\s\S]{0,300}?onClick=\{\(e\) => \{ e\.stopPropagation\(\); toggleStatus\(p\.id\) \}\}/.test(center) &&
  /aria-pressed=\{back\}/.test(center))

check('标题行去掉「进入 →」提示（把宽度让给项目名，卡片宽度不变）',
  !/ts-center-enterhint/.test(center) &&
  !/ts-center-enterhint/.test(styles) &&
  // 名字仍然吃掉剩余宽度（flex:1 + min-width:0 + 省略号），不是改成固定宽/换行
  /\.ts-center-name \{ flex:1; min-width:0;/.test(styles))

check('两面各持一枚按钮（正面那枚背向隐藏后，背面还有一枚能点回来）',
  (center.match(/className="ts-flip-btn"/g) || []).length === 1 &&
  /{back \? '↺ 翻回' : '↻ 翻牌'}/.test(center))

check('翻牌是双向的：同一个 toggle 既能标记完成、也能翻回进行中',
  /hit\.status === 'done' \? 'active' : 'done'/.test(store) &&
  /title=\{back \? '翻回去：改回「进行中」' : '翻牌：标记为「完成」'\}/.test(center))

check('状态持久化：class 由数据推导（刷新后仍停在背面）',
  /className=\{`ts-flip-inner\$\{p\.status === 'done' \? ' is-done' : ''\}`\}/.test(center) &&
  !/useState/.test(center.slice(center.indexOf('const cardFace'), center.indexOf('const cardFace') + 400)))

check('列表模式也有状态胶囊（否则切到列表看不到状态）',
  /className=\{`ts-status-chip\$\{p\.status === 'done' \? ' is-done' : ''\}`\}/.test(center) &&
  /className="ts-plist-namecell"/.test(center) &&
  /\.ts-plist-namecell \{/.test(styles))

console.log('— D. 几何静止（hover 不动位移，面的 transform 恒定）—')

// 用户反馈原话：「鼠标放在卡片上时出现那种翻牌效果一直在抖动，还不如不要抖，在真正
// 点翻牌的时候实现翻牌效果」。根因：面的 transform 在 hover 时也会变（.ts-center-card
// 自带 transform 过渡 + :hover{translateY(-2px)}），与内层 180° 旋转在 preserve-3d 里
// 互相打架；同时位移会「移出热区 → 复位 → 再进」地自激。现在 hover 只碰阴影。
check('CSS：hover 只改阴影、不动几何（位移只留给「添加项目」卡）',
  /\.ts-flip-scene:hover \.ts-center-card \{ box-shadow:/.test(styles) &&
  !/\.ts-flip-scene:hover \{ transform/.test(styles) &&
  /\.ts-center-addcard:hover \{ transform:translateY\(-2px\);/.test(styles) &&
  // 翻牌卡两面用的 .ts-center-card 上不再有任何 hover 位移
  !/\.ts-center-card:hover \{ transform/.test(styles))

check('CSS：两面的 transform 恒为常数（没有任何 hover 规则能改它）',
  /\.ts-flip-back \{ transform:rotateY\(180deg\); \}/.test(styles) &&
  !/\.ts-flip-face\.ts-center-card:hover/.test(styles) &&
  !/\.ts-flip-face\.ts-flip-back:hover/.test(styles) &&
  /\.ts-flip-face \{[^}]*transition:box-shadow \.14s ease; \}/.test(styles) &&
  !/\.ts-flip-face \{[^}]*transition:[^}]*transform/.test(styles))

check('CSS：内层单独成层（will-change）—— 修「连翻几次后卡片看不见、移开鼠标才刷出来」',
  /\.ts-flip-inner \{[^}]*will-change:transform/.test(styles))

check('CSS：减动效（prefers-reduced-motion）不演旋转',
  /@media \(prefers-reduced-motion: reduce\) \{ \.ts-flip-scene \.ts-flip-inner \{ transition:none; \} \}/.test(styles))

console.log('— E. 布局与渲染稳定性（线上踩过的坑，必须钉住）—')

// 线上反馈：「翻牌一直在抖动跳动，点击右上角按钮还是进工作台，卡片变宽导致相邻卡片重叠」。
// 三个症状两个根因：① 网格项 min-width:auto 溢出到相邻列；② backdrop-filter 把面拍平成 2D，
// 背面的 backface-visibility 失效 → 背面镜像画在正面之上，点击命中的是上面那层。
check('CSS：限制 min-width 链（网格项 → 内层 → 两面），卡片不许溢出到相邻列',
  /\.ts-flip-scene \{ min-width:0; \}/.test(styles) &&
  /\.ts-flip-scene \.ts-flip-inner \{ grid-template-columns:minmax\(0,1fr\); min-width:0; \}/.test(styles) &&
  /\.ts-flip-face \{ min-width:0; \}/.test(styles))

check('CSS：不再放开 meta 换行 —— 回到「创建于/更新于 永远一行」，卡片高度不变高',
  !/\.ts-flip-face \.ts-center-meta/.test(styles) &&
  /\.ts-center-meta \{ flex-wrap:nowrap; \}/.test(styles))

check('CSS：两面关掉 backdrop-filter（否则 preserve-3d 被拍平，背面盖在正面之上）',
  /\.ts-flip-face \{ backdrop-filter:none; -webkit-backdrop-filter:none; \}/.test(styles))

check('键盘：回车/空格只在「卡片/整行自己」聚焦时才进工作台（内层按钮不误触）',
  /\(e\.target !== e\.currentTarget\) return/.test(center) &&
  (center.match(/\(e\.target !== e\.currentTarget\) return/g) || []).length === 2)

console.log('— F. 收尾：本改动新引入的类名都有 CSS 定义 —')

// 只核对这次新增的类（整文件核对会撞上历史遗留：.ts-plist-active 至今没有定义）
const NEW_CLASSES = [
  'ts-flip-scene', 'ts-flip-inner', 'ts-flip-face', 'ts-flip-front', 'ts-flip-back',
  'ts-flip-btn', 'ts-status-chip', 'ts-plist-namecell',
]
const undef = NEW_CLASSES.filter((c) => !center.includes(c) || !styles.includes(`.${c}`))
check('新类名：tsx 用到 ⇄ CSS 定义两边都在', undef.length === 0,
  undef.length ? `缺: ${undef.join(', ')}` : `已核对 ${NEW_CLASSES.length} 个`)

console.log('— G. 排序：新增「按完成情况」—')

check('store：SortMode 含 status，且偏好水合认它（老偏好不会被静默重置）',
  /export type SortMode = 'name' \| 'created' \| 'updated' \| 'status'/.test(store) &&
  /p\?\.sort === 'name' \|\| p\?\.sort === 'updated' \|\| p\?\.sort === 'status' \? p\.sort : 'created'/.test(store))

check('store：sortProjects 有 status 分支（进行中在前、已完成在后；同组按创建时间倒序）',
  /else if \(sort === 'status'\)/.test(store) &&
  /const rank = \(s: ProjectStatus\) => \(s === 'done' \? 1 : 0\)/.test(store) &&
  /rank\(a\.status\) - rank\(b\.status\) \|\| b\.createdAt - a\.createdAt/.test(store))

check('工具栏有「按完成情况」按钮，且老的三种排序没被顶掉',
  /prefs\.sort === 'status' \? ' active' : ''/.test(center) &&
  /setPref\(\{ sort: 'status' \}\)/.test(center) &&
  /按完成情况<\/button>/.test(center) &&
  /prefs\.sort === 'name'/.test(center) &&
  /prefs\.sort === 'created'/.test(center) &&
  /prefs\.sort === 'updated'/.test(center))

// —— 运行时验证排序顺序 ——
// 正则只能证明「分支在」，证明不了「顺序对」。用仓库现成的办法：esbuild 把 store.ts
// 转译成 mjs 再 import（与 check-desk-ux 单测 desk-panes 同一套路）。
{
  const dir = mkdtempSync(join(tmpdir(), 'ts-cardflip-'))
  try {
    const out = join(dir, 'store.mjs')
    await build({
      entryPoints: [join(root, 'client/src/panel/store.ts')],
      bundle: true,
      format: 'esm',
      outfile: out,
      platform: 'neutral',
      logLevel: 'silent',
    })
    const m = await import(out)
    const mk = (id, status, createdAt) => ({ id, name: id, path: `/${id}`, description: '', layout: 'h-desk', createdAt, updatedAt: createdAt, status })
    const ids = (sort, list) => m.sortProjects(list, sort).map((p) => p.id).join('')
    const four = [mk('A', 'done', 10), mk('B', 'active', 20), mk('C', 'done', 30), mk('D', 'active', 5)]
    check('运行时：按完成情况 = 进行中在前、同组按创建时间倒序',
      ids('status', four) === 'BDCA', `得到 ${ids('status', four)}，期望 BDCA`)
    check('运行时：按完成情况对「全是进行中」也不出错（就是创建时间倒序）',
      ids('status', [mk('A', 'active', 10), mk('B', 'active', 20)]) === 'BA')
    check('运行时：老三种排序没被带偏',
      ids('created', four) === 'CBAD' && ids('name', four) === 'ABCD')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

check('自检已接入 pnpm test 链',
  pkg.scripts['test:card-flip'] !== undefined && pkg.scripts.test.includes('test:card-flip'))

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)