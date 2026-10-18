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

  /* ---------------------------------------------------------------- 钓点档案编辑器
     常用地点不只是坐标：名称、描述、图片（本机压到 480px，只存这台设备）。 */
  var placeEdit = { idx: -1, lat: 0, lon: 0, photos: [] };

  function defaultPlaceName() {
    var s = st(), p = s.place || {};
    return s.placeHint || p.name ||
      ('位置 ' + (s.me ? s.me.lat.toFixed(3) + ',' + s.me.lon.toFixed(3) : ''));
  }

  function renderPlacePhotos() {
    var box = $('placePhotos');
    if (!box) return;
    box.innerHTML = placeEdit.photos.map(function (u, i) {
      return '<div class="placephoto"><img src="' + u + '" alt="">' +
        '<button data-placephoto="' + i + '" title="删除这张">×</button></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-placephoto]'), function (b) {
      b.addEventListener('click', function () {
        placeEdit.photos.splice(parseInt(b.getAttribute('data-placephoto'), 10), 1);
        renderPlacePhotos();
      });
    });
  }

  function addPlacePhotos(files) {
    var arr = Array.prototype.slice.call(files || []).slice(0, 6);
    if (!arr.length) return;
    Promise.all(arr.map(compressImage)).then(function (urls) {
      placeEdit.photos = placeEdit.photos.concat(urls).slice(0, 6);
      renderPlacePhotos();
    }).catch(function (e) {
      UI.alert('图片处理失败：' + e.message, { title: '图片' });
    });
  }

  function openPlaceEditor(opts) {
    opts = opts || {};
    var list = favList();
    var fav = (typeof opts.idx === 'number' && opts.idx >= 0) ? list[opts.idx] : null;
    var s = st();
    placeEdit.idx = fav ? opts.idx : -1;
    placeEdit.lat = fav ? fav.lat : (opts.lat != null ? opts.lat : (s.me ? s.me.lat : 0));
    placeEdit.lon = fav ? fav.lon : (opts.lon != null ? opts.lon : (s.me ? s.me.lon : 0));
    placeEdit.photos = fav && fav.photos ? fav.photos.slice(0, 6) : [];
    if ($('placeName')) $('placeName').value = fav ? fav.name : (opts.name || defaultPlaceName());
    if ($('placeDesc')) $('placeDesc').value = fav ? (fav.desc || '') : (opts.desc || '');
    if ($('placeTitle')) $('placeTitle').textContent = fav ? '编辑钓点' : '保存钓点';
    if ($('placeCoordHint')) {
      $('placeCoordHint').textContent = '坐标 ' + placeEdit.lat.toFixed(5) + ', ' + placeEdit.lon.toFixed(5) +
        ' · WGS-84，名称/描述/图片都只存本机';
    }
    renderPlacePhotos();
    if (window.LureCast && window.LureCast.openModal) window.LureCast.openModal('modalPlace');
  }

  function savePlace() {
    var name = ($('placeName') ? $('placeName').value : '').trim();
    if (!name) { UI.alert('给这个钓点起个名字吧。', { title: '还差个名字' }); return; }
    var desc = ($('placeDesc') ? $('placeDesc').value : '').trim();
    var list = favList();
    if (placeEdit.idx >= 0 && list[placeEdit.idx]) {
      var f = list[placeEdit.idx];
      f.name = name.slice(0, 24);
      f.desc = desc.slice(0, 240);
      f.photos = placeEdit.photos.slice(0, 6);
    } else {
      list.unshift({
        id: 'f' + Date.now(), name: name.slice(0, 24), desc: desc.slice(0, 240),
        lat: placeEdit.lat, lon: placeEdit.lon, at: Date.now(), photos: placeEdit.photos.slice(0, 6)
      });
    }
    write(KEY_FAV, list.slice(0, 30));
    renderFav();
    renderCatch();
    if (window.LureCast && window.LureCast.closeModal) window.LureCast.closeModal('modalPlace');
    UI.toast(placeEdit.idx >= 0 ? '钓点已更新' : '已存为常用地点');
  }

  function saveCurrentPlace() {
    var s = st();
    if (!s.me) { UI.alert('还没有定位：先用 GPS 或「找水域」选一个地方。', { title: '先定位' }); return; }
    var list = favList();
    if (list.some(function (f) { return distM(f, s.me) < 120; })) {
      UI.alert('这个位置已经存过了（120 米内）。在列表里点「✎」可以补图片和描述。', { title: '重复地点' });
      return;
    }
    openPlaceEditor({ lat: s.me.lat, lon: s.me.lon });
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
      var thumb = (f.photos && f.photos.length)
        ? '<span class="favthumb"><img src="' + f.photos[0] + '" alt=""></span>' : '';
      return '<div class="favrow">' +
        '<button class="favgo" data-fav="' + i + '">' + thumb +
        '<span class="favtext">' +
        '<b><span class="favstars">★</span> ' + esc(f.name) + '</b>' +
        (f.desc ? '<em style="color:var(--ink-2)">' + esc(f.desc) + '</em>' : '') +
        '<em>' + f.lat.toFixed(4) + ', ' + f.lon.toFixed(4) +
        (d != null ? ' · 距 ' + (d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m') : '') +
        ' · 存于 ' + fmtDate(f.at).slice(5) +
        (nPhotos ? ' · ' + nPhotos + ' 张图' : '') + '</em></span></button>' +
        '<div class="favacts">' +
        '<button class="favdel" data-favedit="' + i + '" title="编辑名称/描述/图片">✎</button>' +
        '<button class="favdel" data-favdel="' + i + '" title="删除">×</button>' +
        '</div></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-fav]'), function (b) {
      b.addEventListener('click', function () {
        var f = favList()[parseInt(b.getAttribute('data-fav'), 10)];
        if (f && window.LureCast) window.LureCast.setMe(f.lat, f.lon, null, f.name, 'fav');
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-favedit]'), function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openPlaceEditor({ idx: parseInt(b.getAttribute('data-favedit'), 10) });
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-favdel]'), function (b) {
      b.addEventListener('click', function () {
        var i = parseInt(b.getAttribute('data-favdel'), 10);
        var list = favList();
        var f = list[i];
        if (!f) return;
        UI.confirm('删除常用地点「' + f.name + '」？', { title: '删除地点', danger: true, okText: '删除' }).then(function (ok) {
          if (!ok) return;
          list.splice(i, 1);
          write(KEY_FAV, list);
          renderFav();
          UI.toast('已删除');
        });
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
    if (!sp) { UI.alert('先选一个鱼种再保存。', { title: '还没选鱼种' }); return; }
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
    if (!ok) { UI.alert('本机存储已满，建议先删几条旧记录。', { title: '存不下了' }); return; }
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
    UI.confirm('删除这条「' + (sp ? sp.zh : r.sp) + '」记录？删了就找不回来。', { title: '删除渔获', danger: true, okText: '删除' }).then(function (ok) {
      if (!ok) return;
      list.splice(i, 1);
      write(KEY_CATCH, list);
      renderCatch();
      renderAqua();
      UI.toast('已删除');
    });
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
      '<button class="act primary" id="btnPickPhoto">拍照</button>' +
      '<button class="act ghost" id="btnPickAlbum">从相册选</button>' +
      '<button class="act ghost" id="btnExportArchive">导出档案</button>' +
      '<button class="act ghost" id="btnImportArchive">导入档案</button>' +
      '</div>';

    if (!list.length) {
      html += '<div class="empty"><b>还没有渔获档案</b>' +
        '<p>钓到鱼就拍一张，或从相册里选一张——照片只存这台设备，会记录当时的鱼种、尺寸、天气与鱼口指数。' +
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

    if ($('btnPickPhoto')) $('btnPickPhoto').addEventListener('click', function () { if ($('catchCamera')) $('catchCamera').click(); });
    if ($('btnPickAlbum')) $('btnPickAlbum').addEventListener('click', function () { if ($('catchInput')) $('catchInput').click(); });
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
          UI.alert('导出失败：' + msg, { title: '导出失败' });
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
      UI.alert('导出失败：' + e.message, { title: '导出失败' });
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
    var w = canvas.clientWidth || 320, h = canvas.clientHeight || 190;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    // 像素预算：全屏时 824×1400 这种画布在低端机/软件渲染上会掉到个位数帧率
    var budget = 430000;
    if (w * h * dpr * dpr > budget) dpr = Math.max(1, Math.sqrt(budget / (w * h)));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    aqua.dpr = dpr;
    return { w: w, h: h, ctx: ctx };
  }
  /* ---------------------------------------------------------------- 鱼形
     一条鱼长什么样，由「体征表」决定：体高/体长比、背腹弧度、尾形（叉/圆/方/月牙）、
     背鳍与臀鳍（硬棘/连续/靠后/脂鳍/帆状）、花纹（横斑/斑点/纵带/斑块/细点）、
     口位（上翘/大嘴/鸭嘴）与须。所以水族馆里游的是各自的鱼，不是同一个椭圆换颜色。 */
  var FORM_DEFAULT = {
    depth: 0.34, belly: 0.28, ped: 0.13, peakT: -0.02, peakB: 0.03,
    tail: 'fork', lobe: 3.6, tailLen: 0.40,
    dorsal: 'short', anal: 'short', mark: 'none', snout: 'mid'
  };

  /* 科级兜底：以后鱼种库加新鱼，没写体征也大致像它那一科 */
  var FORM_BY_FAMILY = {
    '鲤科': { depth: 0.36, belly: 0.30, dorsal: 'long', mark: 'none' },
    '鲈科': { depth: 0.32, dorsal: 'spiny', mark: 'bars' },
    '鲑科': { depth: 0.32, tail: 'square', adipose: true, mark: 'speckle' },
    '鲭科': { depth: 0.26, tail: 'lunate', finlet: true, mark: 'none' },
    '鲹科': { depth: 0.36, dorsal: 'short', mark: 'none' },
    '鮨科': { depth: 0.44, tail: 'round', dorsal: 'spiny', mark: 'spots', snout: 'big' },
    '鲶科': { depth: 0.28, tail: 'round', anal: 'long', mark: 'mottle', barbels: true, snout: 'wide' },
    '鲿科': { depth: 0.30, dorsal: 'spiny', adipose: true, mark: 'mottle', barbels: true, snout: 'wide' },
    '鳢科': { depth: 0.24, belly: 0.22, tail: 'round', dorsal: 'long', anal: 'long', mark: 'mottle', snout: 'wide' },
    '狗鱼科': { depth: 0.22, tail: 'fork', dorsal: 'far', anal: 'far', mark: 'spots', snout: 'duckbill' },
    '鲷科': { depth: 0.50, dorsal: 'spiny', dorsalH: 1.1, mark: 'bars' },
    '慈鲷科': { depth: 0.46, tail: 'round', dorsal: 'spiny', mark: 'bars' },
    '太阳鱼科': { depth: 0.42, dorsal: 'spiny', mark: 'lateral', snout: 'big' },
    '牙鲆科': { depth: 0.52, belly: 0.50, ped: 0.16, tail: 'round', dorsal: 'long', anal: 'long', mark: 'mottle', flat: true, snout: 'wide' },
    '军曹鱼科': { depth: 0.28, dorsal: 'spiny', mark: 'none' },
    '尖吻鲈科': { depth: 0.34, tail: 'round', dorsal: 'spiny', mark: 'none', snout: 'big' },
    '鲯鳅科': { depth: 0.38, dorsal: 'sail', mark: 'spots' },
    '狼鲈科': { depth: 0.30, dorsal: 'spiny', mark: 'none', snout: 'big' }
  };

  /* 逐种体征（覆盖科级兜底）。数值都是相对半体长 rx 的倍数 */
  var FISH_FORM = {
    bass: { depth: 0.42, belly: 0.34, dorsal: 'spiny', dorsalH: 0.95, mark: 'lateral', snout: 'big' },
    topmouth: { depth: 0.26, belly: 0.22, ped: 0.09, tail: 'lunate', lobe: 4.2, tailLen: 0.40, dorsal: 'short', mark: 'none', snout: 'up' },
    mandarin: { depth: 0.50, belly: 0.40, ped: 0.15, peakT: 0.08, peakB: 0.02, tail: 'round', dorsal: 'spiny', dorsalH: 0.80, mark: 'mottle', snout: 'big' },
    snakehead: { depth: 0.24, belly: 0.22, ped: 0.12, tail: 'round', dorsal: 'long', anal: 'long', mark: 'mottle', snout: 'wide' },
    zander: { depth: 0.28, ped: 0.10, tail: 'fork', lobe: 3.6, dorsal: 'spiny', adipose: true, mark: 'bars', snout: 'big', eyeShine: true },
    trout: { depth: 0.32, tail: 'square', dorsal: 'short', adipose: true, mark: 'speckle', band: '#e0869a' },
    chub: { depth: 0.28, ped: 0.10, tail: 'fork', mark: 'none' },
    bleeker: { depth: 0.30, belly: 0.24, ped: 0.09, tail: 'fork', lobe: 4.0, tailLen: 0.36, mark: 'none' },
    catfish: { depth: 0.26, tail: 'round', dorsal: 'short', anal: 'long', mark: 'mottle', barbels: true, snout: 'wide' },
    yellowcat: { depth: 0.28, tail: 'fork', dorsal: 'spiny', adipose: true, mark: 'mottle', barbels: true, snout: 'wide' },
    skygazer: { depth: 0.22, ped: 0.08, tail: 'fork', lobe: 3.4, dorsal: 'short', mark: 'none', snout: 'big' },
    tilapia: { depth: 0.48, belly: 0.40, tail: 'round', dorsal: 'spiny', mark: 'bars' },
    carp: { depth: 0.36, tail: 'fork', dorsal: 'long', mark: 'none', barbels: true },
    crucian: { depth: 0.48, belly: 0.42, tail: 'fork', dorsal: 'long', mark: 'none' },
    seabass: { depth: 0.30, tail: 'fork', dorsal: 'spiny', mark: 'none', snout: 'big' },
    blackporgy: { depth: 0.52, belly: 0.42, tail: 'fork', dorsal: 'spiny', dorsalH: 1.15, mark: 'bars' },
    grouper: { depth: 0.44, belly: 0.36, tail: 'round', dorsal: 'spiny', mark: 'spots', snout: 'big' },
    flatfish: { depth: 0.52, belly: 0.50, ped: 0.16, peakT: 0.04, tail: 'round', dorsal: 'long', anal: 'long', mark: 'mottle', flat: true, snout: 'wide' },
    spanishmackerel: { depth: 0.22, ped: 0.07, tail: 'lunate', lobe: 4.4, tailLen: 0.36, dorsal: 'short', finlet: true, mark: 'spots' },
    yellowtail: { depth: 0.30, tail: 'lunate', lobe: 3.6, tailLen: 0.34, dorsal: 'short', finlet: true, mark: 'none' },
    mahi: { depth: 0.38, tail: 'fork', dorsal: 'sail', mark: 'spots', snout: 'blunt' },
    barramundi: { depth: 0.34, tail: 'round', dorsal: 'spiny', mark: 'none', snout: 'big' },
    pike: { depth: 0.22, ped: 0.10, tail: 'fork', lobe: 3.2, dorsal: 'far', anal: 'far', mark: 'spots', snout: 'duckbill' },
    cobia: { depth: 0.28, tail: 'fork', dorsal: 'spiny', mark: 'none', snout: 'wide' },
    amberjack: { depth: 0.34, tail: 'fork', mark: 'band', band: '#e8c264' }
  };

  function formOf(sp) {
    var out = {}, src = [FORM_DEFAULT, FORM_BY_FAMILY[sp.family], FISH_FORM[sp.id]];
    for (var i = 0; i < src.length; i++) {
      var o = src[i];
      if (!o) continue;
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
    }
    return out;
  }

  function rnd(i) { var x = Math.sin(i * 127.1 + 3.7) * 43758.5453; return x - Math.floor(x); }

  /* 身体轮廓：吻端 → 背线 → 尾柄 → 腹线 */
  function bodyPath(ctx, rx, fm) {
    var top = rx * fm.depth, bot = rx * fm.belly, ped = rx * fm.ped;
    var peakT = rx * fm.peakT, peakB = rx * fm.peakB;
    var snout = rx * (fm.snout === 'duckbill' ? 1.16 : 0.97);
    ctx.beginPath();
    ctx.moveTo(snout, -top * 0.05);
    ctx.bezierCurveTo(rx * 0.58, -top * 0.78, peakT, -top, -rx * 0.30, -ped);
    ctx.lineTo(-rx * 0.42, -ped * 0.82);
    ctx.lineTo(-rx * 0.42, ped * 0.82);
    ctx.lineTo(-rx * 0.30, ped);
    ctx.bezierCurveTo(peakB, bot, rx * 0.58, bot * 0.78, snout, -top * 0.05);
    ctx.closePath();
  }

  /* 尾鳍：叉尾 / 月牙 / 圆尾 / 方尾 */
  function tailPath(ctx, rx, fm, wag) {
    var x0 = -rx * 0.42, ped = rx * fm.ped;
    var tl = rx * (fm.tailLen != null ? fm.tailLen : 0.30);
    var lobe = ped * (fm.lobe || 3.0);
    var t = fm.tail || 'fork';
    ctx.beginPath();
    if (t === 'round') {
      ctx.moveTo(x0, -ped);
      ctx.quadraticCurveTo(x0 - tl * 1.25, -lobe * 0.95 + wag, x0 - tl, wag * 0.8);
      ctx.quadraticCurveTo(x0 - tl * 1.25, lobe * 0.95 + wag, x0, ped);
    } else if (t === 'square') {
      ctx.moveTo(x0, -ped);
      ctx.lineTo(x0 - tl, -lobe * 0.85 + wag);
      ctx.lineTo(x0 - tl, lobe * 0.85 + wag);
      ctx.lineTo(x0, ped);
    } else {
      var deep = (t === 'lunate') ? 1.30 : 1.05;
      ctx.moveTo(x0, -ped);
      ctx.quadraticCurveTo(x0 - tl * 0.60, -lobe * 0.70 + wag * 0.5, x0 - tl * deep, -lobe + wag);
      ctx.quadraticCurveTo(x0 - tl * 0.40, wag * 0.35, x0 - tl * 0.34, wag * 0.18);
      ctx.quadraticCurveTo(x0 - tl * 0.40, wag * 0.35, x0 - tl * deep, lobe + wag);
      ctx.quadraticCurveTo(x0 - tl * 0.60, lobe * 0.70 + wag * 0.5, x0, ped);
    }
    ctx.closePath();
  }

  /* ---------------------------------------------------------------- 写实画鱼
     真实感靠分层，不靠更多形状：
       1) 轮廓：每种鱼按体征表生成（bodyPath / tailPath）
       2) 体色：背深腹浅的四段渐变 + 侧上方体积高光 + 腹部散射反光
       3) 鳞片：半圆鳞纹（只在中大型鱼身上出现）
       4) 结构：鳃盖弧、侧线、口裂
       5) 鳍：半透明膜 + 鳍条放射线 + 边缘描亮
       6) 眼：巩膜环 + 虹膜 + 瞳孔 + 高光点
       7) 环境：水中光斑扫过鱼身；远处的鱼用水色雾化 */
  var WATER_C = '#0e5a74';

  function toRGB(c) {
    c = String(c || '#8fa3b6');
    if (c.charAt(0) === '#') {
      var h = c.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      if (isFinite(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    var m = c.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : [140, 160, 180];
  }
  function rgbOf(a) { return 'rgb(' + Math.round(a[0]) + ',' + Math.round(a[1]) + ',' + Math.round(a[2]) + ')'; }
  function mixC(a, b, tt) {
    var x = toRGB(a), y = toRGB(b);
    return rgbOf([x[0] + (y[0] - x[0]) * tt, x[1] + (y[1] - x[1]) * tt, x[2] + (y[2] - x[2]) * tt]);
  }
  function tint(col, amt) {
    var x = toRGB(col), to = amt < 0 ? 0 : 255, p = Math.abs(amt);
    return rgbOf([x[0] + (to - x[0]) * p, x[1] + (to - x[1]) * p, x[2] + (to - x[2]) * p]);
  }

  /* 鳍的几何：轮廓 + 鳍条（鳍基 → 鳍缘的细线） */
  function quadFin(A, C, B, n) {
    var g = { rays: [] };
    g.draw = function (ctx) {
      ctx.beginPath();
      ctx.moveTo(A[0], A[1]);
      ctx.quadraticCurveTo(C[0], C[1], B[0], B[1]);
      ctx.closePath();
    };
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var bx = A[0] + (B[0] - A[0]) * t, by = A[1] + (B[1] - A[1]) * t;
      var px = (1 - t) * (1 - t) * A[0] + 2 * (1 - t) * t * C[0] + t * t * B[0];
      var py = (1 - t) * (1 - t) * A[1] + 2 * (1 - t) * t * C[1] + t * t * B[1];
      g.rays.push([bx, by, px, py]);
    }
    return g;
  }

  function finType(kind, rx, amp, hScale) {
    var h = amp * (hScale || 0.9);
    if (kind === 'spiny') {
      var x1 = rx * 0.30, x2 = -rx * 0.38, n = 6, g = { rays: [] };
      g.draw = function (ctx) {
        ctx.beginPath();
        ctx.moveTo(x1, -amp * 0.52);
        for (var i = 0; i <= n; i++) {
          var xa = x1 + (x2 - x1) * (i / n);
          var pk2 = -amp * 0.52 - h * (0.45 + 0.55 * Math.sin(Math.PI * (i + 0.5) / (n + 0.5)));
          ctx.lineTo(xa, pk2);
          ctx.lineTo(xa - (x1 - x2) / (n * 2.4), -amp * 0.42);
        }
        ctx.lineTo(x2, -amp * 0.38);
        ctx.closePath();
      };
      for (var j = 0; j <= n; j++) {
        var xb = x1 + (x2 - x1) * (j / n);
        var pk = -amp * 0.52 - h * (0.45 + 0.55 * Math.sin(Math.PI * (j + 0.5) / (n + 0.5)));
        g.rays.push([xb - (x1 - x2) / (n * 4), -amp * 0.46, xb, pk]);
      }
      return g;
    }
    if (kind === 'long') return quadFin([rx * 0.34, -amp * 0.42], [rx * 0.00, -amp * 0.60 - h], [-rx * 0.40, -amp * 0.30 - h * 0.55], 7);
    if (kind === 'sail') return quadFin([rx * 0.44, -amp * 0.30], [rx * 0.08, -amp * 0.55 - h * 2.1], [-rx * 0.36, -amp * 0.34], 8);
    if (kind === 'far') return quadFin([-rx * 0.16, -amp * 0.52], [-rx * 0.30, -amp * 0.52 - h * 0.85], [-rx * 0.44, -amp * 0.34], 4);
    if (kind === 'adipose') return quadFin([-rx * 0.20, -amp * 0.46], [-rx * 0.29, -amp * 0.46 - h * 0.75], [-rx * 0.36, -amp * 0.36], 3);
    return quadFin([rx * 0.08, -amp * 0.60], [-rx * 0.02, -amp * 0.60 - h * 0.95], [-rx * 0.22, -amp * 0.50], 7);
  }

  function strokeRays(ctx, rays, lw, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (var i = 0; i < rays.length; i++) {
      ctx.moveTo(rays[i][0], rays[i][1]);
      ctx.lineTo(rays[i][2], rays[i][3]);
    }
    ctx.stroke();
  }

  /* 半圆鳞纹：很淡，只提供质感 */
  function paintScales(ctx, rx, top, bot, color, a) {
    var stepX = rx * 0.20, stepY = rx * 0.17;
    ctx.strokeStyle = color;
    ctx.globalAlpha = a;
    ctx.lineWidth = Math.max(0.5, rx * 0.014);
    for (var row = 0; row * stepY < (top + bot) * 0.92; row++) {
      var y0 = -top * 0.86 + row * stepY;
      var off = (row % 2) * stepX * 0.5;
      for (var x0 = -rx * 0.42 + off; x0 < rx * 0.66; x0 += stepX) {
        ctx.beginPath();
        ctx.arc(x0, y0, stepX * 0.62, Math.PI * 0.12, Math.PI * 0.88);
        ctx.stroke();
      }
    }
  }

  /* 按体征画一条写实的鱼 */
  function drawFish(ctx, f, t, k) {
    var sp = f.sp, fm = f.fm || formOf(sp);
    var z = f.z;
    var L = (11 + f.size * 11) * (0.5 + z * 0.95) * (k || 1) * (f.vary || 1);
    var rx = L * 0.5;
    if (rx < 3) return;
    var top = rx * fm.depth, bot = rx * fm.belly, ped = rx * fm.ped;
    var wag = Math.sin(t * 0.0045 * f.speed + f.phase) * ped * 1.15;
    var alpha = 0.45 + z * 0.55;
    var perf = document.body.classList.contains('perf');

    // 远处的鱼用水色雾化，越远越像水里的剪影
    var fog = 0.45 * (1 - z);
    var bodyC = mixC(sp.color || '#9aa7b5', WATER_C, fog);
    var finC = mixC(sp.fin || '#7f93a6', WATER_C, fog);
    var backC = tint(bodyC, -0.45);
    var bellyC = tint(bodyC, 0.32);

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.dir, 1);
    ctx.globalAlpha = alpha;

    /* ---- 尾鳍：半透明膜 + 鳍条 ---- */
    var x0 = -rx * 0.42;
    var tl = rx * (fm.tailLen != null ? fm.tailLen : 0.40);
    var lobe = ped * (fm.lobe || 3.6);
    ctx.save();
    ctx.globalAlpha = alpha * 0.82;
    tailPath(ctx, rx, fm, wag);
    ctx.fillStyle = mixC(finC, '#dff4ff', 0.14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(214, 242, 255, .22)';
    ctx.lineWidth = Math.max(0.5, rx * 0.016);
    ctx.stroke();
    if (!perf) {
      ctx.save();
      tailPath(ctx, rx, fm, wag);
      ctx.clip();
      var tray = [];
      for (var ti = 0; ti <= 7; ti++) {
        var dy = (ti / 7 - 0.5) * 2;
        tray.push([x0, dy * ped, x0 - tl * (fm.tail === 'lunate' ? 1.25 : 1.02), dy * lobe * 0.92 + wag]);
      }
      strokeRays(ctx, tray, Math.max(0.5, rx * 0.012), 'rgba(230, 247, 255, .28)');
      ctx.restore();
    }
    ctx.restore();

    /* ---- 身体：影调（背线最深，体侧本色，腹面被散射提亮但不洗白） ---- */
    bodyPath(ctx, rx, fm);
    var bgrad = ctx.createLinearGradient(0, -top, 0, bot);
    var back2 = tint(bodyC, -0.55);
    bgrad.addColorStop(0, back2);
    bgrad.addColorStop(0.30, tint(bodyC, -0.18));
    bgrad.addColorStop(0.55, bodyC);
    bgrad.addColorStop(0.82, mixC(bodyC, bellyC, 0.45));
    // 贴地软阴影：把鱼从背景里「浮」出来
    if (!perf) {
      ctx.shadowColor = 'rgba(0, 12, 20, .38)';
      ctx.shadowBlur = rx * 0.34;
      ctx.shadowOffsetY = rx * 0.10;
    }
    ctx.fillStyle = bgrad;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    /* ---- 体表质感（裁在轮廓内） ---- */
    ctx.save();
    bodyPath(ctx, rx, fm);
    ctx.clip();

    var hg = ctx.createRadialGradient(rx * 0.08, -top * 0.55, rx * 0.04, rx * 0.08, -top * 0.42, rx);
    hg.addColorStop(0, 'rgba(255,255,255,.20)');
    hg.addColorStop(0.55, 'rgba(255,255,255,.05)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(-rx, -top, rx * 2.2, top + bot);

    var bgl = ctx.createLinearGradient(0, bot * 0.1, 0, bot);
    bgl.addColorStop(0, 'rgba(232,248,255,0)');
    bgl.addColorStop(1, 'rgba(232,248,255,.26)');
    ctx.fillStyle = bgl;
    ctx.fillRect(-rx, 0, rx * 2.2, bot);

    // 体侧长条镜面反光
    var sgm = ctx.createLinearGradient(-rx * 0.5, -top * 0.35, rx * 0.5, -top * 0.05);
    sgm.addColorStop(0, 'rgba(255,255,255,0)');
    sgm.addColorStop(0.45, 'rgba(255,255,255,.15)');
    sgm.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sgm;
    ctx.beginPath();
    ctx.ellipse(rx * 0.02, -top * 0.30, rx * 0.50, top * 0.11, -0.05, 0, Math.PI * 2);
    ctx.fill();

    // 背鳍根部阴影（接触阴影，鳍才不像贴纸）
    var ao = ctx.createLinearGradient(0, -top * 0.85, 0, -top * 0.30);
    ao.addColorStop(0, 'rgba(6,14,20,.22)');
    ao.addColorStop(1, 'rgba(6,14,20,0)');
    ctx.fillStyle = ao;
    ctx.fillRect(-rx, -top * 0.85, rx * 2, top * 0.55);

    if (!perf && z > 0.42 && rx > 11) paintScales(ctx, rx, top, bot, tint(bodyC, 0.35), 0.16 + z * 0.12);

    // 花纹
    if (fm.mark && fm.mark !== 'none') {
      if (fm.mark === 'bars') {
        ctx.fillStyle = 'rgba(12, 22, 32, .26)';
        for (var bi = 0; bi < 5; bi++) ctx.fillRect(rx * (0.42 - bi * 0.20) - rx * 0.035, -top, rx * 0.07, top + bot);
      } else if (fm.mark === 'spots') {
        ctx.fillStyle = 'rgba(14, 24, 34, .30)';
        for (var si = 0; si < 13; si++) {
          ctx.beginPath();
          ctx.arc(rx * (0.62 - rnd(si) * 1.05), (rnd(si + 7) - 0.5) * (top + bot) * 0.82,
            rx * (0.035 + rnd(si + 13) * 0.035), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (fm.mark === 'lateral') {
        ctx.fillStyle = 'rgba(12, 22, 32, .26)';
        ctx.beginPath();
        ctx.ellipse(-rx * 0.04, top * 0.08, rx * 0.62, top * 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (fm.mark === 'band') {
        ctx.fillStyle = fm.band || '#e8c264';
        ctx.globalAlpha = alpha * 0.5;
        ctx.beginPath();
        ctx.ellipse(-rx * 0.05, top * 0.06, rx * 0.66, top * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = alpha;
      } else if (fm.mark === 'mottle') {
        ctx.fillStyle = 'rgba(12, 22, 30, .26)';
        for (var mi = 0; mi < 7; mi++) {
          ctx.beginPath();
          ctx.ellipse(rx * (0.55 - rnd(mi + 21) * 0.90), (rnd(mi + 31) - 0.5) * (top + bot) * 0.78,
            rx * (0.06 + rnd(mi + 41) * 0.08), rx * (0.05 + rnd(mi + 51) * 0.06), rnd(mi) * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (fm.mark === 'speckle') {
        if (fm.band) {
          ctx.fillStyle = fm.band;
          ctx.globalAlpha = alpha * 0.32;
          ctx.beginPath();
          ctx.ellipse(-rx * 0.05, top * 0.02, rx * 0.70, top * 0.20, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = alpha;
        }
        ctx.fillStyle = 'rgba(14, 22, 30, .34)';
        for (var pi2 = 0; pi2 < 22; pi2++) {
          ctx.beginPath();
          ctx.arc(rx * (0.60 - rnd(pi2 + 3) * 1.05), (rnd(pi2 + 17) - 0.5) * (top + bot) * 0.86,
            rx * 0.022, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 鳃盖
    ctx.strokeStyle = 'rgba(10, 20, 30, .20)';
    ctx.lineWidth = Math.max(0.7, rx * 0.022);
    ctx.beginPath();
    ctx.moveTo(rx * 0.46, -top * 0.68);
    ctx.quadraticCurveTo(rx * 0.22, 0, rx * 0.32, bot * 0.60);
    ctx.stroke();

    // 侧线
    ctx.strokeStyle = 'rgba(236, 249, 255, .13)';
    ctx.lineWidth = Math.max(0.5, rx * 0.014);
    ctx.beginPath();
    ctx.moveTo(rx * 0.34, -top * 0.14);
    ctx.quadraticCurveTo(-rx * 0.08, -top * 0.02, -rx * 0.38, ped * 0.12);
    ctx.stroke();

    // 水中光斑扫过鱼身
    if (!perf) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var ci = 0; ci < 3; ci++) {
        var ox = Math.sin(t * 0.0011 + ci * 2.1 + f.phase) * rx * 1.1;
        var cg = ctx.createLinearGradient(ox - rx * 0.55, -top, ox + rx * 0.55, bot);
        cg.addColorStop(0, 'rgba(150,235,255,0)');
        cg.addColorStop(0.5, 'rgba(150,235,255,.13)');
        cg.addColorStop(1, 'rgba(150,235,255,0)');
        ctx.fillStyle = cg;
        ctx.fillRect(-rx, -top, rx * 2.2, top + bot);
      }
      ctx.restore();
    }
    ctx.restore();

    /* ---- 背鳍 ---- */
    var dg = finType(fm.dorsal || 'short', rx, top, fm.dorsalH != null ? fm.dorsalH : 1.15);
    ctx.save();
    ctx.globalAlpha = alpha * 0.9;
    dg.draw(ctx);
    var dgGrad = ctx.createLinearGradient(0, -top * 0.45, 0, -top * 0.45 - top * (fm.dorsalH != null ? fm.dorsalH : 1.15));
    dgGrad.addColorStop(0, mixC(finC, '#08161f', 0.28));
    dgGrad.addColorStop(1, mixC(finC, '#e8f8ff', 0.34));
    ctx.fillStyle = dgGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(216, 242, 255, .26)';
    ctx.lineWidth = Math.max(0.5, rx * 0.014);
    ctx.stroke();
    if (!perf) strokeRays(ctx, dg.rays, Math.max(0.5, rx * 0.011), 'rgba(232, 248, 255, .26)');
    ctx.restore();

    /* ---- 脂鳍 ---- */
    if (fm.adipose) {
      var ag = finType('adipose', rx, top, 0.6);
      ctx.save();
      ctx.globalAlpha = alpha * 0.8;
      ag.draw(ctx);
      ctx.fillStyle = finC;
      ctx.fill();
      ctx.restore();
    }

    /* ---- 臀鳍（向下，镜像绘制） ---- */
    if (fm.anal && fm.anal !== 'none') {
      var lg2 = finType(fm.anal, rx, bot, 0.62);
      ctx.save();
      ctx.scale(1, -1);
      ctx.globalAlpha = alpha * 0.88;
      lg2.draw(ctx);
    var agGrad = ctx.createLinearGradient(0, bot * 0.45, 0, bot * 0.45 + bot * 0.7);
    agGrad.addColorStop(0, mixC(finC, '#08161f', 0.28));
    agGrad.addColorStop(1, mixC(finC, '#e8f8ff', 0.30));
    ctx.fillStyle = agGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(216, 242, 255, .22)';
      ctx.lineWidth = Math.max(0.5, rx * 0.014);
      ctx.stroke();
      if (!perf) strokeRays(ctx, lg2.rays, Math.max(0.5, rx * 0.011), 'rgba(232, 248, 255, .22)');
      ctx.restore();
    }

    /* ---- 胸鳍 ---- */
    ctx.save();
    ctx.globalAlpha = alpha * 0.70;
    var pA = [rx * 0.30, top * 0.10], pC = [rx * 0.04, top * 0.66], pB = [-rx * 0.12, top * 0.16];
    ctx.beginPath();
    ctx.moveTo(pA[0], pA[1]);
    ctx.quadraticCurveTo(pC[0], pC[1], pB[0], pB[1]);
    ctx.closePath();
    ctx.fillStyle = mixC(finC, '#e8f8ff', 0.18);
    ctx.fill();
    if (!perf) {
      var pr = [];
      for (var qi = 0; qi <= 4; qi++) {
        var qt = qi / 4;
        pr.push([pA[0] + (pB[0] - pA[0]) * qt, pA[1] + (pB[1] - pA[1]) * qt,
          (1 - qt) * (1 - qt) * pA[0] + 2 * (1 - qt) * qt * pC[0] + qt * qt * pB[0],
          (1 - qt) * (1 - qt) * pA[1] + 2 * (1 - qt) * qt * pC[1] + qt * qt * pB[1]]);
      }
      strokeRays(ctx, pr, Math.max(0.5, rx * 0.010), 'rgba(232, 248, 255, .20)');
    }
    ctx.restore();

    /* ---- 眼睛 ---- */
    var ex = rx * 0.60, ey = -top * 0.18, er = Math.max(1.2, rx * 0.088);
    ctx.fillStyle = 'rgba(238, 248, 255, .94)';
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fm.eyeShine ? 'rgba(242, 205, 96, .96)' : 'rgba(30, 44, 58, .96)';
    ctx.beginPath();
    ctx.arc(ex, ey, er * 0.74, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#050a10';
    ctx.beginPath();
    ctx.arc(ex, ey, er * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath();
    ctx.arc(ex - er * 0.30, ey - er * 0.34, er * 0.24, 0, Math.PI * 2);
    ctx.fill();
    if (fm.flat) {
      ctx.fillStyle = '#050a10';
      ctx.beginPath();
      ctx.arc(ex - rx * 0.16, ey - top * 0.12, Math.max(1, er * 0.8), 0, Math.PI * 2);
      ctx.fill();
    }

    /* ---- 口 ---- */
    ctx.strokeStyle = 'rgba(8, 14, 22, .55)';
    ctx.lineWidth = Math.max(1, rx * 0.042);
    ctx.lineCap = 'round';
    ctx.beginPath();
    var mx = rx * (fm.snout === 'duckbill' ? 1.14 : 0.94);
    if (fm.snout === 'big') {
      ctx.moveTo(mx, -top * 0.02);
      ctx.quadraticCurveTo(mx - rx * 0.30, -top * 0.06, mx - rx * 0.44, top * 0.12);
    } else if (fm.snout === 'up') {
      ctx.moveTo(mx, -top * 0.12);
      ctx.quadraticCurveTo(mx - rx * 0.12, -top * 0.32, mx - rx * 0.22, -top * 0.40);
    } else if (fm.snout === 'duckbill') {
      ctx.moveTo(mx, top * 0.02);
      ctx.lineTo(mx - rx * 0.50, top * 0.02);
    } else {
      ctx.moveTo(mx, top * 0.02);
      ctx.lineTo(mx - rx * 0.18, top * 0.08);
    }
    ctx.stroke();

    /* ---- 须（鲶科 / 鲤科） ---- */
    if (fm.barbels) {
      ctx.strokeStyle = tint(bodyC, -0.15);
      ctx.lineWidth = Math.max(1, rx * 0.028);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(rx * 0.86, top * 0.06);
      ctx.quadraticCurveTo(rx * 1.16, top * 0.30, rx * 1.10, top * 0.64);
      ctx.moveTo(rx * 0.84, top * 0.10);
      ctx.quadraticCurveTo(rx * 1.02, top * 0.44, rx * 0.94, top * 0.74);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------- 水底背景
     参考实拍水下镜头（10 月翘嘴窗口期那条短片里的水下画面）：
       上段 = 从水下看到的水面（亮斑、同心涟漪、起伏高光）
       中段 = 青碧色水体 + 从水面斜射下来的光柱
       下段 = 砂与卵石河床（照片贴图）+ 稀疏细草 + 砂上的焦散光带
     静态部分只在尺寸变化时烘一张离屏背景；每帧只叠轻量动效 + 鱼。 */
  var SURF = 0.13;   // 水面带高度（占画布高）
  var BED = 0.66;    // 河床起始高度（占画布高）

  function buildBg(W, H) {
    var dpr = aqua.dpr || Math.min(2, window.devicePixelRatio || 1);
    var c = document.createElement('canvas');
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    var x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);

    var surfY = H * SURF, bedY = H * BED;

    // 水体：水面最亮，往下逐渐加深到青碧
    var grad = x.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#b6e9f2');
    grad.addColorStop(0.10, '#63c2d8');
    grad.addColorStop(0.26, '#2596b2');
    grad.addColorStop(0.46, '#177a95');
    grad.addColorStop(0.66, '#10637e');
    grad.addColorStop(0.86, '#0d5570');
    grad.addColorStop(1, '#0a4a60');
    x.fillStyle = grad;
    x.fillRect(0, 0, W, H);

    // 水面亮带（静态底；起伏与涟漪在 drawScene 里逐帧叠）
    var sg = x.createLinearGradient(0, 0, 0, surfY * 2.2);
    sg.addColorStop(0, 'rgba(228,251,255,.80)');
    sg.addColorStop(0.45, 'rgba(168,232,245,.32)');
    sg.addColorStop(1, 'rgba(140,215,236,0)');
    x.fillStyle = sg;
    x.fillRect(0, 0, W, surfY * 2.2);

    // 河床：实拍贴图（砂 + 卵石 + 稀疏细草）。按高度定比例、横向镜像平铺，
    // 这样 4:1 的宽卡片和竖屏全屏都不会把贴图拉成糊条。
    var bed = decorImg('bed-lake');
    if (bed) {
      // 先定「屏幕上卵石大概多大」，反推贴图该放大多少：
      // 竖屏全屏不能只有一颗石头，4:1 宽卡片也不能糊成砂纸。
      var pebPx = 12 * Math.max(0.85, Math.min(1.45, H / 420));
      var bedH = H - bedY;
      var scale = pebPx / 34;                       // 贴图里一颗卵石约 34px
      var srcH = Math.min(bed.height * 0.92, bedH / scale);
      scale = bedH / srcH;
      var srcY = bed.height - srcH;                 // 取贴图下部（近景砂石）
      var tileW = bed.width * scale;
      var drawn = 0, idx = 0;
      x.save();
      x.beginPath();
      x.rect(0, bedY - 2, W, bedH + 2);
      x.clip();
      while (drawn < W) {
        // 横向镜像交替 + 极小的上下错位，避免看出平铺的重复
        var jitter = (idx % 2 ? 1 : -1) * bedH * 0.012;
        x.save();
        if (idx % 2) { x.translate(drawn + tileW, 0); x.scale(-1, 1); }
        else { x.translate(drawn, 0); }
        x.drawImage(bed, 0, srcY, bed.width, srcH, 0, bedY + jitter, tileW, bedH + Math.abs(jitter) * 2);
        x.restore();
        drawn += tileW;
        idx++;
      }
      // 水色浸染：只轻轻压一层，别把砂石的对比压没
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = 'rgba(126,198,212,.38)';
      x.fillRect(0, bedY - (H - bedY) * 0.06, W, H - bedY + (H - bedY) * 0.06);
      x.restore();
      // 上缘渐隐：用水体在该高度的颜色起手（不透明），再化成透明，
      // 这样床带顶端不会留一条硬边。
      var bg2 = x.createLinearGradient(0, bedY - (H - bedY) * 0.10, 0, bedY + (H - bedY) * 0.55);
      bg2.addColorStop(0, 'rgba(16,99,126,1)');
      bg2.addColorStop(0.18, 'rgba(16,99,126,.92)');
      bg2.addColorStop(0.55, 'rgba(15,98,124,.45)');
      bg2.addColorStop(1, 'rgba(14,96,122,0)');
      x.fillStyle = bg2;
      x.fillRect(0, bedY - (H - bedY) * 0.10, W, (H - bedY) * 0.65);
      x.fillRect(0, bedY, W, (H - bedY) * 0.46);
    } else {
      // 贴图没解码好时退回程序化砂床，功能不依赖素材
      var sandTop = H - H * 0.16;
      var sgd = x.createLinearGradient(0, sandTop - 8, 0, H);
      sgd.addColorStop(0, 'rgba(120,170,170,0)');
      sgd.addColorStop(0.4, 'rgba(126,168,164,.85)');
      sgd.addColorStop(1, '#7d9d97');
      x.fillStyle = sgd;
      x.beginPath();
      x.moveTo(0, H);
      for (var sx2 = 0; sx2 <= W; sx2 += 10) x.lineTo(sx2, sandTop + Math.sin(sx2 * 0.03) * H * 0.012);
      x.lineTo(W, H);
      x.closePath();
      x.fill();
    }

    // 光柱（静态底）：从水面斜射到河床
    x.save();
    x.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 4; i++) {
      var bx = W * (0.15 + i * 0.24) + Math.sin(i * 2.7) * W * 0.02;
      var bw = W * (0.045 + 0.018 * Math.sin(i * 1.9 + 0.6));
      var lg = x.createLinearGradient(0, surfY * 0.6, 0, H * 0.98);
      lg.addColorStop(0, 'rgba(198,246,255,.13)');
      lg.addColorStop(0.5, 'rgba(178,238,252,.045)');
      lg.addColorStop(1, 'rgba(160,230,248,0)');
      x.fillStyle = lg;
      x.beginPath();
      x.moveTo(bx - bw, surfY * 0.6);
      x.lineTo(bx + bw, surfY * 0.6);
      x.lineTo(bx + bw * 3.1 + W * 0.05, H * 0.98);
      x.lineTo(bx - bw * 2.6 + W * 0.05, H * 0.98);
      x.closePath();
      x.fill();
    }
    x.restore();

    // 河床上的焦散网（静态底，逐帧再叠会动的那层）
    x.save();
    x.globalCompositeOperation = 'lighter';
    var ck = Math.max(0.8, W / 360);
    for (var q = 0; q < 10; q++) {
      var qx = W * ((q * 0.173 + 0.05) % 1);
      var qy = bedY + (H - bedY) * (0.22 + 0.7 * ((q * 0.311) % 1));
      var qr = (7 + (q % 4) * 3.5) * ck;
      x.globalAlpha = 0.30;
      x.drawImage(causticSprite(), qx - qr * 1.8, qy - qr * 0.5, qr * 3.6, qr);
    }
    x.globalAlpha = 1;
    x.restore();

    // 胶片颗粒烘进背景：省掉每帧一次 'overlay' 全屏混合
    var gp = x.createPattern(grainTile(), 'repeat');
    if (gp) {
      x.save();
      x.globalCompositeOperation = 'overlay';
      x.globalAlpha = 0.34;
      x.fillStyle = gp;
      x.fillRect(0, 0, W, H);
      x.restore();
    }
    return c;
  }

  /* 颗粒噪点贴图：只在首次生成，之后复用 */
  /* ---------------------------------------------------------------- 写实贴图
     25 种鱼的真实感照片是 ComfyUI 生成的（纯色背景 → 按键色差抠图 → 512px WebP）。
     贴图缺失或未解码完成时自动退回上面的矢量画法，功能不依赖素材。 */
  var SPRITES = {};
  function spriteOf(sp) {
    var s = SPRITES[sp.id];
    if (s === undefined) {
      s = new Image();
      s.decoding = 'async';
      s.src = 'assets/fish/' + sp.id + '.webp';
      SPRITES[sp.id] = s;
    }
    return (s.complete && s.naturalWidth) ? s : null;
  }

  /* 贴图鱼：切片错位模拟摆尾（头不动、尾摆幅最大），远处用模糊 + 低对比做景深 */
  function drawFishSprite(ctx, f, t, k, farPass) {
    var img = spriteOf(f.sp);
    if (!img) { drawFish(ctx, f, t, k); return; }
    var z = f.z;
    var perf = document.body.classList.contains('perf');
    var L = (16 + f.size * 15) * (0.55 + z * 0.95) * (k || 1) * (f.vary || 1);
    var H = L * img.height / img.width;
    var alpha = (0.45 + z * 0.55) * (farPass ? 0.92 : 1);
    var bob = Math.sin(t * 0.0011 * f.speed + f.phase) * H * 0.05;
    var tilt = Math.sin(t * 0.0009 * f.speed + f.phase) * 0.03;

    ctx.save();
    ctx.translate(f.x, f.y + bob);
    ctx.scale(f.dir, 1);
    ctx.rotate(tilt);
    ctx.globalAlpha = alpha;

    var lite = perf || aqua.lite;
    var blur = (farPass && !lite) ? (0.9 + (0.42 - z) * 2.4) * (k > 1.4 ? 1 : 0.55) : 0;
    if (blur > 0.15) ctx.filter = 'blur(' + blur.toFixed(2) + 'px)';

    if (lite || blur > 0.15) {
      ctx.drawImage(img, -L / 2, -H / 2, L, H);
    } else {
      // 身体一次画完；尾巴 6 段，各自绕前缘旋转 —— 是「摆」不是「平移」
      var tailFrom = 0.58;
      var bodyW = img.width * tailFrom;
      ctx.drawImage(img, 0, 0, bodyW, img.height, -L / 2, -H / 2, L * tailFrom + 0.8, H);
      var n = 6, sw = (img.width - bodyW) / n, dw = (L * (1 - tailFrom)) / n;
      for (var i = 0; i < n; i++) {
        var u = (i + 1) / n;
        var ang = Math.sin(t * 0.0048 * f.speed + f.phase - u * 2.1) * 0.22 * u * u;
        ctx.save();
        ctx.translate(-L / 2 + L * tailFrom + i * dw, 0);
        ctx.rotate(ang);
        ctx.drawImage(img, bodyW + i * sw, 0, sw, img.height, 0, -H / 2, dw + 1, H);
        ctx.restore();
      }
    }

    // 鳃盖开合：叠一层很淡的鳃区影像 + 一条细弧阴影，随呼吸轻微外张
    var br = 0.5 + 0.5 * Math.sin(t * 0.0075 * f.speed + f.phase);
    var gx = L * 0.20, gw = L * 0.11, gh = H * 0.42;
    if (!lite) {
      ctx.globalAlpha = alpha * (0.16 + 0.22 * br);
      ctx.drawImage(img, img.width * 0.615, img.height * 0.30, img.width * 0.11, img.height * 0.44,
        gx + gw * 0.08 * br, -gh / 2, gw * (1 + 0.08 * br), gh);
    }
    ctx.globalAlpha = alpha * (0.05 + 0.12 * br);
    ctx.strokeStyle = '#04121b';
    ctx.lineWidth = Math.max(0.6, L * 0.012);
    ctx.beginPath();
    ctx.moveTo(gx + gw * (0.92 + 0.08 * br), -gh * 0.46);
    ctx.quadraticCurveTo(gx + gw * (1.02 + 0.08 * br), 0, gx + gw * (0.92 + 0.08 * br), gh * 0.46);
    ctx.stroke();

    // 嘴：只在吻端一个小开合，配合呼吸节奏
    ctx.globalAlpha = alpha * (0.06 + 0.30 * br);
    ctx.fillStyle = '#04101a';
    ctx.beginPath();
    ctx.ellipse(L * 0.485, H * 0.045,
      Math.max(0.8, L * 0.017), Math.max(0.8, H * 0.020 * (0.30 + 0.70 * br)), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
    if (blur > 0.15) ctx.filter = 'none';
    ctx.restore();
  }
  /* 焦散光斑贴图：预渲染一次，之后每帧只做 drawImage（比每帧建径向渐变快得多） */
  var CAUSTIC = null;
  function causticSprite() {
    if (CAUSTIC) return CAUSTIC;
    var c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(64, 32, 0, 64, 32, 64);
    g.addColorStop(0, 'rgba(170, 236, 255, .26)');
    g.addColorStop(0.55, 'rgba(170, 236, 255, .10)');
    g.addColorStop(1, 'rgba(170, 236, 255, 0)');
    x.fillStyle = g;
    x.beginPath();
    x.ellipse(64, 32, 64, 32, 0, 0, Math.PI * 2);
    x.fill();
    CAUSTIC = c;
    return c;
  }
  function grainTile() {
    if (aqua.grain) return aqua.grain;
    var n = document.createElement('canvas');
    n.width = 96; n.height = 96;
    var gx = n.getContext('2d');
    var img = gx.createImageData(96, 96);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 110 + Math.random() * 145;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 24;
    }
    gx.putImageData(img, 0, 0);
    aqua.grain = n;
    return n;
  }

  /* ---------------------------------------------------------------- 素材
     河床是一张实拍贴图（ComfyUI 出的砂 + 卵石 + 稀疏细草）；前景细草是程序化画的，
     因为只有程序化的才能随水流摆。 */
  var DECOR = {};
  function decorImg(name) {
    var d = DECOR[name];
    if (d === undefined) {
      d = new Image();
      d.decoding = 'async';
      d.src = 'assets/fish/' + name + '.webp';
      DECOR[name] = d;
      // 解码完再让场景重烘一次背景（否则首帧会烘在没有贴图的版本上）；
      // 「性能优先」模式下没有逐帧循环，得手动补一帧。
      if (name === 'bed-lake') {
        d.onload = function () {
          aqua.bg = null;
          if (aqua.running) return;
          var cv = $('aquaCanvas');
          if (cv && st().tab === 'me') drawScene(resizeAqua(cv));
        };
      }
    }
    return (d.complete && d.naturalWidth) ? d : null;
  }

  /* 前景细草：从河床长出来，越高摆幅越大（4 段弯折，跟视频里那种窄叶草一个意思） */
  function drawWeeds(ctx, W, H, t, k) {
    if (!aqua.plants || !aqua.plants.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    aqua.plants.forEach(function (pl) {
      var h = pl.h * k;
      var base = (pl.base != null ? pl.base : H);
      var sway = Math.sin(t * 0.0011 + pl.phase) * h * 0.17;
      var grad = ctx.createLinearGradient(pl.x, base, pl.x, base - h);
      grad.addColorStop(0, 'rgba(22,70,50,.94)');
      grad.addColorStop(0.6, 'rgba(48,120,80,.82)');
      grad.addColorStop(1, 'rgba(104,172,116,.55)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = pl.w * Math.min(1.7, k);
      ctx.beginPath();
      ctx.moveTo(pl.x, base - 1);
      for (var s2 = 1; s2 <= 4; s2++) {
        var u = s2 / 4;
        ctx.lineTo(pl.x + sway * u * u, base - h * u);
      }
      ctx.stroke();
    });
    ctx.restore();
  }

  /* 水族馆场景：背景 → 水面 → 光柱 → 焦散 → 微粒 → 鱼 → 前景细草 → 收尾 */
  function drawScene(g) {
    var ctx = g.ctx, W = g.w, H = g.h, t = aqua.t;
    var k = Math.min(2.8, Math.max(0.95, Math.max(W, H) / 320));
    var perf = document.body.classList.contains('perf');
    var surfY = H * SURF, bedY = H * BED;
    // 鱼的大小跟画布高度走，不然 4:1 的宽卡片上鱼会大得离谱
    var fk = Math.max(0.8, Math.min(2.0, H / 190));

    // 背景：水色 + 河床贴图 + 光柱 + 焦散底，一次烘好反复用
    if (!aqua.bg || aqua.bg.w !== W || aqua.bg.h !== H) {
      aqua.bg = { c: buildBg(W, H), w: W, h: H };
    }
    ctx.drawImage(aqua.bg.c, 0, 0, W, H);

    // ---- 水面：起伏高光 + 同心涟漪（视频里最抢眼的就是这层水面）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var rows = perf ? 2 : (aqua.lite ? 3 : 5);
    for (var s = 0; s < rows; s++) {
      var yy = surfY * (0.16 + s * 0.20) + Math.sin(t * 0.0011 + s) * 1.6 * k;
      ctx.beginPath();
      for (var x = 0; x <= W; x += 10) {
        var y = yy + Math.sin(x * 0.035 + t * 0.0016 + s * 1.7) * 2.4 * k
                   + Math.sin(x * 0.011 - t * 0.0009) * 1.8 * k;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(216,250,255,' + (0.30 - s * 0.045).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, (2.2 - s * 0.35) * k);
      ctx.stroke();
    }
    var rings = perf ? 3 : (aqua.lite ? 5 : 9);
    for (var r = 0; r < rings; r++) {
      var cx = ((r * 0.37 + 0.08) % 1) * W + Math.sin(t * 0.0006 + r) * 6 * k;
      var cy = surfY * 0.30 + ((r * 0.23) % 1) * surfY * 0.62;
      var rr = (5 + ((t * 0.02 + r * 13) % 34)) * k * 0.55;
      ctx.globalAlpha = 0.13;
      ctx.strokeStyle = 'rgba(232,252,255,.75)';
      ctx.lineWidth = Math.max(0.8, 0.9 * k);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rr * 1.9, rr * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // ---- 光柱：从水面斜射下来（丁达尔），缓慢晃动
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var shafts = perf ? 2 : 3;
    for (var i2 = 0; i2 < shafts; i2++) {
      var bx = W * (0.14 + i2 * 0.24) + Math.sin(t * 0.0005 + i2 * 2.1) * W * 0.02;
      var bw = W * (0.05 + 0.02 * Math.sin(i2 * 2.1));
      var lg2 = ctx.createLinearGradient(0, surfY, 0, H * 0.92);
      lg2.addColorStop(0, 'rgba(190,246,255,.10)');
      lg2.addColorStop(0.55, 'rgba(170,235,250,.035)');
      lg2.addColorStop(1, 'rgba(150,225,245,0)');
      ctx.fillStyle = lg2;
      ctx.beginPath();
      ctx.moveTo(bx - bw * 0.9, surfY);
      ctx.lineTo(bx + bw * 0.9, surfY);
      ctx.lineTo(bx + bw * 2.2 + W * 0.05, H * 0.95);
      ctx.lineTo(bx - bw * 2.0 + W * 0.05, H * 0.95);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // ---- 河床上会动的焦散光带
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var n = perf ? 4 : (aqua.lite ? 6 : 14);
    for (var c2 = 0; c2 < n; c2++) {
      var cx2 = W * ((c2 * 0.137) % 1) + Math.sin(t * 0.0009 + c2) * 16 * k;
      var cy2 = bedY + (H - bedY) * (0.24 + 0.68 * ((c2 * 0.271) % 1)) + Math.cos(t * 0.0011 + c2 * 2.1) * 5 * k;
      var rr2 = (9 + Math.abs(Math.sin(t * 0.0015 + c2)) * 15) * k;
      ctx.globalAlpha = 0.42;
      ctx.drawImage(causticSprite(), cx2 - rr2 * 1.6, cy2 - rr2 * 0.45, rr2 * 3.2, rr2 * 0.9);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // ---- 悬浮微粒（水下那种细碎亮尘，比大气泡更像实拍）
    aqua.bubbles.forEach(function (b) {
      var br = Math.max(0.5, b.r * (0.45 + b.z * 0.5) * Math.min(1.5, k));
      ctx.globalAlpha = 0.10 + b.z * 0.30;
      ctx.fillStyle = 'rgba(228,250,255,.9)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, br, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // ---- 鱼：远 → 雾 → 近
    var sorted = aqua.fishes.slice().sort(function (a, b) { return a.z - b.z; });
    var far = [], near = [];
    sorted.forEach(function (f) { (f.z < 0.58 ? far : near).push(f); });
    far.forEach(function (f) { drawFishSprite(ctx, f, t, fk, true); });
    if (far.length && near.length) {
      // 中景水色薄雾：把远近拉开，跟视频里的能见度一个感觉
      ctx.fillStyle = 'rgba(16,104,132,.14)';
      ctx.fillRect(0, 0, W, H);
    }
    near.forEach(function (f) { drawFishSprite(ctx, f, t, fk, false); });

    // ---- 前景细草：挡在鱼前面，跟着水流摆
    drawWeeds(ctx, W, H, t, k);

    // ---- 收尾：河床底部一点点压暗 + 轻暗角（视频里四周也是稍暗的）
    var fg = ctx.createLinearGradient(0, H * 0.86, 0, H);
    fg.addColorStop(0, 'rgba(8, 46, 60, 0)');
    fg.addColorStop(1, 'rgba(6, 34, 46, .42)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, H * 0.86, W, H * 0.14);
    var vg = ctx.createRadialGradient(W * 0.5, H * 0.38, Math.min(W, H) * 0.34, W * 0.5, H * 0.5, Math.max(W, H) * 0.82);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(2,16,24,.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // 胶片颗粒已经烘进背景图（每帧做 'overlay' 混合在低端机上太贵），这里不再逐帧叠
  }

  function stepAqua() {
    var canvas = $('aquaCanvas');
    if (!canvas || !aqua.running) return;
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    // 自适应画质：连续掉帧就降级（少焦散、关模糊、鱼整条画），恢复后再升回去
    if (aqua.last) {
      var dt = now - aqua.last;
      aqua.avgDt = aqua.avgDt ? aqua.avgDt * 0.9 + dt * 0.1 : dt;
      aqua.frames = (aqua.frames || 0) + 1;
      if (aqua.frames > 30) {
        if (aqua.avgDt > 34) aqua.lite = true;
        else if (aqua.avgDt < 19) aqua.lite = false;
      }
    }
    aqua.last = now;
    var g = resizeAqua(canvas);
    var W = g.w, H = g.h;
    aqua.t += Math.min(48, aqua.last ? (aqua.avgDt || 16) : 16);

    // 鱼只在中上层活动：水面带下面、河床上面（视频里翘嘴也是贴中上层游）
    var topY = H * (SURF + 0.06), botY = H * (BED - 0.04);
    aqua.fishes.forEach(function (f) {
      var speed = (0.18 + f.z * 0.55) * (0.7 + f.size * 0.4);
      f.x += f.dir * speed;
      f.y += Math.sin(aqua.t * 0.0009 * (0.6 + f.z) + f.phase) * 0.12;
      if (f.y < topY) f.y = topY;
      if (f.y > botY) f.y = botY;
      if (f.dir > 0 && f.x > W + 60) { f.x = -60; f.y = topY + Math.random() * (botY - topY); }
      if (f.dir < 0 && f.x < -60) { f.x = W + 60; f.y = topY + Math.random() * (botY - topY); }
    });
    // 悬浮微粒：慢慢往上飘，飘出水面再从底部回来
    aqua.bubbles.forEach(function (b) {
      b.y -= b.v * (0.5 + b.z);
      b.x += Math.sin(aqua.t * 0.002 + b.seed) * 0.3;
      if (b.y < H * SURF * 0.5) { b.y = H * 0.98; b.x = Math.random() * W; }
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
        sp: f.sp, fm: formOf(f.sp), size: f.size, phase: i * 1.7, z: z, vary: 0.92 + Math.random() * 0.16,
        x: Math.random() * g0.w,
        y: g0.h * (SURF + 0.08) + Math.random() * g0.h * (BED - SURF - 0.12),
        dir: Math.random() > 0.5 ? 1 : -1,
        speed: 0.2 + Math.random() * 0.35
      };
    });
    // 预载素材：鱼贴图 + 河床贴图（本地文件，解码完就替换掉矢量画法）
    aqua.fishes.forEach(function (f) { spriteOf(f.sp); });
    decorImg('bed-lake');
    // 微粒与细草按水箱大小加密（全屏时别空得发慌）
    var sc = Math.min(2.2, Math.max(0.9, Math.max(g0.w, g0.h) / 380));
    aqua.bubbles = [];
    for (var i = 0; i < Math.round(26 * sc); i++) {
      aqua.bubbles.push({
        x: Math.random() * g0.w, y: Math.random() * g0.h,
        r: 0.7 + Math.random() * 1.8, v: 0.25 + Math.random() * 0.5,
        seed: Math.random() * 1000, z: Math.random()
      });
    }
    // 细草：两三丛、每丛 2-4 根窄叶，高度跟着画布走（视频里就是这种稀疏矮草，不是整片大水草）
    aqua.plants = [];
    var hk = Math.max(0.6, Math.min(1.8, g0.h / 260));
    var clumps = 3;
    for (var cg = 0; cg < clumps; cg++) {
      var clx = g0.w * (0.16 + cg * 0.34 + (Math.random() * 0.10 - 0.05));
      var clBase = g0.h * (BED + 0.03) + Math.random() * g0.h * 0.12;
      var blades = 2 + Math.floor(Math.random() * 3);
      for (var bd = 0; bd < blades; bd++) {
        aqua.plants.push({
          x: clx + (Math.random() * 2 - 1) * g0.w * 0.035,
          base: clBase + (Math.random() * 2 - 1) * g0.h * 0.03,
          h: (10 + Math.random() * 16) * hk,
          w: 0.8 + Math.random() * 0.7,
          phase: Math.random() * 6
        });
      }
    }
    var hint = $('aquaHint');
    if (hint) {
      var got = Object.keys(unlockedMap()).length;
      hint.style.display = got ? 'none' : 'flex';
      hint.innerHTML = '<b>水族馆还是空的</b><p>拍照存档一条鱼，它就会游进这里。</p>';
    }

    // 全屏时显示的鱼种图例：是什么鱼就写什么名，颜色对得上水里那条
    var lg = $('aquaLegend');
    if (lg) {
      var seen = {}, items = [];
      aqua.fishes.forEach(function (f) {
        if (seen[f.sp.id]) return;
        seen[f.sp.id] = 1;
        items.push(f.sp);
      });
      lg.innerHTML = items.map(function (sp) {
        return '<i><s style="background:' + (sp.color || '#8fa3b6') + '"></s>' + esc(sp.zh) + '</i>';
      }).join('');
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

  /* ---------------------------------------------------------------- 水族馆全屏
     与地图全屏同一套机制：卡片 .fs 固定铺满、body 锁滚动；退出三路（按钮 / ESC / 安卓返回）。 */
  function isAquaFull() {
    var c = $('cardAqua');
    return !!(c && c.classList.contains('fs'));
  }

  function aquaFull(on) {
    var card = $('cardAqua');
    if (!card) return;
    var want = (typeof on === 'boolean') ? on : !card.classList.contains('fs');
    card.classList.toggle('fs', want);
    document.body.classList.toggle('aquafs', want);
    // 画布按 clientWidth 每帧重算，所以只要让鱼重新布点即可（水草/气泡按新尺寸重排）
    if (want) startAqua();
    else if (st().tab === 'me') startAqua();
  }

  function onTab(name) {
    if (name === 'me') { startAqua(); renderFav(); renderCatch(); }
    else { if (isAquaFull()) aquaFull(false); stopAqua(); }
  }

  function bindPhotoInput(el) {
    if (!el) return;
    el.addEventListener('change', function () {
      var files = Array.prototype.slice.call(el.files || []).slice(0, 4);
      el.value = '';
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

  function bindPlaceInput(el) {
    if (!el) return;
    el.addEventListener('change', function () {
      addPlacePhotos(el.files);
      el.value = '';
    });
  }

  function init() {
    // 钓点档案编辑器
    if ($('btnPlaceSave')) $('btnPlaceSave').addEventListener('click', savePlace);
    if ($('btnPlaceAlbum')) $('btnPlaceAlbum').addEventListener('click', function () { if ($('placeAlbumInput')) $('placeAlbumInput').click(); });
    if ($('btnPlaceCamera')) $('btnPlaceCamera').addEventListener('click', function () { if ($('placeCameraInput')) $('placeCameraInput').click(); });
    bindPlaceInput($('placeAlbumInput'));
    bindPlaceInput($('placeCameraInput'));
    // 拍照走 capture input（直接起相机）；选图走普通 input（系统给出相册/文件选择）
    bindPhotoInput($('catchCamera'));
    bindPhotoInput($('catchInput'));
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
            UI.alert('导入完成：新增 ' + r.added + ' 条、更新 ' + r.updated + ' 条，现有 ' + r.total +
              ' 条记录；常用地点新增 ' + r.places + ' 个。', { title: '导入完成' });
          } catch (e) {
            UI.alert('导入失败：' + e.message, { title: '导入失败' });
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
    var aqBtn = $('btnAquaFull');
    if (aqBtn) aqBtn.addEventListener('click', function () { aquaFull(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopAqua();
      else if (st().tab === 'me') startAqua();
    });
  }

  window.My = {
    init: init, render: render, onTab: onTab,
    renderFav: renderFav, renderCatch: renderCatch, renderAqua: renderAqua,
    aquaFull: aquaFull, isAquaFull: isAquaFull,
    saveCurrentPlace: saveCurrentPlace,
    catches: catches, favorites: favList, unlocked: function () { return Object.keys(unlockedMap()); },
    openCatchDetail: openCatchDetail, renderFav: renderFav,
    openPlaceEditor: openPlaceEditor, savePlace: savePlace,
  };
})();
