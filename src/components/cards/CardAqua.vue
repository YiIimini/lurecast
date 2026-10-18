<script setup lang="ts">
/* LureCast · 「我的水族馆」卡（P3 占位版）
   老壳的水族馆是 1100 行 canvas 手写 2.5D（my.js 的 buildFishes/drawFish/drawScene），
   按「一次只搬一类」的纪律，这一轮先不搬渲染，只把**数据侧**接好：
   已解锁鱼种、每种几张、水层分布都能看到，canvas 水体留到 P3b 与它一起搬。
   数据来自 my store，与渔获卡完全同一份（拍照解锁即刻反映）。 */
import { computed } from 'vue'
import { useMyStore } from '../../stores/my'
import { Engine as E } from '../../lib/engine'

const my = useMyStore()

const species = (E as any).SPECIES

/* 已解锁的鱼：按水族馆里的习性水层分组（top/mid/bot），多水层的鱼两边都列 */
const groups = computed(() => {
  const out: { key: string; label: string; list: any[] }[] = [
    { key: 'top', label: '中上层', list: [] },
    { key: 'mid', label: '中层', list: [] },
    { key: 'bot', label: '底层', list: [] }
  ]
  Object.keys(my.unlocked).forEach((id) => {
    const sp: any = my.speciesOf(id)
    if (!sp) return
    const layers = String(sp.layer || 'mid').split('|')
    const rec = my.unlocked[id]
    layers.forEach((l) => {
      const g = out.filter((x) => x.key === l)[0]
      if (g) g.list.push({ sp, size: rec.sizeCm })
    })
  })
  return out.filter((g) => g.list.length)
})
</script>

<template>
  <section class="card span2 show" data-fam="water">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="fishalt"></i></span>
      <h2>我的水族馆</h2>
      <div class="head-right"><span class="card-note">{{ my.unlockedCount }} / {{ my.totalSpecies }} 种</span></div>
    </div>

    <div class="aqua" style="min-height:150px;display:flex;align-items:center;justify-content:center">
      <div v-if="!my.unlockedCount" class="aqua-hint">
        <b>水族馆还是空的</b>
        <p>拍照存档一条鱼，它就会游进这里。</p>
      </div>
      <div v-else style="padding:14px;width:100%">
        <div v-for="g in groups" :key="g.key" style="margin-bottom:10px">
          <div class="card-note" style="margin-bottom:6px">{{ g.label }}</div>
          <div class="chiprow">
            <span v-for="it in g.list" :key="it.sp.id + g.key" class="chip on"
                  :style="{ borderColor: it.sp.color }">
              <s :style="{ background: it.sp.color }"></s>
              {{ it.sp.zh }}<template v-if="it.size"> · {{ it.size }} cm</template>
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="card-foot">
      已解锁鱼种的习性水层来自鱼种库（top 中上层 / mid 中层 / bot 底层）。
      老壳的 2.5D 水体动画（透视分层、焦散光斑、水草）还没搬，按计划排在 P3b；
      这一轮先把「解锁 ↔ 水层」的数据链路接好。
    </div>
  </section>
</template>
