/* LureCast · 「我的」数据层（P3）—— 由 assets/my.js 的常用地点 / 渔获 / 档案导入导出搬运
   ------------------------------------------------------------------------------------
   只存本机：lc:fav（常用地点）、lc:catches（渔获，含压缩到 480px 的 JPEG data URL）。
   水族馆的 canvas 绘制（my.js 里 1100 行）还没搬，留到 P3b；这里只提供它要的 unlocked。
   不引第三方库：档案是手写 ZIP（stored）的 .zip，任何解压软件都能打开里面的 JSON。
   卫星/Agent/分享不在这层。 */
import { defineStore } from 'pinia'
import { Store } from '../lib/store'
import { toast, confirmBox, alertBox } from '../lib/ui'
import { SPECIES_DB, type Species } from '../lib/species'
import { Engine as E } from '../lib/engine'
import { zipBuild, zipRead, b64FromBytes } from '../lib/zip'
import { useEnvStore } from './env'
import { useSpotsStore } from './spots'

const KEY_FAV = 'lc:fav'
const KEY_CATCH = 'lc:catches'
const MAX_PHOTO_PX = 480
const PHOTO_Q = 0.72
const MAX_CATCHES = 80

export type Place = {
  id: string
  name: string
  desc: string
  lat: number
  lon: number
  at: number
  photos: string[]
}

export type Catch = {
  id: string
  sp: string
  sizeCm: number | null
  note: string
  at: number
  lat: number | null
  lon: number | null
  place: string
  weather: { temp: number | null; wind: number | null; press: number | null; score: number | null }
  photo: string | null
  photos: string[]
  photoCount: number
}

function read<T>(key: string, dft: T): T {
  try {
    const raw = Store.getItem(key)
    return raw ? (JSON.parse(raw) as T) : dft
  } catch { return dft }
}

function write(key: string, val: any): boolean {
  try { Store.setItem(key, JSON.stringify(val)); return true } catch { return false }
}

