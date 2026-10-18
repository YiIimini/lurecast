# LureCast × Deeper 声呐：接入方案（技术稿）

> 目标读者：后续接手实现的人（或我自己下一轮）。
> 现状基线：`r29`（25 种鱼贴图 + 水族馆水层 + 地形卡片六格全是 DEM 推断）。
> 本文只定方案，不含实现；每节末尾标了「验收」，能照着验。

---

## 0. 一句话结论

Deeper 的导出是**逐点 CSV（纬度/经度/深度/水温/时间戳）**，不是等深线矢量。
所以本项目的接入方式不是"接一个地图图层"，而是**把一条航迹上的实测深度点，当成「近岸水深 / 岸坡 / 水下起伏」三处的真值来源**，
覆盖掉现有 DEM 外推值，并在卡片上同时给出「推断 ↔ 实测」对照——这也是这个 App 一直坚持的"可解释、不黑盒"。

---

## 1. 目标与非目标

**做**
1. 导入 Deeper 导出文件（手机 App 单文件 CSV 优先，Quest zip 次之），本地解析，不联网。
2. 把扫描画到首页地图上（等深分档折线 + 最深点），点一下能跳到那个位置。
3. 测出的水深/坡降进「地形结构」卡片，与推断值并列对照；够得着的时候**校准**点位结构分里的近岸水深一项。

**不做**
- 不做等深线插值成矢量面（点数不够，做出来是假的，且会让人误以为是官方测绘图）。
- 不接 Deeper 云端（没有公开 API，反向不稳定），不读设备实时蓝牙流（那是另一个量级的工作）。
- 不用 Deeper 的水温去替换 `engine.js` 的水温代理（Deeper 测的常是表层/探头附近水温，代理用的是气温+海温模型，混用会让评分口径变浑）。水温只做「实测参考」展示。

---

## 2. Deeper 的数据到底长什么样

### 2.1 两条导出路径

| 路径 | 产出 | 内容 | 本方案优先级 |
|---|---|---|---|
| 手机 App：Lakebook → 扫描右侧「⋮」→ *Export scan data as CSV* | 单个 `scan_data_*.csv` | **5 列**：纬度、经度、深度、水温、时间戳。**不含原始声呐回波** | **P0（先做这个）** |
| Lakebook 网页 / Quest 原始导出 | zip：`bathymetry.csv` + `sonar.csv` | `bathymetry.csv` 与上面同构；`sonar.csv` 是逐次 ping 的回波（可推鱼群/水草） | P4（依赖真实样本） |

### 2.2 单文件 CSV 的列定义（实测口径）

| 列序 | 字段 | 含义 | 单位 | 备注 |
|---:|---|---|---|---|
| 0 | `latitude` | 纬度 | 十进制度 | **无 GPS 定位时写 0**（真实存在大量 0/0 行） |
| 1 | `longitude` | 经度 | 十进制度 | 同上 |
| 2 | `depth` | 水深（换能器→水底） | m | 空行要跳过；采样率最高约 15 次/秒 |
| 3 | `water temperature` | 水温 | ℃ | 可空；合法域按 0 < t ≤ 40 过滤 |
| 4 | `time` | 时间戳 | 数值（秒或毫秒） | 用 `> 1e12` 判断是 ms |

- 深度采样 ~15 Hz、GPS 约 1 Hz ⇒ **同一秒内会有十几行共用同一个坐标**，这是正常的，不是重复脏数据。
- 首行有表头（小写包含 `latitude` / `depth` / `time`）；分隔符是逗号，但**要做 `;` 兜底**（部分区域设置）。
- 文件可能带 UTF-8 BOM、CRLF 行尾；单行文件＝残缺包，直接拒收。
- 单位：**首版按米解析**。App 界面能切英尺，导出是否跟着切没有样本证实 —— 所以不做自动换算，只在「最大深度 > 60 m 且中位深度 > 20 m」时提示"像是英尺，请确认"。

### 2.3 来源与交叉核对（避免把假设写成事实）

1. **官方口径**：Deeper 的调研/测绘说明页面写明测绘 CSV 含 *"latitude, longitude, depth, timestamp, water temperature"*；
   原始导出说明另提到 `Bathymetry.csv` 与 `Sonar.csv` 两份，并明确「**无 GPS 时经纬度为 0**」。
