/**
 * 提示音引擎（设置内嵌在跑马灯悬浮面板顶部，与「对话清单」同面板同现）。
 *
 * 参照 dsh-complete-notify 的思路，按我们的需求裁剪：
 *   - 完成 / 中断**两套独立音效**（可各自选择，含静音）；
 *   - **持续时长可调**：一声响 / 一分钟 / 一直响 / 自定义（N 分钟），到点自动停，
 *     设置区里另有「■」按钮随时掐断；
 *   - 设置固化在 localStorage（`tokensave:sound.v1`），改完即存。
 *
 * 素材：两段录音来自 Wikimedia Commons 的公有领域文件（见 sounds-data.ts 的出处注释），
 * 已截取/归一化后内嵌进包；另有两段 Web Audio 合成音（零文件）与「静音」。
 *
 * 浏览器约束：**首次出声前需要用户与页面交互过一次**（autoplay 策略）；被拦截时
 * playUnit 返回 0，循环会立刻停下而不是空转刷屏。
 */
import { ALARM_MP3, DINGDONG_MP3 } from './sounds-data'
import { onPulseAlert } from './pulse'
import { scheduleAlertKick } from './alert-kick'
import { initAutoContinue } from './auto-continue'

/** 音效 id：两段录音 + 两段合成 + 静音 */
export type SoundId = 'dingdong' | 'alarm' | 'chime' | 'beep' | 'muted'
/** 哪一类提醒（完成 / 中断） */
export type SoundRole = 'done' | 'fail'
/** 持续时长模式 */
export type SoundDuration = 'once' | 'minute' | 'forever' | 'custom'

export interface SoundSettings {
  enabled: boolean
  /** 完成音效 */
  doneId: SoundId
  /** 中断音效 */
  failId: SoundId
  duration: SoundDuration
  /** duration === 'custom' 时的分钟数 */
  customMinutes: number
  /** 0..1 */
  volume: number
}

/** 可选音效（顺序即下拉顺序） */
export const SOUND_OPTIONS: ReadonlyArray<{ id: SoundId; label: string }> = [
  { id: 'dingdong', label: '叮咚 · 门铃（录音）' },
  { id: 'alarm', label: '警报 · 短促（录音）' },
  { id: 'chime', label: '清脆提示（合成）' },
  { id: 'beep', label: '双短音（合成）' },
  { id: 'muted', label: '静音' },
]

/** 时长选项（顺序即下拉顺序） */
export const DURATION_OPTIONS: ReadonlyArray<{ id: SoundDuration; label: string }> = [
  { id: 'once', label: '一声响' },
  { id: 'minute', label: '一分响' },
  { id: 'forever', label: '一直响' },
  { id: 'custom', label: '随心响' },
]

const LS_KEY = 'tokensave:sound.v1'
const DEFAULTS: SoundSettings = {
  enabled: true,
  doneId: 'dingdong',
  failId: 'alarm',
  duration: 'once',
  customMinutes: 5,
  volume: 0.8,
}

/** 本次会话内已加载的设置（模块级单例） */
let settings: SoundSettings = readPersisted()

function readPersisted(): SoundSettings {
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return { ...DEFAULTS }
    const obj = JSON.parse(raw) as Partial<SoundSettings>
    return normalize({ ...DEFAULTS, ...obj })
  } catch {
    return { ...DEFAULTS }
  }
}

function normalize(s: SoundSettings): SoundSettings {
  const ids = new Set(SOUND_OPTIONS.map((o) => o.id))
  const durs = new Set(DURATION_OPTIONS.map((o) => o.id))
  return {
    enabled: s.enabled !== false,
    doneId: ids.has(s.doneId) ? s.doneId : DEFAULTS.doneId,
    failId: ids.has(s.failId) ? s.failId : DEFAULTS.failId,
    duration: durs.has(s.duration) ? s.duration : DEFAULTS.duration,
    customMinutes: Math.min(180, Math.max(1, Math.round(Number(s.customMinutes) || DEFAULTS.customMinutes))),
    volume: Math.min(1, Math.max(0, Number.isFinite(s.volume) ? s.volume : DEFAULTS.volume)),
  }
}

