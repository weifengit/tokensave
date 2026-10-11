/**
 * 告警音的**起音时机**（纯函数，独立成模块：不依赖 React/DOM，可以在 node 里单测）。
 *
 * 需求背景：结局告警进来时，**角标先上屏、声音随后半拍**（两帧 ≈ 16–32ms），
 * 让眼睛和耳朵同步感知，不再是「先听到、后看到」。所以起音挂在两帧 rAF 之后。
 *
 * 但 rAF 有个致命前提：**它只在页面可见时才跑**。标签页切走 / 浏览器最小化
 * （document.visibilityState === 'hidden'）时，挂上去的 rAF 回调**一次都不会执行**
 * ——实测：在隐藏标签页里挂一个 rAF，5 秒内回调始终没有触发。
 * 只走 rAF 的写法会把提示音整个吞掉：不是延迟，是直到用户切回那个标签页才响。
 *
 * 所以这里在 rAF 之外**再加一条定时兜底**：两帧没跑到就把声音补上。
 * 可见时 rAF（约 33ms）先到，视觉同步不变；隐藏时兜底到点起音（隐藏页的
 * timer 会被浏览器节流，但只会慢一点，不会不响）。
 *
 * `env` 可注入（单测用假 rAF / 假定时器），默认取全局的 requestAnimationFrame / setTimeout。
 */
export interface KickEnv {
  /** 可见时的「两帧后」通道；环境没有 rAF 时退化为定时器 */
  requestAnimationFrame?: (cb: () => void) => number
  setTimeout: (cb: () => void, ms: number) => number
}

/** rAF 兜底：两帧（≈33ms）远小于它，可见时不会抢跑；隐藏时它负责把声音补上 */
export const KICK_FALLBACK_MS = 120
/** 环境没有 rAF 时的固定延时 */
export const KICK_NO_RAF_MS = 32

function defaultEnv(): KickEnv {
  const g = globalThis as any
  return {
    requestAnimationFrame:
      typeof g?.requestAnimationFrame === 'function' ? g.requestAnimationFrame.bind(g) : undefined,
    setTimeout: (cb, ms) => g.setTimeout(cb, ms),
  }
}

/**
 * 排一次起音：**保证 run 最多被调用一次**（rAF 与兜底谁先到谁生效）。
 * @param run - 真正起音（playRole）
 * @param env - 运行环境（单测注入）
 */
export function scheduleAlertKick(run: () => void, env: KickEnv = defaultEnv()): void {
  let done = false
  const once = () => {
    if (done) return
    done = true
    run()
  }
  const raf = env.requestAnimationFrame
  if (typeof raf === 'function') {
    raf(() => raf(once))
    // 关键：rAF 在隐藏页里被冻结，这条兜底才是「后台也能响」的保证
    env.setTimeout(once, KICK_FALLBACK_MS)
    return
  }
  env.setTimeout(once, KICK_NO_RAF_MS)
}
