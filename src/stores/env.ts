/* 环境状态（Pinia）—— P1 第一步
   数据获取复用机械迁移的 Api，评分用已通过等价性测试的 Engine。
   computeWater / computeEnv 是 legacy app.js 里那两个函数的逐行搬运，
   目的只有一个：新壳算出来的分数与老页面完全一致（P2 再按需重构）。 */
import { defineStore } from 'pinia'
import { Api } from '../lib/api'
import { Engine as E } from '../lib/engine'

export type WaterType =
  | 'auto' | 'sea' | 'river' | 'stream' | 'canal'
  | 'reservoir' | 'lake' | 'pond' | 'water' | 'unknown'

const TYPE_LABEL: Record<string, string> = {
  sea: '海/河口', river: '河流', stream: '溪流', canal: '渠道',
  reservoir: '水库/湖', lake: '湖/水库', pond: '塘/小水面', water: '水域'
}

function detectWaterType(s: any): WaterType {
  const kinds: string[] = (s.bodies || []).map((b: any) => b.kind)
  const sea = s.sea && s.sea.data && s.sea.data.current
  if (sea && sea.wave_height != null) return 'sea'
  if (kinds.indexOf('sea') >= 0) return 'sea'
  if (kinds.indexOf('river') >= 0 || kinds.indexOf('stream') >= 0) return 'river'
  if (kinds.indexOf('reservoir') >= 0) return 'reservoir'
  if (kinds.indexOf('lake') >= 0) return 'lake'
  if (kinds.indexOf('pond') >= 0) return 'pond'
  if (s.flood && s.flood.data && s.flood.data.daily) return 'river'
  return 'unknown'
}

function effectiveType(s: any): WaterType {
  const t = s.waterType === 'auto' ? s.waterAuto : s.waterType
  return t === 'unknown' ? 'lake' : t
}

function waterMode(s: any): 'sea' | 'river' | 'lake' {
  const t = effectiveType(s)
  if (t === 'sea') return 'sea'
  if (t === 'river' || t === 'stream' || t === 'canal') return 'river'
  return 'lake'
}

