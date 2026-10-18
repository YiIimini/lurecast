<script setup lang="ts">
/* LureCast · 「历史影像 · 水下结构」卡（P4）—— 对应老壳 #cardSat / renderSat() + runSat()
   -----------------------------------------------------------------------------------
   分析逻辑全在 lib/sat.ts（由 assets/sat.js 机械迁移，645 行）：跨 3 年抽 6 期
   Sentinel-2 L2A，挑库水位最低的一期当主影像，只下你周围 1–2 km 的 COG 切片；
   蓝绿比推水深、SCL 去云、蓝绿比异常点当「水下浅脊/硬底」。
   这一层只负责：按钮、进度文字、canvas、期次与异常点列表、缩放重读。
   geotiff.js（310 KB）在第一次分析时才拉（lib/geotiff-loader）。 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useEnvStore } from '../../stores/env'
import { useSpotsStore } from '../../stores/spots'
import { CFG } from '../../lib/cfg'
import { Sat } from '../../lib/sat'
import { ready as geotiffReady } from '../../lib/geotiff-loader'
import { alertBox } from '../../lib/ui'

const env = useEnvStore()
const spots = useSpotsStore()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const busy = ref(false)
const progress = ref('')
const res = ref<any>(null)
const error = ref('')

/* 默认看「水深」模式（老壳 satMode 默认 sdb），也留原始影像与水体掩膜 */
const mode = ref<'sdb' | 'rgb' | 'water'>('sdb')
const MODES = [
  { id: 'sdb', name: '水深（蓝绿比）' },
  { id: 'rgb', name: '真实影像' },
  { id: 'water', name: '水体掩膜' }
] as const

const zoomKm = ref(0.9)

const has = computed(() => !!(res.value && res.value.bands))
const meta = computed(() => (res.value ? res.value : null))

function draw() {
  if (!canvasEl.value || !res.value) return
  Sat.render(canvasEl.value, res.value, mode.value)
}

watch(mode, draw)

async function analyse() {
  if (!env.me || busy.value) return
  if (!CFG.satFallback) {
    await alertBox('「卫星水面兜底」在设置里关掉了，影像分析也用同一套读数逻辑。想用就先到 设置 → 判定口径 打开它。',
      { title: '卫星兜底已关闭' })
    return
  }
  busy.value = true
  error.value = ''
  progress.value = '准备 geotiff.js…'
  try {
    await geotiffReady()
    progress.value = '检索影像…'
    const r = await Sat.analyse(env.me.lat, env.me.lon, {
      radiusKm: zoomKm.value,
      size: 768,
      onProgress: (t: string) => { progress.value = t }
    })
    res.value = r
    progress.value = ''
    draw()
    syncAnomalies()
  } catch (e: any) {
    error.value = (e && e.message) || String(e)
    progress.value = ''
  } finally {
    busy.value = false
  }
}

/* 异常点喂给钓点管线：pickSpots 里会按 250 m 内加分（老壳同一口径） */
function syncAnomalies() {
  const pts = (res.value && res.value.anomalies) || []
  spots.setSatAnomalies(pts)
}

async function rereadZoom() {
  if (!res.value || busy.value) return
  busy.value = true
  try {
    res.value = await Sat.reread(res.value, zoomKm.value)
    draw()
    syncAnomalies()
  } catch (e: any) {
    error.value = (e && e.message) || String(e)
  } finally {
    busy.value = false
  }
}

async function pickScene(id: string) {
  if (!res.value || busy.value) return
  busy.value = true
  try {
    res.value = await Sat.setScene(res.value, 'low', id)
    draw()
    syncAnomalies()
  } catch (e: any) {
    error.value = (e && e.message) || String(e)
  } finally {
    busy.value = false
  }
}

onBeforeUnmount(() => {
  // 卡卸载时清掉异常点，避免残留影响钓点分
  spots.setSatAnomalies([])
})