2. **列序来源**：上面那张 5 列表不是从官方文档抄的，而是从一份处理手机端导出的开源实现反推（它按 `f[0..4]` 取
   lat / lon / depth / temp / time，并要求首行小写后含 `latitude`/`depth`/`time`），与官方列举顺序一致。
3. **仍未证实的两点**（首版按最保守处理，别当结论）：
   - 单位：官方导出按米，但 App 界面可切英尺；首版只做异常提示，**不自动换算**。
   - `sonar.csv` 的二进制布局与采样率：没有样本，不动它。
4. **需要你给的东西**：一份真实 `scan_data_*.csv`（坐标可以打乱，我只需要列结构）。
   §8 的验收项全部依赖它——没有样本之前，只能说"按样本形态设计"，不能说"已验证解析正确"。
5. 本文附的解析骨架已按 §8 的构造样本跑过 6 个用例（正常 / 含 0-0 行 / 脏行 50% / 单行残包 / 无表头+分号+BOM / 无定位），
   行为与设计的错误码一致；但**真实文件仍未验过**。

---

## 3. 内部数据模型

```js
// 单点（Fix）：解析后的最小单元，字段名与 CSV 解耦
{
  lat: 30.1234, lon: 120.1234,   // 十进制度（WGS84，与 Leaflet/OSM 一致，不做投影）
  tMs: 1792290000000,            // 毫秒时间戳（秒值 ×1000）
  depthM: 4.2,                   // 水面下深度（= CSV depth + transducerOffsetM）
  tempC: 18.4,                   // 可空
  gpsOk: true                    // false 表示该行是无定位的 0/0 行（保留在时间轴，不进地图）
}

// 一段（Segment）：实时扫描里 GPS 断过、或两次出钓是同一天两个湖，都要切开
{ id: 'seg0', points: [Fix…], startedAt, endedAt }
// 一次导入（Scan）
{
  id: 'snr_1792290000000_ab12',  // 时间戳 + 随机后缀，本地唯一
  name: '千岛湖-东南湾 10-18',    // 默认用「文件名 + 日期」，可改
  source: 'mobile-csv' | 'quest-zip',
  importedAt: 1792290000000,
  transducerOffsetM: 0.15,        // 可配置：探头吃水
  bbox: [minLat, minLon, maxLat, maxLon],
  trackKm: 1.83,                  // 航迹长度（GPS 有效点连线的球面距离和）
  segments: [Segment…],
  stats: SonarStats
}

// 卡片与地图都要吃的统计量（一次算好落盘，列表页不重算）
{
  rowsTotal: 128340, rowsSkipped: 90,   // 脏行数，用于「数据质量」小字
  fixesTotal: 8210, fixesGps: 8044,     // 有效定位点
  depth: { min: 0.6, p25: 1.9, median: 3.4, p75: 5.2, max: 11.8, sd: 1.7 },
  tempC: { min: 17.2, max: 19.1, median: 18.3 } | null,
  bedSlopePct: { median: 8.4, p90: 21.0 },   // 相邻点坡降，见 §6.2
  histo: [ {le:1}, {le:2}, … ] ,             // 等深分档直方图，卡片画迷你柱
  deepest: { lat, lon, depthM },              // 最深点（地图打点）
  quality: { gpsGapRatio: 0.02, spanHours: 2.4 }
}
```

**抽稀**：地图与计算都用 LTTB（Largest-Triangle-Three-Buckets）抽到 **≤ 4000 点**；统计量用**抽稀前**的全量点算（统计不怕多、渲染怕多）。

---

## 4. 前端解析路径（文件级改动）

### 4.1 新增 `assets/deeper.js`（约 300–350 行，零依赖，UMD 挂 `window.Deeper`）

```
Deeper.parseFile(file) → Promise<{scan} | {error}>
Deeper.parseText(text, opts) → {scan} | throw
Deeper.statsOf(scan) → SonarStats
Deeper.sampleIndex(scan, lat, lon, radiusM) → { depthMedian, count, dist }   // 给打分用
Deeper.toGeoJSON(scan) → 折线/点（地图层用，不带 Leaflet 依赖）
```

