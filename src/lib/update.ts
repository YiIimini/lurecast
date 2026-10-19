/* LureCast · 应用内检查更新（P4）—— 由 assets/app.js 的 currentBuildNo / initUpdateUI / checkUpdate 搬运
   -------------------------------------------------------------------------------------------
   两种更新源，都在设置的「数据与版本」里填：
     · 自己的 version.json：{"build":19,"apk":"https://…/LureCast.apk","notes":"…","url":"…"}
     · GitHub Release API：https://api.github.com/repos/owner/repo/releases/latest（仓库必须公开，
       App 里不放 token；私有仓库请把 APK 放到公开 Release／网盘再填直链）
   点「去下载」交给系统浏览器下载 APK，覆盖安装不丢数据（渔获/设置都在本机 IndexedDB）。 */
import { Store } from './store'
import { alertBox, confirmBox, toast } from './ui'

const UPDATE_KEY = 'lc:update'
const BUILD = '2026-10-19 · r34'

export function currentBuild(): string { return BUILD }

export function currentBuildNo(): number {
  const m = String(BUILD).match(/r(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}

export function getUpdateUrl(): string {
  try { return Store.getItem(UPDATE_KEY) || '' } catch { return '' }
}

export function setUpdateUrl(url: string) {
  try { Store.setItem(UPDATE_KEY, (url || '').trim()) } catch { /* 忽略 */ }
}

export type UpdateResult =
  | { kind: 'latest'; build: number }
  | { kind: 'newer'; build: number; apk: string; page: string; notes: string }
  | { kind: 'error'; message: string }

/* 纯查询：不弹窗，方便单测/复用 */
export function fetchUpdate(url: string): Promise<UpdateResult> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), 12000) : null
  return fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    })
    .then((j: any) => {
      if (timer) clearTimeout(timer)
      let build = parseInt(j.build, 10)
      if (!isFinite(build)) build = parseInt(String(j.tag_name || '').replace(/\D+/g, ''), 10) || 0
      let apk = j.apk || ''
      if (!apk && j.assets && j.assets.length) {
        for (let i = 0; i < j.assets.length; i++) {
          if (/\.apk$/i.test(j.assets[i].name || '')) { apk = j.assets[i].browser_download_url; break }
        }
      }
      const notes = String(j.notes || j.body || '').trim()
      const page = j.url || j.html_url || ''
      if (!build || !apk) throw new Error('返回里没有 build 与 apk 字段')
      const cur = currentBuildNo()
      if (build <= cur) return { kind: 'latest', build: cur } as UpdateResult
      return { kind: 'newer', build, apk, page, notes } as UpdateResult
    })
    .catch((e: any) => {
      if (timer) clearTimeout(timer)
      let msg = String(e && e.message ? e.message : e)
      if (/abort/i.test(msg)) msg = '超时（12 s）'
      return { kind: 'error', message: msg } as UpdateResult
    })
}

/* 带交互的一键检查（设置弹窗「检查更新」按钮） */
export async function checkUpdate(onState?: (t: string) => void): Promise<void> {
  const url = getUpdateUrl()
  if (!url) {
    await alertBox('还没有填更新源。\n\n两种填法：\n· 自己的 version.json（{"build":19,"apk":"…apk","notes":"…"}）\n'
      + '· GitHub Release API：https://api.github.com/repos/owner/repo/releases/latest（仓库需公开）',
    { title: '先填更新源' })
    return
  }
  onState && onState('检查中…')
  const res = await fetchUpdate(url)
  if (res.kind === 'error') {
    onState && onState('检查失败')
    await alertBox('检查更新失败：' + res.message +
      '\n\n常见原因：更新源不可公开访问（私有仓库需要 token，App 里不放 token）、返回不是 JSON、或直链不是 APK。',
    { title: '没检查成' })
    return
  }
  if (res.kind === 'latest') {
    onState && onState('已是最新（r' + res.build + '）')
    await alertBox('当前 r' + res.build + ' 就是最新版本。', { title: '已是最新' })
    return
  }
  onState && onState('发现 r' + res.build)
  const msg = '发现新版本 r' + res.build + '（当前 r' + currentBuildNo() + '）。' +
    (res.notes ? '\n\n' + res.notes.slice(0, 400) : '') +
    '\n\n点「去下载」用系统浏览器打开 APK 直链，下载完点一下安装即可覆盖升级（渔获与设置不会丢）。'
  const ok = await confirmBox(msg, { title: '有新版本', okText: '去下载', cancelText: '以后再说' })
  if (!ok) return
  toast('正在打开下载…')
  window.location.href = res.apk   // 原生壳里 Capacitor 会交给系统浏览器
}
