#!/usr/bin/env node
/**
 * 从 dshbackup 归档回灌 DSH 历史会话（v3 -> 目标 sessions 目录）
 *
 * 背景：~/.dsh/sessions 在 2026-10-19 09:21 前后被整体重建，42 个会话的
 * session.v*.jsonl.zstd 已不在磁盘上，而 workspace.json 仍按项目登记着它们。
 * 本脚本把 ~/Documents/dshbackup 归档里还能找到的完整会话日志放回正确路径，
 * 其余（只在 projcache / cc-safety-net 里有痕迹的）只登记在报告里，不伪造。
 *
 * 设计原则：
 *   - 绝不覆盖任何已存在的日志文件；冲突即跳过并记录。
 *   - 绝不把会话写进用户主动删除过的项目（archivedSessionIds / removed 墓碑）。
 *   - 默认 dry-run，只有 --apply 才落盘；落盘前先做整体备份。
 *   - 保留原 v3 文件，DSH 自己会在打开时迁移出 v4，不替它做格式转换。
 *
 * 用法：
 *   node scripts/recovery/restore-dsh-sessions.mjs            # 演练
 *   node scripts/recovery/restore-dsh-sessions.mjs --apply    # 执行
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'

const HOME = os.homedir()
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh')
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions')
const WORKSPACE_JSON = path.join(DSH_HOME, 'storages', 'workspace.json')
const PROJCACHE_DIR = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions')
const SAFETY_LOG_DIR = path.join(HOME, '.cc-safety-net', 'logs')
const BACKUP_DIR = path.join(HOME, 'Documents', 'dshbackup')

const APPLY = process.argv.includes('--apply')
const log = (...a) => console.log(...a)

// ── DSH 的目录编码规则（与 dsh-session-persistence-jsonl 的 projectKey/encodeSegment 一致）──
function projectKey(cwd) {
  let out = ''
  let sep = false
  for (const ch of cwd) {
    const code = ch.charCodeAt(0)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!sep) out += '-'
      sep = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
      sep = false
    } else {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      sep = false
    }
  }
  return `--${(out.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}
function encodeSegment(raw) {
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (const ch of raw) {
    const code = ch.charCodeAt(0)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

// ── 读一条归档会话的 header（v3/v4 都是 zstd 包着的 jsonl，首行是 header）──
function readHeader(file) {
  const raw = zlib.zstdDecompressSync(fs.readFileSync(file))
  const line = raw.subarray(0, raw.indexOf(0x0a)).toString('utf8')
  return JSON.parse(line)
}

// ── 从 ~/Documents/dshbackup 里找出所有会话日志，同 id 取最新归档 ──
function collectArchives() {
  if (!fs.existsSync(BACKUP_DIR)) return []
  const tarballs = fs
    .readdirSync(BACKUP_DIR)
    .filter((n) => /^dsh-.*\.tar\.gz$/.test(n))
    .sort() // 文件名带时间戳，升序 => 后面的是更新的
  const best = new Map()
  for (const tb of tarballs) {
    let listing
    try {
      listing = execFileSync('tar', ['tzf', path.join(BACKUP_DIR, tb)], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
    } catch {
      continue
    }
    for (const line of listing.split('\n')) {
      if (!/session\.v\d+\.jsonl\.\w+$/.test(line)) continue
      const m = line.match(/(session-[0-9a-f-]{36})\/(session\.v(\d+)\.jsonl\.(\w+))$/)
      if (!m) continue
      const [, id, filename, ver, ext] = m
      const rank = Number(ver)
      const prev = best.get(id)
      if (!prev || rank > prev.rank || (rank === prev.rank && tb > prev.tarball)) {
        best.set(id, { id, entry: line, filename, rank, ext, tarball: tb })
      }
    }
  }
  return [...best.values()]
}

function extractEntry(tarball, entry, destFile) {
  const buf = execFileSync('tar', ['xzf', path.join(BACKUP_DIR, tarball), '-O', entry], {
    maxBuffer: 256 * 1024 * 1024,
  })
  fs.mkdirSync(path.dirname(destFile), { recursive: true })
  fs.writeFileSync(destFile, buf)
}

// ── 主流程 ──
const registry = JSON.parse(fs.readFileSync(WORKSPACE_JSON, 'utf8'))
const workspaces = registry.tables?.workspaces ?? {}
const archived = new Set(registry.global?.archivedSessionIds ?? [])
const registeredBy = new Map()
for (const [wid, w] of Object.entries(workspaces)) {
  for (const sid of w.sessionIds ?? []) registeredBy.set(sid, { wid, ws: w })
}
const projcacheIds = new Set(
  fs.existsSync(PROJCACHE_DIR)
    ? fs.readdirSync(PROJCACHE_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
    : [],
)
const safetyIds = new Set()
if (fs.existsSync(SAFETY_LOG_DIR)) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.jsonl') && e.name.includes('session-')) {
        safetyIds.add('session-' + e.name.split('session-')[1].replace(/\.jsonl$/, ''))
      }
    }
  }
  walk(SAFETY_LOG_DIR)
}

log('=== DSH 历史会话回灌 ===')
log(`DSH_HOME            : ${DSH_HOME}`)
log(`登记会话            : ${registeredBy.size}  (另有已删除/归档 ${archived.size})`)
log(`projcache 有痕迹    : ${projcacheIds.size}`)
log(`cc-safety-net 有痕迹: ${safetyIds.size}`)
log(`备份归档目录        : ${BACKUP_DIR}`)
log('')

const archives = collectArchives()
log(`归档中可提取的会话  : ${archives.length}`)
log('')

const plan = []
for (const a of archives) {
  let header
  try {
    const tmp = path.join(os.tmpdir(), `dsh-restore-${a.id}.zstd`)
    extractEntry(a.tarball, a.entry, tmp)
    header = readHeader(tmp)
    fs.rmSync(tmp, { force: true })
  } catch (error) {
    plan.push({ ...a, action: 'error', note: `无法解析: ${error.message}` })
    continue
  }
  const cwd = header.cwd
  if (!cwd) {
    plan.push({ ...a, action: 'error', note: 'header 无 cwd，无法定位项目目录' })
    continue
  }
  const projectDirKey = projectKey(cwd)
  const dir = path.join(SESSIONS_ROOT, projectDirKey, encodeSegment(a.id))
  const target = path.join(dir, a.filename)
  const site = registeredBy.get(a.id)

  if (archived.has(a.id)) {
    plan.push({ ...a, cwd, target, action: 'skip-archived', note: '在已删除列表里，不复活' })
    continue
  }
  if (fs.existsSync(target)) {
    plan.push({ ...a, cwd, target, action: 'skip-exists', note: '目标已存在，不覆盖', site })
    continue
  }
  // 别人的项目会话不塞进当前项目：cwd 必须是已登记项目，或该会话本身已登记
  const knownProject = Object.values(workspaces).some((w) => path.resolve(w.path) === path.resolve(cwd))
  const knownSite = Boolean(site)
  if (!knownProject && !knownSite) {
    plan.push({
      ...a,
      cwd,
      target,
      action: 'adopt-project',
      note: `项目未在登记表，将作为新工作区被 DSH 自动收养`,
    })
    continue
  }
  plan.push({ ...a, cwd, target, action: knownSite ? 'restore-registered' : 'restore-new', site })
}

const groups = {
  'restore-registered': [],
  'restore-new': [],
  'adopt-project': [],
  'skip-exists': [],
  'skip-archived': [],
  error: [],
}
for (const p of plan) groups[p.action]?.push(p)

log('--- 计划明细 ---')
for (const p of plan) {
  const tag = {
    'restore-registered': '回灌(已登记)',
    'restore-new': '回灌(新补登记)',
    'adopt-project': '回灌(新项目)',
    'skip-exists': '跳过(已存在)',
    'skip-archived': '跳过(已删除)',
    error: '失败',
  }[p.action]
  log(`  [${tag}] ${p.id}`)
  log(`            cwd=${p.cwd ?? '?'}`)
  if (p.target) log(`            -> ${p.target.replace(HOME, '~')}`)
  if (p.note) log(`            ${p.note}`)
}
log('')

// 仍然缺失、且只留下痕迹的会话
const recoverable = new Set(plan.filter((p) => p.action.startsWith('restore') || p.action === 'adopt-project').map((p) => p.id))
const stillMissing = [...registeredBy.keys()].filter((s) => !archived.has(s) && !recoverable.has(s) && !fs.existsSync(path.join(SESSIONS_ROOT, '**')))
log('--- 仍然无法找回的已登记会话 ---')
const missingFull = []
for (const [sid, { ws }] of registeredBy) {
  if (archived.has(sid) || recoverable.has(sid)) continue
  let onDisk = false
  const pdir = path.join(SESSIONS_ROOT, projectKey(ws.path))
  if (fs.existsSync(pdir)) {
    for (const sd of fs.readdirSync(pdir)) {
      if (sd === encodeSegment(sid)) onDisk = true
    }
  }
  if (onDisk) continue
  missingFull.push({ sid, project: ws.title, meta: projcacheIds.has(sid), tools: safetyIds.has(sid) })
}
for (const m of missingFull) {
  const hint = [m.meta ? '有projcache摘要' : '', m.tools ? '有工具命令记录' : ''].filter(Boolean).join('+') || '无任何痕迹'
  log(`  ${m.sid}  ${m.project}  (${hint})`)
}
log(`  合计 ${missingFull.length} 个`)
log('')

if (!APPLY) {
  log('=== 演练结束（未写入任何文件）===')
  log(`可回灌 ${recoverable.size} 个，其中 ${groups['restore-registered'].length} 个恢复已登记会话。`)
  log('确认无误后加 --apply 执行。')
  process.exit(0)
}

// ── 落盘：先整体备份 ──
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const snapRoot = path.join(DSH_HOME, `..`, `.dsh.pre-repair-${stamp}`)
log(`=== 开始执行，整体备份到 ${path.resolve(snapRoot)} ===`)
fs.mkdirSync(snapRoot, { recursive: true })
for (const rel of ['sessions', 'storages']) {
  const src = path.join(DSH_HOME, rel)
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(snapRoot, rel), { recursive: true, preserveTimestamps: true })
  }
}
fs.copyFileSync(WORKSPACE_JSON, path.join(snapRoot, 'workspace.json'))
log('备份完成')

let done = 0
for (const p of plan) {
  if (!['restore-registered', 'restore-new', 'adopt-project'].includes(p.action)) continue
  try {
    extractEntry(p.tarball, p.entry, p.target)
    fs.writeFileSync(path.join(path.dirname(p.target), 'session.lock'), '')
    done += 1
    log(`  ok  ${p.id}`)
  } catch (error) {
    log(`  FAIL ${p.id}: ${error.message}`)
  }
}
log(`实际回灌 ${done} 个会话`)
log('')
log('下一步：重启 dsh web 以重建 header 索引，然后刷新页面。')