流水线（顺序不能乱）：

1. **读**：`await file.text()`（Capacitor 下也能用）；>8 MB 走 `Blob.stream()` 分块，UI 显示「解析中 38%」。
2. **去 BOM / 统一行尾**：`^\uFEFF` 剥掉，`\r\n|\r` → `\n`。
3. **判分隔符**：首行逗号数 vs 分号数，取多者。
4. **表头嗅探**：首行小写化后含 `lat` + `depth` + `time` ⇒ 按名字取列；否则按位置 0..4 取。列顺序以嗅探结果为准，**不假设固定顺序**。
5. **逐行映射**：字段数 ≠ 5 → `rowsSkipped++`；`depth`/`time` 空或非数值 → 跳过；`temp` 空或不在 (0,40] → 置 null（**不丢整行**）。
6. **0/0 行处理**：`lat==0 && lon==0` ⇒ `gpsOk=false`，**保留**（用来算「无定位占比」质量指标），但绝不进地图、不进距离计算。
7. **分段**：`gpsOk` 由真变假再变真、或相邻两点时间差 > 30 s、或位移速度 > 12 m/s（船不会更快）⇒ 切新段。
8. **单位兜底**：`stats.depth.max > 60 || median > 20` ⇒ 打 `MaybeFeet` 警告（不自动换算，让人确认）。
9. **抽稀 + 统计 + bbox**（见 §3）。
10. **网格聚合（给地图着色）**：把抽稀点按约 25 m 网格落桶，每桶取中位深度 ⇒ `grid: [{lat, lon, depthM}]`，点数 ≤ 2000。

错误码（UI 用中文短句 + 一个「怎么办」）：

| code | 触发 | 给用户的话 |
|---|---|---|
| `NO_ROWS` | 没有数据行 | 这个文件里没有数据行，确认是从 Deeper App 导出的 CSV |
| `STUB_FILE` | 只有 1 行 | 这看起来是残缺文件，重新导出一遍 |
| `MALFORMED` | 脏行 > 1% | 文件格式不像 Deeper 导出（脏行 12%），请在 App 里重新导出 |
| `NO_GPS` | 全部 0/0 | 这次扫描没有定位，只能看水深和时间，画不到地图上 |
| `TOO_BIG` | > 40 MB | 文件太大，先在 Deeper 里拆成几次扫描 |

### 4.2 入口 UI（`index.html` + `app.js`/`my.js`）

- 在「我的」里、`cardCatch`（渔获档案）之后插一张同款卡片 `cardSonar`：
  - 头部：标题「声呐扫描 · Deeper」+ 右上 `导入 CSV`（`<input type="file" multiple accept=".csv,.zip,text/csv">`）
  - 空态：`<b>还没有声呐数据</b><p>在 Deeper App 里打开一次扫描 → ⋮ → Export scan data as CSV，再回来导入。</p>`
  - 列表行：`名称 · 8,210 点 · 0.6–11.8 m · 10-18` + 操作「定位」「删除」「用于地形」
  - 底部一行小字说明：只存本机、不联网、导出的档案里默认不含扫描（可勾选）。
- 删除要 `UI.confirm`（删了不可恢复）；重复导入同一文件（按 `id`+`fixesTotal`+`bbox` 判重）给出「这条已经导入过」而不重复存。

### 4.3 存储（沿用 `Store` 同步门面）

| 键 | 内容 | 体量 |
|---|---|---|
| `lc:sonar:index` | `[{id,name,date,fixesTotal,depthMin,depthMax,bbox}]` 元数据数组 | 每条 <300 B |
| `lc:sonar:v1:<id>` | 完整 Scan（抽稀点 + 统计 + grid） | 每条约 40–80 KB |
| `lc:sonar:active` | 当前「用于地形」的 scan id（可多个 → 数组） | <100 B |

- 上限：**20 条 / 3 MB**，超了先提示删最旧（与渔获档案同一套配额话术）。
- 导出档案（`my.js` 的 `buildArchive`）：默认**不含**扫描体积；勾选后以 `sonar/<id>.json`（抽稀后）入包，回导时按 id 去重。
- 快照（`lc:snap:v2:*`）里不存扫描点数，只存 `sonarStats` 摘要（卡片要用的那几个数），避免快照膨胀。

