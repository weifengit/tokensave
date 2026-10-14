// react-dom 的类型垫片（tsc 用）。
//
// 为什么需要：构建脚本 scripts/build-client.mjs 把 react-dom 列为 external
// （与 react 同款平台种子），产物由宿主的运行时模块表提供实现；但本仓库没装
// react-dom 的 @types，tsc 会报 TS2307。这里只声明我们实际用到的 createPortal。
declare module 'react-dom' {
  import type { ReactNode } from 'react'
  /** 把子树渲染到另一个 DOM 容器（用于逃出 overflow:hidden 祖先的浮层）。 */
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactNode
  /** 带 key 的重载（数组里渲染多个 portal 时需要；React 18/19 均支持）。 */
  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactNode
}
