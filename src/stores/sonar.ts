/* LureCast · 声呐实测数据（P4 + docs/DEEPER-SONAR.md）
   ---------------------------------------------------------------------------
   把 Deeper 导出的 CSV 读成「带坐标的深度点」，供地图与钓点卡使用。
   解析全部交给 lib/deeper.ts（纯函数，有 10 条测试），这里只做：
     · 读文件 → 解析 → 统计（点数 / 深度中位数与极值 / 无定位点数 / 水温中位数）
     · 只保留有 GPS 的点（0/0 的点画到几内亚湾毫无意义）
     · 落到本机（lc:sonar），下次打开还在；上限 5000 点，够画一片湖
   明示口径：这是**实测水深**，不是推断；只存在本机，不上传。 */
import { defineStore } from 'pinia'
import { Store } from '../lib/store'
import { Deeper } from '../lib/deeper'
import { alertBox, toast } from '../lib/ui'

const KEY = 'lc:sonar'
const MAX_POINTS = 5000

export type SonarPoint = { lat: number; lon: number; depthM: number; tempC: number | null; tMs: number }

export type SonarStats = {
  points: number          // 有坐标的点
  rows: number            // 总行数
  skipped: number         // 脏行
  zeroGps: number         // 没有定位的行
  minDepth: number
  maxDepth: number
  medDepth: number
  medTemp: number | null
  fileName: string
  at: number
}

function median(arr: number[]): number {
  if (!arr.length) return NaN
  const s = arr.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function read(): { points: SonarPoint[]; stats: SonarStats | null } {
  try {
    const raw = Store.getItem(KEY)
    if (!raw) return { points: [], stats: null }
    const o = JSON.parse(raw)
    return { points: Array.isArray(o.points) ? o.points : [], stats: o.stats || null }
  } catch {
    return { points: [], stats: null }
  }
}

export const useSonarStore = defineStore('sonar', {
  state: () => ({
    points: [] as SonarPoint[],
    stats: null as SonarStats | null,
    error: '',
    busy: false
  }),

  getters: {
    has: (s) => s.points.length > 0,
    /* 深度配色区间（地图用）：浅 → 深 */
    range(s): { min: number; max: number } {
      const st = s.stats
      if (st) return { min: st.minDepth, max: st.maxDepth }
      if (!s.points.length) return { min: 0, max: 0 }
      let mn = Infinity, mx = -Infinity
      s.points.forEach((p) => { if (p.depthM < mn) mn = p.depthM; if (p.depthM > mx) mx = p.depthM })
      return { min: mn, max: mx }
    }
  },

  actions: {
    load() {
      const { points, stats } = read()
      this.points = points
      this.stats = stats
    },

    /* 导入一个 Deeper CSV（bathymetry.csv / scan_data_*.csv 都行） */
    async importFile(file: File, transducerOffsetM = 0.15) {
      this.busy = true
      this.error = ''
      try {
        const text = await file.text()
        const res: any = Deeper.parseText(text, { transducerOffsetM })
        const located = (res.fixes || []).filter((f: any) => f.gpsOk && isFinite(f.depthM) && f.depthM > 0)
        if (!located.length) {
          this.error = '这个文件里没有带坐标的深度点（GPS 没记录）。手机端导出常见：只在 App 内看得到轨迹，导出的 CSV 缺坐标。'
          await alertBox(this.error, { title: '没有可用点位' })
          return false
        }
        const points: SonarPoint[] = located.slice(0, MAX_POINTS).map((f: any) => ({
          lat: +f.lat, lon: +f.lon, depthM: f.depthM, tempC: f.tempC, tMs: f.tMs
        }))
        const depths = points.map((p) => p.depthM)
        const temps = points.map((p) => p.tempC).filter((v): v is number => v != null)
        this.stats = {
          points: points.length,
          rows: res.rowsTotal,
          skipped: res.rowsSkipped,
          zeroGps: res.zeroGps,
          minDepth: Math.min(...depths),
          maxDepth: Math.max(...depths),
          medDepth: +median(depths).toFixed(2),
          medTemp: temps.length ? +median(temps).toFixed(1) : null,
          fileName: file.name,
          at: Date.now()
        }
        this.points = points
        this.persist()
        toast('已导入 ' + points.length + ' 个深度点（实测）')
        return true
      } catch (e: any) {
        const code = e && e.code ? e.code : ''
        const map: Record<string, string> = {
          NOT_DEEPER: '这个 CSV 不是 Deeper 的导出（列名对不上）。应该是 bathymetry.csv 或 scan_data_*.csv。',
          NO_ROWS: '文件里没有数据行。',
          STUB_FILE: '文件只有 1 行，像是没导完的残包。',
          MALFORMED: '脏行比例超过 1%（' + (e.ratio != null ? Math.round(e.ratio * 100) : '?') + '%），文件可能被截断或混进了别的内容。',
          NO_GPS: '所有点的坐标都是 0,0 —— 这次扫描没有定位记录。'
        }
        this.error = map[code] || ('解析失败：' + (e && e.message ? e.message : e))
        await alertBox(this.error, { title: '读不了这个文件' })
        return false
      } finally {
        this.busy = false
      }
    },

    persist() {
      try {
        Store.setItem(KEY, JSON.stringify({ points: this.points, stats: this.stats }))
      } catch { /* 配额满了就算了，内存里还有 */ }
    },

    async clear() {
      this.points = []
      this.stats = null
      this.error = ''
      try { Store.removeItem(KEY) } catch { /* 忽略 */ }
      toast('已清除声呐数据')
    }
  }
})