function nearestHourlyIndex(times: string[], nowMs: number): number {
  let best = 0, bestD = Infinity
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(E.wallMs(times[i]) - nowMs)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

/* 以下两个函数照 legacy app.js 的 computeWater / computeEnv 搬运，别改逻辑 */
export function computeWater(s: any, nowMs: number) {
  const sea = s.sea && s.sea.data
  const flood = s.flood && s.flood.data
  const mode = waterMode(s)
  const out: any = { mode }

  if (mode === 'sea' && sea && sea.hourly && sea.hourly.sea_level_height_msl) {
    const tide = E.tideAt({ tideHourly: sea.hourly }, nowMs)
    out.rate2h = tide.rate2h
    out.phase = tide.phase || '平'
    out.tideLevel = sea.current ? sea.current.sea_level_height_msl : null
    out.series = {
      labels: sea.hourly.time.slice(0, 24).map((t: string) => t.slice(11, 16)),
      values: sea.hourly.sea_level_height_msl.slice(0, 24),
      unit: 'm'
    }
    return out
  }

  if (flood && flood.daily && flood.daily.river_discharge) {
    const q = flood.daily.river_discharge
    const times = flood.daily.time
    let idx = q.length - 1
    while (idx > 0 && q[idx] == null) idx--
    const i3 = Math.max(0, idx - 3)
    if (q[idx] != null && q[i3]) out.pct3d = ((q[idx] - q[i3]) / q[i3]) * 100
    out.qToday = q[idx]
    out.qMean = flood.daily.river_discharge_mean ? flood.daily.river_discharge_mean[idx] : null
    out.series = { labels: times.map((t: string) => t.slice(5).replace('-', '/')), values: q, unit: 'm³/s' }
  }

  const daily = s.wx && s.wx.data && s.wx.data.daily
  if (daily && daily.precipitation_sum) {
    const sums = daily.precipitation_sum
    const n = Math.min(3, sums.length)
    let rain = 0, cnt = 0
    for (let i = sums.length - n; i < sums.length; i++) {
      if (sums[i] != null) { rain += sums[i]; cnt++ }
    }
    out.rain3d = cnt ? rain : null
  }
  return out
}

export function computeEnv(s: any) {
  const w = s.wx && s.wx.data
  if (!w) return
  const cur = w.current || {}
  const daily = w.daily || {}
  const hourly = w.hourly || {}
  const nowMs = E.nowWall(s.tzOffset || w.utc_offset_seconds || 0)
  s.nowMs = nowMs

  const today = new Date(nowMs).toISOString().slice(0, 10)
  let di = (daily.time || []).indexOf(today)
  if (di < 0) di = Math.min(1, (daily.time || []).length - 1)
  s.sunriseMs = daily.sunrise ? E.wallMs(daily.sunrise[di]) : NaN
  s.sunsetMs = daily.sunset ? E.wallMs(daily.sunset[di]) : NaN

  const sea = s.sea && s.sea.data
  let waterTemp: number | null = null
  let tempProxy = false
  if (s.waterManual != null) {
    waterTemp = Number(s.waterManual)
    tempProxy = false
  } else if (sea && sea.current && sea.current.sea_surface_temperature != null) {
    waterTemp = sea.current.sea_surface_temperature
  } else if (daily.temperature_2m_max && daily.temperature_2m_min) {
    const d0 = di, d1 = Math.max(0, di - 1)
    const t0 = (daily.temperature_2m_max[d0] + daily.temperature_2m_min[d0]) / 2
    const t1 = (daily.temperature_2m_max[d1] + daily.temperature_2m_min[d1]) / 2
    waterTemp = t0 * 0.6 + t1 * 0.4
    tempProxy = true
  }
  s.waterTemp = waterTemp
  s.tempProxy = tempProxy

  let dP: number | null = null
  if (hourly.pressure_msl && hourly.time) {
    const k = nearestHourlyIndex(hourly.time, nowMs)
    const a = hourly.pressure_msl[Math.max(0, k - 3)]
    const b = hourly.pressure_msl[k]
    if (a != null && b != null) dP = b - a
  }

  let pp: number | null = null
  if (hourly.precipitation_probability && hourly.time) {
    pp = hourly.precipitation_probability[nearestHourlyIndex(hourly.time, nowMs)]
  }

  s.water = computeWater(s, nowMs)
  const ctx = {
    species: s.species,
    waterTemp,
    pressure: cur.pressure_msl,
    dPressure3h: dP,
    windSpeed: cur.wind_speed_10m,
    windGust: cur.wind_gusts_10m,
    nowMs,
    sunriseMs: s.sunriseMs,
    sunsetMs: s.sunsetMs,
    cloud: cur.cloud_cover,
    precipProb: pp,
    precip: cur.precipitation,
    water: s.water,
    hourly,
    tideHourly: sea && sea.hourly ? sea.hourly : null
  }
  s.envCtx = ctx
  s.env = E.envScore(ctx)
  s.curve = E.hourCurve(ctx)
  s.windows = E.bestWindows(s.curve)
  s.dPi = dP
  s.precipProb = pp
}

export const useEnvStore = defineStore('env', {
  state: () => ({
    me: null as null | { lat: number; lon: number; acc?: number | null },
    bodies: [] as any[],
    waterType: 'auto' as WaterType,
    waterAuto: 'unknown' as WaterType,
    species: 'general',
    waterManual: null as number | null,
    wx: null as any,
    sea: null as any,
    flood: null as any,
    place: null as any,
    placeHint: null as null | string,
    locSource: 'manual' as 'manual' | 'url' | 'gps',
    loading: false,
    error: '',
    tzOffset: 0,
    nowMs: 0,
    sunriseMs: NaN,
    sunsetMs: NaN,
    waterTemp: null as number | null,
    tempProxy: false,
    water: null as any,
    envCtx: null as any,
    env: null as any,
    curve: [] as any[],
    windows: [] as any[],
    dPi: null as number | null,
    precipProb: null as number | null
  }),

  getters: {
    effectiveType: (s) => effectiveType(s),
    typeLabel(): string {
      return TYPE_LABEL[this.effectiveType] || '未知水域'
    },
    speciesLabel(): string {
      const sp = (E as any).SPECIES[this.species]
      return sp ? sp.label : ''
    },
    score: (s) => (s.env ? (s.env.score as number) : null),
    verdict(s): { t: string; p: string } {
      const sc = s.env ? s.env.score : null
      if (sc == null) return { t: '等待数据…', p: '定位后会给出结论、最佳时段和注意点。' }
      if (sc >= 80) return { t: '值得专门跑一趟', p: '环境要素大多落在鱼活跃的区间；把时间压进下面标出的窗口，优先去榜单前两个点。' }
      if (sc >= 65) return { t: '可以去，但要挑对岸和时段', p: '整体条件中等偏上；重点看风把哪一岸的水推向岸脚，以及气压有没有在动的迹象。' }
      if (sc >= 48) return { t: '一般，就近打一打', p: '环境处在中间地带：能出鱼，但需要更多换饵与换点，别把期待放在单一标点。' }
      return { t: '不建议专程跑', p: '主要因子（气压/水温/风或水位）明显不利；除非你很熟这个点，否则换个天气再来。' }
    }
  },

  actions: {
    async load(lat: number, lon: number, force = false, source: 'manual' | 'url' | 'gps' = 'manual') {
      this.me = { lat, lon, acc: null }
      this.locSource = source
      this.place = null
      this.placeHint = null
      this.loading = true
      this.error = ''
      try {
        // 四个数据源并行；任何一个失败都不该拖垮整页
        const [wx, sea, flood, osm] = await Promise.all([
          Api.weather(lat, lon, force).catch((e: any) => { throw e }),
          Api.marine(lat, lon, force).catch(() => null),
          Api.flood(lat, lon, force).catch(() => null),
          Api.osm(lat, lon, 1600, force).catch(() => null)
        ])
        this.wx = wx
        this.sea = sea
        this.flood = flood
        this.bodies = (osm && osm.data && (osm.data.bodies || osm.data.water)) || []
        this.waterAuto = detectWaterType(this)
        computeEnv(this)
        /* 逆地理只是补充信息，绝不让整页等它（实测移动网络 6 s 才回） */
        Api.reverse(lat, lon).then((p: any) => { this.place = p || null }).catch(() => {})
      } catch (e: any) {
        this.error = (e && (e.message || String(e))) || '取数失败'
      } finally {
        this.loading = false
      }
    },

    setSpecies(id: string) {
      this.species = id
      computeEnv(this)
    },

    setWaterType(t: WaterType) {
      this.waterType = t
      computeEnv(this)
    },

    setWaterManual(v: number | null) {
      this.waterManual = v
      computeEnv(this)
    }
  }
})
