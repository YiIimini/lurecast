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
