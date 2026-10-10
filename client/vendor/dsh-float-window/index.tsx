/**
 * dsh-float-window — the shared floating-window shell for DSH web plugins.
 *
 * Extracted from dsh-shorts-wall's shell so every plugin window behaves the
 * same: one React subtree re-styled across float/stick/closed modes (content
 * never remounts), drag by title bar with snap-to-right-edge, double-click
 * the title bar to dock, corner resize handles on all four corners (not just
 * the browser's native bottom-right), a dock rail with click-to-expand, a
 * minimized launcher button, and a boss key (default Alt+S) that toggles
 * minimize/restore and remembers which mode to restore into.
 *
 * Several DSH plugins mount one FloatWindow each (bundled separately), so
 * instances coordinate through a tiny window-global stack: panels occupy one
 * z-index band, minimized launchers/dock rails a strictly higher band (a
 * launcher can never be buried under another plugin's panel), restoring or
 * focusing a window raises it above its siblings, and simultaneously
 * minimized launchers claim vertically offset slots instead of painting on
 * the same pixel.
 *
 * Since 0.2 that registry also detects "several windows mounted at once" and
 * hands out distinct boss keys: a window without an explicit combo gets the
 * next free entry of a browser-safe pool (first window = the historical
 * Alt+S), so each boss key toggles exactly one window. Tooltips and the
 * boss-key hint always show the combo the window currently answers to.
 *
 * Consumers bundle this package with tsdown (it is a plain source dependency,
 * not a loader external), so each plugin's client bundle stays self-contained
 * and the two windows share code, not runtime state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import {
  loadShell, saveShell, RESIZE_CURSORS,
  type ResizeCorner, type ResizeStart, type ShellState, type ShellTuning,
} from './shell-state.ts'
import {
  bossKeyFor, bossKeyMatches, claimBossKey, claimSlot, fwGlobal, nextSeq,
  peekAutoBossKey, releaseBossKey, subscribeBossKeys,
  CHROME_Z_BASE, PANEL_Z_BASE,
} from './stacking.ts'
import { TitleBar } from './title-bar.tsx'

/**
 * Live shell info handed to children-as-function as a second argument.
 * bossKey is the combo this window currently answers to (undefined when a
 * custom isBossKey predicate without a bossKey label is in charge).
 */
export interface FloatWindowCtx {
  bossKey?: string
}

/** Boss key default: Alt/Option + S, no ctrl/meta. */
export function defaultIsBossKey(e: KeyboardEvent): boolean {
  return e.altKey && !e.ctrlKey && !e.metaKey
    && (e.code === 'KeyS' || e.key.toLowerCase() === 's')
}

/** Bar/launcher copy. Every field has a zh default; pass your i18n values. */
export interface FloatWindowLabels {
  /** Launcher (minimized) button tooltip — gets " (<live combo>)" appended. */
  openTitle: string
  /** Dock-rail button tooltip — gets " (<combo> 最小化)" appended. */
  expandTitle: string
  /**
   * Minimize button tooltip base; the live boss-key combo is prefixed
   * ("Alt+X 最小化") because minimizing IS the boss-key action.
   */
  minimizeTitle: string
  /** Mode-toggle switch tooltip. */
  modeToggleTip: string
  /** Title-bar hint next to the toggle ("浮动"/"dock"…). */
  floatText: string
  /**
   * Right-aligned boss-key hint. "{key}" substitutes the live combo
   * (default "老板键 {key}"); a static string without "{key}" is shown as-is.
   */
  bossKeyText?: string
  /** Maximize button tooltip while windowed (default "最大化"). */
  maximizeTitle?: string
  /** Maximize button tooltip while maximized, i.e. restore (default "还原"). */
  restoreTitle?: string
}

/** [vendor-patch dsh-tokensave] 缺省 chrome 文案：上游 0.4.1 把 labels 声明为必填且无默认，
 * 调用方不传会在 label.openTitle 处渲染崩溃；vendored 副本补上可选 + 默认合并。 */
export const DEFAULT_FLOAT_WINDOW_LABELS = {
  openTitle: '打开窗口',
  expandTitle: '展开',
  minimizeTitle: '最小化',
  modeToggleTip: '浮动 / 停靠切换',
  floatText: '浮动',
} as const

