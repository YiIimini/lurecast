/* LureCast service worker（新壳，P4）
   ---------------------------------------------------------------------------
   与老壳的三条策略一致，但**清单不再手写**：
     · install 时先缓存核心外壳，再解析 index.html 里打包出来的哈希资源（JS/CSS/贴图）一起预缓存；
     · 页面导航用 network-first：刷新就能拿到新版本，断网退回缓存；
     · 同源静态资源 cache-first + 后台更新；
     · 跨域接口（Open-Meteo / Overpass / Sentinel-2 / 瓦片）一律不进缓存，由 api 层自己管 TTL。
   升级：CACHE 名字带版本号，activate 时删掉旧缓存。 */

var CACHE = 'lurecast-shell-v27';
var CORE = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

/* 从 index.html 里扒出构建产物（带 hash 的 js/css/图片），清单自动生成 */
function precacheFromHtml(c) {
  return fetch('./index.html', { cache: 'no-store' })
    .then(function (res) { return res.ok ? res.text() : ''; })
    .then(function (html) {
      if (!html) return [];
      var re = /(?:href|src)="([^"]+\.(?:js|css|webp|png|svg))"/g;
      var seen = {};
      var m;
      while ((m = re.exec(html))) {
        var u = m[1];
        if (u.indexOf('http') === 0 || u.indexOf('//') === 0) continue;
        if (seen[u]) continue;
        seen[u] = 1;
      }
      return Object.keys(seen);
    })
    .catch(function () { return []; })
    .then(function (urls) {
      return Promise.all(urls.map(function (u) {
        return c.add(u).catch(function () { /* 单个失败不阻塞 */ });
      }));
    });
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        return Promise.all(CORE.map(function (u) {
          return c.add(u).catch(function () { /* 个别图标缺失不至于整批失败 */ });
        })).then(function () { return precacheFromHtml(c); });
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;   // 跨域接口不进缓存

  // 导航请求：先网络（拿新版），失败再用缓存（离线）
  if (req.mode === 'navigate' || url.pathname === '/' || /\.html$/.test(url.pathname)) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
      })
    );
    return;
  }

  // 同源静态资源：先缓存，同时后台更新
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
