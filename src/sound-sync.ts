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
  /**
   * 最近一次「全体静音」事件的时间戳（毫秒）。
   *
   * 为什么它必须**落盘**：手机与电脑可能连的是**不同的 DSH 实例**
   * （桌面 127.0.0.1:3080，手机走 anynet 网关那个实例）。SSE 长连接只在
   * **同一实例**内有效，广播跨不过去；而落盘文件是两个实例唯一的公共面。
   * 客户端靠它判「有没有新的静音事件」（比 rev 合适：它不是设置，不该动 rev）。
   */
  stopAt: number
  /** 那次静音是哪个设备发起的（客户端据此忽略自己的回声） */
  stopBy: string
  settings: Record<string, unknown>
}

/** 文件结构版本（将来若要迁移字段，用它与 SOUND_VERSION 比对）。 */
export const SOUND_VERSION = 1

/** 设置对象的体积上限：它只有几个标量，超过就说明客户端在塞别的东西。 */
const MAX_SETTINGS_BYTES = 4096

/** SSE 心跳间隔：穿过反向代理/网关时防空闲断链（30s 是常见阈值）。 */
const HEARTBEAT_MS = 25_000

function emptyState(): SoundState {
  return { rev: 0, updatedAt: 0, updatedBy: '', stopAt: 0, stopBy: '', settings: {} }
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
  /**
   * 广播一次「停止正在响的提示音」（不改设置、不改 rev）。
   *
   * 为什么需要它：提示音在**每一个在线客户端**上各自播放（手机、电脑、另一个标签页
   * 都可能同时在响）。只在本地 stopSound 的话，用户在这一端点了/滚了，另一端还在响
   * ——听感就是「在 dsh 页面操作停不下来」。所以任一端拦停时向所有端广播一次。
   */
  stop(by: string): { at: number; by: string }
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

  /**
   * 读当前状态。
   *
   * ⚠️ **每次都重新读盘**（不再只认进程内缓存）：跨实例同步全靠这一份文件 ——
   * 另一个实例（手机那个 / 电脑这个）改了它，本实例必须马上看到，
   * 否则「手机一操作，电脑端静音」永远传不过来（用户反馈：「提示音还是各管各的」）。
   * 文件很小（几百字节），读取只发生在快照请求与写操作上，代价可忽略。
   */
  const load = (): SoundState => {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      state = {
        rev: Number.isFinite(data?.rev) ? Number(data.rev) : 0,
        updatedAt: Number.isFinite(data?.updatedAt) ? Number(data.updatedAt) : 0,
        updatedBy: typeof data?.updatedBy === 'string' ? data.updatedBy : '',
        stopAt: Number.isFinite(data?.stopAt) ? Number(data.stopAt) : 0,
        stopBy: typeof data?.stopBy === 'string' ? data.stopBy : '',
        settings: sanitizeSettingsPayload(data?.settings ?? {}),
      }
    } catch {
      // 文件不存在 / 损坏：用内存里那份（刚写过的），不阻塞插件启动
      if (!state) state = emptyState()
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
        // 设置变更**不**动静音事件（那是另一条互不干扰的路）
        stopAt: prev.stopAt,
        stopBy: prev.stopBy,
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

    stop(by: string) {
      const payload = { at: Date.now(), by: String(by || '').slice(0, 64) }
      // ① 落盘：跨实例的唯一通道（手机那个实例写的，电脑这个实例读得到）
      const prev = load()
      state = { ...prev, stopAt: payload.at, stopBy: payload.by }
      persist(state)
      // ② 同实例内：立刻推给在线客户端（毫秒级，不用等轮询）
      for (const res of [...clients]) {
        if (res.writableEnded || res.destroyed) {
          drop(res)
          continue
        }
        send(res, 'stop', payload)
      }
      // ③ 再推一份状态：本实例里靠轮询快照的客户端也能立刻看到（跨实例靠上面的落盘）
      broadcast(state)
      return payload
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