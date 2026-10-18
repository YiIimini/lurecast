/* LureCast · 用户配置与外观偏好（P4）—— 由 assets/app.js 的 CFG / UI / PALETTES /
   loadCfg·saveCfg·applyCfg / loadUi·saveUi·applyUi 机械迁移
   ------------------------------------------------------------------------------------
   口径有争议的一律交给用户选：评分偏好、水温来源、卫星兜底、路线服务。
   外观（配色/字号/性能/背景色斑）直接改 CSS 变量与 body class，不重绘组件。
   两个键：lc:cfg（判定口径）、lc:ui（外观与操作），都只在本机。 */
import { Store } from './store'
import { Engine as E } from './engine'

export type Cfg = {
  score: 'balanced' | 'pressure' | 'temp' | 'wind'
  water: 'auto' | 'manual'
  waterManual: number | null
  satFallback: boolean
  route: 'osrm' | 'custom' | 'off'
  routeUrl: string
}

export const CFG: Cfg = {
  score: 'balanced',
  water: 'auto',
  waterManual: null,
  satFallback: true,
  route: 'osrm',
  routeUrl: ''
}

export type UiPrefs = { palette: string; fs: number; perf: boolean; aurora: boolean }

export const PALETTES = [
  { id: 'void', name: '深空蓝', a1: '#5be7ff', a2: '#9b8cff', a3: '#6ff2c4' },
  { id: 'aurora', name: '极光紫', a1: '#b58bff', a2: '#5be7ff', a3: '#ff9ecb' },
  { id: 'amber', name: '熔金橙', a1: '#ffb454', a2: '#ff6e8a', a3: '#ffe07a' },
  { id: 'jade', name: '翡翠绿', a1: '#4ce0b3', a2: '#5be7ff', a3: '#c7f26b' },
  { id: 'sakura', name: '樱花粉', a1: '#ff9ecb', a2: '#b58bff', a3: '#7ee3ff' },
  { id: 'graphite', name: '石墨灰', a1: '#9fb3cc', a2: '#7a8aa3', a3: '#c8d6e6' }
]

export const UI: UiPrefs = { palette: 'void', fs: 14, perf: false, aurora: true }

export const SCORE_PRESETS: { id: Cfg['score']; name: string; sub: string }[] = [
  { id: 'balanced', name: '均衡', sub: '六项平摊，适合大多数人' },
  { id: 'pressure', name: '气压优先', sub: '气压与 3 小时变压合计 30%' },
  { id: 'temp', name: '水温优先', sub: '水温占 30%' },
  { id: 'wind', name: '风优先', sub: '风力风向占 32%' }
]

export const ROUTE_OPTIONS: { id: Cfg['route']; name: string; sub: string }[] = [
  { id: 'osrm', name: '公共 OSRM', sub: '社区演示服务器，可能慢' },
  { id: 'custom', name: '自己的地址', sub: '填下面的模板' },
  { id: 'off', name: '关掉', sub: '不请求，画直线' }
]

export function loadCfg() {
  try {
    const raw = Store.getItem('lc:cfg')
    if (raw) {
      const o = JSON.parse(raw)
      if (o && typeof o === 'object') {
        (Object.keys(CFG) as (keyof Cfg)[]).forEach((k) => { if (o[k] !== undefined) (CFG as any)[k] = o[k] })
      }
    }
  } catch { /* 用默认 */ }
  applyCfg()
}

export function saveCfg() {
  try { Store.setItem('lc:cfg', JSON.stringify(CFG)) } catch { /* 忽略 */ }
  applyCfg()
}

export function applyCfg() {
  // 权重只影响环境分：改完立刻按新权重重算，不用重新拉数据
  if ((E as any).setProfile) (E as any).setProfile(CFG.score)
}

export function loadUi() {
  try {
    const raw = Store.getItem('lc:ui')
    if (!raw) return
    const o = JSON.parse(raw)
    if (o.palette) UI.palette = o.palette
    if (o.fs) UI.fs = o.fs
    UI.perf = !!o.perf
    UI.aurora = o.aurora !== false
  } catch { /* 用默认值 */ }
}

export function saveUi() {
  try { Store.setItem('lc:ui', JSON.stringify(UI)) } catch { /* 忽略 */ }
}

/* 外观：只改 CSS 变量与 body class（与老壳同一套变量名，theme.css/app.css 不用动） */
export function applyUi() {
  const root = document.documentElement
  const p = PALETTES.filter((x) => x.id === UI.palette)[0] || PALETTES[0]
  root.style.setProperty('--a1', p.a1)
  root.style.setProperty('--a2', p.a2)
  root.style.setProperty('--a3', p.a3)
  root.style.setProperty('--fs', UI.fs + 'px')
  document.body.classList.toggle('perf', !!UI.perf)
  document.body.classList.toggle('no-aurora', !UI.aurora)
}

/* 启动时按老壳顺序读一遍（先配置后外观） */
export function initPrefs() {
  loadCfg()
  loadUi()
  applyUi()
}
