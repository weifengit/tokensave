/**
 * 主题偏好三态（跟随系统 / 深色 / 浅色）—— 齿轮「设置」面板里的一项外观偏好。
 *
 * 参考 info_report 的 intel:theme.v1：那边是**独立页面**，自己存一份偏好、自己解析
 * 「system 时看系统」并写 `<html data-theme>`。tokensave 是挂在 DSH 里的插件，宿主
 * 已经有一整套主题运行时（`@deepseek-ai/dsh-client-ui-theme` 提供的 `ctx.theme`）：
 *   · 偏好落在宿主**用户设置**里（跨设备 / 跨窗口同一份）；
 *   · `setTheme(id)` 是唯一的用户写入入口，`system` 由宿主解析成实际深浅；
 *   · 变化通过 `theme/change` 事件广播，宿主 presenter 自己切 body[data-ds-dark-theme]。
 *
 * 所以这里**只做桥接，不存第二份**：插件再存一个 tokensave:theme-mode.v1 的话，
 * 宿主设置页切一次、插件面板还显示旧值，两个真相源迟早对不上。
 *
 * 宿主服务拿不到（旧宿主 / 主题插件被禁用）时一律返回 null：面板把三枚按钮置灰并
 * 写明原因，而不是假装能切 —— 「点了没反应」比「说清楚为什么不能点」更难排查。
 */
import { readService } from '../session-subscribe'

export type ThemeMode = 'system' | 'dark' | 'light'

/** 三态的顺序即面板里的显示顺序：跟随系统在最前（默认值）。 */
export const THEME_MODES: readonly ThemeMode[] = ['system', 'dark', 'light']

export const THEME_MODE_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  dark: '深色',
  light: '浅色',
}

export const THEME_MODE_HINT: Record<ThemeMode, string> = {
  system: '跟随系统外观：系统切深 / 浅，整个界面一起切（默认）',
  dark: '始终深色，忽略系统设置',
  light: '始终浅色，忽略系统设置',
}

/**
 * 把任意来源的值收敛成三态之一；认不出返回 null（第三方主题 / 脏存储 / 服务未就绪）。
 * 不认识的偏好**不能**默认成「跟随系统」：那会让面板高亮一枚用户其实没选的按钮。
 */
export function normalizeThemeMode(value: unknown): ThemeMode | null {
  return (THEME_MODES as readonly string[]).includes(String(value)) ? (String(value) as ThemeMode) : null
}

/** 宿主主题服务的最小契约（只用这两个方法，不 import 宿主类型以免绑死版本）。 */
interface ThemeSnapshotLike {
  preference?: unknown
  active?: { colorScheme?: unknown } | null
}
interface ThemeServiceLike {
  getTheme?: () => ThemeSnapshotLike | null | undefined
  setTheme?: (id: string) => void
}

/** 取宿主主题服务；未提供 / 读取抛错都当「没有」（cordis 未 inject 的服务会 throw）。 */
export function getThemeService(ctx: unknown): ThemeServiceLike | undefined {
  const svc = readService<ThemeServiceLike>(ctx, 'theme')
  return svc && typeof svc === 'object' ? svc : undefined
}

/** 读当前偏好；服务缺失或快照不认识 → null。 */
export function readThemeMode(ctx: unknown): ThemeMode | null {
  const svc = getThemeService(ctx)
  if (!svc || typeof svc.getTheme !== 'function') return null
  try {
    return normalizeThemeMode(svc.getTheme()?.preference)
  } catch {
    return null
  }
}

/**
 * 读**当前生效**的配色（`system` 已被宿主解析成实际深浅）。
 * 面板用它显示「跟随系统 · 当前深色」—— 只显示偏好名的话，用户看不出跟成了什么。
 */
export function readActiveScheme(ctx: unknown): 'dark' | 'light' | null {
  const svc = getThemeService(ctx)
  if (!svc || typeof svc.getTheme !== 'function') return null
  try {
    const scheme = svc.getTheme()?.active?.colorScheme
    return scheme === 'light' || scheme === 'dark' ? scheme : null
  } catch {
    return null
  }
}

/** 写偏好（唯一入口是宿主 setTheme，由宿主负责落库与生效）。返回是否写成功。 */
export function writeThemeMode(ctx: unknown, mode: ThemeMode): boolean {
  const next = normalizeThemeMode(mode)
  if (!next) return false
  const svc = getThemeService(ctx)
  if (!svc || typeof svc.setTheme !== 'function') return false
  try {
    svc.setTheme(next)
    return true
  } catch (e) {
    console.warn('[tokensave] 切换主题失败', e)
    return false
  }
}

/**
 * 订阅偏好变化。返回退订函数。
 *
 * 两条信号都要：
 *   · `theme/change` —— 宿主设置页 / 系统深浅（system 模式下）变化时唯一可靠的广播；
 *   · `ctx.inject(['theme'])` —— 本插件与主题插件的加载顺序不确定，服务后到时补读一次，
 *     否则面板会一直停在「服务不可用」。
 */
export function subscribeThemeMode(ctx: unknown, listener: () => void): () => void {
  const anyCtx = ctx as { on?: (...a: any[]) => unknown; inject?: (...a: any[]) => unknown } | null
  const offs: (() => void)[] = []
  try {
    const off = anyCtx?.on?.('theme/change', () => listener())
    if (typeof off === 'function') offs.push(off as () => void)
  } catch {
    /* 事件总线不可用：仅剩 inject 补读 */
  }
  try {
    const off = anyCtx?.inject?.(['theme'], () => listener())
    if (typeof off === 'function') offs.push(off as () => void)
  } catch {
    /* 同上 */
  }
  return () => {
    for (const off of offs) {
      try {
        off()
      } catch {
        /* 退订失败不影响卸载 */
      }
    }
  }
}
