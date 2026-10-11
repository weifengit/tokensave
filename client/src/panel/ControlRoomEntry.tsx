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
 * 行为：**切换**语义（用户要求保留），两个方向都走 openControlRoom：
 *   - 当前在「项目中心」（项目列表）→ 点一下回「工作台」；
 *   - 当前在「工作台」→ 点一下回「项目中心」。
 * 当前在哪一屏由 getControlRoomScreen() 给出：ControlRoom（工作台）上报 'desk'，
 * ProjectCenter（项目列表）上报 'list'。
 *
 * 视觉沿用侧边栏底部的紧凑样式：wide 时「图标 + 文字」，rail 时只有图标。
 *
 * 呼吸灯（用户要求）：入口右侧（wide）/ 顶替图标（rail）显示存活指示小圆点——
 *   - 任何已登记项目下有对话存活（跑 / 待确认 / 上一轮没正常结束 / 未读的正常结束）
 *     才显示；全部完成时**不显示**，rail 回落成原来的图标；
 *   - 绿 = 正常使用；黄 = 弹选择框 / 被故障中断（黄覆盖绿）；
 *   - 有对话正在跑 → 依次闪烁（跑马灯）；只有待处理时 → 同相呼吸。
 *   状态来源见 pulse.ts（含成本说明）。
 *
 * 两个角标 → **同一个面板**（2026-10 修订：用户要求「取代」旧的浮动面板）：
 *   1. **黄角标**：`warn > 0` 时圆点旁的计数角标 —— 需处理的对话数（待确认 / 上一轮未正常结束）；
 *   2. **蓝角标**：`done.length > 0` 时未读的正常结束数。
 *   点任一个都打开同一块跑马灯面板并**钉住**（不因鼠标移开而消失，好让你逐条点按钮）；
 *   再点一下 / 按 Esc / 点面板外面收起。旧的「点角标→只弹清单」的第二个浮层
 *   与它那套 CSS 已整体删除，现在只有一块面板。
 *
 * 面板内容（自上而下）：提示音设置 → 自动继续设置 → 对话清单。
 * 三块同宽（宽度由 panelWidth 固定），且说明文字全部收进 title 悬浮提示。
 *
 * 已读标注写 localStorage（跨刷新、同源多标签共享），同一轮不会重复提醒，
 * 新的一轮 / 新的待确认会话期会重新提醒；点条目跳转**不再**顺手标已读
 *（那属于误操作高发设计）—— 要标已读就点行内的「已读」。
 *
 * 浮层 portal 到 body + position:fixed → rail（56px 收起态）与展开态都从按钮
 * 右缘飞出，不受侧边栏宽度 / overflow 裁剪影响（Step 24 下拉被裁的教训）。
 * 主按钮的「切换」语义不受影响：点角标都 stopPropagation。
 */
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  enterProjectWorkbench, getLiveScreen, onRequestProjectList, onRequestWorkbench, openControlRoom,
  sendToSession,
} from './sessions'
import { markPulseRead, useActivityPulse, type InterruptKind } from './pulse'
import {
  DURATION_OPTIONS, SOUND_OPTIONS, getSoundSettings, initSoundBridge, playRole,
  setSoundSettings, stopSound, subscribePlaying,
} from './sound'
import type { SoundDuration, SoundId, SoundSettings } from './sound'
import {
  decideContinue, getContinueSettings, setContinueSettings, shortInterruptLabel,
  subscribeContinueSettings, type ContinueSettings,
} from './continue-policy'
import {
  autoStateOf, noteManualContinue, subscribeAutoContinue,
} from './auto-continue'
import { panelWidthFor, type WidthRow } from './panel-width'
import {
  HOVER_CLOSE_MS, boxOf, zoneOf, type PointerZone,
} from './hover-corridor'

/** 圆点数量（用户要求 3 个）。 */
const DOT_COUNT = 3
/** 收起态按钮宽度低于该值时，3 个点确实挤不下 → 降为 2 个（展开态沿用同一数量，保持一致）。 */
const RAIL_MIN_WIDE = 30
/**
 * 点击后的“导航在途”窗口：宿主切 tab 是异步的，这段时间内忽略重复点击。
 * 与 sessions.ts 的 NAV_SETTLE_MS 同量级（略短），避免两个窗口错位。
 */
const NAV_LOCK_MS = 700
/** 面板高度预算：低于下限就只剩标题（宁可溢一点），上限是不想让它占满整屏 */
const POP_H_MIN = 200
const POP_H_MAX = 720
/**
 * 关闭倒计时的续期上限：指针在「走廊」（触发器与面板之间那道缝）里时
 * 允许续期几次。给慢速/斜向移动留余地，但不允许在缝里停一辈子不消失。
 * 420ms × 4 ≈ 1.7s 的窗口，足够把鼠标挪过去了。
 */
const RENEW_MAX = 4
/**
 * 面板宽度：跟着**清单里最长的那条**走（策略在 panel-width.ts，纯函数可单测）。
 * 这里只做一层薄包装，把「窗口剩余空间」也算进去。
 */
function panelWidth(left: number, rows: readonly WidthRow[]): number {
  return panelWidthFor(rows, left)
}

/**
 * 区域标题行（用户要求：三个区域都像「对话清单」那样有自己的标题行）。
 * 三个区域（提示音 / 自动继续 / 对话清单）共用同一个标题行排版。
 */
