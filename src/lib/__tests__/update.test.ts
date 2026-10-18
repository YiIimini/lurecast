/* 检查更新的解析测试（P4）
   ---------------------------------------------------------------------------
   fetchUpdate 只做「拉 JSON → 判版本」这件事，最适合打桩测。
   覆盖三种返回形态与三种结论：
     · 自己的 version.json（build/apk/notes）
     · GitHub Release（tag_name / assets[].browser_download_url / body）
     · 缺字段、HTTP 失败 → error（不能静默说「已是最新」） */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentBuildNo, fetchUpdate } from '../update'

const g: any = globalThis

beforeEach(() => {
  vi.restoreAllMocks()
})

function mockJson(body: any, ok = true, status = 200) {
  g.fetch = vi.fn(() => Promise.resolve({
    ok, status, json: () => Promise.resolve(body)
  }))
}

describe('fetchUpdate', () => {
  it('version.json：build 更大 → newer，带上 apk 与 notes', async () => {
    const cur = currentBuildNo()
    mockJson({ build: cur + 5, apk: 'https://x/LureCast.apk', notes: '修了贴图', url: 'https://x/release' })
    const r: any = await fetchUpdate('https://x/version.json')
    expect(r.kind).toBe('newer')
    expect(r.build).toBe(cur + 5)
    expect(r.apk).toBe('https://x/LureCast.apk')
    expect(r.notes).toContain('贴图')
  })

  it('version.json：build ≤ 当前 → latest', async () => {
    mockJson({ build: currentBuildNo(), apk: 'https://x/a.apk' })
    const r: any = await fetchUpdate('https://x/version.json')
    expect(r.kind).toBe('latest')
    expect(r.build).toBe(currentBuildNo())
  })

  it('GitHub Release：从 tag_name 取版本、从 assets 里挑 .apk', async () => {
    const cur = currentBuildNo()
    mockJson({
      tag_name: 'r' + (cur + 3),
      body: '这次改了水族馆',
      html_url: 'https://github.com/o/r/releases/tag/x',
      assets: [
        { name: 'LureCast-notes.txt', browser_download_url: 'https://x/notes.txt' },
        { name: 'LureCast.apk', browser_download_url: 'https://x/LureCast.apk' }
      ]
    })
    const r: any = await fetchUpdate('https://api.github.com/repos/o/r/releases/latest')
    expect(r.kind).toBe('newer')
    expect(r.build).toBe(cur + 3)
    expect(r.apk).toBe('https://x/LureCast.apk')
    expect(r.notes).toContain('水族馆')
  })

  it('缺 build/apk → error（不能假装已是最新）', async () => {
    mockJson({ hello: 'world' })
    const r: any = await fetchUpdate('https://x/version.json')
    expect(r.kind).toBe('error')
    expect(r.message).toContain('build')
  })

  it('HTTP 失败 → error 带状态码', async () => {
    mockJson({}, false, 404)
    const r: any = await fetchUpdate('https://x/version.json')
    expect(r.kind).toBe('error')
    expect(r.message).toContain('404')
  })

  it('网络异常 → error 而不是抛出去', async () => {
    g.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    const r: any = await fetchUpdate('https://x/version.json')
    expect(r.kind).toBe('error')
    expect(r.message).toContain('offline')
  })
})
