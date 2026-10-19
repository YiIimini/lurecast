/* LureCast · 弹窗预览的浮层（只负责标题条 + 关闭；内容层由 CSS 提到视口上）
   地图与水族馆共用：一根半透明标题条压在画面顶部，右下角一个关闭按钮，
   其余部分全让给内容，不再有卡片说明文字挡在图上。 */
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { closePreview, previewKind, previewTitle } from '../../lib/preview'

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && previewKind.value) closePreview()
}

/* 图标是 legacy icons.js 启动时 paint 的；这一层是后挂上来的，出现后重画一次 */
watch(previewKind, () => nextTick(() => (window as any).__lcPaintIcons?.()))

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  closePreview()
})
</script>

<template>
  <div class="pvbar" v-if="previewKind" role="dialog" aria-modal="true">
    <h3>{{ previewTitle }}</h3>
    <button class="act ghost pvclose" aria-label="关闭预览" @click="closePreview()">
      <i class="ic" data-icon="close"></i><span class="lbl">关闭</span>
    </button>
  </div>
</template>
