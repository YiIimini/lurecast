/* LureCast · 存储层（IndexedDB 同步门面）—— 由 assets/store.js 机械迁移（P0/P1 阶段不改行为）
   对外接口与 localStorage 一致：getItem/setItem/removeItem/keys/bytes/clearCache/exportAll/importAll/info/flush */
// @ts-nocheck
const win: any = typeof window !== 'undefined' ? window : (globalThis as any)
const doc: any = typeof document !== 'undefined' ? document : { addEventListener() {}, hidden: false }
/* ============================================================================
   LureCast 存储层：IndexedDB（容量大、适合照片与卫星快照），对外仍是同步接口
   ----------------------------------------------------------------------------
   为什么这么做：本应用几乎所有读写都发生在渲染/计算的同步路径里（缓存读取、
   快照回填、设置读取），全改成 async 会把代码翻一遍；而 localStorage 只有
   5 MB，渔获照片（每条 4 张 480px data URL）+ 卫星快照很快就会撞上限。
   做法 = 「内存镜像 + IndexedDB 落盘」：
     · 启动时把整库读进内存（几 MB 量级，毫秒级），之后 getItem 走内存，同步；
     · setItem 先写内存并立刻返回，落盘由 100 ms 批次合并写到 IndexedDB；
     · 老版本的 localStorage 数据在首次启动时自动搬过来，搬完删掉腾出配额；
     · IndexedDB 不可用（隐私模式/老内核）时自动退回 localStorage，功能不降级。
   对上层暴露 win.Store，接口与 localStorage 基本一致。
   ============================================================================ */

  var DB_NAME = 'lurecast';
  var DB_VER = 1;
  var OBJECT = 'kv';
  var MIGRATED_FLAG = 'lc:ls-migrated';

  var mem = Object.create(null);      // 内存镜像：键 -> 字符串值
  var db = null;                      // IDBDatabase，失败时保持 null
  var backend = 'idb';                // idb | ls | memory
  var migratedCount = 0;              // 本次从 localStorage 搬过来的条目数
  var dirty = Object.create(null);    // 待落盘的键（合并高频写）
  var flushTimer = 0;
  var readyResolve;
  var ready = new Promise(function (res) { readyResolve = res; });

  /* ---------------------------------------------------------------- 底层 */
  function lsGet(k) {
    try { return win.localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { win.localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }
  function lsDel(k) {
    try { win.localStorage.removeItem(k); } catch (e) { /* 忽略 */ }
  }
  function lsKeys() {
    var out = [];
    try {
      for (var i = 0; i < win.localStorage.length; i++) out.push(win.localStorage.key(i));
    } catch (e) { /* 忽略 */ }
    return out;
  }

  function openDB() {
    return new Promise(function (res) {
      var req;
      try { req = win.indexedDB.open(DB_NAME, DB_VER); } catch (e) { return res(null); }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(OBJECT)) d.createObjectStore(OBJECT);
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { res(null); };
      req.onblocked = function () { res(null); };
    });
  }

  function readAll(d) {
    return new Promise(function (res) {
      var out = Object.create(null);
      var t;
      try { t = d.transaction(OBJECT, 'readonly'); } catch (e) { return res(out); }
      var store = t.objectStore(OBJECT);
      var cur = store.openCursor();
      cur.onsuccess = function () {
        var c = cur.result;
        if (c) { out[c.key] = c.value; c.continue(); }
      };
      t.oncomplete = function () { res(out); };
      t.onerror = function () { res(out); };
      t.onabort = function () { res(out); };
    });
  }

  function writeBatch(pairs) {
    if (!db || !pairs.length) return;
    var t;
    try { t = db.transaction(OBJECT, 'readwrite'); } catch (e) { return; }
    var store = t.objectStore(OBJECT);
    pairs.forEach(function (p) {
      if (p.value === null) store.delete(p.key);
      else store.put(p.value, p.key);
    });
  }

  /* 把 dirty 里的键合并成一次事务写下去 */
  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
    var pairs = [];
    for (var k in dirty) { pairs.push({ key: k, value: dirty[k] }); delete dirty[k]; }
    if (pairs.length) writeBatch(pairs);
  }
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 100);
  }

  /* ---------------------------------------------------------------- 迁移 */
  function migrate() {
    var keys = lsKeys();
    if (!keys.length) return;
    if (mem[MIGRATED_FLAG]) return;         // 之前搬过就不再搬，避免把已删掉的旧值又拉回来
    var moved = [];
    keys.forEach(function (k) {
      if (k === MIGRATED_FLAG) return;
      if (k.slice(0, 3) !== 'lc:') return;  // 只认本应用自己的键
      var v = lsGet(k);
      if (v == null) return;
      if (mem[k] != null) return;           // 库里已有（更新的）值优先
      mem[k] = v;
      moved.push(k);
      dirty[k] = v;
    });
    mem[MIGRATED_FLAG] = '1';
    dirty[MIGRATED_FLAG] = '1';
    migratedCount = moved.length;
    flush();
    // 确认之后清掉旧数据，把 5 MB 配额让出来
    if (backend === 'idb') moved.forEach(lsDel);
  }

  /* ---------------------------------------------------------------- 启动 */
  function init() {
    openDB().then(function (d) {
      if (!d) { initFallback(); return; }
      db = d;
      return readAll(d).then(function (all) {
        for (var k in all) mem[k] = all[k];
        migrate();
        readyResolve(api);
      });
    }).catch(function () { initFallback(); });
  }

  function initFallback() {
    db = null;
    backend = 'ls';
    lsKeys().forEach(function (k) { if (k.slice(0, 3) === 'lc:') { var v = lsGet(k); if (v != null) mem[k] = v; } });
    readyResolve(api);
  }

  /* ---------------------------------------------------------------- 接口 */
  var api = {
    ready: ready,
    get backend() { return backend; },
    get migrated() { return migratedCount; },
    getItem: function (k) {
      var v = mem[k];
      return v === undefined ? null : v;
    },
    setItem: function (k, v) {
      v = String(v);
      mem[k] = v;
      if (backend === 'ls') { lsSet(k, v); return true; }
      dirty[k] = v;
      scheduleFlush();
      return true;
    },
    removeItem: function (k) {
      delete mem[k];
      if (backend === 'ls') { lsDel(k); return; }
      dirty[k] = null;
      scheduleFlush();
    },
    key: function (i) { return Object.keys(mem)[i] || null; },
    get length() { return Object.keys(mem).length; },
    keys: function (prefix) {
      var all = Object.keys(mem);
      return prefix ? all.filter(function (k) { return k.indexOf(prefix) === 0; }) : all;
    },
    /* 估算占用（UTF-16 每字符 2 字节，与 localStorage 口径一致） */
    bytes: function (prefix) {
      var n = 0;
      api.keys(prefix).forEach(function (k) { n += (k.length + String(mem[k]).length) * 2; });
      return n;
    },
    /* 只清缓存类数据，保留渔获/常用地点/设置 */
    clearCache: function () {
      var CACHE_PREFIXES = ['lc:snap:', 'lc:v1:', 'lc:elev', 'lc:route:', 'lc:sat:'];
      var removed = 0;
      api.keys().forEach(function (k) {
        var hit = CACHE_PREFIXES.some(function (p) { return k.indexOf(p) === 0; });
        if (hit) { api.removeItem(k); removed++; }
      });
      return removed;
    },
    clearAll: function () {
      var n = 0;
      api.keys().forEach(function (k) { api.removeItem(k); n++; });
      return n;
    },
    exportAll: function () {
      var out = Object.create(null);
      api.keys().forEach(function (k) {
        // 卫星画布 base64 体积大又不影响还原，导出时跳过
        if (k.indexOf('lc:sat:') === 0) return;
        out[k] = mem[k];
      });
      return out;
    },
    importAll: function (obj) {
      var n = 0;
      Object.keys(obj || {}).forEach(function (k) { api.setItem(k, obj[k]); n++; });
      flush();
      return n;
    },
    info: function () {
      return { backend: backend, keys: api.length, bytes: api.bytes(), migrated: migratedCount };
    },
    flush: flush
  };

  // 关页面/切后台时把没落盘的写下去（IndexedDB 事务通常在卸载后仍能完成）
  // 关页面/切后台时把没落盘的写下去（IndexedDB 事务通常在卸载后仍能完成）。
  // 加 typeof 守卫：node 里跑单测时没有 window 的事件系统，不该在这里炸。
  if (typeof win.addEventListener === 'function') win.addEventListener('pagehide', flush);
  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', function () { if (doc.hidden) flush(); });
  }

  export const Store = api;
  init();
