<script setup lang="ts">
/* LureCast · 设置弹窗（P4）—— 对应老壳 #modalSettings / initCfgUI + initUpdateUI
   ---------------------------------------------------------------------------
   分五组：外观与操作 / 判定口径 / 地图与路线 / 识图与助手 / 数据与版本。
   全部只存本机（Store：lc:cfg 判定口径、lc:ui 外观、lc:ai 识图 Key、lc:map 底图）。
   改完立刻生效：权重走 Engine.setProfile（环境分立即按新权重重算），
   外观直接改 CSS 变量 / body class，底图换 Leaflet 瓦片层，不需要重新取数。 */
import { computed, ref, watch } from 'vue'
import { useUiStore } from '../../stores/ui'
import { useEnvStore, computeEnv } from '../../stores/env'
import { useSpotsStore } from '../../stores/spots'
import { Store } from '../../lib/store'
import {
  CFG, UI, PALETTES, SCORE_PRESETS, ROUTE_OPTIONS, loadUi, saveCfg, saveUi, applyUi
} from '../../lib/cfg'
import { BASEMAPS, MAPCFG, basemapById, saveMapCfg } from '../../lib/basemap'
import { I18N } from '../../lib/i18n'
import { AI } from '../../lib/ai'
import { toast, confirmBox } from '../../lib/ui'

const ui = useUiStore()
const env = useEnvStore()
const spots = useSpotsStore()

const visible = computed(() => ui.modal === 'settings')

const tab = ref<'look' | 'rules' | 'map' | 'ai' | 'data'>('look')
const TABS = [
  { id: 'look', name: '外观与操作' },
  { id: 'rules', name: '判定口径' },
  { id: 'map', name: '地图与路线' },
  { id: 'ai', name: '识图与助手' },
  { id: 'data', name: '数据与版本' }
] as const

/* ---------------------------------------------------------------- 外观 */
const fsOptions = [13, 14, 15.5, 17]
const langs = I18N.LANGS
const langNow = ref(I18N.get())

function pickPalette(id: string) {
  UI.palette = id
  applyUi()
  saveUi()
}

function pickFs(v: number) {
  UI.fs = v
  applyUi()
  saveUi()
}

function togglePerf() {
  UI.perf = !UI.perf
  applyUi()
  saveUi()
}

function toggleAurora() {
  UI.aurora = !UI.aurora
  applyUi()
  saveUi()
}

function pickLang(id: string) {
  I18N.set(id)
  langNow.value = I18N.get()
  toast('界面语言已切换（卡片文案按语言表回填）')
}

/* ---------------------------------------------------------------- 判定口径 */
function pickScore(id: any) {
  CFG.score = id
  saveCfg()
  spots.rebuild()     // 权重重算后钓点分立刻跟着变
  recomputeEnv()
}

function pickWaterSrc(id: 'auto' | 'manual') {
  CFG.water = id
  saveCfg()
  recomputeEnv()
}

function setWaterManual(v: any) {
  const n = parseFloat(v)
  CFG.waterManual = isFinite(n) ? n : null
  saveCfg()
  recomputeEnv()
}

function toggleSatFallback() {
  CFG.satFallback = !CFG.satFallback
  saveCfg()
}

function pickRoute(id: any) {
  CFG.route = id
  saveCfg()
}

function setRouteUrl(v: string) {
  CFG.routeUrl = v
  saveCfg()
}

/* 口径一改，环境分与钓点排名都重算（不重新取数） */
function recomputeEnv() {
  if (!env.wx) return
  computeEnv(env)
  spots.rebuild()
}

/* ---------------------------------------------------------------- 地图 */
const mapStyles = BASEMAPS
const mapUrl = ref(MAPCFG.url || '')
const mapKey = ref(MAPCFG.key || '')

function pickBasemap(id: string) {
  MAPCFG.style = id
  saveMapCfg()
  ui.mapApi?.applyBasemap?.()
  toast('底图已切换：' + basemapById(id).name)
}

