/* LureCast · 统一图标系统
   ——————————————————————————————————————————————————————————————
   为什么要有这一层：之前图标是散在 index.html 里的 29 段内联 SVG，
   各自画法不同（有的描边 1.6、有的 2，圆角、留白、视觉重量都不一样），
   换配色时也只有一半能跟着 currentColor 走。现在统一成一套：
     · 24×24 网格，四周留 2px 安全边，纯描边、无填充
     · 线宽统一 1.7，端点为圆头（round），拐角圆滑
     · 颜色一律用 currentColor，跟着所在语义色走（--a1/--fam/--ok…）
   用法：
     静态：<i class="ic" data-icon="pin"></i>      → 启动时 Icons.paint() 填充
     动态：Icons.svg('wind', 'ic')                  → 返回字符串
   —————————————————————————————————————————————————————————————— */
(function () {
  'use strict';

  var P = {
    /* 顶栏 */
    search: '<circle cx="11" cy="11" r="6.6"/><path d="M15.9 15.9L20.5 20.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2' +
      'M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4"/>',
    ai: '<path d="M12 3.4l1.7 4.4 4.4 1.7-4.4 1.7L12 15.6l-1.7-4.4L5.9 9.5l4.4-1.7z"/>' +
      '<path d="M17.8 14.6l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/>',
    refresh: '<path d="M19.6 12a7.6 7.6 0 1 1-2.3-5.4"/><path d="M19.9 4.2v4.1h-4.1"/>',
    close: '<path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"/>',

    /* 卡片头 */
    pin: '<path d="M12 20.6c3.9-4 6-7.1 6-9.9a6 6 0 1 0-12 0c0 2.8 2.1 5.9 6 9.9z"/><circle cx="12" cy="10.4" r="2.2"/>',
    gauge: '<path d="M4.4 17a8.2 8.2 0 1 1 15.2 0"/><path d="M12 13.4l3.6-3.1"/><circle cx="12" cy="14.6" r="1.5"/>',
    clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.1 2"/>',
    cloud: '<path d="M7.2 16.8a3.6 3.6 0 0 1 .4-7.2 5 5 0 0 1 9.5 1.3 3.2 3.2 0 0 1-.6 5.9z"/>' +
      '<path d="M9.4 19.4l.9-1.6M13 19.6l.9-1.6"/>',
    wind: '<path d="M4 8.2h8.6a2.6 2.6 0 1 0-2.6-2.6"/><path d="M4 15.8h11.4a2.6 2.6 0 1 1-2.6 2.6"/><path d="M4 12h6.2"/>',
    water: '<path d="M4 8.4c2.6 0 2.6 1.8 5.3 1.8S12 8.4 14.7 8.4s2.6 1.8 5.3 1.8"/>' +
      '<path d="M4 13.6c2.6 0 2.6 1.8 5.3 1.8S12 13.6 14.7 13.6s2.6 1.8 5.3 1.8"/>',
    terrain: '<path d="M3.4 18.6l5.2-9 3.6 5.6 2.6-3.4 5.8 6.8z"/><path d="M3.4 18.6h17.2"/>',
    satellite: '<path d="M12 3.4l3.2 2.3v5.2L12 13.2 8.8 10.9V5.7z"/><path d="M8.8 10.9l-3 2.2v2.8l3 2.1"/>' +
      '<path d="M15.2 10.9l3 2.2v2.8l-3 2.1"/>',
    fish: '<path d="M3.6 12.2c3-3.4 7-4.6 10.4-3.4 2.2.8 4 2.4 5.4 4.4-1.6 1.6-4 2.8-6.6 2.8-3.4 0-6.6-1.6-9.2-3.8z"/>' +
      '<circle cx="9.6" cy="11.4" r=".9"/><path d="M17.4 8.6l2.6-2v11l-2.6-2"/>',
    map: '<path d="M9 4.2L3.6 6.4v13.4L9 17.6l6 2.2 5.4-2.2V4.2L15 6.4z"/><path d="M9 4.2v13.4M15 6.4v13.4"/>',
    bars: '<path d="M6 19.4V11M12 19.4V5.6M18 19.4v-5.6"/>',
    info: '<circle cx="12" cy="12" r="8.2"/><path d="M12 10.9v5.2M12 7.9v.7"/>',
    fishalt: '<path d="M4 12.6c2.8-3.2 6.6-4.2 9.8-3 2 .8 3.8 2.3 5 4.2-1.4 1.5-3.7 2.6-6.2 2.6-3.2 0-6.2-1.5-8.6-3.6z"/><path d="M7 15.6l-1.4 2.6"/>',

    /* 操作 */
    camera: '<rect x="3.2" y="6.4" width="17.6" height="12" rx="2.6"/><circle cx="9" cy="10.4" r="1.6"/>' +
      '<path d="M4 17.4l4.4-3.8 3 2.8 2.8-2.6L20 17.4"/>',
    locate: '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6"/>',
    expand: '<path d="M9.4 4.2H4.2v5.2"/><path d="M14.6 19.8h5.2v-5.2"/><path d="M19.8 9.4V4.2h-5.2"/><path d="M4.2 14.6v5.2h5.2"/>',
    shrink: '<path d="M4.2 9.4h5.2V4.2"/><path d="M19.8 14.6h-5.2v5.2"/><path d="M14.6 4.2v5.2h5.2"/><path d="M9.4 19.8v-5.2H4.2"/>',
    send: '<path d="M4 12L20 4.4l-6.2 15.2-2.6-6.4z"/><path d="M11.2 13.2L20 4.4"/>',
    copy: '<rect x="9" y="9" width="10.8" height="10.8" rx="2.4"/><path d="M15 5.6A2.6 2.6 0 0 0 12.4 3H6.6A2.6 2.6 0 0 0 4 5.6v5.8A2.6 2.6 0 0 0 6.6 14"/>',
    nav: '<path d="M12 3.6l6.6 16.8-6.6-4-6.6 4z"/>',
    check: '<path d="M5 12.8l4.4 4.2L19 6.6"/>',
    trash: '<path d="M4.6 7h14.8"/><path d="M9.4 7V5.2a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4V7"/>' +
      '<path d="M6.6 7l.9 12a1.6 1.6 0 0 0 1.6 1.4h5.8a1.6 1.6 0 0 0 1.6-1.4l.9-12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    chevron: '<path d="M7 10l5 5 5-5"/>'
  };

  function svg(name, cls) {
    var d = P[name];
    if (!d) return '';
    return '<svg class="' + (cls ? cls : 'ic-svg') + '" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  }

  /* 把 [data-icon] 填成对应图标；已经填过的跳过（避免重复重绘） */
  function paint(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-icon]'), function (el) {
      var name = el.getAttribute('data-icon');
      if (!name || el.getAttribute('data-painted') === name) return;
      el.innerHTML = svg(name);
      el.setAttribute('data-painted', name);
    });
  }

  window.Icons = { svg: svg, paint: paint, names: Object.keys(P) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { paint(); });
  else paint();
})();
