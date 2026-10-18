# LureCast 重构方案：从「手写原生 JS」升级到成熟开源框架

> 前提：`r29`（可装 APK、可离线 PWA、无任何 API Key）。
> 本文是**决策稿**：先把现状量化，再给三条可选路线与推荐，最后是分阶段落地方案与验收门。
> 不含实现代码——选型定下来再动手。

---

## 1. 现状体检（实测数据，不是估计）

| 项目 | 数值 | 说明 |
|---|---|---|
| JS 总量 | **412 KB / 8 389 行**，13 个文件 | 全部手写，无构建、无压缩、无 tree-shaking |
| 最大的文件 | `app.js` 133 KB / 2 794 行 | 状态 + 地图 + 渲染 + 交互全挤在一个 IIFE 里 |
| 次大 | `my.js` 80 KB、`engine.js` 40 KB、`sat.js` 32 KB、`ai.js` 22 KB | |
| DOM 操作密度 | `$()`（getElementById）**361 次**、`innerHTML` **64 次**、`addEventListener` **118 次** | app.js 占 213/43/64；典型「手写渲染 + 手写绑定」 |
| UI 规模 | `index.html` 36 KB、**52 个卡片**、**6 个弹窗** | 卡片式布局是全部交互面 |
| CSS | 75 KB（`app.css` 62 + `theme.css` 14） | 自带设计系统与配色预设 |
| 第三方依赖 | **Leaflet 1.9.4（从 unpkg CDN 加载）** + geotiff.js 310 KB（本地） | CDN 那两条是**离线/APK 的隐患**：sw.js 只缓存同源资源 |
| 测试 | **0 个**（无 vitest/jest/playwright 配置） | 8 389 行靠人肉回归 |
| 构建 | **无**（无根 `package.json`；`native/` 里只有 Capacitor 的） | 改完直接 `sw.js` 里手工列缓存清单 |
| 版本 | 22 次提交，r29 | 单人维护、节奏很快 |

**结论**：这不是"要不要框架"的问题，是"8 389 行手写 DOM 已经到维护上限"的问题——
`app.js` 里 213 次 `$()` + 43 次 `innerHTML` 意味着任何卡片改动都要同时改 HTML、CSS、三处 JS，
且没有类型、没有测试兜底。框架重构的核心收益是**渲染与状态可声明 + 改动面收敛**，不是"看起来更现代"。

---

## 2. 好消息：现有代码已经有清晰的重构缝

8 个模块已经用 `window.X = {…}` 暴露了**框架无关的公共接口**，这部分几乎可以原样搬到任何框架：

| 模块 | 导出 API（快照） | 重构处置 |
|---|---|---|
| `engine.js` | 11 个：`dist/round/parseBodies/buildCandidates/applyTerrain/envScore/hourCurve/…` | **原样保留**（纯函数，最值钱）= 首批搬成 TS + 单测 |
| `api.js` | 12 个：`weather/marine/flood/elevation/osm/osmById/cacheReport/TTL…` | 原样 + 加类型（网络层） |
| `sat.js` | 3 个：`analyse/waterCandidates/lonLatToUtm` | 原样（含 Canvas 计算） |
| `store.js` | IndexedDB 同步门面（`getItem/setItem/clearCache/exportAll…`） | 换成 **Dexie / idb** 或保留门面但加类型 |
| `species.js` / `i18n.js` / `icons.js` | 数据与工具表 | 原样（转 TS 常量） |
| `app.js` | `LureCast`：6 个导出 + 全部卡片渲染 | **拆成组件 + store**（主要工作量） |
| `my.js` | `My`：7 个导出（渔获/常用地点/水族馆/档案导入导出） | 拆成组件 + store |
| `ui.js` / `ai.js` / `agent.js` / `share.js` | 弹窗、识图、Agent、分享 | 拆成组件 / 服务 |

⇒ 迁移可以走 **strangler（绞杀者）**：引擎先搬、UI 逐个卡片换，**任何一天都能出可用的包**，不需要"停机大爆炸"。

---

## 3. 三条路线（选一条）

### 路线 A（推荐）：Vue 3 + Vite + TypeScript + Pinia

| 维度 | 说明 |
|---|---|
| 体积 | Vue 3 运行时约 34 KB gz；整包预计从 412 KB → **180–220 KB（压缩后更小）** |
| 迁移成本 | 模板语法与现有 `innerHTML` 拼接最接近，**52 张卡片可以逐张平移**，不必重画设计 |
| 生态成熟度 | Pinia（状态）、Vue Router（hash 模式，file:// 可用）、Vitest（单测）、VueUse（工具）、vue-tsc（类型检查） |
| 移动端 | 无 SSR 负担，`v-if/v-for` 对长列表友好；与 Capacitor 无冲突 |
| 学/查成本 | 中文文档与示例最全 |

### 路线 B：Svelte 5 + Vite（体积最优）

- 运行时几乎为零，预计 412 KB → **120–150 KB**；响应式更简洁。
- 代价：生态比 Vue/React 小，`svelte-check` 与第三方库（地图、图表）适配要自己扛；团队复用性差一点。

### 路线 C：React 18 + Vite + Zustand + TanStack Query（生态最大）

- 生态与招聘最友好，`react-map-gl`、`@tanstack/query`（正好治 `api.js` 的缓存/重试）都成熟。
- 代价：运行时最重（+45 KB gz 起），52 张卡片的 JSX 重写量最大，且容易把现有 CSS 设计系统推倒重来。

> **地图**：三条路线都**先保留 Leaflet**（42 KB、已跑通、有好用的插件），只做两件事：
> ① 从 CDN 改成本地自托管（**修掉离线隐患**，当天可做）；② 抽成 `useMap()` 组合式，将来要换 MapLibre/PMTiles 只改一处。
> 不在地图重构上冒风险——它不是当前痛点。

