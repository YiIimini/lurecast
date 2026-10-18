/* LureCast · 「钓点分布」地图卡（P2）—— 对应老壳 #cardMap
   卡片本体只负责头部按钮、图例、脚注；制图逻辑在 MapView.vue。 */
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import MapView from '../MapView.vue'
import { useEnvStore } from '../../stores/env'
import { useSpotsStore } from '../../stores/spots'
import { MAPCFG, basemapById } from '../../lib/basemap'
import { useUiStore } from '../../stores/ui'

const env = useEnvStore()
const ui = useUiStore()

const props = withDefaults(defineProps<{ pickMode?: boolean }>(), { pickMode: false })
const emit = defineEmits<{
  (e: 'pick', lat: number, lon: number): void
}>()

const spots = useSpotsStore()
const mapRef = ref<any>(null)
const fs = ref(false)

const basemapName = ref(basemapById(MAPCFG.style).name)

function toggleFull() {
  fs.value = !fs.value
  document.body.classList.toggle('mapfs', fs.value)
  // 进出各变一次尺寸，两头都让 Leaflet 重算，否则瓦片留白
  setTimeout(() => mapRef.value && mapRef.value.invalidate(), 60)
  setTimeout(() => mapRef.value && mapRef.value.invalidate(), 320)
  if (fs.value && mapRef.value) mapRef.value.recenter()
}

function setHere(lat: number, lon: number) {
  env.load(lat, lon)
  spots.load(lat, lon)
}
/* 把地图实例交给 ui store：设置弹窗里换底图时直接调 applyBasemap，不用重建地图 */
onMounted(() => { ui.mapApi = mapRef.value })

onBeforeUnmount(() => {
  if (fs.value) document.body.classList.remove('mapfs')
  ui.mapApi = null
})

/* 卡片把地图的常用动作转出去：App 里点列表某个钓点要飞过去，全屏按钮要 invalidate */
defineExpose({
  ensureMap: () => mapRef.value && mapRef.value.ensureMap(),
  focusSpot: (s: any) => mapRef.value && mapRef.value.focusSpot(s),
  fitAll: () => mapRef.value && mapRef.value.fitAll(),
  recenter: () => mapRef.value && mapRef.value.recenter(),
  invalidate: () => mapRef.value && mapRef.value.invalidate()
})
</script>

<template>
  <section id="cardMap" class="card span2 show" :class="{ fs }" data-fam="map">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="map"></i></span>
      <h2>钓点分布</h2>
      <div class="head-right">
        <button class="act ghost icoact" data-tip="回到我的位置|把地图拉回你现在的坐标（GPS 或手动选的点）。"
                aria-label="回到我的位置" @click="mapRef && mapRef.recenter()">
          <i class="ic" data-icon="locate"></i>
        </button>
        <button class="act ghost icoact" data-tip="全屏看地图" aria-label="全屏看地图" @click="toggleFull">
          <i class="ic ic-in" data-icon="expand"></i><i class="ic ic-out" data-icon="shrink"></i>
        </button>
        <button class="act ghost" @click="mapRef && mapRef.fitAll()">看全部</button>
      </div>
    </div>

    <MapView ref="mapRef" :pick-mode="pickMode" @sethere="setHere" @pick="(lat, lon) => emit('pick', lat, lon)" />

    <div class="maplgd">
      <i><s style="background:#5be7ff"></s><span>你</span></i>
      <i><s style="background:#ffd166"></s><span>常用地点</span></i>
      <i><s style="background:#a5e05f"></s><span>高分钓点</span></i>
      <i><s style="background:#ffb454"></s><span>中等</span></i>
      <i><s style="background:#7d8fb4"></s><span>候选岸线点</span></i>
      <i><s style="background:#4ad6c8"></s><span>水域</span></i>
      <i><s style="background:#5be7ff"></s><span>岸钓路线</span></i>
      <i><s style="background:#ff9ecb"></s><span>船钓直线</span></i>
    </div>
    <div class="card-foot">底图 <b>{{ basemapName }}</b> · 数据 © OpenStreetMap 贡献者</div>
  </section>
</template>
