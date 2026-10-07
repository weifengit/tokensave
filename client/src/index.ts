// tokensave 客户端入口。
// 源码为 TS/JSX，经 scripts/build-client.mjs 打包为 __ModuleLoader__ 注册格式的
// classic-script 产物（Step 02 已知问题约定）。
//
// 槽位布局：
//  1. conversation.session.header.actions —— Probe 探测组件：
//     发现 tokensave-* 探索者会话计数（供简报窗展示）；订阅当前会话流，
//     捕获含 tokensave-brief 标记的内容挂简报浮窗。
//  2. conversation.view —— 「项目中心」tab（order 20，位于看板之后）：
//     项目卡片列表 + 添加项目弹窗（仅选项目文件夹，布局固定 H 型 1 种无选择项），
//     进入后为 H 型工作台（左右两竖免费模型窗，中上共享黑板，中下宿主原生输入条停靠）。
//
// 设计偏离 doc（Step 11 遗留）：不做 ctx.on('tool/result') 监听——0.2.0-rc.2 中
// tool/result 是会话事件而非 Cordis 事件（KB events.md 注明）。
// 探索者浮窗（shell.overlay）自项目中心上线后停用：模型窗口归位到 H 台两竖；
import type { Context } from '@deepseek-ai/cordis'
import { useEffect } from 'react'
import { getClientContext, setClientContext, subscribeSession } from './session-subscribe'
import { mountBriefWindow, mountedExplorerCount } from './float/mount'
import { ControlRoom } from './panel/ControlRoom'

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

export function apply(ctx: Context) {
  setClientContext(ctx)
  try {
    const slots = (ctx as any).slots
    // 1. 会话头部动作区探测组件（简报监听）
    slots?.inject('conversation.session.header.actions', () =>
      slots.register(
        { name: 'conversation.session.header.actions', id: 'tokensave-probe', order: 900 },
        Probe
      )
    )
    // 2. conversation.view —— 「项目中心」tab
    slots?.inject('conversation.view', () =>
      slots.register(
        {
          name: 'conversation.view',
          // id 保留（宿主每会话视图偏好存 localStorage，改 id 会让旧偏好悬空回落）
          id: 'tokensave-control-room',
          order: 20,
          label: '项目中心',
          // 宿主按会话作用域注入 sessionId；slot 级 props（openView 等）合并进组件入参
          inject: (sessionId: string) => ({ sessionId }),
        },
        ControlRoom
      )
    )
  } catch (e) {
    console.warn('[tokensave] 客户端组件注册失败', e)
  }
}
