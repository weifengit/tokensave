/**
 * 背景皮肤目录（全局一份，只在工作台里选；项目中心不再单独设）
 *
 * 参考 info_report 的做法（workbench.js 的 SKINS）：**按类别分组**、数量多一些。
 * 每一项给出「底色 + 背景图」两段 CSS 值，由 applySkin() 写到 :root：
 *   --ts-skin-color  底色（如 #0b1220）
 *   --ts-skin-bg     背景图（渐变 / 纹理，没有则 none）
 * 工作台 `.ts-dock`、项目中心页、浮动面板都读这两个变量。
 *
 * 深/浅两套皮，**自动跟随系统/宿主主题**（没有开关）：
 *   - 每套皮带 `mode`：深色皮强制外壳用浅字，浅色皮强制用深字
 *     （见 theme.ts 的 `html[data-ts-skin="dark|light"]`）；
 *   - 深色模式用「深色皮」栏选的那套、浅色模式用「浅色皮」栏选的那套，各存一份。
 */

// 主题探测：applySkin 必须先确定「当前是深还是浅」才能挑对应的那套皮。
// （theme.ts 不依赖 skins，所以这里单向引用，没有循环。）
import { applyTheme } from './theme'

export interface SkinItem {
  id: string
  label: string
  /** 底色（可选） */
  color?: string
  /** 背景图（渐变/纹理；可选） */
  image?: string
  /** 这套皮给哪个模式用：决定外壳前景是浅字还是深字 */
  mode: 'dark' | 'light'
}
export interface SkinGroup {
  group: string
  items: SkinItem[]
}

