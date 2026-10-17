# 数据源清单（全部免 Key，CORS 开放，实测可用）

实测环境：2026-10-17，PowerShell / Node / 无头 Edge 均验证 200 + `Access-Control-Allow-Origin: *`。

## 1. 气象 — Open-Meteo Forecast
`GET https://api.open-meteo.com/v1/forecast`

| 参数 | 值 |
|---|---|
| current | temperature_2m, relative_humidity_2m, apparent_temperature, precipitation, weather_code, cloud_cover, pressure_msl, wind_speed_10m, wind_direction_10m, wind_gusts_10m |
| hourly | temperature_2m, relative_humidity_2m, precipitation, precipitation_probability, cloud_cover, pressure_msl, wind_speed_10m, wind_direction_10m, wind_gusts_10m |
| daily | sunrise, sunset, temperature_2m_max, temperature_2m_min, precipitation_sum, wind_speed_10m_max |
| 其它 | past_days=1, forecast_days=3, timezone=auto, wind_speed_unit=ms |

- 用途：气温/湿度/气压（含 3h 趋势）/风/云/降水/日出日落。
- 特点：无需 Key，1 km 级（ICON/GFS 融合），实测响应 1.2–2.3 s，CORS `*`。
- 注意：`utc_offset_seconds` 要拿来换算当地时间；**别用本机时区**（异地/出国会错）。

## 2. 海况与潮位 — Open-Meteo Marine
`GET https://marine-api.open-meteo.com/v1/marine`

- current：wave_height, wave_period, wave_direction, sea_surface_temperature, sea_level_height_msl, ocean_current_velocity
- hourly：sea_level_height_msl, wave_height（潮位曲线、涨落判断）
- **内陆返回 null**（实测上海内陆 31.23,121.47 全为 null；杭州湾 31.10,122.10 有值）→ 正好当"是否靠海"的判据。
- 潮位是模式输出，不是港口潮汐表。

## 3. 河道流量 — Open-Meteo Flood（GloFAS）
`GET https://flood-api.open-meteo.com/v1/flood`

- daily：river_discharge, river_discharge_mean, river_discharge_max；past_days=14, forecast_days=5
- 实测千岛湖附近给出 4.93 → 2.03 m³/s 的下降序列。
- **流量 ≠ 水位**；有闸坝的河段误差更大。只用来判断"涨/稳/退"。

## 4. 高程 — Open-Meteo Elevation（Copernicus DEM 90 m）
`GET https://api.open-meteo.com/v1/elevation?latitude=a,b,c&longitude=x,y,z`

- 单次最多 100 点（本项目按 90 点分块，22 个候选 × 5 个探针 = 110 点 → 2 次请求）。
- 水面高程基本平坦（实测上海市区水域点返回 0–8 m），岸上明显抬升 → 可用"哪侧更高"判断岸/水。
- 90 m 分辨率会**平滑掉陡坎**，岸坡只能作相对比较。

## 5. 水域与岸线 — OpenStreetMap Overpass
`POST https://overpass-api.de/api/interpreter`（`data=<QL>`，form-urlencoded）

```
[out:json][timeout:25];(
  way(around:R,lat,lon)[natural=water];
  relation(around:R,lat,lon)[natural=water];
  way(around:R,lat,lon)[waterway~"^(river|stream|canal|riverbank)$"];
  relation(around:R,lat,lon)[waterway~"^(river)$"];
  way(around:R,lat,lon)[natural=coastline];
  way|relation(around:R,lat,lon)[landuse=reservoir];
);out geom(s,w,n,e);
```

- `out geom(bbox)`：**几何裁到 bbox**。千岛湖整条 relation 不裁是 7.3 MB，裁完 597 KB（12 倍），手机端才拉得动。
- 裁剪副作用：环被切开、缺口处是 `null`（engine.js 的 `segmentsOf()` 按 null 切段，绝不把缺口连成假岸线）。
- 冷启动 8–30 s（实测 7.8 s / 23.7 s），所以做了 10 分钟 localStorage 缓存 + 分阶段渲染。
- 备用镜像（overpass.kumi.systems / private.coffee / osm.jp）在实测中均 500 或 TLS 失败，暂不接入。

## 6. 地名 — 两个
- 逆地理：`GET https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=zh&lat=&lon=`
- 搜索：`GET https://geocoding-api.open-meteo.com/v1/search?name=&count=8&language=zh`
- Nominatim 有使用政策（1 req/s、需可识别 UA），前端只在定位后调一次，不会高频。

## 7. 底图 — CARTO Dark + Leaflet
- `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`，Leaflet 1.9.4（unpkg）。
- 署名：© OpenStreetMap contributors © CARTO（地图右下角已保留）。

## 8. 路线 — OSRM（可选，用户自选）

- 默认 `https://router.project-osrm.org/route/v1/{profile}/{lon},{lat};{lon},{lat}?overview=simplified&geometries=geojson`，免 Key。
- 但它是 **OSRM 社区的公共演示服务器**，明文写着「不适合生产、可能限流」。所以做成三选一：
  公共 OSRM / 你自己的地址（支持 `{profile} {fromLat} {fromLon} {toLat} {toLon}` 占位符，可指向自建 OSRM 或本地路由）/ 关掉（不请求，只按直线距离画虚线）。
