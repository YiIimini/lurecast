# -*- coding: utf-8 -*-
"""生成 src/lib/i18n-phrases.ts（简体原文 → [繁体, English]）

流程：
    npm run build
    python tools/i18n/collect_visible.py     # 抓页面上所有可见中文 → visible.json
    … 把 visible.json 里新出现的条目补进 tools/i18n/en.py（英文）…
    python tools/i18n/list_missing.py        # 看还差哪些
    python tools/i18n/gen_phrases.py         # 生成 src/lib/i18n-phrases.ts

繁体用 OpenCC 的 s2twp（台湾正体 + 台港用词），英文来自 en.py（人工翻）。
缺英文的条目会被跳过并列出来 —— 界面上表现为「这条还是中文」，不会崩。
"""
import json
import os
import sys

from opencc import OpenCC

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from en import EN  # noqa: E402

vis = json.load(open(os.path.join(HERE, "visible.json"), encoding="utf-8"))
texts = set(vis["texts"])
attrs = set(vis["attrs"])
phrases = {p for p in vis["phrases"] if p not in texts}   # 只留「被 inline 标签切开」的整句

cc = OpenCC("s2twp")
# 语言名/chip 本身就是各自语言的写法，别转
KEEP = {"简体中文", "繁體中文", "简", "繁"}

keys = sorted(texts | attrs | phrases | set(EN))           # EN 里多出来的（比如 PATTERNS 之外的补充）也保留
missing = [k for k in keys if k not in EN]
if missing:
    print("缺英文，已跳过（先补 tools/i18n/en.py）:")
    for m in missing:
        print("   ", m.encode("ascii", "backslashreplace").decode())


def esc(s):
    return s.replace("\\", "\\\\").replace("'", "\\'")


rows = []
for k in keys:
    en = EN.get(k)
    if en is None:
        continue
    rows.append((k, k if k in KEEP else cc.convert(k), en))

HEADER = """/* LureCast · 界面文案对照表（自动生成，勿手改）
   ---------------------------------------------------------------------------
   来源：tools/i18n/collect_visible.py 在真机上把四个页签 + 各弹窗渲染一遍，抓出所有可见中文
   （文本节点、属性、以及被 <b>/<code> 切开的整句），共 @@N@@ 条；英文在 tools/i18n/en.py。
   key = 简体原文，值 = [繁体, English]；繁体由 OpenCC(s2twp) 转出。
   地名与用户输入不在这张表里，所以不会被误翻。
   改文案后请重跑 tools/i18n/collect_visible.py → 补 en.py → gen_phrases.py。 */
export type Phrase = [string, string]

export const PHRASES: Record<string, Phrase> = {
"""

TAIL = r"""}

/* 带数字/单位的动态文案：源正则 → 繁体模板 → English 模板（$1/$2 是捕获组） */
export const PATTERNS: Array<[RegExp, string, string]> = [
  [/^(\d+) \/ (\d+) 种$/, '$1 / $2 種', '$1 / $2 species'],
  [/^\/ (\d+) 种已解锁 · 共 (\d+) 条记录$/, '/ $1 種已解鎖 · 共 $2 條記錄', '/ $1 species unlocked · $2 records'],
  [/^云量 (\d+)%$/, '雲量 $1%', 'Cloud $1%'],
  [/^水体占比 (\d+)%$/, '水體佔比 $1%', 'Water $1%'],
  [/^约 (\d+) m\/px$/, '約 $1 m/px', '~$1 m/px'],
  [/^(\d+) 分$/, '$1 分', '$1 pts'],
  [/^(\d+) 小时后$/, '$1 小時後', 'in $1 h'],
  [/^([\d.]+), ([\d.]+) · 精度未知$/, '$1, $2 · 精度未知', '$1, $2 · accuracy unknown'],
  [/^([\d.]+), ([\d.]+) · 已存常用地点$/, '$1, $2 · 已存常用地點', '$1, $2 · saved place'],
  [/^(\d+) 条记录$/, '$1 條記錄', '$1 records'],
  [/^水体占比 (\d+)% · 云 (\d+)%$/, ' 水體佔比 $1% · 雲 $2%', ' Water $1% · cloud $2%'],
  [/^手机朝 (\d+)°$/, '手機朝 $1°', 'phone faces $1°']
]
"""

out = os.path.join(ROOT, "src", "lib", "i18n-phrases.ts")
with open(out, "w", encoding="utf-8", newline="\n") as f:
    f.write(HEADER.replace("@@N@@", str(len(rows))))
    for k, hant, en in rows:
        f.write("  '%s': ['%s', '%s'],\n" % (esc(k), esc(hant), esc(en)))
    f.write(TAIL)
print("写出", out, len(rows), "条")
