// @ts-nocheck
/* LureCast · 卫星水面 / 水下结构（P4）—— 由 assets/sat.js 机械迁移
   ---------------------------------------------------------------------------
   跨 3 年抽查 3 期 Sentinel-2 L2A（AWS 开放数据 STAC），挑库水位最低的一期当主影像；
   只下载你周围 1–2 km 那一小块 COG 切片（GeoTIFF.fromUrl 必须带 allowFullFile:false，
   否则可能整幅 190 MB 全下）。蓝绿比推水深、SCL 去云、异常点用于「水下有结构」提示。
   geotiff.js（310 KB）不打包进 app chunk：第一次分析影像时才用 ?url 拉进来（见 lib/geotiff-loader）。
   与老壳唯一差别：window.GeoTIFF 改成注入的 GeoTIFF 对象，window.Sat 改成具名导出。 */
import { GeoTIFF } from './geotiff-loader'

/* 老壳这几个常量在 IIFE 顶部，机械迁移时漏了会报 D2R is not defined —— 补回来 */
var STAC = 'https://earth-search.aws.element84.com/v1/search'
var metaCache: any = {}     // href|blockSize -> Promise<{tiff, levels}>
var D2R = Math.PI / 180

/* ---------------------------------------------------------------- 慢网策略（P4j）
   实测（本机 → us-west-2 的 S3）：首字节 3.4–4 s，吞吐 60–100 KB/s ——
   也就是说一次 range 请求的代价几乎全是「延迟」，不是「流量」。所以三条对策：
     1) 少开文件：颜色改用 TCI（visual，红绿蓝在同一个文件里），水体改用 SCL，
        一期影像 2 个文件搞定；老壳是 blue/green/red/nir/scl 各开一遍（5 个）。
     2) 少发请求：blockSize 调大，geotiff 的 BlockedSource 会把这么大一块一次拉下来并缓存
        （实测 512 KB 一发 8.4 s，8 发 64 KB 串行 28 s）。
     3) 并行发：file 之间、block 之间都用 Promise.all（实测 3 个并行 4.0 s vs 串行 13.1 s）。 */