/** 皮肤存储键：深色模式一份、浅色模式一份（适配开关打开时各用各的）。 */
export const SKIN_KEY = 'tokensave:desk-skin.v1'
export const SKIN_KEY_LIGHT = 'tokensave:desk-skin-light.v1'
export const SKIN_GROUPS: SkinGroup[] = [
  {
    group: '纯色 · 深色',
    items: [
      { id: 'obsidian', label: '墨黑', mode: 'dark', color: '#0a0c10' },
      { id: 'deepspace', label: '深空蓝', mode: 'dark', color: '#0b1220' },
      { id: 'pine', label: '暗松绿', mode: 'dark', color: '#0a1210' },
      { id: 'ash', label: '暖灰', mode: 'dark', color: '#14120f' },
    ],
  },
  {
    group: '渐变 · 深色',
    items: [
      { id: 'dusk', label: '暮色', mode: 'dark', image: 'linear-gradient(160deg,#1a1030 0%,#3a1c4a 45%,#7a2d5a 100%)' },
      { id: 'polar', label: '极夜', mode: 'dark', image: 'linear-gradient(200deg,#04121f 0%,#0b3d4d 50%,#126e63 100%)' },
      { id: 'magma', label: '熔岩', mode: 'dark', image: 'radial-gradient(120% 90% at 20% 100%,#5b1206 0%,#160608 62%)' },
      { id: 'mint', label: '薄荷', mode: 'dark', image: 'linear-gradient(150deg,#06171a 0%,#0d3b3a 55%,#12615a 100%)' },
      { id: 'violet', label: '紫罗兰', mode: 'dark', image: 'linear-gradient(135deg,#120a24 0%,#2b1358 55%,#4b23a0 100%)' },
      { id: 'amber', label: '琥珀', mode: 'dark', image: 'radial-gradient(130% 100% at 80% 0%,#3a2405 0%,#120c05 66%)' },
      { id: 'steel', label: '钢青', mode: 'dark', image: 'linear-gradient(160deg,#0b0e14 0%,#141c26 60%,#1d2a38 100%)' },
    ],
  },
  {
    group: '科技 · 深色',
    items: [
      {
        id: 'grid',
        label: '网格',
        mode: 'dark',
        image:
          'repeating-linear-gradient(0deg,rgba(80,140,255,.07) 0 1px,transparent 1px 46px),repeating-linear-gradient(90deg,rgba(80,140,255,.07) 0 1px,transparent 1px 46px),linear-gradient(180deg,#070b14 0%,#0b1424 100%)',
      },
      {
        id: 'scanline',
        label: '扫描线',
        mode: 'dark',
        image:
          'repeating-linear-gradient(0deg,rgba(0,255,190,.05) 0 1px,transparent 1px 4px),radial-gradient(90% 70% at 50% 0%,rgba(0,255,190,.10) 0%,transparent 60%),linear-gradient(180deg,#05090c 0%,#08131a 100%)',
      },
      {
        id: 'startrail',
        label: '星轨',
        mode: 'dark',
        image:
          'repeating-radial-gradient(circle at 50% 50%,rgba(150,190,255,.06) 0 1px,transparent 1px 34px),radial-gradient(circle at 50% 50%,rgba(90,140,255,.16) 0%,transparent 62%),linear-gradient(180deg,#04060d 0%,#080d1a 100%)',
      },
      {
        id: 'neon',
        label: '霓虹',
        mode: 'dark',
        image:
          'radial-gradient(60% 60% at 15% 20%,rgba(255,0,170,.22) 0%,transparent 60%),radial-gradient(60% 60% at 85% 80%,rgba(0,220,255,.22) 0%,transparent 60%),linear-gradient(180deg,#0a0616 0%,#0e0820 100%)',
      },
      {
        id: 'hex',
        label: '蜂巢',
        mode: 'dark',
        image:
          'repeating-linear-gradient(60deg,rgba(120,170,255,.05) 0 1px,transparent 1px 34px),repeating-linear-gradient(-60deg,rgba(120,170,255,.05) 0 1px,transparent 1px 34px),repeating-linear-gradient(0deg,rgba(120,170,255,.04) 0 1px,transparent 1px 34px),linear-gradient(180deg,#060a14 0%,#0a1020 100%)',
      },
    ],
  },
  {
    group: '艺术 · 深色',
    items: [
      {
        id: 'fluid',
        label: '流体',
        mode: 'dark',
        image:
          'radial-gradient(50% 40% at 20% 25%,rgba(255,120,90,.20) 0%,transparent 65%),radial-gradient(45% 45% at 80% 30%,rgba(120,90,255,.20) 0%,transparent 65%),radial-gradient(55% 50% at 50% 90%,rgba(60,200,255,.18) 0%,transparent 65%),linear-gradient(180deg,#0b0714 0%,#120b22 100%)',
      },
      {
        id: 'aurora',
        label: '极光',
        mode: 'dark',
        image:
          'linear-gradient(115deg,transparent 20%,rgba(60,255,190,.16) 35%,transparent 50%),linear-gradient(155deg,transparent 30%,rgba(90,160,255,.16) 48%,transparent 62%),linear-gradient(195deg,transparent 25%,rgba(200,90,255,.14) 42%,transparent 58%),linear-gradient(180deg,#03070f 0%,#071021 100%)',
      },
      {
        id: 'abyss',
        label: '深海',
        mode: 'dark',
        image:
          'radial-gradient(60% 40% at 50% 0%,rgba(80,200,255,.18) 0%,transparent 65%),radial-gradient(40% 40% at 20% 85%,rgba(0,120,180,.16) 0%,transparent 65%),linear-gradient(180deg,#04121c 0%,#020a12 100%)',
      },
      {
        id: 'dune',
        label: '沙丘',
        mode: 'dark',
        image:
          'repeating-linear-gradient(-12deg,rgba(255,190,120,.05) 0 2px,transparent 2px 60px),radial-gradient(90% 60% at 20% 100%,rgba(255,170,90,.16) 0%,transparent 60%),linear-gradient(180deg,#120c07 0%,#1e1409 100%)',
      },
      {
        id: 'velvet',
        label: '丝绒',
        mode: 'dark',
        image:
          'radial-gradient(80% 70% at 30% 20%,rgba(255,90,140,.20) 0%,transparent 60%),radial-gradient(70% 60% at 80% 85%,rgba(120,60,255,.18) 0%,transparent 60%),linear-gradient(180deg,#140a12 0%,#1c0f1c 100%)',
      },
    ],
  },
  {
    group: '纯色 · 浅色',
    items: [
      { id: 'l-plain', label: '净白', mode: 'light', color: '#ffffff' },
      { id: 'l-warm', label: '米白', mode: 'light', color: '#f7f2e8' },
      { id: 'l-blue', label: '淡蓝', mode: 'light', color: '#eef4ff' },
      { id: 'l-gray', label: '浅灰', mode: 'light', color: '#f1f3f6' },
      { id: 'l-green', label: '淡绿', mode: 'light', color: '#eef8f1' },
    ],
  },
  {
    group: '渐变 · 浅色',
    items: [
      { id: 'l-mint', label: '薄荷', mode: 'light', image: 'linear-gradient(150deg,#f4fbf7 0%,#eaf6f2 60%,#e4f1f6 100%)' },
      { id: 'l-dawn', label: '晨曦', mode: 'light', image: 'linear-gradient(160deg,#fff8f1 0%,#f3f1fb 55%,#eef4ff 100%)' },
      { id: 'l-sky', label: '青空', mode: 'light', image: 'linear-gradient(180deg,#f2f8ff 0%,#e8f1fd 60%,#eaf6fb 100%)' },
      { id: 'l-rose', label: '薄雾', mode: 'light', image: 'radial-gradient(120% 90% at 15% 0%,#fdf3f6 0%,#f7f4fa 55%,#eef2f7 100%)' },
      {
        id: 'l-linen',
        label: '亚麻',
        mode: 'light',
        image:
          'repeating-linear-gradient(0deg,rgba(120,110,90,.035) 0 1px,transparent 1px 18px),repeating-linear-gradient(90deg,rgba(120,110,90,.035) 0 1px,transparent 1px 18px),linear-gradient(180deg,#fbf9f4 0%,#f3f1ea 100%)',
      },
    ],
  },
]

