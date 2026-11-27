/**
 * 「排队消息也能改文字」自检（真实投影 + 可注入 face，无需浏览器）。
 *
 *   node scripts/check-queued-edit.mjs
 *
 * 用户反馈：「当混合了图片和文字的提示词放在排队队列里面的时候，无法重新编辑
 * 文字提示词」。
 *
 * 宿主的队列编辑接口只接受**纯文本**（`updateQueue(edit)` 的 content 必须是
 * TextBlock[]），所以：
 *   1. 文本-only：原地 edit；
 *   2. 带图片：读回图片字节 → 移除旧项 → 以「图片 + 新文字」重新排队
 *      （图片不丢，代价是排到队尾）；
 *   3. 带文件：无法重放文件凭据 → 拒绝编辑，队列保持原样；
 *   4. 失败时保留输入框文字，并在重新排队失败时尽量按原文恢复。
 *
 * 这里钉：数据投影带 queueId / hasFiles、三条路径的调用顺序、失败兜底、界面接线。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-queue-edit-'))
let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

try {
  const out = join(dir, 'sub.mjs')
  await build({
    entryPoints: [join(root, 'client/src/session-subscribe.ts')],
    bundle: true, format: 'esm', outfile: out, platform: 'neutral', logLevel: 'silent',
  })
  const m = await import(out)

  const imageRef = {
    type: 'image',
    attachment: { attachmentId: 'sha256:img1', mediaType: 'image/png', bytes: 3, width: 4, height: 2, name: 'a.png' },
  }
  const spliced = (inserted, time = Date.now()) => ({
    type: 'event',
    event: { type: 'agent/inbox/spliced', time, data: { target: 'next-turn', start: 0, removedCount: 0, inserted } },
  })

  console.log('— 1. 投影：排队消息带 queueId / hasFiles —')
  {
    const msgs = m.messagesFromWindow({ entries: [spliced([
      { id: 'msg-1', role: 'user', content: [imageRef, { type: 'text', text: '看图' }] },
    ])] })
    const q = msgs.find((x) => x.queued)
    check('queueId 取自宿主 inbox 的 message.id', q?.queueId === 'msg-1', q?.queueId)
    check('图片 + 文字都被投影', q?.content === '看图' && q?.images?.length === 1)
    check('图片消息不带 hasFiles', q?.hasFiles !== true)
  }
  {
    const msgs = m.messagesFromWindow({ entries: [spliced([
      { id: 'msg-2', role: 'user', content: [{ type: 'file', receiptId: 'r1' }, { type: 'text', text: '附件' }] },
    ])] })
    check('文件附件标记 hasFiles（编辑时拒绝而不是悄悄丢文件）', msgs.find((x) => x.queued)?.hasFiles === true)
  }

  console.log('— 2. 文本-only：原地 edit（位置不变）—')
  {
    const calls = []
    const face = {
      updateQueue: async (id, action) => { calls.push({ id, action }); return { ok: true, value: { accepted: true } } },
      prompt: async () => { calls.push({ prompt: true }); return { ok: true } },
    }
    const res = await m.applyQueueTextEdit(face, {
      queueId: 'q1', content: '旧文字', images: undefined, hasFiles: false,
    }, '  新文字  ')
    check('成功返回', res.ok === true)
    check('只调用一次 updateQueue(edit)，不重新排队',
      calls.length === 1 && calls[0].action.kind === 'edit' && calls[0].action.content[0].text === '新文字')
    check('没有 prompt 调用', !calls.some((c) => c.prompt))
  }

  console.log('— 3. 图片 + 文字：读图 → 移除 → 重新排队（图片保留）—')
  {
    const calls = []
    const face = {
      readAttachment: async (attachment) => {
        calls.push({ read: attachment.attachmentId })
        return { ok: true, value: { data: new Uint8Array([1, 2, 3]) } }
      },
      updateQueue: async (id, action) => { calls.push({ id, action }); return { ok: true } },
      prompt: async (content, mode) => { calls.push({ content, mode }); return { ok: true } },
    }
    const res = await m.applyQueueTextEdit(face, {
      queueId: 'q2',
      content: '看图',
      images: [{ attachmentId: 'sha256:img1', mediaType: 'image/png', bytes: 3, width: 4, height: 2, name: 'a.png' }],
    }, '改后的文字')
    check('成功且标记 requeued', res.ok === true && res.requeued === true)
    check('调用顺序：读图 → 移除旧项 → 重新排队',
      calls[0]?.read === 'sha256:img1' && calls[1]?.action?.kind === 'remove' && !!calls[2]?.content)
    const parts = calls[2]?.content ?? []
    check('新 prompt 先图后字', parts[0]?.type === 'image' && parts.at(-1)?.type === 'text')
    check('图片按原 mediaType / name / 字节重放', parts[0]?.mediaType === 'image/png'
      && parts[0]?.name === 'a.png' && parts[0]?.data === 'AQID')
    check('新文字带上', parts.at(-1)?.text === '改后的文字')
    check('以 queue 模式重新排队', calls[2]?.mode === 'queue')
  }

  console.log('— 4. 失败兜底：不丢用户的文字 —')
  {
    const calls = []
    const face = {
      readAttachment: async () => { calls.push('read'); return { ok: false, error: { code: 'session/attachment-not-found' } } },
      updateQueue: async () => { calls.push('update'); return { ok: true } },
      prompt: async () => { calls.push('prompt'); return { ok: true } },
    }
    const res = await m.applyQueueTextEdit(face, {
      queueId: 'q3', content: '', images: [{ attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }],
    }, '新文字')
    check('图片读不到 → 直接失败，队列不动（没有 remove / prompt）',
      res.ok === false && /图片读取失败/.test(res.error) && !calls.includes('update') && !calls.includes('prompt'))
  }
  {
    const calls = []
    const face = {
      updateQueue: async (id, action) => {
        calls.push(action)
        return action.kind === 'remove'
          ? { ok: false, error: { code: 'session/queue-item-not-found', message: 'no longer pending' } }
          : { ok: true }
      },
      readAttachment: async () => ({ ok: true, value: { data: new Uint8Array([9]) } }),
      prompt: async () => { calls.push('prompt'); return { ok: true } },
    }
    const res = await m.applyQueueTextEdit(face, {
      queueId: 'q4', content: '原文', images: [{ attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }],
    }, '新文字')
    check('移除旧项失败 → 不重新排队，报可读原因',
      res.ok === false && /移除旧排队项失败/.test(res.error) && !calls.includes('prompt'))
  }
  {
    const prompts = []
    let removeDone = false
    const face = {
      updateQueue: async (id, action) => { if (action.kind === 'remove') removeDone = true; return { ok: true } },
      readAttachment: async () => ({ ok: true, value: { data: new Uint8Array([1]) } }),
      prompt: async (content) => {
        prompts.push(content)
        return prompts.length === 1 ? { ok: false, error: { message: 'boom' } } : { ok: true }
      },
    }
    const res = await m.applyQueueTextEdit(face, {
      queueId: 'q5', content: '原文', images: [{ attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }],
    }, '新文字')
    check('重新排队失败 → 尝试按原文恢复（图片仍然带着）',
      res.ok === false && removeDone && prompts.length === 2
      && prompts[1].at(-1)?.text === '原文' && prompts[1][0]?.type === 'image')
    check('失败信息分「已恢复 / 恢复也失败」两态',
      /已按原文恢复/.test(res.error))
  }

  console.log('— 5. 不该动的输入 —')
  {
    const calls = []
    const face = {
      updateQueue: async () => { calls.push('update'); return { ok: true } },
      prompt: async () => { calls.push('prompt'); return { ok: true } },
      readAttachment: async () => ({ ok: true, value: { data: new Uint8Array([1]) } }),
    }
    const empty = await m.applyQueueTextEdit(face, { queueId: 'q', content: 'x' }, '   ')
    check('空文字被拒', empty.ok === false && /不能为空/.test(empty.error) && calls.length === 0)
    const noId = await m.applyQueueTextEdit(face, { queueId: '', content: 'x' }, '新')
    check('没有 queueId 被拒', noId.ok === false && calls.length === 0)
    const files = await m.applyQueueTextEdit(face, { queueId: 'q', content: 'x', hasFiles: true }, '新')
    check('含文件附件被拒且不发起任何调用',
      files.ok === false && /文件附件/.test(files.error) && calls.length === 0)
    const noFace = await m.applyQueueTextEdit(null, { queueId: 'q', content: 'x' }, '新')
    check('会话 face 不可用给出可读原因', noFace.ok === false && /未就绪|未连接/.test(noFace.error))
  }

  console.log('— 6. 界面接线 —')
  const listSrc = readFileSync(join(root, 'client/src/panel/MsgList.tsx'), 'utf8')
  const queued = readFileSync(join(root, 'client/src/panel/queued-message.tsx'), 'utf8')
  const css = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
  check('消息流用 QueuedMessage 渲染排队气泡', /<QueuedMessage sessionId=\{sessionId\} message=\{m\} gallery=\{galleryImages\} \/>/.test(listSrc))
  check('排队气泡有「编辑」入口与内联编辑框',
    /data-queued-edit-btn/.test(queued) && /data-queued-edit=""/.test(queued) && /ts-queue-edit-box/.test(queued))
  check('保存走 editQueuedMessage（不自己拼宿主 RPC）',
    /await editQueuedMessage\(sessionId, message, draft\)/.test(queued))
  check('混合图片时提前说明「图片保留 / 移到队尾」',
    /图片会保留；保存后这条会移到队尾/.test(queued))
  check('失败保留输入框文字并就地报错（不关编辑器）',
    /setError\(result\.error \|\| '编辑失败'\)/.test(queued) && /role="alert"/.test(queued))
  check('文件附件显示「不可编辑」而不是给一个点了会失败的表',
    /message\.hasFiles && \(/.test(queued) && /不可编辑/.test(queued))
  check('编辑相关样式齐全',
    /\.ts-queue-edit \{/.test(css) && /\.ts-queue-edit-box \{/.test(css)
    && /\.ts-queue-edit-error \{/.test(css))
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  check('自检已接入 pnpm test 链',
    pkg.scripts?.['test:queued-edit'] === 'node scripts/check-queued-edit.mjs'
    && pkg.scripts?.test?.includes('pnpm test:queued-edit'))

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}