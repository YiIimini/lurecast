# 界面文案（简 / 繁 / EN）

`src/lib/i18n-phrases.ts` 是**自动生成**的对照表：key = 简体原文（就是代码/模板里写的那句），
值 = `[繁体, English]`。运行时 `src/lib/i18n.ts` 的 `applyDom()` 拿它替换 DOM 文本与
`placeholder/title/aria-label/data-tip/alt`，所以**不用给每处模板加 `t()`**。

## 改文案之后怎么做

```powershell
npm run build
python tools/i18n/collect_visible.py     # 真机渲染一遍，抓出所有可见中文 → visible.json
python tools/i18n/list_missing.py        # 看还差哪些英文（写进 missing.txt）
#   …把 missing.txt 里的新条目译好，补进 en.py…
python tools/i18n/gen_phrases.py         # 生成 src/lib/i18n-phrases.ts
npm test                                 # 会检查对照表完整性与动态模板
```

依赖：`python -m pip install opencc-python-reimplemented playwright`（繁体转换 + 抓页面）。
`collect_visible.py` 用系统 Chrome（`channel="chrome"`），不会另外下载浏览器。

## 文件

| 文件 | 作用 |
|---|---|
| `visible.json` | 抓下来的「页面上看得见的中文」快照：文本节点、属性、以及被 `<b>/<code>` 切开的整句 |
| `en.py` | 人工英文（dict：简体原文 → English），这是唯一需要手写的东西 |
| `gen_phrases.py` | 用 OpenCC `s2twp`（台湾正体 + 台港用词）补繁体列，生成 TS |
| `collect_visible.py` | Playwright 抓页面（四个页签 + 设置/助手弹窗） |
| `list_missing.py` | 列出还没英文的条目 |

## 两条容易踩的

- 文案里**不要写 `**加粗**`** 这种 markdown，模板里直接写 `<b>`。否则会被当成正文抓进对照表
  （`CardSonar` 就踩过一次，已改）。
- 带数字的动态文案（`云量 2%`、`0 / 25 种`）写成 `gen_phrases.py` 里 `PATTERNS` 的正则模板，
  不要塞进 `en.py` 当固定词条。
