#!/usr/bin/env node
/**
 * 版本号自动化递增 + 变更日志生成（开源发布用）。
 *
 *   node scripts/release.mjs patch|minor|major [--notes "补充说明"] [--no-tag] [--dry-run]
 *
 * 做的事（一次调用全做完，不需要人记步骤）：
 *   1. 读 package.json 的 version，按 semver 递增（patch=修 bug/小调整，
 *      minor=新功能/用户可见改进，major=破坏性变更）；
 *   2. 收集「上一个版本 tag 之后」的全部 commit 标题，按关键词分组
 *      （修复/新增/改进/文档/其他），生成这一段变更日志；
 *   3. 把新段落**prepend** 到 CHANGELOG.md（没有就新建）；
 *   4. 写回 package.json 的 version；
 *   5. git add + commit「release: v<ver>」+ 打 tag v<ver>（--no-tag 跳过）。
 *
 * 约定（见 docs/MAINTENANCE.md）：修完 bug / 做完功能，跑完 pnpm test 与
 * pnpm build:client 之后就跑本脚本——AI 不需要等用户提醒。
 * commit 标题写得清楚（一句话、动词开头），变更日志才好看：日志正文直接取自 commit。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const bump = argv.find((a) => ['patch', 'minor', 'major'].includes(a)) ?? 'patch'
const notesIdx = argv.indexOf('--notes')
const notes = notesIdx >= 0 ? argv[notesIdx + 1] : ''
const noTag = argv.includes('--no-tag')
const dry = argv.includes('--dry-run')

const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const [maj, min, pat] = String(pkg.version).split('.').map(Number)
const next =
  bump === 'major' ? `${maj + 1}.0.0`
  : bump === 'minor' ? `${maj}.${min + 1}.0`
  : `${maj}.${min}.${pat + 1}`

// 上一个版本 tag（没有 tag 就是第一次发版，收全部 commit）
const tags = git('tag', '-l', 'v*').split('\n').filter(Boolean)
const range = tags.length ? `${tags[tags.length - 1]}..HEAD` : 'HEAD'
const subjects = git('log', '--pretty=%s', range).split('\n').filter(Boolean)

/** 按关键词把 commit 归进变更日志分组（顺序即展示顺序） */
const GROUPS = [
  ['新增', /新增|feat|add|支持|接入/i],
  ['修复', /修复|fix|bug|修正|解决/i],
  ['改进', /优化|改进|refactor|perf|调整|适配/i],
  ['文档', /docs|文档|readme/i],
]
const buckets = new Map(GROUPS.map(([n]) => [n, []]))
buckets.set('其他', [])
for (const s of subjects) {
  const hit = GROUPS.find(([, re]) => re.test(s))
  buckets.get(hit ? hit[0] : '其他').push(s)
}

const today = new Date().toISOString().slice(0, 10)
const lines = [`## v${next} — ${today}`, '']
for (const [name, items] of buckets) {
  if (!items.length) continue
  lines.push(`### ${name}`, ...items.map((s) => `- ${s}`), '')
}
if (notes) lines.push(`### 备注`, `- ${notes}`, '')
const entry = lines.join('\n').trimEnd() + '\n'

const changelogPath = join(root, 'CHANGELOG.md')
const head = '# 变更日志\n\n> 本文件由 `scripts/release.mjs` 自动维护：每次发版把 git 提交按\n> 「新增/修复/改进/文档」分组追加到顶部。人工补充用 --notes。\n\n'
const old = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : head
const body = old.startsWith('# 变更日志') ? old.slice(old.indexOf('\n\n') + 2) : old
const changelog = head + entry + '\n' + body

if (dry) {
  console.log(`[dry-run] version ${pkg.version} -> ${next} (${bump})`)
  console.log('--- CHANGELOG 新段落 ---')
  console.log(entry)
  process.exit(0)
}

writeFileSync(changelogPath, changelog)
writeFileSync(pkgPath, JSON.stringify({ ...pkg, version: next }, null, 2) + '\n')
git('add', 'CHANGELOG.md', 'package.json')
git('commit', '-m', `release: v${next}`)
if (!noTag) git('tag', `v${next}`)
console.log(`✅ 已发版 v${next}（${bump}），CHANGELOG 收录 ${subjects.length} 条提交${noTag ? '（未打 tag）' : `，tag v${next}`}`)