var BLOCK = 131072          // 一次 range 请求的字节数
var CACHE = 96              // 每个 COG 最多缓存多少个块（96×128 KB ≈ 12 MB）
var DBG = false             // 临时诊断开关：控制台打印选层/窗口信息（定位窗口算错时用）
function openOpts(block?: number) {
  return { allowFullFile: false, blockSize: block || BLOCK, cacheSize: CACHE }
}

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

  /* ---------------------------------------------------------------- COG 打开 + 金字塔层级
     block = 一次 range 请求拉多少字节。慢网下这是「请求数」的唯一旋钮：
     探测期只要最粗一层，用小一点的块；正式读影像用大块，尽量少发几次。 */
  /* 地理参考：以 STAC 的 proj:transform / proj:shape 为准。
     TCI.tif（visual）这类文件里常常根本没有 GeoKey，直接读出来是 origin=[0,0]、res=[1,-1]，
     拿它算窗口会整块落在影像外 —— 外在表现就是「采样 1×1」。
     所以顺序是：本波段的 transform → 同景任一兄弟波段的 transform（S2 各波段共用一个左上角）
     → 文件里的 GeoKey → 都不行就按像素读并在控制台告警。
     transform = [a,0,c,0,e,f]：a/e 是像素大小，c/f 是左上角坐标。 */
  function georefOf(item, key, im0) {
    var assets = item.assets || {};
    var a = assets[key] || {};
    var w1 = im0.getWidth(), h1 = im0.getHeight();
    if (a['proj:transform'] && a['proj:shape']) {
      var t = a['proj:transform'], s = a['proj:shape'];
      return { source: 'asset', origin: [t[2], t[5]], res0: [t[0], t[4]], w0: s[1], h0: s[0] };
    }
    for (var k in assets) {
      var b = assets[k] || {};
      if (k === key || !b['proj:transform'] || !b['proj:shape']) continue;
      var tb = b['proj:transform'], sb = b['proj:shape'];
      // 同景各波段的左上角同一个点，用兄弟波段的像素大小 × 宽度比反推本层分辨率
      return {
        source: 'sibling', origin: [tb[2], tb[5]],
        res0: [Math.abs(tb[0]) * sb[1] / w1, -Math.abs(tb[4]) * sb[0] / h1],
        w0: w1, h0: h1
      };
    }
    var o = im0.getOrigin(), r = im0.getResolution();
    var bad = (!o || (o[0] === 0 && o[1] === 0)) || !r || Math.abs(r[0]) < 1e-6;
    return { source: bad ? 'none' : 'geokey', origin: o, res0: r, w0: w1, h0: h1 };
  }

  function bandMeta(item, key, block) {
    var asset = item.assets[key] || {};
    var href = asset.href;
    var ck = href + '|' + (block || BLOCK);
    if (!metaCache[ck]) {
      metaCache[ck] = GeoTIFF.fromUrl(href, openOpts(block)).then(function (tiff) {
        return tiff.getImage(0).then(function (im0) {
          var g = georefOf(item, key, im0);
          var origin = g.origin, res0 = g.res0, w0 = g.w0, h0 = g.h0;
          if (g.source === 'none') console.warn('[sat] 没有地理参考，只能按像素读：' + key);
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
              // 按「地面分辨率从细到粗」排序：后面的选层逻辑依赖这个顺序
              levels.sort(function (a, b) { return a.res - b.res; });
              return { tiff: tiff, origin: origin, res0: res0, levels: levels, w0: w0, h0: h0, georefSrc: g.source };
            });
          });
        });
      });
    }
    return metaCache[ck];
  }

  /* bbox（已转 UTM）→ 选层 + 像素窗口
     永远挑「能装进 outPx 的最精细那一层」：既不掉精度，也不白拉全分辨率瓦片；
     输出尺寸＝窗口原生像素数，不做二次重采样（重采样会让影像明显发糊）。 */
  function levelWindow(meta, box, outPx) {
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
    if (DBG) console.info('[sat] win box=' + box.map(function (v) { return Math.round(v); }).join(',') +
      ' origin=' + meta.origin.map(function (v) { return Math.round(v); }).join(',') +
      ' res=' + res.toFixed(2) + ' lvl=' + lvl.i + ' w=' + (x1 - x0) + ' h=' + (y1 - y0));
    return { lvl: lvl, res: res, window: [x0, y0, x1, y1], w: x1 - x0, h: y1 - y0 };
  }

  /* 读一个文件的窗口；resampleTo=[W,H] 时把结果重采样到指定网格（SCL 20 m → 颜色 10 m 就是这用法） */
  function readWindow(item, key, box, outPx, block, resampleTo) {
    return bandMeta(item, key, block).then(function (meta) {
      if (DBG) console.info('[sat] read ' + key + ' epsg=' + item.properties['proj:epsg'] +
        ' georef=' + meta.georefSrc + ' id=' + String(item.id).slice(0, 24));
      var L = levelWindow(meta, box, outPx);
      return meta.tiff.getImage(L.lvl.i).then(function (im) {
        var o = { window: L.window, resampleMethod: 'nearest', interleave: false };
        o.width = resampleTo ? resampleTo[0] : L.w;
        o.height = resampleTo ? resampleTo[1] : L.h;
        return im.readRasters(o).then(function (r) {
          return { bands: r, level: L.lvl.i, res: L.res, w: L.w, h: L.h };
        });
      });
    });
  }

  /* 单波段读一块（保留旧签名：Sat.readAt 与自检脚本还在用） */
  function readAt(item, key, bboxLonLat, outPx, block) {
    var box = utmBox(bboxLonLat, item.properties['proj:epsg']);
    return readWindow(item, key, box, outPx, block).then(function (r) {
      return { data: r.bands[0], level: r.level, res: r.res, w: r.w, h: r.h };
    });
  }

  /* 颜色：优先 TCI（visual）—— 红绿蓝 3 个波段在同一个文件里，只开一次 COG、发一轮请求；
     没有 visual 才退回 blue/green/red 三个文件。TCI 是 8 bit，分析里用的一直是比值，不影响结论。 */
  function readColor(item, bboxLonLat, outPx) {
    var box = utmBox(bboxLonLat, item.properties['proj:epsg']);
    if (item.assets && item.assets.visual) {
      return readWindow(item, 'visual', box, outPx).then(function (r) {
        var b = r.bands;
        return {
          red: b[0], green: b[1], blue: b[2],
          size: r.w, width: r.w, height: r.h, bbox: bboxLonLat,
          res: r.res, level: r.level, source: 'visual'
        };
      }).catch(function () { return readColorThree(item, box, outPx, bboxLonLat); });
    }
    return readColorThree(item, box, outPx, bboxLonLat);
  }

  function readColorThree(item, box, outPx, bboxLonLat) {
    return Promise.all(['blue', 'green', 'red'].map(function (k) { return readWindow(item, k, box, outPx); }))
      .then(function (r) {
        return {
          blue: r[0].bands[0], green: r[1].bands[0], red: r[2].bands[0],
          size: r[0].w, width: r[0].w, height: r[0].h, bbox: bboxLonLat,
          res: r[0].res, level: r[0].level, source: 'bands'
        };
      });
  }

  /* 水体掩膜：SCL（20 m 场景分类，class 6 = 水面）只要 1 个文件，优先；
     没有 SCL、或 SCL 说「一滴水都没有」而 NDWI 明明看到水，就退回 NDWI（green + nir 两个文件）。 */
  function readWater(item, bboxLonLat, outPx, resampleTo) {
    var box = utmBox(bboxLonLat, item.properties['proj:epsg']);
    function ndwiWater() {
      return Promise.all([
        readWindow(item, 'green', box, outPx), readWindow(item, 'nir', box, outPx)
      ]).then(function (r) {
        var g = r[0].bands[0], n = r[1].bands[0];
        var mask = new Uint8Array(g.length), water = 0, valid = 0;
        for (var i = 0; i < g.length; i++) {
          if (!isFinite(g[i]) || !isFinite(n[i]) || (g[i] <= 0 && n[i] <= 0)) continue;
          valid++;
          if ((g[i] - n[i]) / (g[i] + n[i]) > 0.05) { water++; mask[i] = 1; }
        }
        return {
          frac: valid ? water / valid : null, mask: mask, valid: valid, maskSource: 'ndwi',
          validFrac: g.length ? valid / g.length : 0,
          level: r[0].level, res: r[0].res,
          w: resampleTo ? resampleTo[0] : r[0].w, h: resampleTo ? resampleTo[1] : r[0].h
        };
      });
    }
    if (!item.assets || !item.assets.scl) return ndwiWater();
    return readWindow(item, 'scl', box, outPx, BLOCK, resampleTo).then(function (r) {
      var scl = r.bands[0], mask = new Uint8Array(scl.length), water = 0, valid = 0;
      for (var i = 0; i < scl.length; i++) {
        var v = scl[i];
        if (!isFinite(v) || v <= 0) continue;
        valid++;
        if (v === 6) { mask[i] = 1; water++; }
      }
      if (!valid) throw new Error('SCL 全空');
      var frac = water / valid;
      if (frac < 0.005) {
        // 分类结果说没水：可能是薄云/阴影把水面分错了，用 NDWI 复核一次再决定
        return ndwiWater().then(function (alt) {
          return (alt.frac != null && alt.frac > frac) ? alt : {
            frac: frac, mask: mask, valid: valid, maskSource: 'scl',
            validFrac: scl.length ? valid / scl.length : 0,
            level: r.level, res: r.res,
            w: resampleTo ? resampleTo[0] : r.w, h: resampleTo ? resampleTo[1] : r.h
          };
        });
      }
      return {
        frac: frac, mask: mask, valid: valid, maskSource: 'scl',
        validFrac: scl.length ? valid / scl.length : 0,
        level: r.level, res: r.res,
        w: resampleTo ? resampleTo[0] : r.w, h: resampleTo ? resampleTo[1] : r.h
      };
    }).catch(function () { return ndwiWater(); });
  }

  /* 场景读取缓存：同一期影像（同窗口同尺寸）只读一次，用户来回切期次才够快 */
  var sceneCache = {};

  function loadScene(item, bbox, size) {
    var key = item.id + '|' + bbox.map(function (v) { return v.toFixed(4); }).join(',') + '|' + size;
    if (sceneCache[key]) return Promise.resolve(sceneCache[key]);
    var hasVisual = !!(item.assets && item.assets.visual);
    var box = utmBox(bbox, item.properties['proj:epsg']);
    /* 先只读元数据拿到输出网格，然后把「颜色」和「水体」两组请求同时发出去 ——
       慢网下单发和并发的差别是「多等 6 秒」还是「不多等」。 */
    var dimP = hasVisual
      ? bandMeta(item, 'visual').then(function (meta) {
          var L = levelWindow(meta, box, size);
          return { w: Math.min(size, L.w), h: Math.min(size, L.h) };
        })
      : Promise.resolve({ w: size, h: size });
    return dimP.then(function (dim) {
      return Promise.all([
        readColor(item, bbox, size),
        readWater(item, bbox, size, [dim.w, dim.h])
      ]).then(function (arr) {
        var bands = arr[0], w = arr[1];
        var W = bands.width || bands.size, H = bands.height || bands.size;
        // 网格对不上（没 visual 时先猜的尺寸）就按真实尺寸重读一次掩膜，保证与颜色逐像素对齐
        if (w.mask.length !== W * H) {
          return readWater(item, bbox, size, [W, H]).then(function (w2) { return { bands: bands, w: w2 }; });
        }
        return { bands: bands, w: w };
      }).then(function (o) {
        var bands = o.bands, w = o.w;
        var water = 0;
        for (var k = 0; k < w.mask.length; k++) if (w.mask[k]) water++;
        var rec = {
          item: item, bands: bands, mask: w.mask, maskSource: w.maskSource,
          validFrac: w.validFrac,
          waterFrac: w.mask.length ? water / w.mask.length : null,
          res: bands.res, level: bands.level
        };
        sceneCache[key] = rec;
        return rec;
      });
    });
  }

  /* 只读水体掩膜（对比期用）：1 个文件（SCL），重采样到主影像的网格，保证逐像素可比 */
  var maskCache = {};
  function loadMask(item, bbox, size, W, H) {
    var key = 'mask|' + item.id + '|' + bbox.map(function (v) { return v.toFixed(4); }).join(',') + '|' + size + '|' + W + 'x' + H;
    if (maskCache[key]) return Promise.resolve(maskCache[key]);
    return readWater(item, bbox, size, [W, H]).then(function (w) {
      var water = 0;
      for (var i = 0; i < w.mask.length; i++) if (w.mask[i]) water++;
      var rec = {
        item: item, mask: w.mask, maskSource: w.maskSource, validFrac: w.validFrac,
        waterFrac: w.mask.length ? water / w.mask.length : null,
        res: w.res, level: w.level, maskOnly: true
      };
      maskCache[key] = rec;
      return rec;
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
    /* 阈值改成「按本幅数据的离散程度自适应」：
       旧值 0.0022 是在 16 bit 反射率（0–10000）上试出来的；现在颜色波段可能来自 TCI（8 bit 0–255），
       同一个绝对值会差一个量级。用格子 sdb 的标准差当阈值，换数据源也不用重调。 */
    var out = [];
    var sd = 0, sdc = 0;
    cells.forEach(function (c) { if (isFinite(c.sdb) && c.wetFrac >= 0.4) { sd += c.sdb; sdc++; } });
    sd = sdc ? sd / sdc : 0;
    var varSum = 0;
    cells.forEach(function (c) { if (isFinite(c.sdb) && c.wetFrac >= 0.4) { var d0 = c.sdb - sd; varSum += d0 * d0; } });
    var thr = sdc > 1 ? Math.max(1e-6, Math.sqrt(varSum / sdc)) : 0.0022;
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
      if (dev > thr) out.push({ gx: c.gx, gy: c.gy, dev: dev });
    });
    out.sort(function (a, b) { return b.dev - a.dev; });
    return { cells: out.slice(0, 8), gridN: gridN, sdb: sdb, range: range, w: W, h: H, cw: cw, ch: ch, thr: thr };
  }

  function cellToLonLat(a, bbox, gridN) {
    var fx = (a.gx + 0.5) / gridN, fy = (a.gy + 0.5) / gridN;
    return {
      lon: bbox[0] + (bbox[2] - bbox[0]) * fx,
      lat: bbox[3] - (bbox[3] - bbox[1]) * fy
    };
  }

  /* ---------------------------------------------------------------- 主流程 */
  /* 整条链路的硬超时：慢网下 geotiff 的 range 请求可能长时间不返回，
     与其让卡片一直转，不如到点报错并告诉用户已经走到哪一步（进度是实时回传的）。 */
  var TIMEOUT_MS = 90000;
  function withTimeout(p, ms, onTimeout) {
    var timer = null;
    var guard = new Promise(function (_res, rej) {
      timer = setTimeout(function () { rej(onTimeout()); }, ms);
    });
    return Promise.race([p, guard]).then(function (v) {
      clearTimeout(timer); return v;
    }, function (e) {
      clearTimeout(timer); throw e;
    });
  }

  function analyse(lon, lat, opts) {
    opts = opts || {};
    var radiusKm = opts.radiusKm || 0.9;
    var bbox = lonLatBbox(lon, lat, radiusKm);
    var from = new Date(Date.now() - (opts.years || 3) * 365 * 86400000).toISOString();
    var progress = opts.onProgress || function () {};
    var size = opts.size || 768;
    var t0 = Date.now();
    var step = function (msg) { progress(msg + '（' + Math.round((Date.now() - t0) / 1000) + 's）'); };

    step('搜索 Sentinel-2 归档');
    var chain = search(bbox, { maxCloud: opts.maxCloud || 20, from: from, limit: 80 })
      .then(function (items) {
        if (!items.length) throw new Error('这附近 3 年内没有云量 <20% 的 Sentinel-2 影像');
        /* 抽查 3 期就够了（原来是 6 期）：每一期都要单独开 COG，慢网下多一期就多 5–8 秒 */
        var sample = pickSpread(items, opts.samples || 3);
        step('已找到 ' + items.length + ' 期，抽查 ' + sample.length + ' 期的库水位');
        var out = [], cursor = 0;
        function worker() {
          if (cursor >= sample.length) return Promise.resolve();
          var it = sample[cursor++];
          // 只看 SCL（1 个文件、最粗的金字塔层），不再为每期开 green+nir 两个文件
          return readWater(it, bbox, 64).then(function (w) {
            out.push({ item: it, frac: w.frac });
            progress('抽查 ' + out.length + '/' + sample.length + '：' +
              it.properties.datetime.slice(0, 10) + ' 水体占比 ' +
              (w.frac == null ? 'n/a' : Math.round(w.frac * 100) + '%') +
              '（' + Math.round((Date.now() - t0) / 1000) + 's）');
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
        return finish(r, bbox, size, radiusKm, step);
      });
    var ms = opts.timeoutMs || TIMEOUT_MS;
    return withTimeout(chain, ms, function () {
      return new Error('影像下载超时（' + Math.round(ms / 1000) + ' 秒）。慢网下只读你周围这一小块也需要 10–30 秒，' +
        '可以缩小半径或稍后重试；已下载的块会留在缓存里。');
    });
  }

  /* 给定「主影像 + 对比影像 + 窗口」，算出影像、水体掩膜、两期水位差与结构候选 */
  function finish(meta, bbox, size, radiusKm, progress) {
    progress = progress || function () {};
    var lowItem = meta.lowItem, highItem = meta.highItem;
    progress('读取主影像 ' + lowItem.properties.datetime.slice(0, 10) + '…');
    return loadScene(lowItem, bbox, size).then(function (low) {
      progress('读取对比影像 ' + highItem.properties.datetime.slice(0, 10) + '…');
      /* 对比期只需要水体掩膜（算两期水位差与「露出来的那片」），
         不必再下一整套彩色波段 —— 慢网下这一步能省掉一半时间。 */
      var W = low.bands.width || low.bands.size, H = low.bands.height || low.bands.size;
      return loadMask(highItem, bbox, size, W, H).then(function (high) {
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
      // 水体掩膜：有 SCL 就只开 1 个文件（20 m，class 6 直接就是水面），没有才 NDWI
      return readWater(item, bbox, px).then(function (wtr) {
        var W = wtr.w, H = wtr.h, mask = wtr.mask;
        var water = 0;
        for (var mi = 0; mi < mask.length; mi++) if (mask[mi]) water++;
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
          bbox: bbox, width: W, height: H, resolution: wtr.res,
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