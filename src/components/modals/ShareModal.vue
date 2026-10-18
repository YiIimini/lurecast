<script setup lang="ts">
/* LureCast · 「分享与导航」弹窗（P4）—— 对应老壳 #modalShare / openShareModal()
   目标点规则与老壳一致：设了「目标钓点」就用它，否则用当前位置。
   坐标一律 WGS-84 原值展示；高德/百度在自己那套坐标系里换算，用户不用纠偏。 */
import { computed } from 'vue'
import { useEnvStore } from '../../stores/env'
import { useSpotsStore } from '../../stores/spots'
import { useUiStore } from '../../stores/ui'
import { toast } from '../../lib/ui'
import { CoShare } from '../../lib/share'

const env = useEnvStore()
const spots = useSpotsStore()
const ui = useUiStore()

const visible = computed(() => ui.modal === 'share')

const target = computed(() => {
  const t = spots.navTarget
  if (t) return { lat: t.lat, lon: t.lon, label: t.title, isSpot: true }
  if (env.me) return { lat: env.me.lat, lon: env.me.lon, label: placeLabel(), isSpot: false }
  return null
})

function placeLabel() {
  return env.placeHint || (env.place && (env.place as any).name) || '当前位置'
}

const latLon = computed(() => (target.value
  ? target.value.lat.toFixed(5) + ', ' + target.value.lon.toFixed(5)
  : '--'))

const targetLine = computed(() => {
  const t = spots.navTarget
  if (!t) return ''
  return '导航目标是「' + t.title + '」' + (t.score != null ? '（钓点 ' + t.score + ' 分）' : '')
})

function navAmap() {
  const t = target.value
  if (!t) return
  CoShare.navAmap(t.lat, t.lon, t.label)
}

function navBaidu() {
  const t = target.value
  if (!t) return
  CoShare.navBaidu(t.lat, t.lon, t.label)
}

function shareText() {
  const t = target.value
  if (!t) return
  CoShare.share(t.lat, t.lon, t.label).then((how: string) => {
    if (how === 'copy') toast('系统分享不可用，已复制到剪贴板')
  })
}

function copyCoord() {
  const t = target.value
  if (!t) return
  /* copy() 成功时 resolve 的是 undefined（navigator.clipboard.writeText 返回 void），
     只有回落路径才返回 true/false —— 所以「明确失败」才算失败。 */
  CoShare.copy(CoShare.shareText(t.lat, t.lon, t.label)).then((ok: any) => {
    toast(ok === false ? '复制失败，请长按上面的坐标手动复制' : '坐标与地图链接已复制')
  })
}
</script>

<template>
  <div class="modal" :class="{ hidden: !visible }" @click.self="ui.closeModal()">
    <div class="modal-box">
      <div class="modal-head">
        <h3>分享与导航</h3>
        <button class="act ghost" @click="ui.closeModal()">关闭</button>
      </div>
      <div class="modal-body">
        <div class="sharept">
          <b>{{ latLon }}</b>
          <i>WGS-84 原始坐标 · 高德/百度在本机自动换算，不用手动纠偏</i>
          <p style="margin:6px 0 0;font-size:var(--tiny);color:var(--a2)">{{ targetLine }}</p>
        </div>

        <div class="sharegrid">
          <button class="sharecell" @click="navAmap">
            <span class="sic amap"><i class="ic" data-icon="nav"></i></span>
            <b>高德导航</b><em>驾车到点</em>
          </button>
          <button class="sharecell" @click="navBaidu">
            <span class="sic baidu"><i class="ic" data-icon="pin"></i></span>
            <b>百度导航</b><em>驾车到点</em>
          </button>
          <button class="sharecell" @click="shareText">
            <span class="sic send"><i class="ic" data-icon="send"></i></span>
            <b>分享位置</b><em>微信 / QQ 等</em>
          </button>
          <button class="sharecell" @click="copyCoord">
            <span class="sic copy"><i class="ic" data-icon="copy"></i></span>
            <b>复制坐标</b><em>WGS-84 + 高德</em>
          </button>
        </div>

        <p class="hint">
          坐标按 WGS-84（GPS 口径）保存；高德要 GCJ-02、百度要 BD-09，点按钮时自动换算。
          没装对应的地图 App 会自动改成打开网页版地图。
        </p>
      </div>
      <div class="modal-foot">坐标只在你本机换算，不上传任何服务器。</div>
    </div>
  </div>
</template>
