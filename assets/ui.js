/* LureCast · 自绘 UI 组件
   ——————————————————————————————————————————————————————————————
   目的：应用里不再出现系统原生弹窗（alert / confirm / prompt）和原生 <select> 下拉，
   全部换成与应用同一套磨砂卡片语言的自绘组件。原生弹窗在安卓 WebView 里：
     · 样式完全不受控（浅灰方框、系统字体、圆角与配色都跟应用不搭）；
     · confirm 会阻塞整个 WebView 线程，动画和计时器全停；
     · select 在桌面上是浮层，在手机上直接弹全屏系统列表，行为和界面都不一致。
   接口：
     UI.alert(text, opts)            → Promise<void>
     UI.confirm(text, opts)          → Promise<boolean>
     UI.prompt(text, value, opts)    → Promise<string|null>
     UI.sheet(list, opts)            → Promise<选中的值|null>   通用选择器
     UI.enhance(selectEl)            → 把一个 <select> 变自绘下拉（就地替换）
     UI.toast(text, kind)            → 轻提示（转发到 app.js 的 toast）
   opts 通用：{ title, okText, cancelText, danger, multiline, placeholder }
   —————————————————————————————————————————————————————————————— */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------------------------------------------------------- 宿主容器 */
  function host() {
    var m = $('uiModal');
    if (m) return m;
    m = document.createElement('div');
    m.className = 'modal hidden';
    m.id = 'uiModal';
    m.innerHTML = '<div class="modal-box uibox">' +
      '<div class="modal-head"><h3 id="uiTitle">提示</h3>' +
      '<button class="act ghost" id="uiX">关闭</button></div>' +
      '<div class="modal-body" id="uiBody"></div>' +
      '<div class="modal-foot uifoot" id="uiFoot"></div>' +
      '</div>';
    document.body.appendChild(m);
    return m;
  }

  var closer = null;

  function open(opts) {
    opts = opts || {};
    var m = host();
    $('uiTitle').textContent = opts.title || '提示';
    $('uiBody').innerHTML = opts.html || '';
    $('uiFoot').innerHTML = opts.foot || '';
    m.classList.remove('hidden');
    return m;
  }

  function close() {
    var m = $('uiModal');
    if (m) m.classList.add('hidden');
    if (closer) { var f = closer; closer = null; f(); }
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'uiX' || (t.getAttribute && t.getAttribute('data-uiclose') !== null && t.closest('#uiModal'))) {
      close();
    }
  }, true);

  /* ---------------------------------------------------------- 基础三件套 */
  function alertBox(text, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var html = '<p class="uimsg">' + esc(text) + '</p>';
      open({
        title: opts.title || '提示', html: html,
        foot: '<button class="act primary" id="uiOk">' + esc(opts.okText || '知道了') + '</button>'
      });
      var done = function () { close(); resolve(); };
      $('uiOk').addEventListener('click', done);
      closer = resolve;
      $('uiOk').focus();
    });
  }

  function confirmBox(text, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      open({
        title: opts.title || '确认',
        html: '<p class="uimsg">' + esc(text) + '</p>',
        foot: '<button class="act ghost" id="uiNo">' + esc(opts.cancelText || '取消') + '</button>' +
          '<button class="act ' + (opts.danger ? 'danger' : 'primary') + '" id="uiYes">' +
          esc(opts.okText || '确定') + '</button>'
      });
      var fin = function (v) { closer = null; close(); resolve(v); };
      closer = function () { resolve(false); };
      $('uiYes').addEventListener('click', function () { fin(true); });
      $('uiNo').addEventListener('click', function () { fin(false); });
      $('uiYes').focus();
    });
  }

  function promptBox(text, value, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var field = opts.multiline
        ? '<textarea id="uiInput" rows="3" placeholder="' + esc(opts.placeholder || '') + '">' + esc(value || '') + '</textarea>'
        : '<input id="uiInput" value="' + esc(value || '') + '" placeholder="' + esc(opts.placeholder || '') + '" autocomplete="off">';
      open({
        title: opts.title || '请输入',
        html: '<label class="uilabel">' + esc(text) + '</label>' + field,
        foot: '<button class="act ghost" id="uiNo">取消</button>' +
          '<button class="act primary" id="uiYes">' + esc(opts.okText || '确定') + '</button>'
      });
      var inp = $('uiInput');
      var fin = function (v) { closer = null; close(); resolve(v); };
      closer = function () { resolve(null); };
      $('uiYes').addEventListener('click', function () { fin(inp.value.trim()); });
      $('uiNo').addEventListener('click', function () { fin(null); });
      if (!opts.multiline) {
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); fin(inp.value.trim()); }
        });
      }
      setTimeout(function () { inp.focus(); inp.select && inp.select(); }, 60);
    });
  }

  /* ---------------------------------------------------------- 通用选择器 */
  function sheet(list, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var html = '<div class="uisheet">' + list.map(function (it, i) {
        var v = typeof it === 'string' ? it : it.value;
        var label = typeof it === 'string' ? it : (it.label || it.value);
        var sub = (typeof it === 'object' && it.sub) ? '<em>' + esc(it.sub) + '</em>' : '';
        var on = opts.value != null && String(v) === String(opts.value) ? ' on' : '';
        return '<button class="uiopt' + on + '" data-i="' + i + '">' + esc(label) + sub + '</button>';
      }).join('') + '</div>';
      open({
        title: opts.title || '选择',
        html: html,
        foot: '<button class="act ghost" id="uiNo">取消</button>'
      });
      var fin = function (v) { closer = null; close(); resolve(v); };
      closer = function () { resolve(null); };
      Array.prototype.forEach.call(document.querySelectorAll('#uiBody .uiopt'), function (b) {
        b.addEventListener('click', function () {
          var it = list[parseInt(b.getAttribute('data-i'), 10)];
          fin(typeof it === 'string' ? it : it.value);
        });
      });
      $('uiNo').addEventListener('click', function () { fin(null); });
    });
  }

  /* ---------------------------------------------------------- <select> → 自绘下拉 */
  function enhance(sel) {
    if (!sel || sel.__uiEnhanced) return sel;
    sel.__uiEnhanced = true;
    sel.classList.add('uisource');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'uiselect';
    btn.innerHTML = '<span class="uiselect-t"></span><svg viewBox="0 0 24 24" class="uiselect-i"><path d="M6 9l6 6 6-6"/></svg>';
    sel.parentNode.insertBefore(btn, sel.nextSibling);
    var sync = function () {
      var o = sel.options[sel.selectedIndex];
      btn.querySelector('.uiselect-t').textContent = o ? o.textContent : '请选择';
      btn.disabled = sel.disabled;
    };
    btn.addEventListener('click', function () {
      var list = Array.prototype.map.call(sel.options, function (o) {
        return { value: o.value, label: o.textContent };
      });
      sheet(list, { title: sel.getAttribute('data-title') || '选择' }).then(function (v) {
        if (v == null) return;
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
      });
    });
    sync();
    // 程序里改了 options / value 时同步按钮文案
    if (window.MutationObserver) {
      new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true });
    }
    sel.addEventListener('change', sync);
    return sel;
  }

  function enhanceAll(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('select:not(.uisource)'), enhance);
  }

  function toast(text, kind) {
    if (window.LureCast && window.LureCast.toast) { window.LureCast.toast(text, kind); return; }
    var el = $('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('on');
    setTimeout(function () { el.classList.remove('on'); }, 1900);
  }

  window.UI = {
    alert: alertBox, confirm: confirmBox, prompt: promptBox, sheet: sheet,
    enhance: enhance, enhanceAll: enhanceAll, toast: toast, close: close
  };
})();
