/* LureCast · 秋季窗口期判据（可选，默认不参与评分）
   ---------------------------------------------------------------------------
   来自 README 的「秋季窗口期判据」（10 月翘嘴/鲈鱼那一套经验规则），三条：
     1) 降温前 1–2 天，或降温开始后 4–6 小时 —— 鱼在换温窗口里最活跃；
     2) 隔夜温差 5–8℃ —— 太小没刺激，太大鱼不适应；
     3) 气压 1010–1020 hPa —— 常规高压带，过高过低都不好。
   **为什么不直接并进六因子**：并入会摊薄现有 temp/pressure/wind/time/sky/water 的权重，
   而且「气压缓降」这一条与视频口径相反（视频认为缓降好，判据要求 1010–1020 的稳定带）。
   所以做成「提示 + 可选加分」：
     · 卡片上永远显示符合几条（纯信息，不改分）；
     · 只有用户在设置里打开「窗口期并入评分」，才按 3/3 → +6、2/3 → +3 加到环境分上（上限 100）。
   计算全部只用 Open-Meteo 已有的逐小时气温与气压，不额外发请求。 */

export type WindowHint = {
  /** 三条判据各自是否成立 */
  cooling: boolean
  nightGap: boolean
  pressureBand: boolean
  /** 成立条数 0–3 */
  hits: number
  /** 打开「并入评分」时的加分（0 / 3 / 6） */
  bonus: number
  /** 给人看的逐条说明（含实际数值） */
  lines: string[]
  /** 一句总结 */
  summary: string
}

function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y)
  if (!s.length) return NaN
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/* 找出「未来 30 小时内最大的一次降温」：返回开始时刻的小时偏移、幅度、及其后的温差 */
function findCooling(hourly: any, nowMs: number) {
  const times: string[] = (hourly && hourly.time) || []
  const temps: number[] = (hourly && hourly.temperature_2m) || []
  if (!times.length || times.length !== temps.length) return null
  const wall = (iso: string) => new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).getTime()
  let startIdx = -1
  let nowIdx = -1
  for (let i = 0; i < times.length; i++) {
    const t = wall(times[i])
    if (Math.abs(t - nowMs) < 3600000) { nowIdx = i; break }
    if (t >= nowMs) { nowIdx = Math.max(0, i - 1); break }
  }
  if (nowIdx < 0) nowIdx = 0

  // 用 6 小时滑动窗口找最大降幅
  let best = { drop: 0, from: -1, to: -1 }
  const span = Math.min(30, temps.length - nowIdx - 1)
  for (let i = 0; i < span; i++) {
    const a = temps[nowIdx + i]
    if (a == null) continue
    for (let j = i + 1; j <= Math.min(span, i + 8); j++) {
      const b = temps[nowIdx + j]
      if (b == null) continue
      const drop = a - b
      if (drop > best.drop) best = { drop, from: i, to: j }
    }
  }
  if (best.drop <= 0) return null
  startIdx = nowIdx + best.from
  const hoursFromNow = best.from
  return {
    drop: best.drop,
    hoursFromNow,
    hoursSinceStart: Math.max(0, -hoursFromNow),
    startAt: times[startIdx]
  }
}

export function judgeWindow(ctx: any, nowMs: number): WindowHint | null {
  const hourly = ctx && ctx.hourly
  if (!hourly || !hourly.time) return null
  const temps: number[] = hourly.temperature_2m || []
  const press: number[] = hourly.pressure_msl || []
  if (!temps.length) return null

  const lines: string[] = []

  /* ① 降温窗口：降温前 1–3 天仍在爬升段，或刚开始降温 4–6 小时 */
  const cool = findCooling(hourly, nowMs)
  let cooling = false
  if (cool) {
    // 未来 30 h 内会出现 ≥3℃ 的降温，且「距离降温开始」落在 -48h…+6h 之间
    const inWindow = cool.hoursFromNow <= 6 && cool.drop >= 3
    cooling = inWindow
    lines.push('降温：未来 ' + Math.max(0, cool.hoursFromNow) + ' 小时内降 ' + cool.drop.toFixed(1) + '℃'
      + (cooling ? '（在 4–6 小时窗口内）' : '（降温开始太远，等更近再看）'))
  } else {
    lines.push('降温：未来 30 小时没有明显降温过程')
  }

  /* ② 隔夜温差：今夜最低与前一夜最低之差（Open-Meteo 的 hourly 里直接算） */
  const night: number[] = []
  const prevNight: number[] = []
  const times: string[] = hourly.time
  for (let i = 0; i < times.length && i < 72; i++) {
    const h = Number(times[i].slice(11, 13))
    const isNight = h >= 20 || h < 6          // 20:00–06:00 视作夜间
    const t = temps[i]
    if (t == null) continue
    const dayIdx = Math.floor(i / 24)
    if (!isNight) continue
    if (dayIdx === 0) night.push(t)
    else if (dayIdx === 1) prevNight.push(t)
  }
  let nightGap = false
  if (night.length && prevNight.length) {
    const gap = Math.abs(median(night) - median(prevNight))
    nightGap = gap >= 5 && gap <= 8
    lines.push('隔夜温差：' + gap.toFixed(1) + '℃' + (nightGap ? '（在 5–8℃ 区间）' : '（不在 5–8℃ 区间）'))
  } else {
    lines.push('隔夜温差：逐小时数据不足，未判定')
  }

  /* ③ 气压带 1010–1020（用当前时刻那小时，缺失就退回 ctx.pressure） */
  let p: number | null = null
  if (press.length) {
    let k = 0
    for (let i = 0; i < times.length && i < press.length; i++) {
      if (new Date(times[i] + 'Z').getTime() <= nowMs) k = i
    }
    if (press[k] != null) p = press[k]
  }
  if (p == null && ctx && ctx.pressure != null) p = ctx.pressure
  let pressureBand = false
  if (p != null) {
    pressureBand = p >= 1010 && p <= 1020
    lines.push('气压：' + p.toFixed(1) + ' hPa' + (pressureBand ? '（在 1010–1020）' : '（不在 1010–1020）'))
  } else {
    lines.push('气压：没有读到')
  }

  const hits = (cooling ? 1 : 0) + (nightGap ? 1 : 0) + (pressureBand ? 1 : 0)
  const bonus = hits >= 3 ? 6 : (hits === 2 ? 3 : 0)
  const summary = hits === 3 ? '三条判据全中：降温窗口 + 隔夜温差 + 气压带'
    : hits === 2 ? '两条判据成立' : hits === 1 ? '只有一条判据成立' : '三条判据都不成立'

  return { cooling, nightGap, pressureBand, hits, bonus, lines, summary }
}