### 4.4 地图叠加（`app.js` 的 `drawMap` 一带）

`S.layers.sonar = L.layerGroup().addTo(S.map)`，三层：

1. **等深分档折线**：把每段的相邻点连线，按深度分成 6 档（`<1 / 1–2 / 2–4 / 4–6 / 6–8 / >8 m`），每档一个 `L.polyline`（细、半透明、不发亮），颜色沿用现有水色阶；不用逐点 circleMarker（8000 个点会卡）。
2. **最深点**：`L.circleMarker` + 一个 500 m 的 `L.circle`（虚线），popup 写「实测最深 11.8 m · 10-18」。
3. **航迹**（可关）：`L.polyline` 虚线，方便回头看出钓路线。

性能：默认只画 `active` 的扫描；多选时按点数从多到少排，超过 12000 点只画网格聚合后的代表点。

---

## 5. 与「地形结构」卡片的融合（重点）

### 5.1 现状与原则

现在这张卡是六格推断（`renderTerrain`：岸坡中位数 / 陡岸段 / 岬角·湾 / 迎风岸段 / 近岸 20 m 深 / 最深估点），
数据来自 OSM 岸线 + Copernicus DEM 90 m 外推，卡片底部明确写「不是水下实测」。

**融合原则（三条，别破）**
1. **不替换口径，只做"实测覆盖 + 对照"**：用户随时能看出哪一格是实测、哪一格还是推断。
2. **不放大精度**：实测只报到 0.1 m / 1%，不给「精确到厘米」的错觉。
3. **可撤销**：把扫描从"用于地形"里移除，卡片与评分必须逐字节回到原状（这是验收项）。

### 5.2 卡片长什么样（导入后）

```
地形结构                            12 个岸段采样 · 声呐 1 段
┌──────────┬──────────┬──────────┐
│ 岸坡中位数│ 陡岸段    │ 岬角 / 湾 │
│ 14 %     │ 5/12     │ 3 / 4    │
│ 岸上 120m│ 坡度≥10% │ 岸线凸凹  │
├──────────┼──────────┼──────────┤
│ 迎风岸段  │ 近岸 20m深│ 最深估点  │
│ 4 个     │ 2.3 m 🎯 │ 6.1 m 🎯 │      🎯 = 实测
│ 风向正吹向│ 声呐实测  │ 声呐实测  │
├──────────┼──────────┼──────────┤
│ 实测岸坡  │ 实测水深  │ 水下起伏  │   ← 新增三格，仅导入后出现
│ 8.4 %    │ 0.6–11.8 m│ sd 1.7 m │
│ 航迹中位  │ 中位 3.4 m│ 起伏明显  │
└──────────┴──────────┴──────────┘
底部：主体仍为 DEM 推断；🎯 格来自 Deeper 实测（10-18，本机数据）。
```

映射细则（逐格）：

| 卡片格 | 实测怎么进 | 覆盖条件 | 副文案 |
|---|---|---|---|
| 近岸 20 m 深 | 钓点 20 m 半径内扫描点中位深度 | 命中点 ≥ 5 且在 bbox 内 | `声呐实测`；悬停 `推断 1.4 m ↔ 实测 2.3 m` |
| 最深估点 | 扫描 bbox 覆盖该钓点时，取区域 `depth.p90`（估算该点外推的那一档），**不冒充"该点最深"** | bbox 命中 | `区域实测` 而非 `该点实测` |
| 岸坡中位数 | **不覆盖**（DEM 的岸坡是岸上地形，和水中坡降不是一回事） | — | 保持推断，加尾注 `水中坡降见「实测岸坡」` |
| 陡岸段 / 岬角·湾 / 迎风岸段 | 不覆盖（与声呐无关） | — | 不动 |
| 实测岸坡（新） | 相邻点坡降中位 % | 有 ≥30 个有效坡降样本 | `航迹中位` |
| 实测水深（新） | min–max + 中位 | 一定有 | 采样日期；>30 天标灰「旧数据」 |
| 水下起伏（新） | 深度标准差 + 等深分档熵 | 点数 ≥100 | `起伏明显 / 平缓` |

