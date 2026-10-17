/* LureCast · 多语言（默认简体中文）
   只翻译"界面骨架"：标签、卡片标题、按钮、图例、地图弹窗、状态文案。
   数据本身（地名、鱼种中文名）不翻译。
   新增语言只要往 LANGS 里加一列。 */
(function () {
  'use strict';
  // 存储统一走 Store（IndexedDB 同步门面），失败时退回 localStorage
  var Store = window.Store || window.localStorage;
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
  }

  window.I18N = {
    LANGS: LANGS, load: load, save: save, t: t, apply: apply, set: set,
    get: function () { return lang; },
    isZh: function () { return lang !== 'en'; }
  };
})();
