/* 「我的」数据层测试（P3）
   ---------------------------------------------------------------------------
   重点钉住两件容易出错、又完全可以在 node 里验证的事：
     1. 手写 ZIP：build → read 必须能原样读回（含中文文件名与二进制），
        因为档案就是靠它跨设备搬的，坏了用户丢的是全部渔获。
     2. 合并导入语义：按 id 去重、冲突留较新、地点 120 m 内算重复。
   浏览器 API（DOM 弹窗）不在这层测。 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { zipBuild, zipRead } from '../../lib/zip'
import { useMyStore } from '../my'

const enc = new TextEncoder()
const dec = new TextDecoder()

describe('档案 ZIP（stored，无压缩）', () => {
  it('写进去再读出来，内容与文件名完全一致', () => {
    const files = [
      { name: 'manifest.json', data: enc.encode('{"app":"LureCast","v":2}') },
      { name: 'catches.json', data: enc.encode('[{"id":"c1","sp":"bass"}]') },
      { name: 'README.txt', data: enc.encode('LureCast 数据备份\n中文也要能读回来') }
    ]
    const bytes = zipBuild(files)
    const back = zipRead(bytes)

    expect(Object.keys(back).sort()).toEqual(['README.txt', 'catches.json', 'manifest.json'])
    expect(dec.decode(back['README.txt'])).toContain('中文也要能读回来')
    expect(JSON.parse(dec.decode(back['catches.json']))[0].sp).toBe('bass')
  })

  it('二进制内容逐字节一致（照片 data URL 走这条路径）', () => {
    const bin = new Uint8Array(300)
    for (let i = 0; i < bin.length; i++) bin[i] = (i * 37 + 11) & 0xFF
    const back = zipRead(zipBuild([{ name: 'blob.bin', data: bin }]))
    expect(Array.from(back['blob.bin'])).toEqual(Array.from(bin))
  })

  it('不是 zip 就抛错（不能静默失败）', () => {
    expect(() => zipRead(enc.encode('this is not a zip'))).toThrow(/zip/)
  })
})

describe('合并导入', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('新增 + 冲突留较新 + 按时间倒序', () => {
    const my = useMyStore()
    my.load()
    my.favorites = []
    my.catches = []

    my.catches = [
      { id: 'a', sp: 'bass', sizeCm: 30, note: '', at: 1000, lat: null, lon: null, place: '', weather: {}, photo: null, photos: [], photoCount: 0 },
      { id: 'b', sp: 'topmouth', sizeCm: 40, note: '', at: 2000, lat: null, lon: null, place: '', weather: {}, photo: null, photos: [], photoCount: 0 }
    ] as any

    const res = my.importArchive({
      catches: [
        // a 的导入版本更旧 → 不该覆盖
        { id: 'a', sp: 'bass', at: 500, sizeCm: 12 },
        // b 的导入版本更新 → 应该覆盖
        { id: 'b', sp: 'topmouth', at: 9000, sizeCm: 55 },
        // 全新记录
        { id: 'c', sp: 'mandarin', at: 5000 }
      ],
      favorites: []
    })

    expect(res.added).toBe(1)
    expect(res.updated).toBe(1)
    expect(my.catches.length).toBe(3)
    const a = my.catches.filter((r) => r.id === 'a')[0]
    const b = my.catches.filter((r) => r.id === 'b')[0]
    expect(a.sizeCm).toBe(30)          // 旧的那条没覆盖进来
    expect(b.sizeCm).toBe(55)          // 新的那条覆盖了
    expect(my.catches[0].id).toBe('b') // 9000 最新，排最前
  })

  it('地点：120 m 内或同名算重复', () => {
    const my = useMyStore()
    my.load()
    my.favorites = []
    my.catches = []

    my.favorites = [
      { id: 'f1', name: '老钓点', desc: '', lat: 30.25, lon: 120.15, at: 1, photos: [] }
    ] as any

    const res = my.importArchive({
      catches: [],
      favorites: [
        { name: '旁边的点', lat: 30.2505, lon: 120.1505 }, // ~70 m 内
        { name: '老钓点', lat: 31.0, lon: 121.0 },          // 同名
        { name: '真正的新点', lat: 30.9, lon: 120.9 }
      ]
    })

    expect(res.places).toBe(1)
    expect(my.favorites.length).toBe(2)
    expect(my.favorites.some((f) => f.name === '真正的新点')).toBe(true)
  })

  it('不是 LureCast 档案就抛错', () => {
    const my = useMyStore()
    my.load()
    my.favorites = []
    my.catches = []

    expect(() => my.importArchive({ hello: 'world' })).toThrow(/LureCast/)
  })
})

describe('常用地点', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('保存 / 更新 / 120 米内判重', () => {
    const my = useMyStore()
    my.load()
    my.favorites = []
    my.catches = []

    expect(my.savePlace({ idx: -1, name: '  石堤  ', desc: '退潮能站人', lat: 30.25, lon: 120.15, photos: [] })).toBe(true)
    expect(my.favorites.length).toBe(1)
    expect(my.favorites[0].name).toBe('石堤')       // 去掉首尾空格
    expect(my.isPlaceSaved(30.2505, 120.1505)).toBe(true)

    // 改名：走 idx 更新，不新增
    my.savePlace({ idx: 0, name: '石堤（北）', desc: '', lat: 30.25, lon: 120.15, photos: [] })
    expect(my.favorites.length).toBe(1)
    expect(my.favorites[0].name).toBe('石堤（北）')

    // 空名字要拒绝
    expect(my.savePlace({ idx: -1, name: '   ', desc: '', lat: 1, lon: 2, photos: [] })).toBe(false)
  })
})