function SectionHead({ title, note, children }: {
  title: string
  /** 标题右侧的浅色小字（计数之类） */
  note?: string
  /** 最右侧的操作（如「全部已读」） */
  children?: React.ReactNode
}) {
  return (
    <div className="ts-sec-head">
      <span className="ts-sec-title">{title}</span>
      {note && <span className="ts-sec-note">{note}</span>}
      {children}
    </div>
  )
}

/**
 * 按钮所在**侧边栏容器**的右缘：面板要从容器右缘起飞，而不是按钮右缘——
 * 按钮四周有内边距（实测 13px），只按按钮算会让面板钻到侧边栏底下被盖住。
 * 只在「不宽于视口一半」的祖先里取最大右缘（更宽的那个就是主内容区了）。
 */
function sidebarRightOf(btn: HTMLElement): number {
  const limit = window.innerWidth * 0.5
  let best = btn.getBoundingClientRect().right
  let el: HTMLElement | null = btn.parentElement
  while (el && el !== document.body && el !== document.documentElement) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.width <= limit && r.right > best) best = r.right
    el = el.parentElement
  }
  return best
}
/** 黄灯清单里「继续」按钮直接发出去的原文（宿主 max-tokens 提示就是让用户发「继续」） */
const CONTINUE_TEXT = '继续'


/** 浮层里的一行（活跃/需要处理/已完成共用结构）。 */
interface PopItem {
  /** 已读标注键（markPulseRead 用） */
  key: string
  sessionId: string
  projectId: string
  icon: string
  title: string
  sub: string
  /** 项目身份（给胶囊配色用：id 优先，退回项目名） */
  projectKey: string
  /** 是否给「继续」按钮（只有上一轮没正常结束的那类才有意义） */
  canContinue: boolean
  /** 中断类型（仅 kind='failed' 时有值） */
  interruptKind?: InterruptKind
  /** 是否为待确认类型 */
  isPending?: boolean
  /** 「继续」按钮的提示文案（分类器给的原因，如「余额不足：重试不会成功」） */
  continueHint?: string
  /** 中断原因的短标签（项目胶囊后面那个小胶囊，如「截断」「余额」） */
  shortReason?: string
  /** 最近一次人发正常消息的时间（Unix ms），用于算「距上次发言过了多久」 */
  lastPromptAt?: number
}



/**
 * 项目胶囊配色：按项目 id/名称稳定散列出一个色相 —— 同项目永远同色、不同项目不同色。
 * 分开给 bg / 边框 / 字色，深色底上既够亮又不抢标题的注意力。
 */
function pillStyle(key: string): React.CSSProperties {
  if (!key) return {}
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return {
    background: `hsla(${h},70%,55%,.18)`,
    borderColor: `hsla(${h},70%,60%,.5)`,
    color: `hsl(${h},72%,80%)`,
  }
}

/**
 * 存活指示圆点（呼吸 / 跑马灯，绿或黄）。“正常结束”已改成**蓝色计数角标**（与黄角标
 * 同款、显示未读条数），不再占用第 3 个点——3 个点回归纯粹的“活跃指示”。
 * 悬停在圆点上 → 打开「对话清单」悬浮面板（项目 + 标题、可点击跳转）——原生 title 点不了，
 * 所以这里用自绘面板取代它。
 */
function PulseDots({
  tone, running, count, onHoverIn, onHoverOut,
}: {
  tone: 'ok' | 'warn'
  running: boolean
  count: number
  onHoverIn?: () => void
  onHoverOut?: () => void
}) {
  return (
    <span
      className={`ts-pulse${running ? ' ts-pulse-run' : ''}${tone === 'warn' ? ' ts-pulse-warn' : ''}`}
      aria-hidden="true"
      onMouseEnter={onHoverIn}
      onMouseLeave={onHoverOut}
    >
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className="ts-pulse-dot" style={{ animationDelay: `${i * 0.16}s` }} />
      ))}
    </span>
  )
}

/**
 * 自动继续设置区（含自己的标题行 —— 主开关就放在标题行右侧）。
 *
 * 布局（用户要求）：
 *   标题行：左侧「自动继续」，右侧**主开关**（总开关从原来的第一行挪上来）
 *   第二行：三个子开关（分类 / 截断 / 瞬时），用一张 card 包住
 *   第三行：发送上限 / 冷却基数 两个输入框，同卡片内
 *
 * 说明文字一律走 title 悬浮提示，面板里不出现解释段。
 */
