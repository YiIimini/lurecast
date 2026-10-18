<script setup lang="ts">
import { computed } from 'vue'
import { useEnvStore } from '../../stores/env'

const env = useEnvStore()

function weatherText(code: number | null): string {
  if (code == null) return '天气未知'
  if (code === 0) return '晴'
  if (code <= 2) return '少云'
  if (code === 3) return '阴'
  if (code >= 45 && code <= 48) return '雾'
  if (code >= 51 && code <= 57) return '毛毛雨'
  if (code >= 61 && code <= 67) return '雨'
  if (code >= 71 && code <= 77) return '雪'
  if (code >= 80 && code <= 82) return '阵雨'
  if (code >= 95) return '雷雨'
  return '多云'
}
function relTime(ts: number): string {
  const d = Math.round((Date.now() - ts) / 60000)
  if (d <= 0) return '刚刚'
  if (d < 60) return d + ' 分钟前'
  return Math.round(d / 60) + ' 小时前'
}

const cur = computed(() => (env.wx && env.wx.data && env.wx.data.current) || {})
const code = computed(() => weatherText(cur.value.weather_code ?? null))
const cells = computed(() => {
  const c = cur.value
  return [
    ['气温', c.temperature_2m != null ? Math.round(c.temperature_2m * 10) / 10 : '--', '℃', code.value],
    ['体感', c.apparent_temperature != null ? Math.round(c.apparent_temperature) : '--', '℃', '风寒/闷热修正'],
    ['湿度', c.relative_humidity_2m != null ? Math.round(c.relative_humidity_2m) : '--', '%', '低湿多为高压晴稳'],
    ['气压', c.pressure_msl != null ? Math.round(c.pressure_msl * 10) / 10 : '--', 'hPa',
      env.dPi != null ? '3h ' + (env.dPi > 0 ? '+' : '') + Math.round(env.dPi * 10) / 10 : '趋势未知'],
    ['云量', c.cloud_cover != null ? Math.round(c.cloud_cover) : '--', '%', '散射光更利靠边'],
    ['降水', c.precipitation != null ? Math.round(c.precipitation * 10) / 10 : '--', 'mm/h',
      env.precipProb != null ? '概率 ' + Math.round(env.precipProb) + '%' : '概率未知']
  ]
})
const foot = computed(() => {
  if (!env.wx) return '数据：Open-Meteo（ICON/GFS 融合）'
  return 'Open-Meteo · ' + (env.wx.fromCache ? '缓存 ' + relTime(env.wx.at) : '刚刚拉取')
})
</script>

<template>
  <section class="card show" data-fam="weather">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="cloud"></i></span>
      <h2>天气实况</h2>
      <div class="head-right"><span class="card-note">{{ env.wx ? code : '--' }}</span></div>
    </div>
    <div class="statgrid">
      <div v-for="c in cells" :key="c[0]" class="st">
        <i>{{ c[0] }}</i><b>{{ c[1] }}<u>{{ c[2] }}</u></b><em>{{ c[3] }}</em>
      </div>
    </div>
    <div class="card-foot">{{ foot }}</div>
  </section>
</template>
