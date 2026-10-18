/* LureCast · Agent 桥（P4）
   ---------------------------------------------------------------------------
   老壳的 agent.js 通过 window.LureCast.state（一个巨大的 S 对象）与 window.LureCast.xxx
   这些动作函数跟界面打交道。新壳里这些状态分在几个 Pinia store，所以这里做一层适配：
     · state 用 Proxy 现取现拼（agent 每次 st() 拿到的是实时值，不是快照）；
     · 动作函数映射到 store action / 组件里注入的 loadAt。
   工具调用（setMe / setWaterType / setSpecies / applyTab / refresh）语义与老壳一致。 */
import { CFG } from './cfg'
import { toast } from './ui'
import type { useEnvStore } from '../stores/env'
import type { useSpotsStore } from '../stores/spots'
import type { useUiStore } from '../stores/ui'
import type { useMyStore } from '../stores/my'

type Deps = {
  env: ReturnType<typeof useEnvStore>
  spots: ReturnType<typeof useSpotsStore>
  ui: ReturnType<typeof useUiStore>
  my: ReturnType<typeof useMyStore>
  loadAt: (lat: number, lon: number, force?: boolean, source?: 'manual' | 'url' | 'gps') => void
}

const MODAL_MAP: Record<string, string> = {
  modalAgent: 'agent',
  modalSettings: 'settings',
  modalManual: 'findWater',
  modalShare: 'share'
}

export function createLcBridge(deps: Deps) {
  const { env, spots, ui, my, loadAt } = deps

  /* 老壳 S 对象的字段名 ← 新壳 store 字段 */
  function snapshot(): any {
    return {
      me: env.me,
      place: env.place,
      placeHint: env.placeHint,
      wx: env.wx,
      sea: env.sea,
      flood: env.flood,
      bodies: spots.bodies,
      pickBodies: spots.pickBodies,
      cands: spots.cands,
      spots: spots.spots,
      terrain: spots.terrain,
      env: env.env,
      curve: env.curve,
      windows: env.windows,
      water: env.water,
      waterAuto: env.waterAuto,
      waterType: env.waterType,
      species: env.species,
      tab: ui.tab,
      navTarget: spots.navTarget,
      sat: spots.satAnomalies && spots.satAnomalies.length
        ? { anomalies: spots.satAnomalies }
        : null,
      tzOffset: env.tzOffset,
      nowMs: env.nowMs,
      waterTemp: env.waterTemp,
      loading: env.loading || spots.loading,
      /* 助手回答里会提到「本机存的渔获/常用地点」 */
      fav: my.favorites,
      catches: my.catches
    }
  }

  const state = new Proxy({}, {
    get(_t, key: string) { return snapshot()[key] },
    has(_t, key: string) { return key in snapshot() },
    ownKeys() { return Reflect.ownKeys(snapshot()) },
    getOwnPropertyDescriptor(_t, key: string) {
      return { configurable: true, enumerable: true, value: snapshot()[key] }
    }
  })

  return {
    state,
    cfg: CFG,
    toast,
    renderAll() { /* Vue 是响应式的，不需要手动重画 */ },
    openModal(name: string) { ui.openModal((MODAL_MAP[name] || name) as any) },
    closeModal() { ui.closeModal() },
    applyTab(name: any) { ui.setTab(name) },
    setMe(lat: number, lon: number, _acc: any, label: any, source?: string) {
      env.placeHint = label || null
      env.load(lat, lon, false, source === 'gps' ? 'gps' : 'manual')
      spots.load(lat, lon)
    },
    setWaterType(t: any) { env.setWaterType(t) },
    setSpecies(id: string) { env.setSpecies(id) },
    refresh(force?: boolean) {
      if (!env.me) return
      loadAt(env.me.lat, env.me.lon, force !== false)
    }
  }
}
