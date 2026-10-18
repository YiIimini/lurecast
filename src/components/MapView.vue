/* LureCast · 地图视图（P2）—— 由老壳 initMap()/drawMap()/focusSpot()/fitAll()/mapFull() 搬运
   ---------------------------------------------------------------------------------
   · Leaflet 仍本地自托管，用到时才加载（src/lib/leaflet.ts）；
   · 图层分组与老壳一一对应：me / water / cands / spots / favs（常用地点等 P3 搬过来再填）；
   · 点地图任意位置 = 「设为当前位置」；父组件开了 pickMode 就只把坐标抛出去（在地图选点用）。 */
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadLeaflet } from '../lib/leaflet'
import { MAPCFG, basemapById, mapAttribution, resolveTileUrl } from '../lib/basemap'
import { useEnvStore } from '../stores/env'
import { useSpotsStore } from '../stores/spots'
import { Engine as E } from '../lib/engine'

const props = withDefaults(defineProps<{ pickMode?: boolean }>(), { pickMode: false })
const emit = defineEmits<{
  (e: 'pick', lat: number, lon: number): void
  (e: 'sethere', lat: number, lon: number): void
  (e: 'ready'): void
}>()

const env = useEnvStore()
const spots = useSpotsStore()

const mapEl = ref<HTMLDivElement | null>(null)
const darkTiles = ref(!!basemapById(MAPCFG.style).dark)
const failed = ref('')

let L: any = null
let map: any = null
let tile: any = null
let layers: any = null
let disposed = false

/* ---------------------------------------------------------------- 建图 */
async function ensureMap() {
  if (map || disposed) return map
  if (!env.me || !mapEl.value) return null
  try {
    L = await loadLeaflet()
  } catch (e: any) {
    failed.value = (e && e.message) || '地图加载失败'
    return null
  }
  if (disposed || !mapEl.value) return null
  map = L.map(mapEl.value, { zoomControl: true, scrollWheelZoom: true })
    .setView([env.me.lat, env.me.lon], 14)
  const url = resolveTileUrl() || 'https://tile.openstreetmap.de/{z}/{x}/{y}.png'
  tile = L.tileLayer(url, {
    maxZoom: 19, attribution: mapAttribution(), subdomains: 'abc', crossOrigin: true
  }).addTo(map)
  layers = {
    water: L.layerGroup().addTo(map),
    cands: L.layerGroup().addTo(map),
    spots: L.layerGroup().addTo(map),
    favs: L.layerGroup().addTo(map),
    me: L.layerGroup().addTo(map)
  }
  /* 点地图任意位置：选点模式下只抛坐标，否则问「把这里设为当前位置？」 */
  map.on('click', (e: any) => {
    const ll = e.latlng
    if (props.pickMode) { emit('pick', ll.lat, ll.lng); return }
    const pop = L.popup({ closeButton: true, className: 'locpick', offset: [0, -6] })
      .setLatLng(ll)
      .setContent(
        '<div class="pickbox"><b>' + ll.lat.toFixed(4) + ', ' + ll.lng.toFixed(4) + '</b>' +
        '<p>把这里设为当前位置？</p>' +
        '<button class="act primary" data-sethere="1">设为当前位置</button></div>'
      )
      .openOn(map)
    // 弹窗内容是后插入的，事件要等 DOM 就绪再绑
    const btn = pop.getElement() ? pop.getElement().querySelector('[data-sethere]') : null
    if (btn) btn.addEventListener('click', () => {
      map.closePopup(pop)
      emit('sethere', ll.lat, ll.lng)
    })
  })
  emit('ready')
  draw()
  return map
}

