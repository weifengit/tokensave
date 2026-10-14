/**
 * 工作台的 dockview 外壳（Step 13 · 最终形态：参考 info_report 的多区布局）。
 *
 * 骨架（三个 dockview 实例 + 标题行 + 状态栏）：
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 标题行：[图标] 项目名 │ 已关闭 chips        │ 区域键 ⋯ 皮肤   │
 *   ├──────────┬──────────────────────────────┬─────────────────┤
 *   │ 主侧栏   │ 编辑区（预览/主对话/探索者）  │ 辅助侧栏        │
 *   │ dockview ├──────────────────────────────┤ dockview        │
 *   │          │ 面板区（黑板/协作对话/收益）  │                 │
 *   ├──────────┴──────────────────────────────┴─────────────────┤
 *   │ 状态栏：当前面板 · 面板数 · 锁 · 保存布局 · 默认布局        │
 *   └──────────────────────────────────────────────────────────────┘
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
import type { TelemetrySession } from './api'
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
import { enterProjectWorkbench } from './sessions'
import { ExplorerSettings } from './ExplorerSettings'
import { SessionPicker } from './SessionPicker'
import { loadProjects, rememberOpenedProject } from './store'
import { getClientContext, subscribeSession } from '../session-subscribe'
import { KINDS, paneId, parsePaneId, paneTitle, paneIcon, type Kind } from './desk-panes'
import type { ProjectRecord } from './store'

const SNAPSHOT_KEY = (projectId: string) => `tokensave:desk-dock.v2:${projectId}`
const SAVED_KEY = (projectId: string) => `tokensave:desk-saved.v2:${projectId}`
const REGIONS_KEY = 'tokensave:desk-regions.v1'
const SKIN_KEY = 'tokensave:desk-skin.v1'
/** 锁定状态**按项目分键**（用户反馈：A 项目锁了之后 B 项目也跟着锁 —— 那是旧全局单键的锅）。 */
const LOCK_KEY = (projectId: string) => `tokensave:desk-dock-lock.v1:${projectId}`
const LOCK_LEGACY_KEY = 'tokensave:desk-dock-lock.v1'
/** 界面字体与字族（外观设置，全局一份，同皮肤）。 */
const FONT_KEY = 'tokensave:desk-font.v1'
const FONT_FAMILY_KEY = 'tokensave:desk-font-family.v1'
/** 侧栏宽度与收起阈值（同 info_report：SIDE_MIN 180 / SIDE_MAX 720 / 收起 56）。
    拉出阈值从 18 收到 **12**：用户反馈「隐藏之后再拉出来有点迟钝」——少等 6px 才起步。 */
