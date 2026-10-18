# LureCast × Deeper 声呐：接入方案（技术稿）

> 目标读者：后续接手实现的人（或我自己下一轮）。
> 现状基线：`r29`（25 种鱼贴图 + 水族馆水层 + 地形卡片六格全是 DEM 推断）。
> 本文以方案为主；但 §2 的格式、§2.3 的阈值、§4.1 的流水线与附录的解析器代码**已按真实格式夹具验证过**
> （见 §2.4），剩下的只有真机与真实出钓导出才能验的几条（§8 后半）。

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

## 2. Deeper 的数据到底长什么样（已用真实格式样本验证）

### 2.1 两种导出，格式不同

| 路径 | 产出 | 表头 | 列 | 原始回波 |
|---|---|---|---|---|
| **手机 App**（Lakebook → 扫描「⋮」→ *Export scan data as CSV*） | 单个 `scan_data_*.csv` | **有** | 5 列 | **没有**（只有水深+水温） |
| **Quest / Lakebook 网页**（原始导出 / Download） | zip：`bathymetry.csv` + `sonar.csv` | **没有** | 4 列或 5 列 | `sonar.csv` 有 |

### 2.2 列定义（逐列都对过样本）

**A. Quest/PRO 的 `bathymetry.csv`（无表头）**

| 列数 | 列序 | 含义 |
|---|---|---|
| **5 列**（2025 后固件） | `lat, lon, depth, temp, ts_ms` | 例：`51.7,-1.43,1.5,18.0,1700000000000` |
| **4 列**（旧固件） | `lat, lon, depth, ts_ms` | 没有温度列，时间戳在索引 3 |

**B. 手机端 `scan_data_*.csv`（有表头）**：表头是
`latitude,longtitude,depth,temperature,time` —— **Deeper 自己把 longitude 拼成了 `longtitude`**，
所以按名字找列时必须两个都认（否则列定位会 -1）。

两者共同的坑：

- **时间戳是毫秒**（`1700000000000`）；老资料里也有秒值，用 `> 1e12` 判断，别的不要猜。
- **深度是换能器到水底**，做成"水面下深度"要加探头吃水（默认 0.15 m，可配）。
- **温度有两个哨兵**：`0.0` 表示"这行没采样"（手机端 GPS 行就是这样），`>40 ℃` 是探头出水被晒；
  两者都要丢掉，只保留 `(0, 40]`，否则温度标尺被拖垮。
- **空单元格必须判脏**：`Number('') === 0`，不判就会伪装成"无定位行"或"0 深度"。
- **无定位的两种写法**：Quest 导出写 `0,0`；**手机端大多写空**（GPS 约 1 Hz、深度约 15 Hz）。
  两种都按"无定位"处理，**保留在时间轴**，画航迹时用相邻有效点插值，不能直接当 0,0 点插到地图上（否则全糊在赤道）。
- 无引号、无转义、无字段内换行 ⇒ 可以按 `\n` 切行、`,` 切列，流式处理（Quest 的 zip 解压后可能几百 MB）。
- BOM、CRLF 都要容错；**少于 2 行的文件是残包**（开始扫描但没采到点），直接拒收。
- 手机端切英尺时导出是否跟着变，没有样本证实 → 首版按米解析，只在「最大深度 > 60 m 且中位 > 20 m」时提示确认。

**C. `sonar.csv`（仅 Quest zip 有）**：每行 `时间戳, 振幅1, 振幅2, …`，全部整数（实测夹具 **915 列**：
1 个时间戳 + 914 个采样）。这些是回波强度，用来推水草/鱼群，**不是深度**。
列内分段的语义（多波束怎么排）没有官方说明，P4 之前不动它。

### 2.3 校验阈值（照这套来，别自己发明）

| 规则 | 阈值 | 为什么 |
|---|---|---|
| 残包 | 数据行 < 2 | 开始扫描但没采到点 |
| 脏行比例 | > 1% 就拒收 | 但**只在总行数 ≥ 100 时判定**：短扫描不该被一行脏数据搞死 |
| 脏行定义 | 列数不符 / 必需列为空或非数值 / 经纬度越界 | 空单元格单独算脏（防 `Number('')===0`） |
| 完全没 GPS | 拒收并说明原因 | Deeper **Start** 机型不带 GPS，导出的经纬度全是 0 |
| 列数 | 只接受 4/5（无表头）或表头嗅探成功 | 其它列数报"不像 Deeper 导出" |

### 2.4 这次是怎么验证的（可追溯）

