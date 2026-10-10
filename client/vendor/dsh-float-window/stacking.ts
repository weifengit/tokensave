/**
 * Multi-instance stacking coordination for the floating-window shell.
 *
 * Each DSH plugin bundles its own copy of this package (source dependency),
 * so stacking order, launcher slots, and boss-key assignment cannot live in
 * module state — they ride a tiny window global instead: every FloatWindow
 * instance, no matter which plugin's bundle it came from, resolves the same
 * registry.
 *
 * Since 0.2 the registry also hands out boss keys. Windows that do not
 * declare one are auto-assigned distinct combos from a browser-safe pool (the
 * first window keeps the historical Alt+S), so a boss key toggles exactly one
 * window even when several plugins are mounted at once. Declared `bossKey`
 * combos are reserved and never handed to an auto window; when a declared
 * window mounts late it displaces an auto window sitting on its combo, and
 * every window re-reads its assignment through the subscription above.
 */

/** Cross-bundle window-manager state hung off the host window. */
export interface FloatWindowGlobal {
  /** Monotonic raise counter, wrapped at the band size. */
  seq: number
  /** Slot indices currently claimed by minimized launchers. */
  launcherSlots: Set<number>
  /** Slot indices currently claimed by collapsed dock rails. */
  railSlots: Set<number>
  /** @since 0.2 Live boss-key claims in mount order; label null = auto-assign. */
  bosses?: Array<{ storageKey: string, label: string | null }>
  /** @since 0.2 Listeners re-reading assignments when the claim set changes. */
  bossSubs?: Set<() => void>
}

type HostWindow = Window & { __dshFloatWindows?: FloatWindowGlobal }

/** The shared registry, created lazily on first use. */
export function fwGlobal(): FloatWindowGlobal {
  const w = window as HostWindow
  // Pre-0.2 bundles in the same page share this global; they never touch the
  // boss fields, which bossState() below adds on demand.
  w.__dshFloatWindows ??= { seq: 0, launcherSlots: new Set(), railSlots: new Set() }
  return w.__dshFloatWindows
}

/**
 * Panels never dip below the historical 2147483000 level (proven to sit above
 * host-app chrome), and launchers/rails stay strictly above every panel, so a
 * minimized launcher can never be buried under another plugin's window. Both
 * bands fit below the 32-bit z-index ceiling.
 */
export const PANEL_Z_BASE = 2147483000
export const CHROME_Z_BASE = 2147483300
const Z_BAND = 300

/** Next stacking rank; wrapped to keep both z bands under 2^31-1. */
export function nextSeq(g: FloatWindowGlobal): number {
  g.seq = (g.seq + 1) % Z_BAND
  return g.seq
}

/** The lowest unclaimed slot in a shared slot set (0, 1, 2, …). */
export function claimSlot(slots: Set<number>): number {
  let slot = 0
  while (slots.has(slot)) slot += 1
  slots.add(slot)
  return slot
}

/**
 * Boss-key pool handed to auto-assigned windows in mount order. The first
 * entry is the historical default. D/E/F are skipped on purpose: Alt+D focuses
 * the address bar and Alt+E/Alt+F open the browser menu in Chrome.
 */
export const BOSS_KEY_POOL: readonly string[] = [
  'Alt+S', 'Alt+X', 'Alt+Z', 'Alt+C', 'Alt+V', 'Alt+B', 'Alt+Q', 'Alt+W',
]

interface BossState {
  claims: Array<{ storageKey: string, label: string | null }>
  subs: Set<() => void>
}

function bossState(g: FloatWindowGlobal): BossState {
  g.bosses ??= []
  g.bossSubs ??= new Set()
  return { claims: g.bosses, subs: g.bossSubs }
}

function reservedLabels(claims: Array<{ storageKey: string, label: string | null }>): Set<string> {
  const reserved = new Set<string>()
  for (const c of claims) if (c.label !== null) reserved.add(c.label)
  return reserved
}