- **`terrainNote`**（右上角）：`12 个岸段采样` → `12 个岸段采样 · 声呐 1 段`；点它弹一个小菜单：`只看推断 / 只看实测 / 全部`（默认全部）。
- **配色**：实测标记用现有语义色 `--ok`（成功/在线绿），不引入新色，避免和主题预设打架（这条是 r23 图标统一时就定下的规矩）。

### 5.3 进评分（校准，而不是重算）

`engine.js` 的 `structureScore` 里近岸水深权重 0.10：

```js
if (c.depth20 != null) { depthV = c.depth20 >= 2.5 ? 92 : ... }
parts.push({ w: 0.10, v: depthV, txt: depthTxt });
```

融合三档，写在 `applySonarToSpots(spots, scans)` 里，**不改现有函数签名**，只改入参 `c`：

1. **`c.depth20` → 实测覆盖**：钓点 20 m 内有 ≥5 个扫描点 ⇒ `c.depth20 = sonarSample.depthMedian`，`c.depthSource='sonar'`；
   理由文案变成 `近岸 20 m 实测 2.3 m（推断 1.4 m）`。
2. **区域标定**（覆盖不到该点、但同一片水域有扫描）⇒ `c.depth20 *= clamp(区域实测中位 / 区域DEM中位, 0.6, 1.6)`，`c.depthSource='calibrated'`，
   理由里写 `按同水域声呐标定 ×1.4`。**这是默认关的**，要在设置里显式打开（避免一个远处的扫描污染整片水域）。
3. **无覆盖** ⇒ 现状不变。

**不动的部分**：`水温水层`、`环境分`、`窗口期`。Deeper 水温只进卡片当参考，理由同 §1。

### 5.4 与其它已有数据的关系（避免打架）

| 已有 | 与声呐 | 处理 |
|---|---|---|
| 历史影像水下结构（Sentinel-2 候选） | 都是"水下结构"，但一个来自枯水期影像、一个来自实测点 | 卡片上分两行；若某候选点 50 m 内有实测且实测深度 >3 m，把该候选标 `已被声呐否定`（影像说是浅脊、实测是深水）——**这是很有价值的一条交叉校验** |
| 点位结构分（岸坡/岸型/迎风/水深） | 只动 `水深` 一项 | 见 §5.3 |
| 渔获档案 | 同一次出钓的扫描与渔获可并列 | 卡片列表里显示「同日有 2 条渔获」，点开看详情（P3 可做） |

---

## 6. 计算细节（防止"假精确"）

### 6.1 距离与坐标系
- 全部 WGS84 经纬度，距离用现有 `Engine.dist`（球面 haversine），不引 proj4。
- 不做地理围栏校正；20 m 半径的采样用**平面近似**（纬度 111.32 km/°，经度 ×cos(lat)）。

### 6.2 水中坡降（bed slope）
- 相邻两个 `gpsOk` 点距离 `d`，当 `1.5 m ≤ d ≤ 15 m` 才算一对（太近是 GPS 抖动，太远是跳点）。
- `slope = Δdepth / d`；剔除 `|slope| > 1`（45°，多为 GPS 跳变）；取 `median` 与 `p90`。
- 卡片只报 median，`p90` 留给"有没有坎"的判断。

### 6.3 深度基准
- CSV 的 `depth` 是**换能器到水底**；本 App 统一用「水面下深度」。
- `depthM = csvDepth + transducerOffsetM`，默认 `0.15`，可在扫描详情里改（默认值写进 Scan，随数据落盘）。
- 不做水位修正（没有当天水位就不假装修正），卡片小字注明「未做水位修正 · 采样日 10-18」。

### 6.4 网格与着色
- 25 m 网格落桶取中位；地图着色用 6 档等深色阶（现有 `sat.js` 的色带复用）。
- 插值只在地图渲染时做 IDW（p=2、取 3 邻居、64×64 网格），**不落盘**，避免把插值结果当"实测"存下来。

---

## 7. 分期与工作量