const scenes = computed<any[]>(() => (res.value && res.value.ranked) || [])
</script>

<template>
  <section id="cardSat" class="card span2 show" data-fam="sat">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="satellite"></i></span>
      <h2>历史影像 · 水下结构</h2>
      <div class="head-right">
        <button class="act" :disabled="busy" data-tip="分析历史影像|跨 3 年抽查 6 期 Sentinel-2 影像，挑出库水位最低的一期当主影像。约 10–30 秒，只下载你周围 1–2 km 那一小块。"
                @click="analyse">{{ busy ? '分析中…' : (has ? '重新分析' : '分析影像') }}</button>
      </div>
    </div>

    <div v-if="!has" class="empty">
      <b>用不同水位时期的卫星影像看库底</b>
      <p>水下结构藏在这里：枯水期露出的老河床、路基、石砌护岸、房基；两个时期都在水下但水色稳定的浅脊与硬底。
        点右上「分析影像」开始——只下载你周围 1–2 km 的那一块，不传任何数据出去。</p>
      <p v-if="progress">{{ progress }}</p>
      <p v-if="error" style="color:var(--err)">{{ error }}</p>
    </div>

    <div v-else>
      <div class="chiprow" style="margin-bottom:8px">
        <button v-for="m in MODES" :key="m.id" class="chip" :class="{ on: mode === m.id }"
                @click="mode = m.id as any">{{ m.name }}</button>
      </div>

      <div class="satstage">
        <div class="satview"><canvas ref="canvasEl"></canvas></div>
      </div>

      <div class="statgrid" style="margin-top:10px">
        <div class="st"><i>主影像</i><b>{{ meta.low && meta.low.date }}</b><em>云量 {{ meta.low && meta.low.cloud != null ? Math.round(meta.low.cloud) + '%' : '--' }}</em></div>
        <div class="st"><i>对比期</i><b>{{ meta.high && meta.high.date }}</b><em>云量 {{ meta.high && meta.high.cloud != null ? Math.round(meta.high.cloud) + '%' : '--' }}</em></div>
        <div class="st"><i>采样</i><b>{{ meta.pixels }}</b><em>约 {{ Math.round((meta.resolution || 0)) }} m/px</em></div>
        <div class="st"><i>异常点</i><b>{{ (meta.anomalies || []).length }}</b><em>已喂给钓点排序</em></div>
      </div>

      <div class="field" style="margin-top:10px">
        <label>窗口（km）<span class="hint-inline">值越小分辨率越高，重新读取不重新检索</span></label>
        <div style="display:flex;gap:8px;align-items:center">
          <input v-model.number="zoomKm" type="number" step="0.1" min="0.3" max="3" style="max-width:110px">
          <button class="act ghost" :disabled="busy" @click="rereadZoom">按这个窗口重读</button>
        </div>
      </div>

      <div v-if="scenes.length" class="field" style="margin-top:8px">
        <label>可选期次（按水体占比从低到高，点一条换主影像）</label>
        <div class="reslist">
          <button v-for="s in scenes.slice(0, 8)" :key="s.id"
                  :class="{ on: res.lowItem && res.lowItem.id === s.id }"
                  @click="pickScene(s.id)">
            <b>{{ s.date }}</b>
            <span>水体占比 {{ s.frac != null ? Math.round(s.frac * 100) + '%' : '--' }} ·
              云 {{ s.cloud != null ? Math.round(s.cloud) + '%' : '--' }}</span>
          </button>
        </div>
      </div>

      <p v-if="progress" class="hint">{{ progress }}</p>
      <p v-if="error" class="hint" style="color:var(--err)">{{ error }}</p>
    </div>

    <div class="card-foot">
      上方影像 © ESA Sentinel-2（判水位与水深用）。蓝绿比水深是相对值，不等于实测深度；
      异常点只是「蓝绿比明显偏离」的格子，用来提示可能有浅脊或硬底，仍需实钓验证。
    </div>
  </section>
</template>
