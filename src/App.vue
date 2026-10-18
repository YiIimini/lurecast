<script setup lang="ts">
/* LureCast 新壳（P2）
   ------------------------------------------------------------------
   · 「结论」页：定位卡 + 5 张环境卡（P1 完成）
   · 「钓点」页：地图卡 + 推荐钓点（P2 新增）
   · 「影像」「我的」还没搬，页签保留占位
   取数顺序照老壳：先气象出结论，再拉岸线补钓点（OSM 常常 10–30 s，别让整页干等）。 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useEnvStore } from './stores/env'
import { useSpotsStore } from './stores/spots'
import { useMyStore } from './stores/my'
import { useUiStore } from './stores/ui'
import CardLoc from './components/cards/CardLoc.vue'
import CardScore from './components/cards/CardScore.vue'
import CardTime from './components/cards/CardTime.vue'
import CardWeather from './components/cards/CardWeather.vue'
import CardWind from './components/cards/CardWind.vue'
import CardWater from './components/cards/CardWater.vue'
import CardMap from './components/cards/CardMap.vue'
import CardFav from './components/cards/CardFav.vue'
import CardCatch from './components/cards/CardCatch.vue'
import CardAqua from './components/cards/CardAqua.vue'
import CardTerrain from './components/cards/CardTerrain.vue'
import CardSpot from './components/cards/CardSpot.vue'
import FindWater from './components/modals/FindWater.vue'
import ShareModal from './components/modals/ShareModal.vue'
import SettingsModal from './components/modals/SettingsModal.vue'
import AgentModal from './components/modals/AgentModal.vue'
import CardSat from './components/cards/CardSat.vue'

const env = useEnvStore()
const spots = useSpotsStore()
const my = useMyStore()
const ui = useUiStore()

const mapRef = ref<any>(null)

const statusText = computed(() => {
  if (env.loading) return '正在取数…'
  if (spots.loading) return '岸线分析中…'
  if (env.error) return env.error
  if (env.wx) return '数据已更新'
  return '等待定位…'
})
const statusKind = computed(() => (env.error ? 'err' : env.wx ? 'ok' : 'off'))
const clock = computed(() => {
  if (!env.nowMs) return '--:--'
  const d = new Date(env.nowMs)
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0')
})

async function loadAt(lat: number, lon: number, force = false, source: 'manual' | 'url' | 'gps' = 'manual') {
  await env.load(lat, lon, force, source)
  // 岸线是慢源：气象已出来后单独跑，到了就地补画钓点
  spots.load(lat, lon, force)
}

function locate() {
  if (!navigator.geolocation) return loadAt(31.2304, 121.4737)
  navigator.geolocation.getCurrentPosition(
    (p) => loadAt(p.coords.latitude, p.coords.longitude, false, 'gps'),
    () => loadAt(31.2304, 121.4737), // 拿不到定位就退到杭州西湖，方便对照
    { enableHighAccuracy: false, timeout: 12000 }
  )
}

/* 环境分 / 目标鱼 / 风一变，钓点排名立刻重排（不重新取数） */
watch(() => [env.env && (env.env as any).score, env.species], () => spots.rebuild())


/* 页签/弹窗切出来的新 [data-icon] 要重画一次（Icons.paint 幂等） */
function paintIcons() { nextTick(() => (window as any).__lcPaintIcons?.()) }
watch(() => [ui.tab, ui.modal], paintIcons)
/* 地图取点：弹窗那边挂了回调就回填坐标，否则当作「设为当前位置」 */
function onMapPick(lat: number, lon: number) {
  if (ui.pickMode) ui.finishPick(lat, lon)
  else loadAt(lat, lon)
}

/* 列表里点某个钓点 → 地图飞过去 */
function onFocusSpot(s: any) {
  ui.setTab('spots')
  if (mapRef.value) mapRef.value.ensureMap().then(() => mapRef.value.focusSpot(s))
}

onMounted(() => {
  my.load()
  const q = new URLSearchParams(location.search)
  const lat = Number(q.get('lat'))
  const lon = Number(q.get('lon'))
  if (isFinite(lat) && isFinite(lon) && lat && lon) loadAt(lat, lon, false, 'url')
  else locate()
})
</script>

<template>
  <div class="topbar">
    <header class="titlebar">
      <div class="brand">
        <img class="brand-mark" src="/icons/icon-192.png" alt="LureCast" width="26" height="26">
        <div><b>LureCast</b><span>路亚潮汐 · 钓点推荐</span></div>
      </div>
      <div class="spacer"></div>
      <button class="act primary" :disabled="env.loading" @click="env.me && loadAt(env.me.lat, env.me.lon, true)">
        <i class="ic" data-icon="refresh"></i><span class="lbl">刷新</span>
      </button>
      <button class="act ghost" aria-label="设置" data-tip="设置|外观 / 判定口径 / 地图 / 识图 Key / 数据与版本"
              @click="ui.openModal('settings')"><i class="ic" data-icon="settings"></i></button>
      <button class="act ghost" aria-label="应用助手" data-tip="应用助手|读本机数据回答问题（需要在设置里填 Key）"
              @click="ui.openModal('agent')"><i class="ic" data-icon="ai"></i></button>
    </header>

    <div class="strip">
      <span class="dot" :class="statusKind"></span>
      <span class="state-text grow">{{ statusText }}</span>
      <span class="sep"></span>
      <span class="idx"><b>{{ env.score ?? '--' }}</b><em>分</em></span>
      <span class="sep"></span>
      <span class="mono">{{ clock }}</span>
    </div>

    <nav class="tabs" role="tablist">
      <button v-for="t in [['summary','结论'],['spots','钓点'],['sat','影像'],['me','我的']]" :key="t[0]"
              class="tab" :class="{ on: ui.tab === t[0] }" role="tab" @click="ui.setTab(t[0] as any)">{{ t[1] }}</button>
    </nav>
  </div>

  <main class="stage">
    <div class="cols">
      <template v-if="ui.tab === 'summary'">
        <CardLoc />
        <CardScore />
        <CardTime />
        <CardWeather />
        <CardWind />
        <CardWater />
      </template>

      <template v-else-if="ui.tab === 'spots'">
        <CardMap ref="mapRef" :pick-mode="ui.pickMode" @pick="onMapPick" />
        <CardSpot @focus="onFocusSpot" />
      </template>

      <template v-else-if="ui.tab === 'me'">
        <CardFav />
        <CardCatch />
        <CardAqua />
      </template>

      <template v-else>
        <CardTerrain />
        <CardSat />
      </template>
    </div>
  </main>

  <FindWater />
  <ShareModal />
  <SettingsModal />
  <AgentModal />
</template>
