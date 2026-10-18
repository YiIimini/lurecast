/* LureCast · 通用弹窗三件套（P3）—— 由 assets/ui.js 机械迁移
   ---------------------------------------------------------------------------
   对外仍然是 Promise 风格：await UI.confirm('删？') → true/false，
   这样 store 与组件都能用同一套调用（老壳的调用点不用改写）。
   DOM 结构、class 名与老壳一致（uibox / uimsg / uiopt / uisheet…），样式不用动。
   `enhance` / `enhanceAll`（把 <select> 换成自绘下拉）没搬：新壳的表单都是原生
   <select>，等 P4 统一表单时再看要不要。 */

function $(id: string) {
  return document.getElementById(id)
}

function esc(s: any) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
}

let hostEl: HTMLElement | null = null

function host(): HTMLElement {
  if (hostEl && document.body.contains(hostEl)) return hostEl
  const exist = $('uiModal')
  if (exist) { hostEl = exist; return exist }
  const m = document.createElement('div')
  m.className = 'modal hidden'
  m.id = 'uiModal'
  m.innerHTML = '<div class="modal-box uibox">' +
    '<div class="modal-head"><h3 id="uiTitle">提示</h3>' +
    '<button class="act ghost" id="uiX">关闭</button></div>' +
    '<div class="modal-body" id="uiBody"></div>' +
    '<div class="modal-foot uifoot" id="uiFoot"></div>' +
    '</div>'
  document.body.appendChild(m)
  hostEl = m
  return m
}

let closer: null | (() => void) = null

function open(opts: { title?: string; html?: string; foot?: string }) {
  const m = host()
  const t = $('uiTitle'), b = $('uiBody'), f = $('uiFoot')
  if (t) t.textContent = opts.title || '提示'
  if (b) b.innerHTML = opts.html || ''
  if (f) f.innerHTML = opts.foot || ''
  m.classList.remove('hidden')
  return m
}

function close() {
  const m = $('uiModal')
  if (m) m.classList.add('hidden')
  if (closer) { const f = closer; closer = null; f() }
}

/* 关闭按钮：老壳在模块加载时就挂全局委托。这里加 typeof 守卫，
   让 spots/engine 这类纯逻辑单测能在 node 环境下 import 而不炸。 */
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null
    if (!t) return
    if (t.id === 'uiX' || (t.getAttribute && t.getAttribute('data-uiclose') !== null && t.closest('#uiModal'))) {
      close()
    }
  }, true)
}

export function alertBox(text: string, opts: any = {}): Promise<void> {
  return new Promise((resolve) => {
    open({
      title: opts.title || '提示',
      html: '<p class="uimsg">' + esc(text) + '</p>',
      foot: '<button class="act primary" id="uiOk">' + esc(opts.okText || '知道了') + '</button>'
    })
    const done = () => { close(); resolve() }
    const ok = $('uiOk')
    if (ok) { ok.addEventListener('click', done); ok.focus() }
    closer = () => resolve()
  })
}

export function confirmBox(text: string, opts: any = {}): Promise<boolean> {
  return new Promise((resolve) => {
    open({
      title: opts.title || '确认',
      html: '<p class="uimsg">' + esc(text) + '</p>',
      foot: '<button class="act ghost" id="uiNo">' + esc(opts.cancelText || '取消') + '</button>' +
        '<button class="act ' + (opts.danger ? 'danger' : 'primary') + '" id="uiYes">' +
        esc(opts.okText || '确定') + '</button>'
    })
    const fin = (v: boolean) => { closer = null; close(); resolve(v) }
    closer = () => resolve(false)
    const yes = $('uiYes'), no = $('uiNo')
    if (yes) { yes.addEventListener('click', () => fin(true)); yes.focus() }
    if (no) no.addEventListener('click', () => fin(false))
  })
}

export function promptBox(text: string, value: string, opts: any = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const field = opts.multiline
      ? '<textarea id="uiInput" rows="3" placeholder="' + esc(opts.placeholder || '') + '">' + esc(value || '') + '</textarea>'
      : '<input id="uiInput" value="' + esc(value || '') + '" placeholder="' + esc(opts.placeholder || '') + '" autocomplete="off">'
    open({
      title: opts.title || '请输入',
      html: '<label class="uilabel">' + esc(text) + '</label>' + field,
      foot: '<button class="act ghost" id="uiNo">取消</button>' +
        '<button class="act primary" id="uiYes">' + esc(opts.okText || '确定') + '</button>'
    })
    const inp = $('uiInput') as HTMLInputElement | HTMLTextAreaElement | null
    const fin = (v: string | null) => { closer = null; close(); resolve(v) }
    closer = () => resolve(null)
    const yes = $('uiYes'), no = $('uiNo')
    if (yes) yes.addEventListener('click', () => fin(inp ? inp.value.trim() : ''))
    if (no) no.addEventListener('click', () => fin(null))
    if (inp && !opts.multiline) {
      inp.addEventListener('keydown', (e: any) => {
        if (e.key === 'Enter') { e.preventDefault(); fin(inp.value.trim()) }
      })
    }
    setTimeout(() => { if (inp) { inp.focus(); (inp as HTMLInputElement).select?.() } }, 60)
  })
}

export function sheet(list: any[], opts: any = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const html = '<div class="uisheet">' + list.map((it, i) => {
      const v = typeof it === 'string' ? it : it.value
      const label = typeof it === 'string' ? it : (it.label || it.value)
      const sub = (typeof it === 'object' && it.sub) ? '<em>' + esc(it.sub) + '</em>' : ''
      const on = opts.value != null && String(v) === String(opts.value) ? ' on' : ''
      return '<button class="uiopt' + on + '" data-i="' + i + '">' + esc(label) + sub + '</button>'
    }).join('') + '</div>'
    open({ title: opts.title || '选择', html, foot: '<button class="act ghost" id="uiNo">取消</button>' })
    const fin = (v: string | null) => { closer = null; close(); resolve(v) }
    closer = () => resolve(null)
    document.querySelectorAll('#uiBody .uiopt').forEach((b) => {
      b.addEventListener('click', () => {
        const it = list[parseInt((b as HTMLElement).getAttribute('data-i') || '0', 10)]
        fin(typeof it === 'string' ? it : it.value)
      })
    })
    const no = $('uiNo')
    if (no) no.addEventListener('click', () => fin(null))
  })
}

/* 轻提示：老壳把 #toast 写在 HTML 里，新壳按需创建同一个 class 的节点 */
let toastTimer = 0
export function toast(text: string) {
  if (typeof document === 'undefined') return   // node 单测里没有 DOM，静默跳过
  let el = $('toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'toast'
    el.className = 'toast'
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    document.body.appendChild(el)
  }
  el.textContent = text
  el.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el && el.classList.remove('on'), 1900)
}

export const UI = {
  alert: alertBox,
  confirm: confirmBox,
  prompt: promptBox,
  sheet,
  toast,
  close
}

export default UI
