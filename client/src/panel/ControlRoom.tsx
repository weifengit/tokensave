/**
 * 工作台 tab（conversation.view，id 保持 tokensave-control-room）
 *
 * 单一职责：把某个**已登记项目**的 H 型工作台跑起来。
 *   - 打开哪个项目：来自「上次打开的项目」记忆（切会话/刷新后仍停在同一个工作台）；
 *   - 该项目用哪个会话：由 HDesk 自己解析（见 HDesk 的「主对话必须绑定本项目会话」）；
 *   - 没有可打开的项目时给一个引导，指向「项目中心」tab 去挑项目。
 *
 * 项目列表本身、项目介绍的编辑、活跃序号点都在「项目中心」tab（ProjectCenter），
 * 本组件不再渲染列表——两个 tab 的切换见 sessions.ts 的 switchToView。
 */
import React, { useEffect, useLayoutEffect, useState } from 'react'
import { injectProjectCenterStyles } from './styles'
import { loadProjects, recallOpenedProject, rememberOpenedProject, subscribeProjects, syncProjectsFromServer } from './store'
import type { ProjectRecord } from './store'
import {
  onRequestWorkbench, requestWorkbench, switchToView, setControlRoomScreen,
  PROJECT_CENTER_VIEW_ID, PROJECT_CENTER_LABEL,
} from './sessions'
import { HDesk } from './HDesk'

interface Props {
  sessionId?: string
}

export function ControlRoom({ sessionId }: Props) {
  useEffect(() => { injectProjectCenterStyles() }, [])

  // 上报“当前在工作台”（侧边栏按钮据此决定切换方向）；进入本 tab 也意味着
  // 用户要看工作台，因此清掉「强制列表」标记（由 requestWorkbench 完成）。
  useEffect(() => {
    setControlRoomScreen('desk')
    requestWorkbench()
  }, [])

  const [projects, setProjects] = useState<ProjectRecord[]>(() => loadProjects())
  // 跨来源同步：手机端（经 dsh-remote-mobile 网关，来源与桌面端不同）据服务端注册表
  // 水合出与桌面端一致的项目列表；服务端数据到达后广播 → 本组件重渲染。
  //   - 首次 pull 延后 600ms：切会话的首帧优先，不与服务端水合抢网络/主线程；
  //   - 内容未变则复用旧数组：否则每次 focus/广播都无条件 setState，带来大量无谓重渲染。
  useEffect(() => {
    const un = subscribeProjects(setProjects)
    const pull = () => {
      void syncProjectsFromServer().then(() => {
        const next = loadProjects()
        setProjects((prev) => (
          prev.length === next.length
          && prev.every((p, i) => p.id === next[i].id
            && p.updatedAt === next[i].updatedAt && p.name === next[i].name)
            ? prev
            : next
        ))
      })
    }
    const timer = window.setTimeout(pull, 600)
    window.addEventListener('focus', pull)
    return () => { window.clearTimeout(timer); un(); window.removeEventListener('focus', pull) }
  }, [])

  /**
   * 读该会话「上次打开的项目」记忆（惰性初始化与布局效果共用）。
   * 记忆指向已删除的项目时顺手清除并返回 null——引导页才是那种情况的正确落点。
   */
  const restoreOpenedId = (sid?: string | null): string | null => {
    if (!sid) return null
    const remembered = recallOpenedProject(sid)
    if (!remembered) return null
    if (!loadProjects().some((p) => p.id === remembered)) {
      rememberOpenedProject(sid, null)
      return null
    }
    return remembered
  }
  // 惰性初始化：切会话时 ControlRoom 重挂，**首帧**直接按记忆进 H 台。
  // 以前是 useState(null) + useEffect 恢复——effect 晚于首次绘制，首帧必然先闪一帧
  // 「还没有选择项目」引导页，第二帧才切到工作台（用户反馈的闪现）。
  const [openedId, setOpenedId] = useState<string | null>(() => restoreOpenedId(sessionId))

  // 同实例换 sessionId（不重挂）的兜底：layout effect 在绘制前跑，同样不闪引导页。
  // （重挂路径由上面的惰性初始化接住；两者都会在记忆缺失时清回 null——
  //   旧实现会沿用上一个会话的项目，HDesk 的会话归属校验会反过来抢切会话。）
  useLayoutEffect(() => {
    setOpenedId(restoreOpenedId(sessionId))
  }, [sessionId])
  // 「回到工作台」信号（自动绑定 / 侧边栏等入口）：恢复记忆里的项目，没有就取第一个，
  // 保证「再点一次能回去」始终成立。
  useEffect(() => onRequestWorkbench((targetSid) => {
    setProjects(loadProjects())
    if (targetSid && sessionId && targetSid !== sessionId) return
    const remembered = sessionId ? recallOpenedProject(sessionId) : null
    if (remembered && loadProjects().some((p) => p.id === remembered)) {
      setOpenedId(remembered)
      return
    }
    const first = loadProjects()[0]
    if (first) {
      setOpenedId(first.id)
      if (sessionId) rememberOpenedProject(sessionId, first.id)
    }
  }), [sessionId])

  const opened = openedId ? projects.find((p) => p.id === openedId) : undefined

  // —— H 型工作台 ——（仅在会话确实属于该项目时展示，HDesk 内部会校验并切换会话）
  if (opened && sessionId) {
    return (
      <HDesk
        project={opened}
        sessionId={sessionId}
        // 「← 项目中心」= 切到项目列表 tab（保留工作台记忆，可随时切回来）
        onBack={() => switchToView(PROJECT_CENTER_VIEW_ID, PROJECT_CENTER_LABEL)}
      />
    )
  }

  // —— 还没选项目：引导去项目中心 ——
  return (
    <div className="ts-cr ts-center">
      <div className="ts-center-emptywrap">
        <div className="ts-center-empty">
          <div className="ts-center-empty-title">🛠 工作台</div>
          <div className="ts-center-empty-sub">
            {sessionId
              ? '还没有选择项目。到「项目中心」挑一个项目，点它（或点「进入工作台」）即进入工作台。'
              : '当前会话上下文不可用，无法进入工作台。'}
          </div>
          {sessionId && (
            <button
              className="ts-btn ts-btn-primary"
              onClick={() => switchToView(PROJECT_CENTER_VIEW_ID, PROJECT_CENTER_LABEL)}
            >去项目中心选项目</button>
          )}
        </div>
      </div>
    </div>
  )
}
