import type { Context } from '@deepseek-ai/cordis'

/**
 * 本插件不再往系统提示里注入任何段落。
 *
 * 曾经有两段（tokensave 能力说明 + todo_write 纪律，共约 350 token），
 * 内容与对应工具的 schema 描述重复：`tokensave_delegate` 的描述已经说明
 * 何时该调用，`todo_write` 的描述已经要求「完成一项就标 completed」。
 * 每轮对话都携带重复的 prose 是净成本，故删除。
 *
 * 保留这个空函数是给 src/index.ts 的调用点一个稳定出口：若将来确实需要
 * 只在特定条件下出现的补充说明，在这里按 ctx.systemPrompt.section 加回。
 */
export function registerSystemPrompt(_ctx: Context): void {
  // 有意为空。
}
