/**
 * 主对话「阅读视图」——标题条上那三档开关（全部 / 我的 / 回复）
 *
 * 需求（2026-10-09）：主对话消息流按需换「看什么」的镜头：
 *   all   —— 现状。我发的气泡 + 模型回复，工具过程 / 上下文注入各自折叠一行；
 *   user  —— 只看我发的（隐藏模型回复、过程折叠、上下文注入、轮末异常提示）；
 *   agent —— 只看模型侧（过程折叠 + 回复 + 轮末异常提示），隐藏我的气泡与注入。
 *
 * 为什么不放在 MainChat 的 useState 里：
 *   同一份消息流会**同时**存在两个 MainChat 实例——工作台中下格那张卡，
 *   以及「最大化/铺满」浮层里的那张（见 HDesk 的 max 分支）。各持一份 state
 *   就会出现「浮层里切成『我的』、退出浮层又变回『全部』」。这里用模块级
 *   订阅式小仓库：谁点都写同一份真值，另一个实例立刻跟上，顺带持久化到
 *   localStorage（跨刷新、同源多标签共享，与 store.ts / pulse.ts 同口径）。
 */
import { useEffect, useState } from 'react'

export type ChatView = 'all' | 'user' | 'agent'

/** 三档的展示名与语义（MainChat 用它渲染 chip，并把实时计数拼进 title）。 */
export const CHAT_VIEWS: { id: ChatView; label: string; desc: string }[] = [
  { id: 'all', label: '全部', desc: '我发的 + 模型回复（工具过程、上下文注入仍折叠成一行）' },
  { id: 'user', label: '我的', desc: '只看我发的消息（隐藏模型回复与工具过程）' },
  { id: 'agent', label: '回复', desc: '只看模型回复（隐藏我发的消息；思考与工具仍折叠成一行）' },
]

/**
 * 统计前缀：沿用旧的 msg / user / agent 词汇（用户已经熟悉），但**只显示当前那一个**。
 * 例如切到「我的」就报 `user 2`——比一律报 `msg 137` 更贴「我现在看得见多少」。
 */
export const CHAT_VIEW_STAT: Record<ChatView, string> = { all: 'msg', user: 'user', agent: 'reply' }
/** 计数单位：全部按「会话流行数」算（与旧 msg 统计同口径），另两档按「条」。 */
export const CHAT_VIEW_UNIT: Record<ChatView, string> = { all: '行', user: '条', agent: '条' }

const KEY = 'tokensave:chat-view.v1'

function normalize(v: unknown): ChatView {
  return v === 'user' || v === 'agent' ? v : 'all'
}

function load(): ChatView {
  try {
    if (typeof window === 'undefined') return 'all'
    return normalize(JSON.parse(window.localStorage.getItem(KEY) ?? 'null'))
  } catch {
    // 隐私模式 / 坏数据：退回默认视图，不影响使用
    return 'all'
  }
}

let current: ChatView = load()
const listeners = new Set<() => void>()

export function getChatView(): ChatView {
  return current
}

/** 切换视图：写内存真值 → 通知所有实例 → 持久化（失败只影响持久性）。 */
export function setChatView(v: ChatView): void {
  const next = normalize(v)
  if (next === current) return
  current = next
  for (const fn of listeners) fn()
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 隐私模式：仅本次会话有效 */
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 订阅当前视图：返回 [值, 切换函数]（两个 MainChat 实例共用同一份真值）。 */
export function useChatView(): [ChatView, (v: ChatView) => void] {
  const [v, setV] = useState<ChatView>(getChatView)
  useEffect(() => subscribe(() => setV(getChatView())), [])
  return [v, setChatView]
}
