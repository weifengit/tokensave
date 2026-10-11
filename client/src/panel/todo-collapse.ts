/**
 * 宿主「任务规划清单」面板的自动收起（conversation.input.dock 里的 todo 面板）。
 *
 * 用户反馈：任务清单出现在输入框上方后，一直停留在「任务 1 进行中 · 7 待处理」
 * 这种展开状态，即使全部跑通、模型已经 reply 也不关闭。
 *
 * 两件事要说清楚：
 *
 *  1. **计数是宿主数据**：面板里的「N 进行中 · M 待处理」来自会话的 `todo/write`
 *     事件投影（模型调 todo 工具时写入）。模型若不写最后一笔「全部完成」，
 *     计数就会停在旧值——这属于模型行为，插件不能凭空改写，只能如实展示。
 *  2. **面板收不收是界面行为**：面板只在 `todos.length === 0` 时才整体消失，
 *     否则展开态会一直挂在输入框上方。这一条我们可以接管：**当前会话这一轮
 *     跑完**（running → 非 running 且不在等确认）时，把展开的清单点一下表头收起。
 *
 * 实现是 DOM 级的轻推（点它自己的表头按钮），不碰宿主的 React 树：
 * 表头按钮自带 `aria-expanded`，展开时为 "true"，点一下即收起，幂等且可再展开。
 */
import { getCurrentSessionId } from './sessions'

/** 宿主 todo 面板（dsh-client-ui-conversation 的 TodoPanel）选择器 */
export const TODO_PANEL_SEL = '[data-testid="todo-panel"]'
/** 表头按钮：唯一带 aria-expanded 的元素，也是展开/收起的开关 */
export const TODO_HEADER_SEL = 'button[aria-expanded]'

/** 纯决策：这一拍要不要把任务清单收起 */
export function shouldCollapseTodoPanel(input: {
  /** 上一拍是否 running */
  wasRunning: boolean
  /** 这一拍是否 running */
  running: boolean
  /** 这一拍是否在等用户确认（等确认时清单仍有用，别收） */
  pending: boolean
  /** 是不是当前正在看的那个会话 */
  isCurrentSession: boolean
}): boolean {
  return input.wasRunning && !input.running && !input.pending && input.isCurrentSession
}

/**
 * DOM 动作：把展开的任务清单收起（点它的表头按钮）。
 * @param root - 查询根（默认 document；单测传假对象）
 * @returns 是否真的点了（面板不存在 / 本来就是收起的 → false）
 */
export function collapseTodoPanel(root: ParentNode = document): boolean {
  const btn = root.querySelector(`${TODO_PANEL_SEL} ${TODO_HEADER_SEL}`) as HTMLButtonElement | null
  if (!btn) return false
  if (btn.getAttribute('aria-expanded') !== 'true') return false
  btn.click()
  return true
}

/** 连发保护：两次收起之间至少隔这么久（同一次 transition 被多拍重复观察时不会来回点） */
const REENTRANT_GUARD_MS = 800
let lastCollapseAt = 0

/**
 * 排一次收起：延后一拍再动手，让这一轮**最后写入的 todo 投影**先落地
 * （模型若在收尾时补写了「全部完成」，计数先变对，然后才收起）。
 */
export function scheduleCollapseTodoPanel(delayMs = 600): void {
  if (typeof window === 'undefined') return
  window.setTimeout(() => {
    const now = Date.now()
    if (now - lastCollapseAt < REENTRANT_GUARD_MS) return
    if (collapseTodoPanel()) lastCollapseAt = now
  }, delayMs)
}

/**
 * 会话状态沿的入口：pulse.ts 在每拍重算时对每个会话调一次。
 * 只有「当前会话 + running→停下 + 不在等确认」才排一次收起。
 */
export function onSessionStopped(
  sessionId: string,
  wasRunning: boolean,
  running: boolean,
  pending: boolean,
): void {
  if (!shouldCollapseTodoPanel({
    wasRunning,
    running,
    pending,
    isCurrentSession: !!sessionId && sessionId === getCurrentSessionId(),
  })) return
  scheduleCollapseTodoPanel()
}

/**
 * 目检 / 排查钩子（浏览器 console 里用，不进 UI）：
 *   __tokensaveTodo.collapse() —— 立刻收起展开的任务清单（返回是否点了）
 */
;(globalThis as any).__tokensaveTodo = {
  collapse: () => collapseTodoPanel(),
  schedule: () => scheduleCollapseTodoPanel(0),
}
