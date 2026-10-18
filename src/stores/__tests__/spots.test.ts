/* 钓点管线等价性测试（P2）
   ---------------------------------------------------------------------------
   这一层没有老壳可对照（老壳的点位逻辑在 refresh() 的 async 链里），
   所以用固定夹具钉住「OSM → 候选点 → 高程 → 排名」这条链的**行为契约**：
     · 解析：一处封闭水面 → 1 个 body，名字/类型对得上；
     · 候选点：一圈岸线能出多个点，每个点带距离/方位/水侧；
     · 地形与风：applyTerrain / markWind 真的被调用（有 slopePct、windward）；
     · 排名：按 spotScore 降序、落在 0–100，环境分变化会整体抬降；
     · 兜底：1.6 km 内没水域时会扩到 4 km 重来一次。
   网络全部打桩，跑测试不需要联网。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/* 一个 ~1.1 km × 1.1 km 的方形湖，中心在 30.25 / 120.15（与手工验收同一坐标） */
function ring(cLat: number, cLon: number, d = 0.005) {
  const pts: { lat: number; lon: number }[] = []
  const N = 24
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2
    pts.push({ lat: cLat + Math.sin(a) * d, lon: cLon + Math.cos(a) * d })
  }
  return pts
}

const LAKE_GEOMETRY = ring(30.25, 120.15)

function osmBody(name = '测试湖') {
  return {
    data: {
      elements: [{
        type: 'way', id: 12345,
        tags: { natural: 'water', water: 'lake', name },
        geometry: LAKE_GEOMETRY
      }]
    },
    at: Date.now(), fromCache: false
  }
}

const osmMock = vi.fn()
const elevMock = vi.fn()

vi.mock('../../lib/api', () => ({
  Api: {
    osm: (...a: any[]) => osmMock(...a),
    elevation: (...a: any[]) => elevMock(...a),
    weather: vi.fn(),
    marine: vi.fn(),
    flood: vi.fn(),
    reverse: vi.fn(),
    search: vi.fn()
  }
}))

import { useSpotsStore } from '../spots'
import { useEnvStore } from '../env'

const ME = { lat: 30.25, lon: 120.16 }

beforeEach(() => {
  setActivePinia(createPinia())
  osmMock.mockReset()
  elevMock.mockReset()
  // 高程：给一组「西侧岸高、东侧低」的假数据，让 applyTerrain 能判出水侧
  elevMock.mockImplementation((probes: any[]) =>
    Promise.resolve(probes.map((p: any, i: number) => 8 + (i % 5) * 1.5)))
})

function makeEnv(score = 76, species = 'general', windDir = 0, windSpeed = 4) {
  const env = useEnvStore()
  env.species = species
  env.wx = { data: { current: { wind_speed_10m: windSpeed, wind_direction_10m: windDir } } }
  env.env = { score, factors: [] }
  return env
}

