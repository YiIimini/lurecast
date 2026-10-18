/* 等价性测试：新模块 src/lib/engine.ts 必须与 legacy assets/engine.js 输出完全一致。
   —— 重构期唯一的安全网：先把行为钉死，再逐卡换框架。
   跑法：npm test。任何一条挂了，都说明迁移过程中改了引擎行为。 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine as NewEngine } from '../engine'

const LEGACY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/engine.js')

function loadLegacy(): any {
  const code = fs.readFileSync(LEGACY, 'utf8')
  const win: any = {}
  new Function('window', code)(win) // legacy 是 IIFE，只依赖 window.Engine 挂载点
  return win.Engine
}
const Old = loadLegacy()

/* 确定性伪随机：同一 seed 跑多少次都一样 */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}
const R = rng(20261018)
const pick = <T,>(arr: T[]): T => arr[Math.floor(R() * arr.length)]
const num = (a: number, b: number) => a + R() * (b - a)
const j = (v: any) => JSON.stringify(v)

const SPECIES_IDS = Object.keys(Old.SPECIES)

describe('常量与数据表', () => {
  it('SPECIES 表逐字节一致', () => {
    expect(j(NewEngine.SPECIES)).toBe(j(Old.SPECIES))
  })

  it('导出面一致（不得少函数）', () => {
    const missing = Object.keys(Old).filter((k) => (NewEngine as any)[k] === undefined)
    expect(missing).toEqual([])
  })
})

describe('几何与工具', () => {
  it('dist / bearing / dest / angDiff / compass 一致', () => {
    for (let i = 0; i < 200; i++) {
      const a = { lat: num(-60, 60), lon: num(-179, 179) }
      const b = { lat: num(-60, 60), lon: num(-179, 179) }
      expect(NewEngine.dist(a, b)).toBe(Old.dist(a, b))
      expect(NewEngine.bearing(a, b)).toBe(Old.bearing(a, b))

      const brg = num(0, 359.9)
      const d = num(50, 5000)
      expect(j(NewEngine.dest(a, brg, d))).toBe(j(Old.dest(a, brg, d)))
      expect(NewEngine.compass(brg)).toBe(Old.compass(brg))

      const d1 = num(-180, 180)
      const d2 = num(-180, 180)
      expect(NewEngine.angDiff(d1, d2)).toBe(Old.angDiff(d1, d2))
    }
  })

  it('round / clamp / hourOf / wallMs / fmtDist 一致', () => {
    for (let i = 0; i < 120; i++) {
      const v = num(-1000, 1000)
      expect(NewEngine.round(v, 1)).toBe(Old.round(v, 1))
      expect(NewEngine.round(v, 0)).toBe(Old.round(v, 0))
      expect(NewEngine.clamp(v, -10, 10)).toBe(Old.clamp(v, -10, 10))

      const ms = 1792290000000 + Math.floor(num(0, 86400000))
      expect(NewEngine.hourOf(ms)).toBe(Old.hourOf(ms))
      const iso = new Date(ms).toISOString().slice(0, 19)
      expect(NewEngine.wallMs(iso)).toBe(Old.wallMs(iso))

      const dm = num(10, 20000)
      expect(NewEngine.fmtDist(dm)).toBe(Old.fmtDist(dm))
    }
  })
})

