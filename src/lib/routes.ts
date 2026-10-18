/* LureCast · 岸钓路线 / 船钓直线（P4）—— 由 assets/app.js 的 osrmRoute / boatOrigin 搬运
   -----------------------------------------------------------------------------------
   路线服务由用户在设置里选：osrm（公共演示服务器）/ custom（自己的地址模板）/ off（不请求）。
   岸钓走真实路网（驾车路线，因为要到岸边停车点）；船钓就是水上直线 —— 不是航道，
   只是「直线距离」，用来判断船程。失败一律退化直线并在弹窗里说明原因，不静默画错。
   结果按 4 位小数缓存（≈11 m），同一对起终点不重复打网络。 */
import { CFG } from './cfg'

export type RouteResult = { pts: [number, number][]; meters: number; minutes: number }

const routeCache: Record<string, RouteResult> = {}

export function osrmRoute(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  profile = 'driving'
): Promise<RouteResult | null> {
  const key = profile + ':' + from.lat.toFixed(4) + ',' + from.lon.toFixed(4) + '>' +
    to.lat.toFixed(4) + ',' + to.lon.toFixed(4)
  if (routeCache[key]) return Promise.resolve(routeCache[key])
  if (CFG.route === 'off') return Promise.resolve(null)

  let url: string
  if (CFG.route === 'custom' && CFG.routeUrl) {
    url = CFG.routeUrl
      .replace(/\{profile\}/g, profile)
      .replace(/\{fromLat\}/g, String(from.lat)).replace(/\{fromLon\}/g, String(from.lon))
      .replace(/\{toLat\}/g, String(to.lat)).replace(/\{toLon\}/g, String(to.lon))
  } else {
    url = 'https://router.project-osrm.org/route/v1/' + profile + '/' +
      from.lon + ',' + from.lat + ';' + to.lon + ',' + to.lat +
      '?overview=simplified&geometries=geojson'
  }

  return fetch(url, { headers: { Accept: 'application/json' } })
    .then((r) => r.json())
    .then((j: any) => {
      const rt = j && j.routes && j.routes[0]
      if (!rt) return null
      const out: RouteResult = {
        pts: rt.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]),
        meters: rt.distance,
        minutes: rt.duration / 60
      }
      routeCache[key] = out
      return out
    })
    .catch(() => null)
}

/* 船钓起点：40 km 内最近的常用地点（通常是码头/停车场），否则用当前位置 */
export function boatOrigin(
  spot: { lat: number; lon: number },
  favorites: { lat: number; lon: number; name?: string }[],
  me: { lat: number; lon: number } | null,
  dist: (a: any, b: any) => number
): { pt: any; isFav: boolean } {
  let best: any = null
  let bestD = Infinity
  ;(favorites || []).forEach((f) => {
    const d = dist(f, spot)
    if (d < bestD) { bestD = d; best = f }
  })
  return (best && bestD < 40000) ? { pt: best, isFav: true } : { pt: me, isFav: false }
}
