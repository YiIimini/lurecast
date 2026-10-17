/* LureCast · 「我的」分区：常用地点 / 拍照解锁渔获档案 / 动态水族馆
   全部只存本机 localStorage：lc:fav（地点）、lc:catches（渔获，含压缩照片）。
   没有云端、没有任何上传；照片会先压到 ~480px JPEG，避免吃满配额。 */
(function () {
  'use strict';
  // 存储统一走 Store（IndexedDB 同步门面），失败时退回 localStorage
  var Store = window.Store || window.localStorage;

  var KEY_FAV = 'lc:fav';
  var KEY_CATCH = 'lc:catches';
  var MAX_PHOTO_PX = 480, PHOTO_Q = 0.72, MAX_CATCHES = 80;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function st() { return (window.LureCast && window.LureCast.state) || {}; }
  function read(key, dft) {
    try { var raw = Store.getItem(key); return raw ? JSON.parse(raw) : dft; } catch (e) { return dft; }
  }
  function write(key, val) {
    try { Store.setItem(key, JSON.stringify(val)); return true; }
    catch (e) {
      // 配额满：先把最老的照片清掉再试一次
      if (window.console) console.warn('localStorage 满了，清理旧照片后重试');
      return false;
    }
  }
  function fmtDate(ts) {
    var d = new Date(ts), p = function (n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function distM(a, b) {
    if (!a || !b) return null;
    var R = 6371000, r = Math.PI / 180;
    var dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* ---------------------------------------------------------------- 常用地点 */
  function favList() { return read(KEY_FAV, []); }

  function saveCurrentPlace() {
    var s = st();
    if (!s.me) { alert('还没有定位：先用 GPS 或「找水域」选一个地方。'); return; }
    var list = favList();
    if (list.some(function (f) { return distM(f, s.me) < 120; })) {
      alert('这个位置已经存过了（120 m 内）。');
      return;
    }
    var guess = s.placeHint || (s.place && s.place.name) || ('位置 ' + s.me.lat.toFixed(3) + ',' + s.me.lon.toFixed(3));
    var name = prompt('给这个钓点起个名字：', guess);
    if (name == null) return;
    var desc = prompt('描述（可留空）：例如「停车场旁石堤，涨潮能站人」', '');
    list.unshift({
      id: 'f' + Date.now(), name: (name || guess).slice(0, 24), desc: (desc || '').slice(0, 120),
      lat: s.me.lat, lon: s.me.lon, at: Date.now(), photos: []
    });
    write(KEY_FAV, list.slice(0, 30));
    renderFav();
  }

  function renderFav() {
    var box = $('favList');
    if (!box) return;
    var list = favList(), s = st();
    if (!list.length) {
      box.innerHTML = '<div class="empty"><b>还没有常用地点</b>' +
        '<p>定位到常去的钓点后点右上「保存当前位置」。之后一键就能切过去评估，不用每次重新搜。</p></div>';
      return;
    }
    box.innerHTML = list.map(function (f, i) {
      var d = s.me ? distM(s.me, f) : null;
      var nPhotos = (f.photos || []).length;
      return '<div class="favrow">' +
        '<button class="favgo" data-fav="' + i + '">' +
        '<b><span class="favstars">★</span> ' + esc(f.name) + '</b>' +
        (f.desc ? '<em style="color:var(--ink-2)">' + esc(f.desc) + '</em>' : '') +
        '<em>' + f.lat.toFixed(4) + ', ' + f.lon.toFixed(4) +
        (d != null ? ' · 距 ' + (d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m') : '') +
        ' · 存于 ' + fmtDate(f.at).slice(5) +
        (nPhotos ? ' · ' + nPhotos + ' 张图' : '') + '</em></button>' +
        '<div class="favacts">' +
        '<button class="favdel" data-favpic="' + i + '" title="加图片">＋</button>' +
        '<button class="favdel" data-favdel="' + i + '" title="删除">×</button>' +
        '</div></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-fav]'), function (b) {
      b.addEventListener('click', function () {
        var f = favList()[parseInt(b.getAttribute('data-fav'), 10)];
        if (f && window.LureCast) window.LureCast.setMe(f.lat, f.lon, null, f.name, 'fav');
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-favpic]'), function (b) {
      b.addEventListener('click', function () {
        var idx = parseInt(b.getAttribute('data-favpic'), 10);
        var inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.multiple = true;
        inp.onchange = function () {
          var files = Array.prototype.slice.call(inp.files || []).slice(0, 6);
          if (!files.length) return;
          var list2 = favList();
          var fav = list2[idx];
          if (!fav) return;
          fav.photos = fav.photos || [];
          Promise.all(files.map(compressImage)).then(function (urls) {
            fav.photos = fav.photos.concat(urls).slice(0, 12);
            write(KEY_FAV, list2);
            renderFav();
          });
        };
        inp.click();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-favdel]'), function (b) {
      b.addEventListener('click', function () {
        var i = parseInt(b.getAttribute('data-favdel'), 10);
        var list = favList();
        var f = list[i];
        if (!f) return;
        if (!confirm('删除常用地点「' + f.name + '」？')) return;
        list.splice(i, 1);
        write(KEY_FAV, list);
        renderFav();
      });
    });
  }

  /* ---------------------------------------------------------------- 渔获档案 */
  function catches() { return read(KEY_CATCH, []); }

  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('读不到这张图')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('图片解析失败')); };
        img.onload = function () {
          var scale = Math.min(1, MAX_PHOTO_PX / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          try { resolve(c.toDataURL('image/jpeg', PHOTO_Q)); }
          catch (e) { reject(e); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* 按当前水域/季节给 3 个推荐鱼种（没有 AI 识别，这里只做"智能建议"） */
  function suggestSpecies() {
    var s = st();
    var db = window.SPECIES_DB || [];
    var isSalt = s.waterAuto === 'sea' || (s.spots && s.spots[0] && s.spots[0].kind === 'sea');
    var wt = s.waterTemp;
    var scored = db.map(function (sp) {
      var v = 0;
      if (isSalt && sp.water === 'salt') v += 40;
      if (!isSalt && sp.water === 'fresh') v += 40;
      if (sp.water === 'both') v += 20;
      if (wt != null && wt >= sp.season[0] && wt <= sp.season[1]) v += 30;
      if (sp.region === 'cn') v += 8;
      return { sp: sp, v: v };
    }).sort(function (a, b) { return b.v - a.v; });
    return scored.slice(0, 3).map(function (x) { return x.sp; });
  }

  var pending = null;   // {photos: [dataURL...]}

  function openPicker(urls) {
    var photos = Array.isArray(urls) ? urls : [urls];
    pending = { photos: photos };
    var dataUrl = photos[0];
    var box = $('catchBody');
    if (!box) return;
    var db = (window.SPECIES_DB || []).slice().sort(function (a, b) { return a.zh.localeCompare(b.zh, 'zh'); });
    var sug = suggestSpecies();
    box.innerHTML =
      '<div class="catchform">' +
      '<div class="catchthumbs"><img class="catchthumb" src="' + dataUrl + '" alt="渔获照片">' +
      (photos.length > 1 ? '<span class="catchmore">+' + (photos.length - 1) + ' 张</span>' : '') + '</div>' +
      '<div class="catchfields">' +
      '<label>鱼种（拍照后手动确认——本地不做 AI 识别，避免认错）</label>' +
      '<select id="catchSpecies">' + db.map(function (sp) {
        return '<option value="' + sp.id + '">' + esc(sp.zh) + ' · ' + esc(sp.latin) + '</option>';
      }).join('') + '</select>' +
      '<div class="chiprow" style="margin-top:8px">' +
      sug.map(function (sp) {
        return '<button class="chip" data-sug="' + sp.id + '">' + esc(sp.zh) + '</button>';
      }).join('') +
      '</div>' +
      '<label style="margin-top:8px">尺寸（cm，可留空）<input id="catchSize" type="number" min="1" max="300" inputmode="numeric"></label>' +
      '<label style="margin-top:8px">备注<input id="catchNote" placeholder="拟饵 / 咬口 / 天气（可空）"></label>' +
      '<p class="hint" id="aiStatus"></p>' +
      '<div class="chiprow" style="margin-top:10px">' +
      '<button class="act primary" id="btnCatchSave">保存并解锁</button>' +
      '<button class="act ghost" id="btnCatchCancel">取消</button>' +
      '</div></div></div>';
    var sel = $('catchSpecies');
    Array.prototype.forEach.call(box.querySelectorAll('[data-sug]'), function (b) {
      b.addEventListener('click', function () { sel.value = b.getAttribute('data-sug'); });
    });
    // 有识图 Key 就自动认一次；没有就提示可以手动选
    var aiStatus = $('aiStatus');
    if (window.AI && window.AI.ready && window.AI.ready()) {
      if (aiStatus) aiStatus.textContent = '正在用 ' + (window.AI.provider() || {}).name + ' 识别鱼种…';
      window.AI.identify(photos).then(function (res) {
        if (!aiStatus) return;
        var g = res.guess || {};
        var line = 'AI（' + (res.images || 1) + ' 张）：' + (g.species_zh || '无法判断') +
          (res.confidence != null ? '（置信度 ' + Math.round(res.confidence * 100) + '%）' : '');
        if (res.species) { sel.value = res.species.id; line += ' → 已自动选中「' + res.species.zh + '」'; }
        else line += ' → 本地鱼种库没匹配上，请手动选';
        if (g.note) line += ' · ' + g.note;
        aiStatus.textContent = line + '（不对就手动改）';
        var sizeEl = $('catchSize');
        if (sizeEl && !sizeEl.value && g.size_cm) sizeEl.value = Math.round(g.size_cm);
      }).catch(function (err) {
        if (aiStatus) aiStatus.textContent = '识图失败：' + (err && err.message ? err.message : err) + '（可手动选鱼种）';
      });
    } else if (aiStatus) {
      aiStatus.textContent = '未启用识图（设置 → 识图 填 Key 可自动认鱼）；现在请手动选鱼种。';
    }

    if ($('btnCatchCancel')) $('btnCatchCancel').addEventListener('click', function () { pending = null; renderCatch(); });
    if ($('btnCatchSave')) $('btnCatchSave').addEventListener('click', function () {
      saveCatch(sel.value, $('catchSize').value, $('catchNote').value);
    });
  }

  function saveCatch(speciesId, sizeCm, note) {
    var s = st();
    var db = window.SPECIES_DB || [];
    var sp = db.filter(function (x) { return x.id === speciesId; })[0];
    if (!sp) { alert('请选择鱼种'); return; }
    var cur = (s.wx && s.wx.data && s.wx.data.current) || {};
    var rec = {
      id: 'c' + Date.now(),
      sp: sp.id,
      sizeCm: sizeCm ? Number(sizeCm) : null,
      note: (note || '').slice(0, 80),
      at: Date.now(),
      lat: s.me ? +s.me.lat.toFixed(5) : null,
      lon: s.me ? +s.me.lon.toFixed(5) : null,
      place: s.placeHint || (s.place && s.place.name) || '',
      weather: {
        temp: cur.temperature_2m != null ? Math.round(cur.temperature_2m * 10) / 10 : null,
        wind: cur.wind_speed_10m != null ? Math.round(cur.wind_speed_10m) : null,
        press: cur.pressure_msl != null ? Math.round(cur.pressure_msl * 10) / 10 : null,
        score: s.env ? s.env.score : null
      },
      photo: pending && pending.photos ? pending.photos[0] : null,
      photos: pending && pending.photos ? pending.photos.slice() : [],
      photoCount: pending && pending.photos ? pending.photos.length : 0
    };
    var list = catches();
    list.unshift(rec);
    while (list.length > MAX_CATCHES) list.pop();
    // 存不下就把最老的照片丢掉再试
    var ok = write(KEY_CATCH, list);
    for (var i = list.length - 1; !ok && i >= 0; i--) {
      if (list[i] && list[i].photo) { list[i] = Object.assign({}, list[i], { photo: null }); ok = write(KEY_CATCH, list); }
    }
    if (!ok) { alert('本机存储已满，建议先删几条旧记录。'); return; }
    pending = null;
    renderCatch();
    renderAqua();
    if (window.LureCast && window.LureCast.state) window.LureCast.state.tab = window.LureCast.state.tab;
  }

  function deleteCatch(i) {
    var list = catches();
    var r = list[i];
    if (!r) return;
    var db = window.SPECIES_DB || [];
    var sp = db.filter(function (x) { return x.id === r.sp; })[0];
    if (!confirm('删除这条「' + (sp ? sp.zh : r.sp) + '」记录？')) return;
    list.splice(i, 1);
    write(KEY_CATCH, list);
    renderCatch();
    renderAqua();
  }

  function unlockedMap() {
    var m = {};
    catches().forEach(function (r) { if (!m[r.sp]) m[r.sp] = r; });
    return m;
  }

  function renderCatch() {
    var box = $('catchBody');
    if (!box) return;
    var list = catches(), un = unlockedMap();
    var db = window.SPECIES_DB || [];
    var total = db.length, got = Object.keys(un).length;

    var html = '<div class="catchbar">' +
      '<span class="catchstat"><b>' + got + '</b> / ' + total + ' 种已解锁 · 共 ' + list.length + ' 条记录</span>' +
      '<button class="act primary" id="btnPickPhoto">拍照 / 选图</button>' +
      '<button class="act ghost" id="btnExportArchive">导出档案</button>' +
      '<button class="act ghost" id="btnImportArchive">导入档案</button>' +
      '</div>';

    if (!list.length) {
      html += '<div class="empty"><b>还没有渔获档案</b>' +
        '<p>钓到鱼就拍一张——照片只存这台设备，会记录当时的鱼种、尺寸、天气与鱼口指数。' +
        '每解锁一个新鱼种，它就会游进下面的水族馆。</p></div>';
    } else {
      // 照片墙：点一张看详情
      html += '<div class="catchgrid">' + list.map(function (r, i) {
        var sp = db.filter(function (x) { return x.id === r.sp; })[0] || { zh: r.sp };
        var shots = (r.photos && r.photos.length) ? r.photos : (r.photo ? [r.photo] : []);
        var multi = shots.length > 1 ? ' multi' : '';
        return '<button class="catchcell' + multi + '" data-catchopen="' + i + '">' +
          (shots[0] ? '<img src="' + shots[0] + '" alt="" loading="lazy">' : '<div class="nocover">无照片</div>') +
          '<span class="cclabel"><b>' + esc(sp.zh) + '</b><em>' +
          (r.sizeCm ? r.sizeCm + ' cm · ' : '') + fmtDate(r.at).slice(5, 10) + '</em></span>' +
          '</button>';
      }).join('') + '</div>';
    }
    box.innerHTML = html;

    if ($('btnPickPhoto')) $('btnPickPhoto').addEventListener('click', function () { if ($('catchInput')) $('catchInput').click(); });
    if ($('btnExportArchive')) $('btnExportArchive').addEventListener('click', exportArchive);
    if ($('btnImportArchive')) $('btnImportArchive').addEventListener('click', function () { if ($('importInput')) $('importInput').click(); });
    Array.prototype.forEach.call(box.querySelectorAll('[data-catchopen]'), function (b) {
      b.addEventListener('click', function () { openCatchDetail(parseInt(b.getAttribute('data-catchopen'), 10)); });
    });
  }

  /* ---------------------------------------------------------------- 渔获详情（照片墙点开） */
  function openCatchDetail(i) {
    var list = catches();
    var r = list[i];
    if (!r) return;
    var db = window.SPECIES_DB || [];
    var sp = db.filter(function (x) { return x.id === r.sp; })[0] || { zh: r.sp, latin: '', family: '', tip: '', season: [] };
    var w = r.weather || {};
    var shots = (r.photos && r.photos.length) ? r.photos : (r.photo ? [r.photo] : []);
    var title = document.getElementById('catchTitle');
    if (title) title.textContent = sp.zh + (r.sizeCm ? ' · ' + r.sizeCm + ' cm' : '');
    var body = document.getElementById('catchDetail');
    if (!body) return;
    var when = new Date(r.at);
    body.innerHTML =
      (shots.length
        ? '<div class="catchgallery">' + shots.map(function (u) {
          return '<a href="' + u + '" target="_blank" rel="noopener"><img src="' + u + '" alt=""></a>';
        }).join('') + '</div>'
        : '<p class="hint">这条记录没有照片。</p>') +
      '<div class="catchdl" style="margin-top:12px">' +
      '<i>鱼种</i><b>' + esc(sp.zh) + ' <span class="favtag">' + esc(sp.latin || '') + '</span></b>' +
      '<i>尺寸</i><b>' + (r.sizeCm ? r.sizeCm + ' cm' : '未填') + '</b>' +
      '<i>日期时间</i><b>' + fmtDate(r.at) + '（' + when.toLocaleDateString() + ' ' +
      when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '）</b>' +
      '<i>位置</i><b>' + (r.lat != null
        ? (r.place ? esc(r.place) + '<br>' : '') + r.lat + ', ' + r.lon +
          '<br><a href="https://www.openstreetmap.org/?mlat=' + r.lat + '&mlon=' + r.lon + '#map=16/' + r.lat + '/' + r.lon + '" target="_blank" rel="noopener">在 OSM 上查看</a>'
        : '未知') + '</b>' +
      '<i>备注</i><b>' + (r.note ? esc(r.note) : '—') + '</b>' +
      '<i>当时天气</i><b>' + (w.temp != null ? w.temp + ' ℃ · ' : '') +
      (w.wind != null ? '风 ' + w.wind + ' m/s · ' : '') + (w.press != null ? w.press + ' hPa · ' : '') +
      (w.score != null ? '鱼口指数 ' + w.score : '—') + '</b>' +
      '<i>附加图片</i><b>' + (shots.length > 1 ? shots.length + ' 张（上方画廊）' : '1 张') + '</b>' +
      '<i>鱼种资料</i><b>' + esc(sp.family || '') +
      (sp.season ? ' · 活跃水温 ' + sp.season[0] + '–' + sp.season[1] + '℃' : '') +
      (sp.tip ? '<br>' + esc(sp.tip) : '') +
      (sp.lures ? '<br>拟饵：' + esc(sp.lures.join(' / ')) : '') + '</b>' +
      '</div>' +
      '<div class="chiprow" style="margin-top:14px">' +
      '<button class="act ghost" id="btnCatchDelete">删除这条记录</button>' +
      '</div>';
    if (document.getElementById('btnCatchDelete')) {
      document.getElementById('btnCatchDelete').addEventListener('click', function () {
        deleteCatch(i);
        var m = document.getElementById('modalCatch');
        if (m) m.classList.add('hidden');
      });
    }
    var m2 = document.getElementById('modalCatch');
    if (m2) m2.classList.remove('hidden');
  }

  /* ---------------------------------------------------------------- 极简 ZIP（stored）
     不引第三方库：自己写 local header + central directory，浏览器/安卓都能用。
     导出的是真正的 .zip，可以用任何解压软件打开看到里面的 JSON。 */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function zipBuild(files) {
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name);
      var data = f.data;
      var crc = crc32(data);
      var lh = new Uint8Array(30 + name.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, 0, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      lh.set(name, 30);
      parts.push(lh, data);
      central.push({ name: name, crc: crc, size: data.length, offset: offset });
      offset += lh.length + data.length;
    });
    var cdStart = offset, cdSize = 0;
    central.forEach(function (c) {
      var rec = new Uint8Array(46 + c.name.length);
      var dv = new DataView(rec.buffer);
      dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint32(16, c.crc, true); dv.setUint32(20, c.size, true); dv.setUint32(24, c.size, true);
      dv.setUint16(28, c.name.length, true);
      dv.setUint32(42, c.offset, true);
      rec.set(c.name, 46);
      parts.push(rec); cdSize += rec.length;
    });
    var eocd = new Uint8Array(22);
    var dv2 = new DataView(eocd.buffer);
    dv2.setUint32(0, 0x06054b50, true);
    dv2.setUint16(8, central.length, true); dv2.setUint16(10, central.length, true);
    dv2.setUint32(12, cdSize, true); dv2.setUint32(16, cdStart, true);
    parts.push(eocd);
    var total = 0;
    parts.forEach(function (x) { total += x.length; });
    var out = new Uint8Array(total), pos = 0;
    parts.forEach(function (x) { out.set(x, pos); pos += x.length; });
    return out;
  }

  function zipRead(buf) {
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    var eocd = -1;
    for (var i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip 文件');
    var count = dv.getUint16(eocd + 10, true);
    var p0 = dv.getUint32(eocd + 16, true);
    var out = {}, p = p0, dec = new TextDecoder();
    for (var k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var size = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commLen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
      if (method === 0) {
        var lnl = dv.getUint16(lho + 26, true), lex = dv.getUint16(lho + 28, true);
        var start = lho + 30 + lnl + lex;
        out[name] = buf.subarray(start, start + size);
      }
      p += 46 + nameLen + extraLen + commLen;
    }
    return out;
  }

  /* ---------------------------------------------------------------- 档案导出 / 导入 */
  function buildArchive() {
    return {
      app: 'LureCast', v: 1, exportedAt: new Date().toISOString(),
      favorites: favList(), catches: catches()
    };
  }

  function exportArchive() {
    var data = buildArchive();
    var enc = new TextEncoder();
    var name = 'lurecast-backup-' + new Date().toISOString().slice(0, 10) + '.zip';
    var entries = [
      { name: 'manifest.json', data: enc.encode(JSON.stringify({
        app: 'LureCast', v: 2, exportedAt: new Date().toISOString(),
        counts: { catches: data.catches.length, favorites: data.favorites.length }
      }, null, 2)) },
      { name: 'catches.json', data: enc.encode(JSON.stringify(data.catches)) },
      { name: 'favorites.json', data: enc.encode(JSON.stringify(data.favorites)) },
      { name: 'README.txt', data: enc.encode(
        'LureCast 数据备份\n\n' +
        'catches.json  渔获档案（含照片，data URL 内联）\n' +
        'favorites.json 常用地点（含描述与照片）\n\n' +
        '恢复方式：打开 App → 我的 → 渔获档案 → 导入数据包，选这个 zip。\n') }
    ];
    var bytes = zipBuild(entries);
    var summary = { name: name, bytes: bytes.length, records: data.catches.length, places: data.favorites.length };

    var cap = window.Capacitor;
    var FS = cap && cap.Plugins && cap.Plugins.Filesystem;
    var SH = cap && cap.Plugins && cap.Plugins.Share;
    if (FS && SH && cap.isNativePlatform && cap.isNativePlatform()) {
      FS.writeFile({ path: name, data: b64FromBytes(bytes), directory: 'CACHE' })
        .then(function (w) { return SH.share({ title: 'LureCast 数据备份', url: w.uri }); })
        .catch(function (e) {
          // 用户在系统分享面板点了返回是正常操作，不算失败；只有真写不出去才提示
          var msg = e && (e.message || e.errorMessage) ? (e.message || e.errorMessage) : String(e);
          if (/cancel|取消|abort/i.test(msg)) return;
          alert('导出失败：' + msg);
        });
      return summary;
    }
    try {
      var blob = new Blob([bytes], { type: 'application/zip' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    } catch (e) {
      alert('导出失败：' + e.message);
    }
    return summary;
  }

  function b64FromBytes(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  /* 把 zip 里的 JSON 读出来（浏览器 File → ArrayBuffer） */
  function readArchiveBuffer(buf) {
    var files = zipRead(new Uint8Array(buf));
    var dec = new TextDecoder();
    function pick(n) {
      if (!files[n]) throw new Error('压缩包里缺少 ' + n);
      return JSON.parse(dec.decode(files[n]));
    }
    return { catches: pick('catches.json'), favorites: files['favorites.json'] ? pick('favorites.json') : [] };
  }

  /* 合并导入：按 id 去重，冲突时保留较新的那条；返回统计 */
  function importArchive(payload) {
    var data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!data || (!Array.isArray(data.catches) && !Array.isArray(data.favorites))) {
      throw new Error('不是 LureCast 的档案文件');
    }
    var incoming = (data.catches || []).filter(function (r) { return r && r.id; });
    var cur = catches();
    var byId = {};
    cur.forEach(function (r) { byId[r.id] = r; });
    var added = 0, updated = 0;
    incoming.forEach(function (r) {
      if (!byId[r.id]) { cur.push(r); added++; }
      else if ((r.at || 0) > (byId[r.id].at || 0)) { byId[r.id] = r; updated++; }
    });
    cur.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    var ok = write(KEY_CATCH, cur);
    if (!ok) throw new Error('本机存储已满，导入中断');

    var favs = favList();
    var favAdded = 0;
    (data.favorites || []).forEach(function (f) {
      if (!f || f.lat == null) return;
      var dup = favs.some(function (x) { return distM(x, f) < 120 || x.name === f.name; });
      if (!dup) { favs.push(f); favAdded++; }
    });
    write(KEY_FAV, favs.slice(0, 30));
    renderFav(); renderCatch(); renderAqua();
    return { added: added, updated: updated, total: cur.length, places: favAdded };
  }

  /* ---------------------------------------------------------------- 动态水族馆（2.5D 伪三维）
     纯 canvas 2D 手写透视：每条鱼带深度 z（0 远 → 1 近），按 z 排序绘制、缩放与透明跟着 z 变；
     再加上背景雾化、水面波光、焦散光斑、随水流摆动的水草和分层的上浮气泡，
     肉眼观感接近三维，但不需要 three.js（省 600 KB 且低端机也不掉帧）。 */
  var aqua = { raf: 0, fishes: [], bubbles: [], plants: [], t: 0, running: false };

  function buildFishes() {
    var un = unlockedMap();
    var db = window.SPECIES_DB || [];
    var out = [];
    db.forEach(function (sp) {
      if (!un[sp.id]) return;
      var rec = un[sp.id];
      var n = 1 + (rec.sizeCm && rec.sizeCm > 40 ? 1 : 0);
      for (var i = 0; i < n; i++) out.push({ sp: sp, size: 0.8 + i * 0.25 });
    });
    return out.slice(0, 12);
  }

  function resizeAqua(canvas) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = canvas.clientWidth || 320, h = canvas.clientHeight || 190;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: h, ctx: ctx };
  }

  /* 一条鱼：体、尾、背鳍、条纹、眼睛；带深度投影与明暗 */
  function drawFish(ctx, f, t, W, H) {
    var z = f.z;
    var base = 9 + f.size * 9;
    var L = base * (0.5 + z * 0.95);
    var Hh = L * 0.42;
    var wag = Math.sin(t * 0.0045 * f.speed + f.phase) * Hh * 0.55;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.dir, 1);
    ctx.globalAlpha = 0.35 + z * 0.6;

    // 贴近「水面」的鱼稍微压扁（俯视透视）
    var squash = 0.82 + z * 0.18;

    // 尾巴
    ctx.fillStyle = f.sp.fin || '#8fa3b6';
    ctx.beginPath();
    ctx.moveTo(-L * 0.42, 0);
    ctx.lineTo(-L * 0.96, -Hh * 0.9 + wag);
    ctx.lineTo(-L * 0.96, Hh * 0.9 + wag);
    ctx.closePath();
    ctx.fill();

    // 身体
    ctx.fillStyle = f.sp.color || '#7d9a46';
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.5, Hh * 0.5 * squash, 0, 0, Math.PI * 2);
    ctx.fill();

    // 背鳍
    ctx.fillStyle = f.sp.fin || '#5d7634';
    ctx.beginPath();
    ctx.moveTo(-L * 0.1, -Hh * 0.4 * squash);
    ctx.lineTo(L * 0.06, -Hh * 0.95 * squash);
    ctx.lineTo(L * 0.22, -Hh * 0.38 * squash);
    ctx.closePath();
    ctx.fill();

    // 条纹
    if (f.sp.stripe) {
      ctx.globalAlpha = (0.35 + z * 0.6) * 0.35;
      ctx.fillStyle = '#08121c';
      for (var i = -1; i <= 1; i++) {
        ctx.fillRect(i * L * 0.16 - L * 0.028, -Hh * 0.4 * squash, L * 0.056, Hh * 0.8 * squash);
      }
      ctx.globalAlpha = 0.35 + z * 0.6;
    }

    // 腹部高光
    ctx.globalAlpha = (0.35 + z * 0.6) * 0.28;
    ctx.fillStyle = '#dff3ff';
    ctx.beginPath();
    ctx.ellipse(-L * 0.02, Hh * 0.18 * squash, L * 0.34, Hh * 0.16 * squash, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35 + z * 0.6;

    // 眼睛
    ctx.fillStyle = '#0a1119';
    ctx.beginPath();
    ctx.arc(L * 0.33, -Hh * 0.08 * squash, Math.max(1, L * 0.05), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawScene(g) {
    var ctx = g.ctx, W = g.w, H = g.h, t = aqua.t;
    var horizon = H * 0.22;

    // 水体：上浅下深
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#1b4f63');
    grad.addColorStop(0.28, '#123a4e');
    grad.addColorStop(0.62, '#0b2233');
    grad.addColorStop(1, '#050f19');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 水面波光（顶部一条亮带 + 流动高光）
    ctx.save();
    ctx.globalAlpha = 0.5;
    var surf = ctx.createLinearGradient(0, 0, 0, horizon);
    surf.addColorStop(0, 'rgba(150, 235, 255, .35)');
    surf.addColorStop(1, 'rgba(150, 235, 255, 0)');
    ctx.fillStyle = surf;
    ctx.fillRect(0, 0, W, horizon);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = 'rgba(200, 245, 255, .55)';
    ctx.lineWidth = 1;
    for (var s2 = 0; s2 < 3; s2++) {
      ctx.beginPath();
      for (var x = 0; x <= W; x += 8) {
        var y = 6 + s2 * 5 + Math.sin((x * 0.045) + t * 0.0016 + s2) * 2.2;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // 光柱
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 5; i++) {
      var bx = W * (0.08 + i * 0.21) + Math.sin(t * 0.00035 + i * 1.7) * 14;
      var wid = 18 + Math.sin(t * 0.0006 + i) * 6;
      var lg = ctx.createLinearGradient(bx, 0, bx + wid * 2, H);
      lg.addColorStop(0, 'rgba(150, 235, 255, .16)');
      lg.addColorStop(1, 'rgba(150, 235, 255, 0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.lineTo(bx + wid, 0);
      ctx.lineTo(bx + wid * 2.6, H);
      ctx.lineTo(bx + wid * 0.6, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 焦散（水底流动光斑）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var c = 0; c < 14; c++) {
      var cx = (W * ((c * 0.137) % 1)) + Math.sin(t * 0.0009 + c) * 18;
      var cy = H * 0.62 + Math.cos(t * 0.0011 + c * 2.1) * 8 + (c % 3) * 9;
      var rr = 8 + Math.abs(Math.sin(t * 0.0015 + c)) * 12;
      var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      cg.addColorStop(0, 'rgba(180, 240, 255, .10)');
      cg.addColorStop(1, 'rgba(180, 240, 255, 0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 底砂
    ctx.fillStyle = '#0a1a22';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (var x2 = 0; x2 <= W; x2 += 20) {
      ctx.lineTo(x2, H - 14 - Math.sin(x2 * 0.05 + t * 0.0008) * 5);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // 水草（随水流摆）
    ctx.save();
    aqua.plants.forEach(function (pl) {
      var sway = Math.sin(t * 0.0014 + pl.phase) * 7;
      ctx.strokeStyle = pl.color;
      ctx.lineWidth = pl.w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pl.x, H - 6);
      ctx.quadraticCurveTo(pl.x + sway * 0.5, H - pl.h * 0.55, pl.x + sway, H - pl.h);
      ctx.stroke();
    });
    ctx.restore();

    // 气泡（按深度分层）
    aqua.bubbles.forEach(function (b) {
      ctx.globalAlpha = 0.15 + b.z * 0.45;
      ctx.strokeStyle = 'rgba(190, 240, 255, .8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (0.6 + b.z), 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // 鱼：远的先画
    aqua.fishes.slice().sort(function (a, b) { return a.z - b.z; })
      .forEach(function (f) { drawFish(ctx, f, t, W, H); });

    // 暗角，突出中间
    var vg = ctx.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.25, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function stepAqua() {
    var canvas = $('aquaCanvas');
    if (!canvas || !aqua.running) return;
    var g = resizeAqua(canvas);
    var W = g.w, H = g.h;
    aqua.t += 16;

    aqua.fishes.forEach(function (f) {
      var speed = (0.18 + f.z * 0.55) * (0.7 + f.size * 0.4);
      f.x += f.dir * speed;
      f.y += Math.sin(aqua.t * 0.0009 * (0.6 + f.z) + f.phase) * 0.12;
      if (f.dir > 0 && f.x > W + 60) { f.x = -60; f.y = 30 + Math.random() * (H - 70); }
      if (f.dir < 0 && f.x < -60) { f.x = W + 60; f.y = 30 + Math.random() * (H - 70); }
    });
    aqua.bubbles.forEach(function (b) {
      b.y -= b.v * (0.5 + b.z);
      b.x += Math.sin(aqua.t * 0.002 + b.seed) * 0.3;
      if (b.y < -6) { b.y = H + 6; b.x = Math.random() * W; }
    });

    drawScene(g);
    aqua.raf = requestAnimationFrame(stepAqua);
  }

  function startAqua() {
    var canvas = $('aquaCanvas');
    if (!canvas) return;
    var g0 = resizeAqua(canvas);
    aqua.fishes = buildFishes().map(function (f, i) {
      var z = 0.25 + Math.random() * 0.75;
      return {
        sp: f.sp, size: f.size, phase: i * 1.7, z: z,
        x: Math.random() * g0.w,
        y: 30 + z * (g0.h - 80) + Math.random() * 10,
        dir: Math.random() > 0.5 ? 1 : -1,
        speed: 0.2 + Math.random() * 0.35
      };
    });
    aqua.bubbles = [];
    for (var i = 0; i < 18; i++) {
      aqua.bubbles.push({
        x: Math.random() * g0.w, y: Math.random() * g0.h,
        r: 0.8 + Math.random() * 2.2, v: 0.25 + Math.random() * 0.5,
        seed: Math.random() * 1000, z: Math.random()
      });
    }
    aqua.plants = [];
    for (var k = 0; k < 7; k++) {
      aqua.plants.push({
        x: g0.w * (0.05 + k * 0.14) + (Math.random() * 12 - 6),
        h: 24 + Math.random() * 34, w: 1.6 + Math.random() * 1.4,
        phase: Math.random() * 6,
        color: ['#1d5a3f', '#256b4a', '#174a36'][k % 3]
      });
    }
    var hint = $('aquaHint');
    if (hint) {
      var got = Object.keys(unlockedMap()).length;
      hint.style.display = got ? 'none' : 'flex';
      hint.innerHTML = '<b>水族馆还是空的</b><p>拍照存档一条鱼，它就会游进这里。</p>';
    }
    if (document.body.classList.contains('perf')) {
      aqua.running = false;
      drawScene(resizeAqua(canvas));
      return;
    }
    cancelAnimationFrame(aqua.raf);
    aqua.running = true;
    stepAqua();
  }

  function stopAqua() {
    aqua.running = false;
    if (aqua.raf) cancelAnimationFrame(aqua.raf);
    aqua.raf = 0;
  }

  function renderAqua() {
    var accent = $('aquaCount');
    var un = unlockedMap(), db = window.SPECIES_DB || [];
    if (accent) accent.textContent = Object.keys(un).length + ' / ' + db.length + ' 种';
    if (st().tab === 'me') startAqua();
  }

  /* ---------------------------------------------------------------- 对外接口 */
  function render() {
    renderFav();
    renderCatch();
    renderAqua();
  }

  function onTab(name) {
    if (name === 'me') { startAqua(); renderFav(); renderCatch(); }
    else stopAqua();
  }

  function init() {
    var input = $('catchInput');
    if (input) {
      input.addEventListener('change', function () {
        var files = Array.prototype.slice.call(input.files || []).slice(0, 4);
        input.value = '';
        if (!files.length) return;
        var box = $('catchBody');
        if (box) box.innerHTML = '<p class="hint">正在压缩 ' + files.length + ' 张照片…</p>';
        Promise.all(files.map(compressImage)).then(function (urls) {
          openPicker(urls);
        }).catch(function (err) {
          if (box) box.innerHTML = '<p class="hint">照片处理失败：' + esc(err.message) + '</p>';
        });
      });
    }
    var imp = $('importInput');
    if (imp) {
      imp.addEventListener('change', function () {
        var f = imp.files && imp.files[0];
        imp.value = '';
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var payload;
            if (/json$/i.test(f.name)) payload = String(reader.result);
            else payload = readArchiveBuffer(reader.result);
            var r = importArchive(payload);
            alert('导入完成：新增 ' + r.added + ' 条、更新 ' + r.updated + ' 条，现有 ' + r.total +
              ' 条记录；常用地点新增 ' + r.places + ' 个。');
          } catch (e) {
            alert('导入失败：' + e.message);
          }
        };
        if (/json$/i.test(f.name)) reader.readAsText(f); else reader.readAsArrayBuffer(f);
      });
    }
    var saveBtn = $('btnSavePlace');
    if (saveBtn) saveBtn.addEventListener('click', saveCurrentPlace);
    window.addEventListener('resize', function () {
      if (st().tab === 'me') { stopAqua(); startAqua(); }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopAqua();
      else if (st().tab === 'me') startAqua();
    });
  }

  window.My = {
    init: init, render: render, onTab: onTab,
    renderFav: renderFav, renderCatch: renderCatch, renderAqua: renderAqua,
    saveCurrentPlace: saveCurrentPlace,
    catches: catches, favorites: favList, unlocked: function () { return Object.keys(unlockedMap()); },
    openCatchDetail: openCatchDetail, renderFav: renderFav,
    buildArchive: buildArchive, importArchive: importArchive, exportArchive: exportArchive,
    zipBuild: zipBuild, zipRead: zipRead, readArchiveBuffer: readArchiveBuffer
  };
})();
