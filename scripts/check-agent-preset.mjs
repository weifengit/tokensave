/**
 * 模式选择器自检（纯函数 + 假宿主服务，不需要浏览器）。
 *
 *   node scripts/check-agent-preset.mjs
 *
 * 需求原话：「模式选择（标准、PTC、极简、创造）的入口不见了，请实现恢复。」
 *
 * 排查结论（写进断言，防止以后重新犯错）：入口由宿主 `AgentPresetSeat` 渲染，
 * 三道门禁 `if (!main || !developerTools || !ready) return null;`。连原生对话 tab
 * 都看不到，说明是 `ready`（清单非空）失败——宿主预设注册链没跑起来时**完全静默**。
 *
 * 因此这里钉四件事：
 *   1. 内置四模式的 id 与中文名映射（标准/PTC/极简/创造，id 是宿主稳定契约）；
 *   2. 服务缺失 / 清单为空 / 网关未就绪三种失败路径各自返回什么（不许崩、不许假装有）；
 *   3. 切换被拒时把宿主给的 reason 原样翻成可展示文案；
 *   4. 启动诊断确实会打日志，且工作台标题行真的挂了 chip、chip 对非空白会话只读。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-preset-'))

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

try {
  const out = join(dir, 'preset.mjs')
  await build({
    entryPoints: [join(root, 'client/src/panel/agent-preset.ts')],
    bundle: true,
    format: 'esm',
    outfile: out,
    platform: 'neutral',
    logLevel: 'silent',
  })
  const m = await import(out)

  // —— 1. 内置四模式的显示名（id 是宿主 dsh-agent-preset-registry 的稳定契约） ——
  check('标准模式', m.presetLabel({ id: 'standard' }) === '标准模式')
  check('PTC 模式（Programmatic Tool Calling）', m.presetLabel({ id: 'ptc' }) === 'PTC 模式')
  check('极简模式', m.presetLabel({ id: 'minimal' }) === '极简模式')
  check('创造模式', m.presetLabel({ id: 'cordis' }) === '创造模式')
  check('自建预设用它自己的 name（不覆盖成内置名）',
    m.presetLabel({ id: 'review', name: '代码审查' }) === '代码审查')
  check('未知 id 原样显示（不吞掉）', m.presetLabel({ id: 'weird-x' }) === 'weird-x')
  check('说明文字：内置有、自建有自己的、未知为空',
    m.presetDescription({ id: 'minimal' }).includes('Shell')
    && m.presetDescription({ id: 'x', description: '自定义说明' }) === '自定义说明'
    && m.presetDescription({ id: 'weird-x' }) === '')

  // —— 2. 失败路径：服务缺失 / 空清单 / 网关未就绪 ——
  // 每次换一个假宿主服务：通过官方测试注入点换掉上下文，再让 readService 去取
  const setService = (svc) => {
    m.__setContextForTest({ get: (name) => (name === 'agentPresets' ? svc : undefined) })
  }

  setService(undefined)
  const noSvc = await m.listAgentPresets()
  check('宿主没有 agentPresets 服务 → ok:false 且给出原因（不崩）',
    noSvc.ok === false && typeof noSvc.error === 'string' && noSvc.error.includes('agentPresets'))

  setService({ list: async () => ({ ok: true, value: { presets: [] } }) })
  const empty = await m.listAgentPresets()
  check('清单为空 → ok:true, rows 空（表示"链没跑起来"而不是报错）',
    empty.ok === true && empty.rows.length === 0)

  setService({ list: async () => ({ ok: true, value: { presets: [{ id: 'standard', isDefault: true }, { id: 'ptc' }] } }) })
  const good = await m.listAgentPresets()
  check('正常清单解析出每一项（含 isDefault）',
    good.ok === true && good.rows.length === 2 && good.rows[0].isDefault === true)
  check('畸形行被滤掉（id 不是字符串的项不进清单）',
    await (async () => {
      setService({ list: async () => ({ ok: true, value: { presets: [{ id: 'ok' }, { id: 123 }, null] } }) })
      const r = await m.listAgentPresets()
      return r.rows.length === 1 && r.rows[0].id === 'ok'
    })())

  setService({ list: async () => ({ ok: false, error: { code: 'gateway/invocation-unavailable', message: '网关未就绪' } }) })
  const gateway = await m.listAgentPresets()
  check('网关未就绪 → 视为空清单而非错误（稍后会自己好，与宿主同口径）',
    gateway.ok === true && gateway.rows.length === 0)

  setService({ list: async () => ({ ok: false, error: { code: 'other', message: '读失败' } }) })
  const failed = await m.listAgentPresets()
  check('其它读取失败 → ok:false 并带出原因',
    failed.ok === false && failed.error === '读失败')

  setService({ list: async () => { throw new Error('网络炸了') } })
  check('list 抛异常 → ok:false（不把异常抛给渲染层）',
    (await m.listAgentPresets()).ok === false)

  // —— 3. 切换被拒时把宿主 reason 原样交出来 ——
  setService({ select: async () => ({ ok: false, error: { message: '通用失败', details: { reason: '会话已开始，不能切换模式' } } }) })
  check('切换被拒 → 优先用宿主 details.reason（那是给用户看的原话）',
    (await m.selectAgentPreset('s1', 'ptc')) === '会话已开始，不能切换模式')
  setService({ select: async () => ({ ok: false, error: { message: '通用失败' } }) })
  check('没有 details.reason 时退回 error.message',
    (await m.selectAgentPreset('s1', 'ptc')) === '通用失败')
  setService({ select: async () => ({ ok: true, value: 'ptc' }) })
  check('切换成功 → undefined（调用方据此不改提示）',
    (await m.selectAgentPreset('s1', 'ptc')) === undefined)
  setService(undefined)
  check('没有服务时切换给出可展示原因（不静默失败）',
    (await m.selectAgentPreset('s1', 'ptc')).includes('agentPresets'))

  // —— 4. 启动诊断 + 挂载点（源码断言） ——
  const index = readFileSync(join(root, 'client/src/index.ts'), 'utf8')
  check('插件启动即跑诊断（void probeAgentPresets()）',
    index.includes('void probeAgentPresets()') && index.includes("from './panel/agent-preset'"))

  const main = readFileSync(join(root, 'client/src/panel/MainChat.tsx'), 'utf8')
  check('工作台标题行挂了模式选择器',
    main.includes('<AgentPresetChip sessionId={sessionId} editable={blank} />'))
  check('只对空白会话可切换（跑过一轮就只读，与宿主约束一致）',
    main.includes("const blank = !messages.some((m) => m.role === 'user' && !m.injected && !m.queued)"))
  check('空白判定排除注入与排队消息（它们不代表这轮开始了）',
    main.includes('!m.injected && !m.queued'))

  const chip = readFileSync(join(root, 'client/src/panel/agent-preset-chip.tsx'), 'utf8')
  check('清单为空时明确显示「模式不可用」（不让入口凭空消失）',
    chip.includes('模式不可用') && chip.includes('is-empty'))
  check('下拉 portal 到 body（面板可裁，普通 absolute 会被裁掉）',
    chip.includes('createPortal') && chip.includes('document.body'))
  check('非空白会话只读（disabled + 解释性 title）',
    chip.includes('disabled={!editable}') && chip.includes('is-readonly'))
  check('乐观更新被拒时回滚（点了不至于停在错的值上）',
    chip.includes('setCurrent(before)'))

  const styles = readFileSync(join(root, 'client/src/panel/styles.ts'), 'utf8')
  check('chip / 下拉 / 选项都有样式定义',
    ['.ts-preset-chip', '.ts-preset-menu', '.ts-preset-item'].every((sel) => styles.includes(`${sel} `)))
  const menuZ = Number((styles.match(/\.ts-preset-menu \{[^}]*z-index:(\d+)/) || [])[1])
  check('下拉 z-index 压过停靠输入条(35/42)、低于宿主弹窗(1000)', menuZ > 42 && menuZ < 1000, `z-index=${menuZ}`)

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
