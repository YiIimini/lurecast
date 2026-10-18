<script setup lang="ts">
/* LureCast · 「找水域」弹窗（P2）—— 对应老壳 #modalManual / initManual()
   搜索命中水域时用 bbox 把落点换算到离你最近的岸边（搜到的常是湖心坐标，
   直接定位会落在水中央）；常用地点列表要等「我的」页搬过来才有，这里先留空位。 */
import { computed, onMounted, ref, watch } from 'vue'
import { Api } from '../../lib/api'
import { Store } from '../../lib/store'
import { useEnvStore } from '../../stores/env'
import { useSpotsStore } from '../../stores/spots'
import { useUiStore } from '../../stores/ui'
import { toastMsg } from '../../stores/spots'

const env = useEnvStore()
const spots = useSpotsStore()
const ui = useUiStore()

const KIND_LABEL: Record<string, string> = {
  lake: '湖', reservoir: '水库', water: '水面', pond: '塘', river: '河', canal: '运河',
  stream: '溪流', bay: '湾', strait: '海峡', wetland: '湿地', waterway: '水道',
  place: '地名', village: '村', town: '镇', city: '城市', administrative: '行政区'
}
const WATER_KINDS = ['lake', 'reservoir', 'water', 'river', 'bay', 'wetland', 'pond']
const EXAMPLES = ['太湖', '千岛湖', '鄱阳湖', '洞庭湖', '洪湖', '巢湖', '密云水库', '丹江口水库']
const HIST_KEY = 'lc:searchhist'

const q = ref('')
const busy = ref(false)
const results = ref<any[]>([])
const searched = ref(false)
const latInput = ref('')
const lonInput = ref('')
const hist = ref<any[]>(readHist())

const showHist = computed(() => hist.value.length > 0)
const visible = computed(() => ui.modal === 'findWater')

let tmr = 0

function readHist(): any[] {
  try {
    const raw = Store.getItem(HIST_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.slice(0, 8) : []
  } catch { return [] }
}

function pushHist(item: any) {
  if (!item || !item.name) return
  const list = readHist().filter((x: any) =>
    !(Math.abs(x.lat - item.lat) < 0.0008 && Math.abs(x.lon - item.lon) < 0.0008))
  list.unshift({ name: String(item.name).slice(0, 40), kind: item.kind || '', lat: item.lat, lon: item.lon, at: Date.now() })
  try { Store.setItem(HIST_KEY, JSON.stringify(list.slice(0, 8))) } catch { /* 忽略 */ }
  hist.value = readHist()
}

function clearHist() {
  try { Store.removeItem(HIST_KEY) } catch { /* 忽略 */ }
  hist.value = []
  toastMsg('已清空搜索历史')
}

/* 搜到的水域常给「湖心」坐标：换算到离我最近的岸边 */
function nearestOnBbox(bb: number[], me: { lat: number; lon: number } | null) {
  if (!bb) return null
  let lat = Math.min(bb[3], Math.max(bb[1], me ? me.lat : (bb[1] + bb[3]) / 2))
  let lon = Math.min(bb[2], Math.max(bb[0], me ? me.lon : (bb[0] + bb[2]) / 2))
  const inside = lat > bb[1] && lat < bb[3] && lon > bb[0] && lon < bb[2]
  if (inside) {
    const dS = lat - bb[1], dN = bb[3] - lat, dW = lon - bb[0], dE = bb[2] - lon
    const m = Math.min(dS, dN, dW, dE)
    if (m === dS) lat = bb[1] + 0.0015
    else if (m === dN) lat = bb[3] - 0.0015
    else if (m === dW) lon = bb[0] + 0.0015
    else lon = bb[2] - 0.0015
  }
  return { lat, lon }
}

function go(lat: number, lon: number, hint?: string | null) {
  ui.closeModal()
  env.placeHint = hint || null
  env.load(lat, lon)
  spots.load(lat, lon)
}

function useResult(r: any) {
  const isWater = WATER_KINDS.indexOf(r.kind) >= 0
  const pt = isWater && r.bbox ? nearestOnBbox(r.bbox, env.me as any) : { lat: r.lat, lon: r.lon }
  if (!pt) return
  pushHist({ name: r.name, kind: r.kind, lat: pt.lat, lon: pt.lon })
  go(pt.lat, pt.lon, isWater ? r.name : null)
}

function useHist(x: any) {
  go(x.lat, x.lon, x.name)
}

function useCoord() {
  const lat = parseFloat(latInput.value)
  const lon = parseFloat(lonInput.value)
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    toastMsg('坐标不合法：纬度 ±90、经度 ±180')
    return
  }
  go(lat, lon)
}