// —— 订阅（设置变化 / 正在播放）——
const settingsListeners = new Set<() => void>()
const playingListeners = new Set<(label: string | null) => void>()
/** 正在播放时的短标签（「完成」/「中断」），空串 = 没在播 */
let playingLabel = ''

export function getSoundSettings(): SoundSettings {
  return { ...settings }
}

/** 写本地缓存（隐私模式等写不进去也不影响本次会话） */
function persistLocal(): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(settings))
  } catch {
    /* 隐私模式等：本次会话内仍生效 */
  }
}

/** 通知订阅者（面板重渲染 / 自动继续读最新值） */
function notifySettings(): void {
  for (const fn of [...settingsListeners]) {
    try {
      fn()
    } catch {
      /* noop */
    }
  }
}

/** 改设置（部分更新）：立刻本地生效 + 持久化 + 通知，并**上报服务端**让另一台设备跟上 */
export function setSoundSettings(patch: Partial<SoundSettings>): SoundSettings {
  settings = normalize({ ...settings, ...patch })
  persistLocal()
  notifySettings()
  schedulePush()
  return { ...settings }
}

export function subscribeSoundSettings(fn: () => void): () => void {
  settingsListeners.add(fn)
  return () => settingsListeners.delete(fn)
}

export function subscribePlaying(fn: (label: string | null) => void): () => void {
  playingListeners.add(fn)
  fn(playingLabel || null)
  return () => playingListeners.delete(fn)
}

function setPlaying(label: string | null): void {
  playingLabel = label || ''
  for (const fn of [...playingListeners]) {
    try {
      fn(playingLabel || null)
    } catch {
      /* noop */
    }
  }
}

// —— 播放内核 ——
/** 当前这一「声」的停止钩子（stopSound 会调用它立刻掐断） */
let unitWake: (() => void) | null = null
/** 总停止开关：置位后循环不再进入下一声 */
let stopFlag = false
/** Web Audio 上下文（合成音用，惰性创建一次） */
let synthCtx: AudioContext | null = null
/** 播放代次：后开始的播放顶掉前一个时，旧循环不能把新标签清掉 */
let playToken = 0

/** 时长模式 → 毫秒（once = 0 表示只响一声；forever = Infinity） */
function durationMs(s: SoundSettings): number {
  switch (s.duration) {
    case 'once':
      return 0
    case 'minute':
      return 60_000
    case 'custom':
      return Math.max(1, s.customMinutes) * 60_000
    case 'forever':
      return Infinity
    default:
      return 0
  }
}

/** 播放一「声」录音（返回实际耗时；被拦截/出错返回 0） */
function playFile(src: string, volume: number): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio(src)
    let settled = false
    const done = (ms: number) => {
      if (settled) return
      settled = true
      unitWake = null
      resolve(ms)
    }
    unitWake = () => {
      try {
        a.pause()
      } catch {
        /* noop */
      }
      done(0)
    }
    a.volume = volume
    a.onended = () => done((Number.isFinite(a.duration) ? a.duration : 2) * 1000)
    a.onerror = () => done(0)
    a.play().catch(() => done(0))
  })
}

/** 播放一「声」合成音（Web Audio；返回时长） */
function playSynth(kind: 'chime' | 'beep', volume: number): Promise<number> {
  const total = kind === 'chime' ? 700 : 620
  const AC: typeof AudioContext | undefined =
    (window as any).AudioContext || (window as any).webkitAudioContext
  if (!AC) return Promise.resolve(total)
  try {
    if (!synthCtx) synthCtx = new AC()
    const ctx = synthCtx
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime + 0.02
    const note = (freq: number, at: number, dur: number, peak: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * volume), t0 + at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + dur + 0.02)
    }
    if (kind === 'chime') {
      note(987.77, 0, 0.28, 0.3) // B5
      note(1318.51, 0.16, 0.5, 0.28) // E6
    } else {
      note(1046.5, 0, 0.14, 0.32) // C6 ×2
      note(1046.5, 0.22, 0.16, 0.32)
    }
  } catch {
    return Promise.resolve(total)
  }
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      unitWake = null
      resolve(total)
    }
    unitWake = () => done()
    window.setTimeout(done, total)
  })
}