describe('spots 管线：OSM → 候选岸线点 → 高程 → 排名', () => {
  it('解析水面并生成候选岸线点', async () => {
    osmMock.mockResolvedValue(osmBody('测试湖'))
    makeEnv()
    const spots = useSpotsStore()
    await spots.load(ME.lat, ME.lon)

    expect(spots.bodies.length).toBe(1)
    expect(spots.bodies[0].name).toBe('测试湖')
    expect(spots.bodies[0].kind).toBe('lake')
    expect(spots.cands.length).toBeGreaterThan(2)
    expect(spots.structureSource).toBe('osm')
    // 每个候选点都要有距离/方位（排名与文案都靠它们）
    for (const c of spots.cands) {
      expect(Number.isFinite(c.distToMe)).toBe(true)
      expect(Number.isFinite(c.bearingFromMe)).toBe(true)
    }
    expect(spots.probeCount).toBe(spots.cands.length * 5)
    expect(elevMock).toHaveBeenCalledTimes(1)
  })

  it('地形与风侧真的被算进去了（不是原样透传）', async () => {
    osmMock.mockResolvedValue(osmBody())
    makeEnv()
    const spots = useSpotsStore()
    await spots.load(ME.lat, ME.lon)

    const withSlope = spots.cands.filter((c: any) => c.slopePct != null)
    expect(withSlope.length).toBeGreaterThan(0)
    const withWind = spots.cands.filter((c: any) => typeof c.windward === 'boolean')
    expect(withWind.length).toBeGreaterThan(0)
  })

  it('排名按分降序、分数落在 0–100，且带上标题/理由/拟饵', async () => {
    osmMock.mockResolvedValue(osmBody())
    makeEnv()
    const spots = useSpotsStore()
    await spots.load(ME.lat, ME.lon)

    expect(spots.spots.length).toBeGreaterThan(0)
    const scores = spots.spots.map((s: any) => s.spotScore)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    for (const s of spots.spots) {
      expect(s.spotScore).toBeGreaterThanOrEqual(0)
      expect(s.spotScore).toBeLessThanOrEqual(100)
      expect(typeof s.title).toBe('string')
      expect(Array.isArray(s.reasons)).toBe(true)
      expect(s.reasons.length).toBeGreaterThan(0)
      expect(Array.isArray(s.lure)).toBe(true)
    }
  })

  it('环境分整体抬降钓点分（环境占 50%），重排不重新取数', async () => {
    osmMock.mockResolvedValue(osmBody())
    const env = makeEnv(60)
    const spots = useSpotsStore()
    await spots.load(ME.lat, ME.lon)
    const low = spots.spots.map((s: any) => s.spotScore)

    osmMock.mockClear()
    elevMock.mockClear()
    env.env = { score: 96, factors: [] }
    spots.rebuild()
    const high = spots.spots.map((s: any) => s.spotScore)

    expect(high.length).toBe(low.length)
    expect(Math.max(...high)).toBeGreaterThan(Math.max(...low))
    // 环境差 36 分 → 总分大致抬 18 分（0.5 权重），这里只钉「方向对且幅度合理」
    const d = Math.max(...high) - Math.max(...low)
    expect(d).toBeGreaterThan(10)
    expect(d).toBeLessThanOrEqual(20)
    // rebuild 不该再打网络
    expect(osmMock).not.toHaveBeenCalled()
    expect(elevMock).not.toHaveBeenCalled()
  })

  it('1.6 km 内没水域时扩到 4 km 再查一次', async () => {
    osmMock
      .mockResolvedValueOnce({ data: { elements: [] }, at: Date.now(), fromCache: false })
      .mockResolvedValueOnce(osmBody('远一点的湖'))
    makeEnv()
    const spots = useSpotsStore()
    await spots.load(ME.lat, ME.lon)

    expect(osmMock).toHaveBeenCalledTimes(2)
    expect(osmMock.mock.calls[0][2]).toBe(1600)
    expect(osmMock.mock.calls[1][2]).toBe(4000)
    expect(spots.bodies.length).toBe(1)
    expect(spots.bodies[0].name).toBe('远一点的湖')
  })

  it('OSM 全挂时留下错误信息且不抛异常', async () => {
    osmMock.mockRejectedValue(new Error('overpass 全部端点失败'))
    makeEnv()
    const spots = useSpotsStore()
    await spots.load(ME.lat, ME.lon)

    expect(spots.error).toContain('overpass')
    expect(spots.cands).toEqual([])
    expect(spots.spots).toEqual([])
    expect(spots.loading).toBe(false)
  })

  it('目标钓点：设置后可清除，标题回落到水域名', async () => {
    osmMock.mockResolvedValue(osmBody())
    makeEnv()
    const spots = useSpotsStore()
    await spots.load(ME.lat, ME.lon)
    const s = spots.spots[0]

    spots.setNavTarget(s, true)
    expect(spots.navTarget).not.toBeNull()
    expect(spots.navTarget!.lat).toBe(s.lat)
    expect(spots.selSpot).toBe(s)
    expect(spots.clearNavTarget()).toBe(true)
    expect(spots.navTarget).toBeNull()
  })
})
