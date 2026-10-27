/**
 * 原始 HTTP 路由的公共小工具（JSON 响应 / 方法判定 / 鉴权栅栏）。
 *
 * 为什么单独成模块：板路由（board-web-route.ts）与脱敏设置路由
 * （mask/mask-route.ts）都要用同一套响应与鉴权语义——复制两份迟早会漂移。
 */

import type { Context } from '@deepseek-ai/cordis'

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
})

/** 写 JSON 响应；客户端已断开时静默忽略。 */
export function writeJson(res: any, status: number, body: unknown): void {
  try {
    res.writeHead(status, JSON_HEADERS)
    res.end(JSON.stringify(body))
  } catch {
    /* 客户端可能已断开 */
  }
}

export function methodNotAllowed(res: any): void {
  writeJson(res, 405, { error: 'method not allowed' })
}

/**
 * 原始路由不继承 Connection 鉴权：每个请求先过 connection.requestRejection。
 * 返回 undefined = 放行；否则是要回给客户端的状态码（503 网关未就绪 / 401 未认证）。
 */
export function rejectionFor(ctx: Context, req: any): number | undefined {
  try {
    const gate = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    if (gate === undefined) return 503
    if (typeof gate.requestRejection === 'function') return gate.requestRejection(req)
    return undefined
  } catch {
    return 503
  }
}

/** 统一的鉴权拒绝响应。 */
export function rejectUnauthorized(res: any, status: number): void {
  writeJson(res, status, { error: status === 503 ? 'authentication unavailable' : 'unauthorized' })
}
