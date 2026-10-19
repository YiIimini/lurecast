<script setup lang="ts">
/* LureCast · 钓点档案编辑器（P3）—— 对应老壳 #modalPlace / openPlaceEditor()
   常用地点不只是坐标：名称、描述、最多 6 张图（压到 480px，只存这台设备）。 */
import { computed, ref, watch } from 'vue'
import { compressImage } from '../../stores/my'
import { alertBox, toast } from '../../lib/ui'

const props = withDefaults(defineProps<{
  show: boolean
  idx: number
  lat: number
  lon: number
  initialName?: string
  initialDesc?: string
  initialPhotos?: string[]
}>(), { initialName: '', initialDesc: '', initialPhotos: () => [] })

const emit = defineEmits<{
  (e: 'save', payload: { name: string; desc: string; photos: string[] }): void
  (e: 'close'): void
}>()

const name = ref('')
const desc = ref('')
const photos = ref<string[]>([])
const busy = ref(false)
const albumInput = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)

const title = computed(() => (props.idx >= 0 ? '编辑钓点' : '保存钓点'))
const coordText = computed(() =>
  '坐标 ' + props.lat.toFixed(5) + ', ' + props.lon.toFixed(5) + ' · WGS-84，名称/描述/图片都只存本机')

watch(() => props.show, (on) => {
  if (!on) return
  name.value = props.initialName || ''
  desc.value = props.initialDesc || ''
  photos.value = (props.initialPhotos || []).slice(0, 6)
})

async function addFiles(list: FileList | null) {
  const files = Array.prototype.slice.call(list || []).slice(0, 6) as File[]
  if (!files.length) return
  busy.value = true
  try {
    const urls = await Promise.all(files.map(compressImage))
    photos.value = photos.value.concat(urls).slice(0, 6)
  } catch (e: any) {
    alertBox('图片处理失败：' + (e && e.message ? e.message : e), { title: '图片' })
  } finally {
    busy.value = false
  }
}

function removePhoto(i: number) {
  photos.value.splice(i, 1)
}

function save() {
  const n = name.value.trim()
  if (!n) { alertBox('给这个钓点起个名字吧。', { title: '还差个名字' }); return }
  emit('save', { name: n, desc: desc.value.trim(), photos: photos.value.slice(0, 6) })
}

void toast
</script>

<template>
  <!-- 必须 Teleport 到 body：这个编辑框挂在「常用地点」卡片里，卡片的入场动画（transform）
       与毛玻璃会形成包含块 + 层叠上下文，position:fixed 会被关在卡片里，看着就不像弹窗。 -->
  <Teleport to="body">
    <div class="modal" :class="{ hidden: !show }" @click.self="emit('close')">
    <div class="modal-box">
      <div class="modal-head">
        <h3>{{ title }}</h3>
        <button class="act ghost" @click="emit('close')">关闭</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>名称</label>
          <input v-model="name" placeholder="例如：停车场旁石堤" autocomplete="off">
        </div>
        <div class="field">
          <label>描述（钓法、注意事项、鱼的分布，可留空）</label>
          <textarea v-model="desc" rows="3" placeholder="退潮是泥滩、涨潮能站人；贴底德州打坎脚，傍晚有翘嘴炸水"></textarea>
        </div>
        <div class="field">
          <label>图片（选填，最多 6 张，只存这台设备）</label>
          <div class="placephotos">
            <div v-for="(u, i) in photos" :key="i" class="placephoto">
              <img :src="u" alt="">
              <button title="删除这张" @click="removePhoto(i)">×</button>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">
            <button class="act" :disabled="busy" @click="albumInput && albumInput.click()">从相册选</button>
            <button class="act" :disabled="busy" @click="cameraInput && cameraInput.click()">拍照</button>
          </div>
          <input ref="albumInput" type="file" accept="image/*" multiple style="position:absolute;opacity:0;width:1px;height:1px;pointer-events:none"
                 @change="addFiles(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''">
          <input ref="cameraInput" type="file" accept="image/*" capture="environment" style="position:absolute;opacity:0;width:1px;height:1px;pointer-events:none"
                 @change="addFiles(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''">
        </div>
        <p class="hint">{{ coordText }}</p>
      </div>
      <div class="modal-foot">
        <button class="act primary" :disabled="busy" @click="save">保存</button>
      </div>
    </div>
    </div>
  </Teleport>
</template>
