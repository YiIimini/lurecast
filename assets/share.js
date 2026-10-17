/* LureCast · 坐标分享与外部导航
   ——————————————————————————————————————————————————————————————
   本应用所有经纬度都是 WGS-84（GPS / OpenStreetMap / Open-Meteo 口径）。
   高德要 GCJ-02（火星坐标），百度要 BD-09，本文件负责换算，调用方不用管。

   打开外部 App 的两条路径：
   · 原生壳（Capacitor）：先试 androidamap:// / baidumap:// 深链，App 没装时
     Android 会静默失败（Bridge.launchIntent 吞掉 ActivityNotFoundException）。
     所以用「是否切到后台」判断：1.4 s 内没切走就回落到网页版，
     网页版自带 callnative=1，装了就拉起 App，没装就是网页地图。
   · 纯网页：直接开网页版链接。
   —————————————————————————————————————————————————————————————— */
(function () {
  'use strict';

  var PI = Math.PI;
  var A = 6378245.0;              // 克拉索夫斯基椭球长半轴
  var EE = 0.00669342162296594323; // 第一偏心率平方

  function outOfChina(lat, lon) {
    return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }
  function tLat(x, y) {
    var r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    r += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return r;
  }
  function tLon(x, y) {
    var r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    r += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
    return r;
  }

  /* WGS-84 → GCJ-02 */
  function gcj02(lat, lon) {
    if (!isFinite(lat) || !isFinite(lon) || outOfChina(lat, lon)) return { lat: lat, lon: lon };
    var dLat = tLat(lon - 105.0, lat - 35.0);
    var dLon = tLon(lon - 105.0, lat - 35.0);
    var rad = lat / 180.0 * PI;
    var magic = Math.sin(rad);
    magic = 1 - EE * magic * magic;
    var sq = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sq) * PI);
    dLon = (dLon * 180.0) / (A / sq * Math.cos(rad) * PI);
    return { lat: lat + dLat, lon: lon + dLon };
  }

  /* WGS-84 → BD-09（先到 GCJ-02 再偏） */
  function bd09(lat, lon) {
    var g = gcj02(lat, lon);
    var z = Math.sqrt(g.lon * g.lon + g.lat * g.lat) + 0.00002 * Math.sin(g.lat * PI * 3000.0 / 180.0);
    var t = Math.atan2(g.lat, g.lon) + 0.000003 * Math.cos(g.lon * PI * 3000.0 / 180.0);
    return { lat: z * Math.sin(t) + 0.006, lon: z * Math.cos(t) + 0.0065 };
  }

  function fix(n) { return Number(n).toFixed(6); }
  function enc(s) { return encodeURIComponent(s == null ? '' : String(s)); }

  function isNative() {
    var c = window.Capacitor;
    return !!(c && c.isNativePlatform && c.isNativePlatform());
  }

  /* ---------------- 链接 ---------------- */
  function amapNavi(lat, lon, name) {           // 高德 App · 驾车导航到点
    var g = gcj02(lat, lon);
    return 'androidamap://navi?sourceApplication=lurecast&poiname=' + enc(name || '钓点') +
      '&lat=' + fix(g.lat) + '&lon=' + fix(g.lon) + '&dev=0&style=2';
  }
  function amapWeb(lat, lon, name) {            // 高德网页 · 驾车导航（callnative=1 装了 App 就拉起）
    var g = gcj02(lat, lon);
    return 'https://uri.amap.com/navigation?to=' + fix(g.lon) + ',' + fix(g.lat) + ',' + enc(name || '钓点') +
      '&mode=car&policy=1&src=lurecast&coordinate=gaode&callnative=1';
  }
  function amapMarker(lat, lon, name) {         // 高德网页 · 只看点位（分享时用，链接短）
    var g = gcj02(lat, lon);
    return 'https://uri.amap.com/marker?position=' + fix(g.lon) + ',' + fix(g.lat) +
      '&name=' + enc(name || '钓点') + '&src=lurecast&coordinate=gaode&callnative=1';
  }
  function baiduNavi(lat, lon, name) {          // 百度 App · 驾车导航到点
    var b = bd09(lat, lon);
    return 'baidumap://map/direction?destination=latlng:' + fix(b.lat) + ',' + fix(b.lon) +
      '|name:' + enc(name || '钓点') + '&coord_type=bd09ll&mode=driving&src=webapp.lurecast';
  }
  function baiduWeb(lat, lon, name) {
    var b = bd09(lat, lon);
    return 'https://api.map.baidu.com/direction?destination=latlng:' + fix(b.lat) + ',' + fix(b.lon) +
      '|name:' + enc(name || '钓点') + '&mode=driving&coord_type=bd09ll&output=html&src=webapp.lurecast';
  }
  function osmLink(lat, lon) {
    return 'https://www.openstreetmap.org/?mlat=' + fix(lat) + '&mlon=' + fix(lon) +
      '#map=16/' + fix(lat) + '/' + fix(lon);
  }

  /* 分享给聊天 App 的纯文本（微信/QQ 里点高德链接能直接起 App） */
  function shareText(lat, lon, name) {
    var g = gcj02(lat, lon);
    var lines = [];
    if (name) lines.push(name);
    lines.push('坐标 ' + Number(lat).toFixed(5) + ', ' + Number(lon).toFixed(5) + '（WGS-84）');
    lines.push('高德坐标 ' + g.lat.toFixed(5) + ', ' + g.lon.toFixed(5) + '（GCJ-02）');
    lines.push('高德地图 ' + amapMarker(lat, lon, name));
    lines.push('OSM 地图 ' + osmLink(lat, lon));
    return lines.join('\n');
  }

  /* 打开外部链接：原生壳深链 + 回落；网页版直接跳 */
  function open(url, fallback) {
    if (!isNative() || !fallback) { window.location.href = url; return 'web'; }
    var left = false;
    var onVis = function () { if (document.visibilityState === 'hidden') left = true; };
    document.addEventListener('visibilitychange', onVis);
    try { window.location.href = url; } catch (e) { /* 忽略 */ }
    setTimeout(function () {
      document.removeEventListener('visibilitychange', onVis);
      // 还停在本页 = 深链没被接住（App 没装），换成网页版
      if (!left && document.visibilityState !== 'hidden') window.location.href = fallback;
    }, 1400);
    return 'deep';
  }

  function navAmap(lat, lon, name) { return open(amapNavi(lat, lon, name), amapWeb(lat, lon, name)); }
  function navBaidu(lat, lon, name) { return open(baiduNavi(lat, lon, name), baiduWeb(lat, lon, name)); }

  /* 系统分享面板（原生走 Capacitor Share，网页走 Web Share） */
  function share(lat, lon, name) {
    var text = shareText(lat, lon, name);
    var cap = window.Capacitor;
    var P = cap && cap.Plugins && cap.Plugins.Share;
    if (P && P.share) {
      return P.share({ title: '路亚钓点坐标', text: text, dialogTitle: '分享位置' })
        .then(function () { return 'native'; })
        .catch(function () { return copy(text).then(function () { return 'copy'; }); });
    }
    if (navigator.share) {
      return navigator.share({ title: '路亚钓点坐标', text: text })
        .then(function () { return 'web'; })
        .catch(function () { return 'cancel'; });
    }
    return copy(text).then(function () { return 'copy'; });
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e) { return false; }
  }

  window.CoShare = {
    gcj02: gcj02, bd09: bd09,
    amapNavi: amapNavi, amapWeb: amapWeb, amapMarker: amapMarker,
    baiduNavi: baiduNavi, baiduWeb: baiduWeb, osmLink: osmLink,
    shareText: shareText, navAmap: navAmap, navBaidu: navBaidu,
    share: share, copy: copy, open: open
  };
})();
