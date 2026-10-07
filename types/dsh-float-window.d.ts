// dsh-float-window 的类型垫片（tsc 用；esbuild 构建经 tsconfigRaw 忽略此 paths 映射，
// 直接打包真实源码包——README 官方消费方式：源码包由消费方 bundler 内联）
import type { ReactNode } from 'react'

export interface FloatWindowLabels {
  openTitle?: string
  expandTitle?: string
  minimizeTitle?: string
  modeToggleTip?: string
  floatText?: string
  bossKeyText?: string
}

export interface FloatWindowProps {
  /** 几何/模式持久化 key（CONTRACTS 浮窗 storageKey 规则） */
  storageKey: string
  title: string
  accent?: string
  launcherGlyph?: string
  labels?: FloatWindowLabels
  /** 显式预留老板键（如 'Alt+D'）；缺省则由 window.__dshFloatWindows 自动分配 Alt+S→X→Z→C… */
  bossKey?: string
  children: (visible: boolean, ctx: { bossKey: string }) => ReactNode
}

export declare const FloatWindow: (props: FloatWindowProps) => ReactNode
export declare function floatWindowSnapshot(): Array<{ storageKey: string; bossKey?: string }>
