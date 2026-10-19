<script setup lang="ts">
/* LureCast · 「渔获档案」卡（P3）—— 对应老壳 #cardCatch / my.js renderCatch() + openPicker()
   照片先进 pending（480px JPEG），确认鱼种后才落库；本地不做 AI 识别，避免认错鱼种。
   导出/导入走 my store 的 ZIP（保留照片 data URL）。 */
import { computed, ref } from 'vue'
import { useMyStore, compressImage, fmtDate } from '../../stores/my'
import { SPECIES_DB } from '../../lib/species'
import { alertBox, toast } from '../../lib/ui'

const my = useMyStore()

const cameraInput = ref<HTMLInputElement | null>(null)
const albumInput = ref<HTMLInputElement | null>(null)
const importInput = ref<HTMLInputElement | null>(null)

const picker = ref(false)
const pickedSp = ref('general')
const pickedSize = ref('')
const pickedNote = ref('')
const detailIdx = ref(-1)
const busy = ref(false)

const list = computed(() => my.catches)
const dbSorted = computed(() => SPECIES_DB.slice().sort((a, b) => a.zh.localeCompare(b.zh, 'zh')))

const shotsOf = (r: any): string[] =>
  (r.photos && r.photos.length) ? r.photos : (r.photo ? [r.photo] : [])

const detail = computed(() => {
  const r = my.catches[detailIdx.value]
  if (!r) return null
  const sp: any = my.speciesOf(r.sp) || { zh: r.sp, latin: '', family: '', tip: '', season: [] }
  return { r, sp, shots: shotsOf(r) }
})

async function addPhotos(files: FileList | null) {
  const arr = Array.prototype.slice.call(files || []) as File[]
  if (!arr.length) return
  busy.value = true
  try {
    const urls = await Promise.all(arr.map(compressImage))
    my.pending = { photos: urls }
    // 默认选一个「智能建议」里排第一的鱼种，用户再改
    pickedSp.value = my.suggested[0] ? my.suggested[0].id : SPECIES_DB[0].id
    pickedSize.value = ''
    pickedNote.value = ''
    picker.value = true
  } catch (e: any) {
    alertBox('图片处理失败：' + (e && e.message ? e.message : e), { title: '图片' })
  } finally {
    busy.value = false
  }
}

async function save() {
  const ok = await my.saveCatch({ sp: pickedSp.value, sizeCm: pickedSize.value, note: pickedNote.value })
  if (ok) { picker.value = false; detailIdx.value = -1 }
}

function cancelPicker() {
  picker.value = false
  my.pending = null
}

async function removeDetail() {
  const ok = await my.deleteCatch(detailIdx.value)
  if (ok) detailIdx.value = -1
}

function exportArchive() {
  const res = my.exportArchive()
  if (res) toast('已打包 ' + res.records + ' 条渔获 + ' + res.places + ' 个地点')
}

async function onImport(files: FileList | null) {
  const f = (files || [])[0]
  if (!f) return
  try {
    await my.importFromFile(f)
  } catch (e: any) {
    alertBox('导入失败：' + (e && e.message ? e.message : e), { title: '导入失败' })
  }
}
</script>

