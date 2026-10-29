/**
 * 工作台的 dockview 外壳（Step 13 · 最终形态：参考 info_report 的多区布局）。
 *
 * 骨架（三个 dockview 实例 + 标题行 + 状态栏）：
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 标题行： │ [图标] 项目名 · 已关闭 chips  │ 区域键 探索者 设置│
 *   ├──────────┬──────────────────────────────┬─────────────────┤
 *   │ 主侧栏   │ 编辑区（预览/主对话/探索者）  │ 辅助侧栏        │
 *   │ dockview ├──────────────────────────────┤ dockview        │
 *   │          │ 面板区（黑板/协作对话/收益）  │                 │
 *   ├──────────┴──────────────────────────────┴─────────────────┤
 *   │ 状态栏：当前面板 · 面板数 · 保存/恢复布局 · 会话切换         │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * 标题行位置可换（顶部 / 左侧 / 右侧，见 chrome-position.ts）：侧置时上图顶部那一行变成
 * 一条 44px 竖轨（图标 + 竖排项目名在上，区域键 / 探索者设置 / 设置齿轮在底部），网格从
 * 三行变两行（工作区 / 状态栏），把整行高度让给内容。位置落在 `.ts-dock[data-chrome]`，
 * 浮层落点也按位置重算 —— 齿轮在竖轨最底部，「按钮底 + 6」会把设置面板甩到屏幕外。
 *
 * 为什么编辑区与面板区**共用一个实例**（同 info_report）：面板区「向上扩充」
 * 调 maximizeGroup 时只盖住编辑区、两侧侧栏不受影响；两者之间的横向把手是
 * dockview 原生 sash，不用自己写。
 *
 * 跨实例拖拽（info_report 同款）：dockview 的拖拽载荷是页面级单例，三个实例
 * 其实互相"看得见"，只是默认只认自己那份 —— 在 onUnhandledDragOver 里
 * accept()，落点浮层就显示，onDidDrop 里再把面板从源实例搬过来。
 *
 * 面板 id 仍带项目前缀（`<projectId>:<kind>`，见 desk-panes.ts）。
 * 自动快照 `tokensave:desk-dock.v2:<id>`（用户保存的默认布局另一份
 * `tokensave:desk-saved.v2:<id>`，只有点「保存布局」才覆盖）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { installDockview } from '../vendor/dockview'
import { fetchExplorers, fetchProjectInfo } from './api'
import type { ExplorerRunInfo, TelemetrySession } from './api'
import { Blackboard } from './Blackboard'
import { TalkColumn } from './TalkColumn'
import { SavingsColumn } from './SavingsColumn'
import { MainChat } from './MainChat'
import { PreviewPanel, absoluteUrl } from './PreviewPanel'
import { ExplorerWindow } from './ExplorerWindow'
import { useDockNativeComposer } from './composer-dock'
import {
  latestProjectSession,
  useProjectSessions,
  openSession,
  startProjectSession,
  isExplorerSessionId,
  sessionBelongsToProject,
} from './sessions'
import { enterProjectWorkbench, stopSession } from './sessions'
import { useExplorerBadges } from './explorer-status'
import { ExplorerSettings } from './ExplorerSettings'
import { SessionPicker } from './SessionPicker'
import { loadProjects, rememberOpenedProject } from './store'
import { useProjectsActivity, useProjectLastActivity } from './activity'
import {
  SKINS, SKIN_GROUPS, readSkinId, chooseSkin, applySkin as applySkinVars, bootSkin, currentThemeMode,
} from './skins'
import { startThemeWatch } from './theme'
import { installSkinLayerCss } from './skin-layer'
import { getClientContext, subscribeSession, subscribeSessionMetrics } from '../session-subscribe'
import { KINDS, paneId, parsePaneId, paneTitle, paneIcon, type Kind } from './desk-panes'
import {
  CHROME_POSITIONS, CHROME_HINT, CHROME_LABEL, RAIL_W,
  effectiveChrome, popPlacement, readChromePosition, writeChromePosition,
  type ChromePosition,
} from './chrome-position'
import type { ProjectRecord } from './store'

const SNAPSHOT_KEY = (projectId: string) => `tokensave:desk-dock.v2:${projectId}`
const SAVED_KEY = (projectId: string) => `tokensave:desk-saved.v2:${projectId}`
/** 区域收起状态：**按项目分键**（以前是全局一个键，在 A 项目收起编辑区会把 B 项目
    也一起收起——用户反馈「其他项目里 DSH 主对话没有输入框」就是一例）。 */
const REGIONS_KEY = (projectId: string) => `tokensave:desk-regions.v1:${projectId}`
/* SKIN_KEY 已搬到 skins.ts（改名为 SKIN_KEY，值不变，兼容旧的 background 字符串） */
/* 布局锁已按用户要求整个删除（功能 + 状态栏显示）；遗留键在 STALE 里清掉。 */
/** 界面字体与字族（外观设置，全局一份，同皮肤）。 */
const FONT_KEY = 'tokensave:desk-font.v1'
const FONT_FAMILY_KEY = 'tokensave:desk-font-family.v1'
/**
 * 侧栏宽度：SIDE_MIN 是**最小可见宽度**，同时也是「拖到不能」的收起点；SIDE_MAX 是上限。
 *
 * 旧实现把显示宽度夹在 SIDE_MIN(180)、却等到 < COLLAPSE_W(56) 才收起：中间 124px
 * 指针在动而宽度纹丝不动 —— 用户反馈的「卡顿一下、然后一直卡着不动」就是这个死区；
 * 隐藏态起步还要先拉过 PULL_OUT_W(12) 才有反应，所以「拉出来要等一会儿才出现」。
 *
 * 新口径（用户要求：拖动 1:1 跟手 · 到最小即收起 · 拉一点点就出来）：
 *   · 显示宽度**连续跟随指针**，一路减到 SIDE_MIN 就直接收起（没有死区）；
 *   · 隐藏态往里动过 PULL_OUT_EPS 就**立刻**以 SIDE_MIN 现身，随后 1:1 跟手；
 *   · 收起与展开两个转折点都**重锚指针**，反向微动不会「拉一下又弹回」（老坑）。
 */
const SIDE_MIN = 180
const SIDE_MAX = 720
/**
 * 隐藏态：往「里」动这么多像素就展开。越小越灵敏 —— 留 3px 只为滤掉手抖。
 * 实测值：旧版要 12px（用户反馈「拉出来要等一会儿才出现」）。
 */
const PULL_OUT_EPS = 3
/**
 * 最小可见宽度以下再往内拖这么多 = 真的「拖到不能了」→ 收起。
 *
 * 为什么不是「一低于 SIDE_MIN 就收」：展开时以 SIDE_MIN 起步，若把门限就放在 SIDE_MIN，
 * 展开后手指反向抖 1px 就立刻又收起（info_report 注释里记过的「拉一下又弹回」）。
 * 8px 只是把两个转折点错开，体感上刚好是「到头了」的那一下停顿，不是旧版那种百来像素死区。
 */
const COLLAPSE_HYST = 8
const SIDE_W_KEY = 'tokensave:desk-side-w.v1'
/** 早期版本遗留的存储键：挂载时一次性清理，不留孤儿。 */
const STALE_KEYS = [
  'tokensave:desk-open.v1',
  'tokensave:desk-dock.v2',
  'tokensave:desk-dock.v1',
  // 布局锁已删（功能 + 状态栏显示）：旧全局键与按项目分键都清掉
  'tokensave:desk-dock-lock.v1',
  // 区域收起曾用全局键：污染会跨项目传染（收到资源的旧值一律清掉）
  'tokensave:desk-regions.v1',
]
const STALE_PREFIX = [
  'tokensave:desk-dock.v1:',
  'tokensave:desk-saved.v1:',
  'tokensave:desk-dock-lock.v1:',
]

/** 三个区域（与 info_report 的 REGION_KEY 同构）。 */
const REGIONS = ['left', 'center', 'right'] as const
type Region = (typeof REGIONS)[number]
const REGION_LABEL: Record<Region, string> = { left: '主侧栏', center: '编辑区/面板区', right: '辅助侧栏' }
const REGION_ICON: Record<Region, string> = { left: 'regionLeft', center: 'regionCenter', right: 'regionRight' }

/** 面板 kind 的默认归属区（只决定首次落点，不锁定位置）。 */
const KIND_REGION: Record<string, Region> = {
  // 用户要求：项目预览默认就在**编辑区**（不再放主侧栏）
  preview: 'center',
  chat: 'center',
  board: 'center',
  talk: 'center',
  save: 'center',
}

/** 线条图标（24 视窗 / currentColor / 1.6 描边，与 info_report 的 icons.js 同规）。 */
const ICONS: Record<string, string> = {
  /** 探索者窗口：与 DSH 主对话**必须区分开**（用户反馈两者图标一模一样）。
     画一个机器人头：与右上角「探索者设置」的图标同一套语言。 */
  explorers: '<rect x="4.5" y="7.5" width="15" height="11" rx="3"/><path d="M12 4.5v3"/><circle cx="12" cy="3.4" r="1.1" fill="currentColor" stroke="none"/><circle cx="9.2" cy="12.2" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.8" cy="12.2" r="1.2" fill="currentColor" stroke="none"/><path d="M9.5 15.2h5"/>',
  zone: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M3.5 14.5h17"/><path d="M9 4.5v15"/><path d="M15 4.5v15"/>',
  /** 停止（画出「停」）：协作对话标题行的「全部停止」。 */
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/><path d="M9.5 12h5"/>',
  book: '<path d="M3 5h6a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3H3z"/><path d="M21 5h-6a3 3 0 0 0-3 3v11a3 3 0 0 1 3-3h6z"/>',
  report: '<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/>',
  chat: '<path d="M4 5.5h16v11H9.5L4 20.5z"/><path d="M8 10h8"/><path d="M8 13.5h5"/>',
  comment: '<path d="M20 5.5H4v10h7l5 4v-4h4z"/><path d="M8 10h8"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  list: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M7 9.5h10"/><path d="M7 13.5h6"/>',
  palette: '<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="9.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none"/>',
  regionLeft: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.8 4.5v15"/>',
  regionCenter: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 12h17"/>',
  regionRight: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.2 4.5v15"/>',
  save: '<path d="M5 4.5h11l3.5 3.5v11a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5 4.5z"/><path d="M8 4.5v5h7v-5"/><rect x="8" y="13" width="8" height="6" rx="1"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4"/><path d="M4.5 4.5v5h5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.6-1.5"/>',
  more: '<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  /** 标题行项目切换按钮的小箭头。 */
  chevron: '<path d="M6 9.5l6 6 6-6"/>',
  /** 齿轮：右上角「设置」按钮（⋯ 与皮肤合并后的入口）。 */
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.08a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.08a1.7 1.7 0 0 0 1.56-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9.1a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9.1a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.08a1.7 1.7 0 0 0-1.52.86z"/>',
  /** 字号（字体区块用）。 */
  type: '<path d="M5 6.5V5h14v1.5"/><path d="M12 5v14"/><path d="M9 19h6"/>',
}

function iconSvg(name: string, size = 15): string {
  const body = ICONS[name] || ICONS.report
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}

/**
 * 区域显示/隐藏三键的图标：**状态只看图标内部那块填充**（用户指定：不要蓝色和外框）。
 * 显示 = 对应区域那格填色；隐藏 = 只有外框 + 分割线。
 */
