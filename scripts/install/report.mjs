// 安装报告：把编排结果翻译成用户能照着做的下一步。
// 单独成模块的理由：成功路径要让用户知道「怎么启动」，失败路径要给出**可执行的**
// 修法而不是错误码堆叠；这两种输出都会随 dsh 版本变化，集中在一处便于一起改。
import { PACKAGE_NAME } from './profile.mjs'

/** ANSI 颜色：非 TTY（重定向到文件/CI）时自动退化为无色。 */
const useColor = process.stdout.isTTY === true
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text)
const green = (text) => paint('32', text)
const red = (text) => paint('31', text)
const dim = (text) => paint('2', text)
const bold = (text) => paint('1', text)

/**
 * 打印安装报告。
 * @param {object} report runInstall 产出的报告数据。
 * @returns {void}
 */
export function printReport(report) {
  const lines = ['']
  const push = (line = '') => lines.push(line)

  push(bold(`tokensave 安装器 ${report.dryRun ? dim('(预览，未写文件)') : ''}`))
  push(dim(`  插件目录 ${report.root}`))
  push(dim(`  dsh home ${report.home}`))

  if (report.artifact !== null && report.artifact !== undefined) {
    if (report.artifact.action === 'dry-run') {
      push(`  客户端产物 ${report.artifact.exists ? green('已存在') : red('缺失，将构建')}`)
    } else if (report.artifact.built) {
      push(`  客户端产物 ${green('已构建')} ${dim(`(${formatSize(report.artifact.size)})`)}`)
    } else if (report.artifact.exists) {
      push(`  客户端产物 ${green('已存在')} ${dim(`(${formatSize(report.artifact.size)})`)}`)
    }
  }

  push()
  for (const item of report.profiles) {
    if (item.ok && item.action === 'dry-run') push(`  ${dim('将安装')} ${bold(item.profile)}`)
    else if (item.ok) push(`  ${green('✓')} ${bold(item.profile)} ${dim(item.dir ?? '')}`)
    // `--profile all` 下因缺少 dsh CLI 而没装的 web：不是错误，是这台机器上没这个目标。
    else if (item.skippedForAll) {
      push(`  ${dim('–')} ${item.profile} ${dim(`已跳过：${String(item.error ?? '').split('\n')[0]}`)}`)
    } else {
      push(`  ${red('✗')} ${bold(item.profile)}`)
      for (const line of String(item.error ?? '未知错误').split('\n')) push(`    ${line}`)
    }
  }
  for (const item of report.skipped) push(`  ${dim('–')} ${item.profile} ${dim(`已跳过：${item.reason}`)}`)

  const failed = report.profiles.filter((item) => !item.ok && !item.skippedForAll)
  const succeeded = report.profiles.filter((item) => item.ok && item.action !== 'dry-run')

  push()
  if (failed.length > 0) {
    push(red('安装未完成。'))
    pushHints(failed, push)
  } else if (report.dryRun) {
    push(dim('预览结束。去掉 --dry-run 即可执行。'))
  } else {
    push(green(bold('安装完成。')))
    pushNextSteps(report.profiles.filter((item) => item.ok && item.action !== 'dry-run'), push)
  }

  process.stdout.write(`${lines.join('\n')}\n`)
}

/**
 * 失败时的可执行修法。
 * @param {object[]} failed 失败的条目。
 * @param {(line?: string) => void} push 输出行回调。
 * @returns {void}
 */
function pushHints(failed, push) {
  const messages = failed.map((item) => String(item.error ?? ''))
  push(dim('排查建议：'))
  if (messages.some((text) => text.includes('dist') || text.includes('客户端产物'))) {
    push(dim('  · 客户端产物构建失败：仓库目录里手动跑 `pnpm install && pnpm build:client`，看完整报错'))
  }
  if (messages.some((text) => text.includes('桌面端 profile 尚未初始化'))) {
    push(dim('  · 桌面端：先打开一次 dsh 桌面端应用初始化 profile，再重跑本命令'))
  }
  if (messages.some((text) => text.includes('未找到 dsh'))) {
    push(dim('  · 未找到 dsh：先安装 DeepSeek Harness CLI（npm i -g @deepseek-ai/dsh）'))
  }
  if (messages.some((text) => text.includes('pnpm'))) {
    push(dim('  · 未找到 pnpm：npm i -g pnpm'))
  }
  push(dim('  · 仍不行时把上面的完整输出贴出来'))
}

/**
 * 成功后的启动指引。
 * @param {object[]} succeeded 成功的条目。
 * @param {(line?: string) => void} push 输出行回调。
 * @returns {void}
 */
function pushNextSteps(succeeded, push) {
  const names = succeeded.map((item) => item.profile)
  push()
  push('下一步：')
  if (names.includes('web')) push(`  启动端口模式   ${bold('dsh web')}`)
  if (names.includes('desktop')) push(`  启动桌面端     打开 DeepSeek Harness 桌面端应用`)
  // 桌面端 profile 由 Electron 应用独占，CLI 的 `plugin --profile desktop` 会被拒，
  // 所以卸载命令只在装了 web 时给；桌面端要从应用内的插件管理卸载。
  if (names.includes('web')) push(dim(`  卸载          dsh plugin --profile web remove ${PACKAGE_NAME}`))
  if (names.includes('desktop')) push(dim('  卸载桌面端     在桌面端应用的插件管理里移除，或删除其 profile 清单里的该行'))
  push()
  push(dim('插件源码改动后需重启 dsh web 生效；客户端改动要重新 `pnpm build:client` 并刷新页面。'))
}

/**
 * 人类可读的体积。
 * @param {number} bytes 字节数。
 * @returns {string} 形如 `1.5 MB`。
 */
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}