<template>
  <section id="cardCatch" class="card span2 show" data-fam="spot">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="fish"></i></span>
      <h2>渔获档案 · 拍照解锁</h2>
      <div class="head-right"><span class="card-note">本地存放</span></div>
    </div>

    <input ref="cameraInput" type="file" accept="image/*" multiple capture="environment"
           style="position:absolute;opacity:0;width:1px;height:1px;pointer-events:none"
           @change="addPhotos(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''">
    <input ref="albumInput" type="file" accept="image/*" multiple
           style="position:absolute;opacity:0;width:1px;height:1px;pointer-events:none"
           @change="addPhotos(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''">
    <input ref="importInput" type="file" accept=".zip,application/zip,application/json,.json"
           style="position:absolute;opacity:0;width:1px;height:1px;pointer-events:none"
           @change="onImport(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''">

    <div>
      <div class="catchbar">
        <span class="catchstat">
          <b>{{ my.unlockedCount }}</b> / {{ my.totalSpecies }} 种已解锁 · 共 {{ list.length }} 条记录
        </span>
        <button class="act primary" :disabled="busy" @click="cameraInput && cameraInput.click()">拍照</button>
        <button class="act ghost" :disabled="busy" @click="albumInput && albumInput.click()">从相册选</button>
        <button class="act ghost" @click="exportArchive">导出档案</button>
        <button class="act ghost" @click="importInput && importInput.click()">导入档案</button>
      </div>

      <div v-if="!list.length" class="empty">
        <b>还没有渔获档案</b>
        <p>钓到鱼就拍一张，或从相册里选一张——照片只存这台设备，会记录当时的鱼种、尺寸、天气与鱼口指数。每解锁一个新鱼种，它就会游进下面的水族馆。</p>
      </div>

      <div v-else class="catchgrid">
        <button v-for="(r, i) in list" :key="r.id" class="catchcell" :class="{ multi: shotsOf(r).length > 1 }"
                @click="detailIdx = i">
          <img v-if="shotsOf(r)[0]" :src="shotsOf(r)[0]" alt="" loading="lazy">
          <div v-else class="nocover">无照片</div>
          <span class="cclabel">
            <b>{{ (my.speciesOf(r.sp) || { zh: r.sp }).zh }}</b>
            <em>{{ r.sizeCm ? r.sizeCm + ' cm · ' : '' }}{{ fmtDate(r.at).slice(5, 10) }}</em>
          </span>
        </button>
      </div>
    </div>

    <div class="card-foot">照片自动压到 480px 并只存这台设备；每条记录会带上当时的天气与鱼口指数。本地不做 AI 识别（避免认错鱼种），由你确认。</div>

    <!-- 拍照后确认鱼种（Teleport 到 body：卡片自带 transform/毛玻璃，会把 fixed 弹窗关在卡片里） -->
    <Teleport to="body">
    <div class="modal" :class="{ hidden: !picker }" @click.self="cancelPicker">
      <div class="modal-box">
        <div class="modal-head">
          <h3>记录这条渔获</h3>
          <button class="act ghost" @click="cancelPicker">关闭</button>
        </div>
        <div class="modal-body">
          <div class="catchform">
            <div class="catchthumbs">
              <img v-if="my.pending" class="catchthumb" :src="my.pending.photos[0]" alt="渔获照片">
              <span v-if="my.pending && my.pending.photos.length > 1" class="catchmore">+{{ my.pending.photos.length - 1 }} 张</span>
            </div>
            <div class="catchfields">
              <label>鱼种（拍照后手动确认——本地不做 AI 识别，避免认错）</label>
              <select v-model="pickedSp">
                <option v-for="sp in dbSorted" :key="sp.id" :value="sp.id">{{ sp.zh }} · {{ sp.latin }}</option>
              </select>
              <div class="chiprow" style="margin-top:8px">
                <button v-for="sp in my.suggested" :key="sp.id" class="chip"
                        :class="{ on: pickedSp === sp.id }" @click="pickedSp = sp.id">{{ sp.zh }}</button>
              </div>
              <label style="margin-top:8px">尺寸（cm，可留空）
                <input v-model="pickedSize" type="number" min="1" max="300" inputmode="numeric">
              </label>
              <label style="margin-top:8px">备注
                <input v-model="pickedNote" placeholder="拟饵 / 咬口 / 天气（可空）">
              </label>
              <div class="chiprow" style="margin-top:10px">
                <button class="act primary" @click="save">保存并解锁</button>
                <button class="act ghost" @click="cancelPicker">取消</button>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-foot">照片只存这台设备；会顺带记下当时的天气与鱼口指数。</div>
      </div>
    </div>
    </Teleport>

    <!-- 详情（同样 Teleport） -->
    <Teleport to="body">
    <div class="modal" :class="{ hidden: detailIdx < 0 }" @click.self="detailIdx = -1">
      <div class="modal-box">
        <div class="modal-head">
          <h3>{{ detail ? detail.sp.zh + (detail.r.sizeCm ? ' · ' + detail.r.sizeCm + ' cm' : '') : '渔获' }}</h3>
          <button class="act ghost" @click="detailIdx = -1">关闭</button>
        </div>
        <div class="modal-body" v-if="detail">
          <div v-if="detail.shots.length" class="catchgallery">
            <a v-for="(u, i) in detail.shots" :key="i" :href="u" target="_blank" rel="noopener"><img :src="u" alt=""></a>
          </div>
          <p v-else class="hint">这条记录没有照片。</p>

          <div class="catchdl" style="margin-top:12px">
            <i>鱼种</i><b>{{ detail.sp.zh }} <span class="favtag">{{ detail.sp.latin }}</span></b>
            <i>尺寸</i><b>{{ detail.r.sizeCm ? detail.r.sizeCm + ' cm' : '未填' }}</b>
            <i>日期时间</i><b>{{ fmtDate(detail.r.at) }}</b>
            <i>位置</i>
            <b>
              <template v-if="detail.r.lat != null">
                <template v-if="detail.r.place">{{ detail.r.place }}<br></template>
                {{ detail.r.lat }}, {{ detail.r.lon }}<br>
                <a :href="'https://www.openstreetmap.org/?mlat=' + detail.r.lat + '&mlon=' + detail.r.lon + '#map=16/' + detail.r.lat + '/' + detail.r.lon"
                   target="_blank" rel="noopener">在 OSM 上查看</a>
              </template>
              <template v-else>未知</template>
            </b>
            <i>备注</i><b>{{ detail.r.note || '—' }}</b>
            <i>当时天气</i>
            <b>
              <template v-if="detail.r.weather">
                <template v-if="detail.r.weather.temp != null">{{ detail.r.weather.temp }} ℃ · </template>
                <template v-if="detail.r.weather.wind != null">风 {{ detail.r.weather.wind }} m/s · </template>
                <template v-if="detail.r.weather.press != null">{{ detail.r.weather.press }} hPa · </template>
                <template v-if="detail.r.weather.score != null">鱼口指数 {{ detail.r.weather.score }}</template>
              </template>
            </b>
            <i>附加图片</i><b>{{ detail.shots.length > 1 ? detail.shots.length + ' 张（上方画廊）' : '1 张' }}</b>
            <i>鱼种资料</i>
            <b>
              {{ detail.sp.family }}
              <template v-if="detail.sp.season && detail.sp.season.length"> · 活跃水温 {{ detail.sp.season[0] }}–{{ detail.sp.season[1] }}℃</template>
              <template v-if="detail.sp.tip"><br>{{ detail.sp.tip }}</template>
              <template v-if="detail.sp.lures"><br>拟饵：{{ detail.sp.lures.join(' / ') }}</template>
            </b>
          </div>
          <div class="chiprow" style="margin-top:14px">
            <button class="act ghost" @click="removeDetail">删除这条记录</button>
          </div>
        </div>
        <div class="modal-foot">照片与记录都只在这台设备上。</div>
      </div>
    </div>
    </Teleport>
  </section>
</template>