网上没有真实出钓导出（Deeper 的数据在用户手机里，公开的只有开源项目为测试构造的样本），
所以我下了一个处理 Deeper 导出的开源项目（`dpage/deeper-maps`，纯前端、含解析源码与测试夹具），
用**它的夹具 + 源码里的规则**校准本文，并拿本文附的解析器跑了一遍：

| 样本 | 来源 | 结果 |
|---|---|---|
| `reference-bath.csv`（1125 行） | 该项目的测试夹具（Quest 5 列格式） | ✅ 1125 行全解析，0 脏行，深度 1.5–2.2 → 加吃水后 1.65–2.35，温度 18 ℃ |
| `quest-with-temp.zip` 里的 `bathymetry.csv`（7 行） | 同上（e2e 夹具） | ✅ 7 行全解析，温度 12.4→16.7 |
| 4 列旧固件样本（我按规范构造，200 行） | — | ✅ 200 行，`tempC=null` |
| 手机端样本（表头含 `longtitude`、坐标大量为空、温度含 0.0/45.8，300 行） | 我按规则构造 | ✅ 300 行，280 行判为无定位，温度被过滤到 12–13.5（哨兵与暴晒值都丢掉了） |

错误码也按 §2.3 逐条跑过：残包→`STUB_FILE`、3 列→`NOT_DEEPER`、全 0/0→`NO_GPS`、
1.7% 脏行→`MALFORMED`、0.8% 脏行→放行并计 `skipped=1`、空文件→`NO_ROWS`。

**仍然欠的**：一次真实出钓的导出。夹具是构造的，能验格式与边界，验不了真实 GPS 抖动、
真实温度噪声、以及"手机端表头到底有几个字段"。所以 §8 里"真机验收"那几条还留着。

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

流水线（顺序不能乱，第 2–4 步的顺序尤其别换）：

1. **读**：`await file.text()`（Capacitor 下也能用）；>8 MB 走 `Blob.stream()` 分块，UI 显示「解析中 38%」。
2. **归一**：剥 `^\uFEFF`，`\r\n|\r` → `\n`。分隔符就按 `,` 切——真实导出没有带引号的字段，
   分号只在"欧洲区域设置导出 Excel"时出现，判断条件写"首行逗号数 == 0 且分号数 ≥ 4"再兜底，别默认两条路都试。
3. **定格式（先探 20 行）**：表头嗅探（`latitude`+`depth`+`time`，注意 `longtitude` 拼写）→ 按名字取列；
   否则按首行**列数**定：4 列＝`lat,lon,depth,ts`，5 列＝`lat,lon,depth,temp,ts`。
   前几行脏**不等于**"不是 Deeper"——探满 20 行都没有 4/5 列才报 `NOT_DEEPER`。
4. **逐行映射**：列数与定下的宽度不符 → `rowsSkipped++`；必需列空/非数值 → 跳过；
   **坐标列允许为空**（手机端 GPS 1 Hz），空 → 当作无定位；温度不在 (0,40] → 置 null 但不丢整行。
5. **无定位标记**：`lat==0 && lon==0`（含空坐标归一后的 0）⇒ `gpsOk=false`，**保留在数组里**
   （要算「无定位占比」质量指标），但绝不直接进地图。
6. **插值补航迹**（这步不做，手机端导出会变成一串孤立点）：对 `gpsOk=false` 的行，
   用前一个与后一个有效定位点按时间线性插值出坐标，状态标 `interpolated`；段首段尾补不了的就丢掉。
7. **分段**：有效定位由真变假再变真、或相邻两点时间差 > 30 s、或位移速度 > 12 m/s（船不会更快）⇒ 切新段。
8. **单位兜底**：`stats.depth.max > 60 || median > 20` ⇒ 打 `MaybeFeet` 警告（不自动换算，让人确认）。
9. **抽稀 + 统计 + bbox**（见 §3）。
10. **网格聚合（给地图着色）**：把插值后的点按约 25 m 网格落桶，每桶取中位深度 ⇒ `grid: [{lat, lon, depthM}]`，点数 ≤ 2000。

错误码（UI 用中文短句 + 一个「怎么办」）：

| code | 触发 | 给用户的话 |
|---|---|---|
| `NOT_DEEPER` | 探 20 行都没有 4/5 列、也没嗅到表头 | 这不像 Deeper 导出的 CSV（第一行 6 列），请在 App 里重新导出 |
| `NO_ROWS` | 文件是空的 | 文件里没有内容 |
| `STUB_FILE` | 数据行 < 2 | 这看起来是残缺文件（只采到 1 行），重新导出一遍 |
| `MALFORMED` | 总行数 ≥100 且脏行 > 1% | 文件格式不像 Deeper 导出（脏行 12%），请在 App 里重新导出 |
| `NO_GPS` | 全部无定位 | 这次扫描没有定位（Deeper Start 机型不带 GPS），只能看水深，画不到地图上 |
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

