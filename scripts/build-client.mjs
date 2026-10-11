// 客户端构建（Step 11）：client/src → dist/client.js
// 产物必须是 __ModuleLoader__ 注册格式的 classic-script（Step 02 已知问题约定）：
//   window.__ModuleLoader__.load({ id, factory(require) → exports })
// esbuild 以 CJS 格式打包（外部包经 factory 的 require 走运行时模块表：react 等平台种子），
// 外层信封提供 module/exports 变量并返回 module.exports —— 与 dsh-deepseek-web-login
// 等官方插件产物结构一致。
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'

const ID = 'dsh-tokensave'
const RAW = 'dist/.client.raw.js'
const OUT = 'dist/client.js'

mkdirSync('dist', { recursive: true })

await build({
  entryPoints: ['client/src/index.ts'],
  outfile: RAW,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  tsconfigRaw: '{}',
  legalComments: 'none',
  logLevel: 'info',
})

const raw = readFileSync(RAW, 'utf8')
const envelope = [
  `window.__ModuleLoader__.load({`,
  `\tid: ${JSON.stringify(ID)},`,
  `\tfactory: (require) => {`,
  `\tvar module = { exports: {} };`,
  `\tvar exports = module.exports;`,
  `\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`,
  raw,
  `\treturn module.exports;`,
  `\t}`,
  `});`,
  ``,
]
writeFileSync(OUT, envelope.join('\n'))
rmSync(RAW, { force: true })
console.log(`[build-client] ${OUT} written (${readFileSync(OUT, 'utf8').length} bytes)`)
