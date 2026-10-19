<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEnvStore } from '../../stores/env'
import { Engine as E } from '../../lib/engine'
import {
  headingDeg, headingHas, headingLabel, headingOn, headingState, initHeading, setHeadingEnabled
} from '../../lib/heading'

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
/* 罗盘上「指针朝哪」用的是真北方位：0=N、90=E。指针 0° 时色点在正下方，
   所以屏幕角度还要 +180；再减去手机航向，就得到「相对屏幕」的角度（见 tick）。 */
const arrowDeg = computed(() => (dir.value != null ? ((dir.value % 360) + 360) % 360 : 0))
/* 开指北且拿到过绝对方向才让刻度盘跟着手机转；否则保持 N 朝上，不装作知道北在哪 */
const headingTarget = computed(() => (headingOn.value && headingHas.value ? headingDeg.value : 0))
const text = computed(() => {
  if (dir.value == null || speed.value == null) return '--'
  const from = E.compass(dir.value)
  const to = E.compass((dir.value + 180) % 360)
  return `${from} 风 ${Math.round(speed.value * 10) / 10} m/s（阵风 ${gust.value != null ? Math.round(gust.value) : '--'}）→ 朝 ${to} 吹`
})

/* 指针角度：rAF 里按「最短弧」缓动追目标值（0/360 边界不会绕远路）；
   只靠 CSS transition 的话 rotate(350deg)→rotate(10deg) 会倒着转 340°。
   注意：watch 的 getter 会被立刻求值一次，所以这段必须放在 arrowDeg 之后，
   否则 setup 阶段就会撞上 TDZ（Cannot access 'x' before initialization）。 */
const shownDeg = ref(0)
const shownH = ref(0)
let raf = 0
function tick() {
  const d1 = ((arrowDeg.value - shownDeg.value + 540) % 360) - 180
  const d2 = ((headingTarget.value - shownH.value + 540) % 360) - 180
  if (Math.abs(d1) < 0.06 && Math.abs(d2) < 0.06) {
    shownDeg.value = arrowDeg.value
    shownH.value = headingTarget.value
    raf = 0
    return
  }
  shownDeg.value = (shownDeg.value + d1 * 0.16 + 360) % 360
  shownH.value = (shownH.value + d2 * 0.2 + 360) % 360
  raf = requestAnimationFrame(tick)
}
watch(() => [arrowDeg.value, headingTarget.value], () => { if (!raf) raf = requestAnimationFrame(tick) })
onMounted(() => { initHeading() })
onBeforeUnmount(() => { if (raf) cancelAnimationFrame(raf) })

/* 刻度盘：反向转 −航向，N 就贴在真北上 */
const dialDeg = computed(() => (360 - shownH.value) % 360)
const headingNote = computed(() => {
  if (!headingOn.value) return '罗盘固定朝上'
  if (headingState.value === 'ok') return '手机朝 ' + Math.round(headingDeg.value) + '°'
  return headingLabel()
})
function toggleHeading() { setHeadingEnabled(!headingOn.value) }

/* 罗盘中心的小字与右侧文案：中心只放数值（单位在下面一行写清），避免 SVG 里塞长句 */
const speedText = computed(() => (speed.value == null ? '--' : (Math.round(speed.value * 10) / 10).toFixed(1)))
const dirText = computed(() => {
  if (dir.value == null || speed.value == null) return '风向未知'
  const g = gust.value != null ? '（阵风 ' + Math.round(gust.value) + '）' : ''
  return (Math.round(speed.value * 10) / 10) + ' m/s' + g
})
/* 指针屏幕角度：世界方位 − 手机航向。色点（箭头）落在「吹向」，细针指向「来风」 */
const needleDeg = computed(() => (((shownDeg.value - shownH.value) % 360) + 360) % 360)
/* 风速越大，气流感跑得越快 */
const flowDur = computed(() => {
  const s = speed.value == null ? 3 : speed.value
  return Math.max(0.6, Math.min(2.6, 2.8 - s * 0.22)).toFixed(2) + 's'
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
        <button class="act ghost" :class="{ on: headingOn && headingState === 'ok' }"
                data-tip="罗盘指北|开：刻度盘跟着手机方向反向转，N 永远指向真北，指针也换算成真北方位；关：刻度盘固定朝上。"
                @click="toggleHeading">{{ headingLabel() }}</button>
      </div>
    </div>

    <div class="compasswrap">
      <div class="compass">
        <svg viewBox="0 0 116 116" aria-hidden="true">
          <g class="dial" :style="{ transform: `rotate(${dialDeg}deg)` }">
            <circle class="rim" cx="58" cy="58" r="52" fill="none" stroke="var(--hair)" stroke-width="1" />
            <circle class="ring" cx="58" cy="58" r="52" fill="none" stroke="var(--a1)" stroke-width="1" />
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
          <!-- 指针：rAF 缓动追目标角（见 tick()），转速跟风速走 -->
          <g class="arrow" :style="{ transform: `rotate(${needleDeg}deg)` }">
            <g class="streaks" :style="{ '--flowDur': flowDur }">
              <line class="s1" x1="50" y1="40" x2="50" y2="24" />
              <line class="s2" x1="58" y1="40" x2="58" y2="22" />
              <line class="s3" x1="66" y1="40" x2="66" y2="24" />
            </g>
            <line class="needle-from" x1="58" y1="58" x2="58" y2="20" />
            <line class="needle-to" x1="58" y1="58" x2="58" y2="92" />
            <circle class="tip" cx="58" cy="92" r="3.4" fill="var(--fam)" />
          </g>
          <circle cx="58" cy="58" r="4" fill="var(--ink-2)" />
          <text class="spd" x="58" y="70" text-anchor="middle">{{ speedText }}</text>
        </svg>
      </div>
      <div class="windtxt">
        <b>{{ dirText }}</b>
        <span>{{ text }}</span>
        <em v-if="headingOn && headingState === 'ok'" :data-tip="headingNote + '|真北相对屏幕的位置随手机转动'">{{ headingNote }}</em>
      </div>
    </div>

    <div class="chiprow windstages">
      <button v-for="s in stages" :key="s.v" class="chip" :class="{ on: ahead === s.v }" @click="ahead = s.v">
        {{ s.label }}
      </button>
    </div>
    <div class="card-foot">
      实线箭头＝风吹向的方向，细尾在来风一侧。
      开「指北」后刻度盘跟着手机反向转，N 永远贴着真北。
      没开指北或设备没有磁力计时，N 只是朝屏幕上方。下面可以点未来 1/3/6 小时看风怎么转。
    </div>
  </section>
</template>
