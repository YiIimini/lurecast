import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

// 设计系统沿用现有的两套样式（重构不换皮）。顺序照 index.html：
// Leaflet → theme → app —— 反过来的话 leaflet 的 .leaflet-container{background:#ddd}
// 会盖掉我们的深色底（瓦片没加载出来时地图就变成浅灰）。
import '../assets/vendor/leaflet/leaflet.css'
import '../assets/theme.css'
import '../assets/app.css'
// 图标：legacy 的 icons.js 是一张 SVG 表 + paint()，先照原样复用，P4 再搬成模块
import '../assets/icons.js'
import { initPrefs } from './lib/cfg'
import { I18N } from './lib/i18n'

// 与老壳同序：先读判定口径与外观（CFG/UI），再读界面语言
initPrefs()
I18N.load()
I18N.apply()

const app = createApp(App)
app.use(createPinia())
app.mount('#app')

// 挂载后把 [data-icon] 填成 SVG（与 legacy 页面同一套图标）
const icons = (window as any).Icons

// Vue 每次切换页签/弹窗都可能带出新的 [data-icon]：paint() 幂等，重画一次即可
const paintIcons = () => {
  const ic = (window as any).Icons
  if (ic && ic.paint) ic.paint()
}
;(window as any).__lcPaintIcons = paintIcons
if (icons && icons.paint) icons.paint()

/* Service Worker：只在打包产物里注册（dev 下会缓存 Vite 的模块图，反而碍事）。
   新 SW 的清单是 install 时从 index.html 里扒的，加资源不用再手改。 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 拿不到离线能力也不影响使用 */ })
  })
}
