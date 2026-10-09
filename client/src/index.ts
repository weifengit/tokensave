// tokensave 客户端入口。
// 源码为 TS/JSX，经 scripts/build-client.mjs 打包为 __ModuleLoader__ 注册格式的
// classic-script 产物（Step 02 已知问题约定）。
//
// 槽位布局：
//  1. conversation.session.header.actions —— Probe 探测组件：
//     发现 tokensave-* 探索者会话计数（供简报窗展示）；订阅当前会话流，
//     捕获含 tokensave-brief 标记的内容挂简报浮窗。
//  2. conversation.view —— 「项目中心」tab（order 19）：项目列表本身
//     （卡片/列表两种展示 + 活跃对话序号点）；点卡片/记录行/「进入工作台」/序号点
//     都进入对应工作台。
//  3. conversation.view —— 「工作台」tab（order 20，id 保留 tokensave-control-room）：
//     某个已登记项目的 H 型工作台（左右两竖免费模型窗，中上共享黑板，中下宿主原生
//     输入条停靠，顶部一行项目预览 + 历史会话/新建会话）。
//
// 设计偏离 doc（Step 11 遗留）：不做 ctx.on('tool/result') 监听——0.2.0-rc.2 中
// tool/result 是会话事件而非 Cordis 事件（KB events.md 注明）。
// 探索者浮窗（shell.overlay）自项目中心上线后停用：模型窗口归位到 H 台两竖；
import type { Context } from '@deepseek-ai/cordis'
import { useEffect } from 'react'
import { getClientContext, setClientContext, subscribeSession, readService } from './session-subscribe'
import {
  sweepProjectSessionBindings, bindSessionToItsProject, bindSessionEventually, wrapSessionCreate, wrapSessionStart, registerViewTargets, setCurrentSessionId,
  VIEW_ID, WORKBENCH_LABEL, PROJECT_CENTER_VIEW_ID, PROJECT_CENTER_LABEL,
} from './panel/sessions'
import { mountBriefWindow, mountedExplorerCount } from './float/mount'
import { ControlRoom } from './panel/ControlRoom'
import { ProjectCenter } from './panel/ProjectCenter'
import { ControlRoomEntry } from './panel/ControlRoomEntry'
import { applyDockkitPatch } from './dockkit-patch'

export const inject = { slots: true }

const BRIEF_START = '<!-- tokensave-brief:v1:start -->'
const BRIEF_END = '<!-- tokensave-brief:v1:end -->'

let lastBrief = ""
function watchBrief(sessionId: string): () => void {
  // 订阅推送全量列表：任一消息含简报标记即挂简报窗；同一简报只挂一次
  return subscribeSession(sessionId, (list) => {
    for (const msg of list) {
      const i = msg.content.indexOf(BRIEF_START)
      const j = msg.content.indexOf(BRIEF_END)
      if (i < 0 || j < 0 || j < i) continue
      const brief = msg.content.slice(i, j + BRIEF_END.length)
      if (brief === lastBrief) return
      lastBrief = brief
      const ctx = getClientContext()
      if (ctx) mountBriefWindow(ctx, brief, mountedExplorerCount())
      return
    }
  })
}

// 会话作用域探测组件（KB slots.md 示例槽）：标准 props 提供 useSessions / sessionId
function Probe(props: any): null {
  // 探索者计数：由 H 台自身通过 telemetry 发现，这里仅保留简报监听
  const sid = props?.sessionId
  // 上报当前会话 id：侧边栏入口是 root 作用域、拿不到 sessionId，
  // 由这个始终挂载的 Probe 把它写到模块级变量供其读取。
  useEffect(() => {
    setCurrentSessionId(sid ? String(sid) : '')
  }, [sid])
  // 会话 → 工作台 自动绑定（#2）：Probe 挂在会话头部的 actions 槽（**始终挂载**），
  // 而 ControlRoom 只在本插件视图已激活时才挂载——因此扫描必须放在这里才能自举。
  //
  // 宿主按会话作用域从 localStorage 读视图偏好（dsh.conversation.<id>）；
  // 预写好它，用户从左侧边栏点会话/新建会话时宿主就会激活「项目中心」视图。
  useEffect(() => {
    const ctx = getClientContext()
    if (!ctx) return
    // ① 先把**当前**会话绑到它的项目。
    // 这是「新建会话后直接跳工作台」最关键的一步：宿主导航到新会话时
    // sid 会变，这里立即写偏好 + 激活视图，不依赖列表快照/轮询时机。
    if (sid) {
      try {
        bindSessionToItsProject(String(sid))
      } catch (e) {
        console.warn('[tokensave] 当前会话绑定失败', e)
      }
    }
    // ② 再全量扫描，兼顾「别处新建的会话」（新会话一进目录就绑好）。
    const run = () => {
      try {
        sweepProjectSessionBindings(ctx)
      } catch (e) {
        console.warn('[tokensave] 会话绑定扫描失败', e)
      }
    }
    run()
    // 轮询成本极低：首次之后都是 localStorage 读 + 内存比较，无网络/无建会话。
    const timer = window.setInterval(run, 5_000)
    return () => window.clearInterval(timer)
  }, [sid])

  // 简报监听：订阅当前会话流，捕获 tokensave-brief 标记后挂简报窗
  useEffect(() => {
    if (!sid) return
    let un: (() => void) | undefined
    try {
      un = watchBrief(String(sid))
    } catch (e) {
      console.warn('[tokensave] watchBrief 失败', e)
    }
    return () => {
      try {
        un?.()
      } catch {
        /* noop */
      }
    }
  }, [sid])
  return null
}