function playUnit(id: SoundId, volume: number): Promise<number> {
  if (id === 'dingdong') return playFile(DINGDONG_MP3, volume)
  if (id === 'alarm') return playFile(ALARM_MP3, volume)
  if (id === 'chime' || id === 'beep') return playSynth(id, volume)
  return Promise.resolve(0)
}

/** 掐掉当前正在响的提示音（含循环） */
export function stopSound(): void {
  stopFlag = true
  const wake = unitWake
  unitWake = null
  if (wake) wake()
}

// —— 用户一操作就自动停（用户需求：不用每次手动点 ■）——
/** 页面内哪些事件算“用户在操作”。pointerdown 同时覆盖鼠标与触屏 */
const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const
/** 起音后这段毫秒内的操作不算（避免“正在操作时刚好响了一声”被当场抹掉） */
const INTERACTION_GRACE_MS = 250
/** 最近一次起音时间（宽限期用） */
let lastStartAt = 0
/** 全局监听是否已挂（惰性挂，首次播放才装） */
let autoStopArmed = false

function onUserInteraction(): void {
  if (!playingLabel) return
  if (Date.now() - lastStartAt < INTERACTION_GRACE_MS) return
  stopSound()
}

/** 挂上“一操作就停”的全局监听（只挂一次，capture 阶段先于业务处理） */
function armAutoStop(): void {
  if (autoStopArmed || typeof window === 'undefined') return
  autoStopArmed = true
  for (const type of INTERACTION_EVENTS) {
    window.addEventListener(type, onUserInteraction, true)
  }
}

/**
 * 播某一类提醒音（按当前设置循环到时长上限）。
 * @param role - done=完成 / fail=中断（「待确认」告警也用 fail 那一段音效）
 * @param force - true = 忽略“启用提醒”开关（试听用）
 * @param label - 面板里「正在响的 X」的显示名；不传按 role 推（pending 告警要单独一个名字，
 *                否则会把「等你确认」说成「中断」，用户会以为有一轮报错了）
 */
export async function playRole(role: SoundRole, force = false, label?: string): Promise<void> {
  const s = { ...settings }
  if (!s.enabled && !force) return
  const id = role === 'done' ? s.doneId : s.failId
  if (id === 'muted') return
  // 掐掉上一段再开新的
  const wake = unitWake
  unitWake = null
  if (wake) wake()
  stopFlag = false
  const token = ++playToken
  lastStartAt = Date.now()
  armAutoStop()
  setPlaying(label ?? (role === 'done' ? '完成' : '中断'))
  const started = Date.now()
  const limit = durationMs(s)
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const spent = await playUnit(id, s.volume)
      if (stopFlag) break
      if (spent <= 0) break // 被 autoplay 策略拦下 / 出错：别空转
      if (limit !== Infinity && Date.now() - started >= limit - 150) break
    }
  } finally {
    // 只有“最后开始的那次播放”才有资格清标签（切歌 / 新告警顶掉旧循环时不会误清新标签）
    if (playToken === token) setPlaying(null)
  }
}

// —— 脉冲告警桥：结局一出来就响（只在“观察到的停止”那条路上，历史结论不响）——
let bridgeOff: (() => void) | null = null

/** 挂上告警桥（幂等）；返回解绑函数。ControlRoomEntry 挂载时调用一次。 */

