<script setup lang="ts">
/* LureCast · 「当前位置与水域」卡（P2 补全）—— 对应老壳 #cardLoc / renderLoc()
   地名三级兜底与老壳一致：用户/搜索给的 → Nominatim 逆地理 → OSM 里最近那处水域的名字。
   最后这条不花一次网络请求，逆地理超时（实测常 6 s 才失败）时也不会显示「未命名位置」。 */
import { computed } from 'vue'
import { useEnvStore } from '../../stores/env'
import { useSpotsStore } from '../../stores/spots'
import { useUiStore } from '../../stores/ui'
import { Engine as E } from '../../lib/engine'

const env = useEnvStore()
const spots = useSpotsStore()
const ui = useUiStore()

/* 老壳的水域 chip 只用这四档（水库/湖 在 engine 里叫 reservoir） */
const types = [['auto', '自动'], ['reservoir', '水库/湖'], ['river', '河流'], ['sea', '海/河口']] as const
const species = computed(() => Object.keys((E as any).SPECIES))

const coord = computed(() => (env.me ? `${env.me.lat.toFixed(4)}, ${env.me.lon.toFixed(4)}` : '未定位'))
const acc = computed(() => (env.me && (env.me as any).acc ? '+-' + Math.round((env.me as any).acc) + ' m' : '精度未知'))

const bodyName = computed(() => {
  const bodies = (spots.pickBodies && spots.pickBodies.length ? spots.pickBodies : spots.bodies) || []
  for (const b of bodies) if (b && b.name) return b.name
  return ''
})
const place = computed<any>(() => env.place || {})
const name = computed(() => {
  const p = place.value
  return env.placeHint || p.name ||
    (p.address && (p.address.city || p.address.town || p.address.county)) ||
    (bodyName.value ? bodyName.value + ' 附近' : '未命名位置')
})
const addr = computed(() => place.value.display_name || (bodyName.value ? '取自 OSM 水域名' : ''))

const nearBody = computed<any>(() => (spots.pickBodies && spots.pickBodies[0]) || null)
const near = computed(() => {
  if (nearBody.value) return nearBody.value.name || env.typeLabel
  return spots.bodies && spots.bodies.length ? (spots.bodies[0] as any).name : '附近没有 OSM 收录的水域'
})
const nearDist = computed(() => {
  if (!nearBody.value) return null
  const md = nearBody.value.minDist
  if (md != null && isFinite(md)) return md
  if (!env.me || !nearBody.value.center) return null
  return E.dist(env.me as any, nearBody.value.center)
})
const sourceText = computed(() =>
  env.locSource === 'gps' ? 'GPS 定位' : (env.locSource === 'url' ? '链接参数' : '手动选点'))

function locate() {
  if (!navigator.geolocation) return
  navigator.geolocation.getCurrentPosition(
    (p) => env.load(p.coords.latitude, p.coords.longitude, false, 'gps'),
    () => { /* 拒绝授权就保持当前点 */ },
    { enableHighAccuracy: true, timeout: 12000 }
  )
}
</script>

<template>
  <section class="card span2 show" data-fam="loc">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="pin"></i></span>
      <h2>当前位置与水域</h2>
      <div class="head-right">
        <button class="act ghost" @click="ui.openModal('share')">分享</button>
        <button class="act ghost" @click="ui.openModal('findWater')">找水域</button>
        <button class="act ghost" @click="locate">用 GPS 定位</button>
      </div>
    </div>

    <div v-if="!env.me" class="empty">
      <b>还没定位</b>
      <p>允许浏览器定位，或点右上「找水域」手动搜索一个湖/河/海。</p>
    </div>

    <div v-else>
      <div class="loctitle">
        <b>{{ name }}</b>
        <span>{{ coord }} · {{ acc }}</span>
      </div>
      <div v-if="addr" class="card-note" style="margin-top:4px">{{ addr }}</div>
      <div class="locgrid">
        <div class="kv"><i>水域类型</i><b>{{ env.typeLabel }}</b><em>{{ env.waterType === 'auto' ? '自动' : '手动' }}</em></div>
        <div class="kv"><i>最近水域</i><b>{{ near }}</b><em>{{ nearDist != null ? E.fmtDist(nearDist) : '—' }}</em></div>
        <div class="kv"><i>候选岸线点</i><b>{{ spots.candCount ? spots.candCount + ' 个' : '无' }}</b></div>
        <div class="kv"><i>位置来源</i><b>{{ sourceText }}</b></div>
      </div>
    </div>

    <div class="chipwrap">
      <div class="chiprow">
        <span class="chiprow-key">水域</span>
        <button v-for="t in types" :key="t[0]" class="chip" :class="{ on: env.waterType === t[0] }"
                @click="env.setWaterType(t[0] as any)">
          {{ t[1] }}
          <em v-if="t[0] === 'auto' && env.waterAuto && env.waterAuto !== 'unknown'">{{ env.typeLabel }}</em>
        </button>
      </div>
      <div class="chiprow">
        <span class="chiprow-key">目标鱼</span>
        <button v-for="k in species" :key="k" class="chip" :class="{ on: env.species === k }"
                @click="env.setSpecies(k)">{{ (E as any).SPECIES[k].label }}</button>
      </div>
    </div>
    <div class="card-foot">水域类型靠海况接口与 OSM 标签自动判，不对就点上面 chips 改。</div>
  </section>
</template>