function regionIconSvg(r: Region, on: boolean, size = 16): string {
  const frame = '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/>'
  const divider =
    r === 'left'
      ? '<path d="M9.4 4.5v15"/>'
      : r === 'right'
        ? '<path d="M14.6 4.5v15"/>'
        : '<path d="M3.5 12h17"/>'
  const box =
    r === 'left'
      ? 'x="5.1" y="6.1" width="3.3" height="11.8" rx="1"'
      : r === 'right'
        ? 'x="15.6" y="6.1" width="3.3" height="11.8" rx="1"'
        : 'x="5" y="6.1" width="14" height="11.8" rx="1"'
  const fill = on
    ? `<rect ${box} fill="currentColor" stroke="none" opacity="0.92"/>`
    : `<rect ${box} fill="none" stroke="none"/>`
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${fill}${frame}${divider}</svg>`
}

/** 相对时间（项目切换面板用，避免每行一串完整时间戳）。 */
function relAge(ms: number): string {
  if (!ms) return '—'
  const d = Date.now() - ms
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)} 天前`
  return new Date(ms).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

const DOCK_CSS_ID = 'tokensave-desk-dock-css'
/** 外壳 + 主题（透明 + 线条标签 + 落点高亮）。 */
const DOCK_CSS = `
/* 主题调色板（外壳/皮肤/弹层三组变量）统一在 client/src/panel/theme.ts 的 THEME_CSS 里，
   工作台、项目中心、浮动面板共用一份；这里只留外壳自己的规则。 */
/* 皮肤不画在 .ts-dock 上：它已由 skin-layer.ts 铺在整页（body，fixed 附着）。
   画在这里会与页面级渐变几何不一致 —— 台面内的渐变以自己的盒子重新起算，
   标签行与台面之间就会露出一道接缝（用户反映的「只有 tab 下面那块变了」）。 */
.ts-dock { position: absolute; inset: 0; display: grid; grid-template-rows: 42px minmax(0,1fr) auto; grid-template-columns: minmax(0,var(--ts-side-l,220px)) minmax(0,1fr) minmax(0,var(--ts-side-r,260px)); grid-template-areas: "title title title" "left center right" "status status status"; color: var(--ts-fg); font-size:var(--ts-fs, 12.5px); font-family:var(--ts-font, inherit); background: transparent; }
/* 皮肤格子里的「无皮肤」+ 分组标题 */
.ts-skin-none { flex: 1 1 100%; min-width: 0; }
.ts-skin-group { flex: 1 1 100%; display: flex; flex-direction: column; gap: 4px; margin-top: 2px; }
.ts-skin-glabel { font-size: calc(var(--ts-fs, 12.5px) * 0.8); color: var(--ts-fg-mute); letter-spacing: .04em; }
/* 皮肤列表：限高 + 内部滚动。22 套皮全展开有 695px 高，而设置面板一屏只有 ~415px，
   不限高的话下面「字体」块要被顶出面板，得滚很久才找得到。 */
.ts-skin-scroll { display: flex; flex-direction: column; gap: 6px; max-height: 196px; overflow-y: auto; padding: 2px 4px 2px 2px; scrollbar-width: thin; scrollbar-color: rgba(127,127,127,.4) transparent; }
.ts-skin-scroll::-webkit-scrollbar { width: 8px; }
.ts-skin-scroll::-webkit-scrollbar-thumb { background: rgba(127,127,127,.35); border-radius: 4px; }
.ts-skin-note { padding: 0 4px; line-height: 1.5; }
.ts-dock[data-hide-left] { --ts-side-l: 0px; }
.ts-dock[data-hide-right] { --ts-side-r: 0px; }
/* 编辑区/面板区（center）也能收起：列宽塌陷到 0 + 区域内隐藏（面板不销毁，展开即回）。 */
.ts-dock[data-hide-center] { grid-template-columns: minmax(0,var(--ts-side-l,220px)) 0px minmax(0,var(--ts-side-r,260px)); }
.ts-dock[data-hide-center] .ts-region[data-region="center"] { display: none; }
/* 一体化：标题行不画分割线（同 info_report，区域之间不靠线条分界）。 */
/* 标题行**脱离列宽约束**：以前它是 grid 的 title 区（跨三列），侧栏/中区一收起来列宽塌成 0，标题行的宽度也跟着崩，右边那组按钮就被挤到左边去了（用户反馈）。改成与大状态栏同款的绝对定位：横向铺满整个工作台，里面的 [标题 flex:1][按钮 flex:none] 才能永远把按钮顶到右上角。 */
.ts-titlebar { position: absolute; left: 0; right: 0; top: 0; height: 42px; z-index: 40; display: flex; align-items: center; gap: 8px; padding: 0 8px; overflow: hidden; }
.ts-title-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; overflow: hidden; }
/* 项目名左侧：**项目切换按钮**。用户反馈「只画个图标看不出是按钮」→ 改成有底有框的
   胶囊按钮（图标 + 小箭头），悬停/展开时高亮。 */
.ts-title-switch { display: inline-flex; align-items: center; gap: 4px; flex: none; border: 1px solid rgba(127,127,127,.32); border-radius: 8px; background: var(--ts-hover); color: var(--ts-fg); cursor: pointer; padding: 3px 6px 3px 7px; }
.ts-title-switch:hover { border-color: #4f8ef7; background: rgba(79,142,247,.16); color: #4f8ef7; }
.ts-title-switch[data-open] { border-color: #4f8ef7; background: rgba(79,142,247,.20); color: #4f8ef7; }
.ts-title-switch .ts-title-caret { display: inline-flex; opacity: .7; }
.ts-title-switch svg { display: block; }
.ts-title-proj { font-weight: 600; white-space: nowrap; flex: none; }
/* 「workbench」后缀与外框已按用户要求去掉：只留项目名本身。 */
.ts-title-right { display: flex; align-items: center; gap: 4px; flex: none; }
.ts-tg { position: relative; width: 28px; height: 24px; display: grid; place-items: center; border: 1px solid transparent; border-radius: 6px; background: 0 0; color: inherit; cursor: pointer; padding: 0; }
.ts-tg:hover { background: rgba(127,127,127,.16); border-color: rgba(127,127,127,.28); }
.ts-tg[data-on] { color: #4f8ef7; border-color: rgba(79,142,247,.45); background: rgba(79,142,247,.12); }
/* 区域显示/隐藏三键：**不用蓝色与外框**表达选中，只看图标内部那块填充色块。 */
.ts-tg--region[data-on] { color: inherit; border-color: transparent; background: 0 0; }
.ts-tg--region[data-on]:hover { background: rgba(127,127,127,.16); border-color: rgba(127,127,127,.28); }
/* 探索者设置：图标按钮 + 右上角一个小计数徽标 */
.ts-tg-badge { position: absolute; top: -2px; right: -3px; min-width: 12px; height: 12px; padding: 0 3px; border-radius: 999px; background: #4f8ef7; color: #0b0e14; font-size:calc(var(--ts-fs, 12.5px) * 0.68); font-weight: 700; line-height: 12px; text-align: center; }
.ts-tg-wrap { position: relative; display: inline-flex; }
.ts-tg-sep { width: 1px; height: 16px; background: rgba(127,127,127,.24); margin: 0 2px; }
.ts-closed-chip { display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgba(127,127,127,.28); border-radius: 999px; background: rgba(127,127,127,.1); color: inherit; font: inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.92); padding: 2px 8px; cursor: pointer; white-space: nowrap; flex: none; }
.ts-closed-chip:hover { border-color: #4f8ef7; }
/* ── 标题栏位置：顶部（默认）/ 左侧 / 右侧 ──────────────────────────
   为什么做这件事：顶部那整整一行（42px）拿掉后，省下的高度就是**一整行内容** ——
   用户要的就是这个。侧置时标题行收成一条 ${RAIL_W}px 竖轨，所以轨必须窄：
   轨宽一档，省下来的横向空间就还回去一档。
   位置落在 .ts-dock[data-chrome] 上（不是 <html>）：工作台只是插件里的一块，
   写到 <html> 会把宿主页面一起改了；偏好与浮层落点在 chrome-position.ts。
   窄屏（≤900px）两侧栏是覆盖式抽屉，竖轨无从放置 → 一律按顶部渲染。 */
.ts-dock { --ts-rail-w: ${RAIL_W}px; }
/* 侧置后顶部没有标题行：两行（工作区 / 状态栏），竖轨占一列 */
.ts-dock[data-chrome="left"],
.ts-dock[data-chrome="right"] { grid-template-rows: minmax(0,1fr) auto; }
.ts-dock[data-chrome="left"] { grid-template-columns: var(--ts-rail-w) minmax(0,var(--ts-side-l,220px)) minmax(0,1fr) minmax(0,var(--ts-side-r,260px)); grid-template-areas: "title left center right" "status status status status"; }
.ts-dock[data-chrome="right"] { grid-template-columns: minmax(0,var(--ts-side-l,220px)) minmax(0,1fr) minmax(0,var(--ts-side-r,260px)) var(--ts-rail-w); grid-template-areas: "left center right title" "status status status status"; }
/* 中区收起时列数跟着变（两条都比基础的 data-hide-center 更具体，否则它那套三列会赢） */
.ts-dock[data-chrome="left"][data-hide-center] { grid-template-columns: var(--ts-rail-w) minmax(0,var(--ts-side-l,220px)) 0px minmax(0,var(--ts-side-r,260px)); }
.ts-dock[data-chrome="right"][data-hide-center] { grid-template-columns: minmax(0,var(--ts-side-l,220px)) 0px minmax(0,var(--ts-side-r,260px)) var(--ts-rail-w); }
/* 竖轨本体：从「横条」改成「竖条」——图标与竖排项目名在上、区域键与设置贴底部。
   注意 position/left/right/top/height 全部复位：基础规则是「横向铺满 + 绝对定位」
   （那样是为了摆脱列宽约束），竖轨是网格里的一列，必须回到正常流。 */
.ts-dock[data-chrome="left"] .ts-titlebar,
.ts-dock[data-chrome="right"] .ts-titlebar {
  position: relative; left: auto; right: auto; top: auto; width: auto; height: auto;
  grid-area: title;
  flex-direction: column; align-items: center; justify-content: flex-start;
  gap: 8px; padding: 8px 0;
  /* 它真的是一条栏：极淡一层底 + 一道分隔线（不加圆角/投影，整体仍是一体，不是另一张卡片） */
  background: var(--ts-hover);
}
.ts-dock[data-chrome="left"] .ts-titlebar { border-right: 1px solid var(--ts-line); }
.ts-dock[data-chrome="right"] .ts-titlebar { border-left: 1px solid var(--ts-line); }
.ts-dock[data-chrome="left"] .ts-title-left,
.ts-dock[data-chrome="right"] .ts-title-left { flex-direction: column; align-items: center; gap: 8px; flex: 0 0 auto; overflow: visible; }
.ts-dock[data-chrome="left"] .ts-title-right,
.ts-dock[data-chrome="right"] .ts-title-right { flex-direction: column; align-items: center; gap: 4px; margin-top: auto; flex: 0 0 auto; }
/* 竖轨里分隔线要横过来 */
.ts-dock[data-chrome="left"] .ts-tg-sep,
.ts-dock[data-chrome="right"] .ts-tg-sep { width: 18px; height: 1px; margin: 3px 0; }
/* 项目名竖排（横向只要 15px）：44px 的轨里横排一定被截成「受…」，竖排是唯一不截断的写法 */
.ts-dock[data-chrome="left"] .ts-title-proj,
.ts-dock[data-chrome="right"] .ts-title-proj { writing-mode: vertical-rl; font-size: calc(var(--ts-fs, 12.5px) * 1.06); letter-spacing: .18em; line-height: 1; max-height: 34vh; overflow: hidden; text-overflow: ellipsis; }
/* 项目切换按钮只留图标：小箭头在 44px 里会把按钮撑出轨宽（被 overflow:hidden 裁掉） */
.ts-dock[data-chrome="left"] .ts-title-switch .ts-title-caret,
.ts-dock[data-chrome="right"] .ts-title-switch .ts-title-caret { display: none; }
/* 「已关闭」chips 每枚至少 60px 宽，44px 的轨里放不下 → 侧置时收起；
   要找回关掉的窗口走设置面板的「全部打开」。 */
.ts-dock[data-chrome="left"] .ts-closed-chip,
.ts-dock[data-chrome="right"] .ts-closed-chip,
.ts-dock[data-chrome="left"] .ts-title-left .ts-sb-sep,
.ts-dock[data-chrome="right"] .ts-title-left .ts-sb-sep { display: none; }
.ts-region { min-width: 0; min-height: 0; overflow: visible; position: relative; }
/* 内容裁切放在 host 上：区域本身要 visible，否则把手（贴在边界上）会被裁掉，
   实测 elementFromPoint 命中的是区域而不是把手 → 拖不动。 */
.ts-region-host { overflow: hidden; }
/* 区域之间**不画分割线**（用户要求整体一体化，同 info_report）：靠留白而非线条分界。 */
.ts-region[data-region="left"] { grid-area: left; }
.ts-region[data-region="right"] { grid-area: right; }
.ts-region[data-region="center"] { grid-area: center; }
/* 侧栏收起时，中区给边界让出 8px 命中带，保证「从边框拉出来」抓得到把手；
   否则中区盖在把手上面，elementFromPoint 命中的是中区（实测踩过）。 */
.ts-dock[data-hide-left] .ts-region[data-region="center"] { padding-left: 8px; }
.ts-dock[data-hide-right] .ts-region[data-region="center"] { padding-right: 8px; }
.ts-region-host { position: absolute; inset: 0; }
/* ── 侧栏宽度把手（照 info_report 的样式）────────────────────────
   命中区仍是 8px（好抓），但可见的只是一小段中性圆角短杠：平时完全透明，
   鼠标移到边界上才露出来、拖动时变长——不再是「一整条浅色块」（用户反馈很难看）。 */
/* z-index 必须**略高于** dockview 自己的 sash（实测 z-index:99，且横向 sash 恰好压在
   把手的垂直中点上）：否则鼠标停在蓝色短杠上时，elementFromPoint 命中的是 sash 而不是
   把手 —— 双击打不开、拖动也抓不住（实测：正中那一带 4px 被覆盖）。
   只高一点点（100/101）而不是拉满：浮层（.ts-pop 提到 110）还要压在把手之上。 */
.ts-resizer { position: absolute; top: 0; bottom: 0; width: 8px; z-index: 100; cursor: col-resize; touch-action: none; background: 0 0; }
.ts-resizer--left { right: 0; }
.ts-resizer--right { left: 0; }
.ts-resizer::after {
  content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 2px; height: 40px; border-radius: 2px; background: transparent;
  transition: background .12s, height .12s;
}
.ts-resizer:hover::after, body.ts-resizing .ts-resizer::after { background: rgba(127,127,127,.8); height: 62px; }
/* 收起态：原地留一条 4×26 的小短杠（灰；悬停变主题蓝）提示「从这里拉出来」，
   同时把悬停那条长杠收起来，避免两根叠在一起。可命中靠的是外移位置 + z-index。 */
.ts-dock[data-hide-left] .ts-region[data-region="left"] .ts-resizer::after,
.ts-dock[data-hide-right] .ts-region[data-region="right"] .ts-resizer::after { display: none; }
.ts-dock[data-hide-left] .ts-region[data-region="left"] .ts-resizer::before,
.ts-dock[data-hide-right] .ts-region[data-region="right"] .ts-resizer::before {
  content: ''; position: absolute; top: 50%; left: 50%; width: 4px; height: 26px;
  transform: translate(-50%, -50%); border-radius: 3px; background: rgba(127,127,127,.5);
  transition: background .12s;
}
.ts-dock[data-hide-left] .ts-region[data-region="left"] .ts-resizer:hover::before,
.ts-dock[data-hide-right] .ts-region[data-region="right"] .ts-resizer:hover::before { background: #4f8ef7; }
.ts-dock[data-hide-right] .ts-region[data-region="right"] { border-left: 0; }
body.ts-resizing { cursor: col-resize !important; user-select: none !important; }
/* 侧栏收起后把手仍留在原位（可从窄缝拉出来）：左区的把手贴右缘、右区的贴左缘 */
.ts-dock[data-hide-left] .ts-region[data-region="left"] .ts-resizer { right: -5px; z-index: 101; }
.ts-dock[data-hide-right] .ts-region[data-region="right"] .ts-resizer { left: -5px; z-index: 101; }
/* ── 右上角「设置」浮层：四块（显示/隐藏窗口 · 标题栏位置 · 皮肤 · 字体） ────── */
/* 宽度按内容定：比旧版窄一截（用户反馈太宽），且不再被 .ts-pop 的 min-width 撑开 */
.ts-pop.ts-set { min-width: 0; }
/* box-sizing:border-box：宽度含 padding/border，否则 238+内边距+描边会超出面板锚定算出的右边缘 */
.ts-set { padding: 8px 8px 6px; width: 238px; box-sizing: border-box; }
.ts-set-block { display: flex; flex-direction: column; gap: 4px; padding: 4px 2px 8px; }
.ts-set-block + .ts-set-block { border-top: 1px solid rgba(127,127,127,.2); margin-top: 2px; }

/* ── 项目切换浮层（点标题行左侧图标弹出） ─────────────────────────── */
.ts-projsw { max-height: 62vh; }
.ts-projsw-list { display: flex; flex-direction: column; gap: 2px; max-height: 46vh; overflow: auto; padding: 2px; }
.ts-projsw-row { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; border: 1px solid transparent; border-radius: 8px; background: 0 0; color: inherit; font: inherit; padding: 6px 8px; cursor: pointer; }
.ts-projsw-row:hover { background: rgba(127,127,127,.16); }
.ts-projsw-row[data-on] { border-color: rgba(79,142,247,.5); background: rgba(79,142,247,.12); }
.ts-projsw-top { display: flex; align-items: center; gap: 6px; }
.ts-projsw-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ts-projsw-cur { flex: none; margin-left: auto; color: #4f8ef7; font-size: calc(var(--ts-fs, 12.5px) * 0.8); }
.ts-projsw-meta { color: var(--ts-fg-mute); font-size: calc(var(--ts-fs, 12.5px) * 0.82); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 行首状态圆点：绿 = 有对话在跑，黄 = 有对话等你确认，灰 = 都闲着 */
.ts-projsw-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: rgba(127,127,127,.55); }
.ts-projsw-dot.is-run { background: #3fb950; box-shadow: 0 0 0 2px rgba(63,185,80,.20); }
.ts-projsw-dot.is-wait { background: #f5c451; box-shadow: 0 0 0 2px rgba(245,196,81,.20); }
/* 标签行：运行中 / 待确认 / 无进行中 + 更新时间 */
.ts-projsw-tags { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: calc(var(--ts-fs, 12.5px) * 0.8); }
.ts-projsw-tag { border-radius: 999px; padding: 1px 7px; border: 1px solid transparent; }
.ts-projsw-tag.run { color: #7ee787; border-color: rgba(63,185,80,.45); background: rgba(63,185,80,.14); }
.ts-projsw-tag.wait { color: #f5c451; border-color: rgba(245,196,81,.45); background: rgba(245,196,81,.14); }
.ts-projsw-tag.idle { color: var(--ts-fg-mute); border-color: rgba(127,127,127,.28); }
.ts-projsw-age { margin-left: auto; color: var(--ts-fg-mute); }
/* 有对话在跑的项目：整行左边加一条绿竖线，扫一眼就能分辨（用户要求） */
.ts-projsw-row[data-busy] { box-shadow: inset 2px 0 0 0 #3fb950; }
.ts-set-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px 2px; }
.ts-set-title { font-size:calc(var(--ts-fs, 12.5px) * 0.88); font-weight: 600; color: var(--ts-fg-dim); letter-spacing: .02em; }
.ts-set-hint { font-size:calc(var(--ts-fs, 12.5px) * 0.84); color: var(--ts-fg-mute); }
.ts-set-grid { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 4px; }
.ts-set-row { display: flex; align-items: center; gap: 8px; padding: 3px 4px; }
.ts-set-k { flex: none; width: 62px; color: var(--ts-fg-dim); font-size:calc(var(--ts-fs, 12.5px) * 0.88); }
.ts-set-seg { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.ts-set-opt { border: 1px solid rgba(127,127,127,.3); border-radius: 6px; background: rgba(127,127,127,.08); color: inherit; font: inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.88); padding: 2px 9px; cursor: pointer; }
.ts-set-opt:hover { border-color: rgba(127,127,127,.55); }
.ts-set-opt[data-on] { color: #4f8ef7; border-color: rgba(79,142,247,.5); background: rgba(79,142,247,.15); }
.ts-pop-all { border: 1px solid rgba(127,127,127,.3); border-radius: 6px; background: rgba(127,127,127,.1); color: inherit; font: inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.92); padding: 2px 8px; cursor: pointer; }
.ts-pop-all:hover { border-color: #4f8ef7; }
/* 状态栏里的会话控件：与其它状态栏按钮同款字体/间距；图标内联对齐 */
.ts-sb-btn .ts-sess-ico, .ts-sess-btn .ts-sess-ico, .ts-sess-new .ts-sess-ico { display: inline-flex; align-items: center; margin-right: 5px; vertical-align: middle; }
.ts-sb-btn .ts-sess-ico svg, .ts-sess-new .ts-sess-ico svg { display: block; }
/* 新建会话按钮：与状态栏按钮同样式（不再用蓝色主按钮，避免在状态栏里过于抢眼） */
.ts-sess-new { color: inherit; }
/* 状态栏实时提示：小圆点表示「进行中」，完成后变灰 */
.ts-sb-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; background: rgba(127,127,127,.6); flex: none; }
.ts-sb-dot[data-on] { background: #4f8ef7; box-shadow: 0 0 0 2px rgba(79,142,247,.22); animation: ts-sb-pulse 1.2s ease-in-out infinite alternate; }
@keyframes ts-sb-pulse { from { opacity: .45 } to { opacity: 1 } }
.ts-sb-item[data-done] { color: #3fb950; }
/* 状态栏里的会话控件与布局按钮：紧凑排布 */
/* 实时提示最多占状态栏一半（用户要求）：剩下的一半留给右侧会话/布局控件。 */
.ts-statusbar .ts-sb-grow { flex: 0 1 50%; min-width: 0; }
/* 一体化：状态栏不画上边线；左侧实时提示与右侧会话控件之间留出空白（用户反馈贴太近）。 */
.ts-statusbar { grid-area: status; display: flex; align-items: center; gap: 10px; padding: 0 10px; font-size:calc(var(--ts-fs, 12.5px) * 0.92); color: var(--ts-fg-dim); overflow: hidden;
  /* **真实占一行**（同 info_report 的 grid-template-rows: ... auto）：状态栏就是网格第三行，
     不是浮在内容之上的覆盖层 —— 旧版把这行塔成 0px 再把它 absolute 贴底，看着是悬浮了，
     但三个区域（主侧栏 / 编辑区面板区 / 辅助侧栏）的「脚跟」会被它盖住（用户反馈）。
     悬浮**只体现在视觉**：半透明底 + 上边线 + 向上投的阴影 + 模糊。
     高度仍写进 --ts-sb-h，但只给窄屏抽屉与遮罩让位用（见 @media 段）。 */
  min-height: 28px;
  background: var(--ts-sb-bg);
  border-top: 1px solid var(--ts-line);
  box-shadow: 0 -6px 18px rgba(0,0,0,.18);
  backdrop-filter: blur(10px) saturate(1.1);
}
.ts-statusbar .ts-sb-grow { padding-right: 26px; }
.ts-sb-group { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; }
.ts-sb-group--right { margin-left: auto; }
.ts-sb-item { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ts-sb-sep { width: 1px; height: 12px; background: rgba(127,127,127,.24); flex: none; }
.ts-sb-btn { display: inline-flex; align-items: center; gap: 5px; border: 1px solid transparent; border-radius: 6px; background: 0 0; color: inherit; font: inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.92); padding: 2px 7px; cursor: pointer; white-space: nowrap; }
.ts-sb-btn:hover { background: rgba(127,127,127,.16); border-color: rgba(127,127,127,.28); }
.ts-sb-btn[data-dirty] { color: #f5c451; border-color: rgba(245,158,11,.6); background: rgba(245,158,11,.14); }
.ts-dock-pane { height: 100%; min-height: 0; display: flex; flex-direction: column; }
.ts-dock-pane > * { flex: 1; min-height: 0; }
.ts-dock-chatcell { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
/* 聊天格底部曾经有一条渐隐遮罩（.ts-dock-fade）。已删除：消息流自己用
   padding-bottom 为停靠输入条留了空间，永远不会滑到输入条底下，所以那条该遮罩
   从未遮住任何东西，只在聊天区下方糊出一块渐变深色，破坏页面背景的一体性
   （用户反馈）。 */
.ts-dock-tabico { display: inline-flex; align-items: center; }
/* 拖动窗口期间：iframe 不吃指针事件。否则鼠标一进 iframe，父文档就再也收不到
   dragover/drop，dockview 的落点浮层在 iframe 上方不显示（预览面板是全插件唯一的 iframe，
   落点浮层恰好总在它上方）；松手后的实际搬运自 dragend 兜底，不受影响。 */
body.ts-dock-dragging iframe { pointer-events: none !important; }
.ts-dock-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ts-fg-mute); font-size:calc(var(--ts-fs, 12.5px) * 1.04); }
.ts-dock-watermark { color: var(--ts-fg-mute); font-size:calc(var(--ts-fs, 12.5px) * 0.96); }
.ts-pop { position: fixed; z-index: 110; right: auto; min-width: 268px; max-height: 72vh; overflow: auto; border: 1px solid var(--ts-pop-line); border-radius: 10px; background: var(--ts-pop-bg); color: var(--ts-pop-fg); backdrop-filter: blur(8px); box-shadow: var(--ts-pop-shadow); padding: 6px; }
/* 旧版 ⋯ / 皮肤两个浮层已并入 .ts-set（.ts-pop-* 的通用部分保留） */
.ts-pop-item { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 7px; }
.ts-pop-item:hover { background: rgba(127,127,127,.12); }
.ts-pop-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ts-pop-where { display: flex; align-items: center; gap: 2px; flex: none; }
.ts-pop-region { width: 26px; height: 22px; display: grid; place-items: center; border: 1px solid transparent; border-radius: 5px; background: 0 0; color: inherit; cursor: pointer; padding: 0; }
.ts-pop-region:hover { background: rgba(127,127,127,.18); border-color: rgba(127,127,127,.3); }
.ts-pop-region[data-on] { color: #4f8ef7; border-color: rgba(79,142,247,.5); background: rgba(79,142,247,.15); }
.ts-pop-sep { height: 1px; background: rgba(127,127,127,.22); margin: 6px 4px; }
/* 设置面板里的窗口名：可点 = 跳到那个窗口（窄屏下会最大化） */
.ts-pop-name--jump { border: 0; background: 0 0; color: inherit; font: inherit; padding: 0; cursor: pointer; text-align: left; }
.ts-pop-name--jump:hover { color: #4f8ef7; text-decoration: underline; }
.ts-pop-btn { display: flex; width: 100%; align-items: center; gap: 6px; border: 0; border-radius: 7px; background: 0 0; color: inherit; font: inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.96); padding: 6px; cursor: pointer; text-align: left; }
.ts-pop-btn:hover { background: rgba(127,127,127,.14); }
/* 皮肤格子（现在是设置面板里的一个区块） */
.ts-skin-cell { flex: 1 1 46%; min-width: 96px; height: 40px; border: 1px solid rgba(127,127,127,.32); border-radius: 7px; background: rgba(127,127,127,.08); color: var(--ts-fg); font: inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.92); cursor: pointer; }
.ts-skin-cell[data-on] { border-color: #4f8ef7; box-shadow: inset 0 0 0 1px rgba(79,142,247,.5); }
.dv-intel { background: transparent; }
.dv-intel .dv-dockview, .dv-intel .dv-groupview { background: transparent; border-radius: 0; }
.dv-intel .dv-tabs-and-actions-container { background: transparent !important; height: 33px; font-size:var(--ts-fs, 12.5px); }
.dv-intel .dv-tab { background: transparent !important; border-radius: 0 !important; opacity: .5; transition: opacity .12s; }
/* 激活的标签**不画底色**（用户反馈「标题行区域还有背景色」）：只把图标提亮。 */
.dv-intel .dv-tab.dv-active-tab { background: transparent !important; color: var(--ts-fg) !important; opacity: 1; }
.dv-intel .dv-tab:hover { opacity: .85; }
/* 探索者窗口的状态角标（用户要求：窗口一多，谁在跑/谁被中断/谁刚回消息要一眼看见）
   画在**标签图标右上角**：蓝 = 正在跑，红 = 本轮异常结束，绿 = 有新的汇报。 */
.dv-intel .dv-tab { position: relative; }
.dv-intel .dv-tab[data-tone]::after {
  content: '';
  position: absolute; top: 3px; right: 3px;
  width: 7px; height: 7px; border-radius: 50%;
}
.dv-intel .dv-tab[data-tone="run"]::after { background: #4f8ef7; box-shadow: 0 0 0 2px rgba(79,142,247,.22); animation: ts-sb-pulse 1.2s ease-in-out infinite alternate; }
.dv-intel .dv-tab[data-tone="notice"]::after { background: #f85149; box-shadow: 0 0 0 2px rgba(248,81,73,.22); }
.dv-intel .dv-tab[data-tone="new"]::after {
  content: attr(data-badge);
  width: auto; min-width: 13px; height: 13px; padding: 0 3px; border-radius: 7px;
  display: grid; place-items: center;
  background: #3fb950; color: #04140a;
  font-size: calc(var(--ts-fs, 12.5px) * 0.72); font-weight: 700; line-height: 1;
}
/* 协作对话标题行里的「全部停止」与结果提示 */
.ts-talk-note { font-size: calc(var(--ts-fs, 12.5px) * 0.86); color: #7ee787; white-space: nowrap; }

.dv-intel .dv-separator, .dv-intel .dv-sash { border-color: transparent !important; }
.dv-intel .dv-sash.dv-active-sash { background: #4f8ef7 !important; }
.dv-intel .dv-floating { box-shadow: 0 18px 48px rgba(0,0,0,.5); border: 1px solid var(--ts-line); }
/* 窗口标签的右键菜单。
   为什么必须自己上样式：为了跳出面板链路的 overflow:hidden（否则菜单在区域边缘被裁掉），
   我们把它搬到了 document.body —— 于是 dockview 自己的 --dv-* 变量不再继承，
   菜单背景变透明、字体回退到 16px（用户反馈「看不清 / 字体太大」）。
   这里按搬出来后的形态把样式写死（等于把 info_report 的菜单外观固定下来）。 */
.dv-context-menu, .dv-context-menu-container { z-index: 120 !important; }
.dv-context-menu[data-ts-hoisted="1"] {
  min-width: 172px; padding: 5px; border-radius: 10px;
  background: var(--ts-pop-bg); color: var(--ts-pop-fg);
  border: 1px solid var(--ts-pop-line);
  box-shadow: var(--ts-pop-shadow); backdrop-filter: blur(8px);
  font-size: calc(var(--ts-fs, 12.5px) * 0.96);
  font-family: var(--ts-font, inherit);
}
.dv-context-menu[data-ts-hoisted="1"] .dv-context-menu-item {
  height: 26px; padding: 0 9px; border-radius: 6px; margin: 0 1px;
  font-size: inherit; cursor: pointer;
}
.dv-context-menu[data-ts-hoisted="1"] .dv-context-menu-item:hover { background: rgba(127,127,127,.16); }
.dv-context-menu[data-ts-hoisted="1"] .dv-context-menu-separator { background: rgba(127,127,127,.24); margin: 4px 5px; }
/* 菜单项要有明确的可点反馈（点击无反应多半是被上层挡住）。 */
.dv-context-menu .dv-context-menu-item { cursor: pointer; }
.dv-intel {
  --dv-drag-over-background-color: rgba(79,142,247,.22);
  --dv-drag-over-border-color: #4f8ef7;
}
.dv-intel .dv-drop-target-anchor {
  background: var(--dv-drag-over-background-color);
  border: 1px solid var(--dv-drag-over-border-color) !important;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px rgba(79,142,247,.35);
}
.dv-intel .dv-sash { cursor: col-resize; }
.dv-intel .dv-sash:hover { background: rgba(79,142,247,.5) !important; }
.dv-intel .dv-tab { cursor: grab; }
.dv-intel .dv-tab:active { cursor: grabbing; }
/* ── 移动端（窄视口）：三栏 → 单栏 + 抽屉 ─────────────────────
   问题（用户反馈「手机端布局一片混乱且无法调整」）：原来三栏是
   原来三栏是 minmax(0,220px) minmax(0,1fr) minmax(0,260px)，而 SIDE_MIN=180、SIDE_MAX=720，
   在 393px 宽的手机上被压成 196/0/196 —— 中间「DSH 主对话」宽度为 0，看不见也点不到；
   8px 的拖拽把手在触屏上也基本拖不动。
   适配：中间永远整宽 + 两侧栏变成**覆盖式抽屉**（由区域三键开关，同时只开一个），
   把手隐藏（改用三键开关），标题行/状态栏 /标签页尺寸按触屏放大。
   断点 900px 与远程插件的 mobile presets 保持一致。 */
@media (max-width: 900px) {
  .ts-dock { grid-template-columns: 0 minmax(0,1fr) 0 !important; grid-template-rows: 46px minmax(0,1fr) auto; }
  .ts-dock .ts-region[data-region="left"],
  .ts-dock .ts-region[data-region="right"] {
    display: none; position: absolute; top: 46px; bottom: var(--ts-sb-h, 28px); width: min(86vw, 380px); z-index: 70;
    background: var(--ts-surface-solid); box-shadow: 0 14px 44px rgba(0,0,0,.6); border: 0;
  }
  .ts-dock[data-ts-drawer="left"] .ts-region[data-region="left"] { display: block; left: 0; }
  .ts-dock[data-ts-drawer="right"] .ts-region[data-region="right"] { display: block; right: 0; }
  /* 抽屉展开时的遮罩：点一下收起（触屏没有「悬停」，得给个明确出路） */
  .ts-drawer-mask { position: absolute; left: 0; right: 0; top: 46px; bottom: var(--ts-sb-h, 28px); z-index: 65; background: rgba(0,0,0,.45); }
  /* 触屏上拖 8px 把手不现实 → 隐藏，改用三键开关区域 */
  .ts-dock .ts-resizer { display: none !important; }
  /* 标题行：字号收一档、按钮放大到能点中（≥ 32px） */
  .ts-titlebar { padding: 0 6px; gap: 6px; height: 46px; }
  .ts-title-proj { font-size: calc(var(--ts-fs, 12.5px) * 1.12); }
  .ts-title-switch { padding: 5px 7px; }
  .ts-tg { width: 34px; height: 32px; }
  .ts-tg-badge { top: 0; right: 0; }
  .ts-title-left { gap: 6px; }
  .ts-closed-chip { padding: 4px 10px; }
  /* 状态栏：换行成两行（提示一行、控件一行），不再把右边按钮挤掉 */
  .ts-statusbar { flex-wrap: wrap; padding: 4px 8px 6px; gap: 6px; }
  .ts-statusbar .ts-sb-grow { flex: 1 1 100%; padding-right: 0; }
  .ts-statusbar .ts-sb-group--right { margin-left: 0; flex: 1 1 100%; overflow-x: auto; }
  /* 窗口标签、面板内容：按触屏放大一点 */
  .dv-intel .dv-tabs-and-actions-container { height: 38px; }
  .dv-intel .dv-tab { min-width: 40px; }
  /* 浮层：贴边、不超出屏宽 */
  .ts-pop { min-width: 0 !important; width: min(92vw, 340px) !important; max-height: 68vh; }
  .ts-pop.ts-set { width: min(92vw, 340px) !important; }
  .ts-expset-pop { min-width: 0; width: calc(100vw - 20px); max-width: calc(100vw - 20px); }
}
`

function installDockCss(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(DOCK_CSS_ID)) return
  const style = document.createElement('style')
  style.id = DOCK_CSS_ID
  style.textContent = DOCK_CSS
  document.head.appendChild(style)
}