/** 全部皮肤（分组打平，便于按 id 查）。 */
export const SKINS: SkinItem[] = SKIN_GROUPS.flatMap((g) => g.items)

/** 皮肤 id → 那一条（找不到给 null）。 */
export function skinOf(id: string): SkinItem | null {
  return SKINS.find((s) => s.id === id) ?? null
}

/** 当前宿主主题（读 <html data-ts-theme>，由 theme.ts 维护）。 */
export function currentThemeMode(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-ts-theme') === 'light' ? 'light' : 'dark'
}

/** 读某模式选的皮肤 id（兼容旧格式：旧版只有一条 background 字符串）。 */
export function readSkinId(mode: 'dark' | 'light' = currentThemeMode()): string {
  try {
    const key = mode === 'light' ? SKIN_KEY_LIGHT : SKIN_KEY
    const raw = window.localStorage.getItem(key)
    if (!raw) return ''
    if (skinOf(raw)) return raw
    const hit = SKINS.find((s) => s.image === raw)
    return hit ? hit.id : ''
  } catch {
    return ''
  }
}

/**
 * 应用皮肤（解析适配开关与当前主题后，写 :root 变量 + <html data-ts-skin>）。
 *   adapt on  → 用当前模式对应的那套皮；
 *   adapt off → 只用「深色皮」那一栏选的那套（不管宿主什么主题）。
 * 传 id 时强制用这一套（用于「点了就立刻看到」）。
 */
export function applySkin(id?: string): void {
  // 先确保 <html data-ts-theme> 已经就位（插件加载时 bootSkin 可能早于主题监听）
  applyTheme()
  // **永远**按当前主题取对应那套皮：深色模式用深色皮、浅色模式用浅色皮（各存一份）。
  // 不做开关：用户电脑切深浅，界面就跟着切，多一个开关只会状态错乱（用户明确要求）。
  const mode = currentThemeMode()
  const pick = id !== undefined ? id : readSkinId(mode)
  const skin = skinOf(pick)
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    // 只有图没有色的皮肤要垫一层不透明底（否则半透明纹理层会透出宿主主题底）
    const color = skin ? (skin.color ?? (skin.image ? (skin.mode === 'light' ? '#ffffff' : '#0b0e14') : '')) : ''
    if (color) root.style.setProperty('--ts-skin-color', color)
    else root.style.removeProperty('--ts-skin-color')
    if (skin?.image) root.style.setProperty('--ts-skin-bg', skin.image)
    else root.style.removeProperty('--ts-skin-bg')
    root.setAttribute('data-ts-skin', skin ? skin.mode : 'none')
  }
}

/** 存下某模式选的皮肤（写盘）+ 立刻应用。 */
export function chooseSkin(id: string, mode: 'dark' | 'light' = currentThemeMode()): void {
  try {
    const key = mode === 'light' ? SKIN_KEY_LIGHT : SKIN_KEY
    if (id) window.localStorage.setItem(key, id)
    else window.localStorage.removeItem(key)
  } catch {
    /* 隐私模式：仅本次会话有效 */
  }
  applySkin()
}

/** 启动时按存储恢复一次皮肤。 */
export function bootSkin(): void {
  applySkin()
}