> 注意：**手机端导出没有 `sonar.csv`**，所以那个来源的扫描只能出「深度 + 温度」两层，
> 水草 / 鱼群这些要靠回波的东西做不了（UI 上要如实禁用，而不是画个空层）。

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

**已经过了的**（2026-10-18，跑的就是附录那份代码）

- [x] **格式**：Quest 5 列（1125 行夹具）、Quest 4 列（构造）、手机端 5 列带表头（构造，含 `longtitude` 拼写）都能解析
- [x] **计数闭合**：`rowsTotal = fixes + rowsSkipped`（1125 / 200 / 300 三个样本都成立）
- [x] **温度哨兵**：`0.0` 与 `>40 ℃` 被丢掉，保留 12–13.5 ℃
- [x] **错误码**：残包→`STUB_FILE`、3 列→`NOT_DEEPER`、全 0/0→`NO_GPS`、空文件→`NO_ROWS`、
      1.7% 脏行→`MALFORMED`、0.8% 脏行→放行且 `skipped=1`
- [x] **吃水偏移**：`depthM = depth + 0.15`（1.50 → 1.65）

**还需要真机 / 真实导出才能验的**

- [ ] **真实出钓导出**（≥5000 行）：最深点坐标与 Deeper App 显示的一致（误差 < 20 m）
- [ ] **耗时**：中端机解析 < 600 ms（`console.time`；当前夹具 1125 行 = 2 ms，不能代表 10 万行）
- [ ] **手机端表头到底几个字段**：本文按 5 个字段写；若真实文件是 4 个（无 temperature），§4.1 第 3 步的嗅探会自动降级，但要跑一次确认
- [ ] **英尺模式**：把深度 ×3.28 假装英尺，必须弹 `MaybeFeet` 提示而不是画一条 30 m 深的湖
- [ ] **卡片**：导入后 `近岸 20m 深`、`最深估点` 变实测（🎯）；`岸坡中位数` **不变**；取消勾选后卡片与评分回到导入前（`JSON.stringify` 逐字符比对）
- [ ] **可撤销**：删除扫描后 `lc:sonar:*` 清空、地图层清空、卡片回到六格
- [ ] **不回归**：没有导入任何扫描时，跑一次现有回归（`node --check` + 三处端到端 + 视口截图），结果与 r29 一致
- [ ] **隐私**：断网后导入/查看/删除全部可用；导出档案默认不含扫描

---

## 9. 风险与已定取舍

| 风险 | 影响 | 取舍 |
|---|---|---|
| 没有官方字段说明（官方只有一句"含 lat/lon/depth/timestamp/water temperature"） | 表头/列数变体 | 用开源实现 + 其夹具校准（§2.4）：4/5 列 + 表头嗅探 + `longtitude` 拼写；**不硬编码列序** |
| 一份扫描只覆盖一片小水域 | 容易被误用成"整湖地形" | 卡片只在 bbox 命中时才覆盖；区域标定默认关 |
| 0/0 行占比可能很高（岸边走动时） | 点数虚高、统计失真 | 单列 `gpsOk` 统计，卡片显示的是**有效定位点数** |
| 抽稀后地图可能"少几个弯" | 视觉与实测不符 | 抽稀用 LTTB 保形；同时给「航迹长度」与「有效点数」两个口径 |
| 隐私（钓点即鱼窝） | 泄露 | 只存本机、不上传、不参与分享；导出档案需显式勾选 |
| Quest 的 `sonar.csv` 语义没写进官方文档 | P4 无法估 | 只做到"能读出行结构（时间戳 + 整数振幅，夹具 915 列）"，分段语义等真样本；P4 之前不动 |

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

> 下面这份**不是示意**：它就是从 `docs` 里被抽出来、按 §2.4 的四个样本与七个错误码跑过的版本（v2）。
> P0 直接落地到 `assets/deeper.js` 即可；统计 / 抽稀 / 插值 / 网格（§3、§4.1 第 6–10 步）在它之上补。

