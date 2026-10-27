/**
 * 脱敏设置路由：GET 读快照、POST 合并写入。
 *
 * 客户端「设置 → 脱敏」面板唯一的数据通道；写的是 runtime.json，
 * Python 端下一次调用就会热加载（无需重启 Harness）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { methodNotAllowed, rejectionFor, rejectUnauthorized, writeJson } from '../web/http-json.ts'
import { readMaskSettings, writeMaskSettings } from './mask-settings.ts'

export const MASK_SETTINGS_ROUTE_PATH = '/plugins/dsh-tokensave/mask-settings'

/** GET = 快照；POST = 合并写入（自行鉴权 + 方法判定）。 */
export function createMaskSettingsGuard(ctx: Context): (req: any, res: any) => void {
  return (req: any, res: any) => {
    const rejection = rejectionFor(ctx, req)
    if (rejection !== undefined) {
      rejectUnauthorized(res, rejection)
      return
    }
    if (req.method === 'GET') {
      writeJson(res, 200, readMaskSettings())
      return
    }
    if (req.method !== 'POST') {
      methodNotAllowed(res)
      return
    }
    // 防挂死：拿不到请求流就明确报错，而不是既不读也不回应
    if (typeof req.on !== 'function') {
      writeJson(res, 501, { error: 'request stream unavailable' })
      return
    }
    let body = ''
    req.on('data', (chunk: any) => { body += String(chunk) })
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {}
        writeJson(res, 200, writeMaskSettings(parsed))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'invalid mask settings payload'
        console.warn('[dsh-tokensave] 脱敏设置保存失败:', message)
        writeJson(res, 400, { error: message })
      }
    })
  }
}
