/* LureCast · 钓点管线（P2）—— 由 assets/app.js 的 refresh()/afterBodies()/rebuildSpots() 搬运
   ------------------------------------------------------------------------------------
   顺序和老壳完全一致，别调换：
     1. Api.osm(1600)            → E.parseBodies           → 水域多边形
     2. 1.6 km 内没有水域        → 扩到 4 km 再来一次（海边/大湖边很常见）
     3. E.buildCandidates        → 候选岸线点（岬角/岸坡/迎风岸的原料）
     4. Api.elevation(每点 5 个探针) → E.applyTerrain      → 岸坡与岬角高度
     5. E.markWind               → 每点相对风向的水侧
     6. E.pickSpots(环境分 × 结构 × 可达) → 排名
   卫星（Sentinel-2）兜底没搬：它要 geotiff.js + assets/sat.js，留到 P3 和影像页一起搬。
   所以 OSM 全挂 + 附近没收录水域时，这一版钓点会是空的（老壳还有卫星兜底）。 */
import { defineStore } from 'pinia'
import { Engine as E } from '../lib/engine'
import { Api } from '../lib/api'
import { useEnvStore } from './env'
import { toast } from '../lib/ui'

function windToDeg(): number {
  const cur = (useEnvStore().wx as any)?.data?.current
  if (!cur || cur.wind_direction_10m == null) return 0
  return (cur.wind_direction_10m + 180) % 360
}

export const useSpotsStore = defineStore('spots', {
  state: () => ({
    me: null as null | { lat: number; lon: number },
    bodies: [] as any[],
    pickBodies: [] as any[],
    cands: [] as any[],
    spots: [] as any[],
    terrain: null as any,
    structureSource: '' as '' | 'osm' | 'satellite',
    loading: false,
    error: '',
    wideTried: false,
    probeCount: 0,
    navTarget: null as null | { lat: number; lon: number; title: string; score: number | null },
    selSpot: null as any
  }),

  getters: {
    /* 定位卡与地图用的「最近水域」：优先用离我最近的那处被拾取的水域 */
    nearBody: (s) => (s.pickBodies && s.pickBodies[0]) || null,
    candCount: (s) => (s.cands ? s.cands.length : 0)
  },

  actions: {
    async load(lat: number, lon: number, force = false) {
      if (this.loading) return
      this.loading = true
      this.error = ''
      this.me = { lat, lon }
      this.wideTried = false
      this.navTarget = null
      this.selSpot = null
      try {
        const env = useEnvStore()
        let osm = await Api.osm(lat, lon, 1600, force).catch((e: any) => {
          this.error = (e && (e.message || String(e))) || 'OSM 取数失败'
          return null
        })
        let bodies: any[] = osm && osm.data ? E.parseBodies(osm.data) : []

        // 1.6 km 内一点水域都没有？扩大到 4 km 再试一次
        if (!bodies.length && !this.wideTried) {
          this.wideTried = true
          const osm2 = await Api.osm(lat, lon, 4000, true).catch(() => null)
          if (osm2 && osm2.data) {
            bodies = E.parseBodies(osm2.data)
            this.error = ''
          }
        }

        this.bodies = bodies
        const bc = (E as any).buildCandidates(bodies, { lat, lon })
        const cands: any[] = bc.candidates || []
        this.pickBodies = bc.bodies || []
        this.structureSource = bodies.length ? 'osm' : ''

        // 高程：每个候选点 5 个探针，批量取（Api 内部已按 90 个/次分片 + 内存缓存）
        let probes: any[] = []
        cands.forEach((c: any) => { probes = probes.concat((E as any).elevationProbes(c)) })
        this.probeCount = probes.length
        const elev: any = probes.length
          ? await Api.elevation(probes as any).catch(() => [])
          : []

        // 先在地板数组（未代理）上把地形与风侧算完，再交给响应式，避免循环里反复触发更新
        const windTo = windToDeg()
        cands.forEach((c: any, i: number) => {
          const h = elev && elev.slice ? elev.slice(i * 5, i * 5 + 5) : []
          if (h.length === 5) (E as any).applyTerrain(c, h)
          ;(E as any).markWind(c, windTo)
        })

        this.cands = cands
        void env
        this.rebuild()
      } catch (e: any) {
        this.error = (e && (e.message || String(e))) || '岸线取数失败'
      } finally {
        this.loading = false
      }
    },

    /* 环境分 / 目标鱼 / 风一变就重排（不重新取数） */
    rebuild() {
      const env = useEnvStore()
      if (!env.env) return
      const cur = ((env.wx as any)?.data?.current) || {}
      this.terrain = (E as any).terrainSummary(this.cands)
      this.spots = (E as any).pickSpots(this.cands, {
        envScore: env.env.score,
        species: env.species,
        windSpeed: cur.wind_speed_10m,
        sat: null
      }) || []
      if (this.selSpot) {
        const found = this.spots.filter((s: any) => s.id === this.selSpot.id)[0]
        this.selSpot = found || null
      }
    },

    setNavTarget(o: any, silent = false) {
      if (!o) { this.navTarget = null; return }
      this.navTarget = {
        lat: o.lat, lon: o.lon,
        title: o.title || o.name || '目标钓点',
        score: o.spotScore != null ? o.spotScore : null
      }
      this.selSpot = o
      if (!silent) toast('已设为目标钓点：' + this.navTarget.title)
    },

    clearNavTarget() {
      if (!this.navTarget) return false
      this.navTarget = null
      return true
    }
  }
})
/* toast 统一走 lib/ui（P3 把 ui.js 搬过来后，这里只保留一个别名，
   老调用点不用改；实现、时长与 #toast 节点都与老壳一致）。 */
export { toast as toastMsg } from '../lib/ui'
