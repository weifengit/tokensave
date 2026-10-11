import fs from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { registerSystemPrompt } from './prompt/system-prompt.ts'
import { createTokensaveDelegateTool } from './tools/smart-delegator.ts'
import { mountTokensaveWebRoutes } from './board-web-route.ts'
import { registerBlackboardTools } from './blackboard/tools.ts'

export const name = 'dsh-tokensave'

export const inject = {
  tools: true,
  systemPrompt: true,
  sessions: true,
  llm: true,
}

export function apply(ctx: Context) {
  console.log('[dsh-tokensave] plugin loaded!')
  registerSystemPrompt(ctx)
  ctx.tools.register(createTokensaveDelegateTool(ctx))
  mountTokensaveWebRoutes(ctx)
  // 黑板自建存储的同名工具（board_post/board_list/board_clear）——去 dsh-call-session 化；
  // 与第三方插件同名是刻意的兼容设计，详见 src/blackboard/tools.ts 头注。
  const reg = registerBlackboardTools(ctx)
  // 注册结果标记（诊断）：HMR 每次重载 apply 都会覆写它——mtime 新鲜 = 重载确实发生，
  // tools_ok=3 = 三工具全部入注册表。写 /tmp，不碰插件数据目录。
  try {
    fs.writeFileSync('/tmp/tokensave-apply.marker', `${new Date().toISOString()} tools_ok=${reg.ok}/3 errors=${JSON.stringify(reg.errors)}\n`)
  } catch { /* 标记失败不影响插件 */ }
}
