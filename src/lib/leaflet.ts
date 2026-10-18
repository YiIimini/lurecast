/* LureCast · Leaflet 加载器（P2）
   Leaflet 1.9.4 已本地自托管在 assets/vendor/leaflet/（P0 前的零风险项），
   这里用 `?url` 拿到构建后真实路径再插 <script>，避免把这套 UMD 打进 app chunk：
     · 第一次用到地图时才下载（首屏不受影响）；
     · 全局只加载一次，重复调用返回同一个 Promise。 */
import leafletUrl from '../../assets/vendor/leaflet/leaflet.js?url'

let pending: Promise<any> | null = null

export function loadLeaflet(): Promise<any> {
  const w = window as any
  if (w.L) return Promise.resolve(w.L)
  if (pending) return pending
  pending = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = leafletUrl
    s.async = true
    s.onload = () => {
      if (w.L) resolve(w.L)
      else reject(new Error('Leaflet 未挂到 window.L'))
    }
    s.onerror = () => reject(new Error('Leaflet 脚本加载失败'))
    document.head.appendChild(s)
  })
  return pending
}
