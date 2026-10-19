/* LureCast · 罗盘指北（设备航向）
   ---------------------------------------------------------------------------
   用户问「我怎么知道哪里是北极？」——只把 N 画在屏幕正上方是没用的：你拿着手机不可能正好朝北。
   这里读设备的方向传感器，拿到「手机顶边相对真北的方位角」，卡片里把刻度盘反向转同样角度，
   N 就永远贴着真实北向；指针也一起按真北换算（不会随手机转就偏掉）。

   数据来源（与老壳 assets/app.js 同一套判定）：
   · `deviceorientationabsolute` / `deviceorientation` 且 `absolute === true` → 用 alpha 推算：航向 = 360 - alpha
   · iOS：`webkitCompassHeading` 直接就是相对真北的航向
   · 相对方向（没有 absolute）**不能用**，那只是相对开机姿态，会把假北当真北。

   没有传感器/用户拒绝时：保持「N 朝上」的静态罗盘，并把按钮文字说清楚，不假装指北。
   开关状态存本机 `lc:compass`（'auto' | 'off'），默认开。 */
import { ref } from 'vue'
import { Store } from './store'

const KEY = 'lc:compass'

/** 用户是否开启指北（默认开，与老壳一致） */
export const headingOn = ref(true)
/** 是否已经收到过绝对方向（从没收到过 = 设备没有磁力计） */
export const headingHas = ref(false)
/** 目标航向：手机顶边相对真北的方位角（0=朝北，90=朝东） */
export const headingDeg = ref(0)
/** 状态：off 关闭 / wait 正在等传感器 / ok 正常 / denied 权限被拒 / nosensor 没有传感器 */
export const headingState = ref<'off' | 'wait' | 'ok' | 'denied' | 'nosensor'>('off')

let listening = false
let probe = 0

function setState(s: typeof headingState.value) {
  headingState.value = s
}

export function headingLabel(): string {
  switch (headingState.value) {
    case 'ok': return '指北 ✓'
    case 'wait': return '指北…'
    case 'denied': return '指北被拒'
    case 'nosensor': return '无磁力计'
    default: return '指北'
  }
}

function onOrient(e: any) {
  if (!headingOn.value) return
  let h: number | null = null
  if (typeof e.webkitCompassHeading === 'number' && isFinite(e.webkitCompassHeading)) {
    h = e.webkitCompassHeading
  } else if (e.absolute === true && e.alpha != null && isFinite(e.alpha)) {
    h = 360 - e.alpha
  }
  if (h == null) return
  headingHas.value = true
  headingDeg.value = ((h % 360) + 360) % 360
  if (headingState.value !== 'ok') setState('ok')
}

function attach() {
  if (listening) return
  window.addEventListener('deviceorientationabsolute', onOrient, true)
  window.addEventListener('deviceorientation', onOrient, true)
  listening = true
  clearTimeout(probe)
  /* 2.5 s 内一条绝对方向都没收到 → 这台设备没有磁力计，别一直转圈 */
  probe = window.setTimeout(() => {
    if (!headingHas.value) setState('nosensor')
  }, 2500)
}

export function enableHeading(): boolean {
  if (!headingOn.value) return false
  const DOE: any = (window as any).DeviceOrientationEvent
  if (!DOE) { setState('nosensor'); return false }
  setState('wait')
  /* iOS 13+ 必须在用户手势里申请权限；安卓/桌面浏览器没有这个方法 */
  if (typeof DOE.requestPermission === 'function') {
    DOE.requestPermission().then((r: string) => {
      if (r === 'granted') attach()
      else setState('denied')
    }).catch(() => setState('denied'))
  } else {
    attach()
  }
  return true
}

export function setHeadingEnabled(on: boolean) {
  headingOn.value = !!on
  try { Store.setItem(KEY, on ? 'auto' : 'off'); Store.flush() } catch { /* 存不上不影响本次使用 */ }
  if (on) {
    headingHas.value = false
    enableHeading()
  } else {
    listening && detach()
    headingHas.value = false
    headingDeg.value = 0
    setState('off')
  }
}

function detach() {
  window.removeEventListener('deviceorientationabsolute', onOrient, true)
  window.removeEventListener('deviceorientation', onOrient, true)
  listening = false
  clearTimeout(probe)
}

/** 启动时调用：恢复开关，开着就直接去找传感器（安卓/桌面浏览器不需要手势） */
export function initHeading() {
  let want = true
  try {
    const raw = Store.getItem(KEY)
    if (raw === 'off') want = false
  } catch { /* 读不到就用默认开 */ }
  headingOn.value = want
  if (want) enableHeading()
  else setState('off')
}
