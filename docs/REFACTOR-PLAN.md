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