export interface FloatWindowProps {
  /** localStorage key for the persisted geometry/mode. */
  storageKey: string
  /** Title-bar label; also the dock-rail text and launcher prefix. */
  title: string
  /** Accent color for the launcher, rail, and toggle. */
  accent: string
  /** Icon inside the minimized launcher button (44×44). */
  launcherGlyph?: ReactNode
  /** Viewport-size bounds and persisted-mode defaults. */
  defaultW?: number
  defaultH?: number
  minW?: number
  minH?: number
  defaultMode?: 'float' | 'stick'
  /**
   * Boss-key predicate — full manual control. Opts out of multi-window
   * coordination unless bossKey is also passed (then bossKey only labels it).
   */
  isBossKey?: (e: KeyboardEvent) => boolean
  /**
   * Declarative boss key ("Alt+S", "Alt+X", "Alt+Shift+1"…). Reserved in the
   * window-global registry: auto-assigned siblings never land on it. Wins
   * over isBossKey for the label; isBossKey still wins for matching.
   */
  bossKey?: string
  /** All window chrome copy.（[vendor-patch] 改为可选，缺省用 zh 默认文案） */
  labels?: FloatWindowLabels
  /** Extra title-bar content rendered after the mode toggle. */
  barExtra?: ReactNode
  /** Content; a function receives the live visibility and the shell context. */
  children: ReactNode | ((visible: boolean, ctx: FloatWindowCtx) => ReactNode)
}

const DEFAULTS = { defaultW: 420, defaultH: 760, minW: 300, minH: 400 } as const

/** Viewport gap kept on every side while maximized. */
const MAXIMIZE_MARGIN = 8

