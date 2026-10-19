/* LureCast · 弹窗预览（地图 / 水族馆）
   ---------------------------------------------------------------------------
   为什么不再用「把卡片本身铺满」（旧 #cardAqua.fs / #cardMap.fs）：
   卡片里还有标题、图例、脚注，铺满之后这些字压在画面上，图被挡掉一圈，看不全；
   而且卡片在 .stage 里，外层还有内边距与滚动容器，全屏时容易露出边。

   现在改成真正的弹窗预览：把内容层（`.mapbox` / `.aqua`）用 position:fixed 提到视口上，
   卡片其余部分留在下面（被完全盖住，看不见），最上面只加一根半透明标题条 + 关闭按钮。
   没有搬动 DOM：Leaflet 的容器与 WebGL 的 canvas 一动就可能丢状态，这里靠 CSS 提层 + 重算尺寸。

   同一时间只开一个预览（地图和水族馆互斥）。 */
import { ref } from 'vue'

export type PreviewKind = 'map' | 'aqua'

export const previewKind = ref<PreviewKind | null>(null)
export const previewTitle = ref('')

/* 打开/关闭后都要让内容自己重算尺寸：Leaflet 要 invalidateSize，canvas 要按 clientWidth 重建 */
let onResize: (() => void) | null = null
let moved: HTMLElement | null = null
let anchor: Comment | null = null
function fire() {
  try { if (onResize) onResize() } catch (e) { console.warn('[preview] resize 失败', e) }
}

export function openPreview(kind: PreviewKind, title: string, el: HTMLElement | null, resize?: () => void) {
  if (previewKind.value === kind) return
  closePreview()
  previewKind.value = kind
  previewTitle.value = title
  onResize = resize || null
  document.body.classList.add('pv-on', 'pv-' + kind)

  /* 关键：内容层必须真的搬到 <body> 下。
     只加 position:fixed 不行 —— 卡片自带入场动画（transform）与 backdrop-filter，
     会形成「包含块 + 层叠上下文」，fixed 会被关在卡片里定位，后面几张卡片还会盖在它上面。 */
  if (el && el.parentNode) {
    anchor = document.createComment('pv-anchor')
    el.parentNode.insertBefore(anchor, el)
    el.classList.add('pv-target', 'pv-target-' + kind)
    document.body.appendChild(el)
    moved = el
  }

  /* 布局变一次、过渡结束再各算一次，慢设备也不留白 */
  requestAnimationFrame(fire)
  setTimeout(fire, 140)
  setTimeout(fire, 380)
}

export function closePreview() {
  const kind = previewKind.value
  if (!kind) return
  const cb = onResize
  previewKind.value = null
  document.body.classList.remove('pv-on', 'pv-' + kind)
  onResize = null
  /* 搬回原位（放在原来的注释锚点前），再让内容重算一次尺寸 */
  if (moved && anchor) {
    moved.classList.remove('pv-target', 'pv-target-map', 'pv-target-aqua')
    if (anchor.parentNode) anchor.parentNode.insertBefore(moved, anchor)
    anchor.remove()
  }
  moved = null
  anchor = null
  requestAnimationFrame(() => { try { if (cb) cb() } catch (e) { /* 回位失败不影响使用 */ } })
}

export function isPreviewOpen(kind?: PreviewKind) {
  return kind ? previewKind.value === kind : previewKind.value !== null
}