| 期 | 内容 | 估时 | 可独立验收 |
|---|---|---|---|
| **P0** | `assets/deeper.js` 解析（含错误码）+ `我的` 卡片（导入/列表/删除/详情）+ 存储与配额 | 0.5–0.8 d | 用手机真实 CSV 能导入、列表与统计正确 |
| **P1** | 地图叠加（等深折线档 + 最深点 + 航迹）+ 定位跳转 + 多扫描选择 | 0.8–1 d | 8000 点扫描在 360 px 手机视口不卡（滚动 ≥50 fps） |
| **P2** | 地形卡融合（覆盖 + 🎯 + 三个新格 + `terrainNote` 切换 + 悬停对照） | 1 d | 卡片六格出现实测与对照；移除后逐字节回原样 |
| **P3** | 打分校准（§5.3 档 1 默认开、档 2 默认关）+ 理由文案 + 设置开关 + 与影像候选的交叉否定 | 0.8 d | 同天气同扫描下，结构分变化可解释 |
| **P4** | Quest zip（`bathymetry.csv` + `sonar.csv`）：先只吃 bathymetry，sonar 回波推鱼群/水草待样本 | 1 d+ | 拿到真实 zip 再排期 |

依赖：P1 依赖 P0；P2 依赖 P0；P3 依赖 P2。P4 可随时插。

---

## 8. 验收清单（照着打勾）

1. **解析正确性**：真实 `scan_data_*.csv`（≥5000 行）
   - `fixesTotal + rowsSkipped + zeroRow == rowsTotal`（三者必须闭合）
   - 最深点坐标与 Deeper App 里显示的一致（误差 <20 m）
   - 手机端解析耗时 <600 ms（中端机；用 `console.time` 记录）
2. **脏数据**：构造三种样本——(a) 含 0/0 行 (b) 含空行/列数不符 (c) 单行残包 —— 分别命中预期错误码或跳过计数。
3. **单位兜底**：把深度 ×3.28 假装英尺，必须弹 `MaybeFeet` 提示而不是直接画一条 30 m 深的湖。
4. **卡片**：导入后 `近岸 20m 深`、`最深估点` 变实测（🎯）；`岸坡中位数` **不变**；取消勾选后卡片与评分回到导入前（`JSON.stringify` 逐字符比对）。
5. **可撤销**：删除扫描后 `lc:sonar:*` 清空、地图层清空、卡片回到六格。
6. **不回归**：没有导入任何扫描时，跑一次现有回归（`node --check` + 三处端到端 + 视口截图），结果与 r29 一致。
7. **隐私**：断网后导入/查看/删除全部可用；导出档案默认不含扫描。

---

## 9. 风险与已定取舍

| 风险 | 影响 | 取舍 |
|---|---|---|
| 没有官方字段文档，只有实测样本 | 表头/单位变体 | 嗅探 + 位置兜底 + 单位异常提示；**不硬编码列序** |
| 一份扫描只覆盖一片小水域 | 容易被误用成"整湖地形" | 卡片只在 bbox 命中时才覆盖；区域标定默认关 |
| 0/0 行占比可能很高（岸边走动时） | 点数虚高、统计失真 | 单列 `gpsOk` 统计，卡片显示的是**有效定位点数** |
| 抽稀后地图可能"少几个弯" | 视觉与实测不符 | 抽稀用 LTTB 保形；同时给「航迹长度」与「有效点数」两个口径 |
| 隐私（钓点即鱼窝） | 泄露 | 只存本机、不上传、不参与分享；导出档案需显式勾选 |
| Quest 的 `sonar.csv` 二进制/采样率不明 | P4 无法估 | 等真实 zip 样本，先只做 bathymetry |

---

## 10. 落地清单（改哪些文件）

| 文件 | 改动 |
|---|---|
| `assets/deeper.js` | **新增**：解析、统计、采样索引、GeoJSON 导出（无 Leaflet 依赖） |
| `assets/app.js` | `S.scans/scansIndex` 状态；`renderSonarCard()`；`drawMap` 里加 `S.layers.sonar`；`computeEnv` 后调 `applySonarToSpots` |
| `assets/my.js` | 「我的」里声呐卡片的绑定（复用 `bindPhotoInput` 的写法）；档案导入导出加 `sonar/*` |
| `assets/engine.js` | 新增 `applySonarToSpots(spots, sampleFn)` + `structureScore` 里识别 `depthSource`（文案区分实测/推断） |
| `assets/app.css` | 卡片列表行、🎯 徽标、实测三格（沿用 `--ok`） |
| `index.html` | `cardSonar` 结构；设置里加「用声呐标定近岸水深」开关（默认关） |
| `sw.js` | SHELL 加 `./assets/deeper.js`，`CACHE` → `v26` |
| `docs/ANDROID.md` | 说明 CSV 通过「文件选择器」导入在 Android 上走 SAF，无需存储权限 |
| `README.md` | 「诚实说明」一节补：Deeper 实测与其他推断值的关系；「数据来源」表加一行 Deeper（本机导入，非在线源） |