export function FloatWindow(props: FloatWindowProps): ReactNode {
  const tuning: ShellTuning = {
    storageKey: props.storageKey,
    defaultW: props.defaultW ?? DEFAULTS.defaultW,
    defaultH: props.defaultH ?? DEFAULTS.defaultH,
    minW: props.minW ?? DEFAULTS.minW,
    minH: props.minH ?? DEFAULTS.minH,
    defaultMode: props.defaultMode ?? 'float',
  }
  // Boss-key coordination. A declared bossKey reserves that combo in the
  // window-global registry; windows without one are auto-assigned the next
  // free pool combo (first mounted window keeps the historical Alt+S). A
  // custom predicate without a label stays anonymous, exactly like 0.1.
  const anonymousBossKey = props.isBossKey !== undefined && props.bossKey === undefined
  // [vendor-patch dsh-tokensave] 合并默认文案，labels 未传时不再崩溃。
  const label = { ...DEFAULT_FLOAT_WINDOW_LABELS, ...props.labels }

  const [shell, setShell] = useState<ShellState>(() => loadShell(tuning))
  const [stuckOpen, setStuckOpen] = useState(true)
  const [rank, setRank] = useState<number>(() => nextSeq(fwGlobal()))
  const [bossLabel, setBossLabel] = useState<string | undefined>(() => {
    if (anonymousBossKey) return undefined
    if (props.bossKey !== undefined) return props.bossKey
    return peekAutoBossKey(fwGlobal())
  })
  const [launcherSlot, setLauncherSlot] = useState(0)
  const [railSlot, setRailSlot] = useState(0)
  /** Lift this window above every other FloatWindow (focus/restore). */
  const raise = useCallback((): void => { setRank(nextSeq(fwGlobal())) }, [])
  const dragRef = useRef<{ dx: number, dy: number } | null>(null)
  const resizeRef = useRef<ResizeStart | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const minimized = shell.mode === 'closed'
  const stick = shell.mode === 'stick'
  const float = shell.mode === 'float'

  const update = useCallback((patch: Partial<ShellState>): void => {
    setShell((prev) => {
      const next = { ...prev, ...patch }
      saveShell(tuning, next)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.storageKey])

  /** Remember the live layout, then hide the shell. */
  const minimize = useCallback((): void => {
    const wasStick = shell.mode === 'stick'
    update({
      mode: 'closed',
      restoreMode: wasStick ? 'stick' : 'float',
      restoreStuckOpen: wasStick ? stuckOpen : true,
    })
    if (wasStick) setStuckOpen(false)
  }, [shell.mode, stuckOpen, update])

  /** Restore the layout that was live before minimization (float or stick). */
  const restore = useCallback((): void => {
    raise()
    update({ mode: shell.restoreMode })
    setStuckOpen(shell.restoreMode === 'stick' && shell.restoreStuckOpen)
  }, [shell.restoreMode, shell.restoreStuckOpen, update, raise])

  /** Maximized fills the viewport; the normal rectangle is kept intact. */
  const toggleMaximize = useCallback((): void => {
    raise()
    update({ maximized: !shell.maximized })
  }, [shell.maximized, update, raise])

  /** Viewport width the docked panel will render at (mirror of the
   * panelW clamp in render — kept in sync so dockX() is exact). */
  const dockPanelW = Math.max(tuning.minW, Math.min(shell.sizeW, window.innerWidth - 24))

  /** Entering stick mode now SNAPS FLUSH TO THE RIGHT EDGE (0.4.1): the
   * mode is literally named 贴边/停靠, so a mid-screen rectangle docking
   * in place read as "贴边时没有贴边" (user report). The flush x is the
   * same value the render clamp would produce, stamped into the shared
   * rectangle so the stored state matches what's on screen (and an
   * undock floats the window exactly where it was docked, no jump). */
  const dockX = Math.max(0, window.innerWidth - dockPanelW)

  const toggleMode = useCallback((): void => {
    // Float ↔ dock: docking snaps the shared rectangle flush right (the
    // mode's whole point — see dockX); undocking keeps the rectangle
    // exactly where the docked panel was rendered, so nothing jumps.
    update(float ? { mode: 'stick', x: dockX } : { mode: 'float' })
    setStuckOpen(true)
  }, [float, dockX, update])

  const dockFromFloat = useCallback((): void => {
    update({ mode: 'stick', x: dockX })
    setStuckOpen(true)
  }, [dockX, update])

  const startBarDrag = useCallback((e: ReactMouseEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('button') !== null) return
    if (shell.maximized) {
      // Dragging a maximized window restores it under the pointer: the
      // grab offset is computed against the kept normal rectangle.
      update({ maximized: false })
      dragRef.current = { dx: e.clientX - shell.x, dy: e.clientY - shell.y }
      return
    }
    dragRef.current = {
      dx: e.clientX - (shellRef.current?.offsetLeft ?? 0),
      dy: e.clientY - (shellRef.current?.offsetTop ?? 0),
    }
  }, [shell.maximized, shell.x, shell.y, update])

  // Claim (or reserve) this window's combo for as long as it is mounted, and
  // follow re-assignments: a late-mounting declared window can displace an
  // auto sibling, and unmounting siblings compact everyone back down.
  useEffect(() => {
    if (anonymousBossKey) return
    const g = fwGlobal()
    claimBossKey(g, props.storageKey, props.bossKey ?? null)
    setBossLabel(bossKeyFor(g, props.storageKey))
    const off = subscribeBossKeys(g, () => {
      setBossLabel(bossKeyFor(g, props.storageKey))
    })
    return () => { off(); releaseBossKey(g, props.storageKey) }
    // The predicate identity is irrelevant here; only the declared combo is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.storageKey, props.bossKey, anonymousBossKey])

  const isBossKey = useMemo<((e: KeyboardEvent) => boolean) | null>(() => {
    if (props.isBossKey !== undefined) return props.isBossKey
    if (bossLabel === undefined) return null
    return (e: KeyboardEvent) => bossKeyMatches(bossLabel, e)
  }, [props.isBossKey, bossLabel])

  useEffect(() => {
    if (isBossKey === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (isBossKey(e)) {
        e.preventDefault()
        if (minimized) restore()
        else minimize()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [minimized, minimize, restore, isBossKey])

  // A minimized launcher claims a shared bottom-right slot so two plugins
  // minimized at once stack vertically instead of painting on the same pixel.
  useEffect(() => {
    if (!minimized) return
    const g = fwGlobal()
    const slot = claimSlot(g.launcherSlots)
    setLauncherSlot(slot)
    return () => { g.launcherSlots.delete(slot) }
  }, [minimized])

  // Collapsed dock rails share the right edge the same way.
  useEffect(() => {
    if (!(stick && !stuckOpen)) return
    const g = fwGlobal()
    const slot = claimSlot(g.railSlots)
    setRailSlot(slot)
    return () => { g.railSlots.delete(slot) }
  }, [stick, stuckOpen])

  const onMove = (e: MouseEvent): void => {
    const drag = dragRef.current
    if (drag !== null) {
      const maxX = window.innerWidth - 120
      const maxY = window.innerHeight - 60
      update({
        x: Math.min(Math.max(e.clientX - drag.dx, 0), maxX),
        y: Math.min(Math.max(e.clientY - drag.dy, 0), maxY),
      })
      if (e.clientX > window.innerWidth - 24) {
        dragRef.current = null
        // 0.4.1: stamp the flush-right x here too — the render clamp
        // already lands the panel at the edge, but writing the same value
        // into the shared rectangle keeps the stored state exact (e.g. a
        // near-right grab where the clamp would otherwise shave a few px).
        update({ mode: 'stick', x: Math.max(0, window.innerWidth
          - Math.max(tuning.minW, Math.min(shell.sizeW, window.innerWidth - 24))) })
        setStuckOpen(true)
      }
      return
    }

    const resize = resizeRef.current
    if (resize === null) return

    const maxWidth = Math.max(tuning.minW, window.innerWidth - 24)
    const maxHeight = Math.max(tuning.minH, window.innerHeight - 24)
    const dx = e.clientX - resize.pointerX
    const dy = e.clientY - resize.pointerY
    const growsLeft = resize.corner === 'nw' || resize.corner === 'sw'
    const growsUp = resize.corner === 'nw' || resize.corner === 'ne'
    const width = Math.min(
      maxWidth,
      Math.max(tuning.minW, resize.width + (growsLeft ? -dx : dx)),
    )
    const height = Math.min(
      maxHeight,
      Math.max(tuning.minH, resize.height + (growsUp ? -dy : dy)),
    )

    // Both modes share one viewport rectangle: resizing anchors the opposite
    // corner exactly as a floating window does, so toggling the mode never
    // repositions the panel.
    const right = resize.x + resize.width
    const bottom = resize.y + resize.height
    const x = growsLeft ? right - width : resize.x
    const y = growsUp ? bottom - height : resize.y
    update({
      sizeW: width,
      sizeH: height,
      x: Math.min(Math.max(x, 0), Math.max(0, window.innerWidth - width)),
      y: Math.min(Math.max(y, 0), Math.max(0, window.innerHeight - height)),
    })
  }

  const onUp = (): void => {
    dragRef.current = null
    resizeRef.current = null
  }

  useEffect(() => {
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // Handlers read mutable refs; update only depends on the storage key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update])

  const startResizeEvent = useCallback((e: ReactMouseEvent, corner: ResizeCorner): void => {
    e.preventDefault()
    e.stopPropagation()
    const el = shellRef.current
    if (el === null) return
    resizeRef.current = {
      corner,
      pointerX: e.clientX,
      pointerY: e.clientY,
      width: el.offsetWidth,
      height: el.offsetHeight,
      x: el.offsetLeft,
      y: el.offsetTop,
    }
  }, [])

  const panelW = shell.maximized
    ? window.innerWidth - MAXIMIZE_MARGIN * 2
    : Math.max(tuning.minW, Math.min(shell.sizeW, window.innerWidth - 24))
  const panelH = shell.maximized
    ? window.innerHeight - MAXIMIZE_MARGIN * 2
    : Math.max(tuning.minH, Math.min(shell.sizeH, window.innerHeight - 24))
  const safeLeft = shell.maximized ? MAXIMIZE_MARGIN
    : Math.min(Math.max(shell.x, 0), Math.max(0, window.innerWidth - panelW))
  const safeTop = shell.maximized ? MAXIMIZE_MARGIN
    : Math.min(Math.max(shell.y, 0), Math.max(0, window.innerHeight - panelH))
  const panelStyle: CSSProperties = minimized
    ? { position: 'fixed', right: -9999, bottom: -9999, visibility: 'hidden', pointerEvents: 'none' }
    : {
        position: 'fixed',
        left: safeLeft,
        top: safeTop,
        width: panelW,
        height: panelH,
        zIndex: PANEL_Z_BASE + rank,
        background: '#000',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,.8)',
        display: 'flex',
        flexDirection: 'column',
        ...(stick ? {
          visibility: stuckOpen ? 'visible' : 'hidden',
          pointerEvents: stuckOpen ? 'auto' : 'none',
        } : {}),
      }

  const visible = !minimized
  const content = typeof props.children === 'function'
    ? (props.children as (v: boolean, ctx: FloatWindowCtx) => ReactNode)(visible, { bossKey: bossLabel })
    : props.children
  const keySuffix = bossLabel !== undefined ? ` (${bossLabel})` : ''
  const bossHintTpl = label.bossKeyText ?? '老板键 {key}'
  const bossHint = bossLabel !== undefined
    ? bossHintTpl.replaceAll('{key}', bossLabel)
    : bossHintTpl.split(' {key}').join('').split('{key}').join('')
  const railSuffix = bossLabel !== undefined ? ` (${bossLabel} 最小化)` : ''

  return (
    <>
      {minimized && (
        <button
          type="button"
          title={`${label.openTitle}${keySuffix}`}
          data-shell-launcher=""
          onClick={restore}
          style={{
            position: 'fixed', right: 18, bottom: 18 + launcherSlot * 52, zIndex: CHROME_Z_BASE + rank,
            width: 44, height: 44, borderRadius: 999, background: props.accent,
            color: '#fff', border: 'none', cursor: 'pointer',
            boxShadow: '0 8px 30px rgba(0,0,0,.5)',
            fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {props.launcherGlyph ?? '🐬'}
        </button>
      )}
      {stick && !stuckOpen && (
        <button
          type="button"
          title={`${label.expandTitle}${railSuffix}`}
          data-shell-rail=""
          onClick={() => { raise(); setStuckOpen(true) }}
          style={{
            position: 'fixed', right: 0, top: `calc(40% + ${railSlot * 110}px)`, zIndex: CHROME_Z_BASE + rank,
            writingMode: 'vertical-rl', padding: '14px 8px',
            background: props.accent, color: '#fff', border: 'none',
            borderRadius: '10px 0 0 10px', cursor: 'pointer',
            fontSize: 12, fontWeight: 700, letterSpacing: 2,
          }}
        >
          {props.title}
        </button>
      )}
      <div ref={shellRef} data-shell-panel="" style={panelStyle} onMouseDown={raise}>
        <TitleBar
          title={props.title} accent={props.accent} float={float} maximized={shell.maximized}
          floatText={label.floatText} modeToggleTip={label.modeToggleTip}
          bossHint={bossHint} bossHintTitle={label.minimizeTitle}
          barExtra={props.barExtra}
          maximizeTitle={label.maximizeTitle ?? '最大化'}
          restoreTitle={label.restoreTitle ?? '还原'}
          minimizeTitle={bossLabel !== undefined
            ? `${bossLabel} ${label.minimizeTitle}`
            : label.minimizeTitle}
          onMinimize={minimize}
          onBarMouseDown={float ? startBarDrag : undefined}
          onBarDoubleClick={float ? dockFromFloat : undefined}
          onToggleMode={toggleMode}
          onToggleMaximize={toggleMaximize}
        />
        {content}
        {!minimized && !shell.maximized && (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
          <div
            key={corner}
            data-resize-corner={corner}
            aria-hidden="true"
            onMouseDown={(e: ReactMouseEvent<HTMLDivElement>) => { startResizeEvent(e, corner) }}
            style={{
              position: 'absolute',
              top: corner.startsWith('n') ? 0 : undefined,
              bottom: corner.startsWith('s') ? 0 : undefined,
              left: corner.endsWith('w') ? 0 : undefined,
              right: corner.endsWith('e') ? 0 : undefined,
              width: 24, height: 24, zIndex: 20,
              cursor: RESIZE_CURSORS[corner],
              touchAction: 'none', background: 'transparent',
            }}
          />
        ))}
      </div>
    </>
  )
}
