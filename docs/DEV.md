# 开发约定

## 目录

```
lurecast/
├─ app.html                 新壳入口（Vite 多页入口，打包后改名为 index.html 进 www/）
├─ src/
│  ├─ main.ts               启动：等 Store.ready → 读偏好 → 挂载 → i18n
│  ├─ App.vue               四页签骨架 + 卡片编排
│  ├─ lib/                  纯逻辑（多数由 assets/*.js 机械迁移，带 @ts-nocheck）
│  │   engine.ts           评分引擎（纯函数，无 DOM）
│  │   api.ts              6 个数据源 + 分级缓存 + 退避重试
│  │   store.ts            IndexedDB 门面（同步接口 + 内存镜像 + 批量落盘）
│  │   sat.ts / deeper.ts / aqua.ts / agent.ts / ai.ts / share.ts / i18n.ts …
│  ├─ stores/               Pinia：env（环境数据）/ spots / my / sonar / ui
│  └─ components/           cards/*.vue（14 张卡）+ modals/*.vue + MapView.vue
├─ index.html + assets/*.js 老壳（13 个 IIFE）：只作回滚，新开发不要往里加
├─ assets/theme.css|app.css 设计令牌与组件样式（新壳直接 import，不换皮）
├─ assets/fish/             水族馆贴图（25 种鱼 + 河床）
├─ assets/vendor/           自托管第三方依赖（three.js 水族馆 3D / geotiff.js 卫星）
├─ native/                  Capacitor 安卓工程 + 出包脚本 + 贴图生成脚本
├─ tools/i18n/              三语文案抓取与生成
└─ docs/                    本目录
```

## npm 脚本

| 命令 | 作用 |
|---|---|
| `npm run dev -- --port 5181 --host 127.0.0.1` | 开发（**必须带 `--host 127.0.0.1`**，否则只绑 `::1`，curl/Chrome 连不上） |
| `npm test` | Vitest：engine 等价性、spots/my 管线、update/deeper/window-hint/i18n 解析 |
| `npm run typecheck` | `vue-tsc --noEmit` |
| `npm run build` | Vite 构建 → `dist-web/`（构建收尾会复制鱼贴图，见下） |
| `npm run sync-web` | build + 装进 `native/www/`（默认不带老壳；`--with-legacy` 才带） |
| `npm run preview` | 预览 `dist-web/` |

## 四个容易踩的点（已修，别改回去）

1. **鱼贴图要复制**：水族馆的 25 张 `assets/fish/*.webp` 是运行期拼路径加载的，不是 import，
   Vite 不会搬。`vite.config.ts` 里的 `copyFishSprites()` 插件负责在 `closeBundle` 时复制进 `dist-web/assets/fish/`。
   删了它，APK 里就只剩矢量兜底鱼。
2. **先等存储就绪再挂载**：`Store` 是「内存镜像 + IndexedDB 异步落盘」，`getItem` 同步读镜像。
   `main.ts` 必须 `Store.ready.then(boot)`（2.5 s 兜底），否则首帧读到空镜像 —— 渔获/常用地点像丢了，
   随后一次写入还会把真数据覆盖。
3. **样式导入顺序**：`leaflet.css` 必须在 `theme.css`/`app.css` 之前，否则 `.leaflet-container{background:#ddd}`
   会盖掉深色底（瓦片没加载出来时地图变浅灰）。
4. **水族馆 3D 与 2D 别同时活着**：`aqua3d.ts` 拿到 WebGL 上下文后，canvas 就再也拿不到 `2d`（`getContext('2d')` 返回 null）。
   所以全屏必须走 3D 自己的分支（切 `card.fs`/`body.aquafs`），不能调老的 `aquaFull()`（它内部会 `resizeAqua()`）；
   3D 加载失败或 WebGL 不可用时才退回 `renderAqua()` 的 2D 画法。three.js 是 `import()` 懒加载的，
   `assets/vendor/three.module.min.js`（675 KB）不进 app chunk，别改成静态 import。

## 测试怎么组织

- `src/lib/__tests__/engine.parity.test.ts`：新 `engine.ts` 与老壳 `assets/engine.js` 逐项一致（迁移的底线）。
- `src/stores/__tests__/{spots,my}.test.ts`：OSM→岸线→钓点、渔获/常用地点的配额与判重，网络全打桩。
- `src/lib/__tests__/{update,deeper,window-hint,i18n-phrases}.test.ts`：解析与对照表完整性。
- 前端行为（地图、卫星出图、三语切换）用 Playwright + 系统 Chrome（`channel="chrome"`）跑生产构建，脚本不进仓库。

## Git

- 主分支 `main`，提交信息用 `Pn：一句话`（阶段号 + 改动），正文写「为什么」与实测数字。
- **不跟踪**：`node_modules/`、`dist-web/`、`native/www/`、`native/android/**/build/`、
  `native/android/app/src/main/assets/public/`、`*.apk`、`*.log`、本机私有配置。
- **跟踪**：源码、`assets/vendor/`（`geotiff.js`、`three.module.min.js` 这几份随项目发布的依赖）、安卓工程、贴图与文档。
- **换行**：`.gitattributes` 里源码强制 LF、`.ps1/.cmd` 强制 CRLF，避免 Windows 上脚本被改坏。
- `gradle-wrapper.properties` 提交的是官方地址；本机离线编译用工具链里解压好的 gradle，别改这个文件（见 [`ANDROID.md`](ANDROID.md)）。

## PWA / Service Worker

`sw.js` 的预缓存清单是 install 时从 `index.html` 里扒的哈希资源，加资源不用手改。

- 页面导航 **network-first**：改完刷新就生效；断网才退缓存。
- 静态外壳 **cache-first + 后台更新**，装过一次后离线可开。
- 换版本时 CACHE 名跟着变，`activate` 删旧缓存。装过 PWA 的话，第一次打开可能还是旧版，再刷一次即可。
- 跨域接口（Open-Meteo / OSM / Sentinel-2）不进 SW 缓存，一律由 `api.ts` 的分级缓存负责。

## 验收记录

重构分阶段的过程、等价性数据、踩坑与体积账都在 [`REFACTOR-PLAN.md`](REFACTOR-PLAN.md)。