describe('环境分与曲线', () => {
  const ctxOf = () => ({
    species: pick(SPECIES_IDS),
    waterTemp: R() < 0.1 ? null : num(-2, 34),
    pressure: R() < 0.1 ? null : num(985, 1035),
    dPressure3h: R() < 0.1 ? null : num(-8, 8),
    windSpeed: R() < 0.1 ? null : num(0, 14),
    windGust: R() < 0.3 ? null : num(0, 20),
    nowMs: 1792290000000 + Math.floor(num(0, 86400000)),
    sunriseMs: 1792290000000 + 6 * 3600e3,
    sunsetMs: 1792290000000 + 18 * 3600e3,
    cloud: R() < 0.1 ? null : num(0, 100),
    precipProb: R() < 0.2 ? null : num(0, 100),
    precip: R() < 0.4 ? null : num(0, 12),
    water: pick([
      null,
      { mode: 'lake', rain3d: num(0, 80), pct3d: num(-40, 60) },
      { mode: 'river', pct3d: num(-50, 80) },
      { mode: 'tide', rate2h: num(-1, 1), phase: '涨', nearTurn: R() < 0.3 }
    ]),
    hourly: null,
    tideHourly: null
  })

  it('envScore：200 组随机环境，总分/因子分/文案全一致', () => {
    for (let i = 0; i < 200; i++) {
      const ctx = ctxOf()
      const a = NewEngine.envScore(ctx as any)
      const b = Old.envScore(ctx)
      expect(a.score).toBe(b.score)
      expect(a.factors.length).toBe(b.factors.length)
      a.factors.forEach((f: any, idx: number) => {
        expect(f.key).toBe(b.factors[idx].key)
        expect(f.score).toBe(b.factors[idx].score)
        expect(f.w).toBe(b.factors[idx].w)
        expect(f.r.txt).toBe(b.factors[idx].r.txt)
      })
    }
  })

  it('hourCurve 与 bestWindows：合成 36 小时数据上一致', () => {
    const base = 1792290000000 - 6 * 3600e3
    const time: string[] = []
    const pressure: number[] = []
    const wind: number[] = []
    const cloud: number[] = []
    const temp: number[] = []
    for (let i = 0; i < 36; i++) {
      time.push(new Date(base + i * 3600e3).toISOString().slice(0, 19))
      pressure.push(1010 + Math.sin(i / 5) * 6 + num(-0.3, 0.3))
      wind.push(Math.max(0, 3 + Math.sin(i / 7) * 3))
      cloud.push(num(0, 100))
      temp.push(num(8, 30))
    }
    const ctx = {
      species: 'bass',
      waterTemp: 19,
      pressure: 1015,
      dPressure3h: 0.4,
      windSpeed: 3.2,
      windGust: 6,
      nowMs: 1792290000000,
      sunriseMs: 1792290000000 + 5 * 3600e3,
      sunsetMs: 1792290000000 + 19 * 3600e3,
      cloud: 50,
      precipProb: 20,
      precip: 0,
      water: { mode: 'lake', rain3d: 6, pct3d: 3 },
      hourly: {
        time,
        pressure_msl: pressure,
        wind_speed_10m: wind,
        wind_gusts_10m: wind,
        cloud_cover: cloud,
        precipitation_probability: cloud,
        precipitation: temp,
        temperature_2m: temp
      },
      tideHourly: null
    }
    const a = NewEngine.hourCurve(ctx as any)
    const b = Old.hourCurve(ctx)
    expect(j(a)).toBe(j(b))
    expect(j(NewEngine.bestWindows(a))).toBe(j(Old.bestWindows(b)))
  })
})

