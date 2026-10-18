/* 秋季窗口期判据测试（P4）
   ---------------------------------------------------------------------------
   三条判据各自独立可测：
     ① 降温窗口：未来 6 小时内出现 ≥3℃ 降温
     ② 隔夜温差：今夜与前一夜（20:00–06:00）气温中位数之差在 5–8℃
     ③ 气压带：当前整点气压 1010–1020 hPa
   bonus 只由 hits 决定：3/3 → 6、2/3 → 3、其余 0。 */
import { describe, expect, it } from 'vitest'
import { judgeWindow } from '../window-hint'

const HOUR = 3600000

/* 造一份 72 小时逐小时数据：times 为 UTC ISO 串（不带 Z，和老壳一致） */
function makeHourly(opts: {
  startIso: string
  temp: (i: number) => number
  press?: (i: number) => number
}) {
  const t0 = new Date(opts.startIso + 'Z').getTime()
  const time: string[] = []
  const temperature_2m: number[] = []
  const pressure_msl: number[] = []
  for (let i = 0; i < 72; i++) {
    const d = new Date(t0 + i * HOUR)
    time.push(d.toISOString().slice(0, 19))
    temperature_2m.push(opts.temp(i))
    pressure_msl.push(opts.press ? opts.press(i) : 1015)
  }
  return { time, temperature_2m, pressure_msl }
}

/* 夜里（20–06 点）压到 lowValue，白天回到 dayValue */
function nightShape(dayValue: number, nightValue: number) {
  return (i: number) => {
    const h = i % 24
    return (h >= 20 || h < 6) ? nightValue : dayValue
  }
}

const NOW = new Date('2026-10-18T12:00:00Z').getTime()

describe('judgeWindow', () => {
  it('降温窗口命中：从当前起 3 小时后 6 小时内降 6℃ → cooling=true', () => {
    const temps: number[] = []
    for (let i = 0; i < 72; i++) {
      if (i <= 2) temps.push(20)
      else if (i <= 9) temps.push(20 - 6 * ((i - 2) / 7))
      else temps.push(14)
    }
    const hourly = makeHourly({ startIso: '2026-10-18T12:00:00', temp: (i) => temps[i], press: () => 1015 })
    const r = judgeWindow({ hourly, pressure: 1015 }, NOW) as any
    expect(r.cooling).toBe(true)
    expect(r.pressureBand).toBe(true)
    // 隔夜温差这一条在这组数据里不一定成立，但 hits 至少含降温 + 气压
    expect(r.hits).toBeGreaterThanOrEqual(2)
    expect(r.bonus).toBe(3)
    expect(r.lines.length).toBe(3)
    expect(r.summary).toMatch(/判据/)
  })

  it('降温开始得太远（20 小时后才降）→ cooling=false', () => {
    const temps: number[] = []
    for (let i = 0; i < 72; i++) {
      if (i <= 19) temps.push(20)
      else if (i <= 26) temps.push(20 - 6 * ((i - 19) / 7))
      else temps.push(14)
    }
    const hourly = makeHourly({ startIso: '2026-10-18T12:00:00', temp: (i) => temps[i], press: () => 1015 })
    const r = judgeWindow({ hourly, pressure: 1015 }, NOW) as any
    expect(r.cooling).toBe(false)
  })

  it('气压不在带上（1025）→ pressureBand=false，bonus ≤3', () => {
    const hourly = makeHourly({ startIso: '2026-10-18T12:00:00', temp: () => 18, press: () => 1025 })
    const r = judgeWindow({ hourly, pressure: 1025 }, NOW) as any
    expect(r.pressureBand).toBe(false)
    expect(r.hits).toBeLessThanOrEqual(2)
    expect(r.bonus).toBeLessThanOrEqual(3)
    expect(r.lines.join(' ')).toContain('1025')
  })

  it('隔夜温差 2℃（不在 5–8）→ nightGap=false', () => {
    // day 20/12 两天几乎一样，夜间只差 2℃
    const hourly = makeHourly({
      startIso: '2026-10-18T12:00:00',
      temp: (i) => (i % 24 >= 20 || i % 24 < 6) ? (Math.floor(i / 24) === 0 ? 14 : 12) : 20
    })
    const r = judgeWindow({ hourly, pressure: 1015 }, NOW) as any
    expect(r.nightGap).toBe(false)
    expect(r.lines.join(' ')).toContain('隔夜温差')
  })

  it('完全没有降温过程（一路升温）→ cooling=false', () => {
    const hourly = makeHourly({ startIso: '2026-10-18T12:00:00', temp: (i) => 10 + i * 0.2 })
    const r = judgeWindow({ hourly, pressure: 1015 }, NOW) as any
    expect(r.cooling).toBe(false)
  })

  it('没有逐小时数据 → null（不硬编造提示）', () => {
    expect(judgeWindow({}, NOW)).toBeNull()
    expect(judgeWindow({ hourly: {} }, NOW)).toBeNull()
  })
})
