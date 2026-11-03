/**
 * 轮末「已编辑 N 个文件」投影自检（纯函数 + 假事件窗口，不需要浏览器）。
 *
 *   node scripts/check-turn-edits.mjs
 *
 * 需求原话：「参考原生的对话 tab，在结束报告"已编辑*个文件"并展示。」
 *
 * 数据口径与宿主 dsh-workspace-changes 的 mutationPath 对齐：
 * 只有 write(file_path) / edit(file_path+新旧串) / str_replace_editor(path，
 * create|str_replace|insert) 三类真正落盘的编辑才算；同轮同路径去重。
 * tool/call 不进消息流（参数 JSON 无展示价值），只把文件编辑折叠成
 * kind:'file-edit' 标记消息留给 MsgList 统计。
 *
 * 这里钉三件事：
 *   1. fileEditOf 对三类工具的参数口径（含反例：无 content 的 write 不算）；
 *   2. messagesFromWindow 把编辑 tool/call 折叠为 file-edit 标记、其它 tool/call 不投影；
 *   3. MsgList 的 splitTurn 按轮收集并去重（源码断言）。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-edits-'))

try {
  const out = join(dir, 't.mjs')
  await build({
    entryPoints: [join(root, 'client/src/session-subscribe.ts')],
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
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  // —— 1. fileEditOf 的三类工具口径（与宿主 mutationPath 对齐） ——
  check('write：带 content 时取 file_path',
    m.fileEditOf('write', { content: 'x', file_path: 'a.ts' }) === 'a.ts')
  check('write：无 content 不算（比如只读探测）',
    m.fileEditOf('write', { file_path: 'a.ts' }) === null)
  check('edit：带新旧串时取 file_path',
    m.fileEditOf('edit', { file_path: 'b.ts', old_string: 'a', new_string: 'b' }) === 'b.ts')
  check('edit：缺新旧串不算', m.fileEditOf('edit', { file_path: 'b.ts' }) === null)
  check('str_replace_editor：create/str_replace/insert 取 path',
    m.fileEditOf('str_replace_editor', { command: 'create', path: 'c.ts' }) === 'c.ts'
    && m.fileEditOf('str_replace_editor', { command: 'str_replace', path: 'c.ts' }) === 'c.ts'
    && m.fileEditOf('str_replace_editor', { command: 'insert', path: 'c.ts' }) === 'c.ts')
  check('str_replace_editor：view 等只读 command 不算',
    m.fileEditOf('str_replace_editor', { command: 'view', path: 'c.ts' }) === null)
  check('非编辑工具（bash/ grep 等）一律不算',
    m.fileEditOf('bash', { command: 'rm x' }) === null && m.fileEditOf('read', { path: 'x' }) === null)
  check('参数缺失 / 非对象不炸', m.fileEditOf('write', undefined) === null && m.fileEditOf('write', 'x') === null)

  // —— 2. messagesFromWindow 的投影 ——
  const call = (name, args, time) => ({ type: 'event', event: { type: 'tool/call', time, data: { turn: 1, step: 1, callId: `c${time}`, name, arguments: args } } })
  const user = (text, time) => ({ type: 'event', event: { type: 'user/message', time, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } } })
  const assistant = (text, time) => ({ type: 'event', event: { type: 'assistant/message', time, data: { content: [{ type: 'text', text }] } } })

  const snap = {
    entries: [
      user('帮我改一下', 1000),
      call('edit', { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' }, 1100),
      call('write', { content: 'x', file_path: 'src/b.ts' }, 1200),
      call('bash', { command: 'ls' }, 1300),            // 非编辑：不投影
      call('edit', { file_path: 'src/a.ts', old_string: 'c', new_string: 'd' }, 1400), // 同文件第二次：仍投影，去重交给 MsgList
      assistant('改好了', 1500),
    ],
  }
  const msgs = m.messagesFromWindow(snap)
  const edits = msgs.filter((x) => x.kind === 'file-edit').map((x) => x.editPath)
  check('编辑 tool/call 折叠为 file-edit 标记（按出现顺序）',
    eq(edits, ['src/a.ts', 'src/b.ts', 'src/a.ts']))
  check('非编辑 tool/call 不产生任何消息行',
    msgs.every((x) => x.kind === 'file-edit' || x.type !== 'tool/call'))
  check('用户与最终回答照常在流里',
    msgs.some((x) => x.role === 'user' && x.content === '帮我改一下')
    && msgs.some((x) => x.role === 'assistant' && x.content === '改好了'))
  check('标记消息不携带可见文本（不会渲染成气泡）',
    msgs.filter((x) => x.kind === 'file-edit').every((x) => x.content === ''))

  // —— 3. MsgList 按轮收集去重（源码断言） ——
  const list = readFileSync(join(root, 'client/src/panel/MsgList.tsx'), 'utf8')
  check('splitTurn 收集 file-edit 并去重',
    list.includes("if (m.kind === 'file-edit' && m.editPath)")
    && list.includes('if (!edits.includes(m.editPath)) edits.push(m.editPath)'))
  check('轮末渲染 EditsRow（answer 之后）',
    list.includes('<EditsRow files={t.edits} />')
    && list.indexOf('<EditsRow files={t.edits} />') < list.indexOf('<TurnNoticeRow'))
  check('报告文案对齐原生（已编辑 N 个文件）', list.includes('已编辑 {files.length} 个文件'))

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
