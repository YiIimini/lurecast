/* LureCast · 「推荐钓点」排序列表（P2）—— 对应老壳 #cardSpot / renderSpots()
   分数与排序全部来自 E.pickSpots（环境 50% / 结构 40% / 可达 10%），这里只负责呈现。 */
<script setup lang="ts">
import { computed } from 'vue'
import { useEnvStore } from '../../stores/env'
import { useSpotsStore } from '../../stores/spots'
import { Engine as E } from '../../lib/engine'

const env = useEnvStore()
const spots = useSpotsStore()
const emit = defineEmits<{ (e: 'focus', spot: any): void }>()

const note = computed(() => {
  if (spots.loading) return '正在加载…'
  if (!spots.spots.length) return '无数据 · 试着手动选水域'
  return '候选 ' + spots.spots.length + ' 个 · 环境 50% / 结构 40% / 可达 10%'
})

/* UI 只展示前 6 个：再多用户也点不过来，和老壳一致 */
const top = computed(() => (spots.spots || []).slice(0, 6))

function level(s: any) {
  return s.spotScore >= 75 ? 'lv-hi' : (s.spotScore >= 55 ? 'lv-mid' : 'lv-low')
}

function isTarget(s: any) {
  const t = spots.navTarget
  return !!t && Math.abs(t.lat - s.lat) < 1e-6 && Math.abs(t.lon - s.lon) < 1e-6
}

function pick(s: any) {
  if (isTarget(s)) {
    spots.navTarget = null
    return
  }
  spots.setNavTarget(s)
  emit('focus', s)
}

function retry() {
  if (env.me) spots.load(env.me.lat, env.me.lon, true)
}
</script>

<template>
  <section class="card span2 show" data-fam="spot">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="fish"></i></span>
      <h2>推荐钓点</h2>
      <div class="head-right"><span class="card-note">{{ note }}</span></div>
    </div>

    <div class="spots">
      <div v-if="!top.length" class="empty">
        <b>附近没有可用的岸线结构</b>
        <p>OSM 里这一带（1.6 km，已尝试扩到 4 km）没有收录有形状的水域或海岸线。可以：换到水域边上再定位、「找水域」搜索具体湖名、或把目标鱼换成通用再看。</p>
        <p>如果这里本来就是外海或大水面中心，岸钓确实没有「岸」可打 —— 这种情况要靠船钓点位，本应用给不出。</p>
        <p v-if="spots.error">{{ spots.error }}</p>
        <button class="act" style="margin-top:4px" @click="retry">重新查询岸线</button>
      </div>

      <button v-for="(s, i) in top" :key="s.id || i" class="spot" :class="[level(s), { on: isTarget(s) }]"
              @click="pick(s)">
        <span class="rank">{{ i + 1 }}</span>
        <span class="spot-main">
          <span class="spot-title">
            <b>{{ s.title || s.name || '无名水域' }}</b>
            <em>{{ E.fmtDist(s.distToMe) }} · {{ E.compass(s.bearingFromMe) }}面 · {{ s.lat.toFixed(4) }}, {{ s.lon.toFixed(4) }}</em>
          </span>
          <span class="spot-tags"><i v-for="(t, ti) in s.tags" :key="ti" :class="{ hi: t.hi }">{{ t.txt }}</i></span>
          <span class="spot-why">{{ (s.reasons || []).join('；') }}</span>
          <span class="spot-why">建议拟饵：{{ (s.lure || []).join(' / ') }}</span>
          <span class="spot-nav" :class="{ on: isTarget(s) }">{{ isTarget(s) ? '目标钓点' : '设为目标' }}</span>
        </span>
        <span class="spot-side"><b>{{ s.spotScore }}</b><em>分</em></span>
      </button>
    </div>

    <div class="card-foot">点位结构由 OpenStreetMap 岸线 + Copernicus DEM 高程推断，不是水下实测地形。</div>
  </section>
</template>
