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
import { Store } from './lib/store'

/* 启动顺序：等存储层就绪 → 读偏好 → 挂载。
   存储层是「内存镜像 + IndexedDB 异步落盘」，getItem 同步读的是镜像，镜像由 readAll 灌入。
   initPrefs / I18N.load / 我的 / 声呐 / 底图 全是在挂载后同步读 Store，先挂载就会读到空镜像：
   偏好回默认、渔获与常用地点像丢了，随后任意一次写入还会把真数据覆盖掉。
   2.5 s 兜底：IndexedDB 被隐私模式或别的页面卡住时不能白屏，照旧用默认值起来。 */
const BOOT_TIMEOUT = 2500

function boot() {
  // 与老壳同序：先读判定口径与外观（CFG/UI），再读界面语言
  initPrefs()
  I18N.load()
  I18N.apply()

  const app = createApp(App)
  app.use(createPinia())
  app.mount('#app')

  /* 挂载后再跑一次 i18n：apply() 里的 DOM 文案替换 + MutationObserver 都要等 body 与卡片渲染出来，
     在挂载前调用只会扫到空壳（英文/繁体启动时就会一直是中文）。 */
  I18N.apply()

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
     新 SW 的清单是 install 时从 index.html 里扒的，加资源不用再手改。
     注意 boot 可能晚于 load（等 IndexedDB 那次异步），那时再 addEventListener('load') 就永远等不到，
     所以页已加载完就立即注册。 */
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const reg = () => navigator.serviceWorker.register('./sw.js').catch(() => { /* 拿不到离线能力也不影响使用 */ })
    if (document.readyState === 'complete') reg()
    else window.addEventListener('load', reg)
  }
}

let booted = false
const start = () => { if (!booted) { booted = true; boot() } }
setTimeout(start, BOOT_TIMEOUT)
Store.ready.then(start, start)   // Store.ready 是 Promise（不是函数），见 lib/store.ts
