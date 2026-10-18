// @ts-nocheck
/* LureCast · 卫星水面 / 水下结构（P4）—— 由 assets/sat.js 机械迁移
   ---------------------------------------------------------------------------
   跨 3 年抽查 6 期 Sentinel-2 L2A（AWS 开放数据 STAC），挑库水位最低的一期当主影像；
   只下载你周围 1–2 km 那一小块 COG 切片（GeoTIFF.fromUrl 必须带 allowFullFile:false，
   否则可能整幅 190 MB 全下）。蓝绿比推水深、SCL 去云、异常点用于「水下有结构」提示。
   geotiff.js（310 KB）不打包进 app chunk：第一次分析影像时才用 ?url 拉进来（见 lib/geotiff-loader）。
   与老壳唯一差别：window.GeoTIFF 改成注入的 GeoTIFF 对象，window.Sat 改成具名导出。 */
import { GeoTIFF } from './geotiff-loader'

/* 老壳这几个常量在 IIFE 顶部，机械迁移时漏了会报 D2R is not defined —— 补回来 */
var STAC = 'https://earth-search.aws.element84.com/v1/search'
var metaCache: any = {}     // href -> Promise<{tiff, levels}>
var D2R = Math.PI / 180

/* ---------------------------------------------------------------- 经纬度 → UTM（S2 瓦片都是 UTM） */
  function lonLatToUtm(lon, lat, epsg) {
    var zone = epsg % 100;
    var south = epsg >= 32700;
    var a = 6378137.0, f = 1 / 298.257223563;
    var e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    var lon0 = (zone * 6 - 183) * D2R;
    var rad = lat * D2R, lonRad = lon * D2R;
    var N = a / Math.sqrt(1 - e2 * Math.sin(rad) * Math.sin(rad));
    var T = Math.tan(rad) * Math.tan(rad);
    var C = ep2 * Math.cos(rad) * Math.cos(rad);
    var A = (lonRad - lon0) * Math.cos(rad);
    var e4 = e2 * e2, e6 = e4 * e2;
    var M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * rad
      - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * rad)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * rad)
      - (35 * e6 / 3072) * Math.sin(6 * rad));
    var k0 = 0.9996;
    var x = k0 * N * (A + (1 - T + C) * A * A * A / 6 +
      (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120) + 500000;
    var y = k0 * (M + N * Math.tan(rad) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 +
      (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
    if (south) y += 10000000;
    return [x, y];
  }

  function haversine(a, b) {
    var R = 6371000;
    var dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function lonLatBbox(lon, lat, radiusKm) {
    var dLat = radiusKm / 111.32;
    var dLon = radiusKm / (111.32 * Math.max(0.15, Math.cos(lat * D2R)));
    return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
  }

  function utmBox(bboxLonLat, epsg) {
    var sw = lonLatToUtm(bboxLonLat[0], bboxLonLat[1], epsg);
    var ne = lonLatToUtm(bboxLonLat[2], bboxLonLat[3], epsg);
    return [Math.min(sw[0], ne[0]), Math.min(sw[1], ne[1]), Math.max(sw[0], ne[0]), Math.max(sw[1], ne[1])];
  }

  /* ---------------------------------------------------------------- STAC 检索 */
  function search(bboxLonLat, opts) {
    opts = opts || {};
    var body = {
      collections: ['sentinel-2-l2a'],
      bbox: bboxLonLat,
      limit: opts.limit || 60,
      query: { 'eo:cloud_cover': { lt: opts.maxCloud || 20 } },
      sortby: [{ field: 'properties.datetime', direction: 'desc' }]
    };
    // datetime 必须是完整 RFC3339，给 "2024-01-01" 会 400
    if (opts.from) body.datetime = opts.from + '/' + new Date().toISOString();
    return fetch(STAC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('STAC HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      return (j.features || []).filter(function (f) {
        return f.assets && f.assets.green && f.assets.nir && f.assets.blue && f.assets.red &&
          f.properties && f.properties['proj:epsg'];
      });
    });
  }

  /* ---------------------------------------------------------------- COG 打开 + 金字塔层级 */
  function bandMeta(item, key) {
    var href = item.assets[key].href;
    if (!metaCache[href]) {
      metaCache[href] = GeoTIFF.fromUrl(href, { allowFullFile: false }).then(function (tiff) {
        return tiff.getImage(0).then(function (im0) {
          var origin = im0.getOrigin();
          var res0 = im0.getResolution();
          var w0 = im0.getWidth(), h0 = im0.getHeight();
          return tiff.getImageCount().then(function (n) {
            var levels = [{ i: 0, w: w0, h: h0, res: Math.abs(res0[0]) }];
            var chain = Promise.resolve();
            var max = Math.min(n, 5);
            for (var i = 1; i < max; i++) {
              (function (idx) {
                chain = chain.then(function () { return tiff.getImage(idx); }).then(function (im) {
                  levels.push({
                    i: idx, w: im.getWidth(), h: im.getHeight(),
                    res: Math.abs(res0[0]) * w0 / im.getWidth()
                  });
                }).catch(function () { /* 缺层就跳过 */ });
              })(i);
            }
            return chain.then(function () {
              return { tiff: tiff, origin: origin, res0: res0, levels: levels, w0: w0, h0: h0 };
            });
          });
        });
      });
    }
    return metaCache[href];
  }

  /* 读一块地物窗口：bboxLonLat → UTM → 选层级 → 像素 window → 读
     outPx: 输出边长像素；永远挑「刚刚够覆盖」的那一层，避免下载全分辨率瓦片 */
  function readAt(item, key, bboxLonLat, outPx) {
    var epsg = item.properties['proj:epsg'];
    var box = utmBox(bboxLonLat, epsg);
    var want = (box[2] - box[0]) / outPx;      // 目标地面分辨率 m/px
    return bandMeta(item, key).then(function (meta) {
      // 选「刚刚够覆盖目标分辨率」的那一层：既不掉精度，也不白拉全分辨率瓦片
      // 输出不做重采样，所以选「能装进 outPx 的最精细那一层」：
      // 从最细往粗找，第一个原生像素数 <= outPx 的就是它
      var lvl = meta.levels[meta.levels.length - 1];
      for (var i = 0; i < meta.levels.length; i++) {
        var px = (box[2] - box[0]) / meta.levels[i].res;
        if (px <= outPx * 1.05) { lvl = meta.levels[i]; break; }
      }
      var res = meta.levels[0].res * meta.w0 / lvl.w;
      // 注意 y 轴方向：origin 是左上（北）角，行号随纬度下降而增加
      var x0 = Math.max(0, Math.min(lvl.w - 1, Math.floor((box[0] - meta.origin[0]) / res)));
      var x1 = Math.max(x0 + 1, Math.min(lvl.w, Math.ceil((box[2] - meta.origin[0]) / res)));
      var y0 = Math.max(0, Math.min(lvl.h - 1, Math.floor((meta.origin[1] - box[3]) / res)));
      var y1 = Math.max(y0 + 1, Math.min(lvl.h, Math.ceil((meta.origin[1] - box[1]) / res)));
      // 关键：输出尺寸＝窗口原生像素数，绝不做二次重采样（重采样会让影像明显发糊）
      var w = Math.min(outPx, x1 - x0), h = Math.min(outPx, y1 - y0);
      return meta.tiff.getImage(lvl.i).then(function (im) {
        return im.readRasters({
          window: [x0, y0, x1, y1], width: x1 - x0, height: y1 - y0,
          resampleMethod: 'nearest', interleave: false
        }).then(function (r) {
          return { data: r[0], level: lvl.i, res: res, w: x1 - x0, h: y1 - y0 };
        });
      });
    });
  }

  /* 用 L2A 自带的场景分类波段（SCL）取水体：class 6 = 水面。
     比 NDWI 阈值可靠得多（SCL 已考虑云、阴影、雪），NDWI 只在 SCL 不可用时兜底。
     SCL 是 20 m，但通过 width/height 重采样到和可见光同一张网格。 */
  function readScl(item, bboxLonLat, W, H) {
    if (!item.assets || !item.assets.scl) return Promise.resolve(null);
    var epsg = item.properties['proj:epsg'];
    var box = utmBox(bboxLonLat, epsg);
    return bandMeta(item, 'scl').then(function (meta) {
      var lvl = meta.levels[meta.levels.length - 1];
      for (var i = 0; i < meta.levels.length; i++) {
        var px = (box[2] - box[0]) / meta.levels[i].res;
        if (px <= Math.max(W, H) * 1.1) { lvl = meta.levels[i]; break; }
      }
      var res = meta.levels[0].res * meta.w0 / lvl.w;
      var x0 = Math.max(0, Math.min(lvl.w - 1, Math.floor((box[0] - meta.origin[0]) / res)));
      var x1 = Math.max(x0 + 1, Math.min(lvl.w, Math.ceil((box[2] - meta.origin[0]) / res)));
      var y0 = Math.max(0, Math.min(lvl.h - 1, Math.floor((meta.origin[1] - box[3]) / res)));
      var y1 = Math.max(y0 + 1, Math.min(lvl.h, Math.ceil((meta.origin[1] - box[1]) / res)));
      return meta.tiff.getImage(lvl.i).then(function (im) {
        return im.readRasters({ window: [x0, y0, x1, y1], width: W, height: H, resampleMethod: 'nearest', interleave: false });
      }).then(function (r) { return r[0]; });
    }).catch(function () { return null; });
  }

  /* 水体制占比：NDWI = (绿 - 近红外)/(绿 + 近红外)，> 0.05 记作水体 */
  /* 场景读取缓存：同一期影像（同窗口同尺寸）只读一次，用户来回切期次才够快 */
  var sceneCache = {};

  function loadScene(item, bbox, size) {
    var key = item.id + '|' + bbox.map(function (v) { return v.toFixed(4); }).join(',') + '|' + size;
    if (sceneCache[key]) return Promise.resolve(sceneCache[key]);
    return readBands(item, bbox, size).then(function (bands) {
      var W = bands.width || bands.size, H = bands.height || bands.size;
      return readWater(item, bbox, size).then(function (w) {
        var water = 0;
        for (var k = 0; k < w.mask.length; k++) if (w.mask[k]) water++;
        var rec = {
          item: item, bands: bands, mask: w.mask, maskSource: w.maskSource,
          validFrac: w.validFrac,
          waterFrac: water / w.mask.length,
          res: bands.res, level: bands.level
        };
        sceneCache[key] = rec;
        return rec;
      });
    });
  }

  function readWater(item, bboxLonLat, size) {
    return Promise.all([
      readAt(item, 'green', bboxLonLat, size),
      readAt(item, 'nir', bboxLonLat, size)
    ]).then(function (arr) {
      var g = arr[0].data, n = arr[1].data, water = 0, valid = 0;
      var mask = new Uint8Array(g.length);
      for (var i = 0; i < g.length; i++) {
        if (!isFinite(g[i]) || !isFinite(n[i]) || (g[i] <= 0 && n[i] <= 0)) continue;
        valid++;
        if ((g[i] - n[i]) / (g[i] + n[i]) > 0.05) { water++; mask[i] = 1; }
      }
      var W = arr[0].w || Math.round(Math.sqrt(g.length));
      var H = arr[0].h || Math.round(g.length / W);
      return readScl(item, bboxLonLat, W, H).then(function (scl) {
        var outMask = mask, source = 'ndwi', validN = valid, waterN = water;
        if (scl && scl.length === mask.length) {
          var m2 = new Uint8Array(mask.length), found = 0;
          for (var k = 0; k < m2.length; k++) if (scl[k] === 6) { m2[k] = 1; found++; }
          if (found > mask.length * 0.005) { outMask = m2; source = 'scl'; waterN = found; validN = mask.length; }
        }
        return {
          frac: validN ? waterN / validN : null, mask: outMask, valid: validN, maskSource: source,
          validFrac: validN / g.length, level: arr[0].level, res: arr[0].res,
          w: W, h: H
        };
      });
    });
  }

  function readBands(item, bboxLonLat, size) {
    var keys = ['blue', 'green', 'red', 'nir'];
    return Promise.all(keys.map(function (k) { return readAt(item, k, bboxLonLat, size); }))
      .then(function (arr) {
        return {
          blue: arr[0].data, green: arr[1].data, red: arr[2].data, nir: arr[3].data,
          size: arr[0].w, width: arr[0].w, height: arr[0].h,
          bbox: bboxLonLat, res: arr[0].res, level: arr[0].level
        };
      });
  }

  /* ---------------------------------------------------------------- 选期次：按月分散后取水占比最低/最高 */
  function pickSpread(items, n) {
    var byMonth = {};
    items.forEach(function (it) {
      var m = it.properties.datetime.slice(0, 7);
      if (!byMonth[m] || it.properties['eo:cloud_cover'] < byMonth[m].properties['eo:cloud_cover']) byMonth[m] = it;
    });
    var months = Object.keys(byMonth).sort();
    if (months.length <= n) return months.map(function (m) { return byMonth[m]; });
    var step = (months.length - 1) / (n - 1);
    var out = [];
    for (var i = 0; i < n; i++) out.push(byMonth[months[Math.round(i * step)]]);
    return out;
  }

  function percentile(arr, p) {
    var vals = [];
    for (var i = 0; i < arr.length; i++) if (isFinite(arr[i]) && arr[i] > 0) vals.push(arr[i]);
    if (!vals.length) return [0, 1];
    vals.sort(function (a, b) { return a - b; });
    return [vals[Math.floor(vals.length * p)], vals[Math.min(vals.length - 1, Math.floor(vals.length * (1 - p)))]];
  }

  function deltaMask(lowMask, highMask) {
    var out = { exposed: 0, total: 0 };
    var n = Math.min(lowMask.length, highMask.length);
    for (var i = 0; i < n; i++) {
      if (highMask[i]) { out.total++; if (!lowMask[i]) out.exposed++; }
    }
    return out;
  }

  /* ---------------------------------------------------------------- 结构候选：蓝绿比（Stumpf）网格异常 */
  function findAnomalies(bands, waterMask, opts) {
    opts = opts || {};
    var W = bands.width || bands.size, H = bands.height || bands.size;
    var gridN = opts.gridN || 16;
    var cw = Math.max(1, Math.floor(W / gridN)), ch = Math.max(1, Math.floor(H / gridN));
    var sdb = new Float32Array(W * H);
    var all = [];
    for (var i = 0; i < bands.blue.length; i++) {
      var b = bands.blue[i], g = bands.green[i];
      if (!isFinite(b) || !isFinite(g) || b <= 0 || g <= 0) { sdb[i] = NaN; continue; }
      sdb[i] = Math.log(b) / Math.log(g);      // 清水前提下：值越大越浅
      if (!waterMask || waterMask[i]) all.push(sdb[i]);
    }
    var range = percentile(all, 0.05);
    var cells = [];
    for (var gy = 0; gy < gridN; gy++) {
      for (var gx = 0; gx < gridN; gx++) {
        var sum = 0, cnt = 0, wet = 0, tot = 0;
        for (var y = gy * ch; y < Math.min(H, (gy + 1) * ch); y++) {
          for (var x = gx * cw; x < Math.min(W, (gx + 1) * cw); x++) {
            var idx = y * W + x;
            tot++;
            if (waterMask && waterMask[idx]) wet++;
            var v = sdb[idx];
            if (isFinite(v)) { sum += v; cnt++; }
          }
        }
        cells.push({ gx: gx, gy: gy, sdb: cnt ? sum / cnt : NaN, wetFrac: tot ? wet / tot : 0 });
      }
    }
    var out = [];
    cells.forEach(function (c) {
      if (!isFinite(c.sdb) || c.wetFrac < 0.4) return;
      var ns = [];
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var nb = cells[(c.gy + dy) * gridN + (c.gx + dx)];
          if (nb && isFinite(nb.sdb)) ns.push(nb.sdb);
        }
      }
      if (ns.length < 3) return;
      var mean = ns.reduce(function (a, b) { return a + b; }, 0) / ns.length;
      var dev = c.sdb - mean;
      if (dev > 0.0022) out.push({ gx: c.gx, gy: c.gy, dev: dev });
    });
    out.sort(function (a, b) { return b.dev - a.dev; });
    return { cells: out.slice(0, 8), gridN: gridN, sdb: sdb, range: range, w: W, h: H, cw: cw, ch: ch };
  }

  function cellToLonLat(a, bbox, gridN) {
    var fx = (a.gx + 0.5) / gridN, fy = (a.gy + 0.5) / gridN;
    return {
      lon: bbox[0] + (bbox[2] - bbox[0]) * fx,
      lat: bbox[3] - (bbox[3] - bbox[1]) * fy
    };
  }

  /* ---------------------------------------------------------------- 主流程 */
  function analyse(lon, lat, opts) {
    opts = opts || {};
    var radiusKm = opts.radiusKm || 0.9;
    var bbox = lonLatBbox(lon, lat, radiusKm);
    var from = new Date(Date.now() - (opts.years || 3) * 365 * 86400000).toISOString();
    var progress = opts.onProgress || function () {};
    var size = opts.size || 768;

    progress('搜索 Sentinel-2 归档…');
    return search(bbox, { maxCloud: opts.maxCloud || 20, from: from, limit: 80 })
      .then(function (items) {
        if (!items.length) throw new Error('这附近 3 年内没有云量 <20% 的 Sentinel-2 影像');
        var sample = pickSpread(items, opts.samples || 6);
        progress('已找到 ' + items.length + ' 期，抽查 ' + sample.length + ' 期的水位…');
        var out = [], cursor = 0;
        function worker() {
          if (cursor >= sample.length) return Promise.resolve();
          var it = sample[cursor++];
          return readWater(it, bbox, 64).then(function (w) {
            out.push({ item: it, frac: w.frac });
            progress('抽查 ' + out.length + '/' + sample.length + '：' +
              it.properties.datetime.slice(0, 10) + ' 水体占比 ' +
              (w.frac == null ? 'n/a' : Math.round(w.frac * 100) + '%'));
          }).catch(function () { /* 单期失败跳过 */ }).then(worker);
        }
        var pool = [];
        for (var pi = 0; pi < Math.min(3, sample.length); pi++) pool.push(worker());
        return Promise.all(pool).then(function () {
          var valid = out.filter(function (o) { return o.frac != null; });
          if (!valid.length) throw new Error('影像都读不出来（网络或 COG 访问被拦）');
          valid.sort(function (a, b) { return a.frac - b.frac; });
          return { items: items.length, items_list: items, ranked: valid, low: valid[0], high: valid[valid.length - 1] };
        });
      })
      .then(function (r) {
        r.center = { lon: lon, lat: lat };
        r.lowItem = r.low.item;
        r.highItem = r.high.item;
        r.size = size;
        // 期次清单：最多 40 期，新的在前；known 里是已抽查过水体占比的
        var known = {};
        r.ranked.forEach(function (x) { known[x.item.id] = x.frac; });
        r.available = r.items_list.slice(0, 40).map(function (it) {
          return {
            item: it,
            id: it.id,
            date: it.properties.datetime.slice(0, 10),
            cloud: it.properties['eo:cloud_cover'],
            frac: known[it.id] != null ? known[it.id] : null
          };
        });
        return finish(r, bbox, size, radiusKm, progress);
      });
  }

  /* 给定「主影像 + 对比影像 + 窗口」，算出影像、水体掩膜、两期水位差与结构候选 */
  function finish(meta, bbox, size, radiusKm, progress) {
    progress = progress || function () {};
    var lowItem = meta.lowItem, highItem = meta.highItem;
    progress('读取主影像 ' + lowItem.properties.datetime.slice(0, 10) + '…');
    return loadScene(lowItem, bbox, size).then(function (low) {
      progress('读取对比影像 ' + highItem.properties.datetime.slice(0, 10) + '…');
      return loadScene(highItem, bbox, size).then(function (high) {
        var anom = findAnomalies(low.bands, low.mask, { gridN: 16 });
        var d = deltaMask(low.mask, high.mask);
        var points = anom.cells.map(function (c) {
          var ll = cellToLonLat(c, bbox, anom.gridN);
          return {
            lat: ll.lat, lon: ll.lon, kind: 'shallow', strength: c.dev,
            text: '水下浅脊/硬底（' + lowItem.properties.datetime.slice(0, 10) + ' 蓝绿比异常）'
          };
        });
        function brief(it, frac) {
          return {
            id: it.id,
            date: it.properties.datetime.slice(0, 10),
            cloud: it.properties['eo:cloud_cover'],
            frac: frac
          };
        }
        return {
          scenes: meta.scenes != null ? meta.scenes : meta.items,
          bbox: bbox, gridN: anom.gridN, radiusKm: radiusKm,
          center: meta.center, lowItem: lowItem, highItem: highItem, size: size,
          bands: low.bands, waterMask: low.mask,
          resolution: low.res, level: low.level,
          pixels: (low.bands.width || low.bands.size) + '×' + (low.bands.height || low.bands.size),
          low: brief(lowItem, low.waterFrac),
          high: brief(highItem, high.waterFrac),
          available: meta.available || [],
          ranked: (meta.ranked || []).map(function (x) {
            if (x.item) {
              return {
                id: x.item.id, date: x.item.properties.datetime.slice(0, 10),
                frac: x.frac, cloud: x.item.properties['eo:cloud_cover']
              };
            }
            return { id: x.id, date: x.date, frac: x.frac, cloud: x.cloud };
          }),
          exposedFrac: d.total ? d.exposed / d.total : null,
          anomalies: points,
          sdbRange: anom.range,
          lowValidFrac: low.validFrac, highValidFrac: high.validFrac,
          maskSource: low.maskSource
        };
      });
    });
  }

  /* 用户自选期次：role = 'low'（主影像）或 'high'（对比影像） */
  function setScene(res, role, id) {
    if (!res || !res.available) return Promise.reject(new Error('没有可选的期次'));
    var pick = null;
    for (var i = 0; i < res.available.length; i++) if (res.available[i].id === id) { pick = res.available[i]; break; }
    if (!pick) return Promise.reject(new Error('这一期不在这批搜索结果里'));
    var meta = {
      scenes: res.scenes, bbox: res.bbox, size: res.size, radiusKm: res.radiusKm,
      center: res.center, ranked: res.ranked, available: res.available,
      lowItem: role === 'low' ? pick.item : res.lowItem,
      highItem: role === 'high' ? pick.item : res.highItem
    };
    // 记录被替换掉的那一期（可用回去）
    if (!meta.lowItem || !meta.highItem) return Promise.reject(new Error('期次不完整'));
    return finish(meta, res.bbox, res.size, res.radiusKm, function () {});
  }

  /* ---------------------------------------------------------------- 卫星水面兜底
     OSM Overpass 是单点公共服务、经常 502/500：这时用一张 Sentinel-2 水面掩膜直接提岸线点，
     钓点功能就不至于整块失效。精度差一些（10 m/px + 云影响），但能给出可用的岸段与岸坡。 */
  function waterCandidates(lon, lat, radiusKm, opts) {
    opts = opts || {};
    var bbox = lonLatBbox(lon, lat, radiusKm || 2.0);
    var from = new Date(Date.now() - (opts.days || 400) * 86400000).toISOString();
    return search(bbox, { maxCloud: opts.maxCloud || 30, from: from, limit: 40 }).then(function (items) {
      if (!items.length) throw new Error('这一带没有低云量影像，无法用卫星兜底');
      items.sort(function (a, b) { return a.properties['eo:cloud_cover'] - b.properties['eo:cloud_cover']; });
      var item = items[0];
      var px = opts.px || 512;
      return Promise.all([readAt(item, 'green', bbox, px), readAt(item, 'nir', bbox, px)]).then(function (arr) {
        var W = arr[0].w, H = arr[0].h, g = arr[0].data, n = arr[1].data;
        var mask = new Uint8Array(W * H);
        var water = 0;
        for (var i = 0; i < g.length; i++) {
          if (!isFinite(g[i]) || !isFinite(n[i]) || (g[i] <= 0 && n[i] <= 0)) continue;
          if ((g[i] - n[i]) / (g[i] + n[i]) > 0.05) { mask[i] = 1; water++; }
        }
        if (water < W * H * 0.02) throw new Error('影像里几乎没有水面（云/雾或水太浑）');

        // 边界像素：水像素且四邻里有陆地
        var edge = [];
        for (var y = 0; y < H; y++) {
          for (var x = 0; x < W; x++) {
            if (!mask[y * W + x]) continue;
            var isEdge = (x > 0 && !mask[y * W + x - 1]) || (x < W - 1 && !mask[y * W + x + 1]) ||
              (y > 0 && !mask[(y - 1) * W + x]) || (y < H - 1 && !mask[(y + 1) * W + x]);
            if (isEdge) edge.push([x, y]);
          }
        }
        if (!edge.length) throw new Error('水面掩膜没有岸线');

        function toLL(x, y) {
          return {
            lon: bbox[0] + (x + 0.5) / W * (bbox[2] - bbox[0]),
            lat: bbox[3] - (y + 0.5) / H * (bbox[3] - bbox[1])
          };
        }
        // 每个点向哪边是水：看 5×5 邻域里水像素的平均方向
        function waterBearing(x, y) {
          var sx = 0, sy = 0;
          for (var dy = -2; dy <= 2; dy++) {
            for (var dx = -2; dx <= 2; dx++) {
              var xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              if (!mask[yy * W + xx]) continue;
              if (!dx && !dy) continue;
              sx += dx; sy += dy;
            }
          }
          if (!sx && !sy) return null;
          var brg = Math.atan2(sx, -sy) * 180 / Math.PI;   // 屏幕坐标 → 方位角
          return (brg + 360) % 360;
        }

        // 先近后远、彼此至少 200 m：避免 24 个点挤在一段小岸线上
        var meLL = { lat: lat, lon: lon };
        var scored = edge.map(function (e) {
          var ll = toLL(e[0], e[1]);
          ll.dist = haversine(meLL, ll);
          ll.xy = e;
          return ll;
        }).sort(function (a, b) { return a.dist - b.dist; });

        var kept = [];
        for (var k = 0; k < scored.length && kept.length < (opts.maxPoints || 24); k++) {
          var c = scored[k];
          var wb = waterBearing(c.xy[0], c.xy[1]);
          if (wb == null) continue;
          var ok = true;
          for (var m = 0; m < kept.length; m++) if (haversine(kept[m], c) < 200) { ok = false; break; }
          if (!ok) continue;
          kept.push({ lat: c.lat, lon: c.lon, waterBearing: wb, landBearing: (wb + 180) % 360, dist: c.dist });
        }
        return {
          item: { date: item.properties.datetime.slice(0, 10), cloud: item.properties['eo:cloud_cover'] },
          bbox: bbox, width: W, height: H, resolution: arr[0].res,
          waterFrac: water / (W * H), points: kept, mask: mask
        };
      });
    });
  }

  /* ---------------------------------------------------------------- 渲染 */
  function colorRamp(t) {
    t = Math.max(0, Math.min(1, t));
    return [Math.round(90 + (10 - 90) * t), Math.round(230 + (40 - 230) * t), Math.round(200 + (120 - 200) * t)];
  }

  /* 局部对比度增强：把整幅切成 8×8 块，各块独立做 2%–98% 拉伸，块间双线性插值。
     卫星底图偏灰是"看着不清晰"的主要原因之一，这一步骤比放大更有效。 */
  function enhance(rgb, W, H) {
    var T = 8, cw = Math.max(1, Math.floor(W / T)), ch = Math.max(1, Math.floor(H / T));
    var lo = new Float32Array(T * T), hi = new Float32Array(T * T);
    for (var ty = 0; ty < T; ty++) {
      for (var tx = 0; tx < T; tx++) {
        var vals = [];
        for (var y = ty * ch; y < Math.min(H, (ty + 1) * ch); y++) {
          for (var x = tx * cw; x < Math.min(W, (tx + 1) * cw); x++) {
            var p = (y * W + x) * 3;
            vals.push(rgb[p] * 0.299 + rgb[p + 1] * 0.587 + rgb[p + 2] * 0.114);
          }
        }
        vals.sort(function (a, b) { return a - b; });
        lo[ty * T + tx] = vals[Math.floor(vals.length * 0.02)] || 0;
        hi[ty * T + tx] = vals[Math.max(0, Math.floor(vals.length * 0.98))] || 255;
      }
    }
    function at(grid, fx, fy) {
      var x = Math.max(0, Math.min(T - 1, fx)), y = Math.max(0, Math.min(T - 1, fy));
      return grid[y * T + x];
    }
    for (var yy = 0; yy < H; yy++) {
      for (var xx = 0; xx < W; xx++) {
        var gx = xx / cw - 0.5, gy = yy / ch - 0.5;
        var x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
        var l = (at(lo, x0, y0) * (1 - fx) + at(lo, x0 + 1, y0) * fx) * (1 - fy) +
                (at(lo, x0, y0 + 1) * (1 - fx) + at(lo, x0 + 1, y0 + 1) * fx) * fy;
        var hh = (at(hi, x0, y0) * (1 - fx) + at(hi, x0 + 1, y0) * fx) * (1 - fy) +
                 (at(hi, x0, y0 + 1) * (1 - fx) + at(hi, x0 + 1, y0 + 1) * fx) * fy;
        var span = Math.max(12, hh - l);
        var p2 = (yy * W + xx) * 3;
        for (var k = 0; k < 3; k++) {
          var v = (rgb[p2 + k] - l) / span;
          rgb[p2 + k] = 255 * Math.pow(Math.max(0, Math.min(1, v)), 0.85);
        }
      }
    }
    // 轻度锐化（3×3 拉普拉斯），让岸线、堤坝、路基的边界更清楚
    var out = new Float32Array(rgb.length);
    for (var y2 = 0; y2 < H; y2++) {
      for (var x2 = 0; x2 < W; x2++) {
        for (var c = 0; c < 3; c++) {
          var i2 = (y2 * W + x2) * 3 + c;
          var center = rgb[i2];
          var up = y2 > 0 ? rgb[i2 - W * 3] : center;
          var dn = y2 < H - 1 ? rgb[i2 + W * 3] : center;
          var lf = x2 > 0 ? rgb[i2 - 3] : center;
          var rt = x2 < W - 1 ? rgb[i2 + 3] : center;
          out[i2] = Math.max(0, Math.min(255, center + 0.45 * (4 * center - up - dn - lf - rt)));
        }
      }
    }
    return out;
  }

  function render(canvas, res, mode) {
    if (!canvas || !res || !res.bands) return;
    var B = res.bands;
    var W = B.width || B.size, H = B.height || B.size;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(W, H);
    var d = img.data;

    if (mode === 'rgb') {
      var rgb = new Float32Array(W * H * 3);
      for (var q = 0; q < W * H; q++) {
        rgb[q * 3] = B.red[q] || 0;
        rgb[q * 3 + 1] = B.green[q] || 0;
        rgb[q * 3 + 2] = B.blue[q] || 0;
      }
      var enh = enhance(rgb, W, H);
      for (var p = 0; p < W * H; p++) {
        d[p * 4] = enh[p * 3];
        d[p * 4 + 1] = enh[p * 3 + 1];
        d[p * 4 + 2] = enh[p * 3 + 2];
        d[p * 4 + 3] = 255;
      }
    } else {
      var lo = res.sdbRange ? res.sdbRange[0] : 0.9;
      var hi = res.sdbRange ? res.sdbRange[1] : 1.4;
      for (var i = 0; i < W * H; i++) {
        var blue = B.blue[i], green = B.green[i];
        var isWater = res.waterMask && res.waterMask[i];
        var r, g, b;
        if (!isFinite(blue) || !isFinite(green) || blue <= 0 || green <= 0) { r = 14; g = 18; b = 26; }
        else if (!isWater) { r = 46; g = 52; b = 66; }
        else {
          var c = colorRamp(1 - (Math.log(blue) / Math.log(green) - lo) / Math.max(1e-6, hi - lo));
          r = c[0]; g = c[1]; b = c[2];
        }
        d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // 原生像素很少（比如 0.45 km 窗口只有 90 px）时用像素化放大，
    // 至少边界是清楚的，比插值成一团糊要好
    canvas.style.imageRendering = W < 150 ? 'pixelated' : 'auto';

    if (mode === 'sdb' && res.anomalies && res.anomalies.length) {
      var sw = W / res.gridN, sh = H / res.gridN;
      ctx.strokeStyle = 'rgba(255, 228, 120, .95)';
      ctx.fillStyle = 'rgba(255, 228, 120, .95)';
      ctx.lineWidth = Math.max(1, W / 220);
      ctx.font = Math.max(11, W / 34) + 'px monospace';
      res.anomalies.forEach(function (a, k) {
        if (a.gx == null) return;
        ctx.strokeRect(a.gx * sw, a.gy * sh, sw, sh);
        ctx.fillText(String(k + 1), a.gx * sw + 3, a.gy * sh + Math.max(12, W / 34));
      });
    }
  }

  /* 缩放重读：只换窗口，不重新检索（已缓存的 COG 与金字塔层级可复用） */
  function reread(res, radiusKm) {
    if (!res || !res.lowItem || !res.center) return Promise.reject(new Error('没有可复用的影像'));
    var bbox = lonLatBbox(res.center.lon, res.center.lat, radiusKm);
    return finish(res, bbox, res.size, radiusKm);
  }

export const Sat = {
  analyse: analyse, reread: reread, setScene: setScene, render: render, search: search,
  waterCandidates: waterCandidates,
  lonLatToUtm: lonLatToUtm, lonLatBbox: lonLatBbox, readAt: readAt, readWater: readWater
}

export default Sat