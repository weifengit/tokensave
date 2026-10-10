/**
 * Persisted state for the shared floating-window shell (dsh-float-window).
 * One rectangle serves both float and stick modes; docking (0.4.1) snaps
 * the rectangle flush right so stick mode genuinely 贴边, while undocking
 * keeps the window exactly where the docked panel was rendered.
 * minimized remembers which mode to restore.
 */
export interface ShellState {
  mode: 'float' | 'stick' | 'closed'
  /** Mode to return to when the boss key/launcher restores a minimized shell. */
  restoreMode: Exclude<ShellState['mode'], 'closed'>
  /** Whether a restored stick shell should open its overlay or stay as the rail. */
  restoreStuckOpen: boolean
  /**
   * Whether the shell fills the viewport (maximized). x/y/sizeW/sizeH keep
   * the normal geometry untouched, so toggling maximized off restores it.
   */
  maximized: boolean
  /** Viewport position shared by floating and docked modes. */
  x: number
  y: number
  /** Shell size shared by floating and docked modes. */
  sizeW: number
  sizeH: number
}

export interface ShellTuning {
  storageKey: string
  defaultW: number
  defaultH: number
  minW: number
  minH: number
  defaultMode: 'float' | 'stick'
}

function viewportSize(): { width: number, height: number } {
  return {
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  }
}

/** A docked-near-the-right-edge default, vertically centered. */
export function defaultShell(t: ShellTuning): ShellState {
  const { width, height } = viewportSize()
  return {
    mode: t.defaultMode,
    restoreMode: t.defaultMode,
    restoreStuckOpen: true,
    maximized: false,
    x: Math.max(12, Math.round(width - t.defaultW - 12)),
    y: Math.max(12, Math.round((height - t.defaultH) / 2)),
    sizeW: t.defaultW,
    sizeH: t.defaultH,
  }
}

export function loadShell(t: ShellTuning): ShellState {
  try {
    const raw = localStorage.getItem(t.storageKey)
    if (raw === null) return defaultShell(t)
    const p = JSON.parse(raw) as Partial<ShellState>
    const mode = p.mode === 'stick' || p.mode === 'closed' || p.mode === 'float' ? p.mode : t.defaultMode
    const restoreMode = p.restoreMode === 'stick' || p.restoreMode === 'float' ? p.restoreMode : t.defaultMode
    const { width, height } = viewportSize()
    return {
      mode,
      restoreMode,
      restoreStuckOpen: p.restoreStuckOpen !== false,
      maximized: p.maximized === true,
      x: typeof p.x === 'number' ? Math.min(Math.max(p.x, 0), Math.max(0, width - t.minW)) : defaultShell(t).x,
      y: typeof p.y === 'number' ? Math.min(Math.max(p.y, 0), Math.max(0, height - t.minH)) : defaultShell(t).y,
      sizeW: typeof p.sizeW === 'number' && p.sizeW >= t.minW ? p.sizeW : t.defaultW,
      sizeH: typeof p.sizeH === 'number' && p.sizeH >= t.minH ? p.sizeH : t.defaultH,
    }
  } catch {
    return defaultShell(t)
  }
}

export function saveShell(t: ShellTuning, st: ShellState): void {
  try { localStorage.setItem(t.storageKey, JSON.stringify(st)) } catch { /* optional */ }
}

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

export interface ResizeStart {
  corner: ResizeCorner
  pointerX: number
  pointerY: number
  width: number
  height: number
  x: number
  y: number
}

export const RESIZE_CURSORS: Record<ResizeCorner, string> = {
  nw: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  se: 'nwse-resize',
}
