/* LureCast · 界面与流程
   流程：定位 → 天气/海况/流量 → OSM 水域 → DEM 高程 → 环境分 → 岸线结构 → 钓点排序 → 渲染 */
(function () {
  'use strict';
  // 存储统一走 Store（IndexedDB 同步门面），失败时退回 localStorage
  var Store = window.Store || window.localStorage;

  /* ---------------------------------------------------------------- 用户配置
     口径有争议的一律交给用户选：评分偏好、水温来源、卫星兜底、路线服务。
     默认值取最保守的一档，都能在「设置 → 判定口径 / 路线」里改。 */
  var CFG = {
    score: 'balanced',        // balanced | pressure | temp | wind
    water: 'auto',            // auto（海表温，内陆用气温代理）| manual（自己填水温）
    waterManual: null,        // 手填水温（℃）
    satFallback: true,        // OSM 岸线取不到时，用卫星水面提岸线兜底
    route: 'osrm',            // osrm（公共演示服务器）| custom（自己的地址）| off（不请求，画直线）
    routeUrl: ''              // 自定义路由地址模板，支持 {profile}{fromLat}{fromLon}{toLat}{toLon}
  };

  function loadCfg() {
    try {
      var raw = Store.getItem('lc:cfg');
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          Object.keys(CFG).forEach(function (k) { if (o[k] !== undefined) CFG[k] = o[k]; });
        }
      }
    } catch (e) { /* 用默认 */ }
    applyCfg();
  }
  function saveCfg() {
    try { Store.setItem('lc:cfg', JSON.stringify(CFG)); } catch (e) { /* 忽略 */ }
    applyCfg();
  }
  function applyCfg() {
    // 权重只影响环境分：改完立刻按新权重重算，不用重新拉数据
    if (window.Engine && window.Engine.setProfile) window.Engine.setProfile(CFG.score);
  }

  var E = window.Engine;

  /* 构建标记：每次发版改这里。页面上能看到它，一眼就能判断「我现在看的是不是旧版」。
     index.html 里资源 URL 上的 ?v= 要同步改，否则 Service Worker 会继续喂旧 JS/CSS。 */
 var BUILD = '2026-10-19 · r8';
  var S = {
    me: null, place: null, tzOffset: 0,
    wx: null, sea: null, flood: null, osm: null,
    bodies: [], cands: [], spots: [], terrain: null,
    env: null, curve: [], windows: [], water: null,
    waterAuto: 'unknown', waterType: 'auto', species: 'general',
    stale: false, loading: false, selSpot: null,
    map: null, layers: null, error: null,
    sat: null, satMode: 'sdb', satBusy: false, satZoom: 0.9, tab: 'summary',
    locToken: 0, reqGen: 0, locSource: null
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function clockText(ms) {
    if (!isFinite(ms)) return '--:--';
    var d = new Date(ms);
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }
  function relTime(ts) {
    var d = Math.round((Date.now() - ts) / 60000);
    if (d <= 0) return '刚刚';
    if (d < 60) return d + ' 分钟前';
    return Math.round(d / 60) + ' 小时前';
  }

  function setStatus(kind, text, score, timeText) {
    var dot = $('statusDot');
    if (dot) dot.className = 'dot ' + (kind || 'off');
    if (text != null && $('statusText')) $('statusText').textContent = text;
    if (score != null && $('stripScore')) $('stripScore').textContent = score;
    if (timeText != null && $('stripTime')) $('stripTime').textContent = timeText;
  }

  /* ------------------------------------------------ 水体类型 */
  function detectWaterType() {
    var kinds = S.bodies.map(function (b) { return b.kind; });
    var sea = S.sea && S.sea.data && S.sea.data.current;
    if (sea && sea.wave_height != null) return 'sea';
    if (kinds.indexOf('sea') >= 0) return 'sea';
    if (kinds.indexOf('river') >= 0 || kinds.indexOf('stream') >= 0) return 'river';
    if (kinds.indexOf('reservoir') >= 0) return 'reservoir';
    if (kinds.indexOf('lake') >= 0) return 'lake';
    if (kinds.indexOf('pond') >= 0) return 'pond';
    if (S.flood && S.flood.data && S.flood.data.daily) return 'river';
    return 'unknown';
  }
  function effectiveType() {
    var t = S.waterType === 'auto' ? S.waterAuto : S.waterType;
    return t === 'unknown' ? 'lake' : t;
  }
  function typeLabel() {
    var map = {
      sea: '海/河口', river: '河流', stream: '溪流', canal: '渠道',
      reservoir: '水库/湖', lake: '湖/水库', pond: '塘/小水面', water: '水域'
    };
    return map[effectiveType()] || '未知水域';
  }
  function waterMode() {
    var t = effectiveType();
    if (t === 'sea') return 'sea';
    if (t === 'river' || t === 'stream' || t === 'canal') return 'river';
    return 'lake';
  }

  /* ------------------------------------------------ 环境分 */
  function nearestHourlyIndex(times, nowMs) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < times.length; i++) {
      var d = Math.abs(E.wallMs(times[i]) - nowMs);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function computeWater(nowMs) {
    var sea = S.sea && S.sea.data;
    var flood = S.flood && S.flood.data;
    var mode = waterMode();
    var out = { mode: mode };

    if (mode === 'sea' && sea && sea.hourly && sea.hourly.sea_level_height_msl) {
      var tide = E.tideAt({ tideHourly: sea.hourly }, nowMs);
      out.rate2h = tide.rate2h;
      out.phase = tide.phase || '平';
      out.tideLevel = sea.current ? sea.current.sea_level_height_msl : null;
      out.series = {
        labels: sea.hourly.time.slice(0, 24).map(function (t) { return t.slice(11, 16); }),
        values: sea.hourly.sea_level_height_msl.slice(0, 24),
        unit: 'm'
      };
      return out;
    }

    if (flood && flood.daily && flood.daily.river_discharge) {
      var q = flood.daily.river_discharge;
      var times = flood.daily.time;
      var idx = q.length - 1;
      while (idx > 0 && q[idx] == null) idx--;
      var i3 = Math.max(0, idx - 3);
      if (q[idx] != null && q[i3]) out.pct3d = (q[idx] - q[i3]) / q[i3] * 100;
      out.qToday = q[idx];
      out.qMean = flood.daily.river_discharge_mean ? flood.daily.river_discharge_mean[idx] : null;
      out.series = {
        labels: times.map(function (t) { return t.slice(5).replace('-', '/'); }),
        values: q, unit: 'm³/s'
      };
    }

    var daily = S.wx && S.wx.data && S.wx.data.daily;
    if (daily && daily.precipitation_sum) {
      var sums = daily.precipitation_sum;
      var n = Math.min(3, sums.length);
      var rain = 0, cnt = 0;
      for (var i = sums.length - n; i < sums.length; i++) {
        if (sums[i] != null) { rain += sums[i]; cnt++; }
      }
      out.rain3d = cnt ? rain : null;
    }
    return out;
  }

  function computeEnv() {
    var w = S.wx && S.wx.data;
    if (!w) return;
    var cur = w.current || {};
    var daily = w.daily || {};
    var hourly = w.hourly || {};
    var nowMs = E.nowWall(S.tzOffset || w.utc_offset_seconds || 0);
    S.nowMs = nowMs;

    var today = new Date(nowMs).toISOString().slice(0, 10);
    var di = (daily.time || []).indexOf(today);
    if (di < 0) di = Math.min(1, (daily.time || []).length - 1);
    var sunriseMs = daily.sunrise ? E.wallMs(daily.sunrise[di]) : NaN;
    var sunsetMs = daily.sunset ? E.wallMs(daily.sunset[di]) : NaN;
    S.sunriseMs = sunriseMs; S.sunsetMs = sunsetMs;

    var sea = S.sea && S.sea.data;
    var waterTemp = null, tempProxy = false;
    if (CFG.water === 'manual' && CFG.waterManual != null) {
      // 用户自己填了水温：以他的水温表/机载温度计为准，不做任何代理
      waterTemp = Number(CFG.waterManual);
      tempProxy = false;
    } else if (sea && sea.current && sea.current.sea_surface_temperature != null) {
      waterTemp = sea.current.sea_surface_temperature;
    } else if (daily.temperature_2m_max && daily.temperature_2m_min) {
      var d0 = di, d1 = Math.max(0, di - 1);
      var t0 = (daily.temperature_2m_max[d0] + daily.temperature_2m_min[d0]) / 2;
      var t1 = (daily.temperature_2m_max[d1] + daily.temperature_2m_min[d1]) / 2;
      waterTemp = t0 * 0.6 + t1 * 0.4;
      tempProxy = true;
    }
    S.waterTemp = waterTemp;
    S.tempProxy = tempProxy;

    var dP = null;
    if (hourly.pressure_msl && hourly.time) {
      var k = nearestHourlyIndex(hourly.time, nowMs);
      var a = hourly.pressure_msl[Math.max(0, k - 3)];
      var b = hourly.pressure_msl[k];
      if (a != null && b != null) dP = b - a;
    }

    var pp = null;
    if (hourly.precipitation_probability && hourly.time) {
      pp = hourly.precipitation_probability[nearestHourlyIndex(hourly.time, nowMs)];
    }

    S.water = computeWater(nowMs);
    var ctx = {
      species: S.species, waterTemp: waterTemp,
      pressure: cur.pressure_msl, dPressure3h: dP,
      windSpeed: cur.wind_speed_10m, windGust: cur.wind_gusts_10m,
      nowMs: nowMs, sunriseMs: sunriseMs, sunsetMs: sunsetMs,
      cloud: cur.cloud_cover, precipProb: pp, precip: cur.precipitation,
      water: S.water, hourly: hourly,
      tideHourly: sea && sea.hourly ? sea.hourly : null
    };
    S.envCtx = ctx;
    S.env = E.envScore(ctx);
    S.curve = E.hourCurve(ctx);
    S.windows = E.bestWindows(S.curve);
    S.dPi = dP;
    S.precipProb = pp;
  }

  /* ------------------------------------------------ 位置快照（本地秒开）
     定位/搜点确认后，把「算好的结果」整份存进 localStorage（按坐标 3 位小数分桶）。
     下次回到同一个点：先渲染快照（几十毫秒），再按各数据源的 TTL 决定是否后台更新。 */
  function snapKey() {
    if (!S.me) return null;
    return 'lc:snap:v2:' + S.me.lat.toFixed(3) + ',' + S.me.lon.toFixed(3);
  }

  function saveSnapshot() {
    var k = snapKey();
    if (!k || !S.env) return;
    var slim = (S.spots || []).slice(0, 8).map(function (x) {
      return {
        id: x.id, lat: x.lat, lon: x.lon, name: x.name, kind: x.kind, formText: x.formText,
        tags: x.tags, spotScore: x.spotScore, structScore: x.structScore,
        distToMe: x.distToMe, bearingFromMe: x.bearingFromMe, slopePct: x.slopePct,
        depth20: x.depth20, windward: x.windward, reasons: x.reasons, lure: x.lure
      };
    });
    var cur = S.wx && S.wx.data && S.wx.data.current;
    var snap = {
      at: Date.now(), me: S.me, tzOffset: S.tzOffset, nowMs: S.nowMs,
      waterAuto: S.waterAuto, waterTemp: S.waterTemp, tempProxy: S.tempProxy,
      env: S.env, curve: S.curve, windows: S.windows, water: S.water, terrain: S.terrain,
      spots: slim, placeHint: S.placeHint, satWater: S.satWater || null,
      wxCurrent: cur || null, wxAt: S.wx ? S.wx.at : null,
      dPi: S.dPi, precipProb: S.precipProb, timing: S.timing || null
    };
    try { Store.setItem(k, JSON.stringify(snap)); } catch (e) { /* 写失败就放弃快照 */ }
  }

  function restoreSnapshot() {
    var k = snapKey();
    if (!k) return null;
    var snap = null;
    try {
      var raw = Store.getItem(k);
      if (!raw) return null;
      snap = JSON.parse(raw);
    } catch (e) { return null; }
    if (!snap || !snap.env) return null;
    S.tzOffset = snap.tzOffset || 0;
    S.nowMs = snap.nowMs;
    S.waterAuto = snap.waterAuto || S.waterAuto;
    S.waterTemp = snap.waterTemp;
    S.tempProxy = snap.tempProxy;
    S.env = snap.env;
    S.curve = snap.curve || [];
    S.windows = snap.windows || [];
    S.water = snap.water || null;
    S.terrain = snap.terrain || null;
    S.spots = snap.spots || [];
    S.placeHint = S.placeHint || snap.placeHint || null;
    S.dPi = snap.dPi;
    S.precipProb = snap.precipProb;
    S.satWater = snap.satWater || null;
    if (snap.wxCurrent) {
      S.wx = { data: { current: snap.wxCurrent, daily: {}, hourly: {} }, at: snap.wxAt || snap.at, fromCache: true };
    }
    return snap;
  }

  /* ------------------------------------------------ 主流程 */
  function setBusy(on) {
    var b = $('btnRefresh');
    if (!b) return;
    b.classList.toggle('busy', !!on);
    b.disabled = !!on;
  }

  /* 解析 OSM 响应 → 候选岸线点（模块级，供并行 race 使用） */
  function osmStructure(res) {
    if (!res || !res.data) return { source: 'osm', cands: [], bodies: [], pick: [] };
    var bodies = E.parseBodies(res.data);
    var bc = E.buildCandidates(bodies, S.me);
    return { source: 'osm', cands: bc.candidates, bodies: bodies, pick: bc.bodies, res: res };
  }

  function refresh(force) {
    if (!S.me) { openModal('modalManual'); return Promise.resolve(); }
    if (S.loading) return Promise.resolve();
    var gen = ++S.reqGen;
    var t0 = performance.now();
    S.loading = true;
    setBusy(true);
    setStatus('live', '正在取数据…', null, null);

    var lat = S.me.lat, lon = S.me.lon;

    // 岸线与卫星兜底同时起跑：OSM 不稳定时不必干等（实测 OSM 15 s vs 卫星 4.3 s）
    var osmP = window.Api.osm(lat, lon, 1600, force)
      .catch(function (e) { S.osmError = e; return null; });
    var wideP = null;
    var satP = null;

    function satStructure() {
      if (!satP) {
        // 先给 OSM 2.5 s：它快的时候就不白拉卫星影像
        satP = new Promise(function (res) { setTimeout(res, 2500); })
          .then(function () { return satelliteCandidates(); })
          .catch(function () { return []; });
      }
      return satP;
    }

    return window.Api.weather(lat, lon, force).then(function (wx) {
      S.wx = wx;
      S.tzOffset = (wx.data && wx.data.utc_offset_seconds) || 0;
      // 气象一到就先画一版：Overpass 常常 10-30 秒，没必要让整页干等
      setStatus('live', '气象已到，正在取水域与岸线…', null, null);
      computeEnv();
      renderAll();
      // 卫星兜底立刻开始（不等 OSM），同时 OSM 也在跑；6 秒内谁先给出可用的岸线就用谁
      satStructure();
      var osmReady = osmP.then(function (r) {
        var parsed = osmStructure(r);
        S.osm = r || null;
        return parsed;
      });
      var fast = new Promise(function (resolve) {
        var settled = false;
        function win(v) { if (!settled) { settled = true; resolve(v); } }
        osmReady.then(function (st) { if (st.cands.length) win({ first: st }); });
        satStructure().then(function (cands) { if (cands.length) win({ first: { source: 'satellite', cands: cands } }); });
        setTimeout(function () { win(null); }, 6000);
      });

      var othersP = Promise.all([
        window.Api.marine(lat, lon, force).catch(function () { return null; }),
        window.Api.flood(lat, lon, force).catch(function () { return null; }),
        window.Api.reverse(lat, lon).catch(function () { return null; })
      ]);
      // 关键：不要把 osmReady 放进 Promise.all —— 否则 OSM 卡 12 s 就白等了
      return Promise.all([othersP, fast, satStructure()]).then(function (all) {
        return { others: all[0], fast: all[1], satCands: all[2], osmReady: osmReady };
      });
    }).then(function (bundle) {
      if (gen !== S.reqGen) return [];      // 位置又变了，这批结果作废
      var others = bundle.others || [];
      S.tData = performance.now() - t0;
      S.revalidating = [S.sea, S.flood].filter(function (x) { return x && x.revalidate; })
        .map(function (x) { return x.revalidate; });
      S.sea = others[0]; S.flood = others[1]; S.place = others[2];

      var first = bundle.fast && bundle.fast.first;
      if (first && first.source === 'osm') {
        // OSM 先到（最快路径）
        S.structureSource = 'osm';
        S.osm = first.res || null;
        S.bodies = first.bodies || [];
        S.cands = first.cands || [];
        S.pickBodies = first.pick || [];
        S.waterAuto = detectWaterType();
      } else {
        // 卫星先到 / OSM 还没回来：先用卫星岸线，OSM 到了再静默升级
        S.structureSource = 'satellite';
        S.osm = null;
        S.bodies = [];
        S.cands = (first && first.cands) || (bundle.satCands || []).slice();
        S.pickBodies = [];
        S.waterAuto = detectWaterType();
        bundle.osmReady.then(function (st) {
          if (gen !== S.reqGen || !st || !st.cands || !st.cands.length) return;
          S.bodies = st.bodies; S.osm = st.res; S.cands = st.cands; S.pickBodies = st.pick;
          S.structureSource = 'osm';
          S.waterAuto = detectWaterType();
          S.wideTried = false;
          if (S.wx) refresh(false);            // 用 OSM 岸线重算一遍（数据都在缓存里，很快）
        });
      }

      function afterBodies(prebuilt) {
        if (!prebuilt) {
          var bc = E.buildCandidates(S.bodies, S.me);
          S.cands = bc.candidates;
          S.pickBodies = bc.bodies;
        }
        S.structureSource = S.satWater ? 'satellite' : 'osm';
        var probes = [];
        S.cands.forEach(function (c) { probes = probes.concat(E.elevationProbes(c)); });
        if (!probes.length) return [];
        setStatus('live', '正在采样高程（' + probes.length + ' 个点）…', null, null);
        S.tElevStart = performance.now();
        S.probeCount = probes.length;
        return window.Api.elevation(probes).catch(function () { return []; });
      }

      // 1.6 km 内一点水域都没有？扩大到 4 km 再试一次（海边、大湖岸边很常见）
      if (S.cands.length) return afterBodies(true);   // race 已给出岸线

      if (!S.bodies.length && !S.wideTried && !(S.osmError && S.osmError.allFailed)) {
        S.wideTried = true;
        setStatus('live', '1.6 km 内没收录水域，扩大到 4 km 再试…', null, null);
        return window.Api.osm(lat, lon, 4000, true).catch(function () { return null; }).then(function (osm2) {
          if (osm2 && osm2.data) {
            S.osm = osm2;
            S.bodies = E.parseBodies(osm2.data);
            S.waterAuto = detectWaterType();
            S.osmError = null;
          }
          if (S.bodies.length) return afterBodies();
          // OSM 还是空的（服务挂了 / 真没收录）→ 用 Sentinel-2 水面兜底
          return satStructure().then(function (cands) {
            if (cands && cands.length) { S.cands = cands; return afterBodies(true); }
            if (S.satFallbackError) {
              setStatus('off', '岸线数据取不到：OSM 与卫星兜底都失败（' + S.satFallbackError + '）', null, null);
            }
            return afterBodies(false);
          });
        });
      }
      if (!S.bodies.length) {
        return satStructure().then(function (cands) {
          if (cands && cands.length) { S.cands = cands; return afterBodies(true); }
          if (S.satFallbackError) {
            setStatus('off', 'OSM 岸线取不到，卫星水面兜底也失败：' + S.satFallbackError, null, null);
          }
          return afterBodies(false);
        });
      }
      return afterBodies();
    }).then(function (elev) {
      if (gen !== S.reqGen) return;
      S.tElev = S.tElevStart ? Math.round(performance.now() - S.tElevStart) : 0;
      var windTo = windToDeg();
      S.cands.forEach(function (c, i) {
        var h = elev.slice ? elev.slice(i * 5, i * 5 + 5) : [];
        if (h.length === 5) E.applyTerrain(c, h);
        E.markWind(c, windTo);
      });
      computeEnv();
      rebuildSpots();
      var tCompute = performance.now();
      S.loading = false;
      setBusy(false);
      renderAll();
      var tRender = performance.now();
      var cachedCount = [S.wx, S.sea, S.flood, S.osm].filter(function (x) { return x && x.fromCache; }).length;
      S.timing = {
        data: Math.round(S.tData || 0),
        elev: S.tElev || 0,
        compute: Math.round(tCompute - t0 - (S.tData || 0) - (S.tElev || 0)),
        render: Math.round(tRender - tCompute),
        total: Math.round(tRender - t0),
        cached: cachedCount,
        probes: S.probeCount || 0,
        sat: S.tSat || 0
      };
      saveSnapshot();
      if (S.timing) renderMeta();
      stampStatus();
      // 有源在后台更新 → 更新完再来一次（此时全命中缓存，几乎瞬时）
      if (S.revalidating && S.revalidating.length) {
        Promise.all(S.revalidating).then(function (res) {
          var changed = res.some(function (x) { return x; });
          S.revalidating = null;
          if (changed && gen === S.reqGen) setTimeout(function () { refresh(false); }, 250);
        });
      }
    }).catch(function (err) {
      S.loading = false;
      setBusy(false);
      S.error = err;
      if (S.wx && S.wx.data) {
        S.cands.forEach(function (c) { E.markWind(c, windToDeg()); });
        computeEnv();
        rebuildSpots();
        renderAll();
        setStatus('cache', '网络异常，正在显示 ' + relTime(S.wx.at) + ' 的缓存', S.env ? S.env.score : '--', clockText(S.nowMs));
      } else {
        setStatus('off', '取数没成功：' + (err && err.message ? err.message : '未知错误') + '（点刷新重试，或换个位置）', '--', '--:--');
        renderAll();
      }
    });
  }

  /* 用一张 Sentinel-2 水面掩膜提岸线点：OSM 不可用 / 站在大湖中心时的兜底。
     半径自适应 2 → 5 → 10 km；**只返回候选数组，不碰 S.cands**（并行时不会互相踩）。 */
  function satelliteCandidates() {
    if (!CFG.satFallback) return Promise.resolve([]);   // 用户在设置里关掉了卫星兜底
    if (!window.Sat || !window.Sat.waterCandidates) return Promise.resolve([]);
    var radii = [2, 5, 10];
    var best = null;
    var t0 = performance.now();
    return ensureGeoTIFF().then(function () {
      var i = 0;
      function next() {
        if (i >= radii.length) return best;
        var rk = radii[i++];
        return window.Sat.waterCandidates(S.me.lon, S.me.lat, rk, { px: 512, maxPoints: 24 })
          .then(function (r) {
            if (!best || r.points.length > best.points.length) { best = r; best.radiusKm = rk; }
            if (r.points.length >= 6) return best;
            return next();
          })
          .catch(function () { return next(); });
      }
      return next();
    }).then(function (r) {
      if (!r) return [];
      S.satWater = {
        date: r.item.date, cloud: r.item.cloud, points: r.points.length,
        resolution: r.resolution, radiusKm: r.radiusKm
      };
      S.tSat = Math.round(performance.now() - t0);
      var cands = r.points.map(function (pt, i) {
        return {
          id: 'sat:' + i, bodyId: 'sat', name: '卫星水面', kind: 'water', linear: false,
          lat: pt.lat, lon: pt.lon,
          n1: pt.landBearing, n2: pt.waterBearing, waterSide: pt.waterBearing,
          tangent: (pt.waterBearing + 90) % 360, bulgeDir: null, bulgeH: 0,
          distToMe: E.dist(S.me, pt), bearingFromMe: E.bearing(S.me, pt),
          satSource: true
        };
      });
      cands.sort(function (a, b) { return a.distToMe - b.distToMe; });
      return cands.slice(0, 24);
    }).catch(function (err) {
      S.satFallbackError = err && err.message ? err.message : String(err);
      return [];
    });
  }

  function windToDeg() {
    var cur = S.wx && S.wx.data && S.wx.data.current;
    if (!cur || cur.wind_direction_10m == null) return 0;
    return (cur.wind_direction_10m + 180) % 360;
  }

  function rebuildSpots() {
    if (!S.env) return;
    var cur = S.wx.data.current || {};
    S.terrain = E.terrainSummary(S.cands);
    S.spots = E.pickSpots(S.cands, {
      envScore: S.env.score, species: S.species, windSpeed: cur.wind_speed_10m,
      sat: S.sat && S.sat.anomalies ? S.sat.anomalies : null
    });
    if (S.selSpot) {
      var found = S.spots.filter(function (s) { return s.id === S.selSpot.id; })[0];
      S.selSpot = found || null;
    }
  }

  function stampStatus() {
    var caches = [S.wx, S.sea, S.flood, S.osm].filter(Boolean);
    var stale = caches.some(function (c) { return c.stale; });
    var fromCache = caches.length > 0 && caches.every(function (c) { return c.fromCache; });
    var at = S.wx ? S.wx.at : Date.now();
    if (S.error || stale) {
    setStatus('cache', '缓存 ' + relTime(at) + ' · 可刷新', S.env ? S.env.score : '--', clockText(S.nowMs));
    } else if (fromCache) {
      setStatus('cache', '数据 ' + relTime(at) + ' · 缓存有效', S.env ? S.env.score : '--', clockText(S.nowMs));
    } else {
      var t = S.timing;
      var txt = '数据已更新 · ' + typeLabel();
      if (t && t.total > 5000) {
    txt = '首次取数 ' + Math.round(t.total / 100) / 10 + ' s · 下次同地点约 0.2 s';
      } else if (t) {
        txt += ' · ' + t.total + ' ms';
      }
      setStatus('live', txt, S.env ? S.env.score : '--', clockText(S.nowMs));
    }
  }
  /* ------------------------------------------------ 骨架屏（数据没到就别显示无效内容） */
  function skelInto(el, n, note) {
    if (!el) return;
    var msg = note || (window.I18N ? I18N.t('empty.loading') : '正在加载…');
    var cells = '';
    for (var i = 0; i < (n || 4); i++) cells += '<div class="skelcard"></div>';
    el.innerHTML = '<div class="skelbox"><div class="skelrow">' + cells + '</div>' +
      '<div class="skelnote"><span class="dot"></span>' + msg + '</div></div>';
  }
  function showSkeletons() {
    var msg = window.I18N ? I18N.t('empty.loading') : '正在加载…';
    skelInto($('weatherGrid'), 6);
    skelInto($('windSkel'), 2);
    skelInto($('waterBody'), 4);
    skelInto($('terrainBody'), 6);
    skelInto($('timeBody'), 6);
    skelLines($('factorList'), 6);
    skelInto($('spotList'), 3);
    var v = $('verdictTitle'), vp = $('verdictText');
    if (v) v.textContent = msg;
    if (vp) vp.textContent = '定位确认后这里会给出结论与最佳时段。';
    var sv = $('scoreVal');
    if (sv) sv.textContent = '--';
  }

  function skelLines(el, n) {
    if (!el) return;
    var l = '';
    for (var i = 0; i < (n || 3); i++) l += '<div class="skelline ' + (i % 3 === 0 ? 'w80' : (i % 3 === 1 ? 'w60' : 'w40')) + '"></div>';
    el.innerHTML = '<div class="skelbox">' + l +
      '<div class="skelnote"><span class="dot"></span>' + (window.I18N ? I18N.t('empty.loading') : '正在加载…') + '</div></div>';
  }
  function hasWeather() { return !!(S.wx && S.wx.data && S.wx.data.current); }

  /* ------------------------------------------------ 渲染 */
  function renderAll() {
    renderLoc(); renderChips(); renderScore(); renderSpots();
    renderWeather(); renderWind(); renderWater(); renderTerrain();
    renderTime(); renderFactors(); renderMeta(); drawMap();
    if (window.My && window.My.render && S.tab === 'me') window.My.render();
  }

  function kvHtml(label, value, sub) {
    return '<div class="kv"><i>' + label + '</i><b>' + value + '</b>' +
      (sub ? '<em style="font-style:normal;font-size:var(--tiny);color:var(--ink-3)">' + sub + '</em>' : '') + '</div>';
  }

  function renderLoc() {
    var box = $('locBody');
    if (!box) return;
    if (!S.me) {
      box.innerHTML = '<div class="empty"><b>还没定位</b><p>允许浏览器定位，或点右上「找水域」手动搜索一个湖/河/海。</p></div>';
      return;
    }
    var place = S.place || {};
    var name = S.placeHint || place.name ||
      (place.address && (place.address.city || place.address.town || place.address.county)) || '未命名位置';
    var addr = place.display_name || '';
    var nearBody = (S.pickBodies && S.pickBodies[0]) || null;
    if (!nearBody && S.satWater) {
      box.innerHTML = '<div class="loctitle"><b>' + esc(S.placeHint || '当前位置') + '</b><span>' +
        S.me.lat.toFixed(4) + ', ' + S.me.lon.toFixed(4) + '</span></div>' +
        '<div class="locgrid">' +
        kvHtml('水域类型', typeLabel()) +
        kvHtml('岸线来源', '卫星水面（OSM 不可用）') +
        kvHtml('候选岸线点', S.cands.length + ' 个') +
        kvHtml('影像', S.satWater.date + ' · ' + Math.round(S.satWater.resolution) + ' m') +
        '</div>';
      return;
    }
    var near = nearBody ? (nearBody.name || typeLabel())
      : (S.bodies.length ? S.bodies[0].name : '附近没有 OSM 收录的水域');
    var nearDist = nearBody ? (nearBody.minDist != null && isFinite(nearBody.minDist)
      ? nearBody.minDist : E.dist(S.me, nearBody.center)) : null;
    var acc = S.me.acc ? '+-' + Math.round(S.me.acc) + ' m' : '精度未知';
    box.innerHTML =
      '<div class="loctitle"><b>' + esc(name) + '</b><span>' + S.me.lat.toFixed(4) + ', ' + S.me.lon.toFixed(4) + ' · ' + acc + '</span></div>' +
      (addr ? '<div class="card-note" style="margin-top:4px">' + esc(addr) + '</div>' : '') +
      '<div class="locgrid">' +
      kvHtml('水域类型', typeLabel() + (S.waterType === 'auto' ? ' · 自动' : ' · 手动')) +
      kvHtml('最近水域', esc(near) + (nearDist != null ? ' · ' + E.fmtDist(nearDist) : '')) +
      kvHtml('候选岸线点', S.cands.length ? S.cands.length + ' 个' : '无') +
      kvHtml('位置来源', S.locSource === 'gps' ? 'GPS 定位'
        : (S.locSource === 'url' ? '链接参数' : '手动选点')) +
      '</div>';
      '</div>';
  }

  function renderChips() {
    var wc = $('waterChips'), sc = $('speciesChips');
    if (wc) {
      var opts = [['auto', '自动'], ['reservoir', '水库/湖'], ['river', '河流'], ['sea', '海/河口']];
      wc.innerHTML = '<span class="chiprow-key">水域</span>' + opts.map(function (o) {
        var on = S.waterType === o[0] ? ' on' : '';
        return '<button class="chip' + on + '" data-water="' + o[0] + '">' + o[1] +
          (o[0] === 'auto' && S.waterAuto && S.waterAuto !== 'unknown' ? ' <em>' + typeLabel() + '</em>' : '') + '</button>';
      }).join('');
      Array.prototype.forEach.call(wc.querySelectorAll('[data-water]'), function (b) {
        b.addEventListener('click', function () {
          S.waterType = b.getAttribute('data-water');
          if (S.wx) { computeEnv(); rebuildSpots(); renderAll(); stampStatus(); } else { renderChips(); }
        });
      });
    }
    if (sc) {
      var keys = Object.keys(E.SPECIES);
      sc.innerHTML = '<span class="chiprow-key">目标鱼</span>' + keys.map(function (k) {
        var on = S.species === k ? ' on' : '';
        return '<button class="chip' + on + '" data-sp="' + k + '">' + E.SPECIES[k].label + '</button>';
      }).join('');
      Array.prototype.forEach.call(sc.querySelectorAll('[data-sp]'), function (b) {
        b.addEventListener('click', function () {
          S.species = b.getAttribute('data-sp');
          if (S.wx) { computeEnv(); rebuildSpots(); renderAll(); stampStatus(); } else { renderChips(); }
        });
      });
    }
  }

  function verdictOf(score) {
    if (score == null) return { t: '等待数据…', p: '定位后会给出结论、最佳时段和注意点。' };
    if (score >= 80) return { t: '值得专门跑一趟', p: '环境要素大多落在鱼活跃的区间；把时间压进下面标出的窗口，优先去榜单前两个点。' };
    if (score >= 65) return { t: '可以去，但要挑对岸和时段', p: '整体条件中等偏上；重点看风把哪一岸的水推向岸脚，以及气压有没有在动的迹象。' };
    if (score >= 48) return { t: '一般，就近打一打', p: '环境处在中间地带：能出鱼，但需要更多换饵与换点，别把期待放在单一标点。' };
    return { t: '不建议专程跑', p: '主要因子（气压/水温/风或水位）明显不利；除非你很熟这个点，否则换个天气再来。' };
  }

  function renderScore() {
    var env = S.env;
    var v = verdictOf(env ? env.score : null);
    if ($('verdictTitle')) $('verdictTitle').textContent = v.t;
    if ($('verdictText')) $('verdictText').textContent = v.p;
    if ($('scoreVal')) $('scoreVal').textContent = env ? env.score : '--';
    if ($('dial')) $('dial').style.setProperty('--pct', env ? env.score : 0);
    if ($('scoreNote')) $('scoreNote').textContent = env ? typeLabel() + ' · ' + E.SPECIES[S.species].label : '环境综合';

    var blips = [];
    if (S.windows && S.windows.length) {
      var w0 = S.windows[0];
      blips.push('<span class="blip ok">最佳 ' + w0.from.slice(11, 16) + '–' + w0.to.slice(11, 16) + '（' + w0.score + ' 分）</span>');
    }
    if (S.env && S.env.factors) {
      var worst = S.env.factors.slice().sort(function (a, b) { return a.score - b.score; })[0];
      if (worst && worst.score < 60) blips.push('<span class="blip bad">短板：' + worst.label + ' ' + worst.score + '</span>');
    }
    var cur = S.wx && S.wx.data && S.wx.data.current;
    if (cur && cur.wind_direction_10m != null) {
      blips.push('<span class="blip">风朝 ' + E.compass((cur.wind_direction_10m + 180) % 360) + ' 吹 · ' + Math.round(cur.wind_speed_10m) + ' m/s</span>');
    }
    if ($('verdictBlips')) $('verdictBlips').innerHTML = blips.join('');
  }

  function renderSpots() {
    var box = $('spotList');
    if (!box) return;
    if (S.loading && !S.spots.length) {
      skelInto(box, 3);
      if ($('spotNote')) $('spotNote').textContent = window.I18N ? I18N.t('empty.loading') : '正在加载…';
      return;
    }
    if (!S.spots.length) {
      box.innerHTML = '<div class="empty"><b>附近没有可用的岸线结构</b>' +
        '<p>OSM 里这一带（1.6 km，已尝试扩到 4 km）没有收录有形状的水域或海岸线。可以：换到水域边上再定位、「找水域」搜索具体湖名、或把目标鱼换成通用再看。</p>' +
        '<p>如果这里本来就是外海或大水面中心，岸钓确实没有「岸」可打 —— 这种情况要靠船钓点位，本应用给不出。</p>' +
        '<p>也可能是 OpenStreetMap Overpass 全部端点在限流（免费公共服务，实测 overpass-api.de 会整段 502）。' +
        '<b>不需要任何 API Key</b>：本应用已按 de → private.coffee → kumi → mail.ru 自动切换，全都挂了就切回 12 小时内的旧结果。</p>' +
        '<button class="act" id="btnRetrySpots" style="margin-top:4px">重新查询岸线</button></div>';
      if ($('spotNote')) $('spotNote').textContent = '无数据 · 试着手动选水域';
      bindRetry(box);
      return;
    }
    if ($('spotNote')) $('spotNote').textContent = '候选 ' + S.spots.length + ' 个 · 环境 50% / 结构 40% / 可达 10%';
    var html = S.spots.slice(0, 6).map(function (s, i) {
      var lv = s.spotScore >= 75 ? 'lv-hi' : (s.spotScore >= 55 ? 'lv-mid' : 'lv-low');
      var on = S.selSpot && S.selSpot.id === s.id ? ' on' : '';
      var tags = s.tags.map(function (t) {
        return '<i class="' + (t.hi ? 'hi' : '') + '">' + esc(t.txt) + '</i>';
      }).join('');
      return '<button class="spot ' + lv + on + '" data-spot="' + i + '">' +
        '<span class="rank">' + (i + 1) + '</span>' +
        '<span class="spot-main">' +
        '<span class="spot-title"><b>' + esc(s.name || '无名水域') + (s.formText ? ' · ' + esc(s.formText) : '') + '</b>' +
        '<em>' + E.fmtDist(s.distToMe) + ' · ' + E.compass(s.bearingFromMe) + '面</em></span>' +
        '<span class="spot-tags">' + tags + '</span>' +
        '<span class="spot-why">' + esc(s.reasons.join('；')) + '</span>' +
        '<span class="spot-why">建议拟饵：' + esc(s.lure.join(' / ')) + '</span>' +
        '</span>' +
        '<span class="spot-side"><b>' + s.spotScore + '</b><em>分</em></span>' +
        '</button>';
    }).join('');
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll('[data-spot]'), function (b) {
      b.addEventListener('click', function () {
        var sel = S.spots[parseInt(b.getAttribute('data-spot'), 10)];
        S.selSpot = sel;
        renderSpots();
        focusSpot(sel);
      });
    });
  }

  function bindRetry(box) {
    var btn = box && box.querySelector ? box.querySelector('#btnRetrySpots') : null;
    if (btn) btn.addEventListener('click', function () { refresh(true); });
  }

  function weatherText(code) {
    if (code == null) return '天气未知';
    if (code === 0) return '晴';
    if (code <= 2) return '少云';
    if (code === 3) return '阴';
    if (code >= 45 && code <= 48) return '雾';
    if (code >= 51 && code <= 57) return '毛毛雨';
    if (code >= 61 && code <= 67) return '雨';
    if (code >= 71 && code <= 77) return '雪';
    if (code >= 80 && code <= 82) return '阵雨';
    if (code >= 95) return '雷雨';
    return '多云';
  }

  function renderWeather() {
    var grid = $('weatherGrid');
    if (!grid) return;
    var w = S.wx && S.wx.data;
    if (!hasWeather()) { skelInto(grid, 6); return; }
    var c = w.current || {};
    var code = weatherText(c.weather_code);
    var cells = [
      ['气温', c.temperature_2m != null ? Math.round(c.temperature_2m * 10) / 10 : '--', '℃', code],
      ['体感', c.apparent_temperature != null ? Math.round(c.apparent_temperature) : '--', '℃', '风寒/闷热修正'],
      ['湿度', c.relative_humidity_2m != null ? Math.round(c.relative_humidity_2m) : '--', '%', '低湿多为高压晴稳'],
      ['气压', c.pressure_msl != null ? Math.round(c.pressure_msl * 10) / 10 : '--', 'hPa',
        S.dPi != null ? '3h ' + (S.dPi > 0 ? '+' : '') + Math.round(S.dPi * 10) / 10 : '趋势未知'],
      ['云量', c.cloud_cover != null ? Math.round(c.cloud_cover) : '--', '%', '散射光更利靠边'],
      ['降水', c.precipitation != null ? Math.round(c.precipitation * 10) / 10 : '--', 'mm/h',
        S.precipProb != null ? '概率 ' + Math.round(S.precipProb) + '%' : '概率未知']
    ];
    grid.innerHTML = cells.map(function (x) {
      return '<div class="st"><i>' + x[0] + '</i><b>' + x[1] + '<u>' + x[2] + '</u></b><em>' + esc(x[3]) + '</em></div>';
    }).join('');
    if ($('weatherNote')) $('weatherNote').textContent = code;
    if ($('weatherFoot')) $('weatherFoot').textContent = 'Open-Meteo · ' + (S.wx.fromCache ? '缓存 ' + relTime(S.wx.at) : '刚刚拉取');
  }

  /* 罗盘：指针用 rAF 平滑追随目标风向（换小时/刷新时都会"转"过去），
     而不是瞬间跳变；同时给出未来 1/3/6 小时的风向，方便判断风怎么转。 */
  var compass = { cur: 0, target: 0, raf: 0, started: false };

  function compassTick() {
    var arrow = $('windArrow');
    if (!arrow) { compass.raf = 0; return; }
    var diff = ((compass.target - compass.cur + 540) % 360) - 180;   // 走最短弧
    compass.cur = (compass.cur + diff * 0.12 + 360) % 360;
    arrow.style.transform = 'rotate(' + ((compass.cur + 180) % 360).toFixed(2) + 'deg)';   // SVG 的针尖画在正下方，+180 才对得上正北朝上
    if (Math.abs(diff) > 0.3) {
      compass.raf = requestAnimationFrame(compassTick);
    } else {
      compass.cur = compass.target;
      arrow.style.transform = 'rotate(' + ((compass.cur + 180) % 360).toFixed(2) + 'deg)';
      compass.raf = 0;
    }
  }

  function pointCompass(deg) {
    compass.target = ((deg % 360) + 360) % 360;
    if (!compass.started) { compass.cur = compass.target; compass.started = true; }
    if (!compass.raf) compass.raf = requestAnimationFrame(compassTick);
  }

  function hourlyAt(hourOffset) {
    var w = S.wx && S.wx.data;
    if (!w || !w.hourly || !w.hourly.time) return null;
    var H = w.hourly;
    var k = nearestHourlyIndex(H.time, S.nowMs || E.nowWall(S.tzOffset || 0)) + hourOffset;
    if (k < 0 || k >= H.time.length) return null;
    if (H.wind_direction_10m[k] == null) return null;
    return {
      dir: H.wind_direction_10m[k],
      speed: H.wind_speed_10m ? H.wind_speed_10m[k] : null,
      gust: H.wind_gusts_10m ? H.wind_gusts_10m[k] : null,
      time: H.time[k]
    };
  }

  function renderWind() {
    var cur = S.wx && S.wx.data && S.wx.data.current;
    if (!cur || cur.wind_speed_10m == null) {
      skelInto($('windSkel'), 2);
      return;
    }
    var from = cur.wind_direction_10m;
    var to = (from + 180) % 360;
    pointCompass(to);
    if ($('windSkel')) $('windSkel').innerHTML = '';
    if ($('windNote')) $('windNote').textContent = Math.round(cur.wind_speed_10m) + ' m/s · 阵风 ' + Math.round(cur.wind_gusts_10m || 0);

    // 未来 1/3/6 小时
    var row = $('windHours');
    if (row) {
      var opts = [[0, '现在'], [1, '+1h'], [3, '+3h'], [6, '+6h']];
      row.innerHTML = '<span class="chiprow-key" style="width:auto">风后报</span>' + opts.map(function (o) {
        var h = hourlyAt(o[0]);
        if (!h) return '';
        return '<button class="chip" data-windh="' + o[0] + '">' + o[1] +
          ' <em>' + E.compass((h.dir + 180) % 360) + ' ' + Math.round(h.speed || 0) + ' m/s</em></button>';
      }).join('');
      Array.prototype.forEach.call(row.querySelectorAll('[data-windh]'), function (b) {
        b.addEventListener('click', function () {
          var h = hourlyAt(parseInt(b.getAttribute('data-windh'), 10));
          if (!h) return;
          pointCompass((h.dir + 180) % 360);
          Array.prototype.forEach.call(row.querySelectorAll('[data-windh]'), function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          if ($('windNote')) $('windNote').textContent = h.time.slice(11, 16) + ' · ' + Math.round(h.speed || 0) + ' m/s' +
            (h.gust != null ? ' · 阵风 ' + Math.round(h.gust) : '');
        });
      });
    }

    var windward = S.cands.filter(function (c) { return c.windward === true; });
    var shores = windward.reduce(function (acc, c) {
      var k = E.compass(c.landBearing);
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    var top = Object.keys(shores).sort(function (a, b) { return shores[b] - shores[a]; })[0];
    var txt = '风从 <b>' + E.compass(from) + '</b> 吹向 <b>' + E.compass(to) + '</b>，' +
      Math.round(cur.wind_speed_10m) + ' m/s（' + Math.round(cur.wind_speed_10m * 3.6) + ' km/h）';
    if (top) txt += '。<br>这一带共 ' + windward.length + ' 个采样岸段是迎风岸，主要集中在 <b>' + top + '岸</b>：那里水面翻涌、饵鱼被推挤，通常是最好的搜索方向。';
    else if (S.cands.length) txt += '。<br>没有明显的迎风岸段（风向与各岸线夹角都不大），优先按结构和阴影找鱼。';
    if ($('windText')) $('windText').innerHTML = txt;
  }

  function cell(label, value, unit, note) {
    return '<div class="st"><i>' + label + '</i><b>' + value + (unit ? '<u>' + unit + '</u>' : '') +
      '</b><em>' + esc(note || '') + '</em></div>';
  }

  function renderWater() {
    var body = $('waterBody');
    if (!body) return;
    var w = S.water;
    if (!w) { skelInto(body, 4); return; }
    var title = $('waterTitle');
    var html = '';
    if (w.mode === 'sea') {
      if (title) title.textContent = '潮汐与海况';
      if ($('waterNote')) $('waterNote').textContent = w.rate2h != null ? (w.rate2h > 0 ? '涨潮' : (w.rate2h < 0 ? '落潮' : '平潮')) : '--';
      var sea = (S.sea.data && S.sea.data.current) || {};
      html += '<div class="statgrid">' +
        cell('潮位', w.tideLevel != null ? Math.round(w.tideLevel * 100) / 100 : '--', 'm', '相对平均海面') +
        cell('2h 变化', w.rate2h != null ? (w.rate2h > 0 ? '+' : '') + Math.round(w.rate2h * 100) / 100 : '--', 'm', w.phase + '潮') +
        cell('浪高', sea.wave_height != null ? Math.round(sea.wave_height * 10) / 10 : '--', 'm', sea.wave_period ? '周期 ' + sea.wave_period + 's' : '') +
        cell('海表温', sea.sea_surface_temperature != null ? Math.round(sea.sea_surface_temperature * 10) / 10 : '--', '℃', '卫星/模式融合') +
        '</div>';
      if ($('waterFoot')) $('waterFoot').textContent = '潮位来自 Open-Meteo Marine 模式（非港航实测潮汐表），下水前以现场与官方潮汐为准。';
    } else {
      if (title) title.textContent = w.mode === 'river' ? '流量与水位趋势' : '水位趋势（代理）';
      if ($('waterNote')) $('waterNote').textContent = w.mode === 'river' ? 'GloFAS 流量' : '降水/汇流代理';
      html += '<div class="statgrid">' +
        cell('今日流量', w.qToday != null ? Math.round(w.qToday) : '--', 'm³/s', '或为汇流量级') +
        cell('3 天变化', w.pct3d != null ? (w.pct3d > 0 ? '+' : '') + Math.round(w.pct3d) : '--', '%', '正＝水位上升') +
        cell('3 天降水', w.rain3d != null ? Math.round(w.rain3d * 10) / 10 : '--', 'mm', '入水口是否活跃') +
        cell('实测水位', '无', '', w.mode === 'river' ? '由流量趋势推断' : '无免费接口') +
        '</div>';
      if ($('waterFoot')) $('waterFoot').textContent = w.mode === 'river'
        ? 'GloFAS 是全球汇流模拟的河道流量，不等于实测水位；有闸坝的河段误差更大。'
        : '湖库没有免费实测水位/库容接口，这里用近 3 天降水与汇流趋势做代理，只用于判断「涨/稳/退」。';
    }
    if (w.series && w.series.values) html += lineChart(w.series, w.mode === 'sea' ? 'tide' : 'discharge');
    body.innerHTML = html;
  }

  function renderTerrain() {
    var box = $('terrainBody');
    if (!box) return;
    var t = S.terrain;
    if (!S.wx) { box.className = ''; skelInto(box, 6); return; }
    if (!t || !t.sampled) {
      box.className = 'empty';
      box.innerHTML = '<b>还没有岸线数据</b><p>需要 OSM 收录的水域几何 + 高程采样；换个靠水的位置再试。</p>';
      if ($('terrainNote')) $('terrainNote').textContent = '--';
      return;
    }
    box.className = '';
    if ($('terrainNote')) $('terrainNote').textContent = t.sampled + ' 个岸段采样';
    box.innerHTML = '<div class="statgrid">' +
      cell('岸坡中位数', t.medianSlope != null ? Math.round(t.medianSlope) : '--', '%', '岸上 120 m 高差/距离') +
      cell('陡岸段', t.steepCount + '/' + t.sampled, '', '坡度 ≥ 10%') +
      cell('岬角 / 湾', t.pointCount + ' / ' + t.bayCount, '', '岸线凸凹判定') +
      cell('迎风岸段', t.windCount, '个', '风向正吹向岸') +
      cell('近岸 20m 深', t.medianDepth20 != null ? t.medianDepth20.toFixed(1) : '--', 'm', '中位数（推断）') +
      cell('最深估点', t.maxDepth20 != null ? t.maxDepth20.toFixed(1) : '--', 'm', '按最陡岸坡外推') +
      '</div>';
  }

  function renderTime() {
    var box = $('timeBody');
    if (!box) return;
    if (!S.curve.length) {
      if (!S.wx) { box.className = ''; skelInto(box, 6); return; }
      box.className = 'empty';
      box.innerHTML = '<b>暂无逐小时数据</b><p>刷新后会给出一条 24 小时环境分曲线，并标出今天最好的两个时段。</p>';
      return;
    }
    box.className = '';
    var bars = S.curve.map(function (p, i) {
      var h = Math.max(4, p.score);
      var hot = p.score >= 75 ? ' hot' : '';
      var x = i * (100 / S.curve.length) + 0.5;
      var wdt = 100 / S.curve.length - 1;
      return '<rect class="bar' + hot + '" x="' + x.toFixed(2) + '" y="' + (100 - h).toFixed(1) +
        '" width="' + wdt.toFixed(2) + '" height="' + h.toFixed(1) + '" rx="0.9"></rect>';
    }).join('');
    var first = S.curve[0], last = S.curve[S.curve.length - 1];
    var winTxt = S.windows.map(function (w) {
      return w.from.slice(11, 16) + '–' + w.to.slice(11, 16) + '（' + w.score + ' 分）';
    }).join(' · ');
    if ($('timeNote')) $('timeNote').textContent = S.windows.length ? '最佳 ' + S.windows[0].from.slice(11, 16) + ' 起' : '时窗';
    box.innerHTML = '<div class="chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none">' +
      '<line class="grid-line" x1="0" y1="25" x2="100" y2="25" vector-effect="non-scaling-stroke"></line>' +
      '<line class="grid-line" x1="0" y1="50" x2="100" y2="50" vector-effect="non-scaling-stroke"></line>' +
      bars + '</svg></div>' +
      '<div class="axis"><span>' + first.t.slice(11, 16) + '</span>' +
      '<span>' + S.curve[Math.floor(S.curve.length / 2)].t.slice(11, 16) + '</span>' +
      '<span>' + last.t.slice(11, 16) + '</span></div>' +
      '<div class="card-note" style="margin-top:2px">' +
      (window.I18N ? I18N.t('chart.hourCurve') : '小时') + ' · 柱高＝环境分 0–100</div>' +
      '<div class="card-note" style="margin-top:8px">最佳窗口：' + (winTxt || '数据不足') +
      '。柱高＝该小时的同一套环境分（不含点位结构）。</div>';
  }

  function lineChart(series, kind) {
    var vals = series.values.filter(function (v) { return v != null; });
    if (vals.length < 2) return '';
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = (max - min) || 1;
    var pts = [];
    series.values.forEach(function (v, i) {
      if (v == null) return;
      pts.push([i / (series.values.length - 1) * 100, 96 - (v - min) / span * 84]);
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1][0].toFixed(2) + ' 100 L0 100 Z';
    var labels = series.labels || [];
    return '<div class="chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none">' +
      '<path class="area" d="' + area + '"></path>' +
      '<path class="line" d="' + line + '" vector-effect="non-scaling-stroke"></path>' +
      '</svg></div>' +
      '<div class="axis"><span>' + (labels[0] || '') + '</span>' +
      '<span>' + (labels[Math.floor(labels.length / 2)] || '') + '</span>' +
      '<span>' + (labels[labels.length - 1] || '') + '</span></div>' +
      '<div class="card-note" style="margin-top:6px">' +
      (window.I18N ? I18N.t(kind === 'tide' ? 'chart.tide' : 'chart.discharge') : '时间轴') +
      ' · 单位 ' + esc(series.unit || '') + ' · 区间 ' + Math.round(min * 100) / 100 + ' – ' +
      Math.round(max * 100) / 100 + '</div>';
  }

  function renderFactors() {
    var box = $('factorList');
    if (!box) return;
    if (!S.env) { skelLines(box, 6); return; }
    box.innerHTML = S.env.factors.map(function (f) {
      return '<div class="frow"><i>' + f.label + '</i>' +
        '<span class="track"><b style="--w:' + f.score + '%"></b></span>' +
        '<em>' + f.score + ' ×' + f.w.toFixed(2) + '</em></div>' +
        '<p class="fnote">' + esc(f.r.txt) + '</p>';
    }).join('') +
      '<p class="fnote" style="margin-left:0;margin-top:6px">合计 Σ 分数×权重 = ' + S.env.score +
      '（水温' + (S.tempProxy ? '由气温代理' : '为实测/模式值') + '；权重可在「设置 → 判定口径」里换）</p>';
  }

  function renderMeta() {
    var box = $('metaBody');
    if (!box) return;
    var rows = [
      ['Open-Meteo Forecast', '天气/气压/风/云量/日出日落', S.wx ? (S.wx.fromCache ? '缓存 ' + relTime(S.wx.at) : '刚刚') : '未取到'],
      ['Open-Meteo Marine', '浪高/海表温/潮位（内陆为空）', S.sea ? ((S.sea.data.current && S.sea.data.current.wave_height != null) ? '有效' : '内陆无海况') : '未取到'],
      ['Open-Meteo Flood（GloFAS）', '河道流量与趋势', S.flood ? '已取到' : '未取到'],
      ['Open-Meteo Elevation（DEM 90m）', '岸坡/近岸水深推断', S.cands.length ? '已采样 ' + S.cands.length + ' 段' : '未取到'],
      ['OpenStreetMap Overpass', '水域几何与岸线', S.bodies.length ? S.bodies.length + ' 个水域要素' : '未取到'],
      ['OpenStreetMap Nominatim', '地名', (S.place && S.place.display_name) ? '已取到' : '未取到']
    ];
    var t = S.timing;
    var timingRow = t ? ('<p class="fnote" style="margin-left:0">本次耗时：气象/水文 <b>' + t.data + ' ms</b> · 高程 ' +
      (t.elev || 0) + ' ms（' + (t.probes || 0) + ' 点）· 卫星 ' + (t.sat || 0) + ' ms · 计算 ' + t.compute + ' ms · 渲染 ' + t.render +
      ' ms（合计 ' + t.total + ' ms）· 缓存命中 ' + t.cached + '/4</p>') : '';
    var ages = (window.Api && window.Api.cacheReport && S.me) ? window.Api.cacheReport(S.me.lat, S.me.lon) : [];
    var ageRow = ages.length ? ('<p class="fnote" style="margin-left:0">本地缓存：' + ages.map(function (a) {
      return a.name + ' ' + (a.age == null ? '无' : (a.fresh ? relTime(new Date(Date.now() - a.age)) : relTime(new Date(Date.now() - a.age)) + '·过期'));
    }).join(' · ') + '</p>') : '';
    box.innerHTML = '<div class="factor">' + rows.map(function (r) {
      return '<div class="frow" style="grid-template-columns:minmax(0,1fr) auto">' +
        '<i style="font-size:var(--sub);color:var(--ink)">' + esc(r[0]) +
        '<br><span style="color:var(--ink-3);font-size:var(--tiny)">' + esc(r[1]) + '</span></i>' +
        '<em>' + esc(r[2]) + '</em></div>';
    }).join('') + '</div>' +
      '<p class="fnote" style="margin-left:0">没有免费全球水下地形与实测水位：本应用把「岸坡／近岸水深／岬湾」都标为推断；水下结构（暗礁、沉木、沟坎）只有船用声纳或本地情报才有。</p>' +
      timingRow + ageRow;
  }
  /* ------------------------------------------------ 分区名称（可自定义）+ 语言 */
  var TAB_DEFAULTS = { summary: '结论', spots: '钓点', sat: '影像', me: '我的' };
  var tabNames = {};

  function loadTabNames() {
    try {
      var raw = Store.getItem('lc:tabnames');
      if (!raw) return;
      var o = JSON.parse(raw);
      Object.keys(TAB_DEFAULTS).forEach(function (k) { if (o[k]) tabNames[k] = o[k]; });
    } catch (e) { /* 用默认 */ }
  }
  function saveTabNames() {
    try { Store.setItem('lc:tabnames', JSON.stringify(tabNames)); } catch (e) { /* 忽略 */ }
  }
  function tabLabel(k) {
    if (tabNames[k]) return tabNames[k];
    return window.I18N ? I18N.t('tab.' + k) : TAB_DEFAULTS[k];
  }
  function applyTabNames() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      var k = b.getAttribute('data-tab');
      if (k) b.textContent = tabLabel(k);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tabname]'), function (inp) {
      var k = inp.getAttribute('data-tabname');
      inp.value = tabNames[k] || '';
      inp.placeholder = window.I18N ? I18N.t('tab.' + k) : TAB_DEFAULTS[k];
    });
  }

  /* ------------------------------------------------ 分区标签（结论 / 钓点 / 影像 / 数据） */
  function applyTab(name) {
    if ($('cardMap') && $('cardMap').classList.contains('fs')) mapFull(false);
    S.tab = name || 'summary';
    Array.prototype.forEach.call(document.querySelectorAll('.cols > .card, .cols > .morewrap'), function (c) {
      c.classList.toggle('show', c.getAttribute('data-tab') === S.tab);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === S.tab);
    });
    try { Store.setItem('lc:tab', S.tab); } catch (e) { /* 忽略 */ }
    if (S.tab === 'spots') {
      drawMap();
      if (S.map) setTimeout(function () { S.map.invalidateSize(); }, 80);
    }
      // 影像面板不再挂对比地图，切分区时无需额外绘制
    if (window.My && window.My.onTab) window.My.onTab(S.tab);
    if (window.scrollY > 0) window.scrollTo(0, 0);
  }

  /* ------------------------------------------------ 历史影像（水下结构） */
  var geoTiffLoading = null;

  /* 本地优先（assets/vendor/geotiff.js，310 KB，已随项目一起发布），CDN 作为兜底 */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('load fail: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureGeoTIFF() {
    if (window.GeoTIFF) return Promise.resolve();
    if (geoTiffLoading) return geoTiffLoading;
    geoTiffLoading = loadScript('assets/vendor/geotiff.js')
      .catch(function () {
        return loadScript('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js');
      })
      .catch(function () {
        geoTiffLoading = null;
        throw new Error('geotiff.js 加载失败（本地文件缺失且 CDN 不通）');
      });
    return geoTiffLoading;
  }

  function satStatus(html) {
    var box = $('satBody');
    if (!box) return;
    box.className = 'satstage';
    box.innerHTML = '<div class="satprog"><span class="dot"></span><span>' + html + '</span></div>';
  }

  function satEmpty() {
    var box = $('satBody');
    if (!box) return;
    box.className = 'empty';
    box.innerHTML = '<b>用不同水位时期的卫星影像看库底</b>' +
      '<p>水下结构藏在这里：枯水期露出的老河床、路基、石砌护岸、房基；两个时期都在水下但水色稳定的浅脊与硬底。' +
      '点右上「分析影像」开始 —— 只下载你周围 1–2 km 的那一块，不传任何数据出去。</p>';
  }

  function runSat() {
    if (!S.me) { openModal('modalManual'); return; }
    if (S.satBusy) return;
    var btn = $('btnSat');
    S.satBusy = true;
    if (btn) { btn.classList.add('busy'); btn.disabled = true; }
    satStatus('准备影像引擎（首次要下载 geotiff.js）…');
    ensureGeoTIFF().then(function () {
      return window.Sat.analyse(S.me.lon, S.me.lat, {
        radiusKm: S.satZoom || 0.9, years: 3, samples: 6, size: 1024, maxCloud: 20,
        onProgress: function (msg) { satStatus(esc(msg)); }
      });
    }).then(function (res) {
      S.sat = res;
      S.satBusy = false;
      // （原「对比窗口地图」已移除：只保留一张主影像）
      if (btn) { btn.classList.remove('busy'); btn.disabled = false; btn.textContent = '重新分析'; }
      rebuildSpots();
      renderSat();
      renderSpots();
      drawSatLayer();
    }).catch(function (err) {
      S.satBusy = false;
      if (btn) { btn.classList.remove('busy'); btn.disabled = false; }
      var box = $('satBody');
      if (box) {
        box.className = 'empty';
        box.innerHTML = '<b>这次没取到影像</b><p>' + esc(err && err.message ? err.message : '未知错误') + '</p>' +
          '<p>常见原因：这一带 3 年内没有云量 &lt;20% 的 Sentinel-2 影像（雨季/多云山区很常见），或 CDN 被网络策略拦了。' +
          '可以重试；想放宽条件就改 assets/sat.js 里的 maxCloud / years / radiusKm。</p>';
      }
    });
  }

  /* 期次下拉：日期 · 云量 · 水体占比；当前选中的那期带 ✔ */
  function optionList(res, role) {
    var cur = role === 'low' ? res.low : res.high;
    var bestLow = res.ranked && res.ranked.length ? res.ranked[0].id : null;
    var bestHigh = res.ranked && res.ranked.length ? res.ranked[res.ranked.length - 1].id : null;
    var list = (res.available || []).slice();
    if (!list.length) {
      return '<option value="' + esc(cur.id) + '">' + esc(cur.date) + '</option>';
    }
    return list.map(function (a) {
      var frac = a.frac != null ? Math.round(a.frac * 100) + '%' : '—';
      var star = a.id === bestLow ? '★枯' : (a.id === bestHigh ? '★丰' : '');
      var txt = a.date + ' · 云' + Math.round(a.cloud) + '% · 水' + frac + (star ? ' ' + star : '');
      return '<option value="' + esc(a.id) + '"' + (a.id === cur.id ? ' selected' : '') + '>' + esc(txt) + '</option>';
    }).join('');
  }

  function renderSat() {
    var box = $('satBody');
    if (!box || !S.sat) return;
    var r = S.sat;
    box.className = 'satstage';
    var pct = function (v) { return v == null ? '--' : Math.round(v * 100); };
    var cur = S.satZoom || 0.9;
    box.innerHTML =
      '<div class="satmeta">' +
      '<div class="st"><i>影像日期</i><b>' + r.low.date + '<u>云 ' + Math.round(r.low.cloud) + '%</u></b></div>' +
      '<div class="st"><i>水体占比</i><b>' + pct(r.low.frac) + '<u>%</u></b></div>' +
      '<div class="st"><i>结构候选</i><b>' + r.anomalies.length + '<u>个</u></b></div>' +
      '<div class="st"><i>分辨率</i><b>' + Math.round(r.resolution) + '<u>m/px</u></b></div>' +
      '</div>' +
      '<div class="satbar">' +
      '<label class="satdate"><span>期次</span><select data-satrole="low">' + optionList(r, 'low') + '</select></label>' +
      '<div class="zoomctl" role="group" aria-label="缩放">' +
      '<button class="zbtn" data-zoom="in" aria-label="放大">+</button>' +
      '<span>±' + cur + ' km</span>' +
      '<button class="zbtn" data-zoom="out" aria-label="缩小">−</button>' +
      '</div>' +
      '</div>' +
      '<div class="satmodes">' +
      '<button class="chip' + (S.satMode === 'sdb' ? ' on' : '') + '" data-satmode="sdb">水深与硬底</button>' +
      '<button class="chip' + (S.satMode === 'rgb' ? ' on' : '') + '" data-satmode="rgb">真彩影像</button>' +
      '<span class="card-note" style="margin-left:auto">' +
      (S.satMode === 'sdb' ? '青＝浅，靛＝深；黄点＝结构候选' : '局部对比度增强 + 锐化') + '</span>' +
      '</div>' +
      '<div class="satview"><canvas id="satCanvas"></canvas>' +
      '<span class="satcap">' + r.low.date + ' · Sentinel-2 · 窗口 ±' + cur + ' km' +
      (r.pixels ? ' · ' + r.pixels + ' px' : '') + '</span></div>' +
      '<div class="satlist">' + (r.anomalies.length ? r.anomalies.map(function (a, i) {
        var d = E.dist(S.me, a);
        return '<div class="satrow"><span class="n">' + (i + 1) + '</span>' +
          '<span>距你 ' + E.fmtDist(d) + ' · ' + esc(a.text) + '</span>' +
          '<button data-satanom="' + i + '">上图</button></div>';
      }).join('') : '<p class="hint">这段窗口里没找到显著的水下结构异常 —— 可能是水太浑（蓝绿比失效）或水下本来就平。</p>') +
      '</div>' +
      '<p class="hint">' +
      (r.exposedFrac != null ? '两期水位差折合库底露出约 ' + pct(r.exposedFrac) + '%。' : '') +
      '水体占比越低＝库水位越低＝库底露出越多。' +
      (r.lowValidFrac != null && r.lowValidFrac < 0.75
        ? ' 注意：这一期只有 ' + Math.round(r.lowValidFrac * 100) + '% 的像元有效（处在幅宽边缘或被云遮），可靠性打折。'
        : '') +
      (r.low.frac != null && r.low.frac < 0.1
        ? ' <b>这个窗口里几乎没水面（' + Math.round(r.low.frac * 100) + '%）——你多半站在岸上或岛上，放大到更小的窗口，或把位置挪到水面上再分析。</b>'
        : '') +
      '</p>';

    var canvas = $('satCanvas');
    window.Sat.render(canvas, r, S.satMode);

    /* 期次：换一期就重读那一期的影像，主图与下面的候选点一起更新 */
    Array.prototype.forEach.call(box.querySelectorAll('[data-satrole]'), function (sel) {
      sel.addEventListener('change', function () {
        var id = sel.value;
        if (!id || S.satBusy) return;
        S.satBusy = true;
        satStatus('读取 ' + ((sel.options[sel.selectedIndex] || {}).text || '该期') + '…');
        window.Sat.setScene(S.sat, 'low', id).then(function (res) {
          S.sat = res;
          S.satBusy = false;
          renderSat();
          renderSpots();
          drawSatLayer();
        }).catch(function (err) {
          S.satBusy = false;
          renderSat();
          setStatus('off', '切期失败：' + (err && err.message ? err.message : '未知错误'), null, null);
        });
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-satmode]'), function (b) {
      b.addEventListener('click', function () {
        S.satMode = b.getAttribute('data-satmode');
        renderSat();
      });
    });

    /* 缩放：+ 放大（窗口变小，看得更细），− 缩小（窗口变大，看得更全） */
    var STEPS = [0.3, 0.45, 0.65, 0.9, 1.2, 1.8, 2.5, 3.5];
    Array.prototype.forEach.call(box.querySelectorAll('[data-zoom]'), function (b) {
      b.addEventListener('click', function () {
        if (S.satBusy) return;
        var i = STEPS.indexOf(cur);
        if (i < 0) { i = 3; }
        var ni = b.getAttribute('data-zoom') === 'in' ? Math.max(0, i - 1) : Math.min(STEPS.length - 1, i + 1);
        var km = STEPS[ni];
        if (km === cur) return;
        S.satBusy = true;
        S.satZoom = km;
        satStatus('按 ±' + km + ' km 窗口重读影像…');
        window.Sat.reread(S.sat, km).then(function (res) {
          S.sat = res;
          S.satBusy = false;
          renderSat();
          renderSpots();
          drawSatLayer();
        }).catch(function (err) {
          S.satBusy = false;
          renderSat();
          satStatus('重读失败：' + esc(err && err.message ? err.message : '未知错误'));
        });
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-satanom]'), function (b) {
      b.addEventListener('click', function () {
        var a = r.anomalies[parseInt(b.getAttribute('data-satanom'), 10)];
        if (!a) return;
        if (!S.map) initMap();
        if (S.map) S.map.flyTo([a.lat, a.lon], 17, { duration: .6 });
        var card = document.getElementById('cardMap');
        if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }


  function drawSatLayer() {
    if (!S.map || !S.layers.sat) return;
    var L = window.L;
    S.layers.sat.clearLayers();
    if (!S.sat || !S.sat.anomalies) return;
    S.sat.anomalies.forEach(function (a, i) {
      L.circleMarker([a.lat, a.lon], {
        radius: 7, color: '#e879f9', weight: 2, fillColor: '#e879f9', fillOpacity: .3
      }).bindPopup('<b>结构候选 #' + (i + 1) + '</b><br>' + esc(a.text)).addTo(S.layers.sat);
    });
  }

  /* ------------------------------------------------ 地图 */
  function initMap() {
    if (S.map || typeof window.L === 'undefined' || !$('map') || !S.me) return false;
    S.map = window.L.map('map', { zoomControl: true, scrollWheelZoom: true }).setView([S.me.lat, S.me.lon], 14);
    var tileUrl = resolveTileUrl() || BASEMAPS[0].url;
    S.tileLayer = window.L.tileLayer(tileUrl, {
      maxZoom: 19, attribution: mapAttribution(), subdomains: 'abc', crossOrigin: true
    }).addTo(S.map);
    paintTileFilter();
    S.layers = {
      water: window.L.layerGroup().addTo(S.map),
      cands: window.L.layerGroup().addTo(S.map),
      spots: window.L.layerGroup().addTo(S.map),
      sat: window.L.layerGroup().addTo(S.map),
      favs: window.L.layerGroup().addTo(S.map),
      routes: window.L.layerGroup().addTo(S.map),
      me: window.L.layerGroup().addTo(S.map)
    };
    /* 点地图任意位置 → 直接把那儿当成当前位置（不用先开「找水域」再手填经纬度） */
    S.map.on('click', function (e) {
      var ll = e.latlng;
      var t = function (k, f) { return window.I18N ? I18N.t(k) : f; };
      var pop = window.L.popup({ closeButton: true, className: 'locpick', offset: [0, -6] })
        .setLatLng(ll)
        .setContent(
          '<div class="pickbox"><b>' + ll.lat.toFixed(4) + ', ' + ll.lng.toFixed(4) + '</b>' +
          '<p>' + t('map.pick.ask', '把这里设为当前位置？') + '</p>' +
          '<button class="act primary" data-sethere="1">' + t('map.pick.set', '设为当前位置') + '</button></div>'
        )
        .openOn(S.map);
      // 弹窗内容是后插入的，事件要等 DOM 就绪再绑
      var btn = pop.getElement() ? pop.getElement().querySelector('[data-sethere]') : null;
      if (btn) btn.addEventListener('click', function () {
        S.map.closePopup(pop);
        setMe(ll.lat, ll.lng, null, null, 'manual');
      });
    });
    return true;
  }

  /* ------------------------------------------------ 路线：岸钓走真实路网，船钓是直线 */
  var routeCache = {};

  function osrmRoute(from, to, profile) {
    var key = profile + ':' + from.lat.toFixed(4) + ',' + from.lon.toFixed(4) + '>' +
      to.lat.toFixed(4) + ',' + to.lon.toFixed(4);
    if (routeCache[key]) return Promise.resolve(routeCache[key]);
    // 路线服务由用户选：公共 OSRM / 自己的地址 / 完全关掉
    if (CFG.route === 'off') return Promise.resolve(null);
    var url;
    if (CFG.route === 'custom' && CFG.routeUrl) {
      url = CFG.routeUrl
        .replace(/\{profile\}/g, profile)
        .replace(/\{fromLat\}/g, from.lat).replace(/\{fromLon\}/g, from.lon)
        .replace(/\{toLat\}/g, to.lat).replace(/\{toLon\}/g, to.lon);
    } else {
      url = 'https://router.project-osrm.org/route/v1/' + profile + '/' +
        from.lon + ',' + from.lat + ';' + to.lon + ',' + to.lat +
        '?overview=simplified&geometries=geojson';
    }
    return fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (r) {
      return r.json();
    }).then(function (j) {
      var rt = j && j.routes && j.routes[0];
      if (!rt) return null;
      var out = {
        pts: rt.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }),
        meters: rt.distance, minutes: rt.duration / 60
      };
      routeCache[key] = out;
      return out;
    }).catch(function () { return null; });
  }

  function boatOrigin(spot) {
    var favs = (window.My && window.My.favorites) ? window.My.favorites() : [];
    var best = null, bestD = Infinity;
    favs.forEach(function (f) {
      var d = E.dist(f, spot);
      if (d < bestD) { bestD = d; best = f; }
    });
    return (best && bestD < 40000) ? { pt: best, isFav: true } : { pt: S.me, isFav: false };
  }

  var routeToken = 0;

  function drawRoutes() {
    if (!S.map || !S.layers.routes) return;
    var L = window.L;
    var token = ++routeToken;
    S.layers.routes.clearLayers();
    var spot = S.selSpot || S.spots[0];
    if (!spot || !S.me) return;
    var t = function (k, f) { return window.I18N ? I18N.t(k) : f; };

    // 船钓：水上直线（不是航道，只是直线距离）
    var origin = boatOrigin(spot);
    var bm = E.dist(origin.pt, spot);
    L.polyline([[origin.pt.lat, origin.pt.lon], [spot.lat, spot.lon]], {
      color: '#ff9ecb', weight: 2, dashArray: '7 7', opacity: .95
    }).bindPopup('<b>' + t('map.popup.boat') + '</b><br>' + E.fmtDist(bm) +
      (origin.isFav ? '<br>起点：常用地点 ' + esc(origin.pt.name) : '<br>起点：你')).addTo(S.layers.routes);

    // 岸钓：真实路网（失败就退化成直线并标注）
    osrmRoute(S.me, spot, 'driving').then(function (r) {
      if (!S.map || !S.layers.routes || token !== routeToken) return;
      if (r && r.pts && r.pts.length > 1) {
        L.polyline(r.pts, { color: '#5be7ff', weight: 3, opacity: .9 }).bindPopup(
          '<b>' + t('map.popup.shore') + '</b><br>' + E.fmtDist(r.meters) +
          ' · 约 ' + Math.round(r.minutes) + ' 分钟').addTo(S.layers.routes);
      } else {
        L.polyline([[S.me.lat, S.me.lon], [spot.lat, spot.lon]], {
          color: '#5be7ff', weight: 2, dashArray: '3 5', opacity: .7
        }).bindPopup(t('map.popup.shore') + '<br>' +
          (CFG.route === 'off' ? '路线服务已关闭（设置里可开），这是直线距离 ' : '路网服务不可用，这是直线距离 ') +
          E.fmtDist(bm)).addTo(S.layers.routes);
      }
    });
  }

  function drawMap() {
    if (!S.me) return;
    if (S.tab !== 'spots' && !S.map) return;
    if (!initMap() && !S.map) return;
    var L = window.L;
    S.layers.me.clearLayers(); S.layers.cands.clearLayers();
    S.layers.spots.clearLayers(); S.layers.water.clearLayers();
    if (S.layers.favs) S.layers.favs.clearLayers();

    L.circleMarker([S.me.lat, S.me.lon], {
      radius: 7, color: '#5be7ff', weight: 2, fillColor: '#5be7ff', fillOpacity: .85
    }).bindPopup(window.I18N ? I18N.t('map.popup.me') : '你在这里').addTo(S.layers.me);

    // 常用地点：星标
    var favs = (window.My && window.My.favorites) ? window.My.favorites() : [];
    favs.forEach(function (f) {
      var icon = L.divIcon({ className: 'favstar', html: '★', iconSize: [20, 20], iconAnchor: [10, 10] });
      L.marker([f.lat, f.lon], { icon: icon })
        .bindPopup('<b>' + esc(f.name) + '</b>' + (f.desc ? '<br>' + esc(f.desc) : ''))
        .addTo(S.layers.favs);
    });

    S.bodies.slice(0, 12).forEach(function (b) {
      b.rings.forEach(function (ring) {
        L.polyline(ring.map(function (p) { return [p.lat, p.lon]; }), {
          color: '#4ad6c8', weight: 1, opacity: .45, dashArray: '3 4'
        }).addTo(S.layers.water);
      });
    });

    S.cands.forEach(function (c) {
      L.circleMarker([c.lat, c.lon], {
        radius: 2.5, color: '#7d8fb4', weight: 1, fillColor: '#7d8fb4', fillOpacity: .5
      }).addTo(S.layers.cands);
    });

    S.spots.slice(0, 8).forEach(function (s) {
      var color = s.spotScore >= 75 ? '#a5e05f' : (s.spotScore >= 55 ? '#ffb454' : '#7d8fb4');
      var m = L.circleMarker([s.lat, s.lon], {
        radius: 8, color: color, weight: 2, fillColor: color, fillOpacity: .35
      }).bindPopup('<b>' + esc(s.name || '钓点') + ' ' + s.spotScore + ' 分</b><br>' +
        esc(s.tags.map(function (t) { return t.txt; }).join(' · ')) + '<br>' + esc(s.reasons.join('；')));
      m.on('click', function () { S.selSpot = s; renderSpots(); });
      m.addTo(S.layers.spots);
    });

    drawSatLayer();
    drawRoutes();
  }

  function focusSpot(s) {
    if (!S.map) initMap();
    if (!S.map) return;
    S.map.flyTo([s.lat, s.lon], 16, { duration: .6 });
    drawRoutes();
    var card = document.getElementById('cardMap');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function fitAll() {
    if (!S.map) initMap();
    if (!S.map || !S.me) return;
    var pts = [[S.me.lat, S.me.lon]];
    S.spots.slice(0, 8).forEach(function (s) { pts.push([s.lat, s.lon]); });
    S.map.fitBounds(pts, { padding: [28, 28], maxZoom: 16 });
  }

  /* ------------------------------------------------ 地图独立全屏 */
  function mapFull(on) {
    var card = $('cardMap');
    if (!card) return;
    var want = (typeof on === 'boolean') ? on : !card.classList.contains('fs');
    if (want && !S.map) initMap();
    card.classList.toggle('fs', want);
    document.body.classList.toggle('mapfs', want);
    // 进出各变一次尺寸，两头都让 Leaflet 重算，否则瓦片留白
    var fix = function () { if (S.map) S.map.invalidateSize(); };
    setTimeout(fix, 60);
    setTimeout(fix, 320);
    if (want && S.map && S.me) S.map.setView([S.me.lat, S.me.lon], Math.max(S.map.getZoom(), 14));
  }

  /* ------------------------------------------------ 定位 / 手动选点 */
  function setMe(lat, lon, acc, placeHint, source) {
    // 每次换位置都作废在途的 GPS 回调与旧请求，否则「搜了新地方又被 GPS 拽回本地」
    S.locToken++;
    S.locSource = source || 'manual';
    S.me = { lat: lat, lon: lon, acc: acc || null };
    S.place = null;
    S.placeHint = placeHint || null;
    S.wx = null; S.sea = null; S.flood = null; S.osm = null;
    S.spots = []; S.cands = []; S.selSpot = null; S.env = null;
    S.wideTried = false;
    S.osmError = null;
    S.sat = null; S.satBusy = false;
    satEmpty();
    var sbtn = $('btnSat');
    if (sbtn) sbtn.textContent = '分析影像';
    renderLoc();
    if (S.map) { S.map.remove(); S.map = null; S.layers = null; }
    var snap = restoreSnapshot();
    if (snap) {
      renderAll();
    setStatus('cache', '本地快照 ' + relTime(snap.at) + ' · 正在更新…',
        S.env ? S.env.score : '--', clockText(S.nowMs));
    } else {
      showSkeletons();
    }
    refresh(false);      // 走缓存：没过期的源不会发请求，过期的用 SWR 后台更新
  }

  /* 原生壳（Capacitor）里优先用插件定位：权限弹窗与后台定位都更可靠；
     普通浏览器继续走 navigator.geolocation。 */
  function nativeGeo() {
    var cap = window.Capacitor;
    return cap && cap.Plugins && cap.Plugins.Geolocation ? cap.Plugins.Geolocation : null;
  }

  function locate() {
    var token = ++S.locToken;
    var plugin = nativeGeo();
    if (plugin) {
      setStatus('live', '正在获取 GPS 定位…', null, null);
      plugin.checkPermissions().catch(function () { return null; })
        .then(function (perm) {
          if (perm && perm.location === 'granted') return null;
          return plugin.requestPermissions();
        })
        .then(function () {
          return plugin.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
        })
        .then(function (pos) {
          if (token !== S.locToken) return;   // 用户已经手动选了别的地方，丢弃这次 GPS
          setMe(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, null, 'gps');
        })
        .catch(function () { locateWeb(); });
      return;
    }
    locateWeb();
  }

  function locateWeb() {
    var token = ++S.locToken;
    if (!navigator.geolocation) {
      setStatus('off', '这个浏览器不支持定位，请手动选点', null, null);
      openModal('modalManual');
      return;
    }
    setStatus('live', '正在获取 GPS 定位…', null, null);
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (token !== S.locToken) return;     // 期间用户手动选了地方，忽略这次 GPS
      setMe(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, null, 'gps');
    }, function (err) {
      if (token !== S.locToken) return;     // 手动选点后不再弹「定位失败」
      var msg = err.code === 1 ? '你拒绝了定位权限' : (err.code === 3 ? '定位超时' : '定位失败');
      setStatus('off', msg + ' · 可手动搜索水域或填坐标', null, null);
      openModal('modalManual');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  function openModal(id) { var m = $(id); if (m) m.classList.remove('hidden'); }
  function closeModal(id) { var m = $(id); if (m) m.classList.add('hidden'); }

  /* ------------------------------------------------ 外观 */
  /* ------------------------------------------------ 底图（可配置）
     CARTO 的 basemaps.cartocdn.com/{dark_all,light_all,rastertiles/voyager} 是免 Key 公共底图：
     实测带不带 api_key 都返回 200（服务端忽略 key）。真正需要 Key 的是 CARTO 平台 API
     （*.api.carto.com/v3/...），那套是矢量瓦片，要 MapLibre GL 才吃得下。
     所以这里做成通用模板：{key} 占位符 + 自定义 URL，谁的 Key 都能塞进来。 */
  var BASEMAPS = [
    {
      id: 'osm-dark', name: 'OSM 中文 · 深色',
      url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
      attr: '&copy; OpenStreetMap contributors', dark: true, maxZoom: 19
    },
    {
      id: 'osm', name: 'OSM 中文 · 浅色',
      url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
      attr: '&copy; OpenStreetMap contributors', maxZoom: 19
    },
    {
      id: 'dark', name: 'CARTO Dark（需 Key）',
      url: 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png',
      attr: '&copy; OpenStreetMap &copy; CARTO', carto: true, needKey: true
    },
    {
      id: 'light', name: 'CARTO Positron（需 Key）',
      url: 'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png',
      attr: '&copy; OpenStreetMap &copy; CARTO', carto: true, needKey: true
    },
    {
      id: 'voyager', name: 'CARTO Voyager（需 Key）',
      url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      attr: '&copy; OpenStreetMap &copy; CARTO', carto: true, needKey: true
    },
    {
      id: 'esri', name: 'Esri 影像（无地名）',
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attr: 'Imagery &copy; Esri, Maxar, Earthstar Geographics', maxZoom: 19
    },
    {
      id: 'tdt-vec', name: '天地图 矢量（需 tk）',
      url: 'https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={key}',
      attr: '&copy; 天地图', needKey: true
    },
    {
      id: 'tdt-img', name: '天地图 影像（需 tk）',
      url: 'https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={key}',
      attr: '&copy; 天地图', needKey: true
    },
    { id: 'custom', name: '自定义 URL', url: '', attr: '&copy; 自定义底图' }
  ];
  /* 默认换成 OSM 标准瓦片：地名就是中文（CARTO/Esri 自带英文标注，普通用户看着别扭）。
     深色项靠给瓦片层加一层反相滤镜压暗，保持和界面同一套深色气质。 */
  var MAPCFG = { style: 'osm-dark', url: '', key: '', v: 2 };

  function loadMapCfg() {
    try {
      var raw = Store.getItem('lc:map');
      if (!raw) { MAPCFG.v = 2; saveMapCfg(); return; }   // 首次启动把默认底图写下来
      var o = JSON.parse(raw);
      if (o.style) MAPCFG.style = o.style;
      MAPCFG.url = o.url || '';
      MAPCFG.key = o.key || '';
      // v<2：老版本默认 CARTO Dark（英文标注）。只有没主动改成过别的底图的人，才跟着换成中文底图
      if (!o.v || o.v < 2) {
        if (o.style === 'dark' || !o.style) MAPCFG.style = 'osm-dark';
        MAPCFG.v = 2;
        saveMapCfg();
      }
    } catch (e) { /* 用默认 */ }
  }
  function saveMapCfg() {
    try { Store.setItem('lc:map', JSON.stringify(MAPCFG)); } catch (e) { /* 忽略 */ }
  }
  function basemapById(id) {
    for (var i = 0; i < BASEMAPS.length; i++) if (BASEMAPS[i].id === id) return BASEMAPS[i];
    return BASEMAPS[0];
  }
  function resolveTileUrl() {
    var b = basemapById(MAPCFG.style);
    var tpl = MAPCFG.style === 'custom' ? (MAPCFG.url || '') : b.url;
    if (!tpl) return '';
    var key = MAPCFG.key || '';
    var out = tpl.replace(/\{key\}/g, encodeURIComponent(key)).replace(/\{s\}/g, 'a');
    // CARTO Basemaps 现在 PNG 底图会打水印，带上 ?key= 才去掉（官方说法：参数名就是 key）
    if (b.carto && key && out.indexOf('{key}') < 0 && out.indexOf('key=') < 0) {
      out += (out.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent(key);
    }
    return out;
  }
  function mapAttribution() {
    var b = basemapById(MAPCFG.style);
    return b.attr || '&copy; OpenStreetMap';
  }

  /* 底图 chip：与地图是否已初始化无关，设置弹窗随时要能点 */
  function renderBasemapChips() {
    var row = $('mapStyleRow');
    if (row) {
      row.innerHTML = BASEMAPS.map(function (b) {
        return '<button class="chip' + (b.id === MAPCFG.style ? ' on' : '') + '" data-basemap="' + b.id + '">' +
          b.name + (b.needKey ? ' <em>需 Key</em>' : '') + '</button>';
      }).join('');
      Array.prototype.forEach.call(row.querySelectorAll('[data-basemap]'), function (btn) {
        btn.addEventListener('click', function () {
          MAPCFG.style = btn.getAttribute('data-basemap');
          applyBasemap();
          saveMapCfg();
        });
      });
    }
    if ($('mapUrlInput')) $('mapUrlInput').value = MAPCFG.url || '';
    if ($('mapKeyInput')) $('mapKeyInput').value = MAPCFG.key || '';
  }

  /* 浅色瓦片压暗滤镜：只作用于瓦片层，钓点/岸线/你在这里 都保持原色。
     顺手把卡片脚注里的「底图 X」更新成当前这套。 */
  function paintTileFilter() {
    var b = basemapById(MAPCFG.style);
    var nm = $('mapSrcName');
    if (nm) nm.textContent = b.name;
    if (!S.map || !S.map.getContainer) return;
    var box = S.map.getContainer().parentElement;
    if (!box) return;
    box.classList.toggle('darktiles', !!b.dark);
  }
  /* 换底图：只替换瓦片图层，不重建地图（钓点/影像图层都保留） */
  function applyBasemap() {
    renderBasemapChips();
    if (!S.map || typeof window.L === 'undefined') return;
    var url = resolveTileUrl();
    if (!url) return;
    if (S.tileLayer) { S.map.removeLayer(S.tileLayer); S.tileLayer = null; }
    S.tileLayer = window.L.tileLayer(url, {
      maxZoom: 19, attribution: mapAttribution(), subdomains: 'abc', crossOrigin: true
    }).addTo(S.map);
    paintTileFilter();
  }

  var PALETTES = [
    { id: 'void', name: '深空蓝', a1: '#5be7ff', a2: '#9b8cff', a3: '#6ff2c4' },
    { id: 'aurora', name: '极光紫', a1: '#b58bff', a2: '#5be7ff', a3: '#ff9ecb' },
    { id: 'amber', name: '熔金橙', a1: '#ffb454', a2: '#ff6e8a', a3: '#ffe07a' },
    { id: 'jade', name: '翡翠绿', a1: '#4ce0b3', a2: '#5be7ff', a3: '#c7f26b' },
    { id: 'sakura', name: '樱花粉', a1: '#ff9ecb', a2: '#b58bff', a3: '#7ee3ff' },
    { id: 'graphite', name: '石墨灰', a1: '#9fb3cc', a2: '#7a8aa3', a3: '#c8d6e6' }
  ];
  var UI = { palette: 'void', fs: 14, perf: false, aurora: true };
  /* ---------------------------------------------------------------- 判定口径的开关
     这些规则本身有争议（权重怎么分、水温从哪来、要不要卫星兜底、路线用谁的服务），
     统一做成用户可选，默认值写在 CFG 里。改完立即重算，不重新拉数据。 */
  function chipRow(el, items, cur, attr) {
    if (!el) return;
    el.innerHTML = items.map(function (o) {
      return '<button class="chip' + (cur === o[0] ? ' on' : '') + '" ' + attr + '="' + o[0] +
        '"' + (o[2] ? ' data-tip="' + o[1] + '|' + o[2] + '"' : '') + '>' + o[1] + '</button>';
    }).join('');
  }
  function pickIn(el, attr, val) {
    Array.prototype.forEach.call(el.querySelectorAll('[' + attr + ']'), function (x) {
      x.classList.toggle('on', x.getAttribute(attr) === val);
    });
  }
  function recomputeNow() {
    if (S.wx) { computeEnv(); rebuildSpots(); renderAll(); stampStatus(); }
  }

  function initCfgUI() {
    // 1) 评分偏好
    var row = $('scoreRow');
    chipRow(row, [
      ['balanced', '均衡', '六项平摊，适合大多数人'],
      ['pressure', '气压优先', '气压与 3 小时变压合计 30%'],
      ['temp', '水温优先', '水温占 30%'],
      ['wind', '风优先', '风力风向占 32%']
    ], CFG.score, 'data-score');
    if (row) Array.prototype.forEach.call(row.querySelectorAll('[data-score]'), function (b) {
      b.addEventListener('click', function () {
        CFG.score = b.getAttribute('data-score');
        pickIn(row, 'data-score', CFG.score);
        saveCfg();
        recomputeNow();
      });
    });

    // 2) 水温来源
    var wr = $('waterSrcRow');
    var manual = $('waterManualWrap');
    var wIn = $('waterManualInput');
    // 只建一次 DOM：重建 innerHTML 会把已绑的 click 一起丢掉（第一次点击后再也点不动）
    chipRow(wr, [['auto', '自动'], ['manual', '手动填水温', '你有一支水温计就填它，比气温代理准']], CFG.water, 'data-water-src');
    function paintWater() {
      if (wr) pickIn(wr, 'data-water-src', CFG.water);
      if (manual) manual.style.display = CFG.water === 'manual' ? '' : 'none';
      if (wIn && CFG.waterManual != null) wIn.value = CFG.waterManual;
    }
    paintWater();
    if (wr) Array.prototype.forEach.call(wr.querySelectorAll('[data-water-src]'), function (b) {
      b.addEventListener('click', function () {
        CFG.water = b.getAttribute('data-water-src');
        if (CFG.water === 'manual' && (CFG.waterManual == null)) CFG.waterManual = 18;
        paintWater();
        saveCfg();
        recomputeNow();
      });
    });
    if (wIn) wIn.addEventListener('change', function () {
      var v = parseFloat(wIn.value);
      CFG.waterManual = isNaN(v) ? null : Math.max(-2, Math.min(40, v));
      saveCfg();
      recomputeNow();
    });

    // 3) 卫星兜底
    var satBtn = $('chkSatFallback');
    function paintSat() {
      if (!satBtn) return;
      satBtn.classList.toggle('on', !!CFG.satFallback);
      satBtn.innerHTML = '卫星水面兜底 <em>' + (CFG.satFallback ? '开' : '关') + '</em>';
    }
    paintSat();
    if (satBtn) satBtn.addEventListener('click', function () {
      CFG.satFallback = !CFG.satFallback;
      paintSat();
      saveCfg();
    });

    // 4) 路线服务
    var rr = $('routeRow');
    var rWrap = $('routeUrlWrap');
    var rIn = $('routeUrlInput');
    chipRow(rr, [
      ['osrm', 'OSRM 公共服务器', '免 Key，但它是社区演示机，忙时限流'],
      ['custom', '我自己的', '支持 {profile} {fromLat} {fromLon} {toLat} {toLon}'],
      ['off', '关掉', '不请求任何路线服务，只画直线距离']
    ], CFG.route, 'data-route');
    function paintRoute() {
      if (rr) pickIn(rr, 'data-route', CFG.route);
      if (rWrap) rWrap.style.display = CFG.route === 'custom' ? '' : 'none';
      if (rIn && CFG.routeUrl) rIn.value = CFG.routeUrl;
    }
    paintRoute();
    if (rr) Array.prototype.forEach.call(rr.querySelectorAll('[data-route]'), function (b) {
      b.addEventListener('click', function () {
        CFG.route = b.getAttribute('data-route');
        paintRoute();
        saveCfg();
        routeCache = {};
        if (S.map) drawRoutes();
      });
    });
    if (rIn) rIn.addEventListener('change', function () {
      CFG.routeUrl = rIn.value.trim();
      saveCfg();
      routeCache = {};
      if (S.map && S.me && S.selSpot) drawRoutes();
    });

    // 5) 本机存储：用量与清理
    var info = $('storeInfo');
    function paintStore() {
      if (!info || !window.Store) return;
      var d = Store.info();
      var mb = d.bytes / 1024 / 1024;
      info.textContent = '当前存储：' + (d.backend === 'idb' ? 'IndexedDB' : 'localStorage（兼容模式）') +
        ' · ' + d.keys + ' 项 · 约 ' + (mb < 0.1 ? (d.bytes / 1024).toFixed(0) + ' KB' : mb.toFixed(2) + ' MB') +
        (d.migrated ? ' · 已从旧版 localStorage 迁移 ' + d.migrated + ' 项' : '');
      info.textContent += ' · 版本 ' + BUILD;
    }
    paintStore();
    var clearBtn = $('btnClearCache');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      if (!window.Store) return;
      var n = Store.clearCache();
      paintStore();
      clearBtn.textContent = '已清 ' + n + ' 项缓存';
      setTimeout(function () { clearBtn.textContent = '清空缓存数据'; }, 2500);
    });
    if (info) info.addEventListener('click', paintStore);
  }


  function loadUi() {
    try {
      var raw = Store.getItem('lc:ui');
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o.palette) UI.palette = o.palette;
      if (o.fs) UI.fs = o.fs;
      UI.perf = !!o.perf;
      UI.aurora = o.aurora !== false;
    } catch (e) { /* 用默认值 */ }
  }
  function saveUi() {
    try { Store.setItem('lc:ui', JSON.stringify(UI)); } catch (e) { /* 忽略 */ }
  }
  function applyUi() {
    var root = document.documentElement;
    var p = PALETTES.filter(function (x) { return x.id === UI.palette; })[0] || PALETTES[0];
    root.style.setProperty('--a1', p.a1);
    root.style.setProperty('--a2', p.a2);
    root.style.setProperty('--a3', p.a3);
    root.style.setProperty('--fs', UI.fs + 'px');
    document.body.classList.toggle('perf', !!UI.perf);
    document.body.classList.toggle('no-aurora', !UI.aurora);
    var row = $('palRow');
    if (row) {
      row.innerHTML = PALETTES.map(function (x) {
        return '<button class="swatch' + (x.id === UI.palette ? ' on' : '') + '" data-pal="' + x.id +
          '" aria-label="' + x.name + '" style="--s1:' + x.a1 + ';--s2:' + x.a2 + '"></button>';
      }).join('');
      Array.prototype.forEach.call(row.querySelectorAll('[data-pal]'), function (b) {
        b.addEventListener('click', function () {
          UI.palette = b.getAttribute('data-pal'); applyUi(); saveUi();
        });
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-fs]'), function (b) {
      b.classList.toggle('on', parseFloat(b.getAttribute('data-fs')) === UI.fs);
    });
    if ($('chkPerf')) $('chkPerf').classList.toggle('on', !!UI.perf);
    if ($('chkAurora')) $('chkAurora').classList.toggle('on', !!UI.aurora);
  }

  /* ------------------------------------------------ 交互层 */
  function initFx() {
    var layer = $('ripples');
    var tip = $('tip');
    if (layer) {
      document.addEventListener('pointerdown', function (e) {
        if (document.body.classList.contains('perf')) return;
        var i = document.createElement('i');
        i.className = 'ring';
        i.style.left = e.clientX + 'px';
        i.style.top = e.clientY + 'px';
        layer.appendChild(i);
        setTimeout(function () { if (i.parentNode) i.parentNode.removeChild(i); }, 1000);
      }, { passive: true });
    }
    if (!tip) return;
    var timer = null;
    function hide() { tip.classList.remove('on'); }
    document.addEventListener('pointerover', function (e) {
      var t = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (!t) return;
      clearTimeout(timer);
      var parts = t.getAttribute('data-tip').split('|');
      var x = e.clientX, y = e.clientY;
      timer = setTimeout(function () {
        tip.innerHTML = '<b>' + esc(parts[0]) + '</b><span>' + esc(parts[1] || '') + '</span>';
        tip.classList.add('on');
        var w = Math.min(340, window.innerWidth - 24);
        tip.style.left = Math.min(Math.max(12, x - w / 2), window.innerWidth - w - 12) + 'px';
        var top = y + 16;
        if (top + 90 > window.innerHeight) top = Math.max(12, y - 100);
        tip.style.top = top + 'px';
      }, 700);
    });
    document.addEventListener('pointerout', function (e) {
      if (e.target.closest && e.target.closest('[data-tip]')) { clearTimeout(timer); hide(); }
    });
    document.addEventListener('pointermove', function (e) {
      var t = e.target.closest ? e.target.closest('.card') : null;
      if (!t) return;
      var r = t.getBoundingClientRect();
      t.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      t.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }

  /* ------------------------------------------------ 手动选点 */
  var KIND_LABEL = {
    lake: '湖', reservoir: '水库', water: '水面', pond: '塘', river: '河', canal: '运河',
    stream: '溪流', bay: '湾', strait: '海峡', wetland: '湿地', waterway: '水道',
    place: '地名', village: '村', town: '镇', city: '城市', administrative: '行政区'
  };

  /* 搜到的水域常常给的是「湖心」坐标；直接定位会落在水中央 → 换算到离你最近的岸边点 */
  function nearestOnBbox(bb, me) {
    if (!bb) return null;
    var lat = Math.min(bb[3], Math.max(bb[1], me ? me.lat : (bb[1] + bb[3]) / 2));
    var lon = Math.min(bb[2], Math.max(bb[0], me ? me.lon : (bb[0] + bb[2]) / 2));
    var inside = lat > bb[1] && lat < bb[3] && lon > bb[0] && lon < bb[2];
    if (inside) {
      var dS = lat - bb[1], dN = bb[3] - lat, dW = lon - bb[0], dE = bb[2] - lon;
      var m = Math.min(dS, dN, dW, dE);
      if (m === dS) lat = bb[1] + 0.0015;
      else if (m === dN) lat = bb[3] - 0.0015;
      else if (m === dW) lon = bb[0] + 0.0015;
      else lon = bb[2] - 0.0015;
    }
    return { lat: lat, lon: lon };
  }

  function pickSearchResult(r) {
    closeModal('modalManual');
    var input = $('searchInput'), results = $('searchResults');
    if (input) input.value = '';
    if (results) results.innerHTML = '';
    var isWater = r.kind === 'lake' || r.kind === 'reservoir' || r.kind === 'water' ||
      r.kind === 'river' || r.kind === 'bay' || r.kind === 'wetland' || r.kind === 'pond';
    var pt = isWater && r.bbox ? nearestOnBbox(r.bbox, S.me) : { lat: r.lat, lon: r.lon };
    setMe(pt.lat, pt.lon, null, isWater ? r.name : null);
  }

  /* 找水域弹窗里的常用地点（点一下直接切过去） */
  function renderManualFavs() {
    var box = $('manualFavs');
    if (!box) return;
    var favs = (window.My && window.My.favorites) ? window.My.favorites() : [];
    if (!favs.length) {
      box.innerHTML = '<p class="hint">还没有常用地点 —— 定位到钓点后到「我的 → 常用地点」保存。</p>';
      return;
    }
    box.innerHTML = favs.map(function (f, i) {
      return '<button data-mfav="' + i + '">★ ' + esc(f.name) +
        '<em>' + (f.desc ? esc(f.desc) + ' · ' : '') + f.lat.toFixed(4) + ', ' + f.lon.toFixed(4) +
        ((f.photos || []).length ? ' · ' + f.photos.length + ' 张图' : '') + '</em></button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-mfav]'), function (b) {
      b.addEventListener('click', function () {
        var f = favs[parseInt(b.getAttribute('data-mfav'), 10)];
        if (!f) return;
        closeModal('modalManual');
        setMe(f.lat, f.lon, null, f.name, 'fav');
      });
    });
  }

  function initManual() {
    var input = $('searchInput'), results = $('searchResults');
    var tmr = null, lastList = [];

    var EXAMPLES = ['太湖', '千岛湖', '鄱阳湖', '洞庭湖', '洪湖', '巢湖', '密云水库', '丹江口水库'];

    function showEmpty() {
      if (!results) return;
      results.innerHTML = '<p class="hint">没搜到。可以直接填经纬度，或点下面的常用水域：</p>' +
        '<div class="chiprow">' + EXAMPLES.map(function (x) {
          return '<button class="chip" data-ex="' + x + '">' + x + '</button>';
        }).join('') + '</div>';
      Array.prototype.forEach.call(results.querySelectorAll('[data-ex]'), function (b) {
        b.addEventListener('click', function () {
          if (input) { input.value = b.getAttribute('data-ex'); input.dispatchEvent(new Event('input')); }
        });
      });
    }

    function doSearch() {
      var q = (input && input.value || '').trim();
      if (q.length < 1) { if (results) results.innerHTML = ''; return; }
      if (results) results.innerHTML = '<p class="hint">正在搜索「' + esc(q) + '」…</p>';
      window.Api.search(q).then(function (list) {
        if (!results) return;
        lastList = list;
        if (!list.length) { showEmpty(); return; }
        results.innerHTML = list.map(function (r, i) {
          var kind = KIND_LABEL[r.kind] || r.kind || '地点';
          var isWater = kind === '湖' || kind === '水库' || kind === '水面' || kind === '河' || kind === '湾';
          return '<button data-res="' + i + '"><span class="restag' + (isWater ? ' water' : '') + '">' + esc(kind) + '</span> ' +
            esc(r.name) + ' <em>' + esc(r.label || '') + '<br>' +
            (r.bbox ? '水域范围 · 会落到离你最近的岸边' : r.lat.toFixed(4) + ', ' + r.lon.toFixed(4)) +
            ' · ' + (r.source === 'osm' ? 'OpenStreetMap' : 'Open-Meteo') + '</em></button>';
        }).join('');
        Array.prototype.forEach.call(results.querySelectorAll('[data-res]'), function (b) {
          b.addEventListener('click', function () {
            pickSearchResult(lastList[parseInt(b.getAttribute('data-res'), 10)]);
          });
        });
      }).catch(function () {
        if (results) results.innerHTML = '<p class="hint">搜索服务没响应，试试直接填坐标。</p>';
      });
    }

    if (input) {
      input.addEventListener('input', function () {
        clearTimeout(tmr);
        var q = input.value.trim();
        if (q.length < 1) { if (results) results.innerHTML = ''; return; }
        tmr = setTimeout(doSearch, 700);   // Nominatim 使用政策：别高频
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { clearTimeout(tmr); doSearch(); }
      });
    }

    var useBtn = $('btnUseCoord');
    if (useBtn) {
      useBtn.addEventListener('click', function () {
        var latEl = $('latInput'), lonEl = $('lonInput');
        var lat = parseFloat(latEl ? latEl.value : '');
        var lon = parseFloat(lonEl ? lonEl.value : '');
        if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          useBtn.classList.add('failed');
          setTimeout(function () { useBtn.classList.remove('failed'); }, 900);
          return;
        }
        useBtn.classList.add('done');
        setTimeout(function () { useBtn.classList.remove('done'); }, 700);
        closeModal('modalManual');
        setMe(lat, lon, null);
      });
    }
  }

  /* ------------------------------------------------ 启动 */
  function parseParams() {
    var q = new URLSearchParams(location.search);
    var lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
    if (isFinite(lat) && isFinite(lon)) return { lat: lat, lon: lon };
    if (q.get('demo')) return { lat: 29.5700, lon: 119.0200 };
    return null;
  }

  function bind() {
    if ($('btnRefresh')) $('btnRefresh').addEventListener('click', function () { refresh(true); });
    if ($('btnHere')) $('btnHere').addEventListener('click', locate);
    if ($('btnManual')) $('btnManual').addEventListener('click', function () { renderManualFavs(); openModal('modalManual'); });
    if ($('btnFitMap')) $('btnFitMap').addEventListener('click', fitAll);
    if ($('btnMapFull')) $('btnMapFull').addEventListener('click', function () { mapFull(); });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && $('cardMap') && $('cardMap').classList.contains('fs')) mapFull(false);
    });
    if ($('btnSat')) $('btnSat').addEventListener('click', runSat);
    // 语言
    var langRow = $('langRow');
    if (langRow && window.I18N) {
      langRow.innerHTML = I18N.LANGS.map(function (l) {
        return '<button class="chip' + (l.id === I18N.get() ? ' on' : '') + '" data-lang="' + l.id + '">' + l.name + '</button>';
      }).join('');
      Array.prototype.forEach.call(langRow.querySelectorAll('[data-lang]'), function (b) {
        b.addEventListener('click', function () {
          I18N.set(b.getAttribute('data-lang'));
          Array.prototype.forEach.call(langRow.querySelectorAll('[data-lang]'), function (x) {
            x.classList.toggle('on', x.getAttribute('data-lang') === I18N.get());
          });
          applyTabNames();
          renderAll();
        });
      });
    }
    // 分区改名
    Array.prototype.forEach.call(document.querySelectorAll('[data-tabname]'), function (inp) {
      inp.addEventListener('change', function () {
        var k = inp.getAttribute('data-tabname');
        var v = inp.value.trim().slice(0, 8);
        if (v) tabNames[k] = v; else delete tabNames[k];
        saveTabNames();
        applyTabNames();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () { applyTab(b.getAttribute('data-tab')); });
    });
    if ($('btnSettings')) $('btnSettings').addEventListener('click', function () { openModal('modalSettings'); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', function () { closeModal(b.getAttribute('data-close')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) m.classList.add('hidden'); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-fs]'), function (b) {
      b.addEventListener('click', function () {
        UI.fs = parseFloat(b.getAttribute('data-fs'));
        applyUi(); saveUi();
      });
    });
    if ($('mapUrlInput')) {
      $('mapUrlInput').addEventListener('change', function () {
        MAPCFG.url = $('mapUrlInput').value.trim();
        MAPCFG.style = MAPCFG.url ? 'custom' : MAPCFG.style;
        applyBasemap(); saveMapCfg();
      });
    }
    if ($('mapKeyInput')) {
      $('mapKeyInput').addEventListener('change', function () {
        MAPCFG.key = $('mapKeyInput').value.trim();
        applyBasemap(); saveMapCfg();
      });
    }
    if ($('chkPerf')) $('chkPerf').addEventListener('click', function () { UI.perf = !UI.perf; applyUi(); saveUi(); });
    if ($('chkAurora')) $('chkAurora').addEventListener('click', function () { UI.aurora = !UI.aurora; applyUi(); saveUi(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (m) { m.classList.add('hidden'); });
    });
  }

  /* ------------------------------------------------ 原生（Capacitor）适配 */
  function isNative() {
    var c = window.Capacitor;
    return !!(c && c.isNativePlatform && c.isNativePlatform());
  }

  function initNative() {
    if (!isNative()) return;
    document.body.classList.add('native');
    var cap = window.Capacitor;
    var AppPlugin = cap.Plugins && cap.Plugins.App;
    if (AppPlugin && AppPlugin.addListener) {
      // 安卓返回键：先关弹窗 → 再回「结论」→ 最后才退出
      AppPlugin.addListener('backButton', function () {
        if ($('cardMap') && $('cardMap').classList.contains('fs')) { mapFull(false); return; }
        var open = document.querySelectorAll('.modal:not(.hidden)');
        if (open.length) {
          Array.prototype.forEach.call(open, function (m) { m.classList.add('hidden'); });
          return;
        }
        if (S.tab !== 'summary') { applyTab('summary'); return; }
        if (AppPlugin.exitApp) AppPlugin.exitApp();
      });
    }
    // 原生定位：权限弹窗更正规（插件已在 app.js 的 locate() 里优先使用）
    var Geo = cap.Plugins && cap.Plugins.Geolocation;
    if (Geo && Geo.requestPermissions) {
      Geo.requestPermissions().catch(function () { /* 用户拒绝就走手动选点 */ });
    }
  }

  /* 原生壳里 Capacitor 的 fetch 补丁把响应经 JS 桥回传：小 JSON 没问题，
     但卫星 COG 的 Range 读取动辄几百 KB，实测 384 KB 就在 13 s 后报 Failed to fetch，XHR 同样失败。
     所以只把 .tif（COG）这类大二进制转交「同源 iframe 里的原始 fetch」，走 WebView 自己的网络栈；
     其余请求继续享受补丁的绕 CORS 能力。 */
  var COG_URL = /\.tiff?(\?|#|$)/i;
  function rawFetch() {
    if (rawFetch.c !== undefined) return rawFetch.c;
    rawFetch.c = null;
    try {
      var f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.src = 'about:blank';
      f.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none';
      (document.body || document.documentElement).appendChild(f);
      rawFetch.c = f.contentWindow.fetch.bind(f.contentWindow);
    } catch (e) { rawFetch.c = null; }
    return rawFetch.c;
  }
  function installCogBridge() {
    if (window.__lcCogBridge) return;
    var cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
    var patched = window.fetch, raw = rawFetch();
    if (!raw || patched === raw) return;
    window.__lcCogBridge = true;
    window.fetch = function (input, init) {
      var u = typeof input === 'string' ? input : (input && input.url) || '';
      if (COG_URL.test(u)) {
        try { return raw(input, init); } catch (e) { /* 回落补丁 fetch */ }
      }
      return patched.apply(this, arguments);
    };
  }

  function boot() {
    if (window.I18N) { I18N.load(); }
    loadTabNames();
    loadUi();
    loadUi();
    loadMapCfg();
    loadCfg();
    initCfgUI();
    applyUi();
    applyBasemap();
    initFx();
    initManual();
    if (window.My && window.My.init) window.My.init();
    if (window.AI && window.AI.bind) window.AI.bind();
    initNative();
    installCogBridge();
    bind();
    applyTabNames();
    if (window.I18N) I18N.apply();
    // 页脚显示构建号：看到的是旧版时能立刻发现（配合资源 URL 上的 ?v=）
    if ($('buildTag')) $('buildTag').textContent = '构建 ' + BUILD;
    showSkeletons();
    var savedTab = 'summary';
    try { savedTab = Store.getItem('lc:tab') || 'summary'; } catch (e) { /* 忽略 */ }
    applyTab(savedTab);
    var p = parseParams();
    if (p) setMe(p.lat, p.lon, null, null, 'url');
    else {
      // 首帧渲染出错不能连累定位：各卡片是独立渲染的，真正致命的是拿不到位置
      try { renderAll(); } catch (e) { if (window.console) console.warn('首帧渲染异常（已忽略）', e); }
      locate();
    }
    setInterval(function () {
      if (document.hidden || !S.me || S.loading) return;
      refresh(false);      // 走缓存：10 分钟内直接返回，过期才真正拉
    }, 10 * 60 * 1000);
    // 原生壳里页面来自 https://localhost（本地资源），SW 抓不到可缓存的东西，
    // 注册只会在控制台多一条 fetch 失败；浏览器/装成 PWA 时才注册。
    var isNativeShell = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if ('serviceWorker' in navigator && !isNativeShell && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 离线能力可选 */ });
    }
  }

  /* 等存储层就绪（IndexedDB 读入内存 + localStorage 迁移）再启动，
     否则首屏会读到空的设置与渔获。 */
  function start() {
    var s = window.Store;
    if (s && s.ready) s.ready.then(boot, boot);
    else boot();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.LureCast = {
    state: S, cfg: CFG, store: Store, refresh: refresh, setMe: setMe, locate: locate,
    applyTabNames: applyTabNames, renderAll: renderAll, drawMap: drawMap, drawRoutes: drawRoutes,
    mapFull: mapFull
  };
})();
