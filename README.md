# LureCast 路亚潮汐

一个能装到手机上（PWA / 安卓 APK）的路亚钓点推荐工具：定位 → 拉实时气象与水文 → 采样岸线与地形 → 给出**能解释为什么**的钓点榜单、时段窗口与拟饵建议。

- **全部数据源免 API Key**：Open-Meteo（气象/海况/汇流/高程）、OpenStreetMap（水域/岸线/地名）、ESA Sentinel-2（历史影像）。
- **只存本机**：渔获、常用地点、偏好、缓存都在本机 IndexedDB，不上传；只有你自己配了 AI Key 时才会发请求给那家模型。
- **三语界面**：简体 / 繁體 / English。

## 能做什么

| 卡片 | 内容 |
|---|---|
| 鱼口指数 | 0–100 环境分 + 一句话结论 + 短板提示（六因子加权，逐项可查） |
| 推荐钓点 | 最多 6 个点：岸型 / 岸坡 / 迎风向 / 距离 / 两条理由 / 拟饵建议 |
| 未来 24 小时 | 逐小时环境分柱状图 + 今天最好的两个时段 |
| 天气实况 / 风况 | 气温、体感、气压含 3h 趋势、云量、降水；罗盘 + 哪一岸被风推水 |
| 水位与水流 | 河流看 GloFAS 流量趋势，海看潮位，湖库用降水/汇流代理 |
| 地形结构 | 岸坡中位数、陡岸段数、岬角/湾计数、近岸 20 m 水深**估值** |
| 历史影像 · 水下结构 | 跨 3 年找枯水期 Sentinel-2 影像 → 真彩 / 蓝绿比水深 / 两期水位差 / 结构候选点 |
| 我的 | 常用地点（含图片）、渔获档案（拍照解锁）、水族馆、声呐实测水深导入 |

详见 [`docs/USAGE.md`](docs/USAGE.md)；算法口径见 [`docs/SCORING.md`](docs/SCORING.md)。

## 快速开始

```powershell
git clone https://github.com/YiIimini/lurecast.git
cd lurecast
npm install
npm run dev -- --port 5181 --host 127.0.0.1     # 打开 http://127.0.0.1:5181/app.html?lat=30.25&lon=120.15
```

- **想要个手机能开的网页版**：`npm run build` 后把 `dist-web/` 丢到任意静态托管（必须 **https**，浏览器才给 GPS）。
- **想要 APK**：`npm run sync-web` → `npx cap sync android` → Gradle 打包，配方见 [`docs/ANDROID.md`](docs/ANDROID.md)。
- **老壳回滚**：根目录 `index.html` + `assets/*.js` 是重构前的手写 IIFE 版本，只在 `node native/sync-web.mjs --with-legacy` 时随包发布，新开发不要往里加东西。

## 技术栈

Vue 3 + Vite + TypeScript + Pinia 重写的新壳（入口 `app.html`，源码 `src/`），Capacitor 装进安卓；Leaflet 自托管；geotiff.js 懒加载。
原来的 13 个 IIFE 仍在 `assets/` 作回滚用。架构与开发约定见 [`docs/DEV.md`](docs/DEV.md)，重构过程与验收数据见 [`docs/REFACTOR-PLAN.md`](docs/REFACTOR-PLAN.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/USAGE.md](docs/USAGE.md) | 四个页签怎么用：地图选点、分享与导航、影像面板、设置项、我的（地点/渔获/水族馆） |
| [docs/SCORING.md](docs/SCORING.md) | 环境分六因子、钓点分、岸坡怎么推、秋季窗口期判据、交给用户选的口径 |
| [docs/SATELLITE.md](docs/SATELLITE.md) | Sentinel-2 读 COG 的完整流程、慢网策略、踩过的坑与局限 |
| [docs/AI.md](docs/AI.md) | 应用内助手（15 个工具）与识图：厂商、Key、隐私边界 |
| [docs/I18N.md](docs/I18N.md) | 三语界面的实现与文案维护流程 |
| [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) | 每个数据源的接口、免 Key 情况、缓存 TTL、实测数字 |
| [docs/ANDROID.md](docs/ANDROID.md) | Capacitor 壳、自己编译 APK 的配方、模拟器实测、应用内更新 |
| [docs/DEEPER-SONAR.md](docs/DEEPER-SONAR.md) | Deeper 声呐 CSV 格式与解析规则（含真实样本夹具） |
| [docs/OSM-SELFHOST.md](docs/OSM-SELFHOST.md) | 想自托管 OSM 瓦片 / Overpass / Nominatim 的成本与栈 |
| [docs/DEV.md](docs/DEV.md) | 目录结构、npm 脚本、测试、Git 与换行约定 |
| [docs/REFACTOR-PLAN.md](docs/REFACTOR-PLAN.md) | 重构分阶段记录（P0–P4）、验收数据、踩坑 |

## 诚实说明

1. **没有免费全球水下地形**。暗礁、沉木、沟坎只有船用声呐才有；本应用给的是能从免费数据推出来的那部分（岸坡、岸型、水色）。
2. **水位是趋势不是读数**：GloFAS 是汇流模拟的流量，湖库没有免费实测水位接口。
3. **评分是启发式规则**，不是渔获统计模型；同一个点钓三次，你比它准。
4. **安全**：评分只谈鱼口，不谈安全。迎风岸 + 大风、涨水、涨潮的礁石岸都危险。

## 已知限制

- Overpass 冷启动 5–30 秒（有分级缓存与卫星水面兜底，冷启动后同地点二次打开约 0.2 秒）。
- 卫星影像读取耗时随网络波动大（6–46 秒），慢网下靠 TCI + SCL 两个文件 + 块缓存硬扛。
- 目标鱼的口味参数是经验值，需要按实际水域再校准 `src/lib/engine.ts` 里的 `SPECIES`。
- 水族馆同时最多显示 12 条鱼（再多会掉帧）。

## 许可

[MIT](LICENSE)。地图与影像数据仍归各自来源（© OpenStreetMap contributors、© ESA Sentinel-2、Open-Meteo），使用请遵守上游条款。