- 船钓那条粉色虚线**本来就是直线**（水上没有路网），不受这个开关影响。
- 拿不到路线时一律退化成直线并在弹窗里写明原因，不静默失败。

## 缓存与容错（api.js + store.js）
- 分级 TTL：气象 10 分钟、海况 30 分钟、流量 3 小时、岸线 7 天、地名 30 天、DEM 30 天；key 精确到坐标 3 位小数。
- 存储后端是 **IndexedDB**（`assets/store.js`，库 `lurecast` / 表 `kv`），不再受 localStorage 5 MB 限制；旧数据首次启动自动迁移。
- 请求失败 → 有旧缓存就回退并标 `stale`（状态条变琥珀色「缓存 N 分钟前」）；无缓存 → 中性 `off` 态 + 人话，**不渲染成红色报错**。
- 429/500/502/503/504 与网络错误：退避重试 2 次（0.5s / 1s）。
- 各源独立 `try/catch`：海况失败不影响气象与岸线。

## 8. 历史卫星影像 — Sentinel-2 L2A（新增）

**目录检索**：`POST https://earth-search.aws.element84.com/v1/search`（Element84，免 Key，`ACAO: *`）

```json
{ "collections": ["sentinel-2-l2a"], "bbox": [w,s,e,n], "limit": 80,
  "query": { "eo:cloud_cover": { "lt": 20 } },
  "sortby": [{ "field": "properties.datetime", "direction": "desc" }],
  "datetime": "2023-10-17T00:00:00Z/2026-10-17T00:00:00Z" }
```

- 千岛湖 1.2 km 窗口实测匹配 **2850 期**；`datetime` 必须是 RFC3339 全格式（只给日期会 400）。
- 资产：`assets.green/red/blue/nir` → `https://sentinel-cogs.s3.us-west-2.amazonaws.com/...tif`（COG，10 m，约 190 MB/波段）。

**影像读取**：`HTTP Range` + `geotiff.js`（已 vendor 到 `assets/vendor/geotiff.js`，CDN 兜底）

实测数字（同一台机器、同一个文件）：

| 方式 | 耗时 | 说明 |
|---|---|---|
| `fromUrl(href)` 不带 allowFullFile | 30–50 s | 可能整幅下载 |
| `fromUrl(href, {allowFullFile:false})` | **1.4 s** | 只读头 + 瓦片索引 |
| `readRasters({bbox})` | **42 s** | bbox 路径会拉整幅，禁止使用 |
| `readRasters({window})` 第 0 层 | **0.57 s** | 1024² 瓦片，一次解码 |
| `readRasters({window})` 第 3 层 | **0.005 s** | 已缓存 |

- 网络实测：到 S3 约 **0.85 MB/s**（1953 KB / 2.3 s），所以"少读瓦片"比"多线程"更重要。
- 金字塔：10980 → 5490 → 2745 → 1373 → 687（10/20/40/80/160 m）。按输出像素数挑层级。
- 校验：`lonLatToUtm` 自检（中央经线东向必须 = 500000，赤道北向 = 0）；太湖中心水体占比实测 **100%**。

## 9. 地名搜索与岸线的可用性实测（2026-10-17）

**中文湖泊名检索对比**（同一批 12 个国内大湖）：

| 搜索源 | 命中 | 备注 |
|---|---|---|
| Open-Meteo Geocoding | 6/12 | 鄱阳湖 / 洞庭湖 / 呼伦湖 / 查干湖 / 微山湖 / 丹江口水库 全空 |
| **Nominatim（现用主源）** | **12/12** | 带回 `type=lake/reservoir` 与 `boundingbox`，可据此落到最近岸边 |

`GET https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=zh&q=<名字>`
（使用政策：≤1 req/s，前端做了 700 ms 防抖 + 只在输入时查）

**Overpass 端点稳定性**（同一分钟、同一个查询）：

| 端点 | 结果 |
|---|---|
| overpass-api.de | 200（ACAO `*`）／偶发 502 |
| overpass.private.coffee | 200／500 轮换，**不带 CORS 头**（浏览器侧会先被 CORS 拦） |
| overpass.kumi.systems | 500 |
| maps.mail.ru | 200 但 48–83 s，太慢 |
| overpass.nchc.org.tw | 连不上 |

结论：**没有单一可用端点**。代码里做端点轮换 + 3 分钟冷却 + 12 小时长缓存，并用 Sentinel-2 水面掩膜作为最终兜底
（`sat.js` 的 `waterCandidates()`：NDWI>0.05 → 边界像素 → 200 m 稀疏化 → 最多 24 个岸线点）。

**影像清晰度（本轮修的问题）**：原来把 240 px 原生窗口重采样到 512 px，还说"10 m 分辨率"，实际是糊的。现在：
- 不再重采样，画布尺寸＝窗口原生像素数（0.9 km 窗口 → 178×184 px，正好 10 m/px）
- 真彩做 8×8 分块局部对比度拉伸（CLAHE-lite）+ 轻度锐化：唯一颜色数 5 → 673
- 提供 0.45 / 0.9 / 1.8 km 三档窗口重读（0.45 km 只有 90 px，此时用像素化放大，边界清楚而不是糊）
- 10 m 是 Sentinel-2 的物理上限，想更清楚只能换商业高分影像
