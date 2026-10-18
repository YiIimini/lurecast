/* LureCast · 极简 ZIP（stored，无压缩）—— 由 assets/my.js 的 crc32/zipBuild/zipRead 机械迁移
   -----------------------------------------------------------------------------------------
   不引第三方库：自己写 local header + central directory，浏览器与安卓 WebView 都能用。
   导出的就是真正的 .zip，任何解压软件都能打开看到里面的 JSON。
   只支持 method=0（stored）——我们只往里塞 JSON 与 README，不需要压缩。
   放在 lib/ 而不是 store 里，是为了能在 node 单测里直接验证（不依赖 DOM/IndexedDB）。 */
/* ---------------------------------------------------------------- 极简 ZIP（stored） */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF]
  return (crc ^ 0xFFFFFFFF) >>> 0
}

export function zipBuild(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = []
  let offset = 0
  files.forEach((f) => {
    const name = enc.encode(f.name)
    const data = f.data
    const crc = crc32(data)
    const lh = new Uint8Array(30 + name.length)
    const dv = new DataView(lh.buffer)
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true)
    dv.setUint16(8, 0, true)
    dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true)
    dv.setUint16(26, name.length, true)
    lh.set(name, 30)
    parts.push(lh, data)
    central.push({ name, crc, size: data.length, offset })
    offset += lh.length + data.length
  })
  const cdStart = offset
  let cdSize = 0
  central.forEach((c) => {
    const rec = new Uint8Array(46 + c.name.length)
    const dv = new DataView(rec.buffer)
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true)
    dv.setUint16(8, 0x0800, true)
    dv.setUint32(16, c.crc, true); dv.setUint32(20, c.size, true); dv.setUint32(24, c.size, true)
    dv.setUint16(28, c.name.length, true)
    dv.setUint32(42, c.offset, true)
    rec.set(c.name, 46)
    parts.push(rec); cdSize += rec.length
  })
  const eocd = new Uint8Array(22)
  const dv2 = new DataView(eocd.buffer)
  dv2.setUint32(0, 0x06054b50, true)
  dv2.setUint16(8, central.length, true); dv2.setUint16(10, central.length, true)
  dv2.setUint32(12, cdSize, true); dv2.setUint32(16, cdStart, true)
  parts.push(eocd)
  let total = 0
  parts.forEach((x) => { total += x.length })
  const out = new Uint8Array(total)
  let pos = 0
  parts.forEach((x) => { out.set(x, pos); pos += x.length })
  return out
}

export function zipRead(buf: Uint8Array): Record<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const out: Record<string, Uint8Array> = {}
  const dec = new TextDecoder()
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const method = dv.getUint16(p + 10, true)
    const size = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commLen = dv.getUint16(p + 32, true)
    const lho = dv.getUint32(p + 42, true)
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen))
    if (method === 0) {
      const lnl = dv.getUint16(lho + 26, true), lex = dv.getUint16(lho + 28, true)
      const start = lho + 30 + lnl + lex
      out[name] = buf.subarray(start, start + size)
    }
    p += 46 + nameLen + extraLen + commLen
  }
  return out
}

export function b64FromBytes(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[])
  }
  return btoa(bin)
}