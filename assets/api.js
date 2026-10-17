/* LureCast · 网络层
   全部使用免 Key 的公开接口：
   - Open-Meteo Forecast（ICON/GFS）：天气、气压、风、云、降水
   - Open-Meteo Marine：浪高、海表温、潮位（内陆返回 null，正好用来判海域）
   - Open-Meteo Flood（GloFAS）：河道流量 river_discharge
   - Open-Meteo Elevation（Copernicus DEM 90m）：高程采样
   - Open-Meteo Geocoding：地名搜索
   - OpenStreetMap Overpass / Nominatim：水域几何、逆地理
   缓存：localStorage，TTL 10 分钟（省流量、断网还能看上次结果）。 */
(function () {
  'use strict';
  // 存储统一走 Store（IndexedDB 同步门面）；极端情况下退回 localStorage，行为一致
  var Store = window.Store || window.localStorage;

  var OM = 'https://api.open-meteo.com/v1';
  var CACHE_TTL = 10 * 60 * 1000;
  /* 每类数据的"该多久变"完全不同，缓存寿命就该分开：
     天气 10 分钟、海况 30 分钟、汇流 3 小时、OSM 岸线 7 天、地名 30 天。
     这样第二次打开同一钓点几乎不发请求，秒开。 */
  var TTL = {
    wx: 10 * 60 * 1000,
    sea: 30 * 60 * 1000,
    flood: 3 * 60 * 60 * 1000,
    osm: 7 * 24 * 60 * 60 * 1000,
    rev: 30 * 24 * 60 * 60 * 1000,
    els: 30 * 24 * 60 * 60 * 1000
  };
  function ttlFor(name) {
    return TTL[String(name).split(':')[0]] || CACHE_TTL;
  }
  var CACHE_PREFIX = 'lc:v1:';

  function key(name, lat, lon) {
    return CACHE_PREFIX + name + ':' + lat.toFixed(3) + ',' + lon.toFixed(3);
  }
  function readCache(k, ttl) {
    try {
      var raw = Store.getItem(k);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return { data: o.d, at: o.t, stale: Date.now() - o.t > (ttl || CACHE_TTL) };
    } catch (e) { return null; }
  }
  function writeCache(k, d) {
    try { Store.setItem(k, JSON.stringify({ t: Date.now(), d: d })); } catch (e) { /* 写失败就放弃缓存 */ }
  }

  function fetchJSON(url, opts, timeoutMs) {
    var attempts = 0;
    function once() {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs || 20000) : null;
      var o = {};
      for (var k in (opts || {})) { if (k.indexOf('__') !== 0) o[k] = opts[k]; }
      if (ctl) o.signal = ctl.signal;
      return fetch(url, o).then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) {
          var err = new Error('HTTP ' + r.status);
          err.status = r.status;
          throw err;
        }
        return r.json();
      }, function (e) {
        if (timer) clearTimeout(timer);
        throw e;
      });
    }
    // 免费接口会突发 429/503：退避重试两次再算失败
    // opts.__noRetry：Overpass 这种「自己会换端点」的调用不要再叠加重试，否则 4 端点 × 3 次 × 14 s = 一分多钟
    function tryAgain(e) {
      if (!opts || !opts.__noRetry) {
        var retryable = !e.status || e.status === 429 || e.status === 500 || e.status === 502 || e.status === 503 || e.status === 504;
        if (!retryable || attempts >= 2) throw e;
      } else {
        throw e;
      }
      attempts++;
      return new Promise(function (res) { setTimeout(res, 500 * attempts); }).then(once).catch(tryAgain);
    }
    return once().catch(tryAgain);
  }

  /* 带缓存的一次取数：失败时退回旧缓存（stale），并把 stale 标出来给 UI 用 */
  function cached(name, lat, lon, force, run) {
    var k = key(name, lat, lon);
    var hit = readCache(k, ttlFor(name));
    if (hit && !hit.stale && !force) {
      return Promise.resolve({ data: hit.data, at: hit.at, fromCache: true });
    }
    if (hit && !force) {
      // 过期了：先把旧数据交出去（页面立刻可用），后台再拉新的
      var revalidate = run().then(function (data) {
        writeCache(k, data);
        return { data: data, at: Date.now() };
      }).catch(function () { return null; });
      return Promise.resolve({
        data: hit.data, at: hit.at, fromCache: true, stale: true, revalidate: revalidate
      });
    }
    return run().then(function (data) {
      writeCache(k, data);
      return { data: data, at: Date.now(), fromCache: false };
    }).catch(function (e) {
      if (hit) return { data: hit.data, at: hit.at, fromCache: true, stale: true, error: e };
      throw e;
    });
  }

  /* ---------------------------------------------------------------- 天气 */
  var FORECAST_CURRENT = [
    'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'precipitation',
    'weather_code', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m',
    'wind_gusts_10m'
  ].join(',');
  var FORECAST_HOURLY = [
    'temperature_2m', 'relative_humidity_2m', 'precipitation', 'precipitation_probability',
    'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'
  ].join(',');

  function weather(lat, lon, force) {
    return cached('wx', lat, lon, force, function () {
      var u = OM + '/forecast?latitude=' + lat + '&longitude=' + lon +
        '&current=' + FORECAST_CURRENT +
        '&hourly=' + FORECAST_HOURLY +
        '&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max' +
        '&past_days=1&forecast_days=3&timezone=auto&wind_speed_unit=ms';
      return fetchJSON(u, null, 22000);
    });
  }

  /* ---------------------------------------------------------------- 海况（同时用来判是否靠海） */
  function marine(lat, lon, force) {
    return cached('sea', lat, lon, force, function () {
      var u = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lon +
        '&current=wave_height,wave_period,wave_direction,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity' +
        '&hourly=sea_level_height_msl,wave_height&timezone=auto&forecast_days=2';
      return fetchJSON(u, null, 20000);
    });
  }

  /* ---------------------------------------------------------------- 河道流量（GloFAS） */
  function flood(lat, lon, force) {
    return cached('flood', lat, lon, force, function () {
      var u = 'https://flood-api.open-meteo.com/v1/flood?latitude=' + lat + '&longitude=' + lon +
        '&daily=river_discharge,river_discharge_mean,river_discharge_max' +
        '&past_days=14&forecast_days=5';
      return fetchJSON(u, null, 22000);
    });
  }

  /* ---------------------------------------------------------------- 高程（批量，单次上限 100 点） */
  /* 高程点缓存：DEM 一年也不变，按 4 位小数（≈11 m）缓存，附近换钓点直接命中 */
  var elevMem = null;
  function elevStore() {
    if (!elevMem) {
      try { elevMem = JSON.parse(Store.getItem('lc:elev') || '{}'); } catch (e) { elevMem = {}; }
    }
    return elevMem;
  }
  function elevKey(p) { return p.lat.toFixed(4) + ',' + p.lon.toFixed(4); }
  function elevFlush() {
    try {
      var keys = Object.keys(elevMem);
      if (keys.length > 6000) {                     // 超量就砍掉最老的一半（对象键顺序＝插入顺序）
        keys.slice(0, keys.length - 3000).forEach(function (k) { delete elevMem[k]; });
      }
      Store.setItem('lc:elev', JSON.stringify(elevMem));
    } catch (e) { /* 配额满就算了，内存里还有 */ }
  }

  function elevationChunk(pts) {
    var la = pts.map(function (p) { return p.lat.toFixed(5); }).join(',');
    var lo = pts.map(function (p) { return p.lon.toFixed(5); }).join(',');
    return fetchJSON(OM + '/elevation?latitude=' + la + '&longitude=' + lo, null, 20000)
      .then(function (j) { return j.elevation || []; });
  }
  function elevation(pts) {
    var store = elevStore();
    var need = [], idx = [];
    pts.forEach(function (p) {
      var k = elevKey(p);
      if (store[k] == null) { need.push(p); idx.push(k); }
    });
    function fill() {
      return pts.map(function (p) {
        var v = store[elevKey(p)];
        return v == null ? null : v;
      });
    }
    if (!need.length) return Promise.resolve(fill());
    var chunks = [];
    for (var i = 0; i < need.length; i += 90) chunks.push(need.slice(i, i + 90));
    return Promise.all(chunks.map(elevationChunk)).then(function (arrs) {
      var got = arrs.reduce(function (x, y) { return x.concat(y); }, []);
      idx.forEach(function (k, i) { if (got[i] != null) store[k] = got[i]; });
      elevFlush();
      return fill();
    });
  }

  /* ---------------------------------------------------------------- OSM 水域几何 */
  /* out geom(s,w,n,e) 会把几何裁到 bbox：大湖的多边形动辄几 MB，裁剪后只剩附近那一圈，
     手机端才拉得动。代价是被裁开的环不再是闭合环，水下侧改用高程判断（见 engine.js）。 */
  function bboxOf(lat, lon, radius) {
    var dLat = radius / 111320;
    var dLon = radius / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    return [(lat - dLat).toFixed(4), (lon - dLon).toFixed(4),
      (lat + dLat).toFixed(4), (lon + dLon).toFixed(4)].join(',');
  }
  function overpassQuery(lat, lon, radius) {
    var r = Math.round(radius);
    return '[out:json][timeout:25];(' +
      'way(around:' + r + ',' + lat + ',' + lon + ')[natural=water];' +
      'relation(around:' + r + ',' + lat + ',' + lon + ')[natural=water];' +
      'way(around:' + r + ',' + lat + ',' + lon + ')[waterway~"^(river|stream|canal|riverbank)$"];' +
      'relation(around:' + r + ',' + lat + ',' + lon + ')[waterway~"^(river)$"];' +
      'way(around:' + r + ',' + lat + ',' + lon + ')[natural=coastline];' +
      'relation(around:' + r + ',' + lat + ',' + lon + ')[landuse=reservoir];' +
      'way(around:' + r + ',' + lat + ',' + lon + ')[landuse=reservoir];' +
      ');out geom(' + bboxOf(lat, lon, r * 1.15) + ');';
  }
  /* Overpass 是免费公共服务，单点经常 502/429（实测 overpass-api.de 会整段 502）。
     这里按顺序自动切换端点，任何一个成功就用它；全挂才报错。 */
  var OVERPASS_ENDPOINTS = [
    { url: 'https://overpass-api.de/api/interpreter', name: 'overpass-api.de' },
    { url: 'https://overpass.private.coffee/api/interpreter', name: 'private.coffee' },
    { url: 'https://overpass.kumi.systems/api/interpreter', name: 'kumi.systems' },
    { url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', name: 'mail.ru' }
  ];
  var lastGoodEndpoint = 0;
  var badUntil = {};        // 端点名 -> 时间戳：失败过就冷却 3 分钟，别每次都白等

  function fetchOverpass(q, perTryMs) {
    var deadline = Date.now() + 18000;   // 整体超时：换端点可以，但总共不超过 18 s（移动网络实测单次可达 40 s+，12 s 必失手）
    var healthy = OVERPASS_ENDPOINTS.filter(function (ep) {
      return !badUntil[ep.name] || Date.now() > badUntil[ep.name];
    });
    if (!healthy.length) {
      var dead = new Error('Overpass 端点全部在冷却（刚都失败了）');
      dead.allFailed = true;
      return Promise.reject(dead);
    }
    var order = [];
    for (var i = 0; i < healthy.length; i++) {
      order.push(healthy[(lastGoodEndpoint + i) % healthy.length]);
    }
    var idx = 0, errors = [];
    function attempt() {
      if (idx >= order.length || Date.now() > deadline) {
        var e = new Error(errors.join(' / ') || 'Overpass 全部端点不可用（超时）');
        e.allFailed = true;
        throw e;
      }
      var ep = order[idx++];
      // GET 更容易被缓存、也避开部分镜像对 POST 的限制
      var url = ep.url + '?data=' + encodeURIComponent(q);
      return fetchJSON(url, { headers: { 'Accept': 'application/json' }, __noRetry: true }, perTryMs || 10000)
        .then(function (data) {
          lastGoodEndpoint = OVERPASS_ENDPOINTS.indexOf(ep);
          delete badUntil[ep.name];
          return data;
        })
        .catch(function (err) {
          errors.push(ep.name + ':' + (err && err.message ? err.message : 'fail'));
          badUntil[ep.name] = Date.now() + 3 * 60 * 1000;
          return attempt();
        });
    }
    return attempt();
  }

  /* 单一水域要素（搜索结果点进来时用，只要那一块） */
  function osmById(type, id, bbox) {
    var q = '[out:json][timeout:25];' + type + '(' + id + ');out geom' +
      (bbox ? '(' + bbox.join(',') + ')' : '') + ';';
    return fetchOverpass(q, 14000);
  }

  function osm(lat, lon, radius, force) {
    var r = radius || 1600;
    return cached('osm:' + r, lat, lon, force, function () {
      var q = overpassQuery(lat, lon, r);
      return fetchOverpass(q, 14000).catch(function (err) {
        // 全部端点失败：退回 12 小时内成功过的结果，别让页面空着
        var longKey = CACHE_PREFIX + 'osmlong:' + r + ':' + lat.toFixed(3) + ',' + lon.toFixed(3);
        var longHit = readCache(longKey);
        if (longHit) {
          longHit.data.__stale = true;
          return longHit.data;
        }
        throw err;
      }).then(function (data) {
        try {
          Store.setItem(CACHE_PREFIX + 'osmlong:' + r + ':' + lat.toFixed(3) + ',' + lon.toFixed(3),
            JSON.stringify({ t: Date.now(), d: data }));
        } catch (e) { /* 配额满就算了 */ }
        return data;
      });
    });
  }

  /* ---------------------------------------------------------------- 逆地理 / 搜索 */
  function reverse(lat, lon) {
    var k = CACHE_PREFIX + 'rev:' + lat.toFixed(3) + ',' + lon.toFixed(3);
    var hit = readCache(k, ttlFor('rev'));
    if (hit && !hit.stale) return Promise.resolve(hit.data);
    var u = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=zh&lat=' + lat + '&lon=' + lon;
    return fetchJSON(u, { headers: { 'Accept-Language': 'zh' } }, 15000)
      .then(function (j) { writeCache(k, j); return j; })
      .catch(function () { return hit ? hit.data : null; });
  }

  /* 地名/水域搜索
     主源用 OpenStreetMap Nominatim：中文湖泊名命中率远高于 Open-Meteo
     （实测 12 个国内大湖：Nominatim 12/12 命中并带 lake/reservoir 类型，
      Open-Meteo Geocoding 只命中 6 个，鄱阳湖/洞庭湖/呼伦湖/查干湖/微山湖/丹江口 全空）。
     Open-Meteo 作为兜底（它还会给海拔）。 */
  var WATER_TYPES = {
    lake: 1, reservoir: 1, water: 1, pond: 1, basin: 1, river: 1, canal: 1,
    stream: 1, bay: 1, strait: 1, lagoon: 1, wetland: 1, waterway: 1, dock: 1
  };

  function rankPlace(r) {
    var t = (r.type || '').toLowerCase();
    var score = 0;
    if (WATER_TYPES[t]) score += 100;
    if ((r.cls || r.class || '') === 'natural' || (r.cls || '') === 'waterway') score += 20;
    if (/湖|海|水库|河|湾|江|潭|淀|漾/.test(r.name || '')) score += 30;
    return score;
  }

  function normalizeNominatim(j) {
    return (j || []).map(function (r) {
      var bb = (r.boundingbox || []).map(parseFloat);   // [south, north, west, east]
      return {
        name: r.name || (r.display_name || '').split(',')[0],
        label: r.display_name,
        lat: parseFloat(r.lat), lon: parseFloat(r.lon),
        kind: r.type, cls: r.class || r.category,
        bbox: bb.length === 4 ? [bb[2], bb[0], bb[3], bb[1]] : null,
        osmType: r.osm_type, osmId: r.osm_id,
        source: 'osm'
      };
    }).filter(function (r) { return isFinite(r.lat) && isFinite(r.lon); });
  }

  function search(q) {
    var nomi = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=zh&q=' +
      encodeURIComponent(q);
    return fetchJSON(nomi, { headers: { 'Accept-Language': 'zh' } }, 12000)
      .then(function (j) { return normalizeNominatim(j); })
      .catch(function () { return []; })
      .then(function (list) {
        list.sort(function (a, b) { return rankPlace(b) - rankPlace(a); });
        if (list.length) return list;
        // 兜底：Open-Meteo Geocoding
        var u = 'https://geocoding-api.open-meteo.com/v1/search?count=8&language=zh&format=json&name=' +
          encodeURIComponent(q);
        return fetchJSON(u, null, 12000).then(function (j) {
          return (j.results || []).map(function (r) {
            return {
              name: r.name, label: [r.admin1, r.country].filter(Boolean).join(' · '),
              lat: r.latitude, lon: r.longitude, kind: 'place', source: 'open-meteo', bbox: null
            };
          });
        }).catch(function () { return []; });
      });
  }

  /* 缓存体检：每个数据源现在多旧、是不是还在有效期内 */
  function cacheReport(lat, lon) {
    var names = [['wx', '天气/气压/风'], ['sea', '海况潮位'], ['flood', '河道流量'], ['rev', '地名']];
    var out = names.map(function (n) {
      var hit = readCache(key(n[0], lat, lon), ttlFor(n[0]));
      if (!hit) return { name: n[1], age: null, fresh: false };
      return { name: n[1], age: Date.now() - hit.at, fresh: !hit.stale };
    });
    // 岸线可能来自 1.6 km、4 km 或 12 小时长缓存，取最新的那个
    var best = null;
    ['osm:1600', 'osm:4000'].forEach(function (nm) {
      var h = readCache(key(nm, lat, lon), ttlFor(nm));
      if (h && (!best || h.at > best.at)) best = h;
    });
    var longKey = CACHE_PREFIX + 'osmlong:1600:' + lat.toFixed(3) + ',' + lon.toFixed(3);
    var longHit = readCache(longKey, 12 * 3600 * 1000);
    if (longHit && (!best || longHit.at > best.at)) best = longHit;
    out.push(best
      ? { name: 'OSM 岸线', age: Date.now() - best.at, fresh: !best.stale }
      : { name: 'OSM 岸线', age: null, fresh: false });
    return out;
  }

  window.Api = {
    weather: weather,
    cacheReport: cacheReport,
    TTL: TTL,
    marine: marine,
    flood: flood,
    elevation: elevation,
    osm: osm,
    osmById: osmById,
    reverse: reverse,
    search: search,
    OVERPASS_ENDPOINTS: OVERPASS_ENDPOINTS,
    CACHE_TTL: CACHE_TTL
  };
})();
