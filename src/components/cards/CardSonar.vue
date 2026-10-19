<script setup lang="ts">
/* LureCast · 「声呐实测水深」卡（P4）—— 接 docs/DEEPER-SONAR.md 的 Deeper 方案
   ---------------------------------------------------------------------------
   导入 Deeper 导出的 CSV（bathymetry.csv 或 scan_data_*.csv），把带坐标的深度点
   按深度着色画到地图上（浅→红、深→蓝），并在卡片里给出实测统计。
   这是全应用唯一的**实测**水深来源；其它地方的水深都是按岸坡外推的推断值，卡片里会说清楚。
   解析与错误码在 lib/deeper.ts（10 条测试），本机保存走 lc:sonar。 */
import { computed, ref, onMounted } from 'vue'
import { useSonarStore } from '../../stores/sonar'
import { useEnvStore } from '../../stores/env'
import { Engine as E } from '../../lib/engine'
import { confirmBox } from '../../lib/ui'

const sonar = useSonarStore()
const env = useEnvStore()

const fileInput = ref<HTMLInputElement | null>(null)
const offset = ref(0.15)

onMounted(() => sonar.load())

const st = computed<any>(() => sonar.stats || {})
const hasStats = computed(() => !!sonar.stats)

/* 声呐点离当前位置的距离（判断这片扫测是不是你眼前这片水） */
const center = computed(() => {
  if (!sonar.points.length) return null
  let lat = 0, lon = 0
  sonar.points.forEach((p) => { lat += p.lat; lon += p.lon })
  return { lat: lat / sonar.points.length, lon: lon / sonar.points.length }
})
const distToMe = computed(() => {
  if (!center.value || !env.me) return null
  return E.dist(env.me as any, center.value as any)
})

async function onFile(files: FileList | null) {
  const f = (files || [])[0]
  if (!f) return
  await sonar.importFile(f, offset.value)
}

async function doClear() {
  const ok = await confirmBox('清除导入的声呐数据？（只删本机这份 CSV 解析结果，原文件不动）',
    { title: '清除声呐数据', danger: true, okText: '清除' })
  if (ok) await sonar.clear()
}
</script>

<template>
  <section class="card span2 show" data-fam="terrain">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="terrain"></i></span>
      <h2>声呐实测水深</h2>
      <div class="head-right">
        <span class="card-note">{{ hasStats ? st.points + ' 个实测点' : '未导入' }}</span>
      </div>
    </div>

    <input ref="fileInput" type="file" accept=".csv,text/csv" style="display:none"
           @change="onFile(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''">

    <div v-if="!sonar.has" class="empty">
      <b>还没有声呐数据</b>
      <p>把 Deeper 导出的 CSV 导入进来，就能看到<b>实测</b>水深分布（不是按岸坡外推的估值）。
        支持 Quest/PRO 的 <code>bathymetry.csv</code>（无表头 4/5 列）和手机 App 的 <code>scan_data_*.csv</code>（带表头）。</p>
      <p>文件只在本机解析，不上传；解析结果存在本机，下次打开还在。</p>
      <div class="chiprow" style="margin-top:6px">
        <button class="act primary" :disabled="sonar.busy" @click="fileInput && fileInput.click()">
          {{ sonar.busy ? '解析中…' : '导入 Deeper CSV' }}
        </button>
      </div>
      <p v-if="sonar.error" class="hint" style="color:var(--err)">{{ sonar.error }}</p>
    </div>

    <div v-else>
      <div class="statgrid">
        <div class="st"><i>实测点</i><b>{{ st.points }}</b><em>有 GPS 的深度点</em></div>
        <div class="st"><i>最深</i><b>{{ st.maxDepth.toFixed(1) }}<u>m</u></b><em>含换能器吃水 {{ offset }} m</em></div>
        <div class="st"><i>中位深</i><b>{{ st.medDepth.toFixed(1) }}<u>m</u></b><em>一半点位比它浅</em></div>
        <div class="st"><i>最浅</i><b>{{ st.minDepth.toFixed(1) }}<u>m</u></b><em>靠岸的读数</em></div>
        <div class="st"><i>水温</i><b>{{ st.medTemp != null ? st.medTemp + '℃' : '--' }}</b><em>换能器测温中位数</em></div>
        <div class="st"><i>离你</i><b>{{ distToMe != null ? E.fmtDist(distToMe) : '--' }}</b><em>这片扫测的中心</em></div>
      </div>

      <div class="card-note" style="margin-top:8px">
        文件 <b>{{ st.fileName }}</b> · 总 {{ st.rows }} 行 · 脏行 {{ st.skipped }} · 无定位 {{ st.zeroGps }} 行
      </div>

      <div class="field" style="margin-top:10px">
        <label>换能器吃水（m）<span class="hint-inline">Deeper 量的是探头到水底，船体吃水要加上</span></label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input v-model.number="offset" type="number" step="0.05" min="0" max="2" style="max-width:110px">
          <button class="act ghost" :disabled="sonar.busy" @click="fileInput && fileInput.click()">换一个文件</button>
          <button class="act ghost" @click="doClear">清除数据</button>
        </div>
      </div>

      <p class="hint">地图上按深度着色：浅（红）→ 深（蓝）。同一片水多扫几次会更完整；扫测点只代表当时那条船走过的轨迹。</p>
    </div>

    <div class="card-foot">
      实测水深来自你的 Deeper 导出文件，只在本机解析与保存；与「地形结构」卡里的近岸深度（按 DEM 岸坡外推的估值）是两回事。
    </div>
  </section>
</template>