function ContinueSettingsBlock() {
  const [s, setS] = useState<ContinueSettings>(() => getContinueSettings())
  useEffect(() => subscribeContinueSettings(() => setS(getContinueSettings())), [])
  const update = (patch: Partial<ContinueSettings>) => setS(setContinueSettings(patch))

  return (
    <>
      <SectionHead title="自动继续">
        <button
          type="button"
          className={`ts-cont-sw${s.enabled ? ' on' : ''}`}
          title={s.enabled
            ? '自动继续：已开启（可恢复的中断会自动发「继续」）\n点击关闭：只保留手动「继续」按钮'
            : '自动继续：已关闭（不会自动发任何消息）\n点击开启：可恢复的中断自动继续'}
          role="switch"
          aria-checked={s.enabled}
          onClick={() => update({ enabled: !s.enabled })}
        >
          <i />
        </button>
      </SectionHead>

      <div className="ts-cont-block">
        {/* 第二·三行用**一张** card 包住（与提示音区同构：一张卡装多行子内容） */}
        <div className="ts-box">
          {/* 第二行：三个子开关 —— 等距分布（首项左缘对齐「发送上限」，末项右缘对齐「秒」） */}
          <div className="ts-box-row ts-cont-sw-row">
            <div className="ts-cont-sw-item">
              <label title="错误分类：开启后，鉴权 / 余额 / 未知模型 / 上下文超长这类重试也不会成功的错误会被识别出来，不自动重试，只给手动按钮">分类</label>
              <button
                type="button"
                className={`ts-cont-sw${s.classify ? ' on' : ''}`}
                title={s.classify
                  ? '错误分类：已开启\n永久性错误（鉴权/余额/模型/上下文）不自动重试；瞬时错误（网络/超时/5xx/429）才自动重试'
                  : '错误分类：已关闭\n所有错误都当作可重试，包括重试也不会成功的那些'}
                role="switch"
                aria-checked={s.classify}
                onClick={() => update({ classify: !s.classify })}
              >
                <i />
              </button>
            </div>
            <div className="ts-cont-sw-item">
              <label title="输出达到长度上限被截断时，自动发「继续」让模型接着写（推荐开启：这轮没写完，接着写就行）">截断</label>
              <button
                type="button"
                className={`ts-cont-sw${s.autoMaxTokens ? ' on' : ''}`}
                title={s.autoMaxTokens
                  ? '截断时自动继续：已开启\n输出达到长度上限时自动接着写'
                  : '截断时自动继续：已关闭\n输出被截断时只给手动「继续」按钮'}
                role="switch"
                aria-checked={s.autoMaxTokens}
                onClick={() => update({ autoMaxTokens: !s.autoMaxTokens })}
              >
                <i />
              </button>
            </div>
            <div className="ts-cont-sw-item">
              <label title="瞬时故障：网络抖动 / 超时 / 5xx / 429 限流这类等一下重试就能好的错误，自动重试">瞬时</label>
              <button
                type="button"
                className={`ts-cont-sw${s.autoTransient ? ' on' : ''}`}
                title={s.autoTransient
                  ? '瞬时故障自动重试：已开启\n网络/超时/5xx/429 会按冷却时间自动重试'
                  : '瞬时故障自动重试：已关闭\n瞬时故障也只给手动「继续」按钮'}
                role="switch"
                aria-checked={s.autoTransient}
                onClick={() => update({ autoTransient: !s.autoTransient })}
              >
                <i />
              </button>
            </div>

          </div>

          {/* 第三行：两个数值输入 */}
          <div className="ts-box-row">
          <label title="发送上限：连续自动继续几次后就停下来等你介入（用户自己发消息或手动点「继续」会重置这个计数）">发送上限</label>
          <input
            className="ts-cont-num"
            type="number"
            min={1}
            max={20}
            value={s.maxConsecutive}
            title="连续自动继续几次后停下来等你介入（1–20）"
            onChange={(e) => update({ maxConsecutive: Number(e.target.value) })}
          />
          <span className="ts-cont-unit">次</span>
          <span className="ts-cont-gap" />
          <label title="冷却基数：两次自动继续之间至少等这么久；连续失败会按倍数递增（20s → 40s → 80s…），封顶 5 分钟。避免把已经坏了的上游打得更死">冷却基数</label>
          <input
            className="ts-cont-num"
            type="number"
            min={0}
            max={600}
            value={Math.round(s.cooldownMs / 1000)}
            title="两次自动继续之间的最小间隔（秒），连续失败按倍数递增"
            onChange={(e) => update({ cooldownMs: Number(e.target.value) * 1000 })}
          />
          <span className="ts-cont-unit">秒</span>
        </div>
        </div>
      </div>
    </>
  )
}

/**
 * 跑马灯悬浮面板：一个列表 + 两块设置（提示音 / 自动继续）。
 *
 * 设计约束（本次修订集中在这里）：
 *   - **没有标签页**：一条对话是活跃/需处理/已完成，看行首图标就知道（● / ⏳⚠️ / ✅），
 *     再分三个 tab 是重复信息，还把本来就能一眼看完的清单拆成三次点击；
 *   - **宽度必须固定在一个区间**：内容（长标题 / 长原因）不能把面板撐宽 →
 *     所有可变长文本一律 `min-width:0` + 省略号，面板宽度由常量定死，
 *     两块设置区与清单区因此永远同宽（此前是清单撐宽、设置区被拉得很难看）；
 *   - 说明文字全部走 title 悬浮提示，面板内不出现解释段（极简）。
 */
