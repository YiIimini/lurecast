<script setup lang="ts">
import { computed } from 'vue'
import { useEnvStore } from '../../stores/env'
import { Engine as E } from '../../lib/engine'

const env = useEnvStore()

const score = computed(() => (env.env ? env.env.score : null))
const worst = computed(() => {
  const f = env.env && env.env.factors
  if (!f || !f.length) return null
  return f.slice().sort((a: any, b: any) => a.score - b.score)[0]
})
/* 秋季窗口期判据（提示；用户开了「并入评分」才会出现在总分里） */
const win = computed<any>(() => env.windowHint)

const windBlip = computed(() => {
  const cur = env.wx && env.wx.data && env.wx.data.current
  if (!cur || cur.wind_direction_10m == null) return null
  return `风朝 ${E.compass((cur.wind_direction_10m + 180) % 360)} 吹 · ${Math.round(cur.wind_speed_10m)} m/s`
})
const firstWin = computed(() => (env.windows && env.windows.length ? env.windows[0] : null))
</script>

<template>
  <section class="card show" data-fam="score">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="gauge"></i></span>
      <h2>鱼口指数</h2>
      <div class="head-right">
        <span class="card-note">{{ env.env ? env.typeLabel + ' · ' + env.speciesLabel : '环境综合' }}</span>
      </div>
    </div>
    <div class="scorebody">
      <div class="dial" :style="{ '--pct': score ?? 0 }">
        <div class="dial-in"><b>{{ score ?? '--' }}</b><i>环境分</i></div>
      </div>
      <div class="verdict">
        <h3>{{ env.verdict.t }}</h3>
        <p>{{ env.verdict.p }}</p>
        <div class="row">
          <span v-if="firstWin" class="blip ok">
            最佳 {{ firstWin.from.slice(11, 16) }}–{{ firstWin.to.slice(11, 16) }}（{{ firstWin.score }} 分）
          </span>
          <span v-if="worst && worst.score < 60" class="blip bad">短板：{{ worst.label }} {{ worst.score }}</span>
          <span v-if="windBlip" class="blip">{{ windBlip }}</span>
          <span v-if="win" class="blip" :class="win.hits >= 2 ? 'ok' : ''">
            秋季窗口期 {{ win.hits }}/3{{ (env.env && env.env.windowBonus) ? ' · 已加分 +' + env.env.windowBonus : '' }}
          </span>
        </div>
        <p v-if="win" class="card-note" style="margin-top:6px;line-height:1.7">
          {{ win.summary }}<br>
          <span v-for="(l, i) in win.lines" :key="i">{{ l }}<br></span>
        </p>
      </div>
    </div>
  </section>
</template>