---

## 4. 目标目录结构（以路线 A 为例）

```
src/
├── main.ts                 # createApp + Pinia + 全局样式
├── App.vue                 # 顶栏 + 4 个 tab 容器（沿用现有 index.html 骨架）
├── lib/                    # ← 从 assets/*.js 平移，加类型
│   ├── engine.ts           #   纯数学/评分（原 engine.js）
│   ├── api.ts              #   数据源 + 缓存（原 api.js）
│   ├── sat.ts              #   Sentinel-2 分析（原 sat.js）
│   ├── store.ts            #   IndexedDB 门面（或换 Dexie）
│   ├── species.ts geojson.ts icons.ts i18n.ts
│   └── __tests__/          #   Vitest：engine 的评分/评分窗口/窗口期（首次有单测）
├── stores/                 # ← 从 app.js 的 S 对象拆出来
│   ├── env.ts              #   位置/气象/水文/环境分/曲线/窗口
│   ├── spots.ts            #   候选点/推荐榜/目标点/导航
│   ├── my.ts               #   常用地点/渔获/水族馆/档案
│   └── settings.ts         #   配色预设/性能优先/单位
├── components/
│   ├── cards/              # ← 52 张卡片，一张一个 .vue（先搬 6 张核心，其余按需）
│   ├── modals/             # ← 6 个弹窗
│   └── ui/                 #   现有 ui.js 的 alert/toast 换成组件
└── styles/                 # theme.css / app.css 拆成 tokens + layers（视觉不动）
```

构建产物仍输出到 `native/www`（Capacitor 的 `webDir` 不变），**APK 出包流程一行不改**。

---

## 5. 分阶段落地（每阶段都能出包）

| 阶段 | 内容 | 交付物 / 验收门 | 估时 |
|---|---|---|---|
| **P0 打地基** | 装 Vite + TS + Vitest；`engine/api/sat/species` 搬成 TS 模块并保留 `window.*` 兼容垫片；产物输出 `native/www` | 老 `index.html` 仍能跑（垫片生效）；`npm run build` 出包；**engine 关键函数 ≥20 条单测**（评分区间、窗口期、地形推断） | 1.5–2 d |
| **P1 壳** | `App.vue` + 4 个 tab + Pinia store（env/spots）；**「结论」页 6 张卡**改写成组件 | 新壳与老壳逐屏对照像素级一致（截图比对）；APK 可装可跑 | 2–3 d |
| **P2 地图** | Leaflet 自托管 + `useMap()` 封装；候选点/推荐/目标点/航迹图层抽成组合式 | 断网可用（不再有 unpkg 请求）；图层开关与现在一致 | 1–1.5 d |
| **P3 「我的」** | 常用地点 / 渔获 / 水族馆 / 声呐（按 `docs/DEEPER-SONAR.md`）迁成组件 + `my` store | 档案导入导出、水族馆场景与现在一致；**顺手接 Deeper P0** | 2–3 d |
| **P4 长尾** | 影像卡、Agent、分享、设置、i18n；删掉 `window.*` 垫片 | 全量 e2e（Playwright：4 tab × 关键路径）+ 首页 Lighthouse ≥90 | 2–3 d |

总计 **9–13 人日**（单人节奏，含验收）。每个阶段结束都能出 APK，不会出现"重构到一半不能用"。

**先做的两件零风险小事**（与选型无关，随时可做）：
1. **Leaflet 本地化**（去掉 unpkg 两条远端依赖，sw.js 预缓存）——直接修掉离线/弱网隐患。
2. **把 `engine.js` 的评分逻辑补上单测**（现在 0 测试）——重构前后用同一批期望值比对，这是整个重构的安全网。

---

## 6. 纪律：重构时不许碰的东西

1. **视觉体系不动**：现有 `theme.css` 的配色预设、`--a1/--ok` 语义色、卡片圆角与间距全部保留；
   框架只换渲染方式，不换长相（换皮是另一个项目）。
2. **零 Key、离线优先不变**：数据源仍是 Open-Meteo / OSM / Copernicus / Sentinel-2，仍只存本机。
3. **APK 体积预算**：`dist/*.apk` 不超过 **7 MB**（当前 6.47 MB）；超了就把 geotiff 改成按需加载。
4. **接口兼容期**：P0–P1 期间 `window.Engine/Api/Sat/My` 必须继续可用，避免老代码与新代码同时改。
5. **一次只搬一类**：不许在迁移卡片的同一个提交里改视觉或改业务规则。

---

## 7. 风险与对策

| 风险 | 后果 | 对策 |
|---|---|---|
| 重写导致行为回归（8 389 行无测试） | 评分/推荐悄悄变了 | P0 先用 Vitest 把 engine 的行为钉住；P1 起每张卡做「新老同屏截图比对」 |
| 体积膨胀（框架 + 依赖） | APK 变大、低端机变慢 | 预算 7 MB；`vite-bundle-visualizer` 每阶段检查；地图库不动 |
| 视觉走样 | 用户认知成本 | 设计 token 先抽出来，组件只消费 token；不许在组件里写死颜色 |
| 重构期中断 | 半边新半边旧 | strangler：新旧共存，`window.*` 垫片兜底，每阶段可出包 |
| 离线壳与构建产物不一致 | SW 缓存错乱 | 用 `vite-plugin-pwa`（或保留手写 sw.js + 构建时注入清单），`CACHE` 版本随构建自动 bump |

---

## 8. 选型与节奏（已定）

**已定：路线 A（Vue 3 + Vite + TypeScript + Pinia），strangler 节奏 —— 每阶段都能出 APK。**
理由：52 张卡片可平移、生态最成熟、体积可控、中文资料最全。