---

## 附：解析器骨架（P0 直接可抄）

```js
// assets/deeper.js —— 只依赖浏览器 API
(function () {
  'use strict';
  var NUM = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

  function sniff(headerLine, delim) {
    var cols = headerLine.split(delim).map(function (s) { return s.trim().toLowerCase(); });
    var hasHeader = cols.some(function (c) { return c.indexOf('lat') === 0; }) &&
                    cols.some(function (c) { return c.indexOf('depth') === 0; }) &&
                    cols.some(function (c) { return c.indexOf('time') === 0; });
    if (!hasHeader) return { hasHeader: false, idx: { lat: 0, lon: 1, depth: 2, temp: 3, time: 4 } };
    function find(names) {
      for (var i = 0; i < cols.length; i++) for (var j = 0; j < names.length; j++) if (cols[i].indexOf(names[j]) >= 0) return i;
      return -1;
    }
    return {
      hasHeader: true,
      idx: {
        lat: find(['latitude', 'lat']), lon: find(['longitude', 'lon', 'lng']),
        depth: find(['depth']), temp: find(['temp']), time: find(['time', 'timestamp'])
      }
    };
  }

  function parseText(text, opts) {
    opts = opts || {};
    var offset = opts.transducerOffsetM != null ? opts.transducerOffsetM : 0.15;
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var lines = text.split('\n');
    var d0 = (lines[0].split(',').length >= lines[0].split(';').length) ? ',' : ';';
    var s = sniff(lines[0], d0);
    var fixes = [], skipped = 0, zeros = 0, start = s.hasHeader ? 1 : 0;
    for (var i = start; i < lines.length; i++) {
      var ln = lines[i];
      if (!ln || !ln.trim()) continue;
      var f = ln.split(d0);
      if (f.length !== 5) { skipped++; continue; }
      var rawDepth = s.idx.depth >= 0 ? f[s.idx.depth] : '', rawTime = s.idx.time >= 0 ? f[s.idx.time] : '';
      if (!NUM.test((rawDepth || '').trim()) || !NUM.test((rawTime || '').trim())) { skipped++; continue; }
      var lat = Number(f[s.idx.lat]), lon = Number(f[s.idx.lon]);
      var depth = Number(rawDepth), ts = Number(rawTime);
      if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped++; continue; }
      if (ts < 1e12) ts *= 1000;                       // 秒 → 毫秒
      var gpsOk = !(lat === 0 && lon === 0);
      if (!gpsOk) zeros++;
      var tRaw = s.idx.temp >= 0 ? Number(f[s.idx.temp]) : NaN;
      var tempC = (isFinite(tRaw) && tRaw > 0 && tRaw <= 40) ? tRaw : null;
      fixes.push({ lat: lat, lon: lon, tMs: ts, depthM: +((depth + offset).toFixed(2)), tempC: tempC, gpsOk: gpsOk });
    }
    var total = fixes.length + skipped;
    if (total === 0) throw { code: 'NO_ROWS' };
    if (total === 1) throw { code: 'STUB_FILE' };
    if (skipped / total > 0.01) throw { code: 'MALFORMED', ratio: skipped / total };
    if (zeros === fixes.length) throw { code: 'NO_GPS' };
    return { fixes: fixes, rowsSkipped: skipped, zeroRows: zeros, delimiter: d0, hadHeader: s.hasHeader };
  }

  window.Deeper = { parseText: parseText, VERSION: '1' };
})();
```

> 骨架只到"脏行/0-0/单位兜底"。线段切分、LTTB 抽稀、统计（§6）与网格落桶在 P0 里补齐，
> 单元测试直接用 §8 的三种构造样本，不依赖真实文件。
