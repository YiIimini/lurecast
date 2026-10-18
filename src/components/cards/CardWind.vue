<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEnvStore } from '../../stores/env'
import { Engine as E } from '../../lib/engine'

const env = useEnvStore()
const ahead = ref(0) // 0 / 1 / 3 / 6 小时后

const cur = computed(() => (env.wx && env.wx.data && env.wx.data.current) || {})
const hourly = computed(() => (env.wx && env.wx.data && env.wx.data.hourly) || {})

/* 取「现在 + n 小时」的那一档风：没有逐小时数据时退回实况 */
const slot = computed(() => {
  const h = hourly.value
  if (!h.time || !h.time.length) return null
  const now = env.nowMs || Date.now()
  let idx = 0, best = Infinity
  for (let i = 0; i < h.time.length; i++) {
    const d = Math.abs(E.wallMs(h.time[i]) - (now + ahead.value * 3600e3))
    if (d < best) { best = d; idx = i }
  }
  return {
    dir: h.wind_direction_10m ? h.wind_direction_10m[idx] : null,
    speed: h.wind_speed_10m ? h.wind_speed_10m[idx] : null,
    gust: h.wind_gusts_10m ? h.wind_gusts_10m[idx] : null,
    label: h.time[idx] ? h.time[idx].slice(11, 16) : ''
  }
})

const dir = computed(() => (slot.value && slot.value.dir != null ? slot.value.dir : cur.value.wind_direction_10m))
const speed = computed(() => (slot.value && slot.value.speed != null ? slot.value.speed : cur.value.wind_speed_10m))
const gust = computed(() => (slot.value && slot.value.gust != null ? slot.value.gust : cur.value.wind_gusts_10m))
const arrowDeg = computed(() => (dir.value != null ? (dir.value + 180) % 360 : 0))
const text = computed(() => {
  if (dir.value == null || speed.value == null) return '--'
  const from = E.compass(dir.value)
  const to = E.compass((dir.value + 180) % 360)
  return `${from} 风 ${Math.round(speed.value * 10) / 10} m/s（阵风 ${gust.value != null ? Math.round(gust.value) : '--'}）→ 朝 ${to} 吹`
})
const stages = [
  { v: 0, label: '现在' }, { v: 1, label: '+1h' }, { v: 3, label: '+3h' }, { v: 6, label: '+6h' }
]
</script>

<template>
  <section class="card show" data-fam="wind">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="wind"></i></span>
      <h2>风况与迎风岸</h2>
      <div class="head-right">
        <span class="card-note">{{ slot && slot.label ? slot.label : '--' }}</span>
      </div>
    </div>

    <div class="compasswrap">
      <div class="compass">
        <svg viewBox="0 0 116 116" aria-hidden="true">
          <g class="dial">
            <circle cx="58" cy="58" r="52" fill="none" stroke="var(--hair)" stroke-width="1" />
            <g class="ticks">
              <line x1="58" y1="6" x2="58" y2="12" />
              <line x1="58" y1="104" x2="58" y2="110" />
              <line x1="6" y1="58" x2="12" y2="58" />
              <line x1="104" y1="58" x2="110" y2="58" />
              <line x1="21" y1="21" x2="25" y2="25" />
              <line x1="91" y1="91" x2="95" y2="95" />
              <line x1="95" y1="21" x2="91" y2="25" />
              <line x1="25" y1="91" x2="21" y2="95" />
            </g>
            <text class="lbl n" x="58" y="13" text-anchor="middle">N</text>
            <text class="lbl" x="105" y="60" text-anchor="middle">E</text>
            <text class="lbl" x="58" y="109" text-anchor="middle">S</text>
            <text class="lbl" x="12" y="60" text-anchor="middle">W</text>
          </g>
          <circle cx="58" cy="58" r="38" fill="none" stroke="var(--hair)" stroke-width="1" stroke-dasharray="2 4" />
          <g class="arrow" :style="{ transform: `rotate(${arrowDeg}deg)`, transformOrigin: '58px 58px' }">
            <g class="streaks">
              <line x1="50" y1="36" x2="50" y2="18" />
              <line x1="58" y1="32" x2="58" y2="12" />
              <line x1="66" y1="36" x2="66" y2="18" />
            </g>
            <line class="needle-from" x1="58" y1="58" x2="58" y2="20" />
            <line class="needle-to" x1="58" y1="58" x2="58" y2="92" />
            <circle cx="58" cy="92" r="3.4" fill="var(--fam)" />
          </g>
          <circle cx="58" cy="58" r="4" fill="var(--ink-2)" />
        </svg>
      </div>
      <div class="windtxt">{{ text }}</div>
    </div>

    <div class="chiprow" style="margin-top:10px">
      <button v-for="s in stages" :key="s.v" class="chip" :class="{ on: ahead === s.v }" @click="ahead = s.v">
        {{ s.label }}
      </button>
    </div>
    <div class="card-foot">罗盘实线箭头＝风吹向的方向。下面可以点未来 1/3/6 小时看风怎么转。</div>
  </section>
</template>
