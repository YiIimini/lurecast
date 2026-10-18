/* Deeper 声呐 CSV 解析测试（P4）
   ---------------------------------------------------------------------------
   按 docs/DEEPER-SONAR.md 里核实过的真实格式造样本：
     · Quest bathymetry.csv：无表头 4 列 / 5 列（含温度）
     · 手机 scan_data_*.csv：有表头、`longtitude` 拼写、坐标列大量空白
   这些坑都是实测踩出来的，测试把它们钉死，别再退回去。 */
import { describe, expect, it } from 'vitest'
import { Deeper } from '../deeper'

const T0 = 1760000000            // 秒级时间戳（Deeper 导出单位）

/* 老壳的 parseText(text, opts) 第二参必填，这里给个默认值省得每处都写 */
const P = (text: string, opts: any = {}) => Deeper.parseText(text, opts)

/* 无表头 5 列的真实列序：lat,lon,depth,temp,time（由 1125 行真实导出核实过） */
function rowNoHeader(i: number, lat = 30.25, lon = 120.15, depth = 5, temp = 18) {
  return [lat + i * 1e-5, lon + i * 1e-5, depth, temp, T0 + i].join(',')
}

/* 无表头 4 列（旧固件）：lat,lon,depth,time */
function row4(i: number, lat = 30.25, lon = 120.15, depth = 7) {
  return [lat + i * 1e-5, lon, depth, T0 + i].join(',')
}

describe('Deeper.parseText — Quest 无表头', () => {
  it('5 列（含温度）：能解析出深度/温度，深度加换能器吃水', () => {
    const text = Array.from({ length: 10 }, (_, i) => rowNoHeader(i)).join('\n')
    const r: any = P(text)
    expect(r.rowsTotal).toBe(10)
    expect(r.cols).toBe(5)
    expect(r.hadHeader).toBe(false)
    expect(r.fixes.length).toBe(10)
    // depth 5 + 默认吃水 0.15
    expect(r.fixes[0].depthM).toBeCloseTo(5.15, 2)
    expect(r.fixes[0].tempC).toBe(18)
    expect(r.fixes[0].gpsOk).toBe(true)
    // 秒级时间戳被换算成毫秒
    expect(r.fixes[0].tMs).toBeGreaterThan(1e12)
  })

  it('4 列（旧固件）：没有温度列，温度记为 null', () => {
    const text = Array.from({ length: 5 }, (_, i) => row4(i)).join('\n')
    const r: any = P(text)
    expect(r.cols).toBe(4)
    expect(r.fixes[0].depthM).toBeCloseTo(7.15, 2)
    expect(r.fixes[0].tempC).toBeNull()
  })

  it('温度哨兵：0.0（无读数）与 >40℃（出水暴晒）都不算真实水温', () => {
    const rows = [
      rowNoHeader(0, 30.25, 120.15, 5, 0),
      rowNoHeader(1, 30.26, 120.16, 6, 45),
      rowNoHeader(2, 30.27, 120.17, 7, 19)
    ]
    const r: any = P(rows.join('\n'))
    expect(r.fixes[0].tempC).toBeNull()
    expect(r.fixes[1].tempC).toBeNull()
    expect(r.fixes[2].tempC).toBe(19)
  })

  it('换能器吃水可调', () => {
    const text = Array.from({ length: 3 }, (_, i) => rowNoHeader(i)).join('\n')
    const r: any = P(text, { transducerOffsetM: 0.5 })
    expect(r.fixes[0].depthM).toBeCloseTo(5.5, 2)
    expect(r.depthOffsetM).toBe(0.5)
  })
})

describe('Deeper.parseText — 手机 App 有表头', () => {
  const HEADER = 'time,latitude,longtitude,depth,temperature'   // Deeper 的拼写（列名 time / longtitude）

  it('认 longtitude 拼写；坐标空白的行保留为「无定位」但不判脏', () => {
    const lines = [HEADER]
    // 15 条深度采样，只有 3 条带坐标（真实比例就长这样）
    for (let i = 0; i < 15; i++) {
      const withGps = i % 5 === 0
      lines.push([
        T0 + i,
        withGps ? (30.25 + i * 1e-5).toFixed(6) : '',
        withGps ? (120.15 + i * 1e-5).toFixed(6) : '',
        (4 + i * 0.1).toFixed(2),
        '17.5'
      ].join(','))
    }
    const r: any = P(lines.join('\n'))
    expect(r.hadHeader).toBe(true)
    expect(r.rowsTotal).toBe(15)
    expect(r.rowsSkipped).toBe(0)              // 空坐标不算脏
    expect(r.fixes.length).toBe(15)
    expect(r.zeroGps).toBe(12)
    expect(r.fixes.filter((f: any) => f.gpsOk).length).toBe(3)
  })

  it('longitude 正常拼写也认', () => {
    const text = ['time,latitude,longitude,depth', `${T0},30.25,120.15,5`, `${T0 + 1},30.26,120.16,6`].join('\n')
    const r: any = P(text)
    expect(r.fixes.length).toBe(2)
    expect(r.fixes[0].lon).toBeCloseTo(120.15, 4)
  })
})

describe('Deeper.parseText — 错误码', () => {
  it('根本不是 Deeper（表头里有别的词、无数字）→ NOT_DEEPER / NO_ROWS', () => {
    let code = ''
    try { P('time,foo,bar\n1,2,3') } catch (e: any) { code = e.code }
    expect(['NOT_DEEPER', 'NO_ROWS']).toContain(code)
  })

  it('残包（只有 1 行）→ STUB_FILE', () => {
    let code = ''
    try { P(rowNoHeader(0)) } catch (e: any) { code = e.code }
    expect(code).toBe('STUB_FILE')
  })

  it('≥100 行且脏行 >1% → MALFORMED；短文件不被比例判定误杀', () => {
    // 短文件：2 行有效 + 1 行脏 = 33%，不应报错
    const short = [rowNoHeader(0), 'garbage,here', rowNoHeader(1)].join('\n')
    expect(() => P(short)).not.toThrow()

    // 长文件：120 行里塞 5 行脏 → 4% > 1%
    const rows: string[] = []
    for (let i = 0; i < 115; i++) rows.push(rowNoHeader(i))
    for (let i = 0; i < 5; i++) rows.push('x,y,z,w,v')
    let code = ''
    try { P(rows.join('\n')) } catch (e: any) { code = e.code }
    expect(code).toBe('MALFORMED')
  })

  it('全是 0/0 坐标 → NO_GPS（不是把点画到几内亚湾）', () => {
    const rows = Array.from({ length: 6 }, (_, i) => [0, 0, 5, 18, T0 + i].join(','))
    let code = ''
    try { P(rows.join('\n')) } catch (e: any) { code = e.code }
    expect(code).toBe('NO_GPS')
  })
})