/** Combo for the index-th auto window given the currently reserved labels. */
function autoBossLabel(index: number, reserved: Set<string>): string {
  const free = BOSS_KEY_POOL.filter((k) => !reserved.has(k))
  const pooled = free[index]
  if (pooled !== undefined) return pooled
  return `Alt+Shift+${index - free.length + 1}`
}

/** Register a mounted window; label null asks for auto-assignment. */
export function claimBossKey(g: FloatWindowGlobal, storageKey: string, label: string | null): void {
  const { claims, subs } = bossState(g)
  claims.push({ storageKey, label })
  for (const fn of [...subs]) fn()
}

/** Unregister an unmounted window; sibling autos compact into freed combos. */
export function releaseBossKey(g: FloatWindowGlobal, storageKey: string): void {
  const { claims, subs } = bossState(g)
  const i = claims.findIndex((c) => c.storageKey === storageKey)
  if (i >= 0) claims.splice(i, 1)
  for (const fn of [...subs]) fn()
}

/** Pure assignment: declared labels are reserved, auto windows fill the rest. */
export function bossKeyAssignments(g: FloatWindowGlobal): Map<string, string> {
  const { claims } = bossState(g)
  const reserved = reservedLabels(claims)
  const out = new Map<string, string>()
  let autoIndex = 0
  for (const c of claims) {
    if (c.label !== null) { out.set(c.storageKey, c.label); continue }
    out.set(c.storageKey, autoBossLabel(autoIndex++, reserved))
  }
  return out
}

/** The combo a live window currently answers to (undefined = anonymous). */
export function bossKeyFor(g: FloatWindowGlobal, storageKey: string): string | undefined {
  return bossKeyAssignments(g).get(storageKey)
}

/** Optimistic combo for an auto window appended right now (first paint). */
export function peekAutoBossKey(g: FloatWindowGlobal): string {
  const { claims } = bossState(g)
  const autos = claims.filter((c) => c.label === null).length
  return autoBossLabel(autos, reservedLabels(claims))
}

/** Re-read assignments whenever a window mounts or unmounts elsewhere. */
export function subscribeBossKeys(g: FloatWindowGlobal, fn: () => void): () => void {
  const { subs } = bossState(g)
  subs.add(fn)
  return () => { subs.delete(fn) }
}

/**
 * 识别 API：列出当前文档里挂载中的 FloatWindow（仅 ≥0.2 实例会注册）。
 * Returns each window's storageKey and the boss-key combo it answers to.
 */
export function floatWindowSnapshot(): Array<{ storageKey: string, bossKey: string | undefined }> {
  const g = fwGlobal()
  const map = bossKeyAssignments(g)
  const out: Array<{ storageKey: string, bossKey: string | undefined }> = []
  const seen = new Set<string>()
  for (const c of g.bosses ?? []) {
    if (seen.has(c.storageKey)) continue
    seen.add(c.storageKey)
    out.push({ storageKey: c.storageKey, bossKey: map.get(c.storageKey) })
  }
  return out
}

/**
 * Combo-label matcher used by every non-custom boss key: "Alt+S",
 * "Alt+X", "Alt+Shift+1". Matches physical keys (e.code first, e.key as
 * fallback) so non-English layouts trigger the same combos, and requires at
 * least one of Alt/Ctrl/Meta so a bare-letter label can never fire.
 */
export function bossKeyMatches(label: string, e: KeyboardEvent): boolean {
  const parts = label.split('+').map((p) => p.trim()).filter((p) => p.length > 0)
  const key = parts[parts.length - 1] ?? ''
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()))
  if (key.length !== 1) return false
  if (!(mods.has('alt') || mods.has('ctrl') || mods.has('meta'))) return false
  if (e.altKey !== mods.has('alt') || e.ctrlKey !== mods.has('ctrl')) return false
  if (e.metaKey !== mods.has('meta') || e.shiftKey !== mods.has('shift')) return false
  if (/[0-9]/.test(key)) return e.code === `Digit${key}`
  if (/[a-zA-Z]/.test(key)) {
    return e.code === `Key${key.toUpperCase()}` || e.key.toLowerCase() === key.toLowerCase()
  }
  return false
}