const SIDE_MIN = 180
const SIDE_MAX = 720
const COLLAPSE_W = 56
const PULL_OUT_W = 12
const SIDE_W_KEY = 'tokensave:desk-side-w.v1'
/** 早期版本遗留的存储键：挂载时一次性清理，不留孤儿。 */
const STALE_KEYS = ['tokensave:desk-open.v1', 'tokensave:desk-dock.v2', 'tokensave:desk-dock.v1']
const STALE_PREFIX = ['tokensave:desk-dock.v1:', 'tokensave:desk-saved.v1:']

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
  zone: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M3.5 14.5h17"/><path d="M9 4.5v15"/><path d="M15 4.5v15"/>',
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
.ts-dock { position: absolute; inset: 0; display: grid; grid-template-rows: 42px minmax(0,1fr) 26px; grid-template-columns: minmax(0,var(--ts-side-l,220px)) minmax(0,1fr) minmax(0,var(--ts-side-r,260px)); grid-template-areas: "title title title" "left center right" "status status status"; color: #e6e8eb; font-size:var(--ts-fs, 12.5px); font-family:var(--ts-font, inherit); background: transparent; }
.ts-dock[data-hide-left] { --ts-side-l: 0px; }
.ts-dock[data-hide-right] { --ts-side-r: 0px; }
/* 一体化：标题行不画分割线（同 info_report，区域之间不靠线条分界）。 */
.ts-titlebar { grid-area: title; display: flex; align-items: center; gap: 8px; padding: 0 8px; overflow: hidden; }
.ts-title-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; overflow: hidden; }
/* 项目名左侧那个图标现在是**项目切换按钮**（点击弹项目清单）。 */
.ts-title-switch { display: inline-flex; align-items: center; gap: 5px; flex: none; border: 1px solid transparent; border-radius: 7px; background: 0 0; color: #4f8ef7; cursor: pointer; padding: 2px 4px; }
.ts-title-switch:hover { background: rgba(127,127,127,.16); border-color: rgba(127,127,127,.28); }
.ts-title-switch .ts-title-caret { font-size:calc(var(--ts-fs, 12.5px) * 0.8); opacity: .65; }
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
.ts-resizer { position: absolute; top: 0; bottom: 0; width: 8px; z-index: 50; cursor: col-resize; touch-action: none; background: 0 0; }
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
.ts-dock[data-hide-left] .ts-region[data-region="left"] .ts-resizer { right: -5px; z-index: 51; }
.ts-dock[data-hide-right] .ts-region[data-region="right"] .ts-resizer { left: -5px; z-index: 51; }
/* ── 右上角「设置」浮层：三块（显示/隐藏窗口 · 皮肤 · 字体） ──────────── */
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
.ts-projsw-meta { color: #6b7280; font-size: calc(var(--ts-fs, 12.5px) * 0.82); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ts-set-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px 2px; }
.ts-set-title { font-size:calc(var(--ts-fs, 12.5px) * 0.88); font-weight: 600; color: #9aa4b2; letter-spacing: .02em; }
.ts-set-hint { font-size:calc(var(--ts-fs, 12.5px) * 0.84); color: #6b7280; }
.ts-set-grid { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 4px; }
.ts-set-row { display: flex; align-items: center; gap: 8px; padding: 3px 4px; }
.ts-set-k { flex: none; width: 62px; color: #9aa4b2; font-size:calc(var(--ts-fs, 12.5px) * 0.88); }
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
.ts-statusbar .ts-sb-grow { flex: 1; min-width: 0; }
/* 一体化：状态栏不画上边线；左侧实时提示与右侧会话控件之间留出空白（用户反馈贴太近）。 */
.ts-statusbar { grid-area: status; display: flex; align-items: center; gap: 10px; padding: 0 8px; font-size:calc(var(--ts-fs, 12.5px) * 0.92); color: #9aa4b2; overflow: hidden; }
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
/* 底部渐变：保留「消息滚到输入条上沿就看不见底下」的视觉，
   但把它放在聊天格底部（而不是像宿主那样跟着 seat 一起被搬走 → 那块就是黑覆盖）。 */
.ts-dock-fade { position: absolute; left: 0; right: 0; bottom: 0; height: calc(var(--ts-composer-h, 72px) + 18px); pointer-events: none; z-index: 30; background: linear-gradient(to top, rgba(21,21,23,.94) 0, rgba(21,21,23,.55) 44%, transparent 100%); }
.ts-dock-tabico { display: inline-flex; align-items: center; }
/* 拖动窗口期间：iframe 不吃指针事件。否则鼠标一进 iframe，父文档就再也收不到
   dragover/drop，dockview 的落点浮层在 iframe 上方不显示（预览面板是全插件唯一的 iframe，
   落点浮层恰好总在它上方）；松手后的实际搬运自 dragend 兜底，不受影响。 */
body.ts-dock-dragging iframe { pointer-events: none !important; }
.ts-dock-empty { position: absolute; inset: 0; display: grid; place-items: center; color: #6b7280; font-size:calc(var(--ts-fs, 12.5px) * 1.04); }
.ts-dock-watermark { color: #6b7280; font-size:calc(var(--ts-fs, 12.5px) * 0.96); }
.ts-pop { position: fixed; z-index: 80; right: auto; min-width: 268px; max-height: 72vh; overflow: auto; border: 1px solid rgba(127,127,127,.32); border-radius: 10px; background: rgba(14,16,21,.97); backdrop-filter: blur(8px); box-shadow: 0 16px 40px rgba(0,0,0,.5); padding: 6px; }
/* 旧版 ⋯ / 皮肤两个浮层已并入 .ts-set（.ts-pop-* 的通用部分保留） */
.ts-pop-item { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 7px; }
.ts-pop-item:hover { background: rgba(127,127,127,.12); }
.ts-pop-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ts-pop-where { display: flex; align-items: center; gap: 2px; flex: none; }
.ts-pop-region { width: 26px; height: 22px; display: grid; place-items: center; border: 1px solid transparent; border-radius: 5px; background: 0 0; color: inherit; cursor: pointer; padding: 0; }
.ts-pop-region:hover { background: rgba(127,127,127,.18); border-color: rgba(127,127,127,.3); }
.ts-pop-region[data-on] { color: #4f8ef7; border-color: rgba(79,142,247,.5); background: rgba(79,142,247,.15); }
.ts-pop-sep { height: 1px; background: rgba(127,127,127,.22); margin: 6px 4px; }
.ts-pop-btn { display: flex; width: 100%; align-items: center; gap: 6px; border: 0; border-radius: 7px; background: 0 0; color: inherit; font: inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.96); padding: 6px; cursor: pointer; text-align: left; }
.ts-pop-btn:hover { background: rgba(127,127,127,.14); }
/* 皮肤格子（现在是设置面板里的一个区块） */
.ts-skin-cell { flex: 1 1 46%; min-width: 96px; height: 40px; border: 1px solid rgba(127,127,127,.32); border-radius: 7px; background: rgba(127,127,127,.08); color: #e6e8eb; font: inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.92); cursor: pointer; }
.ts-skin-cell[data-on] { border-color: #4f8ef7; box-shadow: inset 0 0 0 1px rgba(79,142,247,.5); }
.dv-intel { background: transparent; }
.dv-intel .dv-dockview, .dv-intel .dv-groupview { background: transparent; border-radius: 0; }
.dv-intel .dv-tabs-and-actions-container { background: transparent !important; height: 33px; font-size:var(--ts-fs, 12.5px); }
.dv-intel .dv-tab { background: transparent !important; border-radius: 0 !important; }
.dv-intel .dv-tab.dv-active-tab { background: rgba(255,255,255,.06) !important; color: #e6e8eb !important; }
.dv-intel .dv-separator, .dv-intel .dv-sash { border-color: transparent !important; }
.dv-intel .dv-sash.dv-active-sash { background: #4f8ef7 !important; }
.dv-intel .dv-floating { box-shadow: 0 18px 48px rgba(0,0,0,.5); border: 1px solid #242b36; }
/* 窗口标签的右键菜单。
   为什么必须自己上样式：为了跳出面板链路的 overflow:hidden（否则菜单在区域边缘被裁掉），
   我们把它搬到了 document.body —— 于是 dockview 自己的 --dv-* 变量不再继承，
   菜单背景变透明、字体回退到 16px（用户反馈「看不清 / 字体太大」）。
   这里按搬出来后的形态把样式写死（等于把 info_report 的菜单外观固定下来）。 */
.dv-context-menu, .dv-context-menu-container { z-index: 120 !important; }
.dv-context-menu[data-ts-hoisted="1"] {
  min-width: 172px; padding: 5px; border-radius: 10px;
  background: rgba(14,16,21,.97); color: #e6e8eb;
  border: 1px solid rgba(127,127,127,.32);
  box-shadow: 0 16px 40px rgba(0,0,0,.5); backdrop-filter: blur(8px);
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
`

function installDockCss(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(DOCK_CSS_ID)) return
  const style = document.createElement('style')
  style.id = DOCK_CSS_ID
  style.textContent = DOCK_CSS
  document.head.appendChild(style)
}

/** 读本项目的锁定状态；首次读时把旧版那个全局单键迁过来（并清掉它，否则会继续影响别的项目）。 */
function readLocked(projectId: string): boolean {
  try {
    const per = window.localStorage.getItem(LOCK_KEY(projectId))
    if (per !== null) return per === '1'
    const legacy = window.localStorage.getItem(LOCK_LEGACY_KEY)
    if (legacy !== null) {
      window.localStorage.setItem(LOCK_KEY(projectId), legacy)
      window.localStorage.removeItem(LOCK_LEGACY_KEY)
      return legacy === '1'
    }
    return false
  } catch {
    return false
  }
}

function readHiddenRegions(): Region[] {
  try {
    const raw = window.localStorage.getItem(REGIONS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x: unknown): x is Region => (REGIONS as readonly string[]).includes(String(x)))
  } catch {
    return []
  }
}

function readSkin(): string {
  try {
    return window.localStorage.getItem(SKIN_KEY) ?? ''
  } catch {
    return ''
  }
}

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
applyFont(readFont(), readFontFamily())

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
  devUrl?: string
  devRunning?: boolean
}

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
  const closedRef = useRef<Set<string>>(new Set())
  const suppressDirtyRef = useRef(false)
  const resetToBuiltinRef = useRef<null | (() => void)>(null)
  const paneOptsRef = useRef<(id: string, position?: any) => any>(() => null)
  const [, bump] = useState(0)
  const [data, setData] = useState<ProjectData>({ explorers: [] })
  const [locked, setLocked] = useState(() => readLocked(project.id))
  const [font, setFont] = useState<FontId>(readFont)
  const [fontFamily, setFontFamily] = useState<FontFamilyId>(readFontFamily)
  const [liveIds, setLiveIds] = useState<string[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [hiddenRegions, setHiddenRegions] = useState<Region[]>(readHiddenRegions)
  const [layoutDirty, setLayoutDirty] = useState(false)
  const [skin, setSkin] = useState<string>(readSkin)
  /** 右上角「设置」面板（显示/隐藏窗口 + 皮肤 + 字体，三块合一）。 */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 标题行左侧「项目切换」面板。 */
  const [projOpen, setProjOpen] = useState(false)
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null)
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
      window.localStorage.setItem(REGIONS_KEY, JSON.stringify(hidden))
    } catch {
      /* 隐私模式：仅本次会话有效 */
    }
  }, [])
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
      const next: ProjectData = { explorers: [] }
      try {
        next.explorers = await fetchExplorers(project.path)
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
    },
    [regionOf],
  )

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
          window.localStorage.setItem(REGIONS_KEY, JSON.stringify(next))
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
      closedRef.current.delete(id)
      bump((n) => n + 1)
    }
    const unregister = (id: string, el: HTMLElement) => {
      if (containersRef.current[id] === el) {
        delete containersRef.current[id]
        closedRef.current.add(id)
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
      disableDnd: readLocked(project.id),
      getTabContextMenuItems: ({ panel, group }: any) => [
        { label: '关闭', action: () => panel.api.close() },
        { label: '关闭其他', action: () => group.panels.slice().forEach((p: any) => p !== panel && p.api.close()) },
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
     * 主对话卡「看不见」时把宿主输入条整条藏掉（同 ts-hdesk-nochat 口径）。
     * 看不见有两种：面板被关，或它和别人同组但被别人挡在后面（例如把预览拖进主对话那一组）。
     * 不藏的话，那条 position:fixed 的输入条会悬在别的窗口上面（实测：盖在预览上）。
     */
    const syncChatSeat = () => {
      const p = apis.center.getPanel(paneId(project.id, 'chat'))
      const shown = !!p && p.api?.isVisible !== false
      document.body.classList.toggle('ts-desk-nochat', !shown)
    }
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
          if (p?.id) setActiveLabel(kindLabel(String(p.id)))
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
    }

    return () => {
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
    data.explorers.forEach((s) => ensure(paneId(project.id, `exp:${s.id}`)))
    // 探索者消失 → 移除其面板；其余面板若被用户关掉，交由 chips / ⋯ 菜单恢复
    const wanted = new Set<string>(
      data.explorers.map((s) => paneId(project.id, `exp:${s.id}`)),
    )
    Object.keys(containersRef.current).forEach((id) => {
      if (id.startsWith(`${project.id}:exp:`) && !wanted.has(id)) {
        const r = regionOf(id)
        if (r) apis[r].removePanel(apis[r].getPanel(id))
      }
    })
  }, [data, hiddenRegions, project.id, regionOf])

  // —— 输入条停靠进「DSH 主对话」面板 ——
  const chatPaneId = paneId(project.id, 'chat')
  useDockNativeComposer(chatCellRef, liveIds.includes(chatPaneId), false, [liveIds.join(','), reloadKey])

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
  //   拖到 COLLAPSE_W(56) 以下整条收起；收起后从窄缝往里拉过 PULL_OUT_W(18) 重新展开。
  //   两侧把手都在自己那条边的外侧，所以往里拖才是加宽（delta 按方向取反）。
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
        event.preventDefault()
        const el = event.currentTarget
        const root = dockRootRef.current
        if (!root) return
        const varName = side === 'left' ? '--ts-side-l' : '--ts-side-r'
        const attr = side === 'left' ? 'data-hide-left' : 'data-hide-right'
        const dir = side === 'left' ? 1 : -1
        let start = event.clientX
        let hidden = hiddenRegions.includes(side)
        let from = hidden ? 0 : sideW[side]
        /** 本次拖动的**最终**宽度（落盘用；旧实现写的是起始值，拖完一刷新又回到旧宽度）。 */
        let to = from
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
          const delta = (x - start) * dir
          if (hidden) {
            if (delta < PULL_OUT_W) return
            // 拉出来必须重新锚定：否则当前宽度就是十几像素，立刻又低于阈值（实测踩过）
            hidden = false
            from = SIDE_MIN
            to = SIDE_MIN
            start = x
            apply()
            return
          }
          const w = from + delta
          if (w < COLLAPSE_W) {
            hidden = true
            apply()
            return
          }
          to = Math.max(SIDE_MIN, Math.min(SIDE_MAX, w))
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
          applySideW({ ...sideW, [side]: to })
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

  // 宽度变化落盘（拖拽中不写盘，松手已处理；这里兜住键盘/程序化调整）
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDE_W_KEY, JSON.stringify(sideW))
    } catch {
      /* 忽略 */
    }
  }, [sideW])

  // —— 区域开关（同 info_report 的 hide-left / hide-panel / hide-right）——
  const toggleRegion = (region: Region) => {
    setHiddenRegions((prev) => {
      const next = prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region]
      try {
        window.localStorage.setItem(REGIONS_KEY, JSON.stringify(next))
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
  const applySkin = useCallback((value: string) => {
    setSkin(value)
    try {
      if (value) window.localStorage.setItem(SKIN_KEY, value)
      else window.localStorage.removeItem(SKIN_KEY)
    } catch {
      /* 忽略 */
    }
  }, [])

  /** 把浮动面板定位到触发按钮下方、右边缘对齐（同 info_report 的 openWinMenu 思路）。 */
  const placePop = (anchor: HTMLElement | null, width: number) => {
    const r = anchor?.getBoundingClientRect()
    const left = r ? Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) : window.innerWidth - width - 12
    const top = r ? r.bottom + 6 : 48
    setPopPos({ left, top })
  }

  const allPaneIds = useMemo(() => {
    const ids: string[] = []
    KINDS.forEach((k) => {
      if (k === 'preview' && !data.devUrl) return
      ids.push(paneId(project.id, k))
    })
    data.explorers.forEach((s) => ids.push(paneId(project.id, `exp:${s.id}`)))
    return ids
  }, [data, project.id])
  const openIds = liveIds.filter((id) => allPaneIds.includes(id))
  const closedIds = allPaneIds.filter((id) => !liveIds.includes(id))

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
          window.localStorage.setItem(REGIONS_KEY, JSON.stringify(next))
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

  const nodeFor = useCallback(
    (id: string): React.ReactNode => {
      const parsed = parsePaneId(id)
      if (!parsed) return null
      const { kind } = parsed
      if (kind === 'board') return <Blackboard workspace={project.path} />
      if (kind === 'talk') return <TalkColumn sessionId={sid} explorers={data.explorers} />
      if (kind === 'save') return <SavingsColumn sessionId={sid} explorers={data.explorers} />
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
            {/* 底部渐变：消息滚到停靠输入条上沿时被遮住（等价于宿主 composerSeat 的
                渐变遮罩，但位置正确 —— 贴在聊天格底部，不跟着输入条搬走）。 */}
            <div className="ts-dock-fade" data-desk-chat-fade="" aria-hidden="true" />
          </div>
        )
      }
      if (kind.startsWith('exp:')) {
        const esid = kind.slice(4)
        const es = data.explorers.find((x) => x.id === esid)
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
    [project, sid, data, reloadKey, closePanel, regionOf],
  )

  return (
    <div
      ref={dockRootRef}
      className="ts-dock"
      data-desk-dock=""
      data-hide-left={hiddenRegions.includes('left') ? '' : undefined}
      data-hide-right={hiddenRegions.includes('right') ? '' : undefined}
      style={{
        ...(skin ? { background: skin } : {}),
        // 侧栏宽度可拖拽（同 info_report 的 --side-l / --side-r）。
        // **收起时必须不写这个内联变量**：内联优先级高于 .hide-* 里的 0px，
        // 不清就白收（info_report 的 showSide 里专门注释过这个坑）。
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
            title="切换项目：列出「项目中心」里的全部项目，点一个即进它的工作台"
            onClick={() => {
              const next = !projOpen
              if (next) {
                setSettingsOpen(false)
                placePop(projBtnRef.current, 272)
              }
              setProjOpen(next)
            }}
          >
            <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg('zone', 19) }} />
            <span className="ts-title-caret" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg('chevron', 13) }} />
          </button>
          <span className="ts-title-proj" data-desk-title="">
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
              data-on={hiddenRegions.includes(r) ? undefined : '1'}
              title={hiddenRegions.includes(r) ? `展开${REGION_LABEL[r]}` : `收起${REGION_LABEL[r]}`}
              onClick={() => toggleRegion(r)}
              dangerouslySetInnerHTML={{
                // 显示/隐藏**只看图标内部那块填充**（不用蓝色与外框，用户指定）
                __html: regionIconSvg(r, !hiddenRegions.includes(r), 16),
              }}
            />
          ))}
          <span className="ts-tg-sep" aria-hidden="true" />
          {/* 探索者设置：恢复到右上角（用户要求），图标式触发 + 计数徽标 */}
          <ExplorerSettings variant="icon" />
          <span className="ts-tg-sep" aria-hidden="true" />
          {/* 右上角只剩一个「设置」齿轮：显示/隐藏窗口 + 皮肤 + 字体三块都在它里面
              （用户要求把原来的 ⋯ 与皮肤两个按钮合成一个）。 */}
          <button
            ref={settingsBtnRef}
            className="ts-tg"
            data-desk-settings=""
            data-on={settingsOpen ? '1' : undefined}
            title="设置：显示/隐藏窗口 · 皮肤 · 字体"
            onClick={() => {
              const next = !settingsOpen
              if (next) {
                setProjOpen(false)
                placePop(settingsBtnRef.current, 238)
              }
              setSettingsOpen(next)
            }}
            dangerouslySetInnerHTML={{ __html: iconSvg('gear', 16) }}
          />
        </div>
      </header>

      <aside className="ts-region" data-region="left" aria-label="主侧栏">
        <div className="ts-region-host" ref={leftHostRef} data-desk-host="left" />
        {/* 把手在自身外侧（主侧栏的把手在它右边）：往里拖 = 加宽；拖到很窄即收起 */}
        <div
          className="ts-resizer ts-resizer--left"
          data-desk-resizer="left"
          onPointerDown={bindResizer('left')}
          title="拖动调整主侧栏宽度（拖到很窄即收起，收起后从这里拉出来）"
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
          title="拖动调整辅助侧栏宽度（往里拖变宽；拖到很窄即收起）"
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

          <button
            className="ts-sb-btn"
            data-desk-lock=""
            title="锁定后不能拖动面板 / 分隔条（每个项目各自记忆）"
            onClick={() => {
              const next = !locked
              setLocked(next)
              REGIONS.forEach((r) => apiRef.current?.[r]?.updateOptions({ disableDnd: next }))
              try {
                window.localStorage.setItem(LOCK_KEY(project.id), next ? '1' : '0')
              } catch {
                /* 忽略 */
              }
            }}
          >
            <span dangerouslySetInnerHTML={{ __html: iconSvg(locked ? 'lock' : 'unlock', 13) }} />
            {locked ? '已锁定' : '未锁定'}
          </button>
          <span className="ts-sb-sep" aria-hidden="true" />
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

      {/* 设置面板：三块 —— 显示/隐藏窗口 · 皮肤 · 字体 */}
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
                  <span className="ts-pop-name">{kindLabel(id)}</span>
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

          {/* ② 背景皮肤（点了不关面板：方便连着试几套） */}
          <div className="ts-set-block" data-desk-set-block="skin">
            <div className="ts-set-head"><span className="ts-set-title">背景皮肤</span></div>
            <div className="ts-set-grid">
              {[
                { id: '', label: '无' },
                { id: 'linear-gradient(135deg,#0b0e14,#141922)', label: '深蓝' },
                { id: 'linear-gradient(135deg,#0e1a14,#141922)', label: '墨绿' },
                { id: 'linear-gradient(135deg,#1a0e14,#141922)', label: '暗红' },
                { id: 'radial-gradient(circle at 30% 20%,#1a2029,#0b0e14)', label: '光晕' },
              ].map((s2) => (
                <button
                  key={s2.label}
                  className="ts-skin-cell"
                  data-desk-skin={s2.label}
                  data-on={skin === s2.id ? '1' : undefined}
                  style={s2.id ? { background: s2.id } : undefined}
                  onClick={() => applySkin(s2.id)}
                >
                  {s2.label}
                </button>
              ))}
            </div>
          </div>

          {/* ③ 字体：字号档位 + 字族 */}
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
        >
          <div className="ts-set-head">
            <span className="ts-set-title">切换项目</span>
            <span className="ts-set-hint">{loadProjects().length} 个</span>
          </div>
          <div className="ts-projsw-list">
            {loadProjects().map((p) => (
              <button
                key={p.id}
                className="ts-projsw-row"
                data-desk-projsw-item={p.id}
                data-on={p.id === project.id ? '1' : undefined}
                title={p.path}
                onClick={() => {
                  setProjOpen(false)
                  if (p.id !== project.id) enterProjectWorkbench(p.id)
                }}
              >
                <span className="ts-projsw-top">
                  <span className="ts-projsw-name">{p.name}</span>
                  {p.id === project.id ? <span className="ts-projsw-cur">当前</span> : null}
                </span>
                <span className="ts-projsw-meta">{p.path}</span>
                <span className="ts-projsw-meta">更新于 {relAge(p.updatedAt)}</span>
              </button>
            ))}
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
