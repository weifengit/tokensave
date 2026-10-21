/**
 * 提示音设置的跨端共享（手机 ↔ 电脑）。
 *
 * 背景（用户反馈）：提示音设置原本只写在各浏览器自己的 localStorage 里 ——
 * 在手机上关掉开关，电脑端该响还响；「一直响」那一档尤其难受，人不在电脑前就关不掉。
 *
 * 做法：
 *   1. 设置以**服务端文件**为准（~/.dsh/tokensave/sound.json），所有端共享同一份；
 *   2. 改动 POST 落盘后经 SSE 广播给每一个在线客户端（含另一台设备上的浏览器）；
 *   3. rev 单调递增：客户端只在 rev 变大时应用，自己写出去的回声不会成环；
 *   4. 客户端收到 enabled=false 会立即 stopSound() —— 正在响的那一端当场停下，
 *      不必等它响完。这是「手机一关，电脑立刻静音」的关键一步。
 *
 * 为什么用 SSE 而不是轮询：电脑端常常停在**后台标签页**，浏览器会把后台定时器
 * 节流到分钟级，轮询做不到「马上就停」。SSE 是一条长连接，不受定时器节流影响。
 * （客户端仍保留一个低频快照轮询作为兜底，只在长连接没能建立时才启用。）
 *
 * 载荷策略：设置对象对服务端是**不透明**的（形状由客户端 sound.ts 的 normalize 负责），
 * 服务端只做「必须是对象 + 体积上限」两道校验 —— 这样加字段/改枚举不必同时改两边。
 */
import fs from 'node:fs'
import path from 'node:path'

export const SOUND_SETTINGS_ROUTE_PATH = '/plugins/dsh-tokensave/sound-settings'

/** 一次广播/落盘的完整状态（客户端只认 rev 与 settings）。 */
export interface SoundState {
  /** 单调递增版本号：客户端只在它变大时应用 */
  rev: number
  updatedAt: number
  /** 谁改的（客户端上报的设备号，仅用于日志与排查） */
  updatedBy: string
  settings: Record<string, unknown>
}

/** 文件结构版本（将来若要迁移字段，用它与 SOUND_VERSION 比对）。 */
export const SOUND_VERSION = 1

/** 设置对象的体积上限：它只有几个标量，超过就说明客户端在塞别的东西。 */
const MAX_SETTINGS_BYTES = 4096

/** SSE 心跳间隔：穿过反向代理/网关时防空闲断链（30s 是常见阈值）。 */
const HEARTBEAT_MS = 25_000

function emptyState(): SoundState {
  return { rev: 0, updatedAt: 0, updatedBy: '', settings: {} }
}

/**
 * 校验并深拷贝客户端上报的设置。
 * 只保证「是对象」与「不超限」，具体字段交给客户端的 normalize 兜底。
 */
export function sanitizeSettingsPayload(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('settings must be a plain object')
  }
  const json = JSON.stringify(raw)
  if (json.length > MAX_SETTINGS_BYTES) {
    throw new Error('settings payload too large')
  }
  return JSON.parse(json) as Record<string, unknown>
}

export interface SoundSync {
  /** 当前状态（首次调用时读盘，之后走内存）。 */
  snapshot(): SoundState
  /** 落盘并广播；返回新状态（rev +1）。 */
  apply(settings: Record<string, unknown>, by: string): SoundState
  /** 把这次响应升级成 SSE 长连接，并立即推一份当前状态。 */
  openStream(req: any, res: any): void
  /** 当前在线长连接数（自检/日志用）。 */
  clientCount(): number
  dispose(): void
}

/**
 * 建立一处共享存储 + 广播中枢。
 * @param filePath 落盘路径，形如 ~/.dsh/tokensave/sound.json
 */
export function createSoundSync(filePath: string): SoundSync {
  let state: SoundState | null = null
  const clients = new Set<any>()

  const load = (): SoundState => {
    if (state) return state
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      state = {
        rev: Number.isFinite(data?.rev) ? Number(data.rev) : 0,
        updatedAt: Number.isFinite(data?.updatedAt) ? Number(data.updatedAt) : 0,
        updatedBy: typeof data?.updatedBy === 'string' ? data.updatedBy : '',
        settings: sanitizeSettingsPayload(data?.settings ?? {}),
      }
    } catch {
      // 文件不存在 / 损坏：从空状态起，不阻塞插件启动
      state = emptyState()
    }
    return state
  }

  const persist = (next: SoundState): void => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify({ version: SOUND_VERSION, ...next }, null, 2), 'utf8')
    fs.renameSync(tmp, filePath) // 原子替换：读到的永远是完整 JSON
  }

  const send = (res: any, event: string, payload: unknown): void => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
    } catch {
      /* 对端已断开：下一次广播会把它清掉 */
    }
  }

  const drop = (res: any): void => {
    clients.delete(res)
  }

  const broadcast = (next: SoundState): void => {
    for (const res of [...clients]) {
      if (res.writableEnded || res.destroyed) {
        drop(res)
        continue
      }
      send(res, 'settings', next)
    }
  }

  return {
    snapshot: () => load(),

    apply(settings, by) {
      const prev = load()
      const next: SoundState = {
        rev: prev.rev + 1,
        updatedAt: Date.now(),
        updatedBy: String(by || '').slice(0, 64),
        settings,
      }
      persist(next)
      state = next
      broadcast(next)
      return next
    },

    openStream(req, res) {
      try {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, no-transform',
          Connection: 'keep-alive',
          // nginx 一类反代会缓冲上游响应，这一头显式要求不缓冲
          'X-Accel-Buffering': 'no',
        })
      } catch {
        return
      }
      // retry: 断线后客户端多久重连（EventSource 默认 3s，这里写死让它更明确）
      res.write('retry: 3000\n\n')
      send(res, 'settings', load())
      clients.add(res)

      const hb = setInterval(() => {
        try {
          res.write(': hb\n\n')
        } catch {
          /* noop */
        }
      }, HEARTBEAT_MS)
      // 心跳不该拖住进程退出
      if (typeof (hb as any).unref === 'function') (hb as any).unref()

      const close = (): void => {
        clearInterval(hb)
        drop(res)
      }
      req.on?.('close', close)
      req.on?.('error', close)
      res.on?.('close', close)
    },

    clientCount: () => clients.size,

    dispose() {
      for (const res of [...clients]) {
        try {
          res.end()
        } catch {
          /* noop */
        }
      }
      clients.clear()
    },
  }
}