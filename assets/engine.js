/* LureCast · 推荐引擎（纯函数，无 DOM）
   ─ 环境分：气温/水温 · 气压与趋势 · 风 · 时段 · 云与降水 · 水位/潮流
   ─ 点位结构：岸坡（DEM 推断）· 岸型（岬角/湾/直岸）· 迎风岸 · 近岸水深估值
   ─ 组合成钓点分并给出中文理由 + 拟饵建议
   所有规则都是可解释的启发式，权重集中写在下方的 WEIGHTS / SPECIES 里。 */
(function () {
  'use strict';

  var R = 6371000;
  function rad(d) { return d * Math.PI / 180; }
  function deg(r) { return r * 180 / Math.PI; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function round(v, n) { var p = Math.pow(10, n || 0); return Math.round(v * p) / p; }

  function dist(a, b) {
    var dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function bearing(a, b) {
    var y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    var x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
      Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  function dest(p, brg, m) {
    var d = m / R, b = rad(brg), la = rad(p.lat), lo = rad(p.lon);
    var la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    var lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return { lat: deg(la2), lon: ((deg(lo2) + 540) % 360) - 180 };
  }
  function angDiff(a, b) { return Math.abs(((a - b) + 540) % 360 - 180); }
  function compass(deg0) {
    var names = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    return names[Math.round(((deg0 % 360) + 360) % 360 / 45) % 8];
  }
  function fmtDist(m) { return m >= 1000 ? round(m / 1000, 1) + ' km' : Math.round(m) + ' m'; }

  /* ============================================================ 目标鱼种 */
  /* slope: steep 陡岸贴底 · flat 缓坡浅滩 · moderate 中等 · any 都行
     form: 岬角 point / 湾 bay / 直岸 straight 的偏好系数
     wind: 迎风 windward / 背风 leeward 的偏好系数
     temp: 活跃水温区间（℃） */
  var SPECIES = {
    general: {
      label: '通用', temp: [15, 26], slope: 'moderate',
      form: { point: 1, bay: 0.95, straight: 0.8 }, wind: { windward: 1, leeward: 0.95 },
      lures: ['悬浮米诺 90mm', '5g 铅头 + 卷尾软虫', '亮片 15g']
    },
    bass: {
      label: '鲈鱼', temp: [16, 27], slope: 'steep',
      form: { point: 1, bay: 0.9, straight: 0.7 }, wind: { windward: 1, leeward: 0.8 },
      lures: ['德州钓组贴底搜结构', '摇摆小胖 60mm 打岬角', '水面铅笔（晨昏）']
    },
    topmouth: {
      label: '翘嘴', temp: [18, 28], slope: 'steep',
      form: { point: 1, bay: 0.75, straight: 0.85 }, wind: { windward: 1, leeward: 0.7 },
      lures: ['铁板 20-30g 远投扇形搜索', '长舌米诺抽停', '亮片串钩压中层']
    },
    mandarin: {
      label: '鳜鱼', temp: [16, 26], slope: 'steep',
      form: { point: 1, bay: 0.85, straight: 0.75 }, wind: { windward: 0.9, leeward: 0.9 },
      lures: ['软虫德州慢拖乱石', '倒吊钓组打死角', '小胖子贴底撞结构']
    },
    snakehead: {
      label: '黑鱼', temp: [20, 30], slope: 'flat',
      form: { point: 0.7, bay: 1, straight: 0.8 }, wind: { windward: 0.75, leeward: 1 },
      lures: ['雷蛙打浅滩水草', '浮水软蛙过草洞', '水面波扒']
    },
    stream: {
      label: '马口/溪流', temp: [12, 22], slope: 'moderate',
      form: { point: 0.95, bay: 0.9, straight: 0.9 }, wind: { windward: 0.8, leeward: 1 },
      lures: ['1.5g 单钩小亮片', '微物米诺', '小胖子顶流']
    },
    seabass: {
      label: '海鲈/海钓', temp: [14, 24], slope: 'steep',
      form: { point: 1, bay: 0.8, straight: 0.85 }, wind: { windward: 1, leeward: 0.75 },
      lures: ['铁板/铅鱼打流沟', '米诺走鲈鱼道', '软虫跳底打礁边']
    }
  };

  var WATER_TYPES = {
    auto: { label: '自动' },
    reservoir: { label: '水库/湖' },
    river: { label: '河流' },
    sea: { label: '海/河口' }
  };

  var WEIGHTS = { temp: 0.18, pressure: 0.20, wind: 0.16, time: 0.16, sky: 0.12, water: 0.18 };

  /* 评分偏好的几套权重：天气口径本身有争议（有人只看气压、有人只看水温），
     所以默认「均衡」，另外三套由用户在设置里自选；每套都归一到 1。 */
  var WEIGHT_PRESETS = {
    balanced: { temp: 0.18, pressure: 0.20, wind: 0.16, time: 0.16, sky: 0.12, water: 0.18 },
    pressure: { temp: 0.14, pressure: 0.30, wind: 0.14, time: 0.14, sky: 0.10, water: 0.18 },
    temp:     { temp: 0.30, pressure: 0.14, wind: 0.14, time: 0.14, sky: 0.10, water: 0.18 },
    wind:     { temp: 0.16, pressure: 0.14, wind: 0.32, time: 0.14, sky: 0.10, water: 0.14 }
  };
  function setProfile(name) {
    var p = WEIGHT_PRESETS[name] || WEIGHT_PRESETS.balanced;
    for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) WEIGHTS[k] = p[k];
    return WEIGHTS;
  }

  /* ============================================================ 时间工具（全部按站点时区，不受本机时区影响） */
  function wallMs(s) {
    if (!s) return NaN;
    var t = s.length === 16 ? s + ':00Z' : (s.length === 10 ? s + 'T12:00:00Z' : s + 'Z');
    return Date.parse(t);
  }
  function nowWall(tzOffsetSec) { return Date.now() + (tzOffsetSec || 0) * 1000; }
  function hourOf(ms) { return new Date(ms).getUTCHours(); }

  /* ============================================================ 水域解析 */
  function isClosed(ring) {
    if (!ring || ring.length < 3) return false;
    return dist(ring[0], ring[ring.length - 1]) < 30;
  }
  function waterKind(tags) {
    if (tags.natural === 'coastline') return 'sea';
    if (tags.waterway === 'river' || tags.waterway === 'riverbank') return 'river';
    if (tags.waterway === 'stream') return 'stream';
    if (tags.waterway === 'canal') return 'canal';
    if (tags.water === 'reservoir' || tags.landuse === 'reservoir') return 'reservoir';
    if (tags.water === 'lake') return 'lake';
    if (tags.water === 'pond' || tags.water === 'basin' || tags.water === 'fishpond') return 'pond';
    return 'water';
  }

  /* 大湖的一条岸线可能上万点：抽稀到 ~1200 点，几何形状与采样精度都够用，
     否则手机端解析 + 采样会明显卡顿。 */
  function downsample(ring, max) {
    if (ring.length <= max) return ring;
    var step = Math.ceil(ring.length / max);
    var out = [];
    for (var i = 0; i < ring.length; i += step) out.push(ring[i]);
    var last = ring[ring.length - 1];
    if (out[out.length - 1] !== last) out.push(last);
    return out;
  }

  /* 裁剪后的几何里，出 bbox 的点是 null：必须按 null 切成若干段，
     不能把这些缺口连成一条假的直线（否则会在湖心造出一条不存在的岸线）。 */
  function segmentsOf(geom) {
    var segs = [], cur = [];
    if (!geom) return segs;
    for (var i = 0; i < geom.length; i++) {
      var g = geom[i];
      if (g && g.lat != null && g.lon != null) cur.push({ lat: g.lat, lon: g.lon });
      else if (cur.length) { segs.push(cur); cur = []; }
    }
    if (cur.length) segs.push(cur);
    return segs.filter(function (s) { return s.length >= 2; });
  }

  function parseBodies(osmResp) {
    var out = [];
    var els = (osmResp && osmResp.elements) || [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i], tags = el.tags || {}, rings = [];
      if (el.type === 'way' && el.geometry) {
        rings = rings.concat(segmentsOf(el.geometry));
      } else if (el.type === 'relation' && el.members) {
        el.members.forEach(function (m) {
          if (m.geometry && m.geometry.length > 2) rings = rings.concat(segmentsOf(m.geometry));
        });
      }
      rings = rings.filter(function (r) { return r.length >= 3; })
        .map(function (r) { return downsample(r, 1200); });
      if (!rings.length) continue;
      var totalLen = 0, longest = rings[0], longestLen = 0;
      rings.forEach(function (r) {
        var L = polyline(r).total;
        totalLen += L;
        if (L > longestLen) { longestLen = L; longest = r; }
      });
      out.push({
        id: el.type + '/' + el.id,
        name: tags.name || tags['name:zh'] || tags.ref || '',
        kind: waterKind(tags),
        tags: tags,
        rings: rings,
        closed: rings.length === 1 && isClosed(rings[0]),
        length: totalLen,
        area: (rings.length === 1 && isClosed(rings[0])) ? Math.abs(shoelace(rings[0])) : null,
        center: longest[0]
      });
    }
    out.sort(function (a, b) { return b.length - a.length; });
    return out;
  }

  function shoelace(ring) {
    var lat0 = ring[0].lat;
    var pts = ring.map(function (p) {
      return { x: rad(p.lon) * R * Math.cos(rad(lat0)), y: rad(p.lat) * R };
    });
    var s = 0;
    for (var i = 0; i < pts.length; i++) {
      var j = (i + 1) % pts.length;
      s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return s / 2;
  }

  function polyline(ring) {
    var pts = ring.slice();
    var closed = isClosed(ring);
    if (closed) pts[pts.length - 1] = pts[0];
    var cum = [0];
    for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    return { pts: pts, cum: cum, total: cum[cum.length - 1], closed: closed };
  }

  function pointAt(pl, s) {
    var t = pl.closed ? ((s % pl.total) + pl.total) % pl.total : clamp(s, 0, pl.total);
    var lo = 0, hi = pl.cum.length - 1;
    while (lo < hi - 1) {
      var mid = (lo + hi) >> 1;
      if (pl.cum[mid] <= t) lo = mid; else hi = mid;
    }
    var seg = pl.cum[hi] - pl.cum[lo];
    var f = seg > 1e-6 ? (t - pl.cum[lo]) / seg : 0;
    var a = pl.pts[lo], b = pl.pts[hi];
    return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
  }

  function pointInRing(ring, p) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i].lon, yi = ring[i].lat, xj = ring[j].lon, yj = ring[j].lat;
      if (((yi > p.lat) !== (yj > p.lat)) &&
        (p.lon < (xj - xi) * (p.lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /* ============================================================ 候选岸线点 */
  var MAX_CANDIDATES = 22;

  /* 「线性要素」= 河流中心线 / 海岸线这类线状几何（岸型无从判断）；
     湖库多边形即使被 bbox 裁开也不再算线性，否则岬角/湾的判定会被一起干掉。 */
  function isLineKind(kind) {
    return kind === 'river' || kind === 'stream' || kind === 'canal' || kind === 'sea';
  }

  function buildCandidates(bodies, me) {
    var pick = bodies.filter(function (b) { return b.length > 120; }).slice(0, 6);
    if (!pick.length) return { candidates: [], bodies: [] };

    // 把所有岸段摊平，按长度分配采样点（大湖的一条 relation 可能被裁成上百段）
    var segs = [];
    pick.forEach(function (body, bi) {
      body.minDist = Infinity;
      body.rings.forEach(function (ring, ri) {
        var pl = polyline(ring);
        if (pl.total < 150) return;
        segs.push({ body: body, bodyIndex: bi, ring: ring, ringIndex: ri, pl: pl, len: pl.total });
      });
    });
    if (!segs.length) return { candidates: [], bodies: [] };

    var totalLen = segs.reduce(function (a, s) { return a + s.len; }, 0);
    var POOL = MAX_CANDIDATES * 2;   // 先多采一倍，再按「离我近 + 互不重叠」筛出最终候选
    var raw = [];
    segs.forEach(function (seg) {
      var n = Math.max(1, Math.round(POOL * seg.len / totalLen));
      for (var i = 0; i < n; i++) {
        var s = seg.pl.total * (i + 0.5) / n;
        var p = pointAt(seg.pl, s);
        // 岸型判定用的邻域：短岸段上自动缩短，否则 ±160 m 会越过端点，把直岸读成湾
        var nd = Math.min(160, seg.pl.total * 0.28);
        var a = pointAt(seg.pl, s - nd), b = pointAt(seg.pl, s + nd);
        var tan = bearing(a, b);
        var chord = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
        var bulgeH = dist(chord, p);
        var bulgeDir = bulgeH > 0.5 ? bearing(chord, p) : null;
        var n1 = (tan + 90) % 360, n2 = (tan + 270) % 360;
        var waterSide = null;
        if (seg.pl.closed) waterSide = pointInRing(seg.ring, dest(p, n1, 40)) ? n1 : n2;
        var dMe = dist(me, p);
        if (dMe < seg.body.minDist) seg.body.minDist = dMe;
        raw.push({
          id: seg.body.id + ':' + seg.ringIndex + ':' + i,
          bodyId: seg.body.id,
          name: seg.body.name,
          kind: seg.body.kind,
          linear: isLineKind(seg.body.kind) && !seg.pl.closed,
          lat: p.lat, lon: p.lon,
          n1: n1, n2: n2,
          waterSide: waterSide,
          tangent: tan,
          bulgeDir: bulgeDir,
          bulgeH: bulgeH,
          distToMe: dMe,
          bearingFromMe: bearing(me, p)
        });
      }
    });

    // 离我最近的若干段，且彼此至少相距 160 m（避免 22 个点全挤在同一条 200 m 岸线上）
    raw.sort(function (a, b) { return a.distToMe - b.distToMe; });
    var cands = [];
    raw.forEach(function (c) {
      if (cands.length >= MAX_CANDIDATES) return;
      for (var i = 0; i < cands.length; i++) if (dist(cands[i], c) < 160) return;
      cands.push(c);
    });

    return { candidates: cands, bodies: pick };
  }

  /* 采样点：p0 + 四个岸上/水面方向偏移（120 m / 350 m） */
  function elevationProbes(c) {
    return [
      { lat: c.lat, lon: c.lon },
      dest(c, c.n1, 120), dest(c, c.n2, 120),
      dest(c, c.n1, 350), dest(c, c.n2, 350)
    ];
  }

  /* 用高程决定哪一侧是岸（岸一定比水面高），并算出岸坡 */
  function applyTerrain(c, h) {
    var h0 = h[0], n1_120 = h[1], n2_120 = h[2], n1_350 = h[3], n2_350 = h[4];
    if (h0 == null && n1_120 == null && n2_120 == null) return c;
    var landIsN1;
    if (c.waterSide != null) {
      landIsN1 = c.waterSide === c.n2;
    } else if (n1_120 != null && n2_120 != null && Math.abs(n1_120 - n2_120) >= 1) {
      landIsN1 = n1_120 > n2_120;
    } else if (n1_350 != null && n2_350 != null) {
      landIsN1 = n1_350 > n2_350;
    } else {
      landIsN1 = true;
    }
    var landBearing = landIsN1 ? c.n1 : c.n2;
    var waterBearing = landIsN1 ? c.n2 : c.n1;
    var hLand120 = landIsN1 ? n1_120 : n2_120;
    var hLand350 = landIsN1 ? n1_350 : n2_350;

    c.landBearing = landBearing;
    c.waterBearing = waterBearing;
    if (h0 != null && hLand120 != null) {
      c.slopePct = round((hLand120 - h0) / 120 * 100, 1);
      c.slopeBasis = 120;
    } else if (h0 != null && hLand350 != null) {
      c.slopePct = round((hLand350 - h0) / 350 * 100, 1);
      c.slopeBasis = 350;
    } else {
      c.slopePct = null;
      c.slopeBasis = 0;
    }
    c.elev = h0;
    // 近岸 20 m 水深估值：按岸坡线性外推，DEM 90 m 分辨率会低估，只作相对比较
    c.depth20 = c.slopePct == null ? null : round(Math.max(0, c.slopePct / 100 * 20), 1);

    // 岸型：岸线相对弦向水面凸出＝岬角，凹进＝湾
    if (c.bulgeDir != null && c.bulgeH > 8) {
      var towardWater = angDiff(c.bulgeDir, c.waterBearing) < 90;
      c.form = towardWater ? 'point' : 'bay';
      c.formText = towardWater ? '岬角' : '湾';
      c.formStrength = c.bulgeH > 70 ? '强' : (c.bulgeH > 28 ? '中' : '弱');
    } else {
      c.form = 'straight';
      c.formText = '直岸';
      c.formStrength = '';
    }
    return c;
  }

  /* 迎风判定：风从水吹向岸 → 迎风岸（饵鱼被推到岸脚） */
  function markWind(c, windToDeg) {
    if (c.landBearing == null) { c.windward = null; return c; }
    var d = angDiff(windToDeg, c.landBearing);
    c.windward = d < 60;
    c.windAngle = round(d, 0);
    return c;
  }

  /* ============================================================ 环境分因子 */
  function slopePref(pct, pref) {
    if (pct == null) return { v: 52, txt: '岸坡数据缺失' };
    var v, txt;
    if (pref === 'steep') {
      v = pct >= 18 ? 100 : pct >= 10 ? 88 : pct >= 5 ? 68 : pct >= 2 ? 48 : 34;
      txt = pct >= 10 ? '陡岸，深水贴近岸脚' : (pct >= 5 ? '中等岸坡' : '浅缓岸，鱼会更靠外');
    } else if (pref === 'flat') {
      v = pct <= 2 ? 96 : pct <= 5 ? 84 : pct <= 10 ? 62 : 38;
      txt = pct <= 5 ? '缓坡浅滩，适合打水草与水面系' : '偏陡，浅滩型鱼种不占优';
    } else if (pref === 'moderate') {
      v = (pct >= 4 && pct <= 14) ? 94 : (pct > 14 ? 74 : 72);
      txt = (pct >= 4 && pct <= 14) ? '岸坡适中，深浅都有得打' : '岸坡偏' + (pct > 14 ? '陡' : '缓');
    } else {
      v = 70; txt = '岸坡任意';
    }
    return { v: v, txt: txt };
  }

  function structureScore(c, ctx) {
    var sp = SPECIES[ctx.species] || SPECIES.general;
    var parts = [], score = 0;

    var sl = slopePref(c.slopePct, sp.slope);
    parts.push({ w: 0.40, v: sl.v, txt: sl.txt });

    var formCoef = sp.form[c.form] != null ? sp.form[c.form] : 0.8;
    var formV = 60 + 40 * (formCoef - 0.7) / 0.3;
    if (c.form === 'straight') formV = 62;
    if (c.linear) formV = Math.min(formV, 58);
    parts.push({
      w: 0.30, v: clamp(formV, 20, 100),
      txt: c.satSource ? '岸线由卫星水面掩膜提取（OSM 不可用时的兜底）' : c.linear ? '河段中心线，岸型未知' :
        (c.form === 'point' ? '岬角凸入水面，鱼道收窄' :
          c.form === 'bay' ? '湾内回流，饵鱼容易滞留' : '岸线较直，靠结构找鱼')
    });

    var windV = 60, windTxt = '风向与岸线夹角一般';
    if (c.windward === true) {
      windV = sp.wind.windward >= 1 ? 96 : 62;
      windTxt = sp.wind.windward >= 1 ? '迎风岸：风把饵鱼与浑水推到岸脚' : '迎风岸，但对这个鱼种不算加分';
      if (ctx.windSpeed > 9) { windV -= 26; windTxt = '迎风且风大，浪高难控饵'; }
    } else if (c.windward === false) {
      windV = sp.wind.leeward >= 1 ? 92 : 66;
      windTxt = sp.wind.leeward >= 1 ? '背风岸：水面平静，适合精细作钓' : '背风岸，缺少风生流';
    }
    parts.push({ w: 0.20, v: windV, txt: windTxt });

    var depthV = 60, depthTxt = '近岸水深估值缺失';
    if (c.depth20 != null) {
      depthV = c.depth20 >= 2.5 ? 92 : c.depth20 >= 1.2 ? 78 : c.depth20 >= 0.6 ? 62 : 48;
      depthTxt = c.depth20 < 0.2 ? '近岸 20 m 仍是浅滩（推断）' :
        ('近岸 20 m 约 ' + c.depth20.toFixed(1) + ' m 深（推断）');
    }
    parts.push({ w: 0.10, v: depthV, txt: depthTxt });

    parts.forEach(function (p) { score += p.w * p.v; });
    return { score: clamp(score, 0, 100), parts: parts };
  }

  function accessScore(m) {
    return m <= 400 ? 100 : m <= 1000 ? 88 : m <= 2000 ? 74 : m <= 3500 ? 58 : 42;
  }

  function pickSpots(cands, ctx) {
    var out = [];
    cands.forEach(function (c) {
      if (c.slopePct == null && c.form === 'straight' && c.linear) return;
      var st = structureScore(c, ctx);
      // 历史影像标出的水下结构（枯水期露出的老河床、稳定的浅脊硬底）离得越近越值钱
      var structScore = st.score, satHit = null;
      if (ctx.sat && ctx.sat.length) {
        for (var si = 0; si < ctx.sat.length; si++) {
          var sdist = dist(c, ctx.sat[si]);
          if (sdist < 250) {
            satHit = { d: sdist, text: ctx.sat[si].text || '水下有结构异常' };
            structScore = clamp(structScore + 8, 0, 100);
            break;
          }
        }
      }
      var ac = accessScore(c.distToMe);
      var total = 0.50 * ctx.envScore + 0.40 * structScore + 0.10 * ac;
      var sp = SPECIES[ctx.species] || SPECIES.general;
      var reasons = st.parts.slice()
        .sort(function (a, b) { return (b.w * b.v) - (a.w * a.v); })
        .slice(0, 2).map(function (p) { return p.txt; });
      if (satHit) reasons.push('历史影像：' + satHit.text + '（约 ' + Math.round(satHit.d) + ' m）');
      if (c.distToMe <= 900) reasons.push('离你 ' + fmtDist(c.distToMe) + '，步行/短途即可下竿');
      out.push({
        id: c.id, lat: c.lat, lon: c.lon, name: c.name, kind: c.kind,
        formText: c.form === 'point' ? ((c.formStrength || '') + '岬角')
          : c.form === 'bay' ? ((c.formStrength || '') + '湾')
            : (c.linear ? '河段' : '直岸'),
        tags: buildTags(c),
        spotScore: Math.round(clamp(total, 0, 100)),
        structScore: Math.round(st.score),
        distToMe: c.distToMe, bearingFromMe: c.bearingFromMe,
        slopePct: c.slopePct, depth20: c.depth20,
        windward: c.windward, waterBearing: c.waterBearing,
        reasons: reasons,
        lure: sp.lures,
        cand: c
      });
    });
    out.sort(function (a, b) { return b.spotScore - a.spotScore; });

    // 去重：同一条岸线上相距 < 150 m 的点只留分高的
    var keep = [];
    out.forEach(function (s) {
      var dup = keep.some(function (k) { return dist(k, s) < 150; });
      if (!dup) keep.push(s);
    });
    return keep;
  }

  function buildTags(c) {
    var t = [];
    if (c.form === 'point') t.push({ txt: (c.formStrength || '') + '岬角', hi: true });
    else if (c.form === 'bay') t.push({ txt: (c.formStrength || '') + '湾', hi: false });
    else t.push({ txt: c.linear ? '河段' : '直岸', hi: false });
    if (c.slopePct != null) {
      t.push({ txt: c.slopePct >= 12 ? '陡岸' : (c.slopePct >= 5 ? '中坡' : '缓浅'), hi: c.slopePct >= 12 });
    }
    if (c.windward === true) t.push({ txt: '迎风', hi: true });
    else if (c.windward === false) t.push({ txt: '背风', hi: false });
    if (c.satSource) t.push({ txt: '卫星水面', hi: false });
    if (c.linear) t.push({ txt: '岸型未知', hi: false });
    return t;
  }

  /* ============================================================ 环境分 */
  function tempScore(waterTemp, species) {
    var sp = SPECIES[species] || SPECIES.general;
    var a = sp.temp[0], b = sp.temp[1];
    if (waterTemp == null) return { v: 55, txt: '水温数据缺失，按中性处理' };
    var v, txt;
    if (waterTemp >= a && waterTemp <= b) { v = 100; txt = '水温 ' + round(waterTemp, 1) + '℃，正在活性区间'; }
    else if (waterTemp >= a - 4 && waterTemp <= b + 4) {
      v = 76; txt = '水温 ' + round(waterTemp, 1) + '℃，略偏' + (waterTemp < a ? '凉' : '热') + '，活性一般';
    } else if (waterTemp >= a - 8 && waterTemp <= b + 8) {
      v = 48; txt = '水温 ' + round(waterTemp, 1) + '℃，' + (waterTemp < a ? '偏冷，鱼口轻' : '偏热，鱼躲深水');
    } else {
      v = 26; txt = '水温 ' + round(waterTemp, 1) + '℃，明显超出活跃区间';
    }
    return { v: v, txt: txt };
  }

  function pressureScore(p, d3h) {
    if (p == null) return { v: 55, txt: '气压数据缺失' };
    var lvl;
    if (p >= 1012 && p <= 1022) lvl = 100;
    else if ((p >= 1005 && p < 1012) || (p > 1022 && p <= 1028)) lvl = 80;
    else if ((p >= 995 && p < 1005) || p > 1028) lvl = 55;
    else lvl = 36;
    var tv = 82, ttxt = '气压平稳';
    if (d3h != null) {
      if (d3h >= 0.6 && d3h <= 2.6) { tv = 100; ttxt = '气压缓升 +' + round(d3h, 1) + ' hPa/3h，鱼活性好'; }
      else if (d3h > 2.6 && d3h <= 5) { tv = 72; ttxt = '气压快速上升 +' + round(d3h, 1) + ' hPa/3h'; }
      else if (d3h > 5) { tv = 56; ttxt = '气压暴涨，鱼容易上浮不咬'; }
      else if (d3h <= -0.6 && d3h >= -2.6) { tv = 58; ttxt = '气压缓降 ' + round(d3h, 1) + ' hPa/3h，鱼口转弱'; }
      else if (d3h < -2.6) { tv = 32; ttxt = '气压急降 ' + round(d3h, 1) + ' hPa/3h，通常最难钓'; }
    }
    var v = 0.5 * lvl + 0.5 * tv;
    var scale = p >= 1012 && p <= 1022 ? '高压稳定' : (p < 1005 ? '低压' : '过渡气压');
    return { v: clamp(v, 0, 100), txt: scale + '（' + round(p, 1) + ' hPa）· ' + ttxt };
  }

  function windScore(speed, gust, species) {
    if (speed == null) return { v: 55, txt: '风数据缺失' };
    var sp = SPECIES[species] || SPECIES.general;
    var calm = species === 'snakehead' || species === 'stream';
    var v, txt;
    if (calm) {
      if (speed <= 3) { v = 100; txt = '微风 ' + round(speed, 1) + ' m/s，水面平静适合打表层'; }
      else if (speed <= 5.5) { v = 78; txt = '风 ' + round(speed, 1) + ' m/s，稍大但能接受'; }
      else { v = 45; txt = '风 ' + round(speed, 1) + ' m/s，水面太乱'; }
    } else {
      if (speed >= 2.5 && speed <= 5.5) { v = 100; txt = '风 ' + round(speed, 1) + ' m/s，起波增氧最能出鱼'; }
      else if (speed >= 1.2 && speed < 2.5) { v = 76; txt = '风 ' + round(speed, 1) + ' m/s，偏小'; }
      else if (speed > 5.5 && speed <= 8) { v = 74; txt = '风 ' + round(speed, 1) + ' m/s，偏大，注意控线'; }
      else if (speed < 1.2) { v = 54; txt = '几乎无风 ' + round(speed, 1) + ' m/s，水面太平，闷'; }
      else { v = 40; txt = '风 ' + round(speed, 1) + ' m/s，抛投与控饵都难'; }
    }
    if (gust != null && speed != null && (gust - speed) > 6) {
      v -= 10; txt += '；阵风差 ' + round(gust - speed, 1) + ' m/s，备好重克数';
    }
    return { v: clamp(v, 0, 100), txt: txt };
  }

  function timeScore(nowMs, sunriseMs, sunsetMs) {
    if (!isFinite(sunriseMs) || !isFinite(sunsetMs)) return { v: 60, txt: '日出日落数据缺失' };
    var toRise = Math.abs(nowMs - sunriseMs) / 60000;
    var toSet = Math.abs(nowMs - sunsetMs) / 60000;
    var h = hourOf(nowMs) + (new Date(nowMs).getUTCMinutes() / 60);
    var near = Math.min(toRise, toSet);
    var v, txt;
    if (near <= 90) { v = 100; txt = '正在晨昏窗口（' + (toRise < toSet ? '日出' : '日落') + '前后 1.5h），最该出门的时段'; }
    else if (near <= 180) { v = 80; txt = '接近晨昏窗口，鱼开始移动'; }
    else if (h < 9 || h > 17) { v = 72; txt = '夜间/清晨时段，鲈鱼与翘嘴常有夜口'; }
    else if (h >= 10.5 && h <= 15.5) { v = 44; txt = '正午强光时段，鱼多贴深结构，最难钓'; }
    else { v = 62; txt = '白天普通时段'; }
    return { v: v, txt: txt };
  }

  function skyScore(cloud, precipProb, precip) {
    var v;
    if (cloud == null) v = 60;
    else if (cloud >= 40 && cloud <= 88) v = 100;
    else if (cloud >= 20 && cloud < 40) v = 80;
    else if (cloud > 88) v = 84;
    else v = 64;
    var txt = cloud == null ? '云量未知' :
      (cloud >= 40 && cloud <= 88 ? '云量 ' + Math.round(cloud) + '%，散射光，鱼敢靠边' :
        cloud > 88 ? '厚云/阴天，光线柔和' : '云量 ' + Math.round(cloud) + '%，通透强光');
    if (precipProb != null) {
      if (precipProb >= 70) { v -= 22; txt += '；降水概率 ' + Math.round(precipProb) + '%，出行体验差'; }
      else if (precipProb >= 35) { txt += '；有 ' + Math.round(precipProb) + '% 降水概率，小雨反而活跃'; }
      else { txt += '；基本无雨'; }
    }
    if (precip != null && precip > 4) { v -= 12; txt += '；正在下 ' + round(precip, 1) + ' mm/h'; }
    return { v: clamp(v, 0, 100), txt: txt };
  }

  /* 水位/潮流：海看潮位变化率，河看流量趋势，湖库用降水+汇流做代理 */
  function waterScore(ctx) {
    var w = ctx.water;
    if (w && w.mode === 'tide') {
      var rate = w.rate2h, phase = w.phase;
      var v = 58 + 42 * Math.min(1, Math.abs(rate) / 0.6);
      var txt;
      if (Math.abs(rate) < 0.1) { v = 56; txt = '接近平潮（' + phase + '），潮水几乎不动，鱼口稀'; }
      else if (rate > 0) { txt = '涨潮中，潮位 +' + round(rate, 2) + ' m/2h，鱼跟着水线进湾'; v = clamp(v, 0, 100); }
      else { txt = '落潮中，潮位 ' + round(rate, 2) + ' m/2h，注意找潮沟与深槽'; v = clamp(v + 4, 0, 100); }
      if (w.nearTurn) { v -= 8; txt += '；即将转潮'; }
      return { v: clamp(v, 0, 100), txt: txt };
    }
    if (w && w.mode === 'river') {
      var pct = w.pct3d;
      var v2, t2;
      if (pct == null) { v2 = 68; t2 = '流量数据不足，按中性处理'; }
      else if (pct >= 5 && pct <= 30) { v2 = 100; t2 = '水位缓涨 +' + round(pct, 0) + '%/3d，新水带入食物，最好钓'; }
      else if (pct > 30 && pct <= 60) { v2 = 74; t2 = '涨水 ' + round(pct, 0) + '%/3d，水色转浑'; }
      else if (pct > 60) { v2 = 56; t2 = '暴涨 ' + round(pct, 0) + '%/3d，水流太急难作钓'; }
      else if (pct >= -5) { v2 = 84; t2 = '流量平稳，鱼情稳定'; }
      else if (pct >= -25) { v2 = 76; t2 = '退水 ' + round(pct, 0) + '%/3d，鱼往外走'; }
      else { v2 = 48; t2 = '急退 ' + round(pct, 0) + '%/3d，水位降太快鱼警觉'; }
      return { v: v2, txt: t2 };
    }
    if (w && w.mode === 'lake') {
      var rain = w.rain3d;
      var v3, t3;
      if (rain == null) { v3 = 72; t3 = '无降水数据，按中性处理'; }
      else if (rain >= 4 && rain <= 25) { v3 = 92; t3 = '近 3 天降水 ' + round(rain, 1) + ' mm，水位缓涨、入水口最活跃'; }
      else if (rain < 4) { v3 = 80; t3 = '近 3 天降水 ' + round(rain, 1) + ' mm，水位基本稳定'; }
      else if (rain <= 60) { v3 = 70; t3 = '降水偏多 ' + round(rain, 1) + ' mm，水色偏浑'; }
      else { v3 = 58; t3 = '强降水 ' + round(rain, 1) + ' mm，水位快速变化'; }
      if (w.pct3d != null && w.pct3d < -25) { v3 -= 10; t3 += '；汇流在快速回落'; }
      return { v: clamp(v3, 0, 100), txt: t3 };
    }
    return { v: 68, txt: '缺少水位数据，按中性处理' };
  }

  function envScore(ctx) {
    var f = [
      { key: 'temp', label: '水温/气温', w: WEIGHTS.temp, r: tempScore(ctx.waterTemp, ctx.species) },
      { key: 'pressure', label: '气压', w: WEIGHTS.pressure, r: pressureScore(ctx.pressure, ctx.dPressure3h) },
      { key: 'wind', label: '风', w: WEIGHTS.wind, r: windScore(ctx.windSpeed, ctx.windGust, ctx.species) },
      { key: 'time', label: '时段', w: WEIGHTS.time, r: timeScore(ctx.nowMs, ctx.sunriseMs, ctx.sunsetMs) },
      { key: 'sky', label: '云与降水', w: WEIGHTS.sky, r: skyScore(ctx.cloud, ctx.precipProb, ctx.precip) },
      { key: 'water', label: '水位/潮流', w: WEIGHTS.water, r: waterScore(ctx) }
    ];
    var total = 0;
    f.forEach(function (x) { x.score = Math.round(x.r.v); total += x.w * x.r.v; });
    return { score: Math.round(clamp(total, 0, 100)), factors: f };
  }

  /* 未来 24 小时的环境分曲线（用逐小时数据重算，权重同一套） */
  function hourCurve(ctx) {
    var H = ctx.hourly;
    if (!H || !H.time || !H.time.length) return [];
    var now = ctx.nowMs;
    var idx = 0;
    for (var i = 0; i < H.time.length; i++) {
      if (wallMs(H.time[i]) + 30 * 60000 >= now) { idx = i; break; }
    }
    var out = [];
    for (var k = idx; k < Math.min(idx + 24, H.time.length); k++) {
      var tMs = wallMs(H.time[k]);
      var p = H.pressure_msl ? H.pressure_msl[k] : null;
      var pPrev = H.pressure_msl ? H.pressure_msl[Math.max(0, k - 3)] : null;
      var sub = {
        species: ctx.species,
        waterTemp: ctx.waterTemp,
        pressure: p,
        dPressure3h: (p != null && pPrev != null) ? p - pPrev : null,
        windSpeed: H.wind_speed_10m ? H.wind_speed_10m[k] : null,
        windGust: H.wind_gusts_10m ? H.wind_gusts_10m[k] : null,
        nowMs: tMs,
        sunriseMs: ctx.sunriseMs,
        sunsetMs: ctx.sunsetMs,
        cloud: H.cloud_cover ? H.cloud_cover[k] : null,
        precipProb: H.precipitation_probability ? H.precipitation_probability[k] : null,
        precip: H.precipitation ? H.precipitation[k] : null,
        water: ctx.water ? Object.assign({}, ctx.water, tideAt(ctx, tMs)) : null
      };
      out.push({ t: H.time[k], ms: tMs, hour: hourOf(tMs), score: envScore(sub).score });
    }
    return out;
  }

  function tideAt(ctx, tMs) {
    if (!ctx.tideHourly) return {};
    var h = ctx.tideHourly;
    var best = -1, bestD = Infinity;
    for (var i = 0; i < h.time.length; i++) {
      var d = Math.abs(wallMs(h.time[i]) - tMs);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return {};
    var hNow = h.sea_level_height_msl ? h.sea_level_height_msl[best] : null;
    var hPrev = best > 0 && h.sea_level_height_msl ? h.sea_level_height_msl[best - 1] : null;
    var hNext = h.sea_level_height_msl && best + 1 < h.time.length ? h.sea_level_height_msl[best + 1] : null;
    return {
      rate2h: (hNow != null && hPrev != null && hNext != null) ? (hNext - hPrev) : null,
      phase: (hNext != null && hNow != null) ? (hNext > hNow ? '涨' : '落') : '平',
      nearTurn: false
    };
  }

  /* 最佳窗口：从 24h 曲线里找两个不重叠的 2 小时窗口 */
  function bestWindows(curve) {
    if (!curve || curve.length < 3) return [];
    var scored = [];
    for (var i = 0; i + 1 < curve.length; i++) {
      scored.push({ i: i, avg: (curve[i].score + curve[i + 1].score) / 2 });
    }
    scored.sort(function (a, b) { return b.avg - a.avg; });
    var picked = [];
    scored.forEach(function (s) {
      if (picked.length >= 2) return;
      var clash = picked.some(function (p) { return Math.abs(p.i - s.i) < 4; });
      if (!clash) picked.push(s);
    });
    picked.sort(function (a, b) { return a.i - b.i; });
    return picked.map(function (p) {
      var a = curve[p.i], b = curve[Math.min(p.i + 2, curve.length - 1)];
      return { from: a.t, to: b.t, score: Math.round(p.avg), hour: a.hour };
    });
  }

  /* 地形摘要：给「地形结构」卡片 */
  function terrainSummary(cands) {
    var withSlope = cands.filter(function (c) { return c.slopePct != null; });
    var slopes = withSlope.map(function (c) { return c.slopePct; }).sort(function (a, b) { return a - b; });
    var med = slopes.length ? slopes[Math.floor(slopes.length / 2)] : null;
    var steep = cands.filter(function (c) { return c.slopePct != null && c.slopePct >= 10; }).length;
    var points = cands.filter(function (c) { return c.form === 'point'; }).length;
    var bays = cands.filter(function (c) { return c.form === 'bay'; }).length;
    var wind = cands.filter(function (c) { return c.windward === true; }).length;
    var depths = cands.filter(function (c) { return c.depth20 != null; }).map(function (c) { return c.depth20; })
      .sort(function (a, b) { return a - b; });
    return {
      sampled: cands.length,
      medianSlope: med,
      steepCount: steep,
      pointCount: points,
      bayCount: bays,
      windCount: wind,
      medianDepth20: depths.length ? depths[Math.floor(depths.length / 2)] : null,
      maxDepth20: depths.length ? depths[depths.length - 1] : null
    };
  }

  window.Engine = {
    // geo
    dist: dist, bearing: bearing, dest: dest, angDiff: angDiff, compass: compass, fmtDist: fmtDist,
    round: round, clamp: clamp, wallMs: wallMs, nowWall: nowWall, hourOf: hourOf,
    // water
    parseBodies: parseBodies, polyline: polyline, pointAt: pointAt, pointInRing: pointInRing,
    buildCandidates: buildCandidates, elevationProbes: elevationProbes,
    applyTerrain: applyTerrain, markWind: markWind, terrainSummary: terrainSummary,
    // scoring
    SPECIES: SPECIES, WATER_TYPES: WATER_TYPES, WEIGHTS: WEIGHTS,
    WEIGHT_PRESETS: WEIGHT_PRESETS, setProfile: setProfile,
    envScore: envScore, hourCurve: hourCurve, bestWindows: bestWindows,
    structureScore: structureScore, pickSpots: pickSpots, tideAt: tideAt,
    slopePref: slopePref, tempScore: tempScore, pressureScore: pressureScore,
    windScore: windScore, timeScore: timeScore, skyScore: skyScore, waterScore: waterScore
  };
})();
