/* LureCast · 识图适配器（厂商可选，Key 只存本机）
   支持两类线上格式：
   1) OpenAI 兼容：POST {base}/chat/completions，content 里放 image_url
      —— OpenAI / 通义千问 DashScope 兼容模式 / 豆包方舟 / 智谱 GLM-4V / Kimi / 任何自建兼容代理
   2) Google Gemini：POST {base}/models/{model}:generateContent?key=KEY，parts 里放 inline_data

   DeepSeek：deepseek-flash 已支持图片输入（JPEG/PNG/GIF/WebP，按内容判断格式，不看扩展名）；
   旧名 deepseek-v4-flash-vision-exp 仍可调用但已下线，请求由最新 Flash 承接。
   本应用统一把照片转成 JPEG 后以 data URL 发送，正好在支持列表内。
   浏览器直连有些厂商不放 CORS，界面里的「测试连接」会把真实错误原样报出来。 */
(function () {
  'use strict';
  // 存储统一走 Store（IndexedDB 同步门面），失败时退回 localStorage
  var Store = window.Store || window.localStorage;

  var KEY = 'lc:ai';
  var MAX_PX = 720;      // 发给模型前再压一次，省 token

  var PROVIDERS = [
    { id: 'deepseek', name: 'DeepSeek（deepseek-flash，支持图片）', kind: 'openai',
      base: 'https://api.deepseek.com/v1', model: 'deepseek-flash',
      note: 'deepseek-flash 支持图片输入（JPEG/PNG/GIF/WebP，按文件内容判断格式）。旧模型名 deepseek-v4-flash-vision-exp 仍可调用，但已下线，请求由最新 Flash 承接。' },
    { id: 'openai', name: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { id: 'gemini', name: 'Google Gemini', kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
    { id: 'qwen', name: '通义千问 VL（阿里）', kind: 'openai', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' },
    { id: 'doubao', name: '豆包 视觉（火山方舟）', kind: 'openai', base: 'https://ark.cn-beijing.volces.com/api/v3', model: '', modelHint: '填你的推理接入点 ID（ep-xxx）' },
    { id: 'zhipu', name: '智谱 GLM-4V', kind: 'openai', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-plus' },
    { id: 'moonshot', name: 'Kimi 视觉（Moonshot）', kind: 'openai', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k-vision-preview' },
    { id: 'custom', name: '自定义（OpenAI 兼容）', kind: 'openai', base: '', model: '', custom: true }
  ];

  var cfg = { provider: '', key: '', base: '', model: '' };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function load() {
    try {
      var raw = Store.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        cfg.provider = o.provider || '';
        cfg.key = o.key || '';
        cfg.base = o.base || '';
        cfg.model = o.model || '';
      }
    } catch (e) { /* 默认空 */ }
  }
  function save() {
    try { Store.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* 忽略 */ }
  }
  function provider() {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === cfg.provider) return PROVIDERS[i];
    return null;
  }
  function ready() { var p = provider(); return !!(p && cfg.key && effectiveBase() && effectiveModel()); }
  function effectiveBase() { var p = provider(); return (cfg.base || (p && p.base) || '').replace(/\/+$/, ''); }
  function effectiveModel() { var p = provider(); return cfg.model || (p && p.model) || ''; }

  /* 发给模型前再压一次（720px），省 token 也省流量 */
  function shrink(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_PX / Math.max(img.width, img.height));
        if (scale >= 1) return resolve({ url: dataUrl, mime: 'image/jpeg', b64: (dataUrl.split(',')[1] || '') });
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var out = c.toDataURL('image/jpeg', 0.8);
        resolve({ url: out, mime: 'image/jpeg', b64: out.split(',')[1] || '' });
      };
      img.onerror = function () { resolve({ url: dataUrl, mime: 'image/jpeg', b64: (dataUrl.split(',')[1] || '') }); };
      img.src = dataUrl;
    });
  }

  var PROMPT = [
    '你是路亚钓鱼助手。识别照片里的鱼，只输出 JSON，不要任何解释或代码块：',
    '{"species_zh":"中文常用名","species_en":"英文名","latin":"拉丁名","confidence":0到1,"size_cm":估算体长数字或null,"note":"一句话依据，例如斑纹/体型/鳍位置"}',
    '如果不是鱼或看不清，species_zh 用 "无法判断"，confidence 给 0。'
  ].join('\n');

  function multiPrompt(n) {
    if (n <= 1) return PROMPT;
    return '下面 ' + n + ' 张照片是同一条鱼（或同一次渔获）的不同角度，请综合判断。\n' + PROMPT;
  }

  function callOpenAI(images) {
    var content = [{ type: 'text', text: multiPrompt(images.length) }];
    images.forEach(function (img) { content.push({ type: 'image_url', image_url: { url: img.url } }); });
    var body = {
      model: effectiveModel(),
      temperature: 0.2,
      max_tokens: 400,
      messages: [{ role: 'user', content: content }]
    };
    return fetch(effectiveBase() + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 160));
        var j = JSON.parse(t);
        var msg = j.choices && j.choices[0] && j.choices[0].message;
        var content = msg && msg.content;
        // 有的厂商返回字符串，有的返回 [{type:'text',text:'…'}] 数组
        if (Array.isArray(content)) {
          content = content.map(function (p) {
            return typeof p === 'string' ? p : (p && (p.text || p.content) || '');
          }).join('');
        }
        if (!content && j.output_text) content = j.output_text;
        return content || '';
      });
    });
  }

  function callGemini(images) {
    var url = effectiveBase() + '/models/' + encodeURIComponent(effectiveModel()) +
      ':generateContent?key=' + encodeURIComponent(cfg.key);
    var parts = [{ text: multiPrompt(images.length) }];
    images.forEach(function (img) { parts.push({ inline_data: { mime_type: img.mime || 'image/jpeg', data: img.b64 } }); });
    var body = {
      contents: [{ parts: parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 400 }
    };
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 160));
        var j = JSON.parse(t);
        var cand = j.candidates && j.candidates[0];
        var parts = (cand && cand.content && cand.content.parts) || [];
        return parts.map(function (p) { return p.text || ''; }).join('');
      });
    });
  }

  function parseJSON(text) {
    if (!text) return null;
    var t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    var i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    try { return JSON.parse(t.slice(i, j + 1)); } catch (e) { return null; }
  }

  /* 把模型给的名称对到本地鱼种库（中文/英文/拉丁，宽松匹配） */
  function matchSpecies(g) {
    var db = window.SPECIES_DB || [];
    if (!g) return null;
    var norm = function (x) {
      return String(x || '').toLowerCase().replace(/[\s（）()·\-.、]/g, '')
        .replace(/（.*?）/g, '');
    };
    var zh = norm(g.species_zh), en = norm(g.species_en), la = norm(g.latin);
    var hit = null;
    db.forEach(function (sp) {
      var z = norm(sp.zh), e = norm(sp.en), l = norm(sp.latin);
      if (!hit && ((zh && z === zh) || (la && l === la) || (en && e === en))) hit = sp;
    });
    if (!hit) {
      db.forEach(function (sp) {
        if (hit) return;
        var z = norm(sp.zh), e = norm(sp.en);
        if ((zh && (z.indexOf(zh) >= 0 || zh.indexOf(z) >= 0)) ||
            (en && (e.indexOf(en) >= 0 || en.indexOf(e) >= 0))) hit = sp;
      });
    }
    return hit;
  }

  /* 支持单图或数组（多角度）：identify(url) / identify([url1, url2]) */
  function identify(input, onStep) {
    var p = provider();
    if (!p) return Promise.reject(new Error('还没选识图服务：设置 → 识图'));
    if (!cfg.key) return Promise.reject(new Error('还没填 API Key：设置 → 识图'));
    if (!effectiveBase()) return Promise.reject(new Error('自定义服务需要填 baseURL'));
    if (!effectiveModel()) return Promise.reject(new Error('还没填模型名'));
    var list = Array.isArray(input) ? input.slice(0, 4) : [input];
    if (!list.length) return Promise.reject(new Error('没有图片'));
    onStep && onStep('压缩 ' + list.length + ' 张图片…');
    return Promise.all(list.map(shrink)).then(function (images) {
      onStep && onStep('调用 ' + p.name + ' 识别…');
      var call = p.kind === 'gemini'
        ? callGemini(images)
        : callOpenAI(images);
      return call.then(function (text) {
        var g = parseJSON(text);
        if (!g) throw new Error('模型没返回可解析的 JSON：' + String(text).slice(0, 120));
        var sp = matchSpecies(g);
        return {
          provider: p.name, guess: g, species: sp, images: images.length,
          confidence: typeof g.confidence === 'number' ? g.confidence : null,
          note: g.note || '', raw: text
        };
      });
    });
  }

  /* ---------------- 设置界面 ---------------- */
  function renderSettings() {
    var sel = $('aiProvider');
    if (!sel) return;
    sel.innerHTML = '<option value="">（不启用识别）</option>' + PROVIDERS.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === cfg.provider ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');
    var p = provider();
    if ($('aiKeyInput')) { $('aiKeyInput').value = cfg.key || ''; $('aiKeyInput').style.display = p ? '' : 'none'; }
    if ($('aiBaseInput')) {
      $('aiBaseInput').value = cfg.base || (p && p.base) || '';
      $('aiBaseInput').style.display = p ? '' : 'none';
      $('aiBaseInput').disabled = !!(p && p.base && !p.custom);
    }
    if ($('aiModelInput')) {
      $('aiModelInput').value = cfg.model || (p && p.model) || '';
      $('aiModelInput').style.display = p ? '' : 'none';
      $('aiModelInput').placeholder = (p && p.modelHint) || '模型名，例如 gpt-4o-mini';
    }
    if ($('aiNote')) {
      $('aiNote').innerHTML = p
        ? (p.note ? esc(p.note) : '') + ' Key 只存在这台设备（localStorage），不会上传到我们的服务器；但会出现在浏览器网络请求里，建议给 Key 设额度上限。'
        : '选一个服务并填入 Key 即可启用「拍照自动识别鱼种」。不启用也不影响手动记录。';
    }
    if ($('aiTestResult')) $('aiTestResult').textContent = '';
  }

  function bind() {
    load();
    renderSettings();
    var sel = $('aiProvider');
    if (sel) sel.addEventListener('change', function () {
      cfg.provider = sel.value;
      cfg.base = '';
      cfg.model = '';
      save();
      renderSettings();
    });
    ['aiKeyInput', 'aiBaseInput', 'aiModelInput'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('change', function () {
        if (id === 'aiKeyInput') cfg.key = el.value.trim();
        if (id === 'aiBaseInput') cfg.base = el.value.trim();
        if (id === 'aiModelInput') cfg.model = el.value.trim();
        save();
      });
    });
    var test = $('btnAiTest');
    if (test) test.addEventListener('click', function () {
      var out = $('aiTestResult');
      if (!ready()) { if (out) out.textContent = '先选服务、填 Key 和模型名。'; return; }
      test.classList.add('busy');
      if (out) out.textContent = '正在测试…';
      var c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#123'; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#7d9a46';
      ctx.beginPath(); ctx.ellipse(32, 32, 18, 8, 0, 0, 7); ctx.fill();
      identify(c.toDataURL('image/jpeg', 0.7)).then(function (res) {
        test.classList.remove('busy');
        if (out) out.textContent = '连通：模型返回「' + (res.guess.species_zh || '?') + '」，本地匹配：' +
          (res.species ? res.species.zh : '无');
      }).catch(function (err) {
        test.classList.remove('busy');
        if (out) out.textContent = '失败：' + (err && err.message ? err.message : err);
      });
    });
  }

  window.AI = {
    bind: bind, load: load, save: save, cfg: function () { return cfg; },
    providers: PROVIDERS, provider: provider, ready: ready,
    identify: identify, renderSettings: renderSettings, matchSpecies: matchSpecies
  };
})();
