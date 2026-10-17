/* LureCast service worker
   · 外壳（HTML/CSS/JS/图标）走缓存，但**升级时会换 CACHE 名字**，旧缓存在 activate 里删掉。
   · 页面导航（index.html）用 network-first：刷新就能拿到新版本，断网再退回缓存。
   · 静态资源用 cache-first + 后台更新：装过一次之后离线也能开。
   · 跨域接口（Open-Meteo / OSM / Sentinel-2 等）一律不进缓存，由 api.js 自己的分级缓存负责，
     保证「水文数据永远是最新一次成功请求」。 */
 var CACHE = 'lurecast-shell-v5';
var SHELL = [
  './', './index.html',
  './assets/theme.css', './assets/app.css',
  './assets/store.js', './assets/api.js', './assets/engine.js',
  './assets/sat.js', './assets/species.js', './assets/i18n.js',
  './assets/ai.js', './assets/my.js', './assets/share.js', './assets/app.js',
  './assets/vendor/geotiff.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        // 逐个 add，个别图标缺失不至于整批失败
        return Promise.all(SHELL.map(function (u) {
          return c.add(u).catch(function () { /* 单个失败不阻塞 */ });
        }));
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
  if (url.origin !== location.origin) return;

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

  // 静态资源：先缓存，同时后台更新
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