function readHiddenRegions(projectId: string): Region[] {
  try {
    const raw = window.localStorage.getItem(REGIONS_KEY(projectId))
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x: unknown): x is Region => (REGIONS as readonly string[]).includes(String(x)))
  } catch {
    return []
  }
}


/* readSkin/SKIN_KEY 已搬到 skins.ts（工作台与项目中心共用同一套皮肤目录） */
/** 界面字号档位（真的改字号，不是只看画）。 */
const FONT_LEVELS = [
  { id: 's', label: '小', size: 11.5 },
  { id: 'm', label: '标准', size: 12.5 },
  { id: 'l', label: '大', size: 14 },
  { id: 'xl', label: '特大', size: 15.5 },
] as const
type FontId = (typeof FONT_LEVELS)[number]['id']
/** 字族：默认（跟宿主）/ 黑体（无衬线）/ 等宽。 */
const FONT_FAMILIES = [
  { id: 'default', label: '默认', css: '' },
  { id: 'sans', label: '黑体', css: '-apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif' },
  { id: 'mono', label: '等宽', css: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", monospace' },
] as const
type FontFamilyId = (typeof FONT_FAMILIES)[number]['id']

/**
 * 用户主动关掉的窗口 id（按项目分键）。关掉的窗口在该项目里就是关着，不再自己弹回来；
 * 重新打开走标题行的「＋ 面板名」chip / 设置面板的「全部打开」（那时会从这份集合里删掉）。
 */
const CLOSED_KEY = (projectId: string) => `tokensave:desk-closed.v1:${projectId}`
function readClosed(projectId: string): string[] {
  try {
    const raw = window.localStorage.getItem(CLOSED_KEY(projectId))
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed.filter((x: unknown): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function writeClosed(projectId: string, ids: Iterable<string>): void {
  try {
    window.localStorage.setItem(CLOSED_KEY(projectId), JSON.stringify([...ids]))
  } catch {
    /* 隐私模式：仅本次会话有效 */
  }
}
function readFont(): FontId {
  try {
    const raw = window.localStorage.getItem(FONT_KEY)
    return (FONT_LEVELS.find((f) => f.id === raw)?.id ?? 'm') as FontId
  } catch {
    return 'm'
  }
}
function readFontFamily(): FontFamilyId {
  try {
    const raw = window.localStorage.getItem(FONT_FAMILY_KEY)
    return (FONT_FAMILIES.find((f) => f.id === raw)?.id ?? 'default') as FontFamilyId
  } catch {
    return 'default'
  }
}

/**
 * 字号/字族写到 `:root`：插件所有视图（项目中心 + 工作台）共用一套变量，
 * 各条 CSS 用 `calc(var(--ts-fs, 12.5px) * 比例)` 取尺寸。
 * 写 `:root` 而不是写 .ts-dock：项目中心不在 .ts-dock 里，也得跟着变。
 */
function applyFont(font: FontId, family: FontFamilyId): void {
  if (typeof document === 'undefined') return
  const size = FONT_LEVELS.find((f) => f.id === font)?.size ?? 12.5
  const fam = FONT_FAMILIES.find((f) => f.id === family)?.css ?? ''
  const root = document.documentElement.style
  root.setProperty('--ts-fs', `${size}px`)
  if (fam) root.setProperty('--ts-font', fam)
  else root.removeProperty('--ts-font')
}

/** 插件一加载就把上次的字体设上去：项目中心里也立即生效（不只在工作台）。 */
/** 插件一加载就把上次的字体设上去：项目中心里也立即生效（不只在工作台）。 */
applyFont(readFont(), readFontFamily())

/** 皮肤同理：写到 :root 变量，工作台与项目中心同时生效（换皮肤不需要重挂组件）。 */
bootSkin()

/** 皮肤覆盖层样式（让皮肤铺满整页，四个 tab 一起变）：全局一份，装一次即可。 */
installSkinLayerCss()

/**
 * 主题：宿主切深/浅色时把 <html data-ts-theme> 更新掉（浅色下外壳要换成浅底深字，
 * 不然主对话里的文字会在白底上看不见）。插件加载就挂上，项目中心也吃这套变量。
 */
startThemeWatch(() => {
  // 宿主主题变了 → 皮肤可能整套切换（深浅适配），重解析一次并通知面板同步状态
  applySkinVars()
  window.dispatchEvent(new CustomEvent('ts-theme-changed'))
})

/** 一份「完整布局」快照：三个区的面板排布 + 哪些区收起 + 两侧栏宽度。 */
interface LayoutSnapshot {
  regions: Record<string, any>
  hidden: Region[]
  /** 旧快照没有宽度：null = 不动当前值 */
  sideW: { left: number; right: number } | null
}

/**
 * 识别两种快照形状：新格式 `{regions,hidden,sideW}` 与旧格式（裸的 `{left,center,right}`）。
 * 认不出返回 null。
 */
function normalizeSnapshot(raw: any): LayoutSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  if (raw.regions && typeof raw.regions === 'object') {
    const hidden = Array.isArray(raw.hidden)
      ? raw.hidden.filter((x: unknown): x is Region => (REGIONS as readonly string[]).includes(String(x)))
      : []
    const w = raw.sideW
    return {
      regions: raw.regions,
      hidden,
      sideW: w && typeof w === 'object'
        ? { left: Number(w.left) || 220, right: Number(w.right) || 260 }
        : null,
    }
  }
  return { regions: raw, hidden: [], sideW: null }
}

function explorerLabel(s: TelemetrySession): string {
  return s.title?.startsWith('tokensave-') ? s.title.slice('tokensave-'.length) : s.title || s.id
}

/** 面板 kind → 展示名（不含项目前缀，菜单/chips 用）。 */
function kindLabel(id: string): string {
  const kind = parsePaneId(id)?.kind ?? id
  if (kind.startsWith('exp:')) return '探索者'
  const titles: Record<string, string> = {
    preview: '项目预览',
    board: '共享黑板',
    chat: 'DSH 主对话',
    talk: '协作对话',
    save: '协作收益',
  }
  return titles[kind] || paneTitle(id)
}

interface ProjectData {
  explorers: TelemetrySession[]
  /** 当前轮的归属信息（无轮次登记时为 null / 缺省） */
  run?: ExplorerRunInfo | null
  devUrl?: string
  devRunning?: boolean
}

/**
 * 空探索者数组：当前会话不是本轮发起者时用它代替真实列表。
 * 用模块级常量而不是 `[]` 字面量 —— 保持引用稳定，依赖数组不会每帧变化。
 */
const NO_EXPLORERS: TelemetrySession[] = []

export interface DeskDockProps {
  project: ProjectRecord
  sessionId?: string
  onBack?: () => void
}

export function DeskDock({ project, sessionId, onBack }: DeskDockProps): React.ReactElement {
  const leftHostRef = useRef<HTMLDivElement>(null)
  const centerHostRef = useRef<HTMLDivElement>(null)
  const rightHostRef = useRef<HTMLDivElement>(null)
  const chatCellRef = useRef<HTMLDivElement>(null)
  const dockRootRef = useRef<HTMLDivElement>(null)
  /** 正在拖动的面板 id（dockview 只在 onWillDragPanel 里告诉我们）；dragend 兜底用。 */
  const dragPanelRef = useRef('')
  /** 本项目「无会话时自动开一条」只做一次，失败也不再重试（防循环）。 */
  const autoSessionRef = useRef(false)
  const apiRef = useRef<Record<Region, any> | null>(null)
  const containersRef = useRef<Record<string, HTMLElement>>({})
  /**
   * 用户**主动关掉**的窗口（右键菜单/三键的「关闭」）。
   * 持久化：否则一重载（或 reconcile 跑一次）就“还回来”，而且落在默认区、不是原来那块
   * （用户反馈「关闭了之后页面刷新一下又显示出来，位置还不对」）。
   */
  const closedRef = useRef<Set<string>>(new Set(readClosed(project.id)))
  const suppressDirtyRef = useRef(false)
  const resetToBuiltinRef = useRef<null | (() => void)>(null)
  const paneOptsRef = useRef<(id: string, position?: any) => any>(() => null)
  const [, bump] = useState(0)
  const [data, setData] = useState<ProjectData>({ explorers: [] })
  const [font, setFont] = useState<FontId>(readFont)
  const [fontFamily, setFontFamily] = useState<FontFamilyId>(readFontFamily)
  const [liveIds, setLiveIds] = useState<string[]>([])
  /** 每条探索者「上次被看到」的时间：状态角标据此判断有没有新汇报。 */
  const seenRef = useRef<Record<string, number>>({})
  /** 主对话轮次结束时的自动停止：轮次指纹（最后一条 assistant 的时间）+ 探索者列表镜像。 */
  const autoStopTurnRef = useRef(0)
  const explorersRef = useRef<readonly { id: string; state?: string }[]>([])
  const stopAllExplorersRef = useRef<(() => Promise<void>) | null>(null)
  /** 调试/核对用：角标快照（window.__tsDeskDock.badges()）。 */
  const badgesRef = useRef<Record<string, unknown>>({})
  /** 宿主主题切换（皮肤可能整套换）→ 同步面板里的当前模式与当前皮肤。 */
  useEffect(() => {
    const on = () => {
      setSkinMode(currentThemeMode())
      setSkin(readSkinId())
    }
    window.addEventListener('ts-theme-changed', on)
    return () => window.removeEventListener('ts-theme-changed', on)
  }, [])

  /** 挂载 effect（右键菜单）里要用最新的 closePanel。 */
  const closePanelRef = useRef<((id: string) => void) | null>(null)
  /** 工作台正在拆除（卸载/恢复布局）：布局脏标记与关闭记账都不要动。 */
  const teardownRef = useRef(false)
  /** 标签重建时也要能立刻补画角标（挂载 effect 里用）。 */
  const paintBadgesRef = useRef<(() => void) | null>(null)
  /** 「全部停止探索者」的运行/结果提示。 */
  const [stopNote, setStopNote] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [hiddenRegions, setHiddenRegions] = useState<Region[]>(() => readHiddenRegions(project.id))
  /** 隐藏区集合的即时镜像：挂载 effect 里的回调（布局变化 / 激活面板变化）要读**最新**值。 */
  const hiddenRef = useRef<Region[]>(hiddenRegions)
  hiddenRef.current = hiddenRegions
  /** 由挂载 effect 赋值的「输入条要不要藏」判定：hiddenRegions 变化（收起编辑区）时也要重跑。 */
  const syncChatSeatRef = useRef<() => void>(() => {})
  const [layoutDirty, setLayoutDirty] = useState(false)
  /** 右上角「设置」面板（显示/隐藏窗口 + 标题栏位置 + 皮肤 + 字体，四块合一）。 */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 标题行左侧「项目切换」面板。 */
  const [projOpen, setProjOpen] = useState(false)
  /** 鼠标悬浮自动开合用的定时器（用户要求：项目清单悬浮就弹，不必非点不可）。 */
  const projHoverRef = useRef<number | null>(null)
  /** 背景皮肤 id（目录见 skins.ts；空字符串 = 无皮肤）。 */
  const [skin, setSkin] = useState<string>(readSkinId)
  /** 当前宿主主题模式（皮肤面板里按它显示对应的那一栏）。 */
  const [skinMode, setSkinMode] = useState<'dark' | 'light'>(currentThemeMode)
  /** 浮动面板落点：顶置给 top，侧置给 bottom（向上长）。见 chrome-position.ts 的 popPlacement()。 */
  const [popPos, setPopPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  /** 侧栏宽度（可拖拽；同 info_report 的 --side-l / --side-r）。 */
  const [sideW, setSideW] = useState<{ left: number; right: number }>(() => {
    try {
      const raw = window.localStorage.getItem(SIDE_W_KEY)
      const p2 = raw ? JSON.parse(raw) : null
      const num = (v: unknown, d: number) => (typeof v === 'number' && v >= SIDE_MIN && v <= SIDE_MAX ? v : d)
      return { left: num(p2?.left, 220), right: num(p2?.right, 260) }
    } catch {
      return { left: 220, right: 260 }
    }
  })
  /** 收起/展开区域：写状态 + 落盘（保存/恢复布局与拖拽共用同一条路）。 */
  const applyRegions = useCallback((hidden: Region[]) => {
    setHiddenRegions(hidden)
    try {
      window.localStorage.setItem(REGIONS_KEY(project.id), JSON.stringify(hidden))
    } catch {
      /* 隐私模式：仅本次会话有效 */
    }
  }, [project.id])
  /** 两侧栏宽度：写状态 + 落盘。 */
  const applySideW = useCallback((w: { left: number; right: number }) => {
    setSideW(w)
    try {
      window.localStorage.setItem(SIDE_W_KEY, JSON.stringify(w))
    } catch {
      /* 隐私模式：仅本次会话有效 */
    }
  }, [])
  const projBtnRef = useRef<HTMLButtonElement>(null)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)
  const [activeLabel, setActiveLabel] = useState('—')
  /** 状态栏左侧：主对话的实时进度（过程信息 / 完成信息）。 */
  const [liveTip, setLiveTip] = useState<{ text: string; done: boolean }>({ text: '等待对话…', done: false })

  // —— 历史会话 / 新建会话（同旧工作台的 SessionPicker，放在状态栏）——
  const sessions = useProjectSessions(project.path)
  const [sessionError, setSessionError] = useState('')

  // 工作台主对话跟哪条会话走：
  //   **宿主当前会话**（sessionId 由 conversation.view 注入）若属于本项目、且不是探索者，
  //   就用它 —— 点「新建会话 / 历史会话」后宿主会切到目标会话，工作台必须跟着切。
  //   旧实现一律取「本项目最近的非空白会话」，于是宿主切到刚新建的空白会话后
  //   工作台还停在旧对话上 —— 用户看到的就是「点新建会话不能新建出来」。
  //   只有宿主会话不属于本项目、或它指向探索者（BUG-2：探索者禁入主对话）时，
  //   才回退到「本项目最近的非空白会话」。
  const sid = useMemo(() => {
    const ctx = getClientContext()
    const prop = sessionId || ''
    const known = !!prop && sessions.some((s) => s.id === prop && !s.explorer)
    if (prop && !isExplorerSessionId(prop) && (known || sessionBelongsToProject(ctx, prop, project.path))) {
      return prop
    }
    // 本项目没会话时**不能**退回宿主那条（它属于别的项目）：宁可显示空对话，
    // 也不要把别的项目的会话接进本工作台（隔离的唯一真相是工作区路径）。
    return latestProjectSession(ctx, project.path)?.id ?? ''
  }, [project.path, sessionId, sessions])

  /**
   * 当前会话的 tokensave_delegate 工具跨度（已完成 + 进行中）。
   *
   * 用途：判断「当前这一轮探索是不是本会话发起的」。新记录（有 originSessionId）
   * 直接比 id；**升级前的旧轮次没有 origin**，只能由本会话自己的 delegate 跨度自证。
   */
  const [delegateSpans, setDelegateSpans] = useState<{ startMs: number; endMs: number | null }[]>([])
  useEffect(() => {
    if (!sid) {
      setDelegateSpans((prev) => (prev.length > 0 ? [] : prev))
      return
    }
    return subscribeSessionMetrics(sid, (m) => {
      const next = [...m.toolSpans, ...m.pendingTools]
        .filter((s) => s.name === 'tokensave_delegate')
        .map((s) => ({ startMs: s.startMs, endMs: s.endMs ?? null }))
      // 指标每次事件都会推：内容没变就复用旧数组，避免无谓重渲染
      setDelegateSpans((prev) => (
        prev.length === next.length
        && prev.every((p, i) => p.startMs === next[i].startMs && p.endMs === next[i].endMs)
          ? prev
          : next
      ))
    })
  }, [sid])

  /**
   * 本轮探索者归属：**只在本会话发起的那一轮里**展示探索者与协作内容。
   *
   * 背景（用户反馈）：项目有探索者时，新建会话进入工作台仍带着上一轮的探索者窗口、
   * 「协作对话」里的历史发言 —— 看起来像新会话继承了旧内容。根因是探索者轮次
   * 按 workspace 登记（runs.json），不看发起会话。
   * 判定顺序：
   *   ① 服务端记了 originSessionId → 权威比较当前会话 id；
   *   ② 旧记录没记 origin → 用本会话的 delegate 跨度与轮次开始时间比对自证；
   *   ③ 旧服务端连 startedAtMs 都没返回 → 退回「本会话有没有 delegate 跨度」；
   */
  const ownsRun = useMemo(() => {
    const run = data.run ?? null
    if (!run) return true
    if (run.originSessionId) return run.originSessionId === sid
    if (run.startedAtMs === null) {
      // 旧服务端（客户端先布、服务端还没重启）：没有开始时间可比对 —— 退回
      // 「本会话是否用过 delegate」；新会话一个跨度都没有，仍不会继承上一轮内容。
      return delegateSpans.length > 0
    }
    const at = run.startedAtMs
    // delegate 的 tool/call 先于轮次开始（execute 里才 beginRun），留 5s 余量；
    // 进行中的跨度没有 endMs，按「至今仍在进行」处理。
    return delegateSpans.some((s) => (
      s.startMs - 5_000 <= at && at <= (s.endMs ?? Date.now()) + 5_000
    ))
  }, [data.run, sid, delegateSpans])
  /** 对外只暴露「属于本轮」的探索者：新会话拿到空数组，面板随之移除。 */
  const explorers = useMemo(
    () => (ownsRun ? data.explorers : NO_EXPLORERS),
    [ownsRun, data.explorers],
  )

  const titleFor = useCallback((id: string) => paneTitle(id, project.name), [project.name])

  // —— 项目隔离：宿主当前会话必须与工作台显示的那条一致 ——
  //   宿主的原生输入条（被停靠进「DSH 主对话」）永远属于**宿主当前会话**，而工作台
  //   显示的是 sid。两者不一致时：草稿跟着宿主会话走、发消息也进宿主会话 —— 用户看到
  //   的正是「在 A 项目里写的内容，切到 B 项目后还在输入框里」（容易发错位置）。
  //   所以进入某项目工作台时，只要宿主不在本项目的会话上，就切过去。
  useEffect(() => {
    if (sessionId === sid) return
    if (sid) {
      // 先记下「这条会话属于本项目」：宿主切过去后 ControlRoom 会按记忆找项目，
      // 记忆缺失就会掉回「去项目中心选项目」那一屏。
      rememberOpenedProject(sid, project.id)
      if (openSession(sid)) console.log('[tokensave] 宿主会话已切到本项目会话', sid.slice(0, 22))
      return
    }
    // 本项目一条会话都没有：宿主还连着别的项目（否则 sessionId 不会非空）。
    // 在本项目下开一条空白会话并把宿主切过去，否则输入条依旧连着别的项目。
    if (!sessionId || autoSessionRef.current) return
    autoSessionRef.current = true
    void startProjectSession(project.path, project.id, sessionId)
  }, [sessionId, sid, project.path, project.id])

  const markDirtyRef = useRef<null | (() => void)>(null)
  markDirtyRef.current = () => {
    if (!suppressDirtyRef.current) setLayoutDirty(true)
  }

  /**
   * 隐藏态双击把手 → 展开。
   *
   * 用 ref 而不是 state：bindResizer 是在 pointerdown 里读它的（不能每次双击都重渲染），
   * openSide 同理经 ref 调用，避开 bindResizer 的依赖数组变更。
   */
  const dblClickRef = useRef<null | { side: 'left' | 'right'; at: number; x: number; y: number }>(null)
  const openSideRef = useRef<null | ((side: 'left' | 'right') => void)>(null)

  // —— 状态栏左侧：从主对话消息流提炼一句实时提示 ——
  //   · 未完成：显示最近一条**过程信息**（assistant 的思考/正文开头）；
  //   · 已完成（最近一条是 assistant 且其后没有新的用户/工具活动，或收到 turn/end）：
  //     显示最终回复开头，过长用省略号（完成态由左侧小圆点表达，不再拼「对话已完成」）。
  useEffect(() => {
    if (!sid) {
      setLiveTip({ text: '等待对话…', done: false })
      return
    }
    // 状态栏宽度够就多显示（用户反馈「截得太早」）：这里只压平换行 + 给个
    // 极端长文兜底（400 字），真正的截断交给 CSS 省略号（.ts-sb-item）。
    const shorten = (raw: string, cap = 400) => {
      const one = raw.replace(/\s+/g, ' ').trim()
      if (!one) return ''
      return one.length > cap ? `${one.slice(0, cap)}…` : one
    }
    const un = subscribeSession(sid, (list) => {
      if (!list.length) {
        setLiveTip({ text: '等待对话…', done: false })
        return
      }
      // 取最近一条 assistant（正文或思考）作为提示内容；
      // 若它之后没有任何用户/工具活动，就算这一轮已完成。
      let lastAssistant: (typeof list)[number] | null = null
      let idx = -1
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].role === 'assistant') {
          lastAssistant = list[i]
          idx = i
          break
        }
      }
      if (!lastAssistant) {
        setLiveTip({ text: '等待模型响应…', done: false })
        return
      }
      const body = shorten(lastAssistant.content || '')
      const gotNotice = !!lastAssistant.notice
      const after = list.slice(idx + 1)
      const stillWorking = after.some((m) => m.role !== 'assistant')
      if (!stillWorking) {
        // 主对话这一轮已经结束，却还有探索者在跑（用户反馈：主对话完成了，
        // 探索者还在持续跑）—— 结果已经没人消费了，自动全部停掉，省得一直烧额度。
        // 每轮只触发一次（用 lastAssistant.time 作轮次指纹）。
        const turnKey = Number(lastAssistant.time ?? 0)
        if (turnKey && autoStopTurnRef.current !== turnKey) {
          autoStopTurnRef.current = turnKey
          const running = (explorersRef.current ?? []).filter((e) => e.state === 'running')
          if (running.length) {
            setLiveTip({ text: `本轮已结束，正在停止 ${running.length} 个仍在运行的探索者…`, done: false })
            window.setTimeout(() => void stopAllExplorersRef.current?.(), 300)
            return
          }
        }
        // 不再拼「· 对话已完成」：完成态由左侧圆点表达（data-done + ts-sb-dot 由蓝转灰），
        // 每轮都挂一句相同的话尾只是噪音（用户反馈）。异常结束仍保留标注：那有信息量。
        const suffix = gotNotice ? ' · 本轮异常结束' : ''
        setLiveTip({ text: `${body || '（无正文）'}${suffix}`, done: true })
      } else {
        setLiveTip({ text: body || '正在处理…', done: false })
      }
    })
    return () => un()
  }, [sid])

  /** 面板当前所在区（不在任何实例 = 已关闭）。 */
  const regionOf = useCallback((id: string): Region | null => {
    const apis = apiRef.current
    if (!apis) return null
    for (const r of REGIONS) {
      if (apis[r]?.getPanel(id)) return r
    }
    return null
  }, [])

  /** 面板规格（加进任一实例都用它）。 */
  const paneOpts = useCallback(
    (id: string, position?: any) => ({
      id,
      component: 'pane',
      title: titleFor(id),
      tabComponent: 'iconTab',
      params: { win: id },
      ...(position ? { position } : {}),
    }),
    [titleFor],
  )
  paneOptsRef.current = paneOpts

  // —— 数据轮询（探索者 + 预览探测同一拍，8s）——
  useEffect(() => {
    let alive = true
    const poll = async () => {
      // 用 Partial：网络抖动时**保留上次**的探索者/预览（旧实现先置空数组，
      // 一次失败就把探索者窗口和协作对话整个抹掉，与注释承诺相反）。
      const next: Partial<ProjectData> = {}
      try {
        const snap = await fetchExplorers(project.path)
        next.explorers = snap.sessions
        // 轮次归属（发起会话 / 开始时间）：工作台据此只在本会话发起的那一轮里展示
        next.run = snap.run
      } catch {
        /* 保留上次 */
      }
      try {
        const info = await fetchProjectInfo(project.path)
        next.devUrl = info?.devUrl
        next.devRunning = info?.devRunning
      } catch {
        /* 保留上次 */
      }
      if (alive) setData((prev) => ({ ...prev, ...next }))
    }
    void poll()
    const t = window.setInterval(() => void poll(), 8_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [project.path])

  /** 关掉一个面板（从它所在的区移除；进入已关闭集合，可经 chips / ⋯ 菜单恢复）。 */
  const closePanel = useCallback(
    (id: string) => {
      const apis = apiRef.current
      const cur = regionOf(id)
      if (!apis || !cur) return
      const p = apis[cur].getPanel(id)
      if (p) apis[cur].removePanel(p)
      // 记成「用户关掉的」并落盘：否则 reconcile / 下次刷新又把它放回来，
      // 而且落在默认区、不是原来那个位置（用户反馈的那条 bug）。
      // 只有真正的关闭入口走这里（三键 / ⋯ 菜单 / 标签右键菜单），
      // 组件被动 dispose 不记账（见 unregister 的注释）。
      closedRef.current.add(id)
      writeClosed(project.id, closedRef.current)
      bump((n) => n + 1)
    },
    [regionOf, project.id],
  )
  closePanelRef.current = closePanel

  /** 把窗口放到指定区（未打开也会打开到那里；已在别处则先摘再挂）——同 info_report。 */
  const moveWindowTo = useCallback(
    (id: string, region: Region, position?: any) => {
      const apis = apiRef.current
      if (!apis) return
      const target = apis[region]
      if (!target) return
      const cur = regionOf(id)
      if (cur === region) {
        target.getPanel(id)?.api.setActive()
        return
      }
      if (cur) {
        const p = apis[cur].getPanel(id)
        if (p) apis[cur].removePanel(p)
      }
      // 目标区若被收起，先展开（否则放进去也看不见）
      setHiddenRegions((h) => {
        const next = h.filter((r) => r !== region)
        try {
          window.localStorage.setItem(REGIONS_KEY(project.id), JSON.stringify(next))
        } catch {
          /* 忽略 */
        }
        return next
      })
      try {
        // position 缺省 = 落到目标实例当前的活动分组（一个标签页）；
        // 需要「分屏」时由调用方传 { direction, referencePanel }（referencePanel 必须在同一实例）
        target.addPanel(paneOptsRef.current(id, position))
        target.getPanel(id)?.api.setActive()
      } catch (e) {
        console.warn('[desk-dock] 移动窗口失败', id, region, e)
      }
    },
    [regionOf],
  )

  // —— 实例化：三个 dockview（只建一次；换项目由 ControlRoom 按 key 重挂）——
  useEffect(() => {
    const hosts: Record<Region, HTMLElement | null> = {
      left: leftHostRef.current,
      center: centerHostRef.current,
      right: rightHostRef.current,
    }
    if (!hosts.left || !hosts.center || !hosts.right) return
    const DVC = installDockview()
    if (!DVC || typeof DVC.createDockview !== 'function') {
      console.warn('[desk-dock] dockview-core 未就绪', DVC)
      return
    }
    installDockCss()
    STALE_KEYS.forEach((k) => {
      try {
        window.localStorage.removeItem(k)
      } catch {
        /* 忽略 */
      }
    })
    Object.keys(window.localStorage)
      .filter((k) => STALE_PREFIX.some((p) => k.startsWith(p)))
      .forEach((k) => {
        try {
          window.localStorage.removeItem(k)
        } catch {
          /* 忽略 */
        }
      })

    const register = (id: string, el: HTMLElement) => {
      containersRef.current[id] = el
      // 真正被建出来 = 不再算「关着」（chip / 全部打开 / 拖动都会走到这里）→ 同步落盘
      if (closedRef.current.delete(id)) writeClosed(project.id, closedRef.current)
      bump((n) => n + 1)
    }
    const unregister = (id: string, el: HTMLElement) => {
      if (containersRef.current[id] === el) {
        delete containersRef.current[id]
        // ⚠️ 这里**不能**推断「用户把它关掉了」：dockview 在移动面板、重建标签、
        // 恢复布局、插件热重载时都会 dispose 组件。实测教训——一旦这么记，探索者窗口
        // 整批会被标记成「关掉的」，刷新后集体消失。
        // 「关掉」只在用户真的动了关闭入口时记（见 closePanel / 右键菜单）。
        bump((n) => n + 1)
      }
    }

    const makeOptions = (region: Region) => ({
      createComponent: (o: any) => {
        if (o?.name !== 'pane') return null
        const el = document.createElement('div')
        el.className = 'ts-dock-pane'
        let id = ''
        return {
          element: el,
          init(params: any) {
            id = String(params?.params?.win || '')
            register(id, el)
          },
          dispose() {
            if (id) unregister(id, el)
          },
        }
      },
      createTabComponent: (o: any) => {
        if (o?.name !== 'iconTab') return undefined
        const el = document.createElement('span')
        el.className = 'ts-dock-tabico'
        return {
          element: el,
          init(params: any) {
            const id = String(params?.params?.win || '')
            el.innerHTML = iconSvg(paneIcon(id))
            el.title = paneOptsRef.current(id) && titleFor(id)
            // 标签元素上带面板 id：状态角标（跑/中断/新消息）由 effect 按属性驱动，
            // 不需要在标签里再拼一遍图（CSS 用 ::after 画）。
            const host = (el.closest('.dv-tab') as HTMLElement | null) ?? el
            host.setAttribute('data-ts-pane', id)
            // 建标签时先画一次角标（dockview 重建标签后属性会丢，见 paintBadges 的注释）
            window.setTimeout(() => paintBadgesRef.current?.(), 0)
          },
          dispose() {
            el.innerHTML = ''
          },
        }
      },
      createWatermarkComponent: () => {
        // dockview 的组件契约是 { element, init, dispose }（默认只提供 element 会报
        // 「this._watermark.init is not a function」——实测踩过）。空面板的提示语写在 init 里。
        const el = document.createElement('div')
        el.className = 'ts-dock-watermark'
        return {
          element: el,
          init() {
            el.textContent =
              region === 'left'
                ? '主侧栏：把窗口拖到这里'
                : region === 'right'
                  ? '辅助侧栏：把窗口拖到这里'
                  : '编辑区 / 面板区：把窗口拖到这里'
          },
          dispose() {
            el.textContent = ''
          },
        }
      },
      theme: {
        name: 'intel',
        className: 'dv-intel',
        colorScheme: 'dark',
        gap: 0,
        // 关键：不设它时 dockview 会把**根级落点容器** disabled=true，
        // 于是拖动时落点浮层永不出现、跨实例拖拽永远落不下去（实测 dep 源码
        // updateTheme → switch(dndOverlayMounting){default: disabled=true}）。
        dndOverlayMounting: 'absolute',
        dndPanelOverlay: 'group',
        dndOverlayBorder: '2px solid var(--dv-active-sash-color)',
      },
      defaultRenderer: 'always',
      noPanelsOverlay: 'emptyGroup',
      // 布局锁功能已删：面板/分隔条始终可拖（保留这个选项位以免 dockview 默认值不同）
      disableDnd: false,
      getTabContextMenuItems: ({ panel, group }: any) => [
        // 走 closePanel：关闭要记账（关掉的窗口不许自己回来）
        { label: '关闭', action: () => closePanelRef.current?.(String(panel.id)) },
        {
          label: '关闭其他',
          action: () =>
            group.panels.slice().forEach((p: any) => {
              if (p !== panel) closePanelRef.current?.(String(p.id))
            }),
        },
        'separator',
        {
          label: '浮动',
          action: () => apiRef.current?.[region]?.addFloatingGroup(panel, { width: 560, height: 420 }),
        },
        {
          label: panel.api.isMaximized() ? '还原' : '最大化',
          action: () => (panel.api.isMaximized() ? panel.api.exitMaximized() : panel.api.maximize()),
        },
        'separator',
        ...REGIONS.filter((r) => r !== region).map((r) => ({
          label: `移到${REGION_LABEL[r]}`,
          action: () => moveWindowTo(String(panel.id), r),
        })),
      ],
      // 跨实例拖拽（info_report 同款）：**只 accept 外来载荷**。
      // 无条件 accept 会搅乱同实例的落点判定（dockview 默认只在非 center 时自动显示
      // 落点，center 才问 dispatchUnhandledDragOver）——实测那样连组内拖动都会失效。
    })

    const apis: Record<Region, any> = {
      left: DVC.createDockview(hosts.left, makeOptions('left')),
      center: DVC.createDockview(hosts.center, makeOptions('center')),
      right: DVC.createDockview(hosts.right, makeOptions('right')),
    }
    apiRef.current = apis

    /**
     * 跨实例拖拽（**按 info_report 用运行时 API 注册**，不放构造选项）：
     * 载荷是页面级单例，三个实例互相看得见，默认只认自己那份（比 accessor.id）；
     * 外来载荷在 onUnhandledDragOver 里 accept() → 落点浮层显示，
     * onDidDrop 再把面板从源实例摘下来挂到目标实例。只 accept 外来载荷。
     */
    const isForeign = (data: any, api: any) => !!(data && data.panelId && !api.getPanel(data.panelId))
    REGIONS.forEach((r) => {
      try {
        apis[r].onUnhandledDragOver((event: any) => {
          let data: any = null
          try {
            data = event.getData()
          } catch {
            /* 取不到载荷：不 accept */
          }
          if (isForeign(data, apis[r])) event.accept()
        })
        apis[r].onDidDrop((event: any) => {
          let data: any = null
          try {
            data = event.getData()
          } catch {
            return
          }
          const pid = data?.panelId
          if (!pid) return
          if (regionOf(String(pid)) === r) return
          moveWindowTo(String(pid), r)
        })
      } catch (e) {
        console.warn('[desk-dock] 注册跨实例拖拽失败', r, e)
      }
    })

    /**
     * 跨区拖拽的**兜底**（用户反馈「项目预览拖不到别的区」）。
     *
     * dockview 只在落点是**空组**（侧栏没窗口时预置的那个）时才把外来载荷交给
     * 我们的 onDidDrop；落在**已有窗口的内容区**上时，事件被那个窗口自己的落点吃掉
     * （面板级 onDidDrop 没人监听），于是松手后什么也没发生 —— 六类窗口一个样，
     * 只是「项目预览」最常用到跨区拖拽，所以先被报出来。
     *
     * 这里在 dragend 时按松手坐标自己判定落在哪个区：dockview 已经搬过的
     * （regionOf 已等于目标区）直接跳过，所以与上面的 onDidDrop 幂等共存。
     * 同区拖动（组内换序 / 分屏）不归这里管，仍由 dockview 自己处理。
     */
    REGIONS.forEach((r) => {
      try {
        apis[r].onWillDragPanel((e: any) => {
          dragPanelRef.current = String(e?.panel?.id || '')
        })
      } catch {
        /* 该版本无此事件 */
      }
    })
    /** 拖动期间把 iframe 的命中关掉（见 DOCK_CSS 的 body.ts-dock-dragging 规则）。 */
    const onDragStart = (ev: DragEvent) => {
      const t = ev.target as HTMLElement | null
      if (t?.closest?.('.dv-tab')) document.body.classList.add('ts-dock-dragging')
    }
    const finishDrag = (x: number, y: number) => {
      const id = dragPanelRef.current
      dragPanelRef.current = ''
      document.body.classList.remove('ts-dock-dragging')
      if (!id || !Number.isFinite(x) || !Number.isFinite(y)) return
      const box = dockRootRef.current?.getBoundingClientRect()
      // 取消的拖动（Esc / 拖到工作台之外）不算：松手点必须在工作台里
      if (!box || x < box.left || x > box.right || y < box.top || y > box.bottom) return
      const host = document.elementFromPoint(x, y)?.closest?.('[data-desk-host]')
      const region = host?.getAttribute('data-desk-host') || ''
      if (!(REGIONS as readonly string[]).includes(region)) return
      if (regionOf(id) === region) return
      moveWindowTo(id, region as Region)
    }
    const onDragEnd = (ev: DragEvent) => finishDrag(ev.clientX, ev.clientY)
    const onPointerUp = (ev: PointerEvent) => finishDrag(ev.clientX, ev.clientY)
    document.addEventListener('dragstart', onDragStart, true)
    document.addEventListener('dragend', onDragEnd, true)
    document.addEventListener('pointerup', onPointerUp, true)

    /**
     * 空实例必须有**至少一个组**才能接收拖拽（dockview 的组才是落点；
     * 没有组时只有根上的 watermark 容器，drop 无处可去 —— 实测
     * 「拖到空侧栏落不下去」就是这个原因）。
     * 这里给还没有任何面板的实例预置一个空组作为落点。
     */
    const ensureDropTarget = (region: Region) => {
      const api = apis[region]
      if (!api.groups.length) {
        try {
          api.addGroup({ direction: region === 'left' ? 'left' : region === 'right' ? 'right' : 'below' })
        } catch (e) {
          console.warn('[desk-dock] 预置空组失败', region, e)
        }
      }
    }

    const addTo = (region: Region, kind: string, position?: any) => {
      apis[region].addPanel(paneOptsRef.current(paneId(project.id, kind), position))
    }
    // 默认摆位（同 info_report 的 VIEWS.region）：预览→主侧栏；主对话→编辑区；
    // 黑板/协作对话/收益→面板区（与编辑区同实例，落成下方的分组）
    const buildDefault = () => {
      const chat = paneId(project.id, 'chat')
      addTo('center', 'chat')
      // 预览默认摆在编辑区、主对话**左边**（进项目就能同时看到两窗）
      if (data.devUrl) addTo('center', 'preview', { direction: 'left', referencePanel: chat })
      addTo('center', 'board', { direction: 'below', referencePanel: chat })
      addTo('center', 'talk', { direction: 'right', referencePanel: chat })
      addTo('center', 'save', { direction: 'below', referencePanel: paneId(project.id, 'talk') })
    }
    resetToBuiltinRef.current = () => {
      REGIONS.forEach((r) => apis[r].panels.slice().forEach((p: any) => apis[r].removePanel(p)))
      buildDefault()
    }

    // 恢复顺序：用户保存的默认布局 → 自动快照 → 内置摆位
    let restored = false
    const tryRestore = (key: string) => {
      try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return false
        const snap = normalizeSnapshot(JSON.parse(raw))
        if (!snap) return false
        REGIONS.forEach((r) => {
          if (snap.regions[r]) apis[r].fromJSON(snap.regions[r], { reuseExistingPanels: true })
        })
        // 只恢复面板排布：收起与宽度由 REGIONS_KEY / SIDE_W_KEY 这两个「当前状态」键管，
        // 若这里也拿「保存的默认」去盖，重载后会把用户后来改过的收起状态又拉回默认。
        return true
      } catch (e) {
        console.warn('[desk-dock] 快照恢复失败', e)
        return false
      }
    }
    suppressDirtyRef.current = true
    restored = tryRestore(SAVED_KEY(project.id)) || tryRestore(SNAPSHOT_KEY(project.id))
    if (!restored) buildDefault()
    // 用户关过的窗口：快照/默认布局里都有它 → 这里当场摘掉，不带回来
    // （用户反馈：关掉后一刷新又冒出来，而且落在默认区、不是原来那块）。
    closedRef.current.forEach((id) => {
      const r = regionOf(id)
      if (!r) return
      const p = apis[r].getPanel(id)
      if (p) apis[r].removePanel(p)
    })
    // 「项目预览默认在编辑区」的归位迁移放到了下面的面板 reconcile 里：
    // 那时预览面板可能还没建出来（devUrl 是轮询拿到的），在挂载时做会白跑一次。
    REGIONS.forEach(ensureDropTarget)
    window.setTimeout(() => {
      suppressDirtyRef.current = false
    }, 500)

    /**
     * 窗口标签的右键菜单。
     *
     * 为什么必须搬出面板链路：菜单挂在 `.dv-popover-anchor` 里，而面板链路上有
     * `overflow:hidden`（`.ts-region-host` 等）→ 菜单在区域边缘被裁掉、点不到。
     * 搬到 `document.body` 后又丢了 dockview 的 `--dv-*` 变量（背景变透明、字体回 16px）
     * 且 dockview 自己的「点外部关闭」也失效 —— 所以：
     *   ① 搬出来时把坐标夹进视口（不超出右/下边）；CSS 里兜底写死外观；
     *   ② 关闭交给我们自己的监听（点外部 / Esc / 滚屏 / 失焦 / 点菜单项）。
     */
    const closeContextMenu = () => {
      document.querySelectorAll('.dv-context-menu[data-ts-hoisted="1"]').forEach((m) => m.remove())
    }
    const hoistContextMenu = () => {
      const menu = document.querySelector('.dv-context-menu') as HTMLElement | null
      if (!menu || menu.dataset.tsHoisted === '1') return
      const r = menu.getBoundingClientRect()
      menu.dataset.tsHoisted = '1'
      menu.style.position = 'fixed'
      // 夹进视口：否则菜单在屏幕右下角会超出去
      const left = Math.max(6, Math.min(Math.round(r.left), window.innerWidth - r.width - 6))
      const top = Math.max(6, Math.min(Math.round(r.top), window.innerHeight - r.height - 6))
      menu.style.left = `${left}px`
      menu.style.top = `${top}px`
      menu.style.zIndex = '120'
      document.body.appendChild(menu)
    }
    const onMenuOutsideDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest?.('.dv-context-menu')) return
      closeContextMenu()
    }
    const onMenuClick = (e: MouseEvent) => {
      const t = e.target as Element | null
      // 点菜单项：等它的动作跑完（同一轮事件）再收菜单，否则点不到
      if (t?.closest?.('.dv-context-menu')) window.setTimeout(closeContextMenu, 0)
    }
    const onMenuKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu()
    }
    document.addEventListener('mousedown', onMenuOutsideDown, true)
    document.addEventListener('click', onMenuClick, true)
    document.addEventListener('keydown', onMenuKey, true)
    window.addEventListener('scroll', closeContextMenu, true)
    window.addEventListener('resize', closeContextMenu)
    window.addEventListener('blur', closeContextMenu)

    /**
     * 主对话卡**真的不在了**时才把宿主输入条整条藏掉（同 ts-hdesk-nochat 口径）：
     * 面板被关、或整个编辑区/面板区被收起。
     *
     * ⚠️ 不要因为「主对话被别人挡在后面」（api.isVisible === false）就藏 ——
     * 用户反馈（info_report / compare-text）「主对话里看不到输入框」就是这个条件造成的：
     * 那两块布局里主对话是后台标签，但输入条仍然可用、也必须看得见。
     * 代价：当有人把别的窗口拖进主对话那一组时，输入条会浮在它上面（可接受：看得见 > 藏了）。
     */
    const syncChatSeat = () => {
      // 主对话面板可能被拖到任一区（用户会把窗口搬到侧栏），只在 center 里找会误判
      // 「面板不在了」→ 把宿主输入条整条藏掉（用户反馈：其他项目里 DSH 主对话没有输入框）。
      const chatId = paneId(project.id, 'chat')
      const home = REGIONS.find((r) => apis[r].getPanel(chatId))
      const shown = !!home && !hiddenRef.current.includes(home)
      document.body.classList.toggle('ts-desk-nochat', !shown)
    }
    syncChatSeatRef.current = syncChatSeat
    const syncLive = () => {
      setLiveIds(REGIONS.flatMap((r) => apis[r].panels.map((p: any) => String(p.id))))
      syncChatSeat()
    }
    syncLive()
    let saveTimer = 0
    REGIONS.forEach((r) => {
      apis[r].onDidLayoutChange(() => {
        syncLive()
        hoistContextMenu()
        // 某区被关空后要重新有落点，否则拖不进去
        window.setTimeout(() => REGIONS.forEach(ensureDropTarget), 0)
        markDirtyRef.current?.()
        // 300ms 节流 + 尾包：拖动期间不每帧写盘
        if (saveTimer) window.clearTimeout(saveTimer)
        saveTimer = window.setTimeout(() => {
          try {
            const snap: Record<string, any> = {}
            REGIONS.forEach((rr) => {
              snap[rr] = apis[rr].toJSON()
              window.localStorage.setItem(SNAPSHOT_KEY(project.id), JSON.stringify(snap))
            })
          } catch {
            /* 隐私模式：仅本次会话有效 */
          }
        }, 300)
      })
      try {
        apis[r].onDidActivePanelChange((p: any) => {
          if (p?.id) {
            const pid = String(p.id)
            setActiveLabel(kindLabel(pid))
            // 用户看到这条探索者了 → 记「已看过」，角标随之清掉（回消息提醒）
            const m = /:exp:([^:]+)$/.exec(pid)
            if (m) seenRef.current[m[1]] = Date.now()
          }
          // 主对话被别人挡在后面时要把宿主输入条藏掉（见 syncChatSeat）
          syncChatSeat()
        })
      } catch {
        /* 该版本无此事件：状态栏退化为面板计数 */
      }
    })

    // 兜底：右键后菜单在下一帧出现，用 rAF 连抓几拍把它搬走
    const hoistRaf = () => {
      let n = 0
      const tick = () => {
        hoistContextMenu()
        if (++n < 8) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
    document.addEventListener('contextmenu', hoistRaf, true)

    ;(window as any).__tsDeskDock = {
      apis,
      projectId: project.id,
      panelIds: () => REGIONS.flatMap((r) => apis[r].panels.map((p: any) => String(p.id))),
      regionOf: (id: string) => regionOf(id),
      closed: () => [...closedRef.current].filter((id) => !regionOf(id)),
      lock: (on: boolean) => REGIONS.forEach((r) => apis[r].updateOptions({ disableDnd: on })),
      dnd: () => apis.center.dndCapabilities,
      reset: () => resetToBuiltinRef.current?.(),
      move: (id: string, region: Region) => moveWindowTo(id, region),
      /** 探索者状态角标快照（跑 / 异常 / 有新回复 / 安静）：真机核对与排查用。 */
      badges: () => badgesRef.current,
      /** 全部停止探索者（与协作对话标题行的按钮同一个入口）。 */
      stopExplorers: () => stopAllExplorersRef.current?.(),
    }

    return () => {
      teardownRef.current = true
      document.removeEventListener('contextmenu', hoistRaf, true)
      document.removeEventListener('mousedown', onMenuOutsideDown, true)
      document.removeEventListener('click', onMenuClick, true)
      document.removeEventListener('keydown', onMenuKey, true)
      window.removeEventListener('scroll', closeContextMenu, true)
      window.removeEventListener('resize', closeContextMenu)
      window.removeEventListener('blur', closeContextMenu)
      closeContextMenu()
      document.body.classList.remove('ts-desk-nochat')
      document.removeEventListener('dragstart', onDragStart, true)
      document.removeEventListener('dragend', onDragEnd, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.body.classList.remove('ts-dock-dragging')
      if (saveTimer) window.clearTimeout(saveTimer)
      REGIONS.forEach((r) => {
        try {
          apis[r].dispose()
        } catch {
          /* 忽略 */
        }
      })
      containersRef.current = {}
      delete (window as any).__tsDeskDock
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  // —— 数据变化时补齐/移除面板（探索者增减、预览可用性变化）——
  useEffect(() => {
    const apis = apiRef.current
    if (!apis) return
    const defaultRegionOf = (id: string): Region => {
      const kind = parsePaneId(id)?.kind ?? ''
      return kind.startsWith('exp:') ? 'center' : (KIND_REGION[kind] ?? 'center')
    }
    const inHidden = (id: string) => hiddenRegions.includes(defaultRegionOf(id))
    const ensure = (id: string) => {
      if (inHidden(id)) return
      if (regionOf(id)) return
      // 用户主动关掉的窗口不补回来（放在 regionOf 之后：已在场的面板永远不受影响）
      if (closedRef.current.has(id)) return
      const region = defaultRegionOf(id)
      // ⚠️ position 的 referencePanel 必须**属于同一个 dockview 实例**：
      // 主对话在 center 实例，而 preview 要加进 left 实例 —— 跨实例引用会让
      // addPanel 抛错（面板加不进去 → 「项目预览看不到了」实测根因）。
      const hasOwnAnchor = !!apis[region].panels.length
      // 预览面板的落点特殊：**分屏到主对话左边**（不许当标签页塞进主对话那一组，
      // 否则主对话被盖住 → 宿主输入条悬在预览上）。referencePanel 必须同实例 → 用主对话。
      const chatAnchor = apis.center.getPanel(paneId(project.id, 'chat'))
      const isPreview = parsePaneId(id)?.kind === 'preview'
      const position = isPreview && region === 'center' && chatAnchor
        ? { direction: 'left', referencePanel: String(chatAnchor.id) }
        : hasOwnAnchor
          ? { direction: 'within', referencePanel: String(apis[region].panels[0].id) }
          : undefined
      try {
        apis[region].addPanel(paneOptsRef.current(id, position))
      } catch (e) {
        // 兜底：万一还是失败，退化成「不带 position」（落到该实例当前分组）
        try {
          apis[region].addPanel(paneOptsRef.current(id))
        } catch (e2) {
          console.warn('[desk-dock] 面板恢复失败', id, e2)
        }
        void e
      }
    }
    KINDS.forEach((k: Kind) => {
      if (k === 'preview' && !data.devUrl) {
        const id = paneId(project.id, k)
        const r = regionOf(id)
        if (r) apis[r].removePanel(apis[r].getPanel(id))
        return
      }
      ensure(paneId(project.id, k))
    })
    // —— 预览归位（一次性，带版本号）——
    //   旧默认把预览放主侧栏；旧实现还会把它当标签页塞进主对话那一组（把主对话盖住）。
    //   两种都搬到「主对话左边的分屏位」。放 reconcile 里做：此刻预览面板才真存在。
    try {
      const mk = `tokensave:desk-preview-in-editor.v1:${project.id}`
      if (window.localStorage.getItem(mk) !== 'v2') {
        const pid = paneId(project.id, 'preview')
        const anchor = paneId(project.id, 'chat')
        let hit: { region: Region; panel: any } | null = null
        for (const r of REGIONS) {
          const p = apis[r].getPanel(pid)
          if (p) {
            hit = { region: r, panel: p }
            break
          }
        }
        if (hit) {
          const chat = apis.center.getPanel(anchor)
          const sameGroup = !!(hit.panel.group && chat && hit.panel.group === chat.group)
          if (hit.region === 'left' || sameGroup) {
            const pos = chat ? { direction: 'left', referencePanel: anchor } : undefined
            if (hit.region === 'center') {
              // 同区：moveWindowTo 会因为「已在目标区」直接返回 → 先摘下来再按分屏位摆回
              apis.center.removePanel(hit.panel)
              apis.center.addPanel(paneOptsRef.current(pid, pos))
            } else {
              moveWindowTo(pid, 'center', pos)
            }
          }
          window.localStorage.setItem(mk, 'v2')
        }
      }
    } catch (e) {
      console.warn('[desk-dock] 预览归位失败', e)
    }
    explorers.forEach((s) => ensure(paneId(project.id, `exp:${s.id}`)))
    // 探索者消失 → 移除其面板；其余面板若被用户关掉，交由 chips / ⋯ 菜单恢复
    const wanted = new Set<string>(
      explorers.map((s) => paneId(project.id, `exp:${s.id}`)),
    )
    Object.keys(containersRef.current).forEach((id) => {
      if (id.startsWith(`${project.id}:exp:`) && !wanted.has(id)) {
        const r = regionOf(id)
        if (r) apis[r].removePanel(apis[r].getPanel(id))
      }
    })
  }, [explorers, data, hiddenRegions, project.id, regionOf])

  // —— 输入条停靠进「DSH 主对话」面板 ——
  const chatPaneId = paneId(project.id, 'chat')
  // 第 5 参：dockview 命令式重挂面板后 ref 可能指向已摘除的旧节点（输入条留在旧坐标），
  // 用稳定属性选择器回查活节点（与 chatCellRef 同一元素）。
  useDockNativeComposer(
    chatCellRef,
    liveIds.includes(chatPaneId),
    false,
    [liveIds.join(','), reloadKey],
    `.ts-dock-chatcell[data-desk-chat-cell="${project.id}"]`,
  )

  // —— 点页面其它位置自动关闭浮动面板（设置 / 项目切换）——同 info_report 的 closePopMenu 行为
  useEffect(() => {
    if (!settingsOpen && !projOpen) return
    const closeAll = () => {
      setSettingsOpen(false)
      setProjOpen(false)
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t && t.closest('[data-desk-settings-panel]')) return
      if (t && t.closest('[data-desk-settings]')) return
      if (t && t.closest('[data-desk-projsw-panel]')) return
      if (t && t.closest('[data-desk-projswitch]')) return
      closeAll()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [settingsOpen, projOpen])

  // —— 收起/展开区域后，主对话是否可见可能变了 → 重新判定宿主输入条要不要藏 ——
  useEffect(() => {
    syncChatSeatRef.current()
  }, [hiddenRegions])

  // —— 字体：状态变化就写 :root 变量（插件所有视图跟着变），并持久化 ——
  useEffect(() => {
    applyFont(font, fontFamily)
    try {
      window.localStorage.setItem(FONT_KEY, font)
      window.localStorage.setItem(FONT_FAMILY_KEY, fontFamily)
    } catch {
      /* 隐私模式等：仅本次会话有效 */
    }
  }, [font, fontFamily])

  // —— 侧栏宽度拖拽（同 info_report 的 bindSideResizer）——
  //   宽度 1:1 跟随指针；减到 SIDE_MIN（最小可见宽度）= 「拖到不能」→ 立刻收起；
  //   隐藏态往里动 PULL_OUT_EPS(3) 就现身。两个转折点都重锚指针（否则反向要重走一整段）。
  /**
   * 侧栏宽度拖拽（同 info_report 的 bindSideResizer 口径）。
   *
   * **为什么改成「直接写 DOM」**：以前每收到一个 pointermove 就 setSideW/setHiddenRegions，
   * 于是每帧都要重渲染整棵工作台（dockview 三个实例 + 所有面板）—— 用户感受到的就是
   * 「拖起来一顿一顿的」。现在拖动期间只改 CSS 变量（+ 收起的 data 属性），
   * 松手时才同步一次 React 状态，指针事件再用 rAF 合并（一帧最多一次 DOM 写入）。
   */
  const bindResizer = useCallback(
    (side: 'left' | 'right') => {
      return (event: React.PointerEvent<HTMLDivElement>) => {
        const el = event.currentTarget
        const root = dockRootRef.current
        if (!root) return
        /**
         * 隐藏态**双击** → 直接展开。
         *
         * 为什么不用 React 的 onDoubleClick：本处理器对 pointerdown 调了 preventDefault()
         * （防止拖动选中文字），而 preventDefault 会连鼠标兼容事件一起算掉 —— 实测
         * pointerdown 触发两次、dblclick **一次都不来**，双击功能等于不存在。
         * 所以在 pointerdown 里自己按「同一点位 + 300ms 内第二下」判定，不依赖 dblclick。
         */
        const wasHidden = hiddenRef.current.includes(side)
        if (wasHidden) {
          const now = Date.now()
          const dbl = dblClickRef.current
          const hitSame = dbl && dbl.side === side && now - dbl.at < 300 &&
            Math.abs(dbl.x - event.clientX) <= 4 && Math.abs(dbl.y - event.clientY) <= 4
          if (hitSame) {
            dblClickRef.current = null
            event.preventDefault()
            openSideRef.current?.(side)
            return
          }
          dblClickRef.current = { side, at: now, x: event.clientX, y: event.clientY }
        } else {
          dblClickRef.current = null
        }
        event.preventDefault()
        const varName = side === 'left' ? '--ts-side-l' : '--ts-side-r'
        const attr = side === 'left' ? 'data-hide-left' : 'data-hide-right'
        const dir = side === 'left' ? 1 : -1
        /** 指针锚点：每次「收起 ↔ 展开」转折都重锚，宽度 = anchorW + (x - anchorX) * dir。 */
        let anchorX = event.clientX
        let hidden = hiddenRegions.includes(side)
        let anchorW = hidden ? 0 : sideW[side]
        let to = anchorW
        /** 直接写 DOM：隐藏时**必须**把内联变量拿掉，否则内联优先级压过 .hide-* 里的 0px。 */
        const apply = () => {
          if (hidden) {
            root.setAttribute(attr, '')
            root.style.removeProperty(varName)
          } else {
            root.removeAttribute(attr)
            root.style.setProperty(varName, `${to}px`)
          }
        }
        let raf = 0
        let pending = false
        let lastX = event.clientX
        /** 真正算宽度并写 DOM（rAF 里跑，松手时补跑一次——同帧内按下即松手也不丢最后位置）。 */
        const commit = (x: number) => {
          const delta = (x - anchorX) * dir
          if (hidden) {
            // 往里（变宽）动过 PULL_OUT_EPS 就**立刻**现身：不再空等 12px，也不再「拉一下又弹回」
            if (delta < PULL_OUT_EPS) return
            hidden = false
            // 以最小可见宽度起步（立刻看得见），随后 1:1 跟手；重锚后反向微动不会马上又收起
            anchorX = x
            anchorW = SIDE_MIN
            to = SIDE_MIN
            apply()
            return
          }
          // 宽度**连续跟随指针**（不再夹在 SIDE_MIN 上）：一路减到 SIDE_MIN 就已「到头」，
          // 再向内错开 COLLAPSE_HYST 才真收起——避免展开瞬间反向抖动又立刻弹回。
          const w = anchorW + delta
          if (w < SIDE_MIN - COLLAPSE_HYST) {
            hidden = true
            anchorX = x
            anchorW = 0
            apply()
            return
          }
          to = Math.min(SIDE_MAX, Math.max(SIDE_MIN, w))
          apply()
        }
        const move = (ev: PointerEvent) => {
          lastX = ev.clientX
          pending = true
          if (raf) return
          raf = requestAnimationFrame(() => {
            raf = 0
            if (!pending) return
            pending = false
            commit(lastX)
          })
        }
        const up = () => {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          el.removeEventListener('pointercancel', up)
          if (raf) cancelAnimationFrame(raf)
          raf = 0
          // 同一帧里按下就松手（快速一甩）：rAF 还没跑，这里补上最后位置，否则这次拖动白做
          if (pending) {
            pending = false
            commit(lastX)
          }
          document.body.classList.remove('ts-resizing')
          apply()
          // 收尾：一次性同步 React 状态（此后重渲染写回同样的值，不会跳）
          const wasHidden = hiddenRegions.includes(side)
          if (hidden !== wasHidden) {
            applyRegions(hidden
              ? Array.from(new Set([...hiddenRegions, side]))
              : hiddenRegions.filter((r) => r !== side))
          }
          // 收起时不要把宽度写小：留着上次可见宽度，双击/拉出时原样恢复
          applySideW({ ...sideW, [side]: hidden ? sideW[side] : to })
          markDirtyRef.current?.()
        }
        document.body.classList.add('ts-resizing')
        el.setPointerCapture?.(event.pointerId)
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
        el.addEventListener('pointercancel', up)
      }
    },
    [hiddenRegions, sideW, applyRegions, applySideW],
  )

  /**
   * 隐藏态**双击把手** → 直接展开（用户要求：悬浮变蓝时双击就打开）。
   *
   * 只在**隐藏**时生效：可见态双击不动它，免得手快去拖时被误收起；
   * 恢复到**上次记住的宽度**（没记过用 SIDE_MIN），不写回 0/十几像素。
   */
  const openSide = useCallback(
    (side: 'left' | 'right') => {
      const root = dockRootRef.current
      if (!root || !hiddenRef.current.includes(side)) return
      const varName = side === 'left' ? '--ts-side-l' : '--ts-side-r'
      const attr = side === 'left' ? 'data-hide-left' : 'data-hide-right'
      const w = Math.max(SIDE_MIN, Math.min(SIDE_MAX, sideW[side]))
      // 先把本地状态改掉，再落盘：顺序反了会出现「已展开但宽度还是 0」的一帧
      applyRegions(hiddenRef.current.filter((r) => r !== side))
      applySideW({ ...sideW, [side]: w })
      root.removeAttribute(attr)
      root.style.setProperty(varName, `${w}px`)
      markDirtyRef.current?.()
    },
    [sideW, applyRegions, applySideW],
  )
  // 让 pointerdown 处理器能调到最新版 openSide（避免把它塞进 bindResizer 的依赖数组）
  openSideRef.current = openSide

  // 宽度变化落盘（拖拽中不写盘，松手已处理；这里兜住键盘/程序化调整）
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDE_W_KEY, JSON.stringify(sideW))
    } catch {
      /* 忽略 */
    }
  }, [sideW])

  // —— 移动端（窄视口）：两侧栏改成覆盖式抽屉，同时只开一个 ——
  //   窄屏下三栏根本放不下（实测 393px 被压成 196/0/196，中间对话宽度 0），
  //   所以中间永远整宽，左右两侧由这里控制抽屉开关；桌面端行为不变。
  const [drawer, setDrawer] = useState<Region | null>(null)
  /**
   * 窄屏判定。初值直接取自 matchMedia（不再先 false 一帧）：侧置竖轨在手机上要立刻让位，
   * 否则会闪一下竖轨再跳回顶部。
   */
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 900px)').matches,
  )
  /** 标题栏位置偏好（全局一份，与皮肤 / 字体同）；窄屏一律按顶部渲染，偏好本身保留。 */
  const [chrome, setChrome] = useState<ChromePosition>(readChromePosition)
  /** 真正生效的位置（窄屏 → 顶部）。JS 里判断浮层落点、给 .ts-dock 写 data-chrome 都用它。 */
  const chromePos = effectiveChrome(chrome, narrow)
  /**
   * 悬浮状态栏的高度 → `--ts-sb-h`。
   * 状态栏脱离网格行（行高 0）、内容从它底下穿过，所以聊天底部留白与输入条位置
   * 都要知道它有多高（窄屏它会换行成两行，高度是变的）。
   */
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-desk-statusbar]')
    if (!el || typeof ResizeObserver === 'undefined') return
    const apply = () => {
      const h = Math.ceil(el.getBoundingClientRect().height)
      // 上限兜一下：万一量到异常值（字体/样式未就绪），别把它写进变量 ——
      // 这个变量还会被输入条/留白读走，写大了整块界面会被顶起来。
      if (h > 0 && h <= 120) document.documentElement.style.setProperty('--ts-sb-h', `${h}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [liveIds, narrow])


  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 900px)')
    const on = () => {
      setNarrow(mq.matches)
      // 回到宽屏就把抽屉清掉（宽屏走 hiddenRegions 那套，抽屉概念不适用）
      if (!mq.matches) setDrawer(null)
    }
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  /** 区域当前是否“展现在眼前”（只在窄屏下两侧栏看抽屉状态） */
  const regionShown = (r: Region) =>
    narrow ? (r === 'center' ? !hiddenRegions.includes('center') : drawer === r) : !hiddenRegions.includes(r)

  // —— 区域开关（同 info_report 的 hide-left / hide-panel / hide-right）——
  const toggleRegion = (region: Region) => {
    if (narrow && region !== 'center') {
      // 触屏：开/关抽屉（不改进 hiddenRegions，手机上的开关不会污染桌面布局）
      setDrawer((d) => (d === region ? null : region))
      return
    }
    setHiddenRegions((prev) => {
      const next = prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region]
      try {
        window.localStorage.setItem(REGIONS_KEY(project.id), JSON.stringify(next))
      } catch {
        /* 忽略 */
      }
      return next
    })
    markDirtyRef.current?.()
  }

  // —— 布局存取（同 info_report：拖动只点亮，不自动覆盖）——
  /**
   * 一份「完整布局」快照：三个区的 dockview 排布 + 哪些区收起 + 两侧栏宽度。
   * 用户反馈「保存了（含收起主侧栏）再点恢复，主侧栏又自己打开了」——
   * 旧快照只存 dockview 的 JSON，收／宽另存两个键（REGIONS_KEY / SIDE_W_KEY），
   * 恢复时又硬把 hidden 清空，于是收起的侧栏一定被拉回来。
   */
  const snapshotAll = (): LayoutSnapshot | null => {
    const apis = apiRef.current
    if (!apis) return null
    const regions: Record<string, any> = {}
    REGIONS.forEach((r) => {
      regions[r] = apis[r].toJSON()
    })
    return { regions, hidden: [...hiddenRegions], sideW: { ...sideW } }
  }
  const saveLayout = useCallback(() => {
    const snap = snapshotAll()
    if (!snap) return
    try {
      window.localStorage.setItem(SAVED_KEY(project.id), JSON.stringify(snap))
      suppressDirtyRef.current = true
      setLayoutDirty(false)
      window.setTimeout(() => {
        suppressDirtyRef.current = false
      }, 400)
    } catch {
      /* 忽略 */
    }
  }, [project.id, hiddenRegions, sideW])
  const restoreDefaultLayout = useCallback(() => {
    const apis = apiRef.current
    if (!apis) return
    suppressDirtyRef.current = true
    let done = false
    let snap: LayoutSnapshot | null = null
    try {
      const raw = window.localStorage.getItem(SAVED_KEY(project.id))
      if (raw) {
        snap = normalizeSnapshot(JSON.parse(raw))
        if (snap) {
          REGIONS.forEach((r) => {
            if (snap?.regions?.[r]) apis[r].fromJSON(snap.regions[r], { reuseExistingPanels: true })
          })
          done = true
        }
      }
    } catch (e) {
      console.warn('[desk-dock] 默认布局恢复失败', e)
    }
    if (!done) {
      // 没有存过默认布局 → 回到内置摆位 + 全展开 + 默认宽度
      resetToBuiltinRef.current?.()
      applyRegions([])
      applySideW({ left: 220, right: 260 })
      setLayoutDirty(false)
      window.setTimeout(() => {
        suppressDirtyRef.current = false
      }, 500)
      return
    }
    // 隐藏与宽度也一起恢复（它们本来就算布局的一部分）
    applyRegions(snap?.hidden ?? [])
    if (snap?.sideW) applySideW(snap.sideW)
    setLayoutDirty(false)
    window.setTimeout(() => {
      suppressDirtyRef.current = false
    }, 500)
  }, [project.id, applyRegions, applySideW])

  // —— 皮肤 ——
  //    目录与 :root 变量写入都在 skins.ts（工作台 .ts-dock 与项目中心页读同一份变量，
  //    所以这里只需 setState 让开关态刷新）。
  const applySkin = useCallback((value: string) => {
    chooseSkin(value)
    setSkin(readSkinId())
  }, [])

  /**
   * 把浮动面板定位到触发按钮旁边（同 info_report 的 openWinMenu 思路）。
   *
   * 几何全在 chrome-position.ts 的 popPlacement()（纯函数，可自检）：
   *   · 顶置：右对齐按钮、挂在按钮下方 6px，**左右都夹在工作台内部** ——
   *     左侧按钮（项目切换器）原来会算出负值 → 被夹到页面 x=8，看着像弹到宿主
   *     侧边栏上去了（用户反馈），所以下限用工作台自身的左右边缘；
   *   · 侧置：挂在竖轨内侧，靠下的按钮（齿轮）改成**向上长** —— 照旧「按钮底 + 6」
   *     会把整块面板甩到屏幕外（info_report 踩过同一个坑）。
   * position 可显式传入：切换位置的瞬间 chromePos 还是旧值，必须按新位置算。
   */
  const placePop = (
    anchor: HTMLElement | null,
    width: number,
    position: ChromePosition = chromePos,
  ) => {
    setPopPos(
      popPlacement({
        chrome: position,
        anchor: anchor?.getBoundingClientRect() ?? null,
        dock: dockRootRef.current?.getBoundingClientRect() ?? null,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        width,
      }),
    )
  }

  /**
   * 切换标题栏位置（顶部 / 左侧 / 右侧）。
   *
   * 位置只是外观偏好（全局一份），但换完**必须重排开着的浮层**：齿轮从标题行右端
   * 变成竖轨最底部，旧坐标会把整块面板甩到屏幕外。宽度沿用打开时那套口径，
   * 免得切换后宽度跳一下。
   */
  const switchChrome = (next: ChromePosition) => {
    writeChromePosition(next)
    setChrome(next)
    const rail = effectiveChrome(next, narrow)
    window.requestAnimationFrame(() => {
      const panelW = (desktop: number) => (narrow ? Math.min(window.innerWidth - 20, 340) : desktop)
      if (settingsOpen) placePop(settingsBtnRef.current, panelW(238), rail)
      if (projOpen) placePop(projBtnRef.current, panelW(272), rail)
    })
  }

  /**
   * 项目清单的**悬浮开合**（用户要求「鼠标浮动就弹出，不一定需要点击」）。
   * 开：进按钮/面板后 110ms（防手滑）；关：离开后 260ms（够时间从按钮移到面板）。
   * 窄屏（触屏没有 hover）不启用，点击照旧可用。
   */
  const hoverProj = (open: boolean) => {
    if (narrow) return
    if (projHoverRef.current) window.clearTimeout(projHoverRef.current)
    projHoverRef.current = window.setTimeout(() => {
      projHoverRef.current = null
      if (open) {
        setSettingsOpen(false)
        placePop(projBtnRef.current, narrow ? Math.min(window.innerWidth - 20, 340) : 280)
        setProjOpen(true)
      } else {
        setProjOpen(false)
      }
    }, open ? 110 : 260)
  }

  /** 项目清单：只在面板打开时重读一次（用户可能刚在项目中心加/删项目）。 */
  const projectList = useMemo(() => (projOpen ? loadProjects() : []), [projOpen])
  /** 每个项目最近一次对话活动时间：切换列表按它倒序排（越新越靠前）。 */
  const projectLastActive = useProjectLastActivity(projectList)
  /**
   * 切换列表排序：按「最近对话更新时间」倒序（用户要求）。
   * 时间取宿主会话目录（lastPromptAt / updatedAt，与活跃点同口径）；
   * 没有任何对话的项目回退到项目自身 updatedAt，再回退 createdAt。
   */
  const sortedProjectList = useMemo(() => {
    const at = (p: ProjectRecord): number =>
      projectLastActive[p.id] || p.updatedAt || p.createdAt || 0
    return [...projectList].sort((a, b) => at(b) - at(a))
  }, [projectList, projectLastActive])
  /** 每个项目里「进行中 / 待确认」的对话（数据源与项目中心卡片上的 ①②③ 同源）。 */
  const projectActivity = useProjectsActivity(projectList)

  const allPaneIds = useMemo(() => {
    const ids: string[] = []
    KINDS.forEach((k) => {
      if (k === 'preview' && !data.devUrl) return
      ids.push(paneId(project.id, k))
    })
    explorers.forEach((s) => ids.push(paneId(project.id, `exp:${s.id}`)))
    return ids
  }, [explorers, data.devUrl, project.id])
  const openIds = liveIds.filter((id) => allPaneIds.includes(id))
  const closedIds = allPaneIds.filter((id) => !liveIds.includes(id))
  /**

  /**
   * 探索者状态角标：跑 / 刚出问题（notice）/ 有新汇报 / 安静。
   * 直接在 dockview 的**标签图标**上画一个小点（CSS ::after），方便一眼定位是哪位。
   */
  explorersRef.current = explorers
  const explorerBadges = useExplorerBadges(explorers, seenRef)
  badgesRef.current = explorerBadges
  /**
   * 把角标画到标签上。
   * ⚠️ dockview 会**自己重建标签 DOM**（不经过 React），重建后属性会丢 —— 所以：
   *   ① 建标签时（createTabComponent.init）也要画一次；
   *   ② 再挂一个 1.5s 的心跳兜底（十几个标签的 querySelectorAll，代价可忽略）。
   * 这就是「为什么不用 useEffect 一次性画完」的原因。
   */
  const paintBadges = useCallback(() => {
    const root = dockRootRef.current
    if (!root) return
    // init 时标签还没插进 DOM（closest('.dv-tab') 取不到），所以标记先落在内层 span 上，
    // 这里再往上找真正的 .dv-tab 挂状态属性（CSS ::after 画在 tab 的角上）。
    root.querySelectorAll<HTMLElement>('[data-ts-pane]').forEach((pin) => {
      const el = (pin.closest('.dv-tab') as HTMLElement | null) ?? pin
      const id = pin.getAttribute('data-ts-pane') || ''
      const m = /:exp:([^:]+)$/.exec(id)
      // ⚠️ 必须读 ref：paintBadges 的 deps 是空数组（要用最新那份快照，不能闭包住首帧的 {}）
      const snapshot = badgesRef.current as Record<string, { tone: string; unread: number } | undefined>
      const b = m ? snapshot[m[1]] : undefined
      if (!b || b.tone === 'idle') {
        el.removeAttribute('data-tone')
        el.removeAttribute('data-badge')
        el.removeAttribute('data-badgehint')
        return
      }
      el.setAttribute('data-tone', b.tone)
      el.setAttribute('data-badge', b.unread > 9 ? '9+' : String(b.unread || 0))
      el.setAttribute(
        'data-badgehint',
        b.tone === 'run' ? '正在运行' : b.tone === 'notice' ? '本轮异常结束（中断/截断）' : '有新的汇报，点开看看',
      )
    })
  }, [])
  /** 把最新角标快照写进去（deps 变化时 + 心跳兜底）。 */
  const paintRef = useRef(paintBadges)
  paintRef.current = paintBadges
  paintBadgesRef.current = paintBadges
  useEffect(() => {
    paintBadges()
    const t = window.setInterval(() => paintRef.current(), 1500)
    return () => window.clearInterval(t)
  }, [paintBadges, explorerBadges, liveIds, reloadKey])

  /** ensureById 在下面才定义：focusPane 通过 ref 调，避免「先用后声明」。 */
  const ensureByIdRef = useRef<((id: string) => void) | null>(null)
  /** 我们在窄屏下自动最大化的那个窗口 id（转回宽屏时只还原这一个，别动用户自己最大化的）。 */
  const autoMaxRef = useRef<string | null>(null)

  /**
   * 跳到某个窗口：没打开就打开；**窄屏下顺带最大化** ——
   * 手机上一次只看一个窗口才看得清（不然编辑区里几个窗口各占 100 多 px，读不了也点不准）。
   * 桌面端不加戏：只激活。
   */
  const focusPane = useCallback(
    (id: string) => {
      const apis = apiRef.current
      if (!apis) return
      if (!regionOf(id)) ensureByIdRef.current?.(id)
      const r = regionOf(id)
      const p = r ? apis[r].getPanel(id) : null
      if (!p) return
      p.api.setActive()
      if (narrow && r === 'center') {
        if (drawer) setDrawer(null)
        autoMaxRef.current = id
        try {
          p.api.maximize()
        } catch {
          /* 该版本不支持最大化：忽略 */
        }
      }
    },
    [regionOf, narrow, drawer],
  )

  /**
   * 窄屏默认「一个窗口占满编辑区」：进手机就把主对话最大化，
   * 不然默认布局里 主对话/协作对话/预览 会各分到一百多像素（实测手机端读不了）。
   * 只动我们自己最大化的那个：转回宽屏时还原。
   */
  useEffect(() => {
    const apis = apiRef.current
    if (!apis) return
    if (narrow) {
      const id = paneId(project.id, 'chat')
      const p = apis.center.getPanel(id)
      if (p && !p.api.isMaximized()) {
        autoMaxRef.current = id
        try {
          p.api.maximize()
        } catch {
          /* 忽略 */
        }
      }
    } else if (autoMaxRef.current) {
      const id = autoMaxRef.current
      autoMaxRef.current = null
      const r = regionOf(id)
      const p = r ? apis[r].getPanel(id) : null
      try {
        if (p?.api?.isMaximized?.()) p.api.exitMaximized()
      } catch {
        /* 忽略 */
      }
    }
  }, [narrow, project.id, regionOf, liveIds])

  /**
   * 全部停止探索者（用户要求）：主对话都结束了，探索者却还在跑。
   * 宿主 API：sessions.scope(id).get('conversation').cancel()（见 sessions.ts 的 stopSession）。
   */
  const stopAllExplorers = useCallback(async () => {
    const list = explorers.filter((e) => e.state === 'running')
    if (!list.length) {
      setStopNote('没有在运行的探索者')
      window.setTimeout(() => setStopNote(''), 2500)
      return
    }
    setStopNote(`正在停止 ${list.length} 个…`)
    const results = await Promise.all(list.map((e) => stopSession(e.id)))
    const okN = results.filter((r) => r.ok).length
    setStopNote(okN === list.length ? `已停止 ${okN} 个探索者` : `已停止 ${okN}/${list.length} 个（其余可能已自行结束）`)
    window.setTimeout(() => setStopNote(''), 4000)
    window.setTimeout(() => setReloadKey((k) => k + 1), 600)
  }, [explorers])
  stopAllExplorersRef.current = stopAllExplorers

  /** 恢复/打开一个面板（chips 与「全部打开」用）。 */
  const ensureById = useCallback(
    (id: string) => {
      const apis = apiRef.current
      if (!apis) return
      const cur = regionOf(id)
      if (cur) {
        apis[cur].getPanel(id)?.api.setActive()
        return
      }
      const kind = parsePaneId(id)?.kind ?? ''
      const region: Region = kind.startsWith('exp:') ? 'center' : (KIND_REGION[kind] ?? 'center')
      setHiddenRegions((h) => {
        const next = h.filter((r) => r !== region)
        try {
          window.localStorage.setItem(REGIONS_KEY(project.id), JSON.stringify(next))
        } catch {
          /* 忽略 */
        }
        return next
      })
      // 同上：参考面板必须在同一实例内（跨实例引用会抛错）
      const position = apis[region].panels.length
        ? { direction: 'within', referencePanel: String(apis[region].panels[0].id) }
        : undefined
      try {
        apis[region].addPanel(paneOptsRef.current(id, position))
      } catch {
        try {
          apis[region].addPanel(paneOptsRef.current(id))
        } catch (e2) {
          console.warn('[desk-dock] 面板恢复失败', id, e2)
        }
      }
    },
    [regionOf],
  )
  ensureByIdRef.current = ensureById

  const nodeFor = useCallback(
    (id: string): React.ReactNode => {
      const parsed = parsePaneId(id)
      if (!parsed) return null
      const { kind } = parsed
      if (kind === 'board') return <Blackboard workspace={project.path} />
      if (kind === 'talk') {
        // 协作对话标题行右侧给一个「全部停止」（用户要求：主对话都结束了，
        // 探索者还在跑，得能一句话全停掉）。停止结果就地显示在这条标题行里。
        return (
          <TalkColumn
            sessionId={sid}
            explorers={explorers}
            actions={
              <>
                {stopNote ? <span className="ts-talk-note">{stopNote}</span> : null}
                <button
                  className="ts-pop-all"
                  data-desk-stop-explorers=""
                  title="停止所有还在运行的探索者（主对话已结束时特别有用）"
                  onClick={() => void stopAllExplorers()}
                >
                  <span dangerouslySetInnerHTML={{ __html: iconSvg('stop', 13) }} />
                  全部停止
                </button>
              </>
            }
          />
        )
      }
      if (kind === 'save') return <SavingsColumn sessionId={sid} explorers={explorers} />
      if (kind === 'preview') {
        return (
          <PreviewPanel
            project={project}
            url={absoluteUrl(data.devUrl || '')}
            devRunning={data.devRunning}
            reloadKey={reloadKey}
            onReload={() => setReloadKey((n) => n + 1)}
          />
        )
      }
      if (kind === 'chat') {
        return (
          <div className="ts-dock-chatcell" data-desk-chat-cell={project.id} ref={chatCellRef}>
            <MainChat sessionId={sid} />
            {/* 底部渐变遮罩已删（会破坏背景一体性）：消息流自带 padding-bottom，
                内容不会滑到停靠输入条底下，不需要额外遮罩。 */}
          </div>
        )
      }
      if (kind.startsWith('exp:')) {
        const esid = kind.slice(4)
        const es = explorers.find((x) => x.id === esid)
        if (!es) return <div className="ts-dock-empty">探索者已结束</div>
        // 三键接到 dockview：最小化→隐藏面板 / 最大化→组最大化 / 关闭→关面板（可恢复）
        return (
          <ExplorerWindow
            session={es}
            label={explorerLabel(es)}
            collapsed={false}
            overlay={false}
            onCollapse={() => {
              const r = regionOf(id)
              if (r) apiRef.current?.[r]?.getPanel(id)?.api.setVisible(false)
            }}
            onOverlay={() => {
              const r = regionOf(id)
              const p = r ? apiRef.current?.[r]?.getPanel(id)?.api : null
              if (!p) return
              p.isMaximized() ? p.exitMaximized() : p.maximize()
            }}
            onExitOverlay={() => {
              const r = regionOf(id)
              if (r) apiRef.current?.[r]?.getPanel(id)?.api.exitMaximized()
            }}
            onHide={() => closePanel(id)}
          />
        )
      }
      return null
    },
    [project, sid, data, reloadKey, closePanel, regionOf, explorers],
  )
  return (
    <div
      ref={dockRootRef}
      className="ts-dock"
      data-desk-dock=""
      data-hide-left={hiddenRegions.includes('left') ? '' : undefined}
      data-hide-right={hiddenRegions.includes('right') ? '' : undefined}
      data-hide-center={hiddenRegions.includes('center') ? '' : undefined}
      data-chrome={chromePos}
      data-ts-drawer={drawer ?? undefined}
      style={{
        // 皮肤不在这里写：由 :root 的 --ts-skin-color / --ts-skin-bg 提供（skins.ts），
        // 这样工作台与项目中心读的是同一份、换皮肤也不用重挂组件。
        // 侧栏宽度可拖拽（同 info_report 的 --side-l / --side-r）。
        // **收起时必须不写这个内联变量**：内联优先级高于 .hide-* 里的 0px，
        // 不清就白收（info_report 的 showSide 里专门注释过这个坑）。
        // 收起时**不能**写这个内联变量：内联优先级高于 .hide-* 里的 0px，
        ...(hiddenRegions.includes('left') ? {} : { ['--ts-side-l' as any]: `${sideW.left}px` }),
        ...(hiddenRegions.includes('right') ? {} : { ['--ts-side-r' as any]: `${sideW.right}px` }),
      }}
    >
      <header className="ts-titlebar" data-desk-titlebar="">
        <div className="ts-title-left">
          {/* 项目名左侧的图标 = **项目切换按钮**（点它弹项目清单，可直接切到别的工作台） */}
          <button
            ref={projBtnRef}
            className="ts-title-switch"
            data-desk-projswitch=""
            data-open={projOpen ? '' : undefined}
            title="切换项目：列出「项目中心」里的全部项目，点一个即进它的工作台"
            onClick={() => {
              if (projHoverRef.current) window.clearTimeout(projHoverRef.current)
              const next = !projOpen
              if (next) {
                setSettingsOpen(false)
                // 窄屏：面板占满可用宽度（CSS 里 .ts-pop 在 ≤900px 时是 min(92vw,340px)）
                placePop(projBtnRef.current, narrow ? Math.min(window.innerWidth - 20, 340) : 272)
              }
              setProjOpen(next)
            }}
            onMouseEnter={() => hoverProj(true)}
            onMouseLeave={() => hoverProj(false)}
          >
            <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg('zone', 19) }} />
            <span className="ts-title-caret" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg('chevron', 13) }} />
          </button>
          {/* 竖轨里项目名是竖排、窄到头会省略号 —— 全名放 title 里截断也不丢信息 */}
          <span className="ts-title-proj" data-desk-title="" title={project.name}>
            {project.name}
          </span>
          {closedIds.length ? <span className="ts-sb-sep" aria-hidden="true" /> : null}
          {closedIds.slice(0, 6).map((id) => (
            <button
              key={id}
              className="ts-closed-chip"
              data-desk-reopen={id}
              onClick={() => ensureById(id)}
              title={`重新打开「${kindLabel(id)}」`}
            >
              ＋ {kindLabel(id)}
            </button>
          ))}
        </div>
        <div className="ts-title-right">
          {(['left', 'center', 'right'] as Region[]).map((r) => (
            <button
              key={r}
              className="ts-tg ts-tg--region"
              data-desk-region-toggle={r}
              data-on={regionShown(r) ? '1' : undefined}
              title={
                regionShown(r)
                  ? r === 'center'
                    ? `收起${REGION_LABEL[r]}`
                    : `关上${REGION_LABEL[r]}抽屉`
                  : `展开${REGION_LABEL[r]}`
              }
              onClick={() => toggleRegion(r)}
              dangerouslySetInnerHTML={{
                // 显示/隐藏**只看图标内部那块填充**（不用蓝色与外框，用户指定）
                __html: regionIconSvg(r, regionShown(r), 16),
              }}
            />
          ))}
          <span className="ts-tg-sep" aria-hidden="true" />
          {/* 探索者设置：恢复到右上角（用户要求），图标式触发 + 计数徽标 */}
          {/* 探索者设置：图标式触发 + 计数徽标。
              落点**与齿轮「设置」面板一字不差**（用户要求「照抄作业」）：同一个 popPlacement、
              同样的「按钮下方 6px、右缘对齐按钮、夹在工作台内」，竖轨模式同样从轨内侧向上长。
              不再自己算「夹进侧栏」那套 —— 那版会把侧栏盖住，反而更难看。 */}
          <ExplorerSettings
            variant="icon"
            place={(anchor, width) => popPlacement({
              chrome: chromePos,
              anchor,
              dock: dockRootRef.current?.getBoundingClientRect() ?? null,
              viewport: { width: window.innerWidth, height: window.innerHeight },
              width,
            })}
          />
          <span className="ts-tg-sep" aria-hidden="true" />
          {/* 右上角只剩一个「设置」齿轮：显示/隐藏窗口 + 标题栏位置 + 皮肤 + 字体都在它里面
              （用户要求把原来的 ⋯ 与皮肤两个按钮合成一个）。 */}
          <button
            ref={settingsBtnRef}
            className="ts-tg"
            data-desk-settings=""
            data-on={settingsOpen ? '1' : undefined}
            title="设置：窗口 · 标题栏 · 皮肤 · 字体"
            onClick={() => {
              const next = !settingsOpen
              if (next) {
                setProjOpen(false)
                placePop(settingsBtnRef.current, narrow ? Math.min(window.innerWidth - 20, 340) : 238)
              }
              setSettingsOpen(next)
            }}
            dangerouslySetInnerHTML={{ __html: iconSvg('gear', 16) }}
          />
        </div>
      </header>

      {/* 窄屏抽屉遮罩：点一下关上（触屏没有 hover，必须给个明确出路） */}
      {narrow && drawer ? (
        <div
          className="ts-drawer-mask"
          data-desk-drawer-mask=""
          aria-hidden="true"
          onClick={() => setDrawer(null)}
        />
      ) : null}

      <aside className="ts-region" data-region="left" aria-label="主侧栏">
        <div className="ts-region-host" ref={leftHostRef} data-desk-host="left" />
        {/* 把手在自身外侧（主侧栏的把手在它右边）：往里拖 = 加宽；拖到很窄即收起 */}
        <div
          className="ts-resizer ts-resizer--left"
          data-desk-resizer="left"
          onPointerDown={bindResizer('left')}
          /* 双击展开在 pointerdown 里自判（preventDefault 会吞掉 dblclick），此处不再挂 onDoubleClick */
          title="拖动调整主侧栏宽度（拖到最小即收起）；收起后可从边界拉出来，或双击直接打开"
        />
      </aside>
      <main className="ts-region" data-region="center" aria-label="编辑区 / 面板区">
        <div className="ts-region-host" ref={centerHostRef} data-desk-host="center" />
      </main>
      <aside className="ts-region" data-region="right" aria-label="辅助侧栏">
        <div className="ts-region-host" ref={rightHostRef} data-desk-host="right" />
        <div
          className="ts-resizer ts-resizer--right"
          data-desk-resizer="right"
          onPointerDown={bindResizer('right')}
          /* 双击展开在 pointerdown 里自判（preventDefault 会吞掉 dblclick），此处不再挂 onDoubleClick */
          title="拖动调整辅助侧栏宽度（往里拖变宽，拖到最小即收起）；收起后可双击直接打开"
        />
      </aside>

      <footer className="ts-statusbar" data-desk-statusbar="">
        <span className="ts-sb-group ts-sb-grow">
          {/* 实时对话提示：过程信息 / 完成信息（过长省略，完成时末尾标注） */}
          <span
            className="ts-sb-item"
            data-desk-live=""
            data-done={liveTip.done ? '1' : undefined}
            title={`${activeLabel} — ${liveTip.text}`}
          >
            <span className="ts-sb-dot" data-on={liveTip.done ? undefined : '1'} aria-hidden="true" />
            {liveTip.text}
          </span>
        </span>
        <span className="ts-sb-group ts-sb-group--right">
          {/* 历史会话 / 新建会话：放在「未锁定」左侧（用户指定位置） */}
          <SessionPicker
            sessions={sessions}
            currentId={sid}
            onPick={(id: string) => {
              if (id === sid) return
              rememberOpenedProject(id, project.id)
              if (!openSession(id)) setSessionError('切换会话失败：会话导航服务不可用')
            }}
            onNew={async () => {
              // 排除「当前这条会话」：startProjectSession 会复用该项目里已有的空白会话，
              // 若复用到的正是当前这条，导航到自身 = 什么都没发生（用户反馈的
              // 「点新建会话不能新建出来」）。把它排除掉，才会真正开出一条新对话。
              const res = await startProjectSession(project.path, project.id, sessionId || sid)
              if (res.ok) {
                setSessionError('')
                rememberOpenedProject(res.id, project.id)
              } else {
                setSessionError(`新建会话失败：${res.error}`)
              }
            }}
          />
          {sessionError ? (
            <span className="ts-sb-item" data-desk-session-error="" style={{ color: '#f85149' }}>
              {sessionError}
            </span>
          ) : null}
          <span className="ts-sb-sep" aria-hidden="true" />

          {/* 「未锁定 / 已锁定」按用户要求整个删掉（功能与显示都不留）。 */}
          <span className="ts-sb-sep" aria-hidden="true" />
          {/* 布局：一个按钮同时承载「保存 / 恢复默认」（用户要求把两个合成一个） */}
          <button
            className="ts-sb-btn"
            data-desk-layout=""
            data-dirty={layoutDirty ? '1' : undefined}
            onClick={() => saveLayout()}
            title={layoutDirty ? '布局已改动但还没保存 —— 点一下存为默认；右键/长按可恢复默认' : '把当前布局存为默认'}
          >
            <span dangerouslySetInnerHTML={{ __html: iconSvg('save', 13) }} />
            {layoutDirty ? '保存布局 ●' : '布局'}
          </button>
          <button
            className="ts-sb-btn"
            data-desk-layout-default=""
            onClick={restoreDefaultLayout}
            title="放弃改动，恢复默认布局"
          >
            <span dangerouslySetInnerHTML={{ __html: iconSvg('reset', 13) }} />
            恢复
          </button>
        </span>
      </footer>

      {/* 设置面板：四块 —— 显示/隐藏窗口 · 标题栏位置 · 皮肤 · 字体 */}
      {settingsOpen ? (
        <div
          className="ts-pop ts-set"
          data-desk-settings-panel=""
          style={popPos ?? { right: 12, top: 48 }}
        >
          {/* ① 显示 / 隐藏窗口 */}
          <div className="ts-set-block" data-desk-set-block="windows">
            <div className="ts-set-head">
              <span className="ts-set-title">显示 / 隐藏窗口</span>
              <button className="ts-pop-all" data-desk-open-all="" onClick={() => allPaneIds.forEach(ensureById)}>
                全部打开
              </button>
            </div>
            {allPaneIds.map((id) => {
              const cur = regionOf(id)
              return (
                <div className="ts-pop-item" key={id} data-desk-pop-row={id}>
                  <span dangerouslySetInnerHTML={{ __html: iconSvg(paneIcon(id), 14) }} />
                  {/* 名字可点 = 跳到这个窗口（手机上一眼只看得下一个窗口，靠这里切换） */}
                  <button
                    className="ts-pop-name ts-pop-name--jump"
                    data-desk-focus={id}
                    title={narrow ? `跳到「${kindLabel(id)}」（手机端会占满编辑区）` : `跳到「${kindLabel(id)}」`}
                    onClick={() => focusPane(id)}
                  >
                    {kindLabel(id)}
                  </button>
                  <span className="ts-pop-where">
                    {REGIONS.map((r) => (
                      <button
                        key={r}
                        className="ts-pop-region"
                        data-desk-move={id}
                        data-region={r}
                        data-on={cur === r ? '1' : undefined}
                        title={
                          cur === r
                            ? `收起「${kindLabel(id)}」`
                            : `把「${kindLabel(id)}」放到${REGION_LABEL[r]}${cur ? '（已在别处）' : ''}`
                        }
                        onClick={() => {
                          if (cur === r) closePanel(id)
                          else moveWindowTo(id, r)
                        }}
                        dangerouslySetInnerHTML={{ __html: iconSvg(REGION_ICON[r], 14) }}
                      />
                    ))}
                  </span>
                </div>
              )
            })}
          </div>

          {/* ② 标题栏位置：顶部横排 / 左侧窄轨 / 右侧窄轨。
              窄屏两侧栏是覆盖式抽屉，竖轨无从放置 → 整块不显示（偏好仍保留，回宽屏即生效）。 */}
          {narrow ? null : (
            <div className="ts-set-block" data-desk-set-block="chrome">
              <div className="ts-set-head">
                <span className="ts-set-title">标题栏</span>
                <span className="ts-set-hint">{CHROME_LABEL[chrome]}</span>
              </div>
              <div className="ts-set-row">
                <span className="ts-set-k">位置</span>
                <span className="ts-set-seg">
                  {CHROME_POSITIONS.map((p) => (
                    <button
                      key={p}
                      className="ts-set-opt"
                      data-desk-chrome={p}
                      data-on={chrome === p ? '1' : undefined}
                      title={CHROME_HINT[p]}
                      onClick={() => switchChrome(p)}
                    >
                      {CHROME_LABEL[p]}
                    </button>
                  ))}
                </span>
              </div>
            </div>
          )}

          {/* ③ 背景皮肤（分组 + 分类，参考 info_report 的皮肤目录；点了不关面板方便连着试） */}
          <div className="ts-set-block" data-desk-set-block="skin">
            {/* 标题行右侧直接显示「当前选了哪套 + 属于哪种主题」：皮肤现在覆盖整页，
                用户需要一眼确认到底生效的是哪一套（以前只有格子高亮，列表一长就看不见）。 */}
            <div className="ts-set-head">
              <span className="ts-set-title">背景皮肤</span>
              <span className="ts-set-hint" data-desk-skin-status="">
                {skin ? `${SKINS.find((s2) => s2.id === skin)?.label ?? skin} · ${skinMode === 'light' ? '浅色' : '深色'}主题` : '无皮肤'}
              </span>
            </div>
            {/* 列表限高 + 内部滚动：22 套皮排开会把下面的「字体」块顶出面板（实测皮肤块 695px、
                面板只有 415px，字体要滚很久才看得到）。限高后四块一眼都在。 */}
            <div className="ts-skin-scroll" data-desk-skin-scroll="">
              <button
                className="ts-skin-cell ts-skin-none"
                data-desk-skin="无"
                data-on={skin ? undefined : '1'}
                onClick={() => applySkin('')}
              >
                无皮肤
              </button>
              {SKIN_GROUPS.filter((g) => (skinMode === 'light' ? g.group.includes('浅色') : g.group.includes('深色'))).map((g) => (
                <div className="ts-skin-group" key={g.group}>
                  <span className="ts-skin-glabel">{g.group}</span>
                  <div className="ts-set-grid">
                    {g.items.map((s2) => (
                      <button
                        key={s2.id}
                        className="ts-skin-cell"
                        data-desk-skin={s2.label}
                        data-on={skin === s2.id ? '1' : undefined}
                        style={{ background: s2.image ?? s2.color ?? undefined }}
                        onClick={() => applySkin(s2.id)}
                      >
                        {s2.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* 一句说明：这套皮同时盖住四个 tab（对话/轨迹/项目中心/工作台）的整页。 */}
            <div className="ts-set-hint ts-skin-note">跟随系统深浅自动切换 · 四个页面一起生效</div>
          </div>

          {/* ④ 字体：字号档位 + 字族 */}
          <div className="ts-set-block" data-desk-set-block="font">
            <div className="ts-set-head">
              <span className="ts-set-title">字体</span>
              <span className="ts-set-hint">
                {FONT_LEVELS.find((f) => f.id === font)?.label} · {FONT_FAMILIES.find((f) => f.id === fontFamily)?.label}
              </span>
            </div>
            <div className="ts-set-row">
              <span className="ts-set-k">界面字号</span>
              <span className="ts-set-seg">
                {FONT_LEVELS.map((f) => (
                  <button
                    key={f.id}
                    className="ts-set-opt"
                    data-desk-font={f.id}
                    data-on={font === f.id ? '1' : undefined}
                    onClick={() => setFont(f.id)}
                  >{f.label}</button>
                ))}
              </span>
            </div>
            <div className="ts-set-row">
              <span className="ts-set-k">字族</span>
              <span className="ts-set-seg">
                {FONT_FAMILIES.map((f) => (
                  <button
                    key={f.id}
                    className="ts-set-opt"
                    data-desk-font-family={f.id}
                    data-on={fontFamily === f.id ? '1' : undefined}
                    onClick={() => setFontFamily(f.id)}
                  >{f.label}</button>
                ))}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* 项目切换浮层：列出「项目中心」里的全部项目，点一个直接进它的工作台 */}
      {projOpen ? (
        <div
          className="ts-pop ts-projsw"
          data-desk-projsw-panel=""
          style={popPos ?? { left: 12, top: 48 }}
          onMouseEnter={() => hoverProj(true)}
          onMouseLeave={() => hoverProj(false)}
        >
          <div className="ts-set-head">
            <span className="ts-set-title">切换项目</span>
            <span className="ts-set-hint">{projectList.length} 个 · 点一行进它的工作台</span>
          </div>
          <div className="ts-projsw-list">
            {sortedProjectList.map((p) => {
              const acts = projectActivity[p.id] || []
              const running = acts.filter((a) => a.state === 'active').length
              const pending = acts.filter((a) => a.state === 'pending').length
              const current = p.id === project.id
              return (
                <button
                  key={p.id}
                  className="ts-projsw-row"
                  data-desk-projsw-item={p.id}
                  data-on={current ? '1' : undefined}
                  data-busy={running ? '1' : undefined}
                  title={
                    `${p.name}\n${p.path}` +
                    (acts.length
                      ? `\n进行中对话（${acts.length}）：${acts.map((a) => `${a.order}. ${a.title}`).join('、')}`
                      : '\n暂无进行中对话')
                  }
                  onClick={() => {
                    setProjOpen(false)
                    if (!current) enterProjectWorkbench(p.id)
                  }}
                >
                  <span className="ts-projsw-top">
                    <span
                      className={`ts-projsw-dot${running ? ' is-run' : pending ? ' is-wait' : ''}`}
                      aria-hidden="true"
                    />
                    <span className="ts-projsw-name">{p.name}</span>
                    {current ? <span className="ts-projsw-cur">当前</span> : null}
                  </span>
                  <span className="ts-projsw-meta">{p.path}</span>
                  <span className="ts-projsw-tags">
                    {running ? <span className="ts-projsw-tag run">● 运行中 {running}</span> : null}
                    {pending && !running ? <span className="ts-projsw-tag wait">待确认 {pending}</span> : null}
                    {!running && !pending ? <span className="ts-projsw-tag idle">无进行中对话</span> : null}
                    <span className="ts-projsw-age">更新于 {relAge(p.updatedAt)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {Object.entries(containersRef.current).map(([id, el]) => {
        const node = nodeFor(id)
        return node ? createPortal(node, el, id) : null
      })}
    </div>
  )
}
