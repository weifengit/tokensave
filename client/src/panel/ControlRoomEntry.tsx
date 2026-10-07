/**
 * 侧边栏「项目中心」入口（sidebar.footer.action 槽）
 *
 * 为什么放在侧边栏：用户要求「项目中心这个按钮请直接放在左侧边栏区域」。
 *
 * 关键约束（读宿主 ui-sidebar 的槽契约得出）：
 *   - `sidebar.footer.action` 是 **root 作用域**的 list 槽 → 拿不到 sessionId
 *     （sessionId 由宿主动态注入 conversation.* 槽）；
 *   - 因此当前会话 id 由 Probe（挂在会话头部、始终挂载）经
 *     `setCurrentSessionId` 写到 sessions.ts 的模块级变量，这里读它。
 *
 * 行为（见 openControlRoom 的三级降级）：
 *   - 当前会话属于某已登记项目 → 绑到该项目并激活工作台视图；
 *   - 当前会话不属于任何项目 → 仍激活本插件视图（落项目列表态）；
 *   - 没有当前会话 → 打开第一个项目的最新会话。
 *
 * 视觉沿用侧边栏底部的紧凑样式：wide 时「图标 + 文字」，rail 时只有图标。
 */
import React, { useEffect, useState } from 'react'
import { openControlRoom, getControlRoomScreen, onRequestProjectList, onRequestWorkbench } from './sessions'

export function ControlRoomEntry({ wide }: { wide?: boolean }) {
  // 标题随当前屏变化：在工作台时提示“回项目列表”，在列表时提示“回工作台”，
  // 让“再点一次能回去”这件事在 UI 上自解释。
  const [screen, setScreen] = useState<'list' | 'desk'>(() => getControlRoomScreen())
  useEffect(() => {
    const sync = () => setScreen(getControlRoomScreen())
    sync()
    const offList = onRequestProjectList(sync)
    const offDesk = onRequestWorkbench(sync)
    return () => { offList(); offDesk() }
  }, [])
  const toDesk = screen === 'list'
  const title = toDesk
    ? '项目中心：回到工作台（再点一次可在两者间切换）'
    : '项目中心：查看项目列表（再点一次可在两者间切换）'
  return (
    <button
      type="button"
      className={`ts-side-entry${wide ? '' : ' rail'}`}
      title={title}
      aria-label={title}
      onClick={() => {
        try {
          if (!openControlRoom()) {
            console.warn('[tokensave] 项目中心：没有可导航的会话，且没有已登记项目')
          }
        } catch (e) {
          console.warn('[tokensave] 项目中心入口导航失败', e)
        }
        // 切完立刻同步图标/文字（不等宿主回流）
        setScreen(getControlRoomScreen())
      }}
    >
      <span className="ts-side-icon" aria-hidden="true">{toDesk ? '🧭' : '🗂️'}</span>
      {wide && <span className="ts-side-label">{toDesk ? '回到工作台' : '项目中心'}</span>}
    </button>
  )
}
