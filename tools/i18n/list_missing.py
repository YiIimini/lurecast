# -*- coding: utf-8 -*-
"""列出 visible.json 里还没有英文的条目（写进 tools/i18n/missing.txt 供人工翻）"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from en import EN  # noqa: E402

vis = json.load(open(os.path.join(HERE, "visible.json"), encoding="utf-8"))
texts = set(vis["texts"])
attrs = set(vis["attrs"])
phrases = {p for p in vis["phrases"] if p not in texts}   # 只留「被切开」的整句

need = sorted((texts | attrs | phrases) - set(EN))
have = sorted(set(EN) - (texts | attrs | phrases))
print("已有词条", len(EN), "| 待翻", len(need), "| 表里多出（可保留）", len(have))
with open(os.path.join(HERE, "missing.txt"), "w", encoding="utf-8") as f:
    for s in need:
        f.write(s + "\n")
for s in need:
    print("  ", s.encode("ascii", "backslashreplace").decode()[:120])
