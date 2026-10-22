/**
 * 提示音跨端同步自检。
 *
 *   node scripts/check-sound-sync.mjs
 *
 * 本次反馈：「手机发了信息，电脑端的提示音还在一直响着；手机上调呼吸灯面板里的开关
 * 控制不了电脑端」——根因是设置只存在各浏览器自己的 localStorage。
 *
 * 这里钉三件事：
 *   1. 服务端存储：落盘、跨实例可读、rev 单调递增、脏载荷被拒；
 *   2. 广播链路：SSE 首帧带当前状态、apply 后广播给在线客户端、dispose 收尾
 *      （用假 res 直接验线格式，不需要真起 HTTP 服务）；
 *   3. 两端接线：路径常量必须一字不差、入口必须调 startSoundSync、
 *      客户端必须把「远端关掉」翻译成 stopSound()。
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'ts-soundsync-'))

let fail = 0
const check = (label, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

try {
  const out = join(dir, 'sound-sync.mjs')
  await build({
    entryPoints: [join(root, 'src/sound-sync.ts')],
    bundle: true, format: 'esm', outfile: out, platform: 'node', logLevel: 'silent',
  })
  const m = await import(out)

  // —— 假 SSE 响应：只记下写出去的东西，够验线格式 ——
  const fakeRes = () => {
    const chunks = []
    const res = {
      chunks, status: 0, headers: null, ended: false, writableEnded: false, destroyed: false,
      writeHead(status, headers) { res.status = status; res.headers = headers; return res },
      write(s) { chunks.push(String(s)); return true },
      end() { res.ended = true; res.writableEnded = true },
      on() {},
    }
    return res
  }
  const frames = (res) => res.chunks.join('').split('\n\n').filter((s) => s.trim())
  const settingsFrames = (res) => frames(res).filter((f) => f.includes('event: settings'))

  // ============ 1. 服务端存储 ============
  const file = join(dir, 'sound.json')
  const a = m.createSoundSync(file)

  check('未写过时 rev=0、settings 为空（不臆造默认值）',
    a.snapshot().rev === 0 && Object.keys(a.snapshot().settings).length === 0,
    JSON.stringify(a.snapshot()))

  const s1 = a.apply({ enabled: false, volume: 0.3, duration: 'forever' }, 'dev-phone')
  check('apply 后 rev=1、载荷原样保留、记录来源与时间',
    s1.rev === 1 && s1.settings.enabled === false && s1.settings.volume === 0.3 &&
    s1.updatedBy === 'dev-phone' && s1.updatedAt > 0,
    JSON.stringify(s1))

  const s2 = a.apply({ enabled: true }, 'dev-desktop')
  check('rev 单调递增（两端并发写也不会回退）', s2.rev === 2 && s2.updatedBy === 'dev-desktop')

  // 换一个实例读同一个文件 —— 证明是**落盘**的真相源，不是进程内缓存
  const b = m.createSoundSync(file)
  const reloaded = b.snapshot()
  check('跨实例（等同跨重启）读到同一份状态',
    reloaded.rev === 2 && reloaded.settings.enabled === true,
    JSON.stringify(reloaded))
  check('落盘文件带 version 字段（将来可迁移）',
    JSON.parse(readFileSync(file, 'utf8')).version === m.SOUND_VERSION)

  // 脏载荷
  const rejects = (raw) => { try { m.sanitizeSettingsPayload(raw); return false } catch { return true } }
  check('非对象载荷被拒（数组 / null / 字符串 / 数字）',
    rejects([]) && rejects(null) && rejects('x') && rejects(42))
  check('超大载荷被拒（防止客户端往这里塞别的东西）',
    rejects({ padding: 'x'.repeat(5000) }))
  check('正常对象通过且是深拷贝（改入参不影响已存值）', (() => {
    const src = { enabled: false }
    const copy = m.sanitizeSettingsPayload(src)
    src.enabled = true
    return copy.enabled === false
  })())

  // ============ 2. 广播链路（SSE） ============
  const c = m.createSoundSync(join(dir, 'sse.json'))
  const res1 = fakeRes()
  c.openStream({ on() {} }, res1)

  check('SSE 响应头：text/event-stream + 不缓存 + 不缓冲',
    res1.status === 200 &&
    String(res1.headers['Content-Type']).startsWith('text/event-stream') &&
    /no-cache/.test(String(res1.headers['Cache-Control'])) &&
    String(res1.headers['X-Accel-Buffering']) === 'no')
  check('开流即推首帧（客户端不必等下一次改动）',
    settingsFrames(res1).length === 1 && /"rev":0/.test(settingsFrames(res1)[0]))
  check('带 retry，断线重连间隔明确', res1.chunks.join('').includes('retry: 3000'))
  check('在线端计数 +1', c.clientCount() === 1)

  c.apply({ enabled: false }, 'dev-phone')
  const pushed = settingsFrames(res1)
  check('apply 后广播给在线客户端（这就是「电脑端当场静音」的那一帧）',
    pushed.length === 2 && /"enabled":false/.test(pushed[1]) && /"rev":1/.test(pushed[1]),
    pushed[1] ? pushed[1].slice(0, 80) : '(无)')

  // 第二个客户端也应收到
  const res2 = fakeRes()
  c.openStream({ on() {} }, res2)
  check('新接入的客户端立刻拿到当前状态（rev 1）',
    settingsFrames(res2).length === 1 && /"rev":1/.test(settingsFrames(res2)[0]))
  check('两端同时在线', c.clientCount() === 2)

  // 断开的连接要被清掉，而不是一直往里写
  res1.destroyed = true
  c.apply({ enabled: true }, 'dev-desktop')
  check('已断开的连接被剔除（不再堆积）', c.clientCount() === 1)
  check('活着的那个仍然收到广播', /"enabled":true/.test(settingsFrames(res2).join('')))

  // —— 交互广播：任一端拦停 → 所有端静音（不改设置、不动 rev）——
  // 用户反馈：「在 dsh 页面操作不能停止声音了」。提示音是每个客户端各自播的，
  // 只停本地时另一台设备仍在响；这里钉住 stop 帧与「不改 rev」这两条硬约束。
  const revBefore = c.snapshot().rev
  c.stop('dev-phone')
  const stopFrames = frames(res2).filter((f) => f.includes('event: stop'))
  check('stop 广播到达在线端（另一端当场静音）',
    stopFrames.length === 1 && /"by":"dev-phone"/.test(stopFrames[0]),
    stopFrames[0] ? stopFrames[0].slice(0, 80) : '(无)')
check('stop 广播不改设置（不动 rev，与设置同步互不干扰）',
    c.snapshot().rev === revBefore)
// —— 跨实例：手机与电脑可能连的是**不同的 DSH 实例** ——
// 现象：「电脑端响了，我在手机远程里面操作甚至发了消息，电脑端依然在响提示音」。
// 根因：stop 事件只经**进程内**的 SSE 广播（只在同一实例内有效），
//      而两个实例之间的唯一公共面是落盘文件 → 静音事件必须**落盘**。
const revBeforeStop = c.snapshot().rev
const stopPayload = c.stop('dev-phone')
check('stop 事件落盘（跨实例的唯一通道）',
    c.snapshot().stopAt === stopPayload.at && c.snapshot().stopBy === 'dev-phone',
    `stopAt=${c.snapshot().stopAt} stopBy=${c.snapshot().stopBy}`)
check('stop 不动 rev（它不是设置，不该污染设置同步）',
    c.snapshot().rev === revBeforeStop)
// 另一个实例（= 另一台设备连的那个 DSH 进程）读同一个文件 → 必须看到那次静音
const other = m.createSoundSync(join(dir, 'sse.json'))
const otherSnap = other.snapshot()
check('跨实例读到对方的静音事件（手机写的，电脑那个实例读得到）',
    otherSnap.stopAt === stopPayload.at && otherSnap.stopBy === 'dev-phone',
    `other.stopAt=${otherSnap.stopAt} other.stopBy=${otherSnap.stopBy}`)
check('落盘文件里带着 stopAt/stopBy（重启后也不丢）',
    (() => { const raw = JSON.parse(readFileSync(join(dir, 'sse.json'), 'utf8')); return raw.stopAt === stopPayload.at && raw.stopBy === 'dev-phone' })())

  c.dispose()
  check('dispose 收掉长连接并清空在线表', res2.ended === true && c.clientCount() === 0)

  // ============ 3. 两端接线 ============
  const route = readFileSync(join(root, 'src/sound-sync.ts'), 'utf8')
  const server = readFileSync(join(root, 'src/board-web-route.ts'), 'utf8')
  const sound = readFileSync(join(root, 'client/src/panel/sound.ts'), 'utf8')
  const entry = readFileSync(join(root, 'client/src/index.ts'), 'utf8')

  const pathOf = (src) => (src.match(/\/plugins\/dsh-tokensave\/sound-settings/g) || []).length
  check('路径常量两端一致（只有一处定义，客户端引用同一字符串）',
    pathOf(route) === 1 && /SYNC_PATH = '\/plugins\/dsh-tokensave\/sound-settings'/.test(sound))

  check('服务端把路由挂上，并在注销时收掉长连接',
    /\[SOUND_SETTINGS_ROUTE_PATH, soundGuard\]/.test(server) &&
    /soundSync\.dispose\(\)/.test(server) &&
    /createSoundSync\(path\.join\(dshHomeDir\(\), 'tokensave', 'sound\.json'\)\)/.test(server))

  check('服务端 GET 分流：Accept 要求 SSE 才走长连接，其余给快照',
    /accept\.includes\('text\/event-stream'\)/.test(server) &&
    /writeJson\(res, 200, soundSync\.snapshot\(\)\)/.test(server))

  check('客户端在**插件入口**启动同步（面板关着也得能收到广播）',
    /import \{ startSoundSync \} from '\.\/panel\/sound'/.test(entry) &&
    /startSoundSync\(\)/.test(entry))


check('客户端：长连接 + **常驻**快照轮询（跨实例也要靠它读共享文件）',
    /new EventSource\(SYNC_PATH\)/.test(sound) &&
    /addEventListener\('settings'/.test(sound) &&
    /startSnapshotPoll\(\)/.test(sound) && /SNAPSHOT_POLL_MS = 2_500/.test(sound) &&
    // 轮询**不能**只在长连接断了时才跑（旧实现：if (streamOpen) return）
    !/if \(streamOpen\) return/.test(sound))


  check('客户端：rev 单调守卫（自己的回声不会成环）',
    /let appliedRev = -1/.test(sound) &&
    /if \(state\.rev <= appliedRev\) return false/.test(sound))

  check('客户端：手动 ■ 与页面交互都走「本地停 + 广播」（否则另一台设备还在响）',
    /export function stopSoundEverywhere\(\): void \{/.test(sound) &&
    // 函数体内两行：先本地停，再广播（中间隔一个换行，不是同行）
    /export function stopSoundEverywhere\(\): void \{[\s\S]{0,40}?stopSound\(\)\n\s*broadcastStop\(\)/.test(sound) &&
    /action: 'stop'/.test(sound))
  check('客户端：本端关掉开关就当场静音（自己的回包被 rev 守卫挡掉，不能指望回包）',
    /const wasEnabled = settings\.enabled/.test(sound) &&
    /if \(wasEnabled && !settings\.enabled\) stopSound\(\)/.test(sound))
  check('客户端：收到别端的 stop 帧 → stopSound()（自己的那条要忽略）',
    /addEventListener\('stop', \(ev: MessageEvent\) => \{/.test(sound) &&
    /if \(by && by === deviceId\(\)\) return[\s\S]{0,60}?stopSound\(\)/.test(sound))
  check('服务端：POST action=stop 分流到 broadcast（在读 settings 之前）',
    /parsed\.action === 'stop'[\s\S]{0,200}?soundSync\.stop\(/.test(server))

check('客户端：本端没在响也广播（同一声告警可能在另一个标签页/设备上响，按 1.5s 节流）',
    /IDLE_STOP_BROADCAST_MS = 1_500/.test(sound) &&
    /if \(now - lastIdleStopAt < IDLE_STOP_BROADCAST_MS\) return[\s\S]{0,80}?broadcastStop\(\)/.test(sound))
check('客户端：一开始就挂「用户一操作就停」的监听（不能等本端响过声音才挂）',
    /export function startSoundSync\(\)[\s\S]{0,600}?armAutoStop\(\)/.test(sound) &&
    /export function startSoundSync\(\)[\s\S]{0,600}?startSnapshotPoll\(\)/.test(sound))
check('客户端：静音事件按时间戳去重（不动 rev），且忽略自己的设备号',
    /let appliedStopAt = 0/.test(sound) &&
    /function applySnapshot\(state: any\): void/.test(sound) &&
    /if \(stopAt > appliedStopAt\)/.test(sound) &&
    /if \(!by \|\| by !== deviceId\(\)\) stopSound\(\)/.test(sound))
check('服务端：每次读快照都重新读盘（不认进程内缓存，否则看不到另一个实例的改动）',
    /const load = \(\): SoundState => \{/.test(route) &&
    !/if \(state\) return state/.test(route) &&
    /stopAt: Number\.isFinite\(data\?\.stopAt\)/.test(route))

  check('客户端：远端关掉 → 立刻 stopSound()（正在响的当场停）',
    /if \(!next\.enabled\) stopSound\(\)/.test(sound))

  check('客户端：改设置后上报（去抖，避免音量拖动打爆服务端）',
    /schedulePush\(\)/.test(sound) && /PUSH_DEBOUNCE_MS = 300/.test(sound) &&
    /method: 'POST'/.test(sound))

  check('客户端：服务端从未写过时用本端设置当种子（否则手机已关的开关会被默认值打开）',
    /state\.rev === 0/.test(sound) && /appliedRev = 0[\s\S]{0,60}?await pushNow\(\)/.test(sound))

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}