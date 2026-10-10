/**
 * Title bar of the floating-window shell: title, mode hint, the
 * float/stick toggle switch, barExtra slot, the boss-key hint, and the
 * maximize/restore button. Purely presentational — every behaviour
 * (drag, double-click dock, mode/maximize toggles) arrives as a callback.
 */
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'

export interface TitleBarProps {
  /** Window title (leftmost, accent-colored). */
  title: ReactNode
  /** Accent color for the title and the toggle "on" state. */
  accent: string
  /** Whether the shell is in float mode (draggable). */
  float: boolean
  /** Whether the shell is maximized (drives the maximize/restore pair). */
  maximized: boolean
  /** Title-bar hint next to the toggle ("浮动"/"dock"…). */
  floatText: string
  /** Mode-toggle switch tooltip. */
  modeToggleTip: string
  /** Resolved boss-key hint text (already has the live combo). */
  bossHint: string
  /** Tooltip for the boss-key hint span. */
  bossHintTitle: string
  /** Extra title-bar content rendered after the mode toggle. */
  barExtra?: ReactNode
  /** Maximize button tooltip while windowed. */
  maximizeTitle: string
  /** Maximize button tooltip while maximized (restore). */
  restoreTitle: string
  /** Minimize button tooltip — already carries the live boss-key combo. */
  minimizeTitle: string
  /** Minimize button click (the boss key's twin action). */
  onMinimize: () => void
  /** Title-bar press — starts a drag (float mode only). */
  onBarMouseDown?: (e: ReactMouseEvent<HTMLDivElement>) => void
  /** Title-bar double-click — docks the float (float mode only). */
  onBarDoubleClick?: () => void
  /** Float/stick toggle switch click. */
  onToggleMode: () => void
  /** Maximize/restore button click. */
  onToggleMaximize: () => void
}

export function TitleBar(props: TitleBarProps): ReactNode {
  const maxTip = props.maximized ? props.restoreTitle : props.maximizeTitle
  return (
    <div
      onMouseDown={props.onBarMouseDown}
      onDoubleClick={props.onBarDoubleClick}
      style={{ cursor: props.float ? 'grab' : 'default', userSelect: 'none' }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px',
        background: '#14141a', borderBottom: '1px solid #222', cursor: 'inherit',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: props.accent }}>{props.title}</span>
        <span style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap' }}>{props.floatText}</span>
        <button
          type="button" role="switch" aria-checked={props.float}
          data-shell-mode-toggle=""
          title={props.modeToggleTip}
          onClick={props.onToggleMode}
          style={{
            position: 'relative', width: 32, height: 18, flex: '0 0 auto',
            background: props.float ? props.accent : '#2c2c34',
            border: `1px solid ${props.float ? props.accent : '#3c3c44'}`,
            borderRadius: 999, cursor: 'pointer', padding: 0,
            transition: 'background 120ms ease, border-color 120ms ease',
          }}
        >
          <span aria-hidden="true" style={{
            position: 'absolute', top: 2, left: props.float ? 16 : 2,
            width: 12, height: 12, borderRadius: 999, background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,.45)', transition: 'left 120ms ease',
          }} />
        </button>
        {props.barExtra}
        <span title={props.bossHintTitle} style={{
          flex: 1, fontSize: 10, color: '#777', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right',
        }}>
          {props.bossHint}
        </span>
        <button
          type="button"
          title={props.minimizeTitle}
          aria-label={props.minimizeTitle}
          data-shell-minimize=""
          onClick={props.onMinimize}
          style={{
            flex: '0 0 auto', width: 20, height: 20, padding: 0,
            background: 'transparent', color: '#999', border: 'none',
            borderRadius: 6, cursor: 'pointer', fontSize: 12, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative', zIndex: 30,
          }}
        >
          ─
        </button>
        <button
          type="button"
          title={maxTip}
          aria-label={maxTip}
          data-shell-maximize=""
          onClick={props.onToggleMaximize}
          style={{
            flex: '0 0 auto', width: 20, height: 20, padding: 0,
            background: 'transparent', color: '#999', border: 'none',
            borderRadius: 6, cursor: 'pointer', fontSize: 12, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            // The transparent ne resize handle (z 20) covers the bar's
            // top-right corner; lift the button above it so hover shows the
            // pointer and clicks reach the button instead of starting a
            // resize drag.
            position: 'relative', zIndex: 30,
          }}
        >
          {props.maximized ? '❐' : '□'}
        </button>
      </div>
    </div>
  )
}
