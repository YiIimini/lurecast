<script setup lang="ts">
import { computed } from 'vue'
import { useEnvStore } from '../../stores/env'

const env = useEnvStore()
const bars = computed(() =>
  (env.curve || []).map((p: any, i: number) => {
    const h = Math.max(4, p.score)
    const n = env.curve.length
    return {
      x: i * (100 / n) + 0.5,
      y: 100 - h,
      w: 100 / n - 1,
      h,
      hot: p.score >= 75
    }
  })
)
const head = computed(() => (env.curve.length ? env.curve[0].t.slice(11, 16) : ''))
const mid = computed(() => (env.curve.length ? env.curve[Math.floor(env.curve.length / 2)].t.slice(11, 16) : ''))
const tail = computed(() => (env.curve.length ? env.curve[env.curve.length - 1].t.slice(11, 16) : ''))
const winTxt = computed(() =>
  (env.windows || []).map((w: any) => `${w.from.slice(11, 16)}–${w.to.slice(11, 16)}（${w.score} 分）`).join(' · ')
)
const note = computed(() => (env.windows && env.windows.length ? `最佳 ${env.windows[0].from.slice(11, 16)} 起` : '时窗'))
</script>

<template>
  <section class="card show" data-fam="time">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="clock"></i></span>
      <h2>未来 24 小时</h2>
      <div class="head-right"><span class="card-note">{{ note }}</span></div>
    </div>

    <div v-if="!env.curve.length" class="empty">
      <b>暂无逐小时数据</b><p>刷新后会给出一条 24 小时环境分曲线，并标出今天最好的两个时段。</p>
    </div>
    <template v-else>
      <div class="chart">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <line class="grid-line" x1="0" y1="25" x2="100" y2="25" vector-effect="non-scaling-stroke" />
          <line class="grid-line" x1="0" y1="50" x2="100" y2="50" vector-effect="non-scaling-stroke" />
          <rect v-for="(b, i) in bars" :key="i" :class="['bar', { hot: b.hot }]"
                :x="b.x.toFixed(2)" :y="b.y.toFixed(1)" :width="b.w.toFixed(2)" :height="b.h.toFixed(1)" rx="0.9" />
        </svg>
        <div class="axis"><span>{{ head }}</span><span>{{ mid }}</span><span>{{ tail }}</span></div>
      </div>
      <div class="card-note" style="margin-top:2px">小时 · 柱高＝环境分 0–100</div>
      <div class="card-note" style="margin-top:8px">
        最佳窗口：{{ winTxt || '数据不足' }}。柱高＝该小时的同一套环境分（不含点位结构）。
      </div>
    </template>
  </section>
</template>