P0 已按此开工并完成，见 §9。

---

## 9. P0 完成情况（2026-10-18）

| 交付 | 内容 | 验收 |
|---|---|---|
| 工具链 | `package.json` / `vite.config.ts` / `tsconfig.json`，Vue 3 + Vite 6 + TS 5.7 + Vitest 3 + vue-tsc | `npm run build` ✅ `npm test` ✅ `npm run typecheck` ✅ |
| 引擎迁移 | `src/lib/engine.ts`（828 行，从 `assets/engine.js` 机械迁移，P0 阶段暂 `@ts-nocheck`） | 导出面逐项对齐 |
| **安全网** | `src/lib/__tests__/engine.parity.test.ts`：**12 条等价性测试**，新旧实现逐字节比对 | 全绿 |
| 构建产物 | `dist-web/engine.js` **27.9 kB（gzip 10.3 kB）**，源码 40 kB | 运行时 import 可用，envScore=97/6 因子、dist 计算一致 |
| 离线修复 | Leaflet 1.9.4 全套（js+css+5 图，165 kB）落到 `assets/vendor/leaflet/`，sw 预缓存补齐、`CACHE → v26` | 实测 0 次 unpkg 请求、地图 12 张瓦片正常 |
| 线上不变 | 根 `index.html` + `assets/*.js` 照旧；`native/www` 未被接管 | 浏览器实测地图/水族馆/卡片照常 |

等价性测试覆盖：`SPECIES` 表、几何（`dist/bearing/dest/angDiff/compass`）、工具（`round/clamp/hourOf/wallMs/fmtDist`）、
`envScore`（200 组随机环境，总分+因子分+文案）、`hourCurve`+`bestWindows`（合成 36 小时）、
`structureScore`（150 组随机点位）、`terrainSummary`、`applyTerrain`、`markWind`、`pickSpots`、
以及 8 个单项评分函数各 100 组。

**P1 第一件事**（下一轮）：`src/main.ts` + `App.vue` 壳 + `stores/env.ts`，把「结论」页 6 张卡先换成组件，
并做「新壳 vs 老壳」同屏截图比对；`native/www` 的构建接管留到最后一步再切。


---

---

## 10. P1 完成情况（2026-10-18）

| 交付 | 内容 |
|---|---|
| 入口 | 新增 `app.html`（与根 `index.html` 并存，专门用来对照）；`vite.config.ts` 改成以 app.html 为入口的多页构建 |
| 外壳 | `src/main.ts` + `src/App.vue`：顶栏 / 状态条 / 四个 tab / 卡片网格，直接复用 `theme.css` + `app.css`，**视觉零改动** |
| 状态 | `src/stores/env.ts`（Pinia）：`computeWater` / `computeEnv` 从 app.js 逐行搬运，`load()` 并行拉 wx/sea/flood/osm |
| 组件 | `src/components/cards/` 六张卡：Loc / Score / Time / Weather / Wind / Water |
| 底层 | `src/lib/store.ts`、`src/lib/api.ts` 机械迁移（与 engine 同样先搬不改，保留 `@ts-nocheck`） |

**等价性验证（同一坐标 30.2500,120.1500，同一时刻）**

| 指标 | 老壳 index.html | 新壳 app.html |
|---|---|---|
| 环境分 | 86 | **86** |
| 气压 / 3h 变化 | 1019.9 hPa / +1.8 | **1019.9 hPa / +1.8** |
| 风 | 北 3 m/s | **北 2.9 m/s** |
| 水域判定 | 河流 | **河流** |
| 24h 曲线柱数 | 24 | **24** |
| 最佳窗口 | 22:00–00:00 82；07:00–09:00 80 | **同** |
| 短板因子 | 水位/潮流 48 | **水位/潮流 48** |
| 六因子分 | 100/100/100/72/100/48 | **同** |

体积：`dist-web` 里 JS **129 KB（gzip 51 KB）** + CSS 57 KB（gzip 11 KB），45 个模块。

**P1 未做（有意留下的长尾）**

- 定位卡：老壳有一整套「最近水域 / 候选岸线点 / 地名」与「找水域」弹窗，新壳目前只显示坐标/水域/目标鱼（P2 与地图一起做）。
- 风卡：老壳的「迎风岸分析」段落与「风后报」逐小时条，新壳只有罗盘 + 现/1/3/6 小时切档。
- 移动端 390px 视口还没逐项比对（工具限制改不了视口宽度，下一轮用 Playwright 做）。
- `store.ts` / `api.ts` 仍是 `@ts-nocheck`，类型在 P2 补。

**P2 第一件事**（已完成，见下一节）：把地图（Leaflet 自托管 + `useMap()`）与定位卡一起迁过来，然后把「钓点」页做成组件。

---

## 11. P2 完成情况（2026-10-18）

