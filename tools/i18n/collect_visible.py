# -*- coding: utf-8 -*-
"""抓「用户能看到的中文」→ tools/i18n/visible.json

用法（需要 Playwright + 系统 Chrome）：
    pip install playwright
    npm run build
    python tools/i18n/collect_visible.py

抓三类东西：
  1. 文本节点的整串（含动态数字，如「云量 2%」）；
  2. placeholder / title / aria-label / data-tip / alt；
  3. **元素级整句**：被 <b>/<code> 切开的句子（单独一个文本节点只是半句），
     这些元素会在 applyDom 里按「整个 textContent」匹配，所以要把整句也收进来。

会依次点开四个页签与设置/助手/分享弹窗，各抓一遍后合并去重。
"""
import functools
import http.server
import json
import os
import socketserver
import threading

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DIST = os.path.join(ROOT, "dist-web")
OUT = os.path.join(HERE, "visible.json")
PORT = 5199
URL = "http://127.0.0.1:%d/app.html?lat=30.2464&lon=120.1490" % PORT

CJK = "/[\\u4e00-\\u9fff]/"

COLLECT = """() => {
  const CJK = %s;
  const texts = new Set();     // 文本节点整串
  const phrases = new Set();   // 元素级整句（含被 inline 标签切开的）
  const attrs = new Set();
  const INLINE = new Set(['B','I','EM','STRONG','CODE','SPAN','A','BR','SMALL','SUP','SUB','U']);
  const hasCjkChild = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && CJK.test(n.textContent)) return true;
      if (n.nodeType === 1 && hasCjkChild(n)) return true;
    }
    return false;
  };
  const onlyInline = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 1 && !INLINE.has(n.tagName)) return false;
    }
    return true;
  };
  const walk = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) {
        const t = n.textContent.replace(/\\s+/g, ' ').trim();
        if (t && CJK.test(t)) texts.add(t);
      } else if (n.nodeType === 1) {
        if (['SCRIPT','STYLE'].includes(n.tagName)) continue;
        for (const a of ['placeholder','title','aria-label','data-tip','alt']) {
          const v = n.getAttribute && n.getAttribute(a);
          if (v && CJK.test(v)) attrs.add(v.replace(/\\s+/g, ' ').trim());
        }
        // 被 inline 标签切开的整句：子节点全是 inline、有多个文本节点、读起来是一句话
        // （带标点且够长——这样才排除掉「气压--hPa趋势未知」这种由多个字段拼出来的容器）
        if (n.childNodes.length > 1 && onlyInline(n) && hasCjkChild(n)) {
          const whole = n.textContent.replace(/\\s+/g, ' ').trim();
          const sentence = /[，。：；、!？,;:]/.test(whole);
          if (sentence && whole.length >= 20 && whole.length <= 400) phrases.add(whole);
        }
        walk(n);
      }
    }
  };
  walk(document.body);
  return { texts: [...texts], phrases: [...phrases], attrs: [...attrs] };
}""" % CJK

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIST)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

texts, phrases, attrs = set(), set(), set()
with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    page.goto(URL, wait_until="load")
    page.wait_for_timeout(4000)

    def grab(tag):
        got = page.evaluate(COLLECT)
        before = len(texts) + len(phrases) + len(attrs)
        texts.update(got["texts"]); phrases.update(got["phrases"]); attrs.update(got["attrs"])
        after = len(texts) + len(phrases) + len(attrs)
        print(f"  {tag}: +{after - before}（累计 {after}）")

    for i, name in enumerate(["结论", "钓点", "影像", "我的"]):
        page.evaluate("(i) => document.querySelectorAll('.tabs .tab')[i].click()", i)
        page.wait_for_timeout(1600)
        grab("页签 " + name)

    for icon in ["settings", "ai"]:
        opened = page.evaluate("""(icon) => {
          const el = document.querySelector('[data-icon="' + icon + '"]');
          if (!el) return false;
          el.closest('button').click(); return true;
        }""", icon)
        if not opened:
            continue
        page.wait_for_timeout(1400)
        grab("弹窗 " + icon)
        page.evaluate("""() => { const b = [...document.querySelectorAll('button')].find(x => /Close|关闭/.test(x.textContent)); if (b) b.click(); }""")
        page.wait_for_timeout(700)

    browser.close()
httpd.shutdown()

data = {"texts": sorted(texts), "phrases": sorted(phrases), "attrs": sorted(attrs)}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
print("写出", OUT, "| 文本", len(texts), "整句", len(phrases), "属性", len(attrs))