describe('点位结构', () => {
  const candOf = () => ({
    lat: num(20, 40),
    lon: num(110, 130),
    bearingFromMe: num(0, 359),
    distToMe: num(50, 4000),
    form: pick(['point', 'bay', 'straight']),
    formStrength: pick(['弱', '中', '强']),
    linear: R() < 0.2,
    satSource: R() < 0.1,
    windward: pick([true, false, null]),
    slopePct: R() < 0.15 ? null : num(-2, 40),
    depth20: R() < 0.15 ? null : num(0, 8)
  })

  it('structureScore：150 组随机点位，分数与四条理由一致', () => {
    for (let i = 0; i < 150; i++) {
      const c = candOf()
      const ctx = { species: pick(SPECIES_IDS), windSpeed: num(0, 12) }
      const a = NewEngine.structureScore(c as any, ctx as any)
      const b = Old.structureScore(c, ctx)
      expect(a.score).toBe(b.score)
      expect(j(a.parts)).toBe(j(b.parts))
    }
  })

  it('terrainSummary：40 个候选点的汇总一致', () => {
    const cands: any[] = []
    for (let i = 0; i < 40; i++) cands.push(candOf())
    expect(j(NewEngine.terrainSummary(cands as any))).toBe(j(Old.terrainSummary(cands)))
  })

  it('applyTerrain：40 组高程探针结果一致', () => {
    for (let i = 0; i < 40; i++) {
      const c = { ...candOf(), n1: num(0, 359), n2: num(0, 359) }
      const h = [num(20, 30), num(20, 40), num(20, 40), num(20, 50), num(20, 50)]
      expect(j(NewEngine.applyTerrain({ ...c }, h))).toBe(j(Old.applyTerrain({ ...c }, h)))
    }
  })

  it('markWind：同一风向/风速下标记一致', () => {
    const cands: any[] = []
    for (let i = 0; i < 40; i++) cands.push(candOf())
    const windToDeg = num(0, 359)
    const a = cands.map((c) => ({ ...c }))
    const b = cands.map((c) => ({ ...c }))
    expect(j(NewEngine.markWind(a, windToDeg))).toBe(j(Old.markWind(b, windToDeg)))
  })

  it('pickSpots：排序、标题、理由、拟饵一致', () => {
    const cands: any[] = []
    for (let i = 0; i < 12; i++) cands.push({ ...candOf(), spotScore: num(30, 95) })
    const ctx = {
      species: 'bass',
      windSpeed: 3,
      waterTemp: 19,
      nowMs: 1792290000000,
      sunriseMs: 1792290000000,
      sunsetMs: 1792290000000
    }
    expect(j(NewEngine.pickSpots(cands as any, ctx as any))).toBe(j(Old.pickSpots(cands, ctx)))
  })
})

describe('单项评分', () => {
  it('tempScore / pressureScore / windScore / timeScore / skyScore / slopePref / waterScore', () => {
    for (let i = 0; i < 100; i++) {
      const sp = pick(SPECIES_IDS)

      const t = num(-5, 35)
      expect(j(NewEngine.tempScore(t, sp))).toBe(j(Old.tempScore(t, sp)))

      const p = num(985, 1035)
      const dp = R() < 0.2 ? null : num(-9, 9)
      expect(j(NewEngine.pressureScore(p, dp))).toBe(j(Old.pressureScore(p, dp)))

      const ws = num(0, 14)
      const gust = num(0, 20)
      expect(j(NewEngine.windScore(ws, gust, sp))).toBe(j(Old.windScore(ws, gust, sp)))

      const now = 1792290000000 + i * 3600e3
      const rise = 1792290000000 + 6 * 3600e3
      const set = 1792290000000 + 18 * 3600e3
      expect(j(NewEngine.timeScore(now, rise, set))).toBe(j(Old.timeScore(now, rise, set)))

      const cloud = num(0, 100)
      const pp = num(0, 100)
      const pr = num(0, 10)
      expect(j(NewEngine.skyScore(cloud, pp, pr))).toBe(j(Old.skyScore(cloud, pp, pr)))

      const slope = num(-2, 40)
      const pref = (Old.SPECIES[sp] || Old.SPECIES.general).slope
      expect(j(NewEngine.slopePref(slope, pref))).toBe(j(Old.slopePref(slope, pref)))

      const water = pick([
        null,
        { mode: 'lake', rain3d: num(0, 80), pct3d: num(-40, 60) },
        { mode: 'river', pct3d: num(-50, 80) },
        { mode: 'tide', rate2h: num(-1, 1), phase: '落', nearTurn: R() < 0.3 }
      ])
      expect(j(NewEngine.waterScore({ water } as any))).toBe(j(Old.waterScore({ water })))
    }
  })
})