// —— 跨端同步（手机 ↔ 电脑共享同一份提示音设置）——
//
// 用户反馈：「手机发了信息，电脑端的提示音还在一直响着；手机上调呼吸灯面板里的
// 开关控制不了电脑端」。根因：设置原本只写各浏览器自己的 localStorage。
// 现在以**服务端为真相源**：改动 POST 上去，服务端经 SSE 广播给所有在线客户端；
// 收到 enabled=false 的那一端立即 stopSound() —— 正在响的当场停下。
//
// 为什么要 SSE：电脑端往往停在**后台标签页**，浏览器把后台定时器节流到分钟级，
// 纯轮询拖不住「马上就停」。长连接不受定时器节流影响；轮询只作长连接建不起来时的兜底。

const SYNC_PATH = '/plugins/dsh-tokensave/sound-settings'
const DEVICE_KEY = 'tokensave:device.v1'
/** POST 去抖：音量滑杆拖动会连发 onChange，没必要每格都打一次服务端 */
const PUSH_DEBOUNCE_MS = 300
/** 兜底轮询间隔（仅在长连接未建立时运行） */
const FALLBACK_POLL_MS = 5_000

/** 已应用到的服务端版本号：只在它变大时应用，自己写出去的回声不会成环 */
let appliedRev = -1
let syncStarted = false
let streamOpen = false
let stream: EventSource | null = null
let pushTimer: number | null = null
let pollTimer: number | null = null

/** 本设备短标识（只进服务端日志，用于看「谁改的」） */
function deviceId(): string {
  try {
    const kept = window.localStorage.getItem(DEVICE_KEY)
    if (kept) return kept
  } catch {
    /* 隐私模式 */
  }
  const id = `dev-${Math.random().toString(36).slice(2, 8)}`
  try {
    window.localStorage.setItem(DEVICE_KEY, id)
  } catch {
    /* noop */
  }
  return id
}

/** 把本端设置推到服务端（去抖；失败不影响本地体验，下次改动/轮询再对账） */
function schedulePush(): void {
  if (typeof window === 'undefined') return
  if (pushTimer !== null) window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => {
    pushTimer = null
    void pushNow()
  }, PUSH_DEBOUNCE_MS)
}

async function pushNow(): Promise<void> {
  try {
    const res = await fetch(SYNC_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: getSoundSettings(), by: deviceId() }),
    })
    if (!res.ok) return
    const data = await res.json().catch(() => null)
    // 记住自己写到哪一版，服务端把这版广播回来时不会重复应用
    if (data && typeof data.rev === 'number') appliedRev = data.rev
  } catch {
    /* 离线 / 网关未就绪 */
  }
}

/** 应用服务端状态。返回是否真的应用了。 */
function applyRemoteState(state: any): boolean {
  if (!state || typeof state.rev !== 'number') return false
  if (state.rev <= appliedRev) return false
  appliedRev = state.rev
  const remote = state.settings && typeof state.settings === 'object' ? state.settings : {}
  // 合并而不是整体替换：服务端万一只存了部分字段，其余保持本端现值
  const next = normalize({ ...settings, ...(remote as Partial<SoundSettings>) })
  const changed = JSON.stringify(next) !== JSON.stringify(settings)
  settings = next
  persistLocal()
  // 远端把提示音关了 → 立刻掐断正在响的。
  // 「一直响」那档人不在电脑前就没法关，靠的就是这一条。
  if (!next.enabled) stopSound()
  if (changed) notifySettings()
  return true
}

/**
 * 拉一次快照。
 * 服务端从未写过（rev 0）时把**本端设置当种子**播上去，而不是被默认值覆盖 ——
 * 否则手机上已经关掉的开关会被一次同步重新打开。
 */
async function refreshSnapshot(): Promise<void> {
  try {
    const res = await fetch(SYNC_PATH, { headers: { Accept: 'application/json' } })
    if (!res.ok) return
    const state = await res.json().catch(() => null)
    if (!state) return
    if (typeof state.rev !== 'number' || state.rev === 0) {
      appliedRev = 0
      await pushNow()
      return
    }
    applyRemoteState(state)
  } catch {
    /* 拿不到就继续用本地设置 */
  }
}