/* 在地图上选点：切到钓点页进入取点模式，点完回填坐标 */
function pickOnMap() {
  ui.startPickOnMap((lat, lon) => {
    latInput.value = lat.toFixed(5)
    lonInput.value = lon.toFixed(5)
    ui.openModal('findWater')
    toastMsg('已取点 ' + lat.toFixed(4) + ', ' + lon.toFixed(4) + '，点「用这个坐标」生效')
  })
}

function doSearch() {
  const term = q.value.trim()
  if (!term) { results.value = []; searched.value = false; return }
  busy.value = true
  searched.value = true
  Api.search(term).then((list: any[]) => {
    results.value = list || []
  }).catch(() => {
    results.value = []
  }).finally(() => { busy.value = false })
}

watch(q, () => {
  clearTimeout(tmr)
  tmr = window.setTimeout(doSearch, 700) // Nominatim 使用政策：别高频
})
watch(() => ui.modal, (m) => {
  if (m === 'findWater') hist.value = readHist()
})
onMounted(() => { hist.value = readHist() })
</script>

<template>
  <div class="modal" :class="{ hidden: !visible }" @click.self="ui.closeModal()">
    <div class="modal-box">
      <div class="modal-head">
        <h3>找水域 / 手动选点</h3>
        <button class="act ghost" @click="ui.closeModal()">关闭</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>搜索地名 / 水域名（OpenStreetMap Nominatim，中文优先）</label>
          <input v-model="q" placeholder="例如：千岛湖、太湖、Bass Pro Lake" autocomplete="off">
        </div>

        <div class="reslist">
          <p v-if="busy" class="hint">正在搜索「{{ q }}」…</p>
          <template v-else-if="results.length">
            <button v-for="(r, i) in results" :key="i" @click="useResult(r)">
              <span class="restag" :class="{ water: WATER_KINDS.indexOf(r.kind) >= 0 }">{{ KIND_LABEL[r.kind] || r.kind || '地点' }}</span>
              {{ r.name }}
              <em>{{ r.label }}<br>{{ r.bbox ? '水域范围 · 会落到离你最近的岸边' : r.lat.toFixed(4) + ', ' + r.lon.toFixed(4) }}
                · {{ r.source === 'osm' ? 'OpenStreetMap' : 'Open-Meteo' }}</em>
            </button>
          </template>
          <template v-else-if="searched">
            <p class="hint">没搜到。可以直接填经纬度，或点下面的常用水域：</p>
            <div class="chiprow">
              <button v-for="x in EXAMPLES" :key="x" class="chip" @click="q = x">{{ x }}</button>
            </div>
          </template>
        </div>

        <div v-if="showHist" class="field">
          <label>最近搜过（点一下直接切过去）</label>
          <div class="reslist">
            <button v-for="(x, i) in hist" :key="i" class="resitem slim" @click="useHist(x)">
              <b>{{ x.name }}</b>
              <span>{{ KIND_LABEL[x.kind] || '地点' }} · {{ x.lat.toFixed(4) }}, {{ x.lon.toFixed(4) }}</span>
            </button>
            <button class="chip" style="align-self:flex-start" @click="clearHist">清空历史</button>
          </div>
        </div>

        <div class="field">
          <label>或直接填坐标（WGS84）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input v-model="latInput" placeholder="纬度 31.2304" style="flex:1 1 140px">
            <input v-model="lonInput" placeholder="经度 121.4737" style="flex:1 1 140px">
            <button class="act primary" @click="useCoord">用这个坐标</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <button class="act" @click="pickOnMap">在地图上选点</button>
          <span class="hint" style="margin:0">先在上面搜地名，再点地图微调位置</span>
        </div>
        <p class="hint">外出没网时可以先打开一次让数据进缓存；缓存窗口 10 分钟。GPS 需要 https 或 localhost，直接双击 html 文件浏览器会拒绝定位。</p>
      </div>
      <div class="modal-foot">搜索与逆地理由 OpenStreetMap Nominatim / Open-Meteo 提供，请勿高频请求。</div>
    </div>
  </div>
</template>
