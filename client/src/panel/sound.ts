/**
 * 提示音引擎（跑马灯悬浮面板顶部「🔔 提示音」设置用）。
 *
 * 参照 dsh-complete-notify 的思路，但按我们的需求裁剪：
 *   - 完成 / 中断**两套独立音效**（可各自选择，含静音）；
 *   - **持续时长可调**：一声响 / 一分钟 / 一直响 / 自定义（N 分钟），到点自动停，
 *     面板上另有「停止」按钮随时掐断；
 *   - 设置固化在 localStorage（`tokensave:sound.v1`）。
 *
 * 素材：两段录音来自 Wikimedia Commons 的公有领域文件（见 sounds-data.ts 的出处注释），
 * 已截取/归一化后内嵌进包；另有两段 Web Audio 合成音（零文件）与「静音」。
 *
 * 浏览器约束：**首次出声前需要用户与页面交互过一次**（autoplay 策略）；被拦截时
 * playUnit 返回 0，循环会立刻停下而不是空转刷屏。
 */
import { ALARM_MP3, DINGDONG_MP3 } from './sounds-data'
import { onPulseAlert } from './pulse'

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
  { id: 'minute', label: '一分钟' },
  { id: 'forever', label: '一直响' },
  { id: 'custom', label: '自定义（分钟）' },
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
/** 正在播放时的短标签（如「完成」/「中断」），空串 = 没在播 */
let playingLabel = ''

export function getSoundSettings(): SoundSettings {
  return { ...settings }
}

/** 改设置（部分更新），立刻持久化并通知订阅者 */
export function setSoundSettings(patch: Partial<SoundSettings>): SoundSettings {
  settings = normalize({ ...settings, ...patch })
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(settings))
  } catch {
    /* 隐私模式等：本次会话内仍生效 */
  }
  for (const fn of [...settingsListeners]) {
    try {
      fn()
    } catch {
      /* noop */
    }
  }
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

/**
 * 播某一类提醒音（按当前设置循环到时长上限）。
 * @param role - done=完成 / fail=中断
 * @param force - true = 忽略“启用提醒”开关（设置面板里的「试听」用）
 */
export async function playRole(role: SoundRole, force = false): Promise<void> {
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
  setPlaying(role === 'done' ? '完成' : '中断')
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
export function initSoundBridge(): () => void {
  if (!bridgeOff) {
    bridgeOff = onPulseAlert((a) => {
      void playRole(a.kind === 'fail' ? 'fail' : 'done')
    })
  }
  return () => {
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
