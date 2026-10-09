/**
 * 提示音设置面板（跑马灯悬浮面板顶部「🔔 提示音」点开）。
 *
 * 内容（用户需求）：
 *   - 完成音效 / 中断音效**各自选择**（两段网络录音 + 两段合成音 + 静音），各带「▶ 试听」；
 *   - 持续时长：一声响 / 一分钟 / 一直响 / 自定义（分钟数输入）+「■ 停止」；
 *   - 总开关与音量。
 * 全部改动即写入 localStorage（`tokensave:sound.v1`）——**设置固化**，刷新、重开都在。
 *
 * 定位与其它浮层同款：portal 到 body + fixed，贴按钮右缘向右飞出（rail / 展开态都不被裁）。
 */
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DURATION_OPTIONS, SOUND_OPTIONS, getSoundSettings, playRole, setSoundSettings, stopSound,
} from './sound'
import type { SoundDuration, SoundId, SoundSettings } from './sound'

export function SoundPanel({ pos, onClose }: {
  pos: { top?: number; bottom?: number; left: number }
  onClose: () => void
}) {
  const [s, setS] = useState<SoundSettings>(() => getSoundSettings())

  // 点外部 / Esc 关闭；点「🔔 提示音」按钮本身也关（外部判定里放行它，由按钮自己切换）
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('.ts-sound-pop') || t?.closest?.('.ts-hover-tool')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  /** 改一项 → 立刻持久化（setSoundSettings 返回归一化后的完整设置） */
  const update = (patch: Partial<SoundSettings>) => setS(setSoundSettings(patch))

  return createPortal(
    <div
      className="ts-warn-pop ts-sound-pop"
      role="dialog"
      aria-label="提示音设置"
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
    >
      <div className="ts-warn-pop-head">
        <span className="ts-warn-pop-title">提示音设置</span>
      </div>
      <div className="ts-sound-body">
        <div className="ts-sound-row">
          <label>提醒</label>
          <button
            type="button"
            className={`ts-sound-toggle${s.enabled ? ' on' : ''}`}
            title="开启 / 关闭结局提示音"
            onClick={() => update({ enabled: !s.enabled })}
          >
            {s.enabled ? '开' : '关'}
          </button>
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
        <div className="ts-sound-row">
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
        <div className="ts-sound-row">
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
        <div className="ts-sound-row">
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
              className="ts-input ts-sound-min"
              type="number"
              min={1}
              max={180}
              value={s.customMinutes}
              title="自定义分钟数（1–180）"
              onChange={(e) => update({ customMinutes: Number(e.target.value) })}
            />
          )}
          <button
            type="button"
            className="ts-sound-mini"
            title="立刻停止正在响的提示音"
            onClick={() => stopSound()}
          >
            ■
          </button>
        </div>
        <div className="ts-sound-hint">改完即自动保存；浏览器要求先与页面交互过一次才允许出声。</div>
      </div>
    </div>,
    document.body,
  )
}