function applyMapUrl() {
  MAPCFG.url = mapUrl.value.trim()
  MAPCFG.key = mapKey.value.trim()
  saveMapCfg()
  ui.mapApi?.applyBasemap?.()
}



/* ---------------------------------------------------------------- 识图与助手 */
AI.load()
const aiCfg: any = AI.cfg()
const aiProviders = AI.providers
const aiProvider = ref(aiCfg.provider || aiProviders[0].id)
const aiKey = ref(aiCfg.key || '')
const aiBase = ref(aiCfg.base || '')
const aiModel = ref(aiCfg.model || '')
const aiChatModel = ref(aiCfg.chatModel || '')
const aiTest = ref('')
const testing = ref(false)

/* 老壳的 AI.save() 不接参数：先把值写回 cfg 对象，再落盘 */
function saveAi() {
  const c: any = AI.cfg()
  if (!c) return
  c.provider = aiProvider.value
  c.key = aiKey.value.trim()
  c.base = aiBase.value.trim()
  c.model = aiModel.value.trim()
  c.chatModel = aiChatModel.value.trim()
  AI.save()
  toast('识图设置已保存（只存本机）')
}

async function testAi() {
  saveAi()
  testing.value = true
  aiTest.value = '正在测试…'
  try {
    const r = await AI.chat('只回四个字：连接成功', { maxTokens: 32 })
    aiTest.value = '成功：' + String(r).slice(0, 60)
  } catch (e: any) {
    aiTest.value = '失败：' + ((e && e.message) || e)
  } finally {
    testing.value = false
  }
}

/* ---------------------------------------------------------------- 数据与版本 */
const storeInfo = ref('正在读取存储用量…')
const verInfo = ref('')

function readStore() {
  const info = Store.info()
  const mb = (n: number) => (n / 1024 / 1024).toFixed(2) + ' MB'
  storeInfo.value = '后端 ' + info.backend + ' · ' + info.keys + ' 个键 · 约 ' + mb(info.bytes)
    + (info.migrated ? ' · 已从 localStorage 迁移 ' + info.migrated + ' 条' : '')
}

async function clearCache() {
  const ok = await confirmBox('清空缓存数据？渔获与常用地点会保留。', { title: '清空缓存', danger: true, okText: '清空' })
  if (!ok) return
  Store.clearCache()
  readStore()
  toast('缓存已清空（渔获/地点/设置都在）')
}

function readVersion() {
  // vite 在构建时注入的版本常量（define），拿不到就退回 app 版本号
  const v: any = (import.meta as any).env || {}
  verInfo.value = '界面 ' + (v.VITE_APP_VERSION || '1.0') + ' · 壳 ' + (navigator.userAgent.includes('LureCast') ? '原生' : '浏览器')
    + ' · 数据源 Open-Meteo / OpenStreetMap / Copernicus DEM' + (CFG.satFallback ? ' / Sentinel-2' : '')
}

watch(visible, (on) => {
  if (!on) return
  langNow.value = I18N.get()
  mapUrl.value = MAPCFG.url || ''
  mapKey.value = MAPCFG.key || ''
  readStore()
  readVersion()
})
</script>

