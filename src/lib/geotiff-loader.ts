/* LureCast · geotiff.js 懒加载（P4）
   ---------------------------------------------------------------------------
   geotiff.js 是 UMD：挂在 window.GeoTIFF 上，310 KB。它只在「分析影像」时才需要，
   所以用 ?url 拿到打包后的真实路径，第一次调用时再插 <script>，不进 app chunk。
   sat.ts 从这里 import { GeoTIFF } —— 是个代理对象：属性访问时才触发加载，
   所以模块顶层 `GeoTIFF.fromUrl(...)` 这种写法会拿到 undefined 而不是抛错，
   调用方（Sat.analyse）会先 await ready()。 */
import geoUrl from '../../assets/vendor/geotiff.js?url'

export function ready(): Promise<any> {
  const w = window as any
  if (w.GeoTIFF) return Promise.resolve(w.GeoTIFF)
  if (pending) return pending
  pending = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = geoUrl
    s.async = true
    s.onload = () => (w.GeoTIFF ? resolve(w.GeoTIFF) : reject(new Error('geotiff.js 未挂到 window.GeoTIFF')))
    s.onerror = () => reject(new Error('geotiff.js 加载失败'))
    document.head.appendChild(s)
  })
  return pending
}

let pending: Promise<any> | null = null

/* 代理：属性访问转发到 window.GeoTIFF（懒加载完成前是 undefined） */
export const GeoTIFF: any = new Proxy({}, {
  get(_t, key) {
    const g = (window as any).GeoTIFF
    return g ? g[key] : undefined
  },
  has(_t, key) {
    const g = (window as any).GeoTIFF
    return g ? key in g : false
  }
})