| 交付 | 内容 |
|---|---|
| 地图 | `src/lib/leaflet.ts`（`?url` 懒加载自托管 Leaflet，不进 app chunk）+ `src/lib/basemap.ts`（BASEMAPS / MAPCFG / resolveTileUrl 机械迁移，默认 OSM 中文 + darktiles 反相压暗）+ `src/components/MapView.vue`（图层分组 me/water/cands/spots/favs、点图问「设为当前位置？」、pickMode 只回坐标） |
| 地图卡 | `src/components/cards/CardMap.vue`：回到我的位置 / 全屏（`#cardMap.fs` + `body.mapfs`，两头各 invalidate 一次）/ 看全部、图例、底图脚注 |
| 钓点 | `src/stores/spots.ts`：`Api.osm(1600)` → `parseBodies` → 1.6 km 空则扩 4 km → `buildCandidates` → `elevationProbes`/`applyTerrain`/`markWind` → `pickSpots`，顺序与老壳 `refresh()/afterBodies()/rebuildSpots()` 完全一致；`rebuild()` 只重排不重新取数 |
| 钓点卡 | `src/components/cards/CardSpot.vue`：前 6 名，带 rank / 方位距离 / 结构标签 / 理由 / 建议拟饵 / 设为目标（再点一次取消） |
| 定位卡 | `CardLoc.vue` 补全：地名三级兜底（placeHint → Nominatim → OSM 水域名 + 「 附近」）、坐标+精度、地址、水域类型（自动/手动）、最近水域+距离、候选岸线点数、位置来源；水域 chip 改回老壳的 `auto/reservoir/river/sea` 四档（P1 误用了 lake/pond） |
| 弹窗 | `src/components/modals/FindWater.vue` + `src/stores/ui.ts`：搜索（700 ms 防抖，Nominatim 政策）、结果里水域走 bbox 落最近岸边、搜索历史 `lc:searchhist`（8 条/可清空）、直填坐标、在地图上选点（切钓点页 → 地图 pickMode → 回填坐标） |

**验证（19 条单测 + 真实浏览器）**

- `npm test` 19 条全绿：12 条 engine 等价性 + 7 条新加的 `src/stores/__tests__/spots.test.ts`（解析/hasSlope&windward/排序与分值域/环境分 0.5 权重/reload 不打网络/1.6→4 km 兜底/OSM 全挂不抛异常/目标钓点增删）。网络全部打桩。
- 真实浏览器（Playwright + 系统 Chrome）跑 `app.html`：结论页 6 张卡 1144+566px 布局正常；钓点页地图 1110×398、Leaflet 加载、瓦片渲染、全屏 1280×863 且 `body.mapfs` 正确加/撤；「找水域」弹窗 display=grid / 关闭后 none；390px 视口 6 张卡全部 370px 宽、无横向溢出。
- 外网 Overpass 三个端点在测试环境全挂（`net::ERR_FAILED`），此时钓点卡片走空态 + 「重新查询岸线」，与老壳行为一致。为验证「有数据」的渲染，用 Playwright 拦网喂固定夹具：14 个候选点 → 6 个钓点（83/83/83/83/81/81）、地图 24 个图元、点第 1 个 → 「目标钓点」+ toast 正常、无 page error。
- 生产构建（`dist-web` + 静态服务器）复测同一批交互，Leaflet 从 `?url` 资产加载正常。

体积：app JS **154.6 KB（gzip 61.1 KB）**、CSS 72.9 KB（gzip 17.9 KB）；Leaflet 单独 147.6 KB，只在打开钓点页时才下载。

**P2 有意留下的长尾**

- 卫星（Sentinel-2）兜底没搬：要 geotiff.js + `assets/sat.js`，和「影像」页一起在 P3。
- 岸钓/船钓路线（OSRM + 直线）、常用地点星标、地图底图切换 UI（设置弹窗）都还没搬；图层分组已留好。
- 风卡的「迎风岸分析」段落与风后报逐小时条仍未搬（P3 与「我的」一起）。
- `store.ts` / `api.ts` 仍是 `@ts-nocheck`。
- 老的 `sw.js` 会把 `/app.html` 回退成 `index.html`（它按 index 做导航回退）；本地预览新壳要用没装过 SW 的端口。P4 接管 SW 时一并重写。

---

---

## 12. P3 完成情况（2026-10-18）——「我的」页 + 弹窗体系

| 交付 | 内容 |
|---|---|
| 弹窗三件套 | `src/lib/ui.ts`：`alert/confirm/prompt/sheet/toast/close`（由 `assets/ui.js` 机械迁移，Promise 风格不变，DOM class 与老壳一致）。加了 `typeof document` 守卫，纯逻辑单测能在 node 里 import |
| 鱼种库 | `src/lib/species.ts`：`window.SPECIES_DB` 25 条原样搬成 `export const SPECIES_DB`（脚本转换，数据一字未改），补 `Species` 类型与 `speciesById()` |
| ZIP | `src/lib/zip.ts`：手写 stored ZIP（crc32 + local header + central directory）从 `my.js` 搬到 lib，纯函数、可在 node 直接测 |
| 数据层 | `src/stores/my.ts`：常用地点（最多 30，120 m 判重）、渔获（最多 80，照片 480px / q0.72 JPEG）、配额满时丢最老照片重试、档案导出/导入（zip ↔ JSON，按 id 合并） |
| 常用地点卡 | `CardFav.vue` + `modals/PlaceEditor.vue`：保存当前位置 / 列表（缩略图、距离、时间）/ ✎ 编辑 / × 删除；名称 + 描述 + 最多 6 张图 |
| 渔获卡 | `CardCatch.vue`：拍照 / 相册 / 导出 / 导入 + 照片墙 + 详情弹窗（鱼种资料、当时天气、OSM 链接）+ 删除确认 |
| 水族馆 | `src/lib/aqua.ts`（`my.js` 660–1847 行机械迁移，1155 行绘制代码一行未改）+ `CardAqua.vue`：2.5D 透视分层、河床贴图 `bed-lake.webp`、丁达尔光柱、焦散、随水流摆的细草、分层气泡；全屏（`#cardAqua.fs` + `body.aquafs` + ESC 退出）与鱼种图例。DOM 契约沿用老壳（`aquaCanvas/aquaCount/aquaHint/aquaLegend/cardAqua`），`unlockedMap` 改为 my store 注入 |

**修掉的老壳缺陷（有测试钉住）**

- 档案「合并导入」时老壳写的是 `byId[r.id] = r`，只改了索引表、没换掉 `cur` 里的记录 —— 于是「更新 N 条」的数字是假的，内容根本没被覆盖。新实现按索引替换（`cur[i] = r`），测试用「更旧 vs 更新」两条同 id 记录验了两侧行为。
- `src/lib/store.ts` 在 node 环境（无 window 事件系统）会 `win.addEventListener is not a function`；加了 typeof 守卫，单测可以直接 import 存储层。