/* ---------------------------------------------------------------- 画要素 */
function draw() {
  if (!map || !layers || !env.me) return
  layers.me.clearLayers()
  layers.cands.clearLayers()
  layers.spots.clearLayers()
  layers.water.clearLayers()
  layers.favs.clearLayers()

  L.circleMarker([env.me.lat, env.me.lon], {
    radius: 7, color: '#5be7ff', weight: 2, fillColor: '#5be7ff', fillOpacity: 0.85
  }).bindPopup('你在这里').addTo(layers.me)

  // 水域轮廓（最多 12 处，和老壳一致：太多会把地图糊住）
  ;(spots.bodies || []).slice(0, 12).forEach((b: any) => {
    ;(b.rings || []).forEach((ring: any[]) => {
      L.polyline(ring.map((p: any) => [p.lat, p.lon]), {
        color: '#4ad6c8', weight: 1, opacity: 0.45, dashArray: '3 4'
      }).addTo(layers.water)
    })
  })

  // 候选岸线点
  ;(spots.cands || []).forEach((c: any) => {
    L.circleMarker([c.lat, c.lon], {
      radius: 2.5, color: '#7d8fb4', weight: 1, fillColor: '#7d8fb4', fillOpacity: 0.5
    }).addTo(layers.cands)
  })

  // 推荐钓点（前 8 个，颜色按分档）
  ;(spots.spots || []).slice(0, 8).forEach((s: any) => {
    const color = s.spotScore >= 75 ? '#a5e05f' : (s.spotScore >= 55 ? '#ffb454' : '#7d8fb4')
    const m = L.circleMarker([s.lat, s.lon], {
      radius: 8, color, weight: 2, fillColor: color, fillOpacity: 0.35
    }).bindPopup(
      '<b>' + esc(s.name || '钓点') + ' ' + s.spotScore + ' 分</b><br>' +
      esc((s.tags || []).map((t: any) => t.txt).join(' · ')) + '<br>' +
      esc((s.reasons || []).join('；')) +
      '<br><span style="color:#a5e05f">点这里 = 设为目标钓点</span>'
    )
    m.on('click', () => spots.setNavTarget(s))
    m.addTo(layers.spots)
  })
}

function esc(s: any) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c])
}

/* ---------------------------------------------------------------- 对外动作 */
function fitAll() {
  if (!map) { ensureMap().then(() => fitAll()); return }
  if (!env.me) return
  const pts: any[] = [[env.me.lat, env.me.lon]]
  ;(spots.spots || []).slice(0, 8).forEach((s: any) => pts.push([s.lat, s.lon]))
  map.fitBounds(pts, { padding: [28, 28], maxZoom: 16 })
}

function recenter() {
  if (!map) { ensureMap().then(() => recenter()); return }
  if (!env.me) return
  map.setView([env.me.lat, env.me.lon], Math.max(map.getZoom(), 14))
}

function focusSpot(s: any) {
  if (!map) { ensureMap().then(() => focusSpot(s)); return }
  map.flyTo([s.lat, s.lon], 16, { duration: 0.6 })
}

function invalidate() {
  if (map) map.invalidateSize()
}

/* 换底图（设置弹窗用）：只替换瓦片层，钓点/岸线保留 */
function applyBasemap() {
  darkTiles.value = !!basemapById(MAPCFG.style).dark
  if (!map || !L) return
  const url = resolveTileUrl()
  if (!url) return
  if (tile) { map.removeLayer(tile); tile = null }
  tile = L.tileLayer(url, {
    maxZoom: 19, attribution: mapAttribution(), subdomains: 'abc', crossOrigin: true
  }).addTo(map)
  if (tile.bringToBack) tile.bringToBack()
}

function setCursor(cross: boolean) {
  if (map) map.getContainer().style.cursor = cross ? 'crosshair' : ''
}

defineExpose({ ensureMap, draw, fitAll, recenter, focusSpot, invalidate, applyBasemap, setCursor })

/* ---------------------------------------------------------------- 联动 */
onMounted(() => { if (env.me) ensureMap() })
onBeforeUnmount(() => {
  disposed = true
  if (map) { map.remove(); map = null; layers = null; tile = null }
})

/* 位置变了：地图跟着走（老壳是销毁重建，这里重建图层就够，瓦片不用重下） */
watch(() => env.me, (me) => {
  if (!me) return
  if (!map) { ensureMap(); return }
  map.setView([me.lat, me.lon], Math.max(map.getZoom(), 13))
  draw()
})
watch(() => spots.cands, draw)
watch(() => spots.spots, draw)
watch(() => spots.bodies, draw)
watch(() => props.pickMode, (on) => setCursor(on))

void E
</script>

<template>
  <div class="mapbox" :class="{ darktiles: darkTiles }">
    <div id="map" ref="mapEl"></div>
    <div v-if="failed" class="empty" style="position:absolute;inset:0;justify-content:center">
      <b>地图加载失败</b><p>{{ failed }}</p>
    </div>
  </div>
</template>