function HoverPanel({ pos, panelRef, items, onPick, onHover, onMarkRead, onMarkAllRead, onContinue }: {
  pos: { top?: number; bottom?: number; left: number; width: number; maxHeight?: number }
  /** 面板自己的 DOM 引用（父级的走廊命中测试要读它的真实矩形） */
  panelRef: React.RefObject<HTMLDivElement | null>
  items: PopItem[]
  onPick: (item: PopItem) => void
  /** 鼠标进出面板：父级据此保持打开 / 计时关闭 */
  onHover: (inside: boolean) => void
  /** 标记单条已读 */
  onMarkRead: (key: string) => void
  /** 一键把需要处理的全部标为已读 */
  onMarkAllRead: () => void
  /** 发送继续 */
  onContinue: (item: PopItem) => Promise<void>
}) {
  // 提示音设置**直接嵌在面板里**（与「对话清单」同面板同现，不再单独弹一层）；
  // 自动继续的状态（已发送 / 发送中）来自模块级记录，不是 React state ——
  // 得订阅一下才能在「发送完成」那一刻重渲染，把「发送中」换成「已发送」。
  const [, bumpAuto] = useState(0)
  useEffect(() => subscribeAutoContinue(() => bumpAuto((n) => n + 1)), [])
  // 改动即持久化，这里只是本地镜像，用来驱动控件显示。
  const [s, setS] = useState<SoundSettings>(() => getSoundSettings())
  const [playingLabel, setPlayingLabel] = useState<string | null>(null)
  useEffect(() => subscribePlaying(setPlayingLabel), [])
  const update = (patch: Partial<SoundSettings>) => setS(setSoundSettings(patch))
  const [sendState, setSendState] = useState<Record<string, 'sending' | 'sent' | 'error'>>({})
  const [sendErr, setSendErr] = useState('')
  /** 每行「继续」的发送状态（手动点的那次；自动那次的进度见「自动继续」那行） */
  const cont = async (it: PopItem) => {
    const cur = sendState[it.key]
    if (cur === 'sending' || cur === 'sent') return
    setSendState((m) => ({ ...m, [it.key]: 'sending' }))
    // 手动点 = 用户介入：取消排队中的自动继续、退避清零
    noteManualContinue(it.sessionId)
    try {
      await onContinue(it)
      setSendState((m) => ({ ...m, [it.key]: 'sent' }))
    } catch (e: any) {
      setSendErr(String(e?.message ?? e))
      setSendState((m) => ({ ...m, [it.key]: 'error' }))
      console.warn('[tokensave] 面板里发送「继续」失败', e)
    }
  }

  /** 计时器：距上次正常发言的耗时，每 30s 重渲染一次（避免秒级抖动） */
  const Timer = ({ at }: { at?: number }) => {
    const [, force] = useState(0)
    useEffect(() => {
      if (!at) return
      const id = window.setInterval(() => force((n) => n + 1), 30_000)
      return () => window.clearInterval(id)
    }, [at])
    if (!at) return null
    const diff = Date.now() - at
    if (diff < 0) return null
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return <span className="ts-warn-timer">刚刚</span>
    if (mins < 60) return <span className="ts-warn-timer">{mins} 分钟前</span>
    const hours = Math.floor(mins / 60)
    const remMins = mins % 60
    return <span className="ts-warn-timer">{hours} 小时{remMins > 0 ? ` ${remMins} 分` : ''}前</span>
  }

  /** 有多少条真的能标已读（活跃的对话没有「已读」概念，不参与计数） */
  const readable = items.filter((it) => it.icon !== '●').length
  return createPortal(
    <div
      ref={panelRef}
      className="ts-warn-pop ts-hover-pop"
      role="dialog"
      aria-label="对话清单"
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >

      {/*
       * 区域一：提示音。
       * 开关放在**标题行**（用户要求：把原来「提醒」后面那颗开关挪到上面）；
       * 下面四行（音量 / 完成 / 中断 / 时长）用一张 card 包起来，表示它们是子内容。
       */}
      <div className="ts-sec">
        <SectionHead title="提示音">
          <button
            type="button"
            className={`ts-cont-sw${s.enabled ? ' on' : ''}`}
            title={s.enabled
              ? '结局提示音：已开启（对话正常结束 / 被中断时响一声）\n点击关闭'
              : '结局提示音：已关闭\n点击开启：正常结束 / 被中断时响一声'}
            role="switch"
            aria-checked={s.enabled}
            onClick={() => update({ enabled: !s.enabled })}
          >
            <i />
          </button>
        </SectionHead>
        <div className="ts-sound-body">
          {/* 四行子内容用一张 card 包住（用户要求：第二~第五行用外框表示子内容） */}
          <div className="ts-box">
            <div className="ts-box-row">
            <label title="音量：提示音的音量大小">音量</label>
            <input
              className="ts-sound-range"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(s.volume * 100)}
              title={`音量 ${Math.round(s.volume * 100)}%`}
              onChange={(e) => update({ volume: Number(e.target.value) / 100 })}
            />
          </div>
            <div className="ts-box-row">
            <label>完成</label>
            <select
              className="ts-select"
              value={s.doneId}
              title="正常结束时的提示音"
              onChange={(e) => update({ doneId: e.target.value as SoundId })}
            >
            {SOUND_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
            <button
              type="button"
              className="ts-sound-mini"
              title="试听完成音效"
              onClick={() => void playRole('done', true)}
            >
            ▶
          </button>
          </div>
            <div className="ts-box-row">
            <label>中断</label>
            <select
              className="ts-select"
              value={s.failId}
              title="被中断 / 失败 / 被截断时的提示音"
              onChange={(e) => update({ failId: e.target.value as SoundId })}
            >
            {SOUND_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
            <button
              type="button"
              className="ts-sound-mini"
              title="试听中断音效"
              onClick={() => void playRole('fail', true)}
            >
            ▶
          </button>
          </div>
            <div className="ts-box-row">
            <label>时长</label>
            <select
              className="ts-select"
              value={s.duration}
              title="每次提醒持续多久（到点自动停）"
              onChange={(e) => update({ duration: e.target.value as SoundDuration })}
            >
            {DURATION_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
            {s.duration === 'custom' && (
            <input
              className="ts-sound-min"
              type="number"
              min={1}
              max={180}
              value={s.customMinutes}
              title="自定义分钟数（1–180）"
              onChange={(e) => update({ customMinutes: Number(e.target.value) })}
            />
            )}
            {s.duration === 'custom' && <span className="ts-sound-unit">分钟</span>}
            <button
              type="button"
              className={`ts-sound-mini${playingLabel ? ' is-playing' : ''}`}
              title={playingLabel ? `停止正在响的「${playingLabel}」提示音（在页面内任意交互：点击、按键、触摸、滚动也会自动停，250ms 宽限期）` : '停止提示音（在页面内任意交互：点击、按键、触摸、滚动也会自动停，250ms 宽限期）'}
            >
            ■
          </button>
          </div>
          </div>
          </div>
      </div>

      {/* 区域二：自动继续（标题行 + 主开关都在 ContinueSettingsBlock 里） */}
      <div className="ts-sec">
        <ContinueSettingsBlock />
      </div>

      {/* 区域三：对话清单（标题行 + 右侧「全部已读」，条目也用 card 包住） */}
      <div className="ts-sec ts-sec-list">
        <SectionHead title="对话清单" note={String(items.length)}>
          <button
            type="button"
            className="ts-mark-all-read-btn"
            disabled={readable === 0}
            title={readable === 0 ? '没有需要标注已读的对话' : `把清单里这 ${readable} 条全部标为已读，不再提醒（新一轮 / 新的待确认会重新提醒）`}
            onClick={onMarkAllRead}
          >
            <span aria-hidden="true">✓</span> 已读
          </button>
        </SectionHead>
        {/* 清单区与提示音 / 自动继续同构：外层给 0 12px 10px 的外距，外框才是 .ts-box */}
        <div className="ts-list-body">
        <div className="ts-box ts-box-list">
          <div className="ts-warn-pop-list">
        {items.map((it) => {
          const auto = autoStateOf(it.sessionId)
          return (
            <div className={`ts-warn-row${it.icon === '●' ? ' is-active' : ''}`} key={it.key}>
              <button
                type="button"
                className="ts-warn-item"
                title={[it.title, it.sub, it.continueHint, '点击：打开这条对话的工作台'].filter(Boolean).join('\n')}
                onClick={() => onPick(it)}
              >
                <span className="ts-warn-icon" aria-hidden="true">{it.icon}</span>
                <span className="ts-warn-body">
                  <span className="ts-warn-title">{it.title}</span>
                  <span className="ts-warn-tags">
                    {it.sub && <span className="ts-warn-sub" style={pillStyle(it.projectKey)}>{it.sub}</span>}
                    {it.icon === '●' && <Timer at={it.lastPromptAt} />}
                    {it.shortReason && <span className="ts-warn-reason">{it.shortReason}</span>}
                  </span>
                </span>
              </button>
              <div className="ts-warn-actions">
                {/* 自动发过了就只报结果（用户不必再点）；不能自动的才给「继续」 */}
                {it.canContinue && auto === 'sent' && (
                  <span className="ts-warn-done" title={it.continueHint
                    ? `已自动发送「继续」：${it.continueHint}`
                    : '已自动发送「继续」让模型接着输出'}>已发送</span>
                )}
                {it.canContinue && auto === 'sending' && (
                  <span className="ts-warn-done is-busy" title="正在发送「继续」…">发送中</span>
                )}
                {it.canContinue && (auto === 'idle' || auto === 'error') && (
                  <button
                    type="button"
                    className={`ts-warn-continue-btn${sendState[it.key] === 'error' || auto === 'error' ? ' is-error' : ''}`}
                    title={sendState[it.key] === 'error'
                      ? `发送失败：${sendErr}（点一下重试）`
                      : auto === 'error'
                        ? `自动发送失败，可手动重试${it.continueHint ? `：${it.continueHint}` : ''}`
                        : it.continueHint || '给这条对话发一条「继续」，让它接着输出'}
                    onClick={(e) => {
                      e.stopPropagation()
                      void cont(it)
                    }}
                    disabled={sendState[it.key] === 'sending'}
                  >
                    {sendState[it.key] === 'sending' ? '发送中' : '继续'}
                  </button>
                )}
                <button
                  type="button"
                  className="ts-warn-read"
                  title="标为已读：不再提醒这一条（新一轮会重新提醒）"
                  aria-label={`标为已读：${it.title}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMarkRead(it.key)
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                    <path d="M2.5 6.4l2.4 2.4 4.6-5.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  已读
                </button>
              </div>
            </div>
          )
        })}
        {items.length === 0 && (
          <div className="ts-warn-empty">
            <span aria-hidden="true">○</span>
            没有正在关注的对话
          </div>
        )}
        </div>
      </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function ControlRoomEntry({ wide }: { wide?: boolean }) {
  // 标题随当前屏变化：在工作台时提示“回项目列表”，在列表时提示“回工作台”，
  // 让“再点一次能回去”这件事在 UI 上自解释。
  const [screen, setScreen] = useState<'list' | 'desk'>(() => getLiveScreen())
  useEffect(() => {
    const sync = () => setScreen(getLiveScreen())
    sync()
    const offList = onRequestProjectList(sync)
    const offDesk = onRequestWorkbench(sync)
    return () => { offList(); offDesk() }
  }, [])

  // 呼吸灯状态（存活对话数 / 是否需要提醒 / 是否正在跑 / 未读完成通知）
  const pulse = useActivityPulse()
  const alive = pulse.alive > 0
  // 导航在途标记：宿主切 tab 是异步的，期间把重复点击当作同一意图的重复表达。
  const navigatingRef = useRef(false)
  const tone: 'ok' | 'warn' = pulse.warn > 0 ? 'warn' : 'ok'
  const running = pulse.running > 0
  const warnUnread = pulse.warn > 0
  const doneUnread = pulse.done.length > 0

  // 圆点数量：量一下按钮宽度，收起态太窄就用 2 个（展开态沿用同一数量）
  const btnRef = useRef<HTMLButtonElement>(null)
  const [dotCount, setDotCount] = useState(DOT_COUNT)
  useEffect(() => {
    const el = btnRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      if (w > 0) setDotCount(w < RAIL_MIN_WIDE ? 2 : DOT_COUNT)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /**
   * 点条目：直达那条对话的工作台。
   * （旧版在这里还会顺手“标为已读”，现在已读只在清单里的「已读」按钮上发生 ——
   *  点一下就跑、又把条目摸掉，很容易误操作。）
   */
  const pick = (it: PopItem) => {
    try {
      if (!enterProjectWorkbench(it.projectId, it.sessionId)) {
        console.warn('[tokensave] 定位对话：没有可导航的目标', it)
      }
    } catch (e) {
      console.warn('[tokensave] 定位对话失败', e)
    }
  }


  const toDesk = screen === 'list'
  const head = toDesk ? '项目中心：回到工作台' : '项目中心：查看项目列表'
  const title = `${head}（再点一次可在两者间切换）`
  // 计数角标（黄=需要处理 / 蓝=未读完成）占位会让 rail（36px）挤不下圆点 →
  // 按「角标优先」递减圆点：无角标 3 个、1 枚角标 2 个、2 枚角标让位给角标。
  const badges = (warnUnread ? 1 : 0) + (doneUnread ? 1 : 0)
  const breathing = wide
    ? (pulse.running + pulse.warn) > 0 ? dotCount : 0
    : badges === 0
      ? dotCount
      : badges === 1
        ? Math.min(dotCount, 2)
        : 0

  const warnItems: PopItem[] = pulse.items.map((i) => ({
    key: i.key,
    sessionId: i.sessionId,
    projectId: i.projectId,
    icon: i.kind === 'pending' ? '⏳' : '⚠️',
    title: i.title || '（未命名对话）',
    sub: i.project || '',
    projectKey: i.projectId || i.project,
    canContinue: i.kind === 'failed',
    interruptKind: i.interruptKind,
    isPending: i.kind === 'pending',
    // 分类器给的原因：鼠标悬在「继续」/「已发送」上就能看到为什么自动 / 为什么不自动
    continueHint: i.interrupt ? decideContinue(i.interrupt).reason : undefined,
    // 短标签挂在项目胶囊后面（如「截断」「余额」）—— 长文案不进面板，否则把面板撑宽
    shortReason: i.kind === 'failed' ? shortInterruptLabel(i.interrupt) : '',
  }))
  const doneItems: PopItem[] = pulse.done.map((d) => ({
    key: d.key,
    sessionId: d.sessionId,
    projectId: d.projectId,
    icon: '✅',
    title: d.title || '（未命名对话）',
    sub: d.project || '',
    projectKey: d.projectId || d.project,
    canContinue: false
  }))

  /** 悬浮清单里的全部条目：跑着的（●） + 需处理的（⏳/⚠️） + 已完成的（✅），与 tip 同序 */
  const hoverItems: PopItem[] = [
    ...pulse.active.map((a) => ({
      key: `a:${a.sessionId}`,
      sessionId: a.sessionId,
      projectId: a.projectId,
      icon: '●',
      title: a.title || '（未命名对话）',
      sub: a.project || '',
      projectKey: a.projectId || a.project,
      canContinue: false,
      lastPromptAt: a.lastPromptAt,
    })),
    ...warnItems,
    ...doneItems,
  ]

  // —— 跑马灯悬浮面板：圆点 hover → 弹出对话清单（取代原生 title，因为它点不了）——
  const [hoverPos, setHoverPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight?: number } | null>(null)
  const hoverTimer = useRef<number | null>(null)
  const clearHoverTimer = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }
  /**
   * 面板开着时清单会变（新对话跑起来 / 某条被标已读）→ 宽度跟着重算，
   * 否则会停在「打开那一刻的最长一条」，清单变短了也窄不下来。
   * 用当前面板的 left 算（不是 0）—— 那样会把可用空间算错，宽度直接顶到上限。
   */
  const wantW = hoverPos && hoverItems.length > 0 ? panelWidth(hoverPos.left, hoverItems) : 0
  useEffect(() => {
    if (!hoverPos || wantW === 0 || hoverPos.width === wantW) return
    setHoverPos({ ...hoverPos, width: wantW })
    // hoverPos 故意不入依赖：只在算出的宽度真的变了时重算，避免自己触发自己
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantW])
  /** 打开：定位算法与角标清单同款（贴按钮右缘，放不下改锚上方） */
  const openHover = () => {
    clearHoverTimer()
    if (hoverPos || hoverItems.length === 0) return
    const r = btnRef.current?.getBoundingClientRect()
    if (!r || (r.width === 0 && r.height === 0)) return
    // 贴按钮右缘。宽度**跟着清单里最长的那条走**（见 panel-width.ts）：
    // 短标题的清单就窄窄一条，长标题到上限为止（靠省略号收尾），不再一律顶格宽。
    const left = Math.max(8, sidebarRightOf(btnRef.current as HTMLElement) + 8)
    const width = panelWidth(left, hoverItems)
    // 高度：最多占视口 80%，再按锚点这一侧**真正剩下的空间**收紧 ——
    // 条目多时面板要能长高（超出部分在清单内部滚动），而不是被 max-height 一刀裁掉末尾几条。
    const vh = window.innerHeight
    const cap = Math.min(vh * 0.8, POP_H_MAX)
    const belowSpace = vh - (r.bottom + 6) - 8
    const aboveSpace = r.top - 6 - 8
    if (belowSpace >= POP_H_MIN) {
      setHoverPos({ top: r.bottom + 6, left, width, maxHeight: Math.max(POP_H_MIN, Math.min(cap, belowSpace)) })
    } else if (aboveSpace >= POP_H_MIN) {
      setHoverPos({
        bottom: vh - r.top + 6,
        left,
        width,
        maxHeight: Math.max(POP_H_MIN, Math.min(cap, aboveSpace)),
      })
    } else {
      // 两侧都不够：自己算个高度，再把顶边夹回视口内（不再用写死的 POP_H 估）
      const maxHeight = Math.max(POP_H_MIN, Math.min(cap, vh - 16))
      setHoverPos({ top: Math.max(8, Math.min(r.top, vh - maxHeight - 12)), left, width, maxHeight })
    }
  }
  /**
   * 关闭：指针离开后**不立刻收**，而是进一段「宽限倒计时」，到点再问一次“指针在哪”。
   *
   * 光延长时间不够 —— 面板与触发器之间本来就有一道缝（横 8 + 纵 6），
   * 指针在缝里时两边都算「离开了」。到点时：
   *   panel / trigger → 不收（mouseleave 才是准确信号；尤其不能在鼠标停在
   *                     面板上时收掉，那正是“鼠标还没到就消失”的另一面）
   *   corridor        → 正在挪过去，续期（有上限，不会无限赖着）
   *   out             → 真走了，收起
   *
   * 为什么在「到点时查位置」而不是只在 mousemove 里续期：
   * 指针如果在缝里**停住不动**，就没有 mousemove 事件了 —— 那样照样会被收掉。
   * 把判断放在到点那一刻，移动中的和停住不动的两种情形都盖住。
   *
   * 续期有上限（RENEW_MAX）：允许慢慢挪，但不允许在缝里停一辈子不消失。
   */
  const renewRef = useRef(0)
  const scheduleClose = () => {
    clearHoverTimer()
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null
      const zone = pointerZone()
      // 指针就停在面板 / 触发器上：绝不能收，等它们自己的 mouseleave 再说话
      if (zone === 'panel' || zone === 'trigger') {
        renewRef.current = 0
        return
      }
      if (zone === 'corridor' && renewRef.current < RENEW_MAX) {
        renewRef.current += 1
        scheduleClose()
        return
      }
      renewRef.current = 0
      setHoverPos(null)
    }, HOVER_CLOSE_MS)
  }
  const closeHover = () => {
    renewRef.current = 0
    scheduleClose()
  }
  useEffect(() => clearHoverTimer, [])

  /** 触发器（圆点/角标那一簇）与面板的 DOM 引用：走廊命中测试要用真实矩形 */
  const triggerRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  /** 最近一次已知的指针位置（mousemove 存；到点时用它算“还在不在走廊里”） */
  const pointerRef = useRef<{ x: number; y: number } | null>(null)

  /**
   * 指针现在在哪 —— 判定逻辑在 hover-corridor.ts 的 `zoneOf`（纯函数、有单测）。
   * 这里只负责从 DOM 读两个真实矩形、以及最近一次指针位置。
   */
  const pointerZone = (): PointerZone => {
    const pt = pointerRef.current
    const t = triggerRef.current
    const p = panelRef.current
    return zoneOf(
      t ? boxOf(t.getBoundingClientRect()) : null,
      p ? boxOf(p.getBoundingClientRect()) : null,
      pt?.x ?? null,
      pt?.y ?? null,
    )
  }
  // 记下指针位置：到点时靠它判断「该不该续期」（停住不动没有 mousemove，
  // 所以不能只在 mousemove 里续期，必须存下位置供定时器回调查）。
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY }
    }
    document.addEventListener('mousemove', onMove, { passive: true })
    return () => document.removeEventListener('mousemove', onMove)
  }, [])

  /**
   * 角标点击：开 / 关面板（与 hover 共用同一块面板）。
   * 不再「钉住」—— 鼠标离开面板 / 触发器簇就自动收起（用户要求）；
   * 面板里逐条点「已读」/「继续」不受影响：鼠标停在面板内时不会自己收。
   */
  const togglePanel = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (hoverPos) {
      clearHoverTimer()
      setHoverPos(null)
      return
    }
    openHover()
  }
  const onBadgeKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      togglePanel(e as unknown as React.MouseEvent)
    }
  }

  // 面板打开时：点面板外面 / 按 Esc 收起（与 hover 的自动收起互不冲突）
  useEffect(() => {
    if (!hoverPos) return
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null
      if (t?.closest('.ts-warn-pop') || t?.closest('.ts-side-entry')) return
      clearHoverTimer()
      setHoverPos(null)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        clearHoverTimer()
        setHoverPos(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [hoverPos])

  useEffect(() => {
    // 结局告警桥：观察到「停止」并判定出完成 / 中断时各响各的音（挂载一次，幂等）；
    // 设置本身内嵌在跑马灯悬浮面板里（HoverPanel 自己管），这里只负责“该响时响”。
    return initSoundBridge()
  }, [])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`ts-side-entry${wide ? '' : ' rail'}`}
        title={title}
        aria-label={title}
        onClick={() => {
          // 连点防抖：导航在途（tab 尚未落定）时忽略后续点击。
          // 否则第二次点击会在“旧屏幕”上算出反方向，把刚切过去的界面又拨回来。
          if (navigatingRef.current) return
          navigatingRef.current = true
          window.setTimeout(() => { navigatingRef.current = false }, NAV_LOCK_MS)
          // 意图即真值：点击瞬间就定住目标屏，按钮文案不再闪动（不等宿主回流）。
          const target: 'list' | 'desk' = screen === 'list' ? 'desk' : 'list'
          setScreen(target)
          try {
            if (!openControlRoom()) {
              console.warn('[tokensave] 项目中心：没有可导航的会话，且没有已登记项目')
            }
          } catch (e) {
            console.warn('[tokensave] 项目中心入口导航失败', e)
          }
          // 宿主 tab 可能晚一拍才切过去，稍后再对一次账
          window.setTimeout(() => setScreen(getLiveScreen()), NAV_LOCK_MS)
        }}
      >
        {/* 收起态有存活对话时：圆点**顶替**图标；否则照旧显示图标（用户要求） */}
        {(!alive || wide) && <span className="ts-side-icon" aria-hidden="true">{toDesk ? '🧭' : '🗂️'}</span>}
        {wide && <span className="ts-side-label">{toDesk ? '回到工作台' : '项目中心'}</span>}
        {alive && (
          <span
            ref={triggerRef}
            className={`ts-side-right${wide ? '' : ' rail'}`}
            // 悬停热区 = 整个右侧簇（角标 + 圆点及其 padding 扩出的区域）：
            // 圆点只有 6px 高，只盯圆点既迟钝又难点中；鼠标一进这片区域就立刻弹出。
            onMouseOver={openHover}
            onMouseLeave={closeHover}
          >
            {/*
             * 黄角标 = 需要处理的对话；蓝角标 = 未读的正常结束。
             * 两者共用**同一个面板**（不再各弹各的浮层）—— 点一下就把面板钉住，
             * 看完整份清单；再点一下 / 按 Esc / 点外面就收起。
             */}
            {warnUnread && (
              <span
                className="ts-side-badge is-warn"
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={hoverPos != null}
                title={`需要处理的对话（${pulse.warn}）：点开清单逐条处理，标完黄灯回绿\n\n${pulse.tip}`}
                onClick={togglePanel}
                onKeyDown={onBadgeKey}
              >
                {pulse.warn}
              </span>
            )}
            {doneUnread && (
              <span
                className="ts-side-badge is-done"
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={hoverPos != null}
                title={`最近正常结束的对话（${pulse.done.length}）：点开清单，点条目直达那条对话`}
                onClick={togglePanel}
                onKeyDown={onBadgeKey}
              >
                {pulse.done.length}
              </span>
            )}
            {breathing > 0 && (
              <PulseDots
                tone={tone}
                running={running}
                count={breathing}
              />
            )}
          </span>
        )}
      </button>
      {hoverPos && (
        <HoverPanel
          pos={hoverPos}
          panelRef={panelRef}
          items={hoverItems}
          onPick={(it) => {
            pick(it)
            // 点条目 = 导航离开：面板直接收起（不再区分是否「钉住」）
            setHoverPos(null)
          }}
          onHover={(inside) => {
            // 鼠标在面板里 → 保持打开；离开 → 走同一条宽限关闭（走廊内可续期）
            if (inside) clearHoverTimer()
            else closeHover()
          }}
          onMarkRead={(key) => markPulseRead('warn', key)}
          onMarkAllRead={() => {
            // 一键已读：需要处理的（黄）+ 最近正常结束的（蓝）一起清 ——
            // 反正面板已经合并成一个清单了，没必要再分两次点
            markPulseRead('warn')
            markPulseRead('done')
          }}
          onContinue={async (it) => {
            noteManualContinue(it.sessionId)
            await sendToSession(it.sessionId, CONTINUE_TEXT)
          }}
        />
      )}
    </>
  )
}