/**
 * 包装宿主会话导航，让「任意属于已登记项目的会话」都落到该项目的工作台（#2）。
 *
 * 做法：在 uiWorkspace.openSession 上打一层**一次性**包装——先写该会话的视图偏好
 * （dsh.conversation.<id>.view = tokensave-control-room），再调原函数。
 * 宿主激活视图时会读这个偏好，因此激活的是我们的工作台而非默认纯对话窗口。
 *
 * 为什么不用轮询/事件：会话创建→导航之间存在竞态，而偏好必须在宿主读之前写好；
 * 包装是同步且确定的，不依赖时序。幂等：已包装过则直接返回。
 */
function wrapSessionNavigation(): void {
  const ctx: any = getClientContext()
  if (!ctx) return
  const attempt = () => {
    const ui = readService<any>(ctx, 'uiWorkspace')
    if (!ui) return false
    // 关键：包 replaceMain 而不是 openSession。
    //
    // openSession 只覆盖「点会话」一条路；侧边栏「新建会话」走的是
    // startSession → openWorkspace → replaceMain，**不经过 openSession**。
    // replaceMain 是所有导航（openSession / openWorkspace / 默认恢复）的
    // 唯一汇合点，且在 selection.set（即视图激活）之前调 beforeOpen ——
    // 正是在这里把偏好写好，宿主随后激活的就是我们的工作台视图。
    if (typeof ui.replaceMain !== 'function') {
      // 降级：至少包住 openSession
      return wrapOpenSession(ui)
    }
    if ((ui.replaceMain as any).__tokensaveWrapped) return true
    const original = ui.replaceMain.bind(ui)
    const wrapped = (target: any, signal: any, panel: any, beforeOpen: any) => {
      // 宿主会在内部用 beforeOpen?.(resolvedId) 回调；我们把它包一层，
      // 拿到**已解析**的会话 id（target 可能是 workspaceId 或会话 id）。
      const hooked = (resolvedId: string) => {
        try {
          // 用带重试的绑定：新建会话刚返回时可能还没进列表快照（cwd 读不到），
          // 当场绑不上就排一串重试，等列表刷新后按 cwd 命中项目。
          if (resolvedId) bindSessionEventually(String(resolvedId))
        } catch (e) {
          console.warn('[tokensave] 会话→工作台绑定失败', e)
        }
        beforeOpen?.(resolvedId)
      }
      return original(target, signal, panel, hooked)
    }
    ;(wrapped as any).__tokensaveWrapped = true
    try {
      ui.replaceMain = wrapped
      console.log('[tokensave] 已接管 uiWorkspace.replaceMain（会话→工作台 自动绑定）')
      return true
    } catch (e) {
      console.warn('[tokensave] 无法替换 uiWorkspace.replaceMain（只读？）', e)
      return wrapOpenSession(ui)
    }
  }
  // 先试一次（服务可能已就绪）；未就绪则用 ctx.inject 等它就绪后再包。
  // 这样不依赖插件 apply 顺序，也不会因未就绪而永久退化为轮询。
  if (attempt()) return
  try {
    ctx.inject?.(['uiWorkspace'], () => { attempt() })
  } catch (e) {
    console.warn('[tokensave] 等待 uiWorkspace 失败（工作台绑定退化为扫描）', e)
  }
}

