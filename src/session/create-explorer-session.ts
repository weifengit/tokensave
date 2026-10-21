/**
 * 探索者会话创建——官方原语直建（2026-10-09 去 dsh-call-session 化，方案①）。
 *
 * 背景：原先经 ctx.tools.execute('session_create')（dsh-call-session 提供）建探索者
 * 会话，是 tokensave 对第三方插件的最后硬依赖之一。调查（dsh 0.2.0-rc.2 源码）证实
 * session_create 内部就是三步官方原语的编排：
 *   ① ctx.agents.create(...)         —— dsh-agent 服务 + dsh-agent-loop 工厂：
 *                                       建会话、装配 agentCtx、启动 agent loop；
 *   ② ctx.agentPresets.resolve/mount —— 预设装配（标准预设的工具集/提示词等），
 *                                       即官方 sessionController.composeAgent 同款；
 *   ③ sessionTitle.rename            —— 标题持久化（session/title 事件，ADR-0017），
 *                                       缺席时回退 session.append。
 * 另两步（attachWorkspace、黑板引导公告）是 call-session 协作特性，探索者不需要。
 *
 * 本模块按同一顺序直调官方服务，因此：
 *   - meta.cwd 官方原生支持——原 withProjectCwd Proxy hack（改写调用方 agent 的
 *     cwd 读取）整体退役；
 *   - 探索者仍是普通 root 会话（不带 origin/parentSession），侧边栏可见，
 *     与旧 session_create 行为一致（非方案②的 subagent）；
 *   - agent loop 随 create 启动，随后 dispatchExplorerMessage 的 followup/
 *     steer 直投即可唤醒轮次（Step 11.1 已验证的同一路径）。
 *
 * 服务取得一律 ctx.get()（reflect 层，无需 inject）并兜住异常——与本插件其余处
 * （boardStore/agents/llm）同款处理。
 */
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { splitModel } from '../explorer-catalog.ts'
import { isRemovedProjectPath } from '../board-web-route.ts'

/** 取一个宿主服务：reflect 层免 inject，未注册/未就绪返回 undefined。 */
function serviceOf(ctx: Context, name: string): any {
  try {
    return (ctx as any).get?.(name)
  } catch {
    return undefined
  }
}

export interface CreateExplorerSessionOptions {
  /** 探索者工作区（绝对路径；meta.cwd 官方校验必须是绝对路径）。 */
  cwd: string
  /** 会话标题（tokensave- 前缀；explorers 路由按它过滤，勿改格式）。 */
  title: string
  /** 模型规格 `provider/model`（探索者预设/用户选择的原始格式）。 */
  model: string
}

/**
 * 用官方原语创建一个探索者 root 会话，返回 sessionId。
 *
 * 失败即抛（服务缺席/预设解析失败/创建失败），不静默降级——死会话曾是
 * Step 10 的教训，宁可让 tokensave_delegate 报错也不留无 driver 的空壳。
 */
export async function createExplorerSession(
  ctx: Context,
  opts: CreateExplorerSessionOptions,
): Promise<string> {
  // ① agents 服务（dsh-agent）——工厂由 agent-loop 注册；缺席即无法建会话。
  const agents = serviceOf(ctx, 'agents')
  if (!agents || typeof agents.create !== 'function') {
    throw new Error(
      'tokensave: 官方 agents 服务不可用（需 dsh-agent + agent-loop 工厂），无法创建探索者会话',
    )
  }

  const [provider, model] = splitModel(opts.model)
  const sessionId = `session-${randomUUID()}`

  // ② 预设装配（agentPresets 服务，官方 sessionController.composeAgent 同款）。
  //    服务缺席时退化为不挂 setup——与 composeAgent 的降级一致（仅装模型选择）。
  let setup: ((agentCtx: any, agent: any) => Promise<void>) | undefined
  let agentPreset: string | undefined
  const presets = serviceOf(ctx, 'agentPresets')
  if (presets && typeof presets.resolve === 'function' && typeof presets.mount === 'function') {
    const resolved = await presets.resolve(undefined)
    agentPreset = resolved?.id
    if (agentPreset) {
      setup = async (agentCtx: any) => {
        await presets.mount(agentCtx, agentPreset)
      }
    }
  }

  // 官方 createOrAdopt 建会话前同样 mkdir 保证项目目录存在（避免空目录项目首跑失败），
  //
  // 但**不能**为一个已被「移除项目」的路径重新造目录：用户刚把项目连文件夹一起删掉，
  // 这里一 mkdir 就会在磁盘上把它（空的）变回来 —— 看起来就像「移除只删了里面的东西」。
  // 判据是移除墓碑（~/.dsh/tokensave/projects.removed.json，见 isRemovedProjectPath）；
  // 用户真的要恢复项目，得重新走「添加项目」（那会清掉墓碑），不能靠 mkdir 悄悄重建。
  if (isRemovedProjectPath(opts.cwd)) {
    console.warn(`[dsh-tokensave] 探索者 cwd 指向已移除的项目，跳过 mkdir（不把删掉的目录造回来）: ${opts.cwd}`)
  } else {
    await mkdir(opts.cwd, { recursive: true })
  }

  // ① 建会话 + 启动 loop（CreateAgentOptions.meta.cwd / agentOptions 见 dsh-agent 类型）
  const handle = await agents.create({
    sessionId,
    agentOptions: { provider, model },
    meta: {
      cwd: opts.cwd,
      ...(agentPreset ? { agentPreset } : {}),
    },
    ...(setup ? { setup } : {}),
  })
  const agent: any = (handle as any)?.agent ?? handle
  if (!agent) {
    throw new Error(`tokensave: agents.create(${opts.title}) 未返回 agent 句柄`)
  }

  // 标题：与 dsh-call-session createRootAgent + appendTitleEvent 同款三连——
  // 直写内存字段（explorers 路由即时可见）+ sessionTitle 持久化（GUI 侧边栏显示），
  // 后者缺席/失败时回退 session/title 事件。标题失败不阻断创建（非致命）。
  try {
    agent.title = opts.title
    if (agent.session && !Object.isFrozen(agent.session)) agent.session.title = opts.title
  } catch { /* 冻结/只读——忽略，下面还有持久化通道 */ }
  await persistTitle(ctx, agent, opts.title)

  console.log(`[dsh-tokensave] 探索者会话已创建(官方原语): ${sessionId} model=${opts.model} cwd=${opts.cwd}`)
  return sessionId
}

/** 标题持久化：sessionTitle.rename → 回退 session.append('session/title')。 */
async function persistTitle(ctx: Context, agent: any, title: string): Promise<void> {
  const session = agent?.session ?? agent
  const titles = serviceOf(ctx, 'sessionTitle')
  if (titles && typeof titles.rename === 'function') {
    try {
      await titles.rename(session, title)
      return
    } catch (e) {
      console.warn('[dsh-tokensave] sessionTitle.rename 失败，回退 session.append:', e)
    }
  }
  if (session && typeof session.append === 'function') {
    try {
      await session.append('session/title', {
        title,
        messageSeqs: [],
        source: { kind: 'user' },
      })
    } catch (e) {
      console.warn('[dsh-tokensave] session/title 事件写入失败（标题仅内存可见）:', e)
    }
  }
}
