/**
 * 侧边栏「项目中心」入口（sidebar.footer.action 槽）
 *
 * 为什么放在侧边栏：用户要求「项目中心这个按钮请直接放在左侧边栏区域」。
 *
 * 「项目中心」现在是独立 tab（项目列表），本按钮固定把视图切到那个 tab：
 *   - 有当前会话 → 直接切 tab（数据层激活 + 点宿主 tab，见 sessions.openControlRoom）
 *   - 没有当前会话 → 先打开第一个项目的最新会话，再切到项目中心
 *
 * 关键约束（读宿主 ui-sidebar 的槽契约得出）：
 *   `sidebar.footer.action` 是 **root 作用域**的 list 槽 → 拿不到 sessionId
 *   （sessionId 由宿主动态注入 conversation.* 槽）；因此当前会话 id 由 Probe
 *   （挂在会话头部、始终挂载）经 `setCurrentSessionId` 写到 sessions.ts 的
 *   模块级变量，openControlRoom 读它。
 *
 * 视觉沿用侧边栏底部的紧凑样式：wide 时「图标 + 文字」，rail 时只有图标。
 */
import React from 'react'
import { openControlRoom } from './sessions'

export function ControlRoomEntry({ wide }: { wide?: boolean }) {
  const title = '项目中心：查看项目列表，点项目进入工作台'
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
      }}
    >
      <span className="ts-side-icon" aria-hidden="true">🗂️</span>
      {wide && <span className="ts-side-label">项目中心</span>}
    </button>
  )
}
