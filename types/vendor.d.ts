/**
 * 文本导入声明（Step 13 · Step A）。
 *
 * 构建侧用 esbuild 的 text loader 把 vendor 文件当**字符串**打进产物
 * （见 scripts/build-client.mjs）：dockview-core.min.js 是 UMD，必须用
 * `new Function(src)()` 在全局作用域执行才能拿到 API（原因见 vendor/dockview.ts）。
 */

declare module '*.css' {
  const content: string
  export default content
}

declare module '*.min.js' {
  const content: string
  export default content
}
