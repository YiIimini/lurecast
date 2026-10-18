<script setup lang="ts">
/* LureCast · 「地形结构」卡（P4）—— 对应老壳 #cardTerrain / renderTerrain()
   数据全部来自 spots store（E.buildCandidates → applyTerrain → E.terrainSummary），
   这一层只负责把六个数摆出来，不做任何新的推断。 */
import { computed } from 'vue'
import { useEnvStore } from '../../stores/env'
import { useSpotsStore } from '../../stores/spots'

const env = useEnvStore()
const spots = useSpotsStore()

const t = computed<any>(() => spots.terrain)
const has = computed(() => !!(t.value && t.value.sampled))
const note = computed(() => (has.value ? t.value.sampled + ' 个岸段采样' : '--'))

const cells = computed(() => {
  const x = t.value || {}
  const r1 = (v: any) => (v != null ? Math.round(v) : '--')
  const f1 = (v: any) => (v != null ? Number(v).toFixed(1) : '--')
  return [
    { label: '岸坡中位数', value: r1(x.medianSlope), unit: '%', note: '岸上 120 m 高差/距离' },
    { label: '陡岸段', value: (x.steepCount ?? '--') + '/' + (x.sampled ?? '--'), unit: '', note: '坡度 ≥ 10%' },
    { label: '岬角 / 湾', value: (x.pointCount ?? '--') + ' / ' + (x.bayCount ?? '--'), unit: '', note: '岸线凸凹判定' },
    { label: '迎风岸段', value: x.windCount ?? '--', unit: '个', note: '风向正吹向岸' },
    { label: '近岸 20m 深', value: f1(x.medianDepth20), unit: 'm', note: '中位数（推断）' },
    { label: '最深估点', value: f1(x.maxDepth20), unit: 'm', note: '按最陡岸坡外推' }
  ]
})
</script>

<template>
  <section id="cardTerrain" class="card span2 show" data-fam="terrain">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="terrain"></i></span>
      <h2>地形结构</h2>
      <div class="head-right"><span class="card-note">{{ note }}</span></div>
    </div>

    <div v-if="!env.wx" class="empty">
      <b>正在等待气象与岸线</b>
      <p>岸线几何要等 OpenStreetMap 回来，高程采样随后。</p>
    </div>

    <div v-else-if="!has" class="empty">
      <b>还没有岸线数据</b>
      <p>需要 OSM 收录的水域几何 + 高程采样；换个靠水的位置再试。</p>
    </div>

    <div v-else class="statgrid">
      <div v-for="c in cells" :key="c.label" class="st">
        <i>{{ c.label }}</i><b>{{ c.value }}<u v-if="c.unit">{{ c.unit }}</u></b><em>{{ c.note }}</em>
      </div>
    </div>

    <div class="card-foot">岸坡＝岸上 120 m 高程差 ÷ 120 m；近岸水深＝按岸坡线性外推 20 m 的估值（DEM 会低估，仅作相对比较）。</div>
  </section>
</template>
