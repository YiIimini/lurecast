import { describe, expect, it } from 'vitest'
import { PATTERNS, PHRASES } from '../i18n-phrases'

/* 对照表是脚本生成的，最容易出的错是「繁体/英文列空着」「模板里的 $n 超过捕获组数」，
   两类错误在界面上都表现为「切了语言没反应」，肉眼很难发现，所以钉成单元测试。 */

/** 正则的捕获组个数：拼一个空分支，exec('') 必定命中，返回数组长度就是「组数 + 1」 */
function groupCount(re: RegExp): number {
  return new RegExp(re.source + '|').exec('')!.length - 1
}

describe('i18n 文案对照表', () => {
  it('每条都有繁体与英文，且不为空', () => {
    const bad = Object.keys(PHRASES).filter((zh) => {
      const row = PHRASES[zh]
      return !Array.isArray(row) || row.length !== 2 || !row[0] || !row[1]
    })
    expect(bad).toEqual([])
  })

  it('英文列不含中文（语言名这类故意保留的除外）', () => {
    const keep = new Set(['简体中文', '繁體中文', '简', '繁', 'OSM 中文 · 深色'])
    const bad = Object.keys(PHRASES).filter((zh) => !keep.has(zh) && /[\u4e00-\u9fff]/.test(PHRASES[zh][1]))
    expect(bad).toEqual([])
  })


  it('动态模板的 $n 都在捕获组范围内', () => {
    const bad: string[] = []
    PATTERNS.forEach(([re, hant, en]) => {
      const max = groupCount(re)
      for (const tpl of [hant, en]) {
        const used = (tpl.match(/\$(\d)/g) || []).map((s) => Number(s[1]))
        used.forEach((n) => { if (n > max) bad.push(re.source + ' → ' + tpl) })
      }
    })
    expect(bad).toEqual([])
  })
  it('每条动态模板都能匹配它服务的真实文案', () => {
    const samples: Array<[number, string]> = [
      [0, '0 / 25 种'],
      [1, '/ 25 种已解锁 · 共 0 条记录'],
      [2, '云量 2%'],
      [3, '水体占比 67%'],
      [4, '约 10 m/px'],
      [5, '86 分'],
      [6, '3 小时后'],
      [7, '30.2464, 120.1490 · 精度未知'],
      [9, '12 条记录']
    ]
    samples.forEach(([i, s]) => {
      expect(PATTERNS[i], 'PATTERNS[' + i + '] 不存在').toBeTruthy()
      expect(PATTERNS[i][0].test(s), PATTERNS[i][0].source + ' 匹配不上 ' + s).toBe(true)
    })
  })
})
