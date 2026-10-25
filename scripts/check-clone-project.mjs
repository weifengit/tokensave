/**
 * 「从 GitHub 克隆项目」自检（源码正则断言，不需要浏览器）。
 *
 *   node scripts/check-clone-project.mjs
 *
 * 锁死这条链路的**安全与状态口径**——这些都是改代码时最容易顺手改坏的：
 *   1. 服务端 clone 是**参数数组传参**（spawn 第二参是数组），绝不经 shell；
 *   2. URL 白名单：只放行 https:// / http:// / git@host:path，且拒绝 '-' 开头；
 *   3. 凭据不进 argv（走 GIT_CONFIG_* 环境变量）；
 *   4. 目标目录必须为空/不存在（不覆盖已有项目）+ 同目录不并发；
 *   5. 长任务拆两端点：POST /clone 启动、GET /clone-status 查进度，
 *      且两条路径各用各的 guard（否则方法可以互串）；
 *   6. 客户端：轮询有终止条件与清理、完成态才允许「加入项目」。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

const route = readFileSync(join(root, 'src/board-web-route.ts'), 'utf8')
const api = readFileSync(join(root, 'client/src/panel/api.ts'), 'utf8')
const dialog = readFileSync(join(root, 'client/src/panel/AddProjectDialog.tsx'), 'utf8')
const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')

console.log('— 服务端：路由与约定 —')

check('两个路由常量都在（clone + clone-status）',
  /export const CLONE_ROUTE_PATH = '\/plugins\/dsh-tokensave\/clone'/.test(route) &&
  /export const CLONE_STATUS_ROUTE_PATH = '\/plugins\/dsh-tokensave\/clone-status'/.test(route))

check('引入了 spawn / execFileSync / ChildProcess',
  /import \{ spawn, execFileSync, type ChildProcess \} from 'node:child_process'/.test(route))

// 参数数组传参：这是防注入的根本，绝不能退化成 shell 字符串拼接
check('git 用参数数组传参（spawn 第二参是数组，不过 shell）',
  /spawn\('git', args, \{/.test(route) &&
  // 允许 RegExp 的 .exec( / .execSync( 方法调用，只禁裸的 child_process 版本
  !/(?<!\.)\bexec\(|(?<!\.)\bexecSync\(/.test(route) &&
  !/shell: true/.test(route))

check('argv 顺序：clone --depth 1 --progress -- <url> <target>',
  /const args = \['clone', '--depth', '1', '--progress', '--', normalized\.url, target\]/.test(route))

check('URL 白名单：只放行 https/http 与 git@host:path，且拒绝 - 开头',
  /if \(url\.startsWith\('-'\)\) return \{ error: '仓库地址不合法' \}/.test(route) &&
  /\^https\?:\\\/\\\/\[\^\\s\/\]\+\\\/\.\+/.test(route) &&
  /\^git@\[\^\\s\/:\]\+:\\S\+\$/.test(route))

check('凭据经环境变量注入（不进 argv）',
  /env\.GIT_CONFIG_COUNT = '1'/.test(route) &&
  // ⚠ KEY 必须带 URL 限定：裸的 http.extraheader 不分 host，
  // 会把 token 发给任意被请求的站点（实测已复现）。
  // KEY 必须带 URL 限定（含反引号，用 substring 避免正则里的模板串转义坑）
  route.includes('env.GIT_CONFIG_KEY_0 = `http.${new URL(normalized.url).origin}/.extraheader`') &&
  !/GIT_CONFIG_KEY_0 = 'http\.extraheader'/.test(route) &&
  /env\.GIT_CONFIG_VALUE_0 = `Authorization: Basic \$\{Buffer\.from\(`x-access-token:\$\{token\}`\)/.test(route) &&
  // token 只取自环境变量或 gh，不能是硬编码
  /for \(const key of \['GITHUB_TOKEN', 'GH_TOKEN', 'TOKENS_SAVE_GITHUB_TOKEN'\]\)/.test(route) &&
  /execFileSync\('gh', \['auth', 'token'\]/.test(route))

check('token 只给 GitHub 的 https 地址（不在别处泄露）', (() => {
  const line = route.split('\n').find((l) => l.includes('const token ='))
  return Boolean(line)
    && line.includes('github')
    && line.includes('githubToken()')
    && line.includes(": ''")
})())

check('目标目录必须不存在或为空（不覆盖已有项目）',
  /empty = fs\.statSync\(target\)\.isDirectory\(\) && fs\.readdirSync\(target\)\.length === 0/.test(route) &&
  /目标目录已存在且不为空/.test(route))

check('同目录不并发克隆',
  /if \(t\.state === 'running' && t\.dir === target\)/.test(route) &&
  /该目录已有克隆任务在进行中/.test(route))

check('超时兜底 + 杀整个进程组（git 会 fork remote-https）',
  /CLONE_TIMEOUT_MS = 10 \* 60_000/.test(route) &&
  /process\.kill\(-task\.child\.pid, 'SIGTERM'\)/.test(route) &&
  /detached: true/.test(route))

check('长任务不挂 HTTP 连接：立即返回 taskId，进度另查',
  /writeJson\(res, 200, \{ taskId, path: normalizeWorkspace\(target\), name, url: normalized\.display \}\)/.test(route) &&
  /export function handleCloneStatus\(req: any, res: any\): void/.test(route))

// 曾经把两条路径合成一个 guard：GET /clone 能查进度、POST /clone-status 竟能起克隆
check('两条路径各用各的 guard（方法不互串）',
  /const cloneStartGuard/.test(route) && /const cloneStatusGuard/.test(route) &&
  /\[CLONE_ROUTE_PATH, cloneStartGuard\]/.test(route) &&
  /\[CLONE_STATUS_ROUTE_PATH, cloneStatusGuard\]/.test(route) &&
  /if \(req\.method !== 'POST'\) return methodNotAllowed\(res\)[\s\S]{0,120}handleClone\(req, res\)/.test(route) &&
  /if \(req\.method !== 'GET'\) return methodNotAllowed\(res\)[\s\S]{0,120}handleCloneStatus\(req, res\)/.test(route))

check('写通道自行鉴权（不套 makeGuard，否则非 GET 全 405）',
  /const authed = \(req: any, res: any\): boolean => \{/.test(route) &&
  /const rejection = rejectionFor\(ctx, req\)/.test(route) &&
  /registerAll\(writeRoutes, false\)/.test(route))

check('clone 路由已登记进 writeRoutes，repos 路由在 readRoutes',
  /\[CLONE_ROUTE_PATH, cloneStartGuard\],/.test(route) &&
  // 启动日志已移除（门面重挂会打两遍，属噪音）；改为直接断言两条路由表的登记行
  /\[REPOS_ROUTE_PATH, \(req, res\) => handleRepos\(ctx, req, res\)\],/.test(route))

check('输出按 \\r 与 \\n 双分隔符切（git 进度行用 \\r 刷新）',
  /text\.split\(\/\[\\r\\n\]\+\/\)/.test(route))

console.log('— 客户端：API —')

check('api.ts 导出 cloneRepo / fetchCloneStatus',
  /export async function cloneRepo\(/.test(api) &&
  /export async function fetchCloneStatus\(/.test(api))

check('两个端点路径与后端一致',
  /fetch\('\/plugins\/dsh-tokensave\/clone', \{/.test(api) &&
  /fetch\(`\/plugins\/dsh-tokensave\/clone-status\?taskId=\$\{encodeURIComponent\(taskId\)\}`\)/.test(api))

check('非 2xx 一律抛错（不静默吞掉校验失败/409）',
  /if \(!res\.ok\) throw new Error\(String\(data\?\.error \|\| `克隆启动失败（HTTP \$\{res\.status\}）`\)\)/.test(api) &&
  /if \(!res\.ok\) throw new Error\(String\(data\?\.error \|\| `查询克隆进度失败（HTTP \$\{res\.status\}）`\)\)/.test(api))

console.log('— 客户端：弹窗 —')

check('两态来源切换（local / clone），且按钮用线条图标',
  /const \[source, setSource\] = useState<'local' \| 'clone'>\('local'\)/.test(dialog) &&
  dialog.includes('<Icon name="folder" /> 本地已有目录') &&
  dialog.includes('<Icon name="branch" /> 从 GitHub 克隆'))

check('克隆父目录跟目录浏览器走（用 cwd 而非 selectedPath）',
  /useEffect\(\(\) => \{ setCloneParent\(cwd \|\| null\) \}, \[cwd\]\)/.test(dialog))

check('轮询有终态即停 + 卸载清理定时器（不泄漏）',
  /if \(status\.state !== 'running'\) return \/\/ 终态：本轮不再排下一个定时器/.test(dialog) &&
  /return \(\) => \{[\s\S]{0,80}stopped = true[\s\S]{0,80}clearTimeout\(timer\)/.test(dialog))

check('任务丢失（服务端重启）不无限死磕',
  /if \(misses >= 3\) \{/.test(dialog) &&
  /克隆任务已丢失（服务端可能已重启），请重试/.test(dialog))

check('克隆进行中锁住来源切换与输入（防改到一半串台）',
  /disabled=\{clonePending\}/.test(dialog) &&
  /const clonePending = Boolean\(cloneTaskId\) && cloneStatus\?\.state === 'running'/.test(dialog))

check('完成态才允许落库，且成功与完成是同一套 addProject',
  /disabled=\{source === 'clone' \? !cloneStatus \|\| cloneStatus\.state !== 'done' : !selectedPath\}/.test(dialog) &&
  /onClick=\{source === 'clone' \? finishClone : confirm\}/.test(dialog) &&
  /const record = addProject\(name\.trim\(\) \|\| repoNameFrom\(repoUrl\), dir, description\)/.test(dialog))

check('本地专属控件（新建/重命名/选择当前文件夹）只在 local 态出现',
  (dialog.match(/\{source === 'local' && \(/g) || []).length === 2)

check('仓库名推导与服务端同规则（去 .git / 取末段）',
  dialog.includes('cleaned.split(/[/:]/)') &&
  /return tail\.replace\(\/\\\.git\$\/i, ''\)/.test(dialog))

console.log('— 仓库清单（从自己的 GitHub 仓里选）—')

check('后端新增 GET /repos（gh repo list，带缓存）',
  route.includes("export const REPOS_ROUTE_PATH = '/plugins/dsh-tokensave/repos'") &&
  /execFileSync\('gh', \[/.test(route) &&
  route.includes("'repo', 'list', '--limit'") &&
  /REPOS_CACHE_TTL_MS = 60_000/.test(route))

check('/repos 是只读接口（进 readRoutes，不套写通道）',
  /\[REPOS_ROUTE_PATH, \(req, res\) => handleRepos\(ctx, req, res\)\]/.test(route) &&
  /export function handleRepos\(_ctx: Context, _req: any, res: any\): void/.test(route))

check('gh 失败给可读原因而非当空清单（界面仍可手输）',
  route.includes('本机 gh 未登录') &&
  route.includes('本机未安装 gh') &&
  // 清单接口本身绝不能把「拿不到」变成抛错/500
  /writeJson\(res, 200, \{ items, error, count: items\.length \}\)/.test(route))

check('清单按最近推送排序（刚动过的仓排前面）',
  /items\.sort\(\(a, b\) => \(b\.pushedAt \|\| ''\)\.localeCompare\(a\.pushedAt \|\| ''\)\)/.test(route))

check('api.ts 导出 fetchRepos / RepoItem，且失败不抛（返回 error 字段）',
  /export async function fetchRepos\(\): Promise<ReposPayload>/.test(api) &&
  /export interface RepoItem \{/.test(api) &&
  /return \{ items: \[\], error: '列举仓库失败（无法连接服务端）', count: 0 \}/.test(api))

check('弹窗：清单懒加载（不点不打网络）+ 搜索过滤 + 点选填充',
  /const openRepoPicker = async \(\) => \{/.test(dialog) &&
  dialog.includes('已有缓存，不重复拉') &&
  /const pickRepo = \(repo: RepoItem\) => \{/.test(dialog) &&
  /r\.fullName\.toLowerCase\(\)\.includes\(q\)/.test(dialog) &&
  /setRepoUrl\(repo\.url\)/.test(dialog))

check('清单展示私有/语言/描述（一眼能分辨选哪个）',
  dialog.includes('r.isPrivate &&') && dialog.includes('ts-repo-lang') &&
  dialog.includes('ts-repo-desc') && dialog.includes('ts-repo-name'))

check('清单拉不到时保留手输入口（不隐藏地址框）',
  // 地址框与选择按钮是同级的独立元素，不随清单开关而消失
  /className="ts-input"[\s\S]{0,200}value=\{repoUrl\}/.test(dialog) &&
  dialog.includes('收起仓库清单') && dialog.includes('选择我的仓库'))

console.log('— 图标风格（线条，不用 emoji）—')

check('新增线条图标集（24×24 / stroke 1.6 / currentColor）',
  /const ICON_BODIES: Record<string, string> = \{/.test(dialog) &&
  /stroke-width="1\.6"/.test(dialog) &&
  /stroke="currentColor"/.test(dialog) &&
  /stroke-linecap="round"/.test(dialog))

check('来源按钮与标题用线条图标，已无 emoji',
  dialog.includes('<Icon name="folder" /> 本地已有目录') &&
  dialog.includes('<Icon name="branch" /> 从 GitHub 克隆') &&
  /<Icon name="folder" size=\{15\} \/> 添加项目/.test(dialog) &&
  // emoji 不得回到这两个按钮/标题上
  !/📁 本地已有目录/.test(dialog) &&
  !/🐙 从 GitHub 克隆/.test(dialog) &&
  !/➕ 添加项目/.test(dialog))

check('图标容器类有样式（基线对齐，svg 不撑高行）',
  /\.ts-ico \{ display:inline-flex/.test(styles) &&
  /\.ts-ico svg \{ display:block/.test(styles))

console.log('— 样式 —')

check('来源切换 / 进度条样式齐全（跟随主题 token）',
  /\.ts-srcbtn-on \{/.test(styles) &&
  /\.ts-clone-bar \{/.test(styles) &&
  /\.ts-clone-fill \{/.test(styles) &&
  /\.ts-clone-fill-err \{/.test(styles) &&
  /border:1px solid var\(--ts-line\)/.test(styles))

check('弹窗里用到的 ts-* 类名都有 CSS 定义', (() => {
  const used = new Set([...dialog.matchAll(/className="([^"]+)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((c) => c.startsWith('ts-')))
  const missing = [...used].filter((c) => !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}[\\s,{:]`).test(styles))
  if (missing.length) console.log(`      缺定义: ${missing.join(' ')}`)
  return missing.length === 0
})())

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