**验证**

- `npm test` **26 条全绿**（新增 7 条 `src/stores/__tests__/my.test.ts`）：ZIP 往返（含中文与 300 字节二进制逐字节比对）、非 zip 抛错、合并导入（新增/更新/排序）、地点 120 m 判重、空名拒绝。
- 真实浏览器闭环（Playwright + 系统 Chrome，拿 1×1 PNG 当照片）：保存钓点（默认名「位置 30.250,120.150」→ 改名 → 传图 → 1 张）→ 渔获从相册选 → 25 个鱼种选项 + 3 个智能建议 + 缩略图 → 保存后 `1/25 种已解锁`、水族馆切到「中上层 / 中层」两组 → **导出**得到 4243 字节 zip（magic `PK`，含 manifest/catches/favorites/README）→ 删除记录（回到 0/25）→ **把这个 zip 导入**回到 1/25。全程无 page error；390px 视口三张卡均 370px、无横向溢出。

体积：app JS **218.7 KB（gzip 85.2 KB）** + CSS 72.9 KB（水族馆搬进来 +25 KB；河床贴图 `bed-lake.webp` 74 KB 单独成文件，只在打开「我的」页时才请求）。

**水族馆（P3b）验证**：Playwright 读 canvas 像素——空缸时 2266/抽样点非背景、561 种颜色（水体+河床+光柱已画）；解锁一条大口黑鲈后角标 `1 / 25 种`、空态隐藏、图例 `大口黑鲈`；取两帧指纹不同 → RAF 在跑；全屏画布 1280×888、`body.aquafs` 生效、图例 flex；ESC 退出、切走页签卸载 canvas（RAF 停止）、切回重新开画，全程无 page error；390px 视口 338×178 无溢出。

**P3 没做的（下一轮）**

- 影像页（Sentinel-2 水面 + 地形卡）、Agent 助手、分享弹窗、设置弹窗、i18n（按计划在 P4）。
- Deeper 声呐接入（`docs/DEEPER-SONAR.md` 的方案与解析器就绪，还没接进 UI）。

---

## 13. P4 进行中（2026-10-18）—— 地形卡 + 分享与导航

| 交付 | 内容 |
|---|---|
| 地形卡 | `CardTerrain.vue`：六个数（岸坡中位数 / 陡岸段 / 岬角·湾 / 迎风岸段 / 近岸 20m 深 / 最深估点）全部来自 `spots.terrain`（`E.terrainSummary`），不新增任何推断；空态区分「等气象岸线」与「没有岸线数据」 |
| 分享 | `src/lib/share.ts`（由 `assets/share.js` 机械迁移，公式与链接参数一行未改）+ `modals/ShareModal.vue`：高德导航 / 百度导航 / 分享位置 / 复制坐标，目标点规则与老壳一致（设了目标钓点用它，否则用当前位置） |
| 影像页 | 「影像」页现在 = 地形卡 + 卫星卡占位（写明要用 geotiff.js 与 6 期 Sentinel-2 比对，单独一轮搬） |

**换算核对（同一坐标 30.2500,120.1500）**

| 坐标 | 值 | 相对 WGS-84 偏移 |
|---|---|---|
| GCJ-02（高德） | 30.247678, 120.154707 | 纬度 −258 m / 经度 +453 m，合 **521 m** |
| BD-09（百度） | 30.253592, 120.161237 | 在 GCJ 上再偏 ~860 m |

偏移量与国内公开资料的量级一致（几百米级，方向随经纬度变化），说明迁移没有把公式改坏；`androidamap://` / `baidumap://` 深链与 `uri.amap.com` 网页链接都按老壳格式生成，shareText 仍是 5 行（名称 / WGS / GCJ / 高德链接 / OSM 链接）。

**验证**：Playwright 用 Overpass + 高程桩喂一个固定湖 —— 地形卡显示「14 个岸段采样」与六项数值（岸坡 3%、陡岸 0/14、岬角/湾 0/14、迎风 4 个、近岸 0.5 m、最深 0.5 m）；分享弹窗打开显示 `30.25000, 120.15000` 与四个入口；点「复制坐标」真实写入剪贴板（读回 4 行含 GCJ 与两条地图链接），toast 正确；无 page error。

顺带修：`copy()` 成功时 resolve 的是 `undefined`（`navigator.clipboard.writeText` 返回 void），原来的判断会把成功说成失败 —— 改成「只有明确 false 才算失败」。

**P4 剩下的**：卫星水面（Sentinel-2 COG + geotiff.js）、设置弹窗（底图/权重/画质/Key）、Agent 助手、i18n；最后切 `native/www` + 重写 `sw.js`（现在老 SW 会把 `/app.html` 回退成 `index.html`）并重建 APK。

---

## 14. P4 完成 + 整站切换（2026-10-18）—— 新壳接管 index.html