<template>
  <div id="modalSettings" class="modal" :class="{ hidden: !visible }" @click.self="ui.closeModal()">
    <div class="modal-box">
      <div class="modal-head">
        <h3>设置</h3>
        <button class="act ghost" @click="ui.closeModal()">关闭</button>
      </div>

      <div class="modal-body">
        <div class="chiprow" style="margin-bottom:4px">
          <button v-for="t in TABS" :key="t.id" class="chip" :class="{ on: tab === t.id }"
                  @click="tab = t.id as any">{{ t.name }}</button>
        </div>

        <!-- 外观与操作 -->
        <template v-if="tab === 'look'">
          <div class="field">
            <label>配色</label>
            <div class="palrow">
              <button v-for="p in PALETTES" :key="p.id" class="swatch" :class="{ on: UI.palette === p.id }"
                      :aria-label="p.name" :style="{ '--s1': p.a1, '--s2': p.a2 }"
                      @click="pickPalette(p.id)"></button>
            </div>
          </div>
          <div class="field">
            <label>界面字号</label>
            <div class="chiprow">
              <button v-for="v in fsOptions" :key="v" class="chip" :class="{ on: UI.fs === v }" @click="pickFs(v)">
                {{ v === 13 ? '小' : v === 14 ? '标准' : v === 15.5 ? '大' : '特大' }} <em>{{ v }}</em>
              </button>
            </div>
          </div>
          <div class="field">
            <label>界面语言</label>
            <div class="chiprow">
              <button v-for="l in langs" :key="l.id" class="chip" :class="{ on: langNow === l.id }"
                      @click="pickLang(l.id)">{{ l.short }} <em>{{ l.name }}</em></button>
            </div>
          </div>
          <div class="field">
            <label>性能与动效</label>
            <div class="chiprow">
              <button class="chip" :class="{ on: UI.perf }" @click="togglePerf">性能优先 <em>去模糊与光晕</em></button>
              <button class="chip" :class="{ on: UI.aurora }" @click="toggleAurora">背景色斑</button>
            </div>
          </div>
        </template>

        <!-- 判定口径 -->
        <template v-else-if="tab === 'rules'">
          <div class="field">
            <label>评分偏好 <span class="hint-inline">六项因子怎么分配权重</span></label>
            <div class="chiprow">
              <button v-for="p in SCORE_PRESETS" :key="p.id" class="chip" :class="{ on: CFG.score === p.id }"
                      :title="p.sub" @click="pickScore(p.id)">{{ p.name }}</button>
            </div>
            <p class="hint">改完立即按新权重重算环境分与钓点排名，不重新取数。</p>
          </div>
          <div class="field">
            <label>水温来源 <span class="hint-inline">内陆湖库没有免费实测水温</span></label>
            <div class="chiprow">
              <button class="chip" :class="{ on: CFG.water === 'auto' }" @click="pickWaterSrc('auto')">自动</button>
              <button class="chip" :class="{ on: CFG.water === 'manual' }" @click="pickWaterSrc('manual')">
                手动填水温 <em>有水温计就填它</em>
              </button>
            </div>
            <div v-if="CFG.water === 'manual'" class="field" style="margin-top:8px">
              <label>你测到的水温（℃）</label>
              <input :value="CFG.waterManual ?? ''" type="number" step="0.5" min="-2" max="40" placeholder="例如 18"
                     @change="setWaterManual(($event.target as HTMLInputElement).value)">
            </div>
          </div>
          <div class="field">
            <label>岸线兜底 <span class="hint-inline">OSM 取不到水域时怎么办</span></label>
            <div class="chiprow">
              <button class="chip" :class="{ on: CFG.satFallback }" @click="toggleSatFallback">
                卫星水面兜底 <em>{{ CFG.satFallback ? '开' : '关' }}</em>
              </button>
            </div>
            <p class="hint">关掉后不再请求 Sentinel-2；OSM 没收录水域时就没有岸线点可用。</p>
          </div>
        </template>

        <!-- 地图与路线 -->
        <template v-else-if="tab === 'map'">
          <div class="field">
            <label>底图</label>
            <div class="chiprow">
              <button v-for="b in mapStyles" :key="b.id" class="chip" :class="{ on: MAPCFG.style === b.id }"
                      @click="pickBasemap(b.id)">{{ b.name }}<em v-if="b.needKey">需 Key</em></button>
            </div>
          </div>
          <div class="field">
            <label>自定义瓦片 URL（支持 {z} {x} {y} {s} {r} {key}）</label>
            <input v-model="mapUrl" placeholder="https://tile.example.com/{z}/{x}/{y}.png?key={key}" autocomplete="off">
          </div>
          <div class="field">
            <label>瓦片 API Key（填了会替换 URL 里的 {key}）</label>
            <input v-model="mapKey" placeholder="可选；只存在本机（IndexedDB）" autocomplete="off">
            <div class="chiprow" style="margin-top:8px">
              <button class="act ghost" @click="applyMapUrl">应用</button>
            </div>
          </div>
          <div class="field">
            <label>路线服务 <span class="hint-inline">岸钓路线从哪算</span></label>
            <div class="chiprow">
              <button v-for="r in ROUTE_OPTIONS" :key="r.id" class="chip" :class="{ on: CFG.route === r.id }"
                      :title="r.sub" @click="pickRoute(r.id)">{{ r.name }}</button>
            </div>
            <div v-if="CFG.route === 'custom'" class="field" style="margin-top:8px">
              <label>自定义路线地址（支持 {profile} {fromLat} {fromLon} {toLat} {toLon}）</label>
              <input :value="CFG.routeUrl" placeholder="https://my-osrm/route/v1/{profile}/{fromLon},{fromLat};{toLon},{toLat}?overview=simplified&geometries=geojson"
                     autocomplete="off" @change="setRouteUrl(($event.target as HTMLInputElement).value)">
            </div>
          </div>
          <p class="hint">CARTO 公共底图免 Key（署名、非商用）；天地图需要自己的 tk。路线默认用 OSRM 社区演示服务器，嫌慢或想完全离线就选「关掉」。</p>
        </template>

        <!-- 识图与助手 -->
        <template v-else-if="tab === 'ai'">
          <div class="field">
            <label>厂商</label>
            <select v-model="aiProvider" @change="saveAi">
              <option v-for="p in aiProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div class="field">
            <label>API Key</label>
            <input v-model="aiKey" placeholder="只存在本机，不上传" autocomplete="off" @change="saveAi">
          </div>
          <div class="field">
            <label>baseURL（自定义/代理时填）</label>
            <input v-model="aiBase" placeholder="https://api.example.com/v1" autocomplete="off" @change="saveAi">
          </div>
          <div class="field">
            <label>模型名</label>
            <input v-model="aiModel" placeholder="例如 vision 模型名" autocomplete="off" @change="saveAi">
          </div>
          <div class="field">
            <label>对话模型（助手用，留空 = 用上面的模型）</label>
            <input v-model="aiChatModel" placeholder="例如 deepseek-chat / gpt-4o-mini" autocomplete="off" @change="saveAi">
          </div>
          <div class="chiprow">
            <button class="act ghost" :disabled="testing" @click="testAi">测试连接</button>
            <span class="hint">{{ aiTest }}</span>
          </div>
          <p class="hint">不填 Key 也能用：识图会退回「手动选鱼种」，Agent 助手不可用。浏览器直连有些厂商不放 CORS，测试连接会把真实错误报出来。</p>
        </template>

        <!-- 数据与版本 -->
        <template v-else>
          <div class="field">
            <label>本机存储</label>
            <p class="hint">{{ storeInfo }}</p>
            <div class="chiprow">
              <button class="act ghost" @click="clearCache">清空缓存数据</button>
              <span class="hint">（保留渔获与常用地点）</span>
            </div>
          </div>
          <div class="field">
            <label>版本</label>
            <p class="hint">{{ verInfo }}</p>
          </div>
          <p class="hint">
            渔获照片、常用地点、设置、卫星快照都放在本机 IndexedDB（比 localStorage 大得多，不会 5 MB 就满）。
            要换设备：「我的 → 渔获档案 → 导出档案」带走 zip。
          </p>
        </template>
      </div>

      <div class="modal-foot">设置只存在本机（IndexedDB），不进任何服务器；换设备用「导出档案」带走。</div>
    </div>
  </div>
</template>
