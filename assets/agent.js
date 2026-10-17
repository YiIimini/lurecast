/* LureCast · 应用内 Agent 助手
   ——————————————————————————————————————————————————————————————
   模型只负责"想"，数据全在本机：每次回答前由模型点名要哪个工具，
   这里用本机 state 取真实数值喂回去，再让它总结。所以：
   · 不编造温度、分数、距离 —— 没取到就写没取到；
   · 不需要后端，Key 仍在用户自己设备上（与识图共用一套设置）；
   · 工具调用过程在气泡里可见，用户能看出结论是怎么来的。

   支持 OpenAI 兼容协议（DeepSeek / OpenAI / 通义 / 豆包 / 智谱 / Kimi / 自建）
   与 Gemini；协议差异在 ai.js 里统一。
   —————————————————————————————————————————————————————————————— */
(function () {
  'use strict';
  var Store = window.Store || window.localStorage;
  var KEY = 'lc:agent';
  var MAX_TURNS = 4;          // 最多几轮工具调用，防止自己绕死
  var MAX_HISTORY = 12;       // 回灌给模型的历史条数（省 token）

  function $(id) { return document.getElementById(id); }
  function st() { return (window.LureCast && window.LureCast.state) || {}; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function r0(v) { return v == null || !isFinite(v) ? null : Math.round(v); }
  function r1(v) { return v == null || !isFinite(v) ? null : Math.round(v * 10) / 10; }
  function km(m) { return m == null ? null : (m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'); }
  function hhmm(iso) { return iso ? String(iso).slice(11, 16) : null; }

  /* ---------------------------------------------------------- 取数工具 */
  var TOOLS = [];

  function tool(name, desc, params, run, opts) {
    TOOLS.push({
      name: name, desc: desc, params: params || { type: 'object', properties: {} },
      run: run, action: !!(opts && opts.action)
    });
  }

  tool('app_status', '当前定位、水域类型、目标鱼、数据是否新鲜。任何回答前先看一眼。',
    { type: 'object', properties: {} },
    function () {
      var s = st();
      if (!s.me) return { ok: false, note: '还没有定位。可以让用户点「用 GPS 定位」或在地图上点一下选点。' };
      var place = s.place || {};
      return {
        位置: s.placeHint || place.name || (place.address && (place.address.city || place.address.county)) || '未命名位置',
        纬度: +s.me.lat.toFixed(5), 经度: +s.me.lon.toFixed(5),
        定位来源: s.locSource || '未知',
        水域类型: { 设定: s.waterType || 'auto', 自动判定: s.waterAuto || 'unknown' },
        目标鱼: s.species || 'general',
        候选岸线段: (s.cands || []).length,
        推荐钓点数: (s.spots || []).length,
        数据时间: s.wx && s.wx.at ? new Date(s.wx.at).toLocaleString('zh-CN') : null,
        数据可能过期: !!s.stale,
        当前分区: s.tab
      };
    });

  tool('weather_now', '实况天气：气温、体感、气压与 3 小时变化、风向风速阵风、云量、湿度、降水、水温。',
    { type: 'object', properties: {} },
    function () {
      var s = st();
      var c = s.wx && s.wx.data && s.wx.data.current;
      if (!c) return { ok: false, note: '气象数据还没到（网络或缓存问题）。' };
      return {
        气温: r1(c.temperature_2m), 体感: r1(c.apparent_temperature),
        气压: r1(c.pressure_msl), hPa3小时变化: r1(s.dPi),
        风: { 风向: c.wind_direction_10m, 风速: r1(c.wind_speed_10m), 阵风: r1(c.wind_gusts_10m) },
        云量: r0(c.cloud_cover), 湿度: r0(c.relative_humidity_2m),
        降水: r1(c.precipitation), 降水概率: r0(s.precipProb),
        水温: r1(s.waterTemp != null ? s.waterTemp : (c.sea_surface_temperature)),
        日出: s.sunriseMs ? new Date(s.sunriseMs).toISOString().slice(11, 16) : null,
        日落: s.sunsetMs ? new Date(s.sunsetMs).toISOString().slice(11, 16) : null,
        天气: s.wx.data.current.weather_code
      };
    });

  tool('bite_score', '鱼口指数（环境分 0-100）、六个因子各占多少权重、未来 24 小时最好的两个时段。',
    { type: 'object', properties: {} },
    function () {
      var s = st();
      if (!s.env) return { ok: false, note: '环境分还没算出来。' };
      var curve = s.curve || [];
      var peak = curve.slice().sort(function (a, b) { return b.score - a.score; })[0];
      return {
        环境分: s.env.score,
        因子: (s.env.factors || []).map(function (f) {
          return { 名称: f.label, 权重: f.w, 得分: f.score };
        }),
        最佳时段: (s.windows || []).map(function (w) {
          return { 开始: w.start || w.from || w.a, 结束: w.end || w.to || w.b, 分: w.score };
        }),
        '24小时最高分': peak ? { 时刻: peak.t, 分: peak.score } : null,
        权重方案: (window.LureCast && window.LureCast.cfg && window.LureCast.cfg.score) || 'balanced'
      };
    });

  tool('spots', '推荐钓点（按综合分排序）：名称、岸型、分数、距离、是否迎风岸、岸坡、拟饵、推荐理由。',
    { type: 'object', properties: { limit: { type: 'integer', description: '要几个，默认 5，最多 8' } } },
    function (a) {
      var s = st();
      var n = Math.min(8, Math.max(1, (a && a.limit) || 5));
      if (!(s.spots || []).length) return { ok: false, note: '这附近没有算出的钓点（OSM 岸线没收录，或还在加载）。' };
      return s.spots.slice(0, n).map(function (p, i) {
        return {
          序号: i + 1, 名称: p.name || '未命名岸段', 岸型: p.formText,
          综合分: p.spotScore, 结构分: p.structScore,
          距离: km(p.distToMe), 方位: r0(p.bearingFromMe) + '°',
          迎风岸: !!p.windward, 岸坡百分比: r0(p.slopePct), 近岸20m深: r1(p.depth20),
          拟饵: (p.lure || []).join(' / '),
          理由: p.reasons || [],
          坐标: [+p.lat.toFixed(5), +p.lon.toFixed(5)]
        };
      });
    });

  tool('wind_info', '风向风速阵风、未来 1/3/6 小时风向变化、这段岸线里有多少段是迎风岸。',
    { type: 'object', properties: {} },
    function () {
      var s = st();
      var c = s.wx && s.wx.data && s.wx.data.current;
      if (!c) return { ok: false, note: '没有风的实况数据。' };
      var E = window.Engine;
      var windward = (s.cands || []).filter(function (x) { return x.windward === true; });
      var shores = {};
      windward.forEach(function (x) {
        var k = E ? E.compass(x.landBearing) : '?';
        shores[k] = (shores[k] || 0) + 1;
      });
      return {
        风从: E ? E.compass(c.wind_direction_10m) : c.wind_direction_10m,
        风吹向: E ? E.compass((c.wind_direction_10m + 180) % 360) : null,
        风速: r1(c.wind_speed_10m), 阵风: r1(c.wind_gusts_10m),
        迎风岸段数: windward.length,
        迎风岸集中在: shores
      };
    });

  tool('water_info', '水位/水流：湖库用降水与汇流代理、河流用流量、海/河口用潮位。含数据局限说明。',
    { type: 'object', properties: {} },
    function () {
      var s = st();
      var w = s.water;
      if (!w) return { ok: false, note: '水情数据还没到。' };
      var out = { 模式: w.mode };
      Object.keys(w).forEach(function (k) {
        var v = w[k];
        if (v == null || typeof v === 'object' && !Array.isArray(v)) return;
        if (typeof v === 'number') out[k] = r1(v);
        else if (typeof v === 'string' || typeof v === 'boolean') out[k] = v;
      });
      out.局限 = '湖库没有免费实测水位接口，这里是趋势代理，只能判「涨/稳/退」。';
      return out;
    });

  tool('terrain_info', '岸线地形结构：岸坡中位数、陡岸段数量、岬角与湾的数量、近岸 20 m 水深估值。',
    { type: 'object', properties: {} },
    function () {
      var t = st().terrain;
      if (!t || !t.sampled) return { ok: false, note: '还没有岸线高程采样数据。' };
      return {
        采样岸段: t.sampled, 岸坡中位数百分比: r0(t.medianSlope),
        陡岸段: t.steepCount, 岬角: t.pointCount, 湾: t.bayCount,
        迎风岸段: t.windCount,
        近岸20m深中位数: r1(t.medianDepth20), 最深估点: r1(t.maxDepth20),
        说明: '岸坡＝岸上 120 m 高差 ÷ 120 m；水深按岸坡线性外推，DEM 会低估，只作相对比较。'
      };
    });

  tool('satellite_info', '历史卫星影像分析结果：水位差、露出的水下结构候选点。没有分析过就返回未分析。',
    { type: 'object', properties: {} },
    function () {
      var s = st().sat;
      if (!s || !s.anomalies) return { ok: false, note: '还没做过影像分析（影像页 → 分析影像，约 10-30 秒）。' };
      return {
        水体占比: s.waterPct, 水位差百分比: s.diffPct,
        水下结构候选: (s.anomalies || []).slice(0, 6).map(function (a) {
          return { 说明: a.text || '结构异常', 坐标: [+a.lat.toFixed(5), +a.lon.toFixed(5)] };
        }),
        局限: '按水色差异找异常，不是测深；阴天、浑浊水、藻华会误报。'
      };
    });

  tool('species_info', '鱼种资料：适温区间、常见体型、推荐拟饵、作钓要点。可只查一种。',
    { type: 'object', properties: { name: { type: 'string', description: '鱼种中文名，如 鲈鱼 / 翘嘴；留空=当前目标鱼' } } },
    function (a) {
      var s = st();
      var db = window.SPECIES_DB || [];
      var want = (a && a.name) || '';
      var cur = s.species || 'general';
      var hit = want
        ? db.filter(function (x) { return x.zh.indexOf(want) >= 0 || x.en.toLowerCase().indexOf(String(want).toLowerCase()) >= 0 || x.id === want; })[0]
        : db.filter(function (x) { return x.id === cur; })[0];
      if (!hit) {
        return { ok: false, note: '本地鱼种库里没这条，可选项：' + db.slice(0, 12).map(function (x) { return x.zh; }).join('、') };
      }
      return {
        中文名: hit.zh, 英文名: hit.en, 拉丁名: hit.latin, 科: hit.family,
        水域: hit.water, 常见体长cm: hit.sizeCm, 活跃水温: hit.season,
        推荐拟饵: hit.lures, 要点: hit.tip
      };
    });

  tool('catch_log', '我的渔获记录统计：总条数、鱼种分布、最大个体、最近一次。',
    { type: 'object', properties: {} },
    function () {
      var list = (window.My && window.My.catches ? window.My.catches() : []) || [];
      if (!list.length) return { ok: false, note: '还没有渔获记录。' };
      var byId = {};
      list.forEach(function (c) { byId[c.sp] = (byId[c.sp] || 0) + 1; });
      var db = window.SPECIES_DB || [];
      var nameOf = function (id) {
        var f = db.filter(function (x) { return x.id === id; })[0];
        return f ? f.zh : id;
      };
      var biggest = list.slice().sort(function (a, b) { return (b.sizeCm || 0) - (a.sizeCm || 0); })[0];
      var last = list.slice().sort(function (a, b) { return b.at - a.at; })[0];
      return {
        总条数: list.length,
        鱼种分布: Object.keys(byId).map(function (k) { return nameOf(k) + ' × ' + byId[k]; }),
        最大个体: biggest ? { 鱼种: nameOf(biggest.sp), 体长cm: biggest.sizeCm, 地点: biggest.place } : null,
        最近一次: last ? { 鱼种: nameOf(last.sp), 体长cm: last.sizeCm, 时间: new Date(last.at).toLocaleString('zh-CN') } : null
      };
    });

  /* 写操作：会真的改应用状态，界面上会显示"已执行" */
  tool('set_location', '把当前位置改到某个坐标（例如用户说「改到千岛湖湖心」并给了经纬度）。这会重算全部分数。',
    { type: 'object', properties: {
      lat: { type: 'number', description: '纬度 WGS-84' },
      lon: { type: 'number', description: '经度 WGS-84' },
      label: { type: 'string', description: '地名备注，可空' }
    }, required: ['lat', 'lon'] },
    function (a) {
      if (!window.LureCast || !window.LureCast.setMe) return { ok: false, note: '应用还没准备好。' };
      window.LureCast.setMe(+a.lat, +a.lon, null, a.label || null, 'agent');
      return { ok: true, 已改到: [+(+a.lat).toFixed(5), +(+a.lon).toFixed(5)], 地名: a.label || null };
    }, { action: true });

  tool('set_water_type', '改水域类型，会重算环境分与钓点。',
    { type: 'object', properties: { type: { type: 'string', enum: ['auto', 'reservoir', 'river', 'sea'] } }, required: ['type'] },
    function (a) {
      if (!window.LureCast || !window.LureCast.setWaterType) return { ok: false, note: '应用还没准备好。' };
      window.LureCast.setWaterType(a.type);
      return { ok: true, 水域类型: a.type };
    }, { action: true });

  tool('set_target_fish', '换目标鱼种，会按该鱼种的权重与拟饵重算。',
    { type: 'object', properties: { fish: { type: 'string', enum: ['general', 'bass', 'topmouth', 'mandarin', 'snakehead', 'stream', 'seabass'] } }, required: ['fish'] },
    function (a) {
      if (!window.LureCast || !window.LureCast.setSpecies) return { ok: false, note: '应用还没准备好。' };
      window.LureCast.setSpecies(a.fish);
      return { ok: true, 目标鱼: a.fish };
    }, { action: true });

  tool('goto_tab', '切换底部（顶部）分区：summary 结论 / spots 钓点 / sat 影像 / me 我的。',
    { type: 'object', properties: { tab: { type: 'string', enum: ['summary', 'spots', 'sat', 'me'] } }, required: ['tab'] },
    function (a) {
      if (!window.LureCast || !window.LureCast.applyTab) return { ok: false, note: '应用还没准备好。' };
      window.LureCast.applyTab(a.tab);
      return { ok: true, 已切到: a.tab };
    }, { action: true });

  tool('refresh_data', '重新取一次气象/水情/岸线数据（用户说「刷新一下」时用）。',
    { type: 'object', properties: {} },
    function () {
      if (!window.LureCast || !window.LureCast.refresh) return { ok: false, note: '应用还没准备好。' };
      window.LureCast.refresh(true);
      return { ok: true, note: '已在后台刷新，几秒后数据就位。' };
    }, { action: true });

  function schemas() {
    return TOOLS.map(function (t) {
      return {
        type: 'function',
        function: { name: t.name, description: t.desc, parameters: t.params }
      };
    });
  }

  function runTool(name, args) {
    var t = null;
    for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].name === name) t = TOOLS[i];
    if (!t) return { ok: false, note: '没有这个工具：' + name };
    try { return t.run(args || {}); }
    catch (e) { return { ok: false, note: '工具出错：' + (e && e.message ? e.message : e) }; }
  }

  /* ---------------------------------------------------------- 提示词 */
  function systemPrompt() {
    var s = st();
    var who = s.me ? ('用户当前坐标 WGS-84 ' + s.me.lat.toFixed(5) + ', ' + s.me.lon.toFixed(5)) : '用户还没有定位';
    return [
      '你是 LureCast（路亚潮汐）里的随行助手，服务对象是正在岸边准备抛竿的路亚钓友。',
      who + '。',
      '',
      '规矩：',
      '1. 任何带数字的结论都要先用工具取数据（app_status / weather_now / bite_score / spots / wind_info / water_info / terrain_info / satellite_info / species_info / catch_log），不许凭印象编。',
      '2. 工具没给的字段就说「这项没有数据」，不要猜数值、不要给假坐标。',
      '3. 回答中文、短句、可执行：先一句结论，再 2-4 条理由，最后给下一步（去哪一段、用什么饵、几点到）。总共不超过 200 字。',
      '4. 安全第一：不涉水、不站湿滑陡坡岩边、雷雨天收竿；相关情况必须直说。',
      '5. 单位用 m/s、hPa、℃、m、km，距离说「约 300 m」这种人话。',
      '6. 只有用户明确要求改位置/水域/目标鱼时才调用写操作工具，改完用一句话确认。',
      '7. 数据是免费公开源（Open-Meteo / OpenStreetMap / Sentinel-2），有误差，别把推断说成实测。'
    ].join('\n');
  }

  /* ---------------------------------------------------------- 会话与渲染 */
  var messages = [];     // OpenAI 格式
  var uiLog = [];        // 只存 user/assistant 文本，用于持久化与重绘
  var busy = false, abortFlag = false;

  function loadHistory() {
    try {
      var raw = Store.getItem(KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (Array.isArray(o) && o.length) uiLog = o.slice(-30);
    } catch (e) { /* 忽略 */ }
  }
  function saveHistory() {
    try { Store.setItem(KEY, JSON.stringify(uiLog.slice(-30))); } catch (e) { /* 忽略 */ }
  }

  function mdLite(text) {
    var h = esc(text);
    h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/^\s*[-*]\s+(.+)$/gm, '<span class="agli">· $1</span>');
    return h.replace(/\n/g, '<br>');
  }

  function renderLog() {
    var box = $('agLog');
    if (!box) return;
    if (!uiLog.length) {
      box.innerHTML = emptyHtml();
      return;
    }
    box.innerHTML = uiLog.map(function (m) {
      if (m.role === 'user') return '<div class="agmsg me"><div class="agbub">' + esc(m.text) + '</div></div>';
      var tools = (m.tools || []).map(function (t) {
        return '<span class="agtool' + (t.action ? ' act' : '') + '">' + esc(t.label) + '</span>';
      }).join('');
      return '<div class="agmsg"><div class="agava">LC</div><div class="agbub">' +
        (tools ? '<div class="agtools">' + tools + '</div>' : '') +
        mdLite(m.text || '') + '</div></div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function emptyHtml() {
    var problem = window.AI && window.AI.chatProblem ? window.AI.chatProblem() : 'AI 模块没加载';
    if (problem) {
      return '<div class="agempty"><b>助手还差一步</b>' +
        '<p>' + esc(problem) + '。</p>' +
        '<p>识图那把 Key 助手直接就能用：<b>厂商选同一家、Key 不用重复填、模型名也不用改</b>——' +
        'DeepSeek 的 <b>deepseek-flash</b>、OpenAI 的 <b>gpt-4o-mini</b>、Gemini 的 <b>gemini-2.0-flash</b> ' +
        '本身就同时支持识图与工具调用。只有用了「不支持工具调用的视觉预览版」时，才需要在设置里单独填「对话模型」。</p>' +
        '<button class="act primary" id="btnAgToSet">打开设置</button></div>';
    }
    return '<div class="agempty"><b>问点什么？</b>' +
      '<p>我会读这份应用里的真实数据回答：定位与水域、鱼口指数、24 小时时段、推荐钓点、风与迎风岸、水情、岸坡结构、你的渔获。</p>' +
      '<p class="aghint">例：今天这个点值不值得去 · 最近哪个钓点最靠谱 · 这种风该打哪一岸 · 换翘嘴目标要改什么</p></div>';
  }

  function pushAssistant(text, tools) {
    uiLog.push({ role: 'assistant', text: text, tools: tools || [] });
    saveHistory();
    renderLog();
  }

  function pending(html) {
    var box = $('agLog');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'agmsg pending';
    el.id = 'agPending';
    el.innerHTML = '<div class="agava">LC</div><div class="agbub"><span class="agdots"><i></i><i></i><i></i></span>' + (html || '') + '</div>';
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }
  function pendingNote(text) {
    var el = $('agPending');
    if (!el) return pending(text);
    el.querySelector('.agbub').innerHTML = '<span class="agdots"><i></i><i></i><i></i></span>' + esc(text);
  }
  function clearPending() { var el = $('agPending'); if (el) el.remove(); }

  /* ---------------------------------------------------------- 主循环 */
  function historyForModel() {
    var keep = [];
    var used = 0;
    for (var i = uiLog.length - 1; i >= 0 && used < MAX_HISTORY; i--) {
      var m = uiLog[i];
      keep.unshift({ role: m.role, content: m.text || '' });
      used++;
    }
    return keep;
  }

  function ask(text) {
    if (busy) return;
    if (!window.AI || !window.AI.chat) { alert('ai.js 没加载'); return; }
    var problem = window.AI.chatProblem ? window.AI.chatProblem() : 'AI 模块没加载';
    if (problem) {
      renderLog();
      try { window.LureCast.toast && window.LureCast.toast(problem); } catch (e) {}
      return;
    }

    uiLog.push({ role: 'user', text: text });
    saveHistory();
    renderLog();
    busy = true; abortFlag = false;
    orbSet('busy');
    setBusyUI(true);

    var convo = [{ role: 'system', content: systemPrompt() }].concat(historyForModel());
    messages = convo;
    pending('正在读数据…');

    var usedTools = [];

    var step = function (round) {
      if (abortFlag) { clearPending(); busy = false; setBusyUI(false); return; }
      return window.AI.chat(messages, { tools: schemas(), temperature: 0.4, maxTokens: 900 })
        .then(function (res) {
          if (res.toolCalls && res.toolCalls.length && round < MAX_TURNS) {
            messages.push({
              role: 'assistant', content: res.text || '',
              tool_calls: res.toolCalls.map(function (c) {
                return { id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } };
              })
            });
            res.toolCalls.forEach(function (c) {
              var out = runTool(c.name, c.args);
              var t = null;
              for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].name === c.name) t = TOOLS[i];
              usedTools.push({
                label: (t && t.action ? '已执行 · ' : '查 · ') + c.name,
                action: !!(t && t.action)
              });
              if (t && t.action) { try { window.LureCast.toast && window.LureCast.toast('助手：' + c.name); } catch (e) {} }
              messages.push({ role: 'tool', name: c.name, tool_call_id: c.id, content: JSON.stringify(out) });
            });
            pendingNote(usedTools.map(function (t) { return t.label; }).slice(-3).join(' · ') + ' …');
            return step(round + 1);
          }
          clearPending();
          var answer = String(res.text || '').trim();
          if (!answer) answer = '模型这次只回了空内容，换个问法或换个模型试试（要支持工具调用的）。';
          pushAssistant(answer, usedTools);
          usedTools = [];
          busy = false; setBusyUI(false);
          orbSettle();
          checkActionEffects();
        })
        .catch(function (err) {
          clearPending();
          var msg = String(err && err.message ? err.message : err);
          var hint = '';
          if (/HTTP 401|invalid.*key|unauthor/i.test(msg)) hint = '\n（Key 无效或没权限：设置 → 识图 / 助手 里重新填。）';
          else if (/HTTP 404/i.test(msg)) hint = '\n（模型名或 baseURL 不对：对话模型名要填该厂商真实可用的模型。）';
          else if (/tool|function/i.test(msg) && /400/.test(msg)) hint = '\n（这个模型名可能不支持工具调用：在设置 → 识图与助手里把「对话模型」填成该厂商通用的对话模型。）';
          else if (/Failed to fetch|NetworkError|timeout/i.test(msg)) hint = '\n（网络没通：换个网络，或在设置里换成能直连的服务。）';
          pushAssistant('调用失败：' + msg + hint, usedTools);
          usedTools = [];
          busy = false; setBusyUI(false);
          orbSettle();
        });
    };
    step(0);
  }

  /* 写操作执行后同步一下界面（分区/位置变化可能已由 app.js 自己刷新） */
  function checkActionEffects() {
    try { if (window.LureCast && window.LureCast.renderAll) window.LureCast.renderAll(); } catch (e) { /* 忽略 */ }
  }

  function setBusyUI(on) {
    if ($('agSend')) $('agSend').disabled = on;
    if ($('agStop')) $('agStop').style.display = on ? '' : 'none';
    if ($('agInput')) $('agInput').disabled = on;
  }

  /* ---------------------------------------------------------- 交互 */
  var QUICK = [
    '今天这个点值得去吗',
    '最近哪个钓点最靠谱',
    '这种风该打哪一岸',
    '用什么饵、几点到',
    '水情和岸坡怎么看',
    '换个目标鱼要改什么'
  ];

  function renderQuick() {
    var row = $('agQuick');
    if (!row) return;
    row.innerHTML = QUICK.map(function (q) {
      return '<button class="chip" data-q="' + esc(q) + '">' + esc(q) + '</button>';
    }).join('');
    Array.prototype.forEach.call(row.querySelectorAll('[data-q]'), function (b) {
      b.addEventListener('click', function () { ask(b.getAttribute('data-q')); });
    });
  }

  function bind() {
    loadHistory();
    renderQuick();
    renderLog();
    setBusyUI(false);

    var send = $('agSend'), input = $('agInput');
    function submit() {
      if (!input) return;
      var v = input.value.trim();
      if (!v) return;
      input.value = '';
      ask(v);
    }
    if (send) send.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    if ($('agStop')) $('agStop').addEventListener('click', function () { abortFlag = true; });
    if ($('agClear')) $('agClear').addEventListener('click', function () {
      uiLog = []; messages = []; saveHistory(); renderLog();
      try { window.LureCast.toast && window.LureCast.toast('已清空对话'); } catch (e) {}
    });
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.id === 'btnAgToSet') {
        var m = $('modalAgent'); if (m) m.classList.add('hidden');
        var btn = $('btnSettings'); if (btn) btn.click();
      }
    });
    // 弹窗打开时刷新一下空状态（可能刚配好 Key）
    var modal = $('modalAgent');
    if (modal) {
      var obs = new MutationObserver(function () {
        if (!modal.classList.contains('hidden')) { renderLog(); setBusyUI(busy); stampModelNote(); }
      });
      obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
    }
    stampModelNote();
    initOrb();
    watchPanel();
  }

  /* 一轮问答结束后：面板开着就安静回 idle，面板关着就给一次「新回答」提示 */
  function orbSettle() {
    var panel = $('modalAgent');
    var open = panel && !panel.classList.contains('hidden');
    if (open) orbSet('idle');
    else { orbSet('done'); orbBadge(orbNewCount + 1); }
  }

  /* 顶栏小字：显示当前对话模型，方便确认到底在用哪个 */
  function stampModelNote() {
    var el = $('agModelNote');
    if (!el) return;
    var problem = window.AI && window.AI.chatProblem ? window.AI.chatProblem() : 'AI 未加载';
    el.textContent = problem ? problem : '模型 ' + window.AI.chatModel() + ' · 读本机数据回答';
  }

  /* ---------------------------------------------------------- 悬浮助手球
     可拖动、松手吸附最近一侧；位置与开关存在本机。
     状态：idle / busy（思考中）/ done（面板关着时收到回答）。 */
  var ORB_KEY = 'lc:orb';
  var orbCfg = { on: true, side: 'right', y: null };
  var orbEl = null, orbMoved = false, orbDownAt = null, orbDrag = null, orbNewCount = 0;

  function loadOrbCfg() {
    try {
      var raw = Store.getItem(ORB_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (typeof o.on === 'boolean') orbCfg.on = o.on;
      if (o.side === 'left' || o.side === 'right') orbCfg.side = o.side;
      if (typeof o.y === 'number' && isFinite(o.y)) orbCfg.y = o.y;
    } catch (e) { /* 默认显示在右下 */ }
  }
  function saveOrbCfg() {
    try { Store.setItem(ORB_KEY, JSON.stringify(orbCfg)); } catch (e) { /* 忽略 */ }
  }

  function layoutOrb() {
    if (!orbEl) return;
    var vh = window.innerHeight || 800;
    if (orbCfg.side === 'left') { orbEl.style.left = '16px'; orbEl.style.right = 'auto'; }
    else { orbEl.style.right = '16px'; orbEl.style.left = 'auto'; }
    if (typeof orbCfg.y === 'number') {
      var y = Math.max(56, Math.min(vh - 110, orbCfg.y));
      orbEl.style.top = y + 'px';
      orbEl.style.bottom = 'auto';
    } else {
      orbEl.style.top = 'auto';
      orbEl.style.bottom = '';
    }
  }

  function syncOrb() {
    if (!orbEl) return;
    var panel = $('modalAgent');
    var panelOpen = panel && !panel.classList.contains('hidden');
    orbEl.classList.toggle('hidden', !orbCfg.on || !!panelOpen);
    orbEl.classList.toggle('setup', !(window.AI && window.AI.chatReady && window.AI.chatReady()));
    var chip = $('chkOrb');
    if (chip) chip.classList.toggle('on', !!orbCfg.on);
  }

  function orbSet(state) {
    if (!orbEl) return;
    orbEl.classList.toggle('busy', state === 'busy');
    orbEl.classList.toggle('done', state === 'done');
    if (state !== 'done') orbEl.classList.remove('done');
  }

  function orbBadge(n) {
    if (!orbEl) return;
    orbNewCount = Math.max(0, n | 0);
    orbEl.classList.toggle('has-new', orbNewCount > 0);
    var b = $('aiOrbBadge');
    if (b) b.textContent = orbNewCount > 9 ? '9+' : String(orbNewCount);
  }

  function initOrb() {
    orbEl = $('aiOrb');
    if (!orbEl) return;
    loadOrbCfg();
    layoutOrb();
    syncOrb();
    orbBadge(0);

    var open = function () {
      if (window.LureCast && window.LureCast.openModal) window.LureCast.openModal('modalAgent');
      orbBadge(0);
      orbSet('idle');
      syncOrb();
    };

    orbEl.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      orbMoved = false;
      orbDownAt = { x: e.clientX, y: e.clientY };
      var r = orbEl.getBoundingClientRect();
      orbDrag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      try { orbEl.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });

    orbEl.addEventListener('pointermove', function (e) {
      if (!orbDrag) return;
      var dx = e.clientX - orbDrag.x, dy = e.clientY - orbDrag.y;
      if (!orbMoved && Math.abs(dx) + Math.abs(dy) < 7) return;
      orbMoved = true;
      orbEl.classList.add('dragging');
      orbEl.style.left = (orbDrag.left + dx) + 'px';
      orbEl.style.top = (orbDrag.top + dy) + 'px';
      orbEl.style.right = 'auto';
      orbEl.style.bottom = 'auto';
    });

    var finish = function (e) {
      if (!orbDrag) return;
      var wasMoved = orbMoved;
      var r = orbEl.getBoundingClientRect();
      orbEl.classList.remove('dragging');
      orbDrag = null;
      orbMoved = false;
      if (wasMoved) {
        // 吸附到最近的一侧，纵向位置记住
        var mid = r.left + r.width / 2;
        orbCfg.side = mid < (window.innerWidth / 2) ? 'left' : 'right';
        orbCfg.y = Math.round(r.top);
        saveOrbCfg();
        layoutOrb();
      } else if (orbDownAt) {
        open();
      }
    };
    orbEl.addEventListener('pointerup', finish);
    orbEl.addEventListener('pointercancel', function () {
      orbEl.classList.remove('dragging');
      orbDrag = null; orbMoved = false;
      layoutOrb();
    });
    orbEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    window.addEventListener('resize', layoutOrb);

    if ($('chkOrb')) $('chkOrb').addEventListener('click', function () {
      orbCfg.on = !orbCfg.on;
      saveOrbCfg();
      syncOrb();
      try { window.LureCast.toast && window.LureCast.toast(orbCfg.on ? '悬浮助手已打开' : '悬浮助手已收起'); } catch (e) {}
    });
    window.Agent.setOrb = function (on) { orbCfg.on = !!on; saveOrbCfg(); syncOrb(); };
    window.Agent.orbState = orbSet;
  }

  /* 面板开合时同步悬浮球显隐与「有新回答」 */
  function watchPanel() {
    var panel = $('modalAgent');
    if (!panel || !window.MutationObserver) return;
    new MutationObserver(function () {
      var open = !panel.classList.contains('hidden');
      if (open) { orbBadge(0); orbSet(busy ? 'busy' : 'idle'); }
      syncOrb();
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  }
  window.Agent = {
    bind: bind, open: function () { if (window.LureCast && window.LureCast.openModal) window.LureCast.openModal('modalAgent'); },
    ask: ask, tools: TOOLS, schemas: schemas, clear: function () { uiLog = []; saveHistory(); renderLog(); }
  };
})();