```js
// assets/deeper.js —— 只依赖浏览器 API（零第三方依赖）
// 2026-10-18：按真实导出格式对齐
//   · Quest/PRO 的 bathymetry.csv：无表头，4 列（旧固件）或 5 列（含温度）
//   · 手机 App 的 scan_data_*.csv：有表头（Deeper 把 longitude 拼成 longtitude），坐标大量为空
(function () {
  'use strict';

  var MAX_TEMP = 40;             // 出水暴晒会读到 45+；0.0 是「无读数」哨兵
  var MALFORMED_MAX = 0.01;      // 脏行比例上限
  var MALFORMED_MIN_ROWS = 100;  // 少于 100 行不做比例判定（短扫描别被一行脏数据拒掉）
  var STUB_MIN_ROWS = 2;

  function plausibleTemp(v) {
    return (isFinite(v) && v > 0 && v <= MAX_TEMP) ? v : null;
  }
  function err(code, extra) {
    var e = { code: code };
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }

  // 手机端表头：Deeper 自己把 longitude 拼成了 longtitude，两个都认
  function headerIndex(cells) {
    var cols = cells.map(function (c) { return c.trim().toLowerCase(); });
    var at = function (names) {
      for (var i = 0; i < names.length; i++) {
        var j = cols.indexOf(names[i]);
        if (j >= 0) return j;
      }
      return -1;
    };
    if (at(['latitude']) < 0 || at(['depth']) < 0 || at(['time']) < 0) return null;
    return {
      lat: at(['latitude']), lon: at(['longitude', 'longtitude']),
      depth: at(['depth']), temp: at(['temperature', 'water temperature', 'temp']),
      time: at(['time'])
    };
  }

  function parseText(text, opts) {
    opts = opts || {};
    var offset = opts.transducerOffsetM != null ? opts.transducerOffsetM : 0.15;
    var lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');

    var fixes = [], total = 0, skipped = 0, zeroGps = 0, hasGps = false;
    var idx = null, width = -1, hadHeader = false, probes = 0, lastCols = 0;

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!ln || ln.trim() === '') continue;
      var cells = ln.split(',');

      if (width < 0) {
        // 头几行用来定格式。前几行脏不等于「不是 Deeper」——真导出是整块数字，脏行只零星出现。
        probes++; lastCols = cells.length;
        var h = headerIndex(cells);
        if (h) {
          idx = h; width = cells.length; hadHeader = true;
          continue;
        }
        if (cells.length === 4 || cells.length === 5) {
          width = cells.length;
          idx = width === 5
            ? { lat: 0, lon: 1, depth: 2, temp: 3, time: 4 }
            : { lat: 0, lon: 1, depth: 2, temp: -1, time: 3 };
          // 不 continue：这行本身就是数据
        } else if (probes >= 20) {
          throw err('NOT_DEEPER', { cols: cells.length });
        } else {
          skipped++; continue;
        }
      }

      total++;
      if (cells.length !== width) { skipped++; continue; }

      // 空白单元格要判脏：Number('') === 0，会伪装成「无定位」行。
      // 例外是手机端导出的坐标列（GPS 约 1 Hz、深度约 15 Hz，坐标本来就有大量空值）。
      var bad = false;
      for (var c = 0; c < cells.length; c++) {
        if (cells[c].trim() === '' && !(c === idx.lat || c === idx.lon)) { bad = true; break; }
      }
      if (bad) { skipped++; continue; }

      var latS = cells[idx.lat].trim(), lonS = cells[idx.lon].trim();
      var lat = latS === '' ? 0 : Number(latS);
      var lon = lonS === '' ? 0 : Number(lonS);
      var depth = Number(cells[idx.depth]);
      var ts = Number(cells[idx.time]);
      if (!isFinite(lat) || !isFinite(lon) || !isFinite(depth) || !isFinite(ts)) { skipped++; continue; }
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped++; continue; }

      var gpsOk = !(lat === 0 && lon === 0);
      if (gpsOk) hasGps = true; else zeroGps++;

      fixes.push({
        lat: lat, lon: lon,
        tMs: ts < 1e12 ? ts * 1000 : ts,          // 秒 → 毫秒
        depthM: +((depth + offset).toFixed(2)),   // 加上换能器吃水
        tempC: idx.temp >= 0 ? plausibleTemp(Number(cells[idx.temp])) : null,
        gpsOk: gpsOk
      });
    }

    if (width < 0) throw err(probes > 0 ? 'NOT_DEEPER' : 'NO_ROWS', { cols: lastCols });
    if (total === 0) throw err('NO_ROWS');
    if (total < STUB_MIN_ROWS) throw err('STUB_FILE', { rows: total });
    if (total >= MALFORMED_MIN_ROWS && skipped / total > MALFORMED_MAX) {
      throw err('MALFORMED', { ratio: skipped / total });
    }
    if (fixes.length > 0 && !hasGps) throw err('NO_GPS');

    return {
      fixes: fixes, rowsTotal: total, rowsSkipped: skipped, zeroGps: zeroGps,
      hadHeader: hadHeader, cols: width, depthOffsetM: offset
    };
  }

  window.Deeper = { parseText: parseText, VERSION: '2' };
})();
```
