<script setup lang="ts">
/* LureCast · 「我的水族馆」卡 —— 真 3D（three.js）优先，2D 兜底
   ---------------------------------------------------------------------------
   3D 场景在 src/lib/aqua3d.ts：透视相机 + 指数雾 + 带动态焦散的河床 + 斜射光柱 +
   上浮气泡 + 摆动细草 + 鱼（顶点着色器摆尾、椭圆巡游、按 water layer 分布）。
   three.js（675 KB）按需动态加载，不进 app chunk；无 WebGL / 解码失败时回退到
   src/lib/aqua.ts 原来的 2.5D canvas 画法，功能不降级。
   这里只负责：把已解锁鱼种喂给它、维护角标/图例/空态、全屏、生命周期。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMyStore } from '../../stores/my'
import { setUnlockedGetter, stopAqua, renderAqua, aquaFull, isAquaFull } from '../../lib/aqua'
import { SPECIES_DB } from '../../lib/species'
import { createAqua3D } from '../../lib/aqua3d'

const my = useMyStore()
const canvasEl = ref<HTMLCanvasElement | null>(null)
let a3d: any = null
let using3D = false

setUnlockedGetter(() => my.unlocked)

/* 已解锁的鱼种（最多 12 条上水，和 2D 版一致） */
const unlocked = computed<any[]>(() => {
  const un: any = my.unlocked || {}
  return (SPECIES_DB as any[]).filter((s) => un[s.id])
})

function paintChrome() {
  const list = unlocked.value
  const cnt = document.getElementById('aquaCount')
  if (cnt) cnt.textContent = list.length + ' / ' + SPECIES_DB.length + ' 种'
  const hint = document.getElementById('aquaHint')
  if (hint) hint.style.display = list.length ? 'none' : 'flex'
  const lg = document.getElementById('aquaLegend')
  if (lg) {
    lg.innerHTML = list.slice(0, 12).map((s: any) =>
      '<i><s style="background:' + (s.color || '#8fa3b6') + '"></s>' + s.zh + '</i>').join('')
  }
}

async function boot() {
  paintChrome()
  const cv = canvasEl.value
  if (!cv) return
  try {
    a3d = await createAqua3D(cv, { perf: document.body.classList.contains('perf') })
  } catch (e) {
    a3d = null
    console.warn('[aqua] 3D 初始化失败，回退 2D：', e)
  }
  if (a3d) {
    using3D = true
    a3d.setFishes(unlocked.value)
    a3d.start()
    return
  }
  using3D = false
  renderAqua()          // 2D 兜底（内部也会写角标/图例/空态）
}

function toggleFull() {
  /* 3D 在场时不能走 aquaFull()：那个函数会顺手启动 2D 渲染器（startAqua → resizeAqua），
     而同一块 canvas 已经有 WebGL 上下文，getContext('2d') 返回 null，直接抛错。
     CSS 那套（card.fs + body.aquafs）在这里自己切，效果完全一样。 */
  if (using3D) {
    const card = document.getElementById('cardAqua')
    if (!card) return
    const want = !card.classList.contains('fs')
    card.classList.toggle('fs', want)
    document.body.classList.toggle('aquafs', want)
    requestAnimationFrame(() => a3d?.resize?.())
    return
  }
  aquaFull(!isAquaFull())
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && isAquaFull()) toggleFull()
}

onMounted(() => {
  boot()
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (a3d) { a3d.dispose(); a3d = null }
  stopAqua()
  document.body.classList.remove('aquafs')
})

/* 解锁/删除渔获后重排 */
watch(() => my.catches, () => {
  paintChrome()
  if (using3D && a3d) a3d.setFishes(unlocked.value)
  else renderAqua()
})
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
      <canvas id="aquaCanvas" ref="canvasEl"></canvas>
      <div class="aqua-hint" id="aquaHint"><b>水族馆还是空的</b><p>拍照存档一条鱼，它就会游进这里。</p></div>
      <div class="aqua-legend" id="aquaLegend"></div>
    </div>

    <div class="card-foot">
      每解锁一个新鱼种，水族馆里就多一条会游的鱼（多水层的鱼每条随机挑一层，底层鱼贴着河床）；
      全屏后底部会列出缸里每种鱼的名字。
    </div>
  </section>
</template>
