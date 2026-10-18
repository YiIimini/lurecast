import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

// 设计系统沿用现有的两套样式（重构不换皮）
import '../assets/theme.css'
import '../assets/app.css'

// 图标：legacy 的 icons.js 是一张 SVG 表 + paint()，先照原样复用，P4 再搬成模块
import '../assets/icons.js'

const app = createApp(App)
app.use(createPinia())
app.mount('#app')

// 挂载后把 [data-icon] 填成 SVG（与 legacy 页面同一套图标）
const icons = (window as any).Icons
if (icons && icons.paint) icons.paint()
