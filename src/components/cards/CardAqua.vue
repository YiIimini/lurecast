<script setup lang="ts">
/* LureCast · 「我的水族馆」卡（P3b）—— 对应老壳 #cardAqua / my.js renderAqua()
   ---------------------------------------------------------------------------
   绘制逻辑一行未改，全部在 src/lib/aqua.ts（由 my.js 660–1847 行机械迁移）：
   2.5D 透视分层、河床贴图、焦散光斑、随水流摆的细草、分层气泡。
   这里只负责三件事：
     · 把已解锁鱼种喂给它（setUnlockedGetter ← my store）；
     · 组件挂载 = 开始跑帧，卸载 = 停 RAF（老壳按页签切，新壳按组件生命周期）；
     · 保留老壳那套 DOM id（aquaCanvas/aquaCount/aquaHint/aquaLegend/cardAqua），样式不用动。 */
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useMyStore } from '../../stores/my'
import {
  setUnlockedGetter, stopAqua, renderAqua, aquaFull, isAquaFull
} from '../../lib/aqua'

const my = useMyStore()

setUnlockedGetter(() => my.unlocked)

function toggleFull() { aquaFull(!isAquaFull()) }

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && isAquaFull()) aquaFull(false)
}

onMounted(() => {
  renderAqua()          // 写角标 + 启动（startAqua 内部会重建鱼/水草/气泡）
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  stopAqua()
  document.body.classList.remove('aquafs')
})

/* 解锁/删除渔获后重排：startAqua 会把鱼、图例、空态一起刷一遍 */
watch(() => my.catches, () => renderAqua())
</script>

<template>
  <section id="cardAqua" class="card span2 show" data-fam="water">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="fishalt"></i></span>
      <h2>我的水族馆</h2>
      <div class="head-right">
        <button class="act ghost icoact" data-tip="全屏看水族馆|把水箱铺满整屏，底部列出这个缸里每种鱼的名字。"
                aria-label="全屏看水族馆" @click="toggleFull">
          <i class="ic ic-in" data-icon="expand"></i><i class="ic ic-out" data-icon="shrink"></i>
        </button>
        <span class="card-note" id="aquaCount">0 / 25 种</span>
      </div>
    </div>

    <div class="aqua">
      <canvas id="aquaCanvas"></canvas>
      <div class="aqua-hint" id="aquaHint"><b>水族馆还是空的</b><p>拍照存档一条鱼，它就会游进这里。</p></div>
      <div class="aqua-legend" id="aquaLegend"></div>
    </div>

    <div class="card-foot">
      每解锁一个新鱼种，水族馆里就多一条会游的鱼（多水层的鱼每条随机挑一层，底层鱼贴着河床）；
      全屏后底部会列出缸里每种鱼的名字。
    </div>
  </section>
</template>
