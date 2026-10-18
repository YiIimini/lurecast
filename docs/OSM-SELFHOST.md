# 自托管 OSM 需要什么前置条件

先说清楚：本应用用到三块 **不同的** OSM 生态服务，自托管的成本差得很远，别混在一起算。

| 用途 | 本应用现在用的 | 自托管需要什么 |
| --- | --- | --- |
| 底图瓦片 | `tile.openstreetmap.de` 栅格瓦片 | 数据 + 渲染管线 + 静态/瓦片服务 |
| 水域与岸线（算岬角/岸坡/迎风岸） | Overpass API（四个公共端点轮换） | Overpass 实例 **或** 预切好的静态数据 |
| 地名搜索 / 逆地理 | Nominatim | Nominatim 实例（最重的一项） |

## 1. 底图瓦片

**数据**：`planet.osm.pbf`（2026 年约 80–90 GB，还在涨）或区域数据（Geofabrik 的省/国家级 pbf，中国区 1 GB 量级）。

**软件栈（任选一条）**

- 传统渲染：`PostgreSQL 14+` + `PostGIS 3` + `osm2pgsql` 导入 → `Mapnik` + `mod_tile`/`renderd` 按需渲染（osm-carto 样式）+ nginx 缓存。优点是接近官方样式；缺点是渲染慢、要缓存预热。
- 现代轻量：`tilemaker` 或 `planetiler` 把 pbf 直接切成 **MBTiles/PMTiles**（矢量和栅格都行），前端/后端读文件即可，不需要数据库和渲染进程。**个人部署推荐这条**。
- 矢量瓦片：OpenMapTiles schema + `Martin`/`Tegola`/`tileserver-gl` 服务；前端需要 MapLibre GL（本应用现在用的是 Leaflet，换矢量瓦片要额外适配）。

**硬件参考**：一个省/市级区域 → 4 核 8 GB + 100 GB SSD 足够；全国每周更新 → 16 核 64 GB + NVMe 1 TB 起，导入一次几小时到十几小时。

**发布**：nginx 静态目录（`{z}/{x}/{y}.png` 或 `/{z}/{x}/{y}.pbf`），开 CORS、上 TLS。**中文标注**要自己带字体栈（Noto Sans CJK）并在数据里保留 `name:zh`，否则只有英文。

**接到本应用**：设置 → 地图与路线里有「自定义底图地址」和 `{key}` 模板，把 URL 换成你的瓦片服务即可；`maxZoom` 按你的切片层级设（超过就留白）。

## 2. Overpass（水域/岸线查询）

这是本应用算钓点的关键数据源。

- 完整自托管：`Overpass API`（osm-3s）+ PostgreSQL，导入区域 pbf。内存：全国实例官方建议 ≥ 64 GB，区域（省/流域）8–16 GB 可以跑。
- **更省事的替代**：用 `osmium`/`ogr2ogr` 先把 `natural=water`、`waterway=riverbank`、`coastline` 抽成 GeoJSON/PMTiles **静态托管**，前端直接读。本应用只需要「一圈岸线点 + 水域名」，静态数据完全够，且没有查询超时问题。

**接到本应用**：`assets/api.js` 里 `OVERPASS_ENDPOINTS` 数组换成你的端点（或改成读本地 GeoJSON 的 `fetch`）。公共 Overpass 有速率限制、还会整段 502，这也是现在做四端点轮换的原因。

## 3. Nominatim（搜索 / 逆地理）

- 软件：`Nominatim` + `PostgreSQL` + `PostGIS` + `osm2pgsql`。
- 资源：全国数据导入后索引数百 GB；官方建议 **32–64 GB 内存**，导入耗时数小时到一天。
- 轻量替代：只导入城市/区县级数据（几百 MB），搜索够用；或换 `Photon`（Elasticsearch 底座）做前缀搜索。
- 使用政策：公共 Nominatim 明确禁止高频与批量调用（本应用做了 700 ms 防抖 + 结果缓存）。

**接到本应用**：`assets/api.js` 的 `search()` 与 `reverse()` 里把 `nominatim.openstreetmap.org` 换成你的域名即可。

## 4. 一句话结论

- 只想解决「底图偶尔打不开」→ 用 `tilemaker` 切**区域 MBTiles**，一台 4C8G 就够，成本最低。
- 想彻底离线（含岸线）→ 瓦片 MBTiles + **静态岸线 GeoJSON**，不需要 Overpass 和 Nominatim。
- 想连搜索也自托管 → 再加 Nominatim，内存与磁盘按全国数据准备，这是三块里最重的一块。

> 注意：`tile.openstreetmap.org` / `.de` 是**公共服务**，使用政策禁止批量抓取与大规模镜像；要放开使用量就必须自托管。
