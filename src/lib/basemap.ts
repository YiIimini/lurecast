/* LureCast · 底图配置 —— 由 assets/app.js 的 BASEMAPS/MAPCFG 机械迁移（P2）
   行为不变：默认 OSM 中文瓦片 + CSS 反相压暗（darktiles），键 `lc:map` 存本机。 */
import { Store } from './store'

export type Basemap = {
  id: string
  name: string
  url: string
  attr: string
  dark?: boolean
  carto?: boolean
  needKey?: boolean
  maxZoom?: number
}

/* CARTO 的 basemaps.cartocdn.com 免 Key 公共底图；真正的 CARTO 矢量 API 才要 Key。
   这里做成通用模板：{key} 占位符 + 自定义 URL，谁的 Key 都能塞进来。 */
export const BASEMAPS: Basemap[] = [
  {
    id: 'osm-dark', name: 'OSM 中文 · 深色',
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    attr: '&copy; OpenStreetMap contributors', dark: true, maxZoom: 19
  },
  {
    id: 'osm', name: 'OSM 中文 · 浅色',
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    attr: '&copy; OpenStreetMap contributors', maxZoom: 19
  },
  {
    id: 'dark', name: 'CARTO Dark（需 Key）',
    url: 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png',
    attr: '&copy; OpenStreetMap &copy; CARTO', carto: true, needKey: true
  },
  {
    id: 'light', name: 'CARTO Positron（需 Key）',
    url: 'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png',
    attr: '&copy; OpenStreetMap &copy; CARTO', carto: true, needKey: true
  },
  {
    id: 'voyager', name: 'CARTO Voyager（需 Key）',
    url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attr: '&copy; OpenStreetMap &copy; CARTO', carto: true, needKey: true
  },
  {
    id: 'esri', name: 'Esri 影像（无地名）',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: 'Imagery &copy; Esri, Maxar, Earthstar Geographics', maxZoom: 19
  },
  {
    id: 'tdt-vec', name: '天地图 矢量（需 tk）',
    url: 'https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={key}',
    attr: '&copy; 天地图', needKey: true
  },
  {
    id: 'tdt-img', name: '天地图 影像（需 tk）',
    url: 'https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={key}',
    attr: '&copy; 天地图', needKey: true
  },
  { id: 'custom', name: '自定义 URL', url: '', attr: '&copy; 自定义底图' }
]

/* 默认 OSM 标准瓦片：地名就是中文（CARTO/Esri 自带英文标注）。
   深色项靠给瓦片层加一层反相滤镜压暗，保持和界面同一套深色气质。 */
export const MAPCFG = { style: 'osm-dark', url: '', key: '', v: 2 }

/* 注意读取时机：这里以前是「模块一 import 就跑」，那时 IndexedDB 还没水合，
   Store 的内存镜像还是空的 → 读到的永远是默认值（用户填的 CARTO Key / 选的底图在冷启动后集体消失）。
   现在只在 Store 就绪后由 initPrefs() 调用；没水合时不许写默认值，免得把库里的真配置盖掉。 */
export function loadMapCfg() {
  try {
    const raw = Store.getItem('lc:map')
    if (!raw) {
      /* 没读到不代表没有：水合还没完成时不许写默认值，否则会把库里的真配置盖掉 */
      if (Store.loaded) { MAPCFG.v = 2; saveMapCfg() }
      return
    }
    const o = JSON.parse(raw)
    if (o.style) MAPCFG.style = o.style
    MAPCFG.url = o.url || ''
    MAPCFG.key = o.key || ''
    // v<2：老版本默认 CARTO Dark（英文标注）。只有没主动改成过别的底图的人，才跟着换成中文底图
    if (!o.v || o.v < 2) {
      if (o.style === 'dark' || !o.style) MAPCFG.style = 'osm-dark'
      MAPCFG.v = 2
      saveMapCfg()
    }
  } catch { /* 用默认 */ }
}

export function saveMapCfg() {
  try { Store.setItem('lc:map', JSON.stringify(MAPCFG)); Store.flush() } catch { /* 忽略 */ }
}

export function basemapById(id: string): Basemap {
  for (let i = 0; i < BASEMAPS.length; i++) if (BASEMAPS[i].id === id) return BASEMAPS[i]
  return BASEMAPS[0]
}

export function resolveTileUrl(): string {
  const b = basemapById(MAPCFG.style)
  const tpl = MAPCFG.style === 'custom' ? (MAPCFG.url || '') : b.url
  if (!tpl) return ''
  const key = MAPCFG.key || ''
  let out = tpl.replace(/\{key\}/g, encodeURIComponent(key)).replace(/\{s\}/g, 'a')
  // CARTO Basemaps 现在 PNG 底图会打水印，带上 ?key= 才去掉（官方说法：参数名就是 key）
  if (b.carto && key && out.indexOf('{key}') < 0 && out.indexOf('key=') < 0) {
    out += (out.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent(key)
  }
  return out
}

export function mapAttribution(): string {
  return basemapById(MAPCFG.style).attr || '&copy; OpenStreetMap'
}
