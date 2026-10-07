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
import React, { useEffect, useState } from 'react'
import { injectProjectCenterStyles } from './styles'
import { loadProjects, recallOpenedProject, rememberOpenedProject } from './store'
import type { ProjectRecord } from './store'
import {
  onRequestWorkbench, switchToView,
  PROJECT_CENTER_VIEW_ID, PROJECT_CENTER_LABEL,
} from './sessions'
import { HDesk } from './HDesk'

interface Props {
  sessionId?: string
}

export function ControlRoom({ sessionId }: Props) {
  useEffect(() => { injectProjectCenterStyles() }, [])

  const [projects, setProjects] = useState<ProjectRecord[]>(() => loadProjects())
  const [openedId, setOpenedId] = useState<string | null>(null)

  // 恢复上次打开的工作台（记忆只是 UI 偏好；会话归属由 HDesk 自己解析）。
  // ControlRoom 会在切 tab / 切会话时重挂，因此这里就是「进入工作台」的落点。
  useEffect(() => {
    if (!sessionId) return
    const remembered = recallOpenedProject(sessionId)
    if (!remembered) return
    if (!loadProjects().some((p) => p.id === remembered)) {
      rememberOpenedProject(sessionId, null)
      return
    }
    setOpenedId(remembered)
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