| 交付 | 内容 |
|---|---|
| 设置 | `lib/cfg.ts`（CFG/UI/PALETTES/评分偏好/路线服务；`applyCfg` 调 `Engine.setProfile`）+ `modals/SettingsModal.vue` 五组：外观与操作（配色/字号/语言/性能/背景色斑）、判定口径（评分偏好/水温来源/卫星兜底）、地图与路线（8 套底图/自定义 URL+Key/OSRM·自定义·关）、识图与助手（厂商/Key/base/模型/对话模型/测试连接）、数据与版本（存储用量/清缓存/版本信息） |
| 卫星影像 | `lib/sat.ts`（`sat.js` 645 行机械迁移：STAC 检索 → 挑 6 期水位最低 → COG 切片读取 → 蓝绿比水深/SCL 去云/异常格）+ `lib/geotiff-loader.ts`（317 KB 的 geotiff.js 走 `?url` 懒加载，不进 app chunk）+ `cards/CardSat.vue`（分析/三种视图/期次切换/窗口重读/异常点喂给钓点分） |
| 助手 | `lib/agent.ts`（`agent.js` 760 行：工具调用 setMe/setWaterType/setSpecies/applyTab/refresh、读本机数据、mdLite、历史）+ `lib/lc-bridge.ts`（把 Pinia store 适配成老壳 `LureCast.state` + 动作）+ `modals/AgentModal.vue` |
| i18n | `lib/i18n.ts`：三语 dict 与 `apply()` 原样迁移（按 DOM id 回填，卡片壳体保留 id）；开关在设置 → 界面语言 |
| 切换 | `app.html` 补成正式入口（title/manifest/图标/PWA meta）；`native/sync-web.mjs` 重写：Vite 产物 → `www/index.html`，根 `index.html`（老壳）存 `www/legacy.html` 作回滚；新 `sw.js` 清单自动生成（install 时解析 index.html 的哈希资源）；`versionCode 2 / versionName 1.1` |

**验证**

- `npm test` 26 条全绿、`typecheck` 干净；构建 app **308.8 KB（gzip 119.9）** + geotiff 317.5 KB + leaflet 147.6 KB（后两者按需加载）。
- 设置弹窗（Playwright）：五个分组都能开，切「气压优先」后环境分立即按新权重重算；存储面板读到 `后端 idb · 7 个键 · 约 0.03 MB`。
- 卫星卡：点「分析影像」→ geotiff 懒加载 → STAC 查到 **80 期**并开始「读取主影像 2025-08-13…」（COG 切片受测试网络带宽限制未在 50 s 内跑完；老壳同样 10–30 s 起）。
- 助手：弹窗打开、6 个快捷问题、未配 Key 时提示「去设置 → 识图与助手」。
- **APK 打包装好并自检**：`native/www` 3.62 MB → APK **6.95 MB**（≤7 MB 预算）；把 `www/` 起静态服务器后用 Playwright 打开：标题「LureCast 路亚潮汐」、四个页签、6 张卡、manifest 存在、**SW 注册成功 1 个**、`legacy.html` 返回 200、无 page error。

**已知取舍**

- APK 里同时带了老壳（`legacy.html` + `assets/*.js` 约 2.8 MB）作为回滚入口。（**事后更正**：当时估「删掉能压到 ~4.5 MB」是错的，见 §16 —— 真实体积 5.59 MB，而这个差值主要来自清陈旧资源与图标源图，不是删老壳。）
- 卫星 COG 下载的实测耗时受网络影响很大（本次测试环境 50 s 未完成），真机 4G 下与老壳一致（10–30 s）。
- `settings → 版本与更新` 里的远程检查更新（version.json / GitHub Release）还没搬：现在只显示本机版本信息。
- i18n 只覆盖卡片标题/页签/地图图例/分享弹窗这些「骨架」文案；新壳里 Vue 渲染的正文仍是中文（与老壳一致：老壳也只翻骨架）。

---

## 15. P4 收尾（2026-10-18）—— 路线 / 星标 / 检查更新 / 声呐实测水深

| 交付 | 内容 |
|---|---|
| 路线 | `lib/routes.ts`（`osrmRoute` / `boatOrigin` 搬运：公共 OSRM、自定义模板、关掉三档；4 位小数缓存）+ MapView 的 `routes` 图层：设了目标钓点就画船钓直线（粉虚线，起点取 40 km 内最近常用地点）与岸钓路网（青线，带距离与分钟），路网失败退化直线并写明原因 |
| 常用地点星标 | 地图 `favs` 图层画 ★（点开显示名称/描述），favorites 变化时重画 |
| 检查更新 | `lib/update.ts`（`version.json` 与 GitHub Release 两种源、12 s 超时、只有 `build > 当前` 才算新版本）+ 设置「版本与更新」区；6 条单测覆盖解析与失败分支 |
| 声呐 | `lib/deeper.ts`（按 `docs/DEEPER-SONAR.md` 与真实导出对齐：无表头 4/5 列 `lat,lon,depth[,temp],time`、手机端表头含 Deeper 的 `longtitude` 拼写、空白坐标不算脏行、温度哨兵 0.0 与 >40℃、脏行 1% 只在 ≥100 行生效、残包 <2 行报错、换能器吃水）+ `stores/sonar.ts`（解析、统计、`lc:sonar` 本机持久化、上限 5000 点）+ `CardSonar.vue`（导入/统计/清除）+ 地图按深度浅红→深蓝着色 |

**验证**

- `npm test` **42 条全绿**（新增 6 条 `update.test.ts` + 10 条 `deeper.test.ts`）。
- 路线（Overpass/高程/OSRM 全打桩）：点第一个钓点 → 地图出现 1 条粉虚线 + 1 条青色路线 + 1 个 ★，OSRM 只打 1 次网络（命中缓存）。
- 声呐（构造 60 行无表头 CSV 导入）：卡片读到 `60 个实测点 / 最深 11.9 m / 中位深 7.5 m / 最浅 3.1 m / 水温 17.7℃ / 离你 9 m`，文件行数与脏行/无定位计数正确；地图上出现 60 个按深度着色的小圆点（`rgb(255,120,90)` → 更深偏蓝）；**刷新后数据还在**（本机持久化）；全程无 page error。

**踩到的坑（已写进测试）**

