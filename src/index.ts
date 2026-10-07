import type { Context } from '@deepseek-ai/cordis'
import { registerSystemPrompt } from './prompt/system-prompt.ts'
import { createTokensaveDelegateTool } from './tools/smart-delegator.ts'
import { mountTokensaveWebRoutes } from './board-web-route.ts'

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
}