/** 降级路径：replaceMain 不可用时只包 openSession（覆盖「点会话」）。 */
function wrapOpenSession(ui: any): boolean {
  if (typeof ui.openSession !== 'function') return false
  if ((ui.openSession as any).__tokensaveWrapped) return true
  const original = ui.openSession.bind(ui)
  const wrapped = (target: any) => {
    try {
      const id = typeof target === 'string'
        ? target
        : String(target?.sessionId ?? target?.id ?? '')
      if (id) bindSessionEventually(id)
    } catch (e) {
      // 绑定失败不能阻断导航本身
      console.warn('[tokensave] 会话→工作台绑定失败', e)
    }
    return original(target)
  }
  ;(wrapped as any).__tokensaveWrapped = true
  try {
    ui.openSession = wrapped
    console.log('[tokensave] 已接管 uiWorkspace.openSession（降级路径）')
    return true
  } catch (e) {
    console.warn('[tokensave] 无法替换 uiWorkspace.openSession', e)
    return false
  }
}

export function apply(ctx: Context) {
  setClientContext(ctx)
  // DockKit 补丁：关闭主对话窗口后，空出的 docked pane 自动合并（相邻窗口扩展，不残留空白/遮罩）
  try {
    applyDockkitPatch()
  } catch (e) {
    console.warn('[dockkit-patch] apply failed:', e)
  }
  // #2 确定性入口：包装 uiWorkspace.replaceMain（所有导航的唯一汇合点），
  // 在宿主激活视图前把该会话绑到它所属项目的工作台。这样左侧边栏点会话/新建会话、
  // 工作台内切会话都自动落到工作台，而不是宿主默认的纯对话窗口。
  wrapSessionNavigation()
  // 同样接管 sessions.create：侧边栏新建的会话在创建时即写好视图偏好
  // （openSession 时机可能拿不到 cwd，不能只靠那一层）。
  wrapSessionCreate()
  // 接管宿主侧边栏的全部「新会话」入口（uiWorkspace.startSession）：
  // 徽标下那个 → 项目中心（项目列表）；项目文件夹悬浮那个 → 该项目的工作台。
  wrapSessionStart()
  // 注册 conversation.view 的 target：宿主对**空白会话**只在 activeTargets 非空时
  // 才渲染视图，而 target 只认“注册过且 isActive”的视图（ui-chat/ui-trajectory 都自带）。
  // 少了这步，新建出来的空白会话永远停在 Hero「选择一个工作区」，进不了工作台。
  registerViewTargets(ctx)
  try {
    const slots = (ctx as any).slots
    // 1. 会话头部动作区探测组件（简报监听）
    slots?.inject('conversation.session.header.actions', () =>
      slots.register(
        { name: 'conversation.session.header.actions', id: 'tokensave-probe', order: 900 },
        Probe
      )
    )
    // 2. conversation.view —— 「项目中心」tab（真正的项目列表：卡片/列表 + 活跃序号点）
    slots?.inject('conversation.view', () =>
      slots.register(
        {
          name: 'conversation.view',
          id: PROJECT_CENTER_VIEW_ID,
          order: 19,
          label: PROJECT_CENTER_LABEL,
          // 宿主按会话作用域注入 sessionId；slot 级 props（openView 等）合并进组件入参
          inject: (sessionId: string) => ({ sessionId }),
        },
        ProjectCenter
      )
    )
    // 3. conversation.view —— 「工作台」tab（原「项目中心」）
    //    id 保留不变量：宿主按 id 存每会话视图偏好，改 id 会让旧偏好悬空回落；
    //    只把 label 改成「工作台」（会话→工作台自动绑定仍然指向这个 tab）。
    slots?.inject('conversation.view', () =>
      slots.register(
        {
          name: 'conversation.view',
          id: VIEW_ID,
          order: 20,
          label: WORKBENCH_LABEL,
          inject: (sessionId: string) => ({ sessionId }),
        },
        ControlRoom
      )
    )
    // 4. sidebar.footer.action —— 侧边栏「项目中心」入口
    // 用户要求把入口放在左侧边栏。这是 root 作用域的 list 槽，拿不到 sessionId，
    // 当前会话由 Probe 上报（见 setCurrentSessionId）。
    slots?.inject('sidebar.footer.action', () =>
      slots.register(
        { name: 'sidebar.footer.action', id: 'tokensave-control-room-entry', order: 10 },
        ControlRoomEntry
      )
    )
  } catch (e) {
    console.warn('[tokensave] 客户端组件注册失败', e)
  }
}
