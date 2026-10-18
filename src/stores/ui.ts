/* LureCast · 轻量 UI 状态（P2）：当前页签、哪个弹窗开着、是否在地图上取点。
   P1 时页签是 App.vue 的局部 ref，现在有多处（定位卡「找水域」、地图选点）要联动，
   挪到 store 里，避免 prop 一层层往下传。 */
import { defineStore } from 'pinia'

export type Tab = 'summary' | 'spots' | 'sat' | 'me'
export type ModalName = '' | 'findWater' | 'share'
export const useUiStore = defineStore('ui', {
  state: () => ({
    tab: 'summary' as Tab,
    modal: '' as ModalName,
    /* 在地图上取点：true 时点地图只回坐标，不改当前位置 */
    pickMode: false,
    /* 取到点后回调（弹窗那边挂的） */
    pickCb: null as null | ((lat: number, lon: number) => void)
  }),
  actions: {
    openModal(name: ModalName) { this.modal = name },
    closeModal() {
      this.modal = ''
      this.pickMode = false
      this.pickCb = null
    },
    setTab(t: Tab) {
      this.tab = t
      if (t !== 'spots' && this.pickMode) { this.pickMode = false; this.pickCb = null }
    },
    /* 进入「在地图上选点」：切到钓点页并让地图进入取点模式 */
    startPickOnMap(cb: (lat: number, lon: number) => void) {
      this.pickCb = cb
      this.pickMode = true
      this.modal = ''
      this.tab = 'spots'
    },
    finishPick(lat: number, lon: number) {
      const cb = this.pickCb
      this.pickMode = false
      this.pickCb = null
      if (cb) cb(lat, lon)
    }
  }
})
