<script setup lang="ts">
import { computed } from 'vue'
import { useEnvStore } from '../../stores/env'

const env = useEnvStore()
const w = computed(() => env.water || null)
const sea = computed(() => (env.sea && env.sea.data && env.sea.data.current) || {})

const title = computed(() => {
  if (!w.value) return '水位与水流'
  if (w.value.mode === 'sea') return '潮汐与海况'
  return w.value.mode === 'river' ? '流量与水位趋势' : '水位趋势（代理）'
})
const note = computed(() => {
  const x = w.value
  if (!x) return '--'
  if (x.mode === 'sea') return x.rate2h != null ? (x.rate2h > 0 ? '涨潮' : x.rate2h < 0 ? '落潮' : '平潮') : '--'
  return x.mode === 'river' ? 'GloFAS 流量' : '降水/汇流代理'
})
const cells = computed(() => {
  const x = w.value
  if (!x) return []
  if (x.mode === 'sea') {
    const s = sea.value
    return [
      ['潮位', x.tideLevel != null ? Math.round(x.tideLevel * 100) / 100 : '--', 'm', '相对平均海面'],
      ['2h 变化', x.rate2h != null ? (x.rate2h > 0 ? '+' : '') + Math.round(x.rate2h * 100) / 100 : '--', 'm', (x.phase || '') + '潮'],
      ['浪高', s.wave_height != null ? Math.round(s.wave_height * 10) / 10 : '--', 'm', s.wave_period ? '周期 ' + s.wave_period + 's' : ''],
      ['海表温', s.sea_surface_temperature != null ? Math.round(s.sea_surface_temperature * 10) / 10 : '--', '℃', '卫星/模式融合']
    ]
  }
  return [
    ['今日流量', x.qToday != null ? Math.round(x.qToday) : '--', 'm³/s', '或为汇流量级'],
    ['3 天变化', x.pct3d != null ? (x.pct3d > 0 ? '+' : '') + Math.round(x.pct3d) : '--', '%', '正＝水位上升'],
    ['3 天降水', x.rain3d != null ? Math.round(x.rain3d * 10) / 10 : '--', 'mm', '入水口是否活跃'],
    ['实测水位', '无', '', x.mode === 'river' ? '由流量趋势推断' : '无免费接口']
  ] as (string | number)[][]
})
const foot = computed(() => {
  const x = w.value
  if (!x) return '流量（m³/s）≠ 水位；湖库没有免费实测水位接口，这里给的是趋势代理。'
  if (x.mode === 'sea') return '潮位来自 Open-Meteo Marine 模式（非港航实测潮汐表），下水前以现场与官方潮汐为准。'
  return x.mode === 'river'
    ? 'GloFAS 是全球汇流模拟的河道流量，不等于实测水位；有闸坝的河段误差更大。'
    : '湖库没有免费实测水位/库容接口，这里用近 3 天降水与汇流趋势做代理，只用于判断「涨/稳/退」。'
})

/* 简易折线：把 series 归一化到 100x100 视口 */
const poly = computed(() => {
  const s = w.value && w.value.series
  if (!s || !s.values || s.values.length < 2) return ''
  const vals = s.values.filter((v: any) => v != null) as number[]
  if (vals.length < 2) return ''
  const min = Math.min(...vals), max = Math.max(...vals)
  const span = max - min || 1
  return s.values
    .map((v: any, i: number) => {
      const x = (i / (s.values.length - 1)) * 100
      const y = v == null ? null : 95 - ((v - min) / span) * 85
      return y == null ? null : `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .filter(Boolean)
    .join(' ')
})
</script>

<template>
  <section class="card show" data-fam="water">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="water"></i></span>
      <h2>{{ title }}</h2>
      <div class="head-right"><span class="card-note">{{ note }}</span></div>
    </div>

    <div v-if="!w" class="empty">
      <b>等待数据</b><p>河流用全球汇流模拟的流量数据，海/河口用潮位，湖库用降水与汇流做趋势代理。</p>
    </div>
    <template v-else>
      <div class="statgrid">
        <div v-for="c in cells" :key="String(c[0])" class="st">
          <i>{{ c[0] }}</i><b>{{ c[1] }}<u>{{ c[2] }}</u></b><em>{{ c[3] }}</em>
        </div>
      </div>
      <div v-if="poly" class="chart" style="margin-top:8px">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline :points="poly" fill="none" stroke="var(--fam)" stroke-width="1.4"
                    vector-effect="non-scaling-stroke" />
        </svg>
      </div>
    </template>
    <div class="card-foot">{{ foot }}</div>
  </section>
</template>