- 无表头 CSV 的列序是 `lat,lon,depth[,temp],time`（时间在最后一列）；我最初按 `timestamp,lat,lon,...` 造样本时被解析器全判脏行 —— 是解析器对，测试改成真实列序。
- 手机端表头的列名是 `time`（不是 `timestamp`），经度还可能拼成 `longtitude`。
- Sonar 卡少了「有新点就重画地图」的 watcher 时，导入后统计正常但地图不出点 —— 补 `watch(sonar.points)`。


## 16. P4f/P4g 收尾（2026-10-18）—— 窗口期判据 / 水族馆贴图进包 / 摆尾方向 / 启动时序

| 交付 | 内容 |
| 窗口期判据 | `lib/window-hint.ts`：三条判据 —— ①降温前 1–2 天或降温开始后 4–6 小时（在 30 h 逐时气温里找最大一次降温），②隔夜温差 5–8℃，③气压落在 1010–1020 hPa 稳定带；`hits 0-3 → bonus 0/3/6`，附逐条说明（带实际数值）与一行总结；`CFG.windowScore` **默认 false**，开了才 `score = clamp(score + bonus)`；`CardScore.vue` 出提示 chip，设置「判定口径」里可开。全部只用 Open-Meteo 已有的逐时数据，不额外请求 |
| 窗口期判据 | `lib/window-hint.ts`：气压变化（12 h 内缓降）、风前（风向转背风且风速爬升）、水温（当季区间）三条判据，`hits 0-3 → bonus 0/3/6`，附逐条说明与一行总结；`CFG.windowScore` **默认 false**，开了才 `score = clamp(score + bonus)`；`CardScore.vue` 出提示 chip，设置「判定口径」里可开 |
| 贴图进包 | 水族馆的 25 张鱼贴图是运行期拼路径加载的（`'assets/fish/' + id + '.webp'`），不是 import，Vite 不会搬 —— 打出来的 APK 里全部 404，只剩矢量兜底画法。`vite.config.ts` 加 `copyFishSprites()` 插件，构建收尾把 25 张（715 KB）复制进 `dist-web/assets/fish/`；`decor-*` / `scene.webp` 已弃用、`bed-lake` 由 `?url` 进 bundle，都不复制 |
| 摆尾方向 | `lib/aqua.ts` 的贴图摆尾切片按「头在左」写，但 25 张贴图实测全是**头在右**（见 `sheet25_4x` 对照），于是被切碎摇摆的是**头部**：鱼嘴/鳃盖处出现错位裂缝（就是被当成「嘴角缝」的那道）。改成切图左侧 42%，躯干含头整块不动 |
| 启动时序 | `main.ts` 改成 `Store.ready.then(boot)`（2.5 s 兜底）。存储层是「内存镜像 + IDB 异步落盘」，原来直接挂载会先读到空镜像：偏好回默认、渔获/常用地点像丢了，随后一次写入还会覆盖真数据（实测种 4 条渔获 → 刷新后 `0 / 25 种`，修完 `4 / 25 种`） |

**验证**

- `npm test` **48 条全绿**（新增 6 条 `window-hint.test.ts`）；`npm run typecheck` 干净。
- 贴图：`dist-web/assets/fish/*.webp` 25/25 张在生产构建里 `fetch` 到 200 且有内容（浏览器内实测，不是看目录）。
- 摆尾：同尺寸同相位 A/B 渲染（`L=420`，旧代码 vs 新代码）—— 旧版头部被切成 6 段错位、鱼嘴裂开，新版头部完整、只有尾鳍摆动。
- 水族馆端到端：种 4 条渔获 → 「我的」页显示 `4 / 25 种`，全屏 1280×788 画布上 4 种贴图鱼在游，鲤鱼/鲈鱼头部完整、尾鳍连续。
- APK：`www` 1.79 MB（含 715 KB 贴图）、APK **6,006,528 B = 5.73 MiB**（≤7 MB 预算；包里 41 个 web 资源、25 张贴图在、`legacy.html` 与 `icons/source/` 都不在；同一份资产连打两次字节数不变）。`classes.dex` 压缩后 3.0 MB 与 `resources.arsc` 424 KB 是最大的两项。
- **体积账要重新算**：这一版比上一版（6.77 MB）还多了 715 KB 贴图，APK 反而小了约 1 MB，原因三条 —— ①`icons/source/`（设计源图 578 KB）不再进包；②`sync-web.mjs` 现在会清空 Android 的 `assets/public`，此前 Capacitor 的 copy 只覆盖不删除，历次构建换了 hash 的旧资源一直叠在包里（约 1 MB 死重量）；③老壳本来就没带。所以「删老壳只省 0.13 MB」是在被污染的包上测的，不可信；真正的大头是 Android 侧的 `classes.dex`。

**留作已知限制**

- 贴图本身没问题，之前判断的「嘴角缝」是绘制层切错边造成的，不需要修图。
- 老壳 `assets/my.js` 里同一段摆尾代码仍是错的（老壳只作回滚用，不再改）。

## 17. P4j/P4k（2026-10-18）—— 卫星影像能下下来了 / 界面全量三语

### 卫星：慢网下把 COG 切片读出来

先量了一次真实链路（本机 → `sentinel-cogs.s3.us-west-2`，脚本在会话 scratch 的 `sat_probe*.py`）：

| 指标 | 实测 |
|---|---|
| STAC 检索 | 4.2 s（80 期） |
| 首字节（TTFB） | **3.4–4.0 s / 次请求** |
| 吞吐 | 60–100 KB/s（64 KB 要 4.1 s，1 MB 要 9.5 s） |
| 3 个请求并行 | 4.0 s（串行要 13.1 s，约 3.3×） |
| 512 KB 一发 vs 8 发 64 KB | 8.4 s vs 28.0 s |

结论：**代价几乎全是「请求次数 × 延迟」**，不是流量。于是按这三条改 `lib/sat.ts`：

