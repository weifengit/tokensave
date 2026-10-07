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
import React from 'react'
import { openControlRoom } from './sessions'

export function ControlRoomEntry({ wide }: { wide?: boolean }) {
  const title = '项目中心：进入项目列表与工作台'
  return (
    <button
      type="button"
      className={`ts-side-entry${wide ? '' : ' rail'}`}
      title={title}
      aria-label="项目中心"
      onClick={() => {
        try {
          if (!openControlRoom()) {
            console.warn('[tokensave] 项目中心：没有可导航的会话，且没有已登记项目')
          }
        } catch (e) {
          console.warn('[tokensave] 项目中心入口导航失败', e)
        }
      }}
    >
      <span className="ts-side-icon" aria-hidden="true">🗂️</span>
      {wide && <span className="ts-side-label">项目中心</span>}
    </button>
  )
}
