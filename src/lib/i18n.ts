// @ts-nocheck
/* LureCast · 多语言（P4）—— 由 assets/i18n.js 机械迁移
   ---------------------------------------------------------------------------
   只翻译「界面骨架」：标签、卡片标题、按钮、图例、地图弹窗、状态文案。
   数据本身（地名、鱼种中文名）不翻译。新增语言只要往 LANGS 里加一列。
   与老壳一致：apply() 按 DOM id 回填文案，所以卡片壳体都保留了 id
   （cardLoc/cardScore/.../cardAqua），标题是 h2。
   新壳里 Vue 渲染的文字不会自动跟着变，切语言后调用一次 apply() 即可（与老壳行为一致）。 */
import { Store } from './store'
import { PHRASES, PATTERNS } from './i18n-phrases'
  var KEY = 'lc:lang';
  var LANGS = [
    { id: 'zh-Hans', name: '简体中文', short: '简' },
    { id: 'zh-Hant', name: '繁體中文', short: '繁' },
    { id: 'en', name: 'English', short: 'EN' }
  ];

  var DICT = {
    'tab.summary': ['结论', '結論', 'Verdict'],
    'tab.spots': ['钓点', '釣點', 'Spots'],
    'tab.sat': ['影像', '影像', 'Imagery'],
    'tab.me': ['我的', '我的', 'Mine'],

    'card.loc': ['当前位置与水域', '目前位置與水域', 'Location & water'],
    'card.score': ['鱼口指数', '魚口指數', 'Bite index'],
    'card.time': ['未来 24 小时', '未來 24 小時', 'Next 24 hours'],
    'card.weather': ['天气实况', '天氣實況', 'Weather now'],
    'card.wind': ['风况与迎风岸', '風況與迎風岸', 'Wind & windward bank'],
    'card.water': ['水位与水流', '水位與水流', 'Water level & flow'],
    'card.terrain': ['地形结构', '地形結構', 'Terrain structure'],
    'card.sat': ['历史影像 · 水下结构', '歷史影像 · 水下結構', 'Archive imagery · structure'],
    'card.spot': ['推荐钓点', '推薦釣點', 'Recommended spots'],
    'card.map': ['钓点分布', '釣點分佈', 'Spot map'],
    'card.factor': ['环境分是怎么来的', '環境分是怎麼來的', 'How the score is built'],
    'card.meta': ['数据来源与局限', '資料來源與侷限', 'Sources & limits'],
    'card.fav': ['常用地点', '常用地點', 'Saved places'],
    'card.catch': ['渔获档案 · 拍照解锁', '漁獲檔案 · 拍照解鎖', 'Catch log · photo unlock'],
    'card.aqua': ['我的水族馆', '我的水族館', 'My aquarium'],

    'btn.refresh': ['刷新', '重新整理', 'Refresh'],
    'btn.findWater': ['找水域', '找水域', 'Find water'],
    'btn.gps': ['用 GPS 定位', '用 GPS 定位', 'Use GPS'],
    'btn.savePlace': ['保存当前位置', '儲存目前位置', 'Save this place'],
    'btn.analyze': ['分析影像', '分析影像', 'Analyse'],
    'btn.reanalyze': ['重新分析', '重新分析', 'Re-analyse'],
    'btn.pickPhoto': ['拍照 / 选图', '拍照 / 選圖', 'Photo / pick'],
    'btn.exportArchive': ['导出数据包', '匯出資料包', 'Export archive'],
    'btn.importArchive': ['导入数据包', '匯入資料包', 'Import archive'],
    'btn.retrySpots': ['重新查询岸线', '重新查詢岸線', 'Retry shoreline'],

    'map.legend.me': ['你', '你', 'You'],
    'map.legend.fav': ['常用地点', '常用地點', 'Saved place'],
    'map.legend.hi': ['高分钓点', '高分釣點', 'High score'],
    'map.legend.mid': ['中等', '中等', 'Medium'],
    'map.legend.cand': ['候选岸线点', '候選岸線點', 'Shore samples'],
    'map.legend.water': ['水域', '水域', 'Water'],
    'map.legend.shoreRoute': ['岸钓路线', '岸釣路線', 'Shore route'],
    'map.legend.boatRoute': ['船钓直线', '船釣直線', 'Boat line'],
    'map.popup.me': ['你在这里', '你在這裡', 'You are here'],
    'map.popup.shore': ['岸钓路线（驾车/步行到岸边，OSRM 实际路网）', '岸釣路線（實際路網）', 'Shore route (real roads, OSRM)'],
    'map.popup.boat': ['船钓直线（水上直线，非实际航道）', '船釣直線（非實際航道）', 'Boat line (straight, not a channel)'],
  'map.pick.ask': ['把这里设为当前位置？', '把這裡設為目前位置？', 'Use this point as your location?'],
  'map.pick.set': ['设为当前位置', '設為目前位置', 'Set as my location'],

    'btn.share': ['分享', '分享', 'Share'],
    'share.title': ['分享与导航', '分享與導航', 'Share & navigate'],
    'share.amap': ['高德导航', '高德導航', 'Amap route'],
    'share.amapSub': ['驾车到点', '駕車到點', 'Drive there'],
    'share.baidu': ['百度导航', '百度導航', 'Baidu route'],
    'share.baiduSub': ['驾车到点', '駕車到點', 'Drive there'],
    'share.send': ['分享位置', '分享位置', 'Share location'],
    'share.sendSub': ['微信 / QQ 等', '微信 / QQ 等', 'WeChat, QQ, …'],
    'share.copy': ['复制坐标', '複製座標', 'Copy coordinates'],
    'share.copySub': ['WGS-84 + 高德', 'WGS-84 + 高德', 'WGS-84 + GCJ-02'],
    'share.ptNote': ['WGS-84 原始坐标 · 高德 / 百度在本机自动换算，不用手动纠偏',
      'WGS-84 原始座標 · 高德 / 百度在本機自動換算，不用手動糾偏',
      'Raw WGS-84 · Amap / Baidu converted on device'],
    'share.hint': ['坐标按 WGS-84（GPS 口径）保存；高德要 GCJ-02、百度要 BD-09，点按钮时自动换算。没装对应的地图 App 会自动改成打开网页版地图。',
      '座標按 WGS-84（GPS 口徑）保存；高德要 GCJ-02、百度要 BD-09，點按鈕時自動換算。沒裝對應的地圖 App 會自動改成打開網頁版地圖。',
      'Coordinates are stored as WGS-84. Amap needs GCJ-02 and Baidu BD-09 — converted on the fly. If the map app is missing it falls back to the web map.'],

    'status.loading': ['正在取数据…', '正在取資料…', 'Loading…'],
    'status.needGps': ['等待定位…', '等待定位…', 'Waiting for GPS…'],
    'empty.loading': ['正在加载…', '正在載入…', 'Loading…'],

    'chart.hourCurve': ['小时（未来 24h）', '小時（未來 24h）', 'Hour (next 24h)'],
    'chart.discharge': ['日期（河道流量 m³/s）', '日期（河道流量 m³/s）', 'Date (discharge m³/s)'],
    'chart.tide': ['时间（潮位 m）', '時間（潮位 m）', 'Time (tide level m)']
  };

  /* ---------------------------------------------------------------- DOM 级文案替换
     新壳正文是 Vue 直接渲染的静态中文，逐句 t() 要改上百处模板；这里改成「按原文对照表替换
     DOM 文本」：源文案在 src/lib/i18n-phrases.ts（简体原文 → [繁体, English]）。
     地名、用户笔记这类数据不在表里，所以不会误翻用户内容。
     · 文本节点：整串精确匹配；带数字的动态文案走 PATTERNS 正则；
     · 属性：placeholder / title / aria-label / data-tip / alt；
     · MutationObserver 盯着 body：页签切换、弹窗、toast 里新冒出来的文案也会翻；
     · 切回简体用 WeakMap 里存的原文还原。 */
  var SRC_OF: any = {};
  (function () {
    Object.keys(PHRASES).forEach(function (zh) {
      SRC_OF[zh] = zh;
      SRC_OF[PHRASES[zh][0]] = zh;
      SRC_OF[PHRASES[zh][1]] = zh;
    });
  })();
  var ATTRS = ['placeholder', 'title', 'aria-label', 'data-tip', 'alt'];
  var SKIP_TAGS: any = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1 };
  var ORIG_NODE = new WeakMap();
  var ORIG_ATTR = new WeakMap();
  var observer: any = null;

  function keyOf(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  function morph(zh, which) {
    var row = PHRASES[zh];
    if (row) return which === 0 ? row[0] : row[1];
    for (var i = 0; i < PATTERNS.length; i++) {
      var m = PATTERNS[i][0].exec(zh);
      if (!m) continue;
      var tpl = which === 0 ? PATTERNS[i][1] : PATTERNS[i][2];
      return tpl.replace(/\$(\d)/g, function (_s, d) { return m[Number(d)] == null ? '' : m[Number(d)]; });
    }
    return null;
  }

  function trTextNode(node, which) {
    var raw = node.nodeValue;
    if (!raw) return;
    var k = keyOf(raw);
    if (!k) return;
    var stored = ORIG_NODE.get(node);
    if (which === -1) {                      // 切回简体：还原存下来的原文
      if (stored && stored !== k) node.nodeValue = raw.replace(k, stored);
      return;
    }
    if (PHRASES[k]) {                        // 当前就是源文案
      var out = morph(k, which);
      if (out != null && out !== k) {
        ORIG_NODE.set(node, k);
        node.nodeValue = raw.replace(k, out);
      }
      return;
    }
    // 动态文案（带数字）没有对照表条目，直接把当前文本当源交给 PATTERNS 试一次；
    // 匹配不上（用户数据、地名）时 morph 返回 null，原样不动。
    var zh = stored || SRC_OF[k] || k;
    if (!zh) return;
    var out2 = morph(zh, which);
    if (out2 == null) return;
    if (!stored) ORIG_NODE.set(node, zh);
    var next = raw.replace(k, out2);
    if (next === raw) return;                 // 同上：目标文案相同就不写，避免来回触发
    node.nodeValue = next;
  }

  function trAttrs(el, which) {
    if (!el.getAttribute) return;
    var saved = ORIG_ATTR.get(el);
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      var v = el.getAttribute(a);
      if (!v) continue;
      var k = keyOf(v);
      if (!k) continue;
      if (which === -1) {
        var orig = saved && saved[a];
        if (orig && orig !== k) el.setAttribute(a, orig);
        continue;
      }
      var zh = (saved && saved[a]) || (PHRASES[k] ? k : SRC_OF[k]);
      if (!zh) continue;
      var out = morph(zh, which);
      if (out == null || out === v) continue;   // 已经是目标文案就别写回（避免 observer 自激）
      if (!saved) { saved = {}; ORIG_ATTR.set(el, saved); }
      if (!saved[a]) saved[a] = zh;
      el.setAttribute(a, out);
    }
  }
  function walk(el, which) {
    if (!el) return;
    if (el.nodeType === 3) { trTextNode(el, which); return; }
    if (el.nodeType !== 1) return;
    // 表单控件不翻内容，但 placeholder/title 要翻
    if (SKIP_TAGS[el.tagName]) { trAttrs(el, which); return; }
    if (el.hasAttribute && el.hasAttribute('data-i18n-skip')) return;
    trAttrs(el, which);
    for (var n = el.firstChild; n; n = n.nextSibling) walk(n, which);
  }

  function applyDom(root?) {
    var which = lang === 'en' ? 1 : (lang === 'zh-Hant' ? 0 : -1);
    walk(root || document.body, which);
  }

  /* 页签/弹窗/toast 里的新文案也要翻：盯 body，80 ms 合并一次 */
  function startObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    var timer: any = 0;
    /* 队列必须跨回调累积：一次页签切换会连发几十个 MutationRecord，
       若只在「第一个回调」里抓 records，后面的就丢了（表现为这些卡片一直不翻）。 */
    var queue: any[] = [];
    function flush() {
      timer = 0;
      var which = lang === 'en' ? 1 : 0;
      var batch = queue.splice(0, queue.length);
      for (var i = 0; i < batch.length; i++) {
        var r = batch[i];
        if (r.type === 'characterData') trTextNode(r.target, which);
        else for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j], which);
      }
    }
    observer = new MutationObserver(function (records) {
      if (lang === 'zh-Hans') return;
      for (var i = 0; i < records.length; i++) queue.push(records[i]);
      if (!timer) timer = setTimeout(flush, 80);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  var lang = 'zh-Hans';
  function load() {
    try {
      var v = Store.getItem(KEY);
      if (v && LANGS.some(function (l) { return l.id === v; })) lang = v;
    } catch (e) { /* 默认简中 */ }
  }
  function save() {
    try { Store.setItem(KEY, lang); } catch (e) { /* 忽略 */ }
  }
  function idx() {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].id === lang) return i;
    return 0;
  }
  function t(key, fallback) {
    var row = DICT[key];
    if (!row) return fallback != null ? fallback : key;
    var v = row[idx()];
    return v != null ? v : row[0];
  }
  function set(id) {
    lang = id;
    save();
    apply();
  }
  function apply() {
    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : (lang === 'zh-Hant' ? 'zh-Hant' : 'zh-CN'));
    // 卡片标题
    var map = {
      cardLoc: 'card.loc', cardScore: 'card.score', cardTime: 'card.time', cardWeather: 'card.weather',
      cardWind: 'card.wind', cardWater: 'card.water', cardTerrain: 'card.terrain', cardSat: 'card.sat',
      cardSpot: 'card.spot', cardMap: 'card.map', cardFactor: 'card.factor', cardMeta: 'card.meta',
      cardFav: 'card.fav', cardCatch: 'card.catch', cardAqua: 'card.aqua'
    };
    Object.keys(map).forEach(function (cid) {
      var el = document.getElementById(cid);
      if (!el) return;
      var h = el.querySelector('.card-head h2');
      if (h) h.textContent = t(map[cid]);
    });
    var legend = { 'lgMe': 'map.legend.me', 'lgFav': 'map.legend.fav', 'lgHi': 'map.legend.hi',
      'lgMid': 'map.legend.mid', 'lgCand': 'map.legend.cand', 'lgWater': 'map.legend.water',
      'lgShore': 'map.legend.shoreRoute', 'lgBoat': 'map.legend.boatRoute' };
    Object.keys(legend).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = t(legend[id]);
    });
    var btns = { btnRefreshLbl: 'btn.refresh', btnManualLbl: 'btn.findWater', btnHere: 'btn.gps',
      btnSavePlace: 'btn.savePlace', btnSat: 'btn.analyze', btnPickPhoto: 'btn.pickPhoto',
      btnExportArchive: 'btn.exportArchive', btnImportArchive: 'btn.importArchive',
      btnShareLoc: 'btn.share' };
    Object.keys(btns).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = t(btns[id]);
    });
    // 分享 / 导航弹窗（标题、格子标签、说明）
    var shareParts = { shareTitle: 'share.title', lblNavAmap: 'share.amap', lblNavAmapSub: 'share.amapSub',
      lblNavBaidu: 'share.baidu', lblNavBaiduSub: 'share.baiduSub', lblShareText: 'share.send',
      lblShareTextSub: 'share.sendSub', lblCopyCoord: 'share.copy', lblCopyCoordSub: 'share.copySub',
      shareHint: 'share.hint', sharePtNote: 'share.ptNote' };
    Object.keys(shareParts).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = t(shareParts[id]);
    });
    // 标签页：用户改过名就优先用自定义名
    if (window.LureCast && window.LureCast.applyTabNames) window.LureCast.applyTabNames();
    // 通知外部刷新（图表轴标签、地图图例等需要重画）
    if (window.LureCast && window.LureCast.renderAll) {
      try { window.LureCast.renderAll(); } catch (e) { /* 首次可能没数据 */ }
    }
    // 最后过一遍 DOM：Vue 渲染的正文（卡片里的说明、按钮、提示）都靠这一步
    try { applyDom(); startObserver(); } catch (e) { /* 还没 body 就跳过 */ }
  }

  window.I18N = {
    LANGS: LANGS, load: load, save: save, t: t, apply: apply, set: set, applyDom: applyDom,
    get: function () { return lang; },
    isZh: function () { return lang !== 'en'; }
  };
export const I18N = {
  LANGS: LANGS, load: load, save: save, t: t, apply: apply, set: set, applyDom: applyDom,
  get: function () { return lang; },
  isZh: function () { return lang !== 'en'; }
}

/* t 已经在上面作为函数声明存在（老壳的 t(key, fallback)），这里不再重复导出 */
export default I18N