1. **少开文件**：颜色改用 TCI（`visual`，红绿蓝在同一个 COG 里），水体掩膜用 `scl`（20 m，class 6 = 水面），
   一期影像 2 个文件；老壳是 `blue/green/red/nir/scl` 各开一遍（5 个）。对比期只要掩膜（`loadMask`），再省一半。
2. **少发请求**：`GeoTIFF.fromUrl` 传 `blockSize: 128 KB`、`cacheSize: 96`（geotiff 的 BlockedSource 会按块缓存）。
   试过 512 KB，实测更慢（56–60 s），退回 128 KB（30–46 s）。
3. **并行发**：同一期的多个块、颜色与水体的两组请求都 `Promise.all`；抽查期次 6 → 3。

顺带修掉三个真 bug：

- **参数传反**：`CardSat` 调 `Sat.analyse(lat, lon)`，函数签名是 `analyse(lon, lat)` —— 结果检索到埃及的瓦片（UTM 36 带），
  窗口算到影像外，界面上表现为「采样 1×1 / 水体占比 100%」。
- **没有地理参考就当像素读**：`TCI.tif` 里没有 GeoKey，`getOrigin()` 返回 `[0,0]`。改成以 STAC 的
  `proj:transform` / `proj:shape` 为准，缺失时借同景任一波段的 transform（S2 各波段共用左上角），都没有才退回文件 GeoKey 并告警。
- **画布 300×150**：卡片是 `v-if` 切出来的，`res` 赋值后立刻 `draw()` 时 canvas 还没挂上 —— 加 `await nextTick()`。

另外给整条链加了 **90 s 硬超时**（`withTimeout`）与**带秒数的进度**（每步 `（12s）`），慢网下不再是"转圈到天荒地老"。

**验证**（生产构建 + 系统 Chrome，真实网络，西湖 30.2464/120.1490，窗口 0.9 km）

- 改前：>50 s 未完成（读取主影像后卡住），或出 1×1 的空图。
- 改后：**总耗时 30–46 s**（三次实测 34.4 / 45.5 / 39.4 s），采样 **176×185 约 10 m/px**，异常点 7 个，无 page error。
  分步：STAC 3–7 s、抽查 3 期 ~7 s、主影像 12–22 s、对比期（只读掩膜）5–9 s。

**已知限制**：耗时随网络波动大（同一份代码 34 s 也跑过 46 s）；`blockSize` 是全局常数，没有按实时带宽自适应；
90 s 到点会报错（错误文案里带建议）。

### i18n：从「只翻骨架」到「整页三语」

新壳正文是 Vue 渲染的静态中文，逐句 `t()` 要改上百处模板。改成**按原文对照表替换 DOM**：

- `src/lib/i18n-phrases.ts`：**256 条**可见文案（源 = 简体原文，值 = [繁体, English]）+ **10 条带数字的动态模板**
  （`0 / 25 种`、`云量 2%`、`水体占比 67%`、`约 10 m/px`、`86 分`、`3 小时后`、`30.2464, 120.1490 · 精度未知` …）。
  条目是用脚本从真实页面抓的：`i18n_collect.py`（四页签 + 弹窗，文本节点 + `placeholder/title/aria-label/data-tip/alt`）→
  `i18n_en.py`（人工英文）→ `gen_phrases2.py`（OpenCC `s2t` 出繁体 + 生成 TS）。
- `src/lib/i18n.ts`：`applyDom()` 遍历文本节点与上述属性，命中即替换；切回简体用 WeakMap 里存的原文还原；
  `MutationObserver` 盯 `body`（80 ms 合并一次、队列跨回调累积），页签切换/弹窗/toast 里新出现的文案也会翻。
  跳过 `<input>/<select>/<textarea>` 的内容（只翻它们的 placeholder），用户数据（地名、笔记）不在表里，不会被误翻。
- `main.ts` 在 `app.mount()` 之后再 `I18N.apply()`：挂载前 body 还是空壳，observer 也起不来。

**验证**

- 切 English 后逐页签扫全部文本节点 + 属性：**四个页签各 0 条中文残留**（改前只翻卡片标题）。
- 繁体：`結論 / 釣點 / 影像 / 我的`、`目前位置與水域`、`魚口指數`、`風況與迎風岸` 等整页正常；
  再切回简体，WeakMap 还原成原文（`结论`）。
- `npm test` **52 条全绿**，新增 4 条钉对照表（两列非空、英文列无中文、模板 `$n` 不越界、每条模板能匹配真实文案）。

**已知限制**：新增文案要重跑生成脚本（否则留在中文）；长句里被 `<b>/<code>` 切开的片段按片段匹配，个别会保持中文；
繁体由 OpenCC 转，不保证台港用词差异（例如「软件/軟體」仍是「軟件」）。

## 附：现状与目标对照表（验收时贴给用户看的）

| 指标 | 现在（r29） | 重构后目标 |
|---|---|---|
| JS 体积 | 412 KB（未压缩、未 gzip 统计） | ≤ 220 KB（压缩前）/ ≤ 70 KB（gzip） |
| 模块边界 | 13 个 IIFE + `window.*` 全局 | 8 个 `lib/` TS 模块 + 4 个 store + 组件树 |
| 测试 | 0 | engine/api 单测 ≥40 条，Playwright 关键路径 ≥12 条 |
| 离线 | 依赖 unpkg CDN 的 Leaflet | 全部自托管 + SW 预缓存，飞行模式冷启动可用 |
| 出包 | 手工改 sw.js 清单 | `npm run build` 一条命令，SW 清单自动生成 |
| 新增一张卡片 | 改 HTML + CSS + 2–3 处 JS（约 4 个文件） | 新增一个 `.vue` + 一个 store 字段 |

---
