<script setup lang="ts">
/* LureCast · 「常用地点」卡（P3）—— 对应老壳 #cardFav / my.js renderFav()
   点一下 = 切到那个点重新评估；✎ 编辑名称/描述/图片，× 删除（都带确认）。 */
import { computed, ref } from 'vue'
import { useEnvStore } from '../../stores/env'
import { useSpotsStore } from '../../stores/spots'
import { useUiStore } from '../../stores/ui'
import { useMyStore, fmtDate } from '../../stores/my'
import { Engine as E } from '../../lib/engine'
import { alertBox } from '../../lib/ui'
import PlaceEditor from '../modals/PlaceEditor.vue'

const env = useEnvStore()
const spots = useSpotsStore()
const ui = useUiStore()
const my = useMyStore()

const editorOpen = ref(false)
const editorIdx = ref(-1)
const editorLat = ref(0)
const editorLon = ref(0)

const rows = computed(() => my.favorites.map((f, i) => {
  const d = env.me ? E.dist(env.me as any, f as any) : null
  return { f, i, dist: d, photos: (f.photos || []).length }
}))

function goPlace(f: any) {
  ui.setTab('summary')
  env.placeHint = f.name
  env.load(f.lat, f.lon)
  spots.load(f.lat, f.lon)
}

function openNew() {
  if (!env.me) { alertBox('还没有定位：先用 GPS 或「找水域」选一个地方。', { title: '先定位' }); return }
  if (my.isPlaceSaved(env.me.lat, env.me.lon)) {
    alertBox('这个位置已经存过了（120 米内）。在列表里点「✎」可以补图片和描述。', { title: '重复地点' })
    return
  }
  editorIdx.value = -1
  editorLat.value = env.me.lat
  editorLon.value = env.me.lon
  editorOpen.value = true
}

function openEdit(i: number) {
  const f = my.favorites[i]
  if (!f) return
  editorIdx.value = i
  editorLat.value = f.lat
  editorLon.value = f.lon
  editorOpen.value = true
}

function onSave(payload: { name: string; desc: string; photos: string[] }) {
  const ok = my.savePlace({
    idx: editorIdx.value, lat: editorLat.value, lon: editorLon.value,
    name: payload.name, desc: payload.desc, photos: payload.photos
  })
  if (ok) editorOpen.value = false
}
</script>

<template>
  <section id="cardFav" class="card span2 show" data-fam="loc">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="pin"></i></span>
      <h2>常用地点</h2>
      <div class="head-right"><button class="act primary" @click="openNew">保存当前位置</button></div>
    </div>

    <div class="favlist">
      <div v-if="!rows.length" class="empty">
        <b>还没有常用地点</b>
        <p>定位到常去的钓点后点右上「保存当前位置」。之后一键就能切过去评估，不用每次重新搜。</p>
      </div>

      <div v-for="r in rows" :key="r.f.id || r.i" class="favrow">
        <button class="favgo" @click="goPlace(r.f)">
          <span v-if="r.photos" class="favthumb"><img :src="r.f.photos[0]" alt=""></span>
          <span class="favtext">
            <b><span class="favstars">★</span> {{ r.f.name }}</b>
            <em v-if="r.f.desc" style="color:var(--ink-2)">{{ r.f.desc }}</em>
            <em>
              {{ r.f.lat.toFixed(4) }}, {{ r.f.lon.toFixed(4) }}
              <template v-if="r.dist != null"> · 距 {{ E.fmtDist(r.dist) }}</template>
              · 存于 {{ fmtDate(r.f.at).slice(5) }}
              <template v-if="r.photos"> · {{ r.photos }} 张图</template>
            </em>
          </span>
        </button>
        <div class="favacts">
          <button class="favdel" title="编辑名称/描述/图片" @click.stop="openEdit(r.i)">✎</button>
          <button class="favdel" title="删除" @click.stop="my.deletePlace(r.i)">×</button>
        </div>
      </div>
    </div>

    <div class="card-foot">存在本机，不联网。点一下就切过去重新评估；常去的几个点存好，出门前对比哪个鱼口更好。</div>

    <PlaceEditor
      :show="editorOpen" :idx="editorIdx" :lat="editorLat" :lon="editorLon"
      :initial-name="editorIdx >= 0 ? (my.favorites[editorIdx] && my.favorites[editorIdx].name) || '' : my.defaultPlaceName()"
      :initial-desc="editorIdx >= 0 ? (my.favorites[editorIdx] && my.favorites[editorIdx].desc) || '' : ''"
      :initial-photos="editorIdx >= 0 ? (my.favorites[editorIdx] && my.favorites[editorIdx].photos) || [] : []"
      @save="onSave" @close="editorOpen = false" />
  </section>
</template>