export function fmtDate(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => (n < 10 ? '0' + n : String(n))
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

/* 照片压到 480px JPEG：手机原图 3–8 MB，直接进 IndexedDB 很快就满 */
export function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读不到这张图'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('图片解析失败'))
      img.onload = () => {
        const scale = Math.min(1, MAX_PHOTO_PX / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) { reject(new Error('画布不可用')); return }
        ctx.drawImage(img, 0, 0, w, h)
        try { resolve(c.toDataURL('image/jpeg', PHOTO_Q)) } catch (e) { reject(e) }
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/* ZIP 实现在 lib/zip.ts（纯函数，能在 node 单测里直接验）；这里只管业务语义 */
export const useMyStore = defineStore('my', {
  state: () => ({
    favorites: [] as Place[],
    catches: [] as Catch[],
    /* 渔获保存前临时挂着的照片（拍照/相册选完先进这里） */
    pending: null as null | { photos: string[] },
    loaded: false
  }),

  getters: {
    /* 已解锁鱼种：每种只留最新一条，水族馆用它决定画哪些鱼 */
    unlocked(state): Record<string, Catch> {
      const m: Record<string, Catch> = {}
      state.catches.forEach((r) => { if (!m[r.sp]) m[r.sp] = r })
      return m
    },
    unlockedCount(): number { return Object.keys(this.unlocked).length },
    totalSpecies(): number { return SPECIES_DB.length },
    /* 按当前水域/水温给 3 个推荐鱼种（本地不做 AI 识别，只做「智能建议」） */
    suggested(): Species[] {
      const env = useEnvStore()
      const spots = useSpotsStore()
      const isSalt = env.waterAuto === 'sea' || !!(spots.spots[0] && spots.spots[0].kind === 'sea')
      const wt = env.waterTemp
      return SPECIES_DB.map((sp) => {
        let v = 0
        if (isSalt && sp.water === 'salt') v += 40
        if (!isSalt && sp.water === 'fresh') v += 40
        if (sp.water === 'both') v += 20
        if (wt != null && wt >= sp.season[0] && wt <= sp.season[1]) v += 30
        if (sp.region === 'cn') v += 8
        return { sp, v }
      }).sort((a, b) => b.v - a.v).slice(0, 3).map((x) => x.sp)
    }
  },

  actions: {
    load() {
      this.favorites = read<Place[]>(KEY_FAV, [])
      this.catches = read<Catch[]>(KEY_CATCH, [])
      this.loaded = true
    },

    speciesOf(id: string): Species | undefined {
      return SPECIES_DB.filter((s) => s.id === id)[0]
    },

    /* ------------------------------------------------------------ 常用地点 */
    defaultPlaceName(): string {
      const env = useEnvStore()
      const p = env.place || {}
      return env.placeHint || p.name ||
        ('位置 ' + (env.me ? env.me.lat.toFixed(3) + ',' + env.me.lon.toFixed(3) : ''))
    },

    savePlace(input: { idx: number; name: string; desc: string; lat: number; lon: number; photos: string[] }) {
      const name = (input.name || '').trim()
      if (!name) return false
      const list = this.favorites.slice()
      if (input.idx >= 0 && list[input.idx]) {
        const f = list[input.idx]
        f.name = name.slice(0, 24)
        f.desc = (input.desc || '').slice(0, 240)
        f.photos = input.photos.slice(0, 6)
      } else {
        list.unshift({
          id: 'f' + Date.now(), name: name.slice(0, 24), desc: (input.desc || '').slice(0, 240),
          lat: input.lat, lon: input.lon, at: Date.now(), photos: input.photos.slice(0, 6)
        })
      }
      this.favorites = list.slice(0, 30)
      write(KEY_FAV, this.favorites)
      toast(input.idx >= 0 ? '钓点已更新' : '已存为常用地点')
      return true
    },

    async deletePlace(idx: number) {
      const f = this.favorites[idx]
      if (!f) return
      const ok = await confirmBox('删除常用地点「' + f.name + '」？', { title: '删除地点', danger: true, okText: '删除' })
      if (!ok) return
      const list = this.favorites.slice()
      list.splice(idx, 1)
      this.favorites = list
      write(KEY_FAV, list)
      toast('已删除')
    },

    /* 120 米内算同一个点，避免把家常位置存两遍 */
    isPlaceSaved(lat: number, lon: number): boolean {
      return this.favorites.some((f) => (E.dist({ lat, lon } as any, f as any) as number) < 120)
    },

    /* ------------------------------------------------------------ 渔获 */
    async saveCatch(input: { sp: string; sizeCm?: string | number | null; note?: string | null }) {
      const sp = this.speciesOf(input.sp)
      if (!sp) { await alertBox('先选一个鱼种再保存。', { title: '还没选鱼种' }); return false }
      const env = useEnvStore()
      const cur = ((env.wx as any)?.data?.current) || {}
      const photos = (this.pending && this.pending.photos) || []
      const rec: Catch = {
        id: 'c' + Date.now(),
        sp: sp.id,
        sizeCm: input.sizeCm ? Number(input.sizeCm) : null,
        note: (input.note || '').slice(0, 80),
        at: Date.now(),
        lat: env.me ? +env.me.lat.toFixed(5) : null,
        lon: env.me ? +env.me.lon.toFixed(5) : null,
        place: env.placeHint || ((env.place && (env.place as any).name) || ''),
        weather: {
          temp: cur.temperature_2m != null ? Math.round(cur.temperature_2m * 10) / 10 : null,
          wind: cur.wind_speed_10m != null ? Math.round(cur.wind_speed_10m) : null,
          press: cur.pressure_msl != null ? Math.round(cur.pressure_msl * 10) / 10 : null,
          score: env.env ? env.env.score : null
        },
        photo: photos[0] || null,
        photos: photos.slice(),
        photoCount: photos.length
      }
      const list = this.catches.slice()
      list.unshift(rec)
      while (list.length > MAX_CATCHES) list.pop()
      // 存不下就把最老的照片丢掉再试（老壳同款策略）
      let ok = write(KEY_CATCH, list)
      for (let i = list.length - 1; !ok && i >= 0; i--) {
        if (list[i] && list[i].photo) { list[i] = Object.assign({}, list[i], { photo: null }); ok = write(KEY_CATCH, list) }
      }
      if (!ok) { await alertBox('本机存储已满，建议先删几条旧记录。', { title: '存不下了' }); return false }
      this.catches = list
      this.pending = null
      toast('已保存并解锁「' + sp.zh + '」')
      return true
    },

    async deleteCatch(idx: number) {
      const r = this.catches[idx]
      if (!r) return false
      const sp = this.speciesOf(r.sp)
      const ok = await confirmBox('删除这条「' + (sp ? sp.zh : r.sp) + '」记录？删了就找不回来。',
        { title: '删除渔获', danger: true, okText: '删除' })
      if (!ok) return false
      const list = this.catches.slice()
      list.splice(idx, 1)
      this.catches = list
      write(KEY_CATCH, list)
      toast('已删除')
      return true
    },

    /* ------------------------------------------------------------ 档案导出 / 导入 */
    buildArchive() {
      return {
        app: 'LureCast', v: 1, exportedAt: new Date().toISOString(),
        favorites: this.favorites, catches: this.catches
      }
    },

    exportArchive() {
      const data = this.buildArchive()
      const enc = new TextEncoder()
      const name = 'lurecast-backup-' + new Date().toISOString().slice(0, 10) + '.zip'
      const entries = [
        {
          name: 'manifest.json', data: enc.encode(JSON.stringify({
            app: 'LureCast', v: 2, exportedAt: new Date().toISOString(),
            counts: { catches: data.catches.length, favorites: data.favorites.length }
          }, null, 2))
        },
        { name: 'catches.json', data: enc.encode(JSON.stringify(data.catches)) },
        { name: 'favorites.json', data: enc.encode(JSON.stringify(data.favorites)) },
        {
          name: 'README.txt', data: enc.encode(
            'LureCast 数据备份\n\n' +
            'catches.json  渔获档案（含照片，data URL 内联）\n' +
            'favorites.json 常用地点（含描述与照片）\n\n' +
            '恢复方式：打开 App → 我的 → 渔获档案 → 导入档案，选这个 zip。\n')
        }
      ]
      const bytes = zipBuild(entries)
      const summary = { name, bytes: bytes.length, records: data.catches.length, places: data.favorites.length }

      const cap = (window as any).Capacitor
      const FS = cap && cap.Plugins && cap.Plugins.Filesystem
      const SH = cap && cap.Plugins && cap.Plugins.Share
      if (FS && SH && cap.isNativePlatform && cap.isNativePlatform()) {
        FS.writeFile({ path: name, data: b64FromBytes(bytes), directory: 'CACHE' })
          .then((w: any) => SH.share({ title: 'LureCast 数据备份', url: w.uri }))
          .catch((e: any) => {
            // 用户在系统分享面板点返回是正常操作，不算失败
            const msg = e && (e.message || e.errorMessage) ? (e.message || e.errorMessage) : String(e)
            if (/cancel|取消|abort/i.test(msg)) return
            alertBox('导出失败：' + msg, { title: '导出失败' })
          })
        return summary
      }
      try {
        const blob = new Blob([bytes as any], { type: 'application/zip' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name
        document.body.appendChild(a)
        a.click()
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 5000)
        toast('已导出 ' + name)
      } catch (e: any) {
        alertBox('导出失败：' + e.message, { title: '导出失败' })
      }
      return summary
    },

    /* 合并导入：按 id 去重，冲突保留较新的那条 */
    importArchive(payload: any) {
      const data = typeof payload === 'string' ? JSON.parse(payload) : payload
      if (!data || (!Array.isArray(data.catches) && !Array.isArray(data.favorites))) {
        throw new Error('不是 LureCast 的档案文件')
      }
      const incoming = (data.catches || []).filter((r: any) => r && r.id)
      const cur = this.catches.slice()
      let added = 0, updated = 0
      /* 注意：老壳这里写的是 `byId[r.id] = r`——只改了索引表、没换掉 cur 里的那条，
         于是「更新 N 条」的数字是假的（记录内容其实没被覆盖）。这里按索引替换，修掉它。 */
      incoming.forEach((r: any) => {
        const i = cur.findIndex((x) => x.id === r.id)
        if (i < 0) { cur.push(r); added++ }
        else if ((r.at || 0) > (cur[i].at || 0)) { cur[i] = r; updated++ }
      })
      cur.sort((a, b) => (b.at || 0) - (a.at || 0))
      const ok = write(KEY_CATCH, cur)
      if (!ok) throw new Error('本机存储已满，导入中断')
      this.catches = cur

      const favs = this.favorites.slice()
      let favAdded = 0
      ;(data.favorites || []).forEach((f: any) => {
        if (!f || f.lat == null) return
        const dup = favs.some((x) => (E.dist(x as any, f) as number) < 120 || x.name === f.name)
        if (!dup) { favs.push(f); favAdded++ }
      })
      this.favorites = favs.slice(0, 30)
      write(KEY_FAV, this.favorites)
      return { added, updated, total: cur.length, places: favAdded }
    },

    /* 从 File（.zip）导入 */
    async importFromFile(file: File) {
      const buf = new Uint8Array(await file.arrayBuffer())
      const files = zipRead(buf)
      const dec = new TextDecoder()
      const pick = (n: string) => {
        if (!files[n]) throw new Error('压缩包里缺少 ' + n)
        return JSON.parse(dec.decode(files[n]))
      }
      const payload = {
        catches: pick('catches.json'),
        favorites: files['favorites.json'] ? pick('favorites.json') : []
      }
      const res = this.importArchive(payload)
      toast('导入完成：新增 ' + res.added + ' 条，更新 ' + res.updated + ' 条，地点 +' + res.places)
      return res
    }
  }
})
