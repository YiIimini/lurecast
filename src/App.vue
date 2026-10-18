<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useEnvStore } from './stores/env'
import CardLoc from './components/cards/CardLoc.vue'
import CardScore from './components/cards/CardScore.vue'
import CardTime from './components/cards/CardTime.vue'
import CardWeather from './components/cards/CardWeather.vue'
import CardWind from './components/cards/CardWind.vue'
import CardWater from './components/cards/CardWater.vue'

const env = useEnvStore()
const tab = ref<'summary' | 'spots' | 'sat' | 'me'>('summary')

const statusText = computed(() => {
  if (env.loading) return '正在取数…'
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

function locate() {
  if (!navigator.geolocation) return env.load(31.2304, 121.4737)
  navigator.geolocation.getCurrentPosition(
    (p) => env.load(p.coords.latitude, p.coords.longitude),
    () => env.load(31.2304, 121.4737), // 拿不到定位就退到杭州西湖，方便对照
    { enableHighAccuracy: false, timeout: 12000 }
  )
}

onMounted(() => {
  const q = new URLSearchParams(location.search)
  const lat = Number(q.get('lat'))
  const lon = Number(q.get('lon'))
  if (isFinite(lat) && isFinite(lon) && lat && lon) env.load(lat, lon)
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
      <button class="act primary" :disabled="env.loading" @click="env.me && env.load(env.me.lat, env.me.lon, true)">
        <i class="ic" data-icon="refresh"></i><span class="lbl">刷新</span>
      </button>
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
              class="tab" :class="{ on: tab === t[0] }" role="tab" @click="tab = t[0] as any">{{ t[1] }}</button>
    </nav>
  </div>

  <main class="stage">
    <div class="cols">
      <template v-if="tab === 'summary'">
        <CardLoc />
        <CardScore />
        <CardTime />
        <CardWeather />
        <CardWind />
        <CardWater />
      </template>
      <section v-else class="card span2 show">
        <div class="card-head">
          <span class="ico"><i class="ic" data-icon="info"></i></span>
          <h2>{{ tab === 'spots' ? '钓点' : tab === 'sat' ? '影像' : '我的' }}</h2>
        </div>
        <div class="empty">
          <b>P1 阶段只迁移了「结论」页</b>
          <p>这一页还在老壳里（<code>index.html</code>）。按 strangler 计划，下一轮迁「我的」，再下一轮是地图与钓点。</p>
        </div>
      </section>
    </div>
  </main>
</template>