function startPollFallback(): void {
  if (streamOpen) return // 长连接活着就不必轮询兜底
  if (pollTimer !== null || typeof window === 'undefined') return
  pollTimer = window.setInterval(() => { void refreshSnapshot() }, FALLBACK_POLL_MS)
}

function stopPollFallback(): void {
  if (pollTimer === null) return
  window.clearInterval(pollTimer)
  pollTimer = null
}

function openStream(): void {
  if (typeof EventSource === 'undefined') {
    startPollFallback()
    return
  }
  try {
    stream = new EventSource(SYNC_PATH)
    stream.addEventListener('open', () => {
      streamOpen = true
      stopPollFallback()
    })
    stream.addEventListener('settings', (ev: MessageEvent) => {
      try {
        applyRemoteState(JSON.parse(String(ev.data)))
      } catch {
        /* 忽略坏帧 */
      }
    })
    stream.addEventListener('error', () => {
      // EventSource 自己会按 retry 重连；重连期间用轮询兜底
      streamOpen = false
      startPollFallback()
    })
  } catch {
    startPollFallback()
  }
}

/** 停同步（卸载 / 自检用） */
export function stopSoundSync(): void {
  syncStarted = false
  streamOpen = false
  stopPollFallback()
  if (pushTimer !== null) {
    window.clearTimeout(pushTimer)
    pushTimer = null
  }
  if (stream) {
    try {
      stream.close()
    } catch {
      /* noop */
    }
    stream = null
  }
}

/** 当前长连接是否活着（自检/排查用） */
export function isSoundStreamOpen(): boolean {
  return streamOpen
}

/**
 * 启动跨端同步（幂等；页面级单例，由插件入口 client/src/index.ts 调一次）。
 * 不在面板里启动 —— 面板关着也得能收到「另一端把它关了」的广播。
 */
export function startSoundSync(): () => void {
  if (syncStarted || typeof window === 'undefined') return stopSoundSync
  syncStarted = true
  void refreshSnapshot()
  openStream()
  return stopSoundSync
}
export function initSoundBridge(): () => void {
  // 自动继续引擎同生命周期：它在「告警」这条路上判该不该自动发「继续」，
  // 不依赖面板是否打开（面板收起时 max-tokens 一样要被接上）。
  const offContinue = initAutoContinue()
  if (!bridgeOff) {
    bridgeOff = onPulseAlert((a) => {
      // 角标先上屏、声音随后半拍（两帧 ≈ 16-32ms）：两者同步感知，不再“先听到后看到”。
      // 但 rAF 在**隐藏标签页 / 浏览器最小化**时被冻结（实测：隐藏页里挂的 rAF 5s 内一次没跑），
      // 只走 rAF 会把提示音整个吞掉 —— 起音交给 scheduleAlertKick（rAF + 定时兜底）。
      scheduleAlertKick(() => {
        // 三种告警共用两段音效：正常完成用 doneId；中断与「待确认」都用 failId
        // （两者都是「要你马上看一眼」，且用户已经在设置里给中断挑好了曲子）。
        // pending 单独给个显示标签，面板里才不会把等待确认写成「中断」。
        if (a.kind === 'done') void playRole('done')
        else if (a.kind === 'pending') void playRole('fail', false, '待确认')
        else void playRole('fail')
      })
    })
  }
  return () => {
    offContinue()
    if (bridgeOff) {
      bridgeOff()
      bridgeOff = null
    }
    stopSound()
  }
}

/**
 * 目检 / 排查钩子（浏览器 console 里用，不进 UI）：
 *   __tokensaveSound.get() / .set(patch) —— 读 / 改设置（即刻持久化）
 *   __tokensaveSound.play('done'|'fail') —— 按当前设置试听
 *   __tokensaveSound.stop() / .playing() —— 掐断 / 当前是否在响
 */
;(globalThis as any).__tokensaveSound = {
  get: getSoundSettings,
  set: setSoundSettings,
  play: (role: SoundRole) => playRole(role, true),
  stop: stopSound,
  playing: () => playingLabel,
}
