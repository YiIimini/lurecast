# 打进安卓：Capacitor 壳 → APK

**已产出可安装的 APK**：`dist/LureCast-1.0-debug.apk`（4.33 MB，Android Debug 签名，可直接侧载）

| 项 | 值 |
|---|---|
| 包名 | `com.lurecast.app` |
| 版本 | 1.0（versionCode 1） |
| minSdk / targetSdk / compileSdk | 22 / 34 / 34 |
| 应用名 | LureCast 路亚潮汐 |
| 权限 | INTERNET、ACCESS_FINE_LOCATION、ACCESS_COARSE_LOCATION |
| 签名 | `CN=Android Debug`（SHA-256 `589b74ac…3016ab`） |
| 内容 | 550 个条目，前端全部打包（index.html 21.9 KB、app.js 87 KB、sat.js、ai.js、my.js、species.js、geotiff 310 KB） |

## 怎么装

1. 手机开「未知来源 / 安装未知应用」许可
2. 把 `dist/LureCast-1.0-debug.apk` 传到手机点安装
   或电脑连着手机：`adb install -r dist\LureCast-1.0-debug.apk`
3. 首次打开会请求**定位权限**（选「精确位置」）；拍照时会请求相机/相册

> debug 签名只适合自己用。要上架或长期安装，用 Android Studio 的
> `Build → Generate Signed Bundle/APK` 生成自己的 keystore 签名（或 `gradlew assembleRelease` + 配置 signingConfig）。

## 原生侧做了什么（不是简单套壳）

| 能力 | 实现 | 为什么必须原生 |
|---|---|---|
| 定位 | 优先 `@capacitor/geolocation`，失败回落 `navigator.geolocation` | WebView 的 GPS 权限弹窗不规范、后台会断 |
| **跨域** | `CapacitorHttp` 已启用（`capacitor.config.json` → 打进 APK 生效） | 浏览器直连 AI 接口常被 CORS 拦；原生走后端请求，**识图在 App 里不会被 CORS 卡** |
| 返回键 | `@capacitor/app` 监听 `backButton`：先关弹窗 → 再回「结论」→ 最后才退出 | 否则一按返回就退出应用 |
| 档案导出 | `@capacitor/filesystem` 写缓存 + `@capacitor/share` 调系统分享 | WebView 不支持 `<a download>` |
| 拍照/选图 | `<input capture>` + AndroidManifest 里的 `<queries>`（`IMAGE_CAPTURE` / `GET_CONTENT`） | Android 11+ 不声明就看不到相机应用 |
| 图标 | 五档 mipmap + 圆形（由 `icons/icon-512.png` 生成） | — |

## 自己重新编译（这次实际用的配方）

本机原来没有 JDK / Android SDK，我是这样从零搭起来的（全程免安装、免管理员）：

```powershell
# 1) JDK 17（Temurin 免安装 zip）
Invoke-WebRequest 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk' -OutFile jdk17.zip
Expand-Archive jdk17.zip -DestinationPath toolchain\jdk
$env:JAVA_HOME = (Get-ChildItem toolchain\jdk -Directory)[0].FullName

# 2) Android commandline-tools + SDK 组件
Invoke-WebRequest 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' -OutFile cmdtools.zip
Expand-Archive cmdtools.zip -DestinationPath toolchain\sdk\cmdline-tools\tmp
Move-Item toolchain\sdk\cmdline-tools\tmp\cmdline-tools toolchain\sdk\cmdline-tools\latest
$yes | & toolchain\sdk\cmdline-tools\latest\bin\sdkmanager.bat --sdk_root=toolchain\sdk --licenses
& toolchain\sdk\cmdline-tools\latest\bin\sdkmanager.bat --sdk_root=toolchain\sdk platform-tools "platforms;android-34" "build-tools;34.0.0"

# 3) local.properties 指向 SDK
"sdk.dir=<SDK 路径，反斜杠要双写>" | Out-File native\android\local.properties -Encoding ascii

# 4) 构建
cd native\android
.\gradlew.bat assembleDebug --no-daemon
# 产物: app\build\outputs\apk\debug\app-debug.apk
```

### 三个坑（踩过，记下来）

1. **`services.gradle.org` 在 Java 里连不上**（PowerShell 能连，JVM 超时）。
   解决 A（推荐、可离线）：用 PowerShell 下 `gradle-8.2.1-all.zip`（腾讯镜像 `mirrors.cloud.tencent.com/gradle/` 很快），
   解压后直接用它编译，**不要动仓库里的 wrapper 配置**：
   ```powershell
   Expand-Archive gradle-8.2.1-all.zip -DestinationPath <工具目录>
   <工具目录>\gradle-8.2.1\bin\gradle.bat assembleDebug --no-daemon
   ```
   解决 B：临时把 `gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl` 指到本地 zip（**改完记得还原再提交**，
   仓库里这份必须指向官方地址，否则别人 clone 下来编不了）。
2. **JVM 的 IPv6 握手失败**：加 `GRADLE_OPTS=-Djava.net.preferIPv4Stack=true` 后 Maven 依赖就能正常拉。
3. **wrapper 指向本地路径会污染仓库**：`.gitignore` 不忽略它（它是构建配置），所以本地改过一定要还原——已用
   `git show HEAD:native/android/gradle/wrapper/gradle-wrapper.properties` 校过，仓库里是官方地址。

Android Studio 用户不需要这些：直接 `File → Open → native/android` 就会自动用自带的 JDK + SDK。

## 改完网页后怎么出包

```powershell
cd native
npm run android:sync     # 把上一层的 index.html / assets / icons 同步进 www/ 再 cap sync
cd android
.\gradlew.bat assembleDebug --no-daemon
```

`native/www` 只是 `lurecast/` 的一份拷贝，**别在那里改代码**。

## 已在模拟器上实测（Android 14 / x86_64 / WHPX）

环境：`Intel Core Ultra 9 275HX` + WHPX 加速，AVD `oneghg`（android-34 / google_apis / x86_64 / 1080×2400 / dpr 2.625），
`emulator -avd oneghg -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot`，
启动 19 s。装包 `adb install -r -g dist/LureCast-1.0-debug.apk`。

测法：debug 包 WebView 可调试，`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`
后用 CDP 在真实 WebView 里跑断言（比点坐标可靠）。

通过项：

- ✅ 冷启动无 JS 异常、首屏骨架屏、**自动 GPS 定位**（Capacitor Geolocation 返回 29.5700,119.0200 / ±5 m）
- ✅ 气象/气压/风/云量 6 格、环境分、6 因子条、24 小时曲线、时段窗口
- ✅ 地表高程（DEM）120 个采样点 → 岸坡/陡岸/迎风岸/近水深推断
- ✅ **卫星 COG 读取**（见下方坑 3）：枯水期 03-21 水体 56%、丰水期 10-07 水体 58%、水位差 4%、
  露出结构候选 8 个、10 m/px，画布 178×183 正常出图，无异常
- ✅ 卫星水面兜底出钓点（OSM 全挂时仍产出 24 个「卫星水面 · 直岸」候选）
- ✅ Leaflet 地图 + Esri World Imagery 瓦片成功加载，52 个岸段图形、点钓点联动
- ✅ 我的：渔获墙、多图角标、**水族馆 2.5D**（3 种鱼游动，722×356 缓冲，软件 GL 下 28 fps）
- ✅ **导出档案**：写 `cache/lurecast-backup-YYYY-MM-DD.zip`（1848 B）→ 拉起系统分享面板；
  拉回本机用 .NET 解压校验：manifest.json / catches.json / favorites.json / README.txt 四条目完整
- ✅ **返回键**：钓点页 → 结论页 → 退出 App（三级：关弹窗 → 回结论 → exitApp）
- ✅ **相机唤起**：`btnPickPhoto` 拉起 `IMAGE_CAPTURE` → `com.android.camera.CaptureActivity`（manifest `<queries>` 生效）
- ✅ 多语言切换（简/繁/EN，标签与按钮即时跟随）、找水域弹窗、设置面板与 8 家识图厂商预设
- ✅ **IndexedDB 存储（WebView 里实测）**：后端 `idb`、11 个键 / 约 0.7 MB；旧 localStorage 的 10 项
  （渔获 3 条、快照、接口缓存、语言）自动迁移并清空旧键；直接读 IndexedDB 原始游标逐条核对一致；
  重载后设置与渔获仍在
- ✅ **可配置口径在真机可反复切换**：评分偏好（四套权重数字都对）、水温来源（手动 22℃ → 环境分按 22 重算）、
  卫星兜底开关、路线服务（OSRM / 自定义 / 关掉，连点 4 次都生效）

- ✅ **底图中文化**：默认 `OSM 中文 · 深色`（tile.openstreetmap.de 镜像；官方 tile.openstreetmap.org 实测 12 s 超时、
  osmfr 在 z15 缺图，.de 稳定）。z14–z15 实测瓦片 4/4 加载，地图上出现「李家坞社区 / 西园社区 / 新安大街」等中文地名；
  浅色瓦片靠 `invert + hue-rotate + 降饱和` 压暗，标注与钓点图层不受影响。
  **CARTO 三档现在必须带 Key**：不带 key 返回「API KEY REQUIRED」占位图（本次实测），已在设置里标「需 Key」。
- ✅ **点地图选点**：点地图 → 弹出 `leaflet-popup locpick`（显示经纬度 + 「设为当前位置」）→ 点按钮后
  `state.me` 变成点击坐标、`locSource = manual`，整条取数与评分链路从新坐标重跑。
- ✅ **卡片数值居中**：`.locgrid .kv` / `.statgrid .st` / `#weatherGrid .st` / `.satmeta .st` 的 `text-align` 全部为 center；
  长文本行（钓点卡片）仍保持左对齐。
- ✅ **影像面板改单图**：DOM 里只剩 1 个期次下拉 + 2 个缩放按钮，`#satHiBox` 已移除；画布 CSS 宽 393 px（卡片 363 px，左右出血）；
  点 `+` 后 `satZoom` 0.9 → 0.65，图注同步显示「窗口 ±0.65 km · 129×133 px」。
- ✅ **启动器图标（ComfyUI 生成）**：本机 ComfyUI 8199 + Qwen-Image 2.1 出图，概念是「定位针里一条鱼咬亮片、针尖落进水面涟漪」，
  1024×1024 / euler / 22 步 / cfg 2.8；选中的源图存 `icons/source/icon-1024-source.png`，提示词与参数见 `native/icons/README.txt`。
  自适应图标用整张图当背景（全出血 + 缩放 0.86），旧版图标另做圆角/圆形，`monochrome` 用矢量鱼标；
  网页 `icons/icon-192/512.png` 同步更新。真机抽屉实测：深色圆底 + 定位针 + 鱼咬亮片，48px 起仍可辨识。
  名称 `LureCast` 不再被截断（activity 上单独的 `title_activity_main` label 已去掉）。
- ✅ **风况卡修复（本轮）**：`skelInto()` 早先直接把 `.compasswrap` 的 innerHTML 换成骨架，把罗盘 SVG 和 `#windText`
  一起删了，之后 `renderWind()` 找不到节点 → 整张卡只有标题和「风后报」chip。改为独立的 `#windSkel` 骨架槽，
  实测罗盘指针 3 笔风线、`风从 东南 吹向 西北，1 m/s（4 km/h）…9 个采样岸段是迎风岸，主要集中在 北岸`、
  4 个 chip（现在/+1h/+3h/+6h）全部出现，骨架自动清空。顺带修了指针 180° 反向（SVG 针尖画在正下方，
  旋转要多加 180° 才对齐「正北朝上」）。
- ✅ **地图独立全屏（本轮）**：`#cardMap` 头部新增全屏按钮 → `position: fixed; inset: 0`，实测卡片 412×842、
  地图区 667 px、瓦片铺满、`body` 滚动锁死、图标切到「收起」；退出三路都通：再点按钮 / `Esc` / 安卓返回键
  （返回键优先级最高一级，关全屏不退出 App），退出后回到 298 px 且仍停在钓点页。切分区也会自动退出全屏。
- ✅ **地形结构卡只占一半（本轮）**：真因是宽屏 6 列网格里这张卡只 `span 3`（1200 px 视口下卡片 566 px，
  右边整片空）。加 `span2` 后实测 1144/1144 满宽，6 格完整、无裁切（窄屏本来就满宽，未受影响）。
- ✅ **坐标分享 / 外部导航（本轮）**：定位卡「分享」→ 面板四格（高德导航 / 百度导航 / 分享位置 / 复制坐标）。
  实测坐标换算：WGS-84 29.57000,119.02000 → GCJ-02 29.56752,119.02510 → BD-09 29.57378,119.03155；

  国外点（巴黎 48.8584,2.2945）不偏移。点「高德导航」在没装高德 App 的模拟器上：先发 `androidamap://`
  深链（被 `Bridge.launchIntent` 静默吞掉），1.4 s 内没切走 → 回落到 `uri.amap.com` 网页版，
  实测确实拉起了 Chrome（`mCurrentFocus=com.android.chrome/...FirstRunActivity`），App 本身没被导航走。
  「分享位置」拉起系统分享面板（`com.android.intentresolver.ChooserActivity`），内容为
  `千岛湖 · 湖心 / 坐标 29.57000, 119.02000（WGS-84）/ 高德坐标 29.56752, 119.02510（GCJ-02）/ 链接`。
  「复制坐标」三行文本进剪贴板并弹轻提示。定位卡头部两个按钮 56+103 px，363 px 宽下不挤压。
  新增 `assets/share.js`（纯本地换算，不联网）、`#modalShare`、`.toast` 轻提示；i18n 补 12 条词条。
- ✅ **本轮（r17）六项一起过**：①罗盘指北：模拟 `deviceorientationabsolute` alpha=270/180 → 刻度盘 rotate 269.8°/179.8°、
  指针同步换算、标题显示「90°/180°」，无磁力计机型（模拟器）如实显示「无磁力计」；②加载提速：新坐标 5.8 s
  出结论与钓点（`state.timing`：data 4779 ms / elev 1022 ms / sat 1235 ms 并行），状态条每 0.5 s 追加计时；
  ③原生 UI 清零：`select:not(.uisource)` = 0，自绘 `UI.alert/confirm/prompt/sheet` 实测可用（危险按钮带 `danger` 红）；
  ④地图「我的位置」：先挪到 0,0/z3，点按钮回到 39.2372,-123.1500、zoom=15；⑤搜索历史：注入 2 条 → 弹窗可见、
  点第一条即切到千岛湖；⑥助手发图：注入 120×120 JPEG → 缩略图出现（data URL），发送时组装
  `[{type:'text'},{type:'image_url'}]`（Gemini 侧转 `inline_data`）。全程 0 未捕获异常。
- ✅ **AI 助手 / 应用内 Agent（本轮）**：顶栏星标 → `#modalAgent` 聊天面板，15 个本机工具（10 读 + 5 写）。
  实测：未配 Key 时给「先配一个大模型 + 打开设置」引导；配好后标题显示模型名；请求打到
  `{base}/chat/completions`，body 带 `tools`（15 条，含 `required`）、`tool_choice=auto`、`Authorization`。
  伪模型先要求 `bite_score / spots / app_status` → 三个工具在本机执行、结果以
  `{"环境分":85,"因子":[…]}` 回填 → 第二轮拿到 tool 消息后给结论；气泡上显示
  `查 · bite_score / 查 · spots / 查 · app_status` 三枚 chip；对话写进 `lc:agent`（IndexedDB）。
  **模型口径（r12 修正）**：识图与助手共用同一个模型，不再给 DeepSeek 换成 `deepseek-chat`
  （那个旧名已下线）。实测只填 DeepSeek 的 Key、模型名留空时：`chatModel = deepseek-flash`、
  `chatReady = true`，请求打到 `https://api.deepseek.com/v1/chat/completions` 且 `model=deepseek-flash`，
  面板顶部显示「模型 deepseek-flash」。只有遇到不支持工具调用的视觉预览版，用户才需要在
  「对话模型」里单独填；占位提示会写「留空 = 用 deepseek-flash」。
  写操作 `set_water_type` 实测 `state.waterType` auto → river 并触发重算。
  Gemini 分支单独验过：URL 走 `models/<model>:generateContent`、`systemInstruction` 就位、
  参数类型转大写 `OBJECT`、15 条 functionDeclarations、`functionCall` 能解析回工具名。
  0 未捕获异常。测试用的假 Key 已清空，设备上仍是「未配置」状态。
- ✅ **设置弹窗可滚动**：6 个分组全展开后内容 2109 px、可视 630 px，`scrollTop` 能滚到 299+；
  根本原因是 `.modal-body` 是 flex 列，子项默认 `flex-shrink:1` 被压扁后 `overflow:hidden` 直接裁切（既不溢出也不滚动），
  修法 `.modal-body > * { flex: 0 0 auto }` + 给内容区一条可见滚动条（WebView 默认滚动条是不可见的）。
- ✅ **悬浮 AI 助手球（本轮）**：右下角 58 px 磨砂圆球，内联 SVG 两段弧缓慢旋转 + 光晕呼吸 + 虚线内环，
  状态点用固定状态色（未配模型琥珀 / 已配好绿），有新回答时出数字徽标。
  按住拖动（位移 >7 px 才算拖）、松手吸附最近一侧并记住纵向位置（`lc:orb`），轻点打开助手面板，
  面板打开时自动隐去；设置 → 外观与操作 里有开关。
  实测（Android 14 / 1080×2400）：默认 right 16 / bottom 22、58×58；拖到左侧后 `side=left, y=242`
  重启仍在；点击后 `modalAgent` 打开且球 `hidden`；`chkOrb` 关掉后 `on:false` 且不可见。
  在系统「减少动画」下（`animator_duration_scale=0`）自动降级为只做明暗呼吸、不旋转。
  **坑**：环最开始用 `conic-gradient + mask` 画，在这个 WebView 里 `mask` 不生效，
  整个渐变矩形被画成一块白方框（放大 4× 才能看出是旋转的斜方块）。改成内联 SVG 两段圆弧就没问题了。
- ✅ **「更多」折叠区**：结论页底部那两张长卡（环境分怎么算 / 数据来源与局限）移到「我的」末尾的
  `details.moregrp`（默认收起），展开后两张卡完整渲染（因子 6 行、数据源 6 行），结论页不再被它们拉长。
### 踩到的 3 个真坑（都已修，代码在 `assets/app.js` `assets/api.js` `assets/my.js`）

1. **首帧渲染异常连累定位（致命）**：`boot()` 里先 `renderAll()` 后 `locate()`，而 `renderMeta()` 无条件读
   `S.me.lat`；首次启动还没有位置 → 抛 `TypeError` → `locate()` 永不执行 → App 永远「等待定位」。
   桌面测试都带 `?lat=&lon=` 参数，所以从没走到这条路径。
   修：`renderMeta` 加空值判断；`boot()` 把 `renderAll()` 包进 try/catch，渲染出错不再拦住定位。

2. **取消分享被当成导出失败**：安卓分享面板点返回，`Share` 插件抛 `Share canceled`，
   原代码直接 `alert('导出失败')`。`alert()` 还会**阻塞 WebView 主线程**（CDP 都连不上）。
   修：`/cancel|取消|abort/i` 直接忽略，只有真写失败才提示。

3. **Capacitor 的 fetch 补丁读不了大二进制（卫星全废）**：`CapacitorHttp.enabled` 会把 `fetch`/`XHR`
   改走原生桥，响应经 JS 回传。1 KB 的 Range 请求没问题，**384 KB 的 COG 分块 13 s 后必 `Failed to fetch`**
   （XHR 同样失败），卫星影像因此整块不可用。原生 WebView 自己的网络栈没问题（384 KB / 4.7 s，
   6 路并发全成功）。修：只把 `.tif`（COG）请求转交「同源 iframe 里的原始 fetch」，
   其余请求继续享受补丁的绕 CORS 能力（`installCogBridge()`）。

### 环境侧已知限制（不是 App 的 bug）

- Overpass 三个镜像实测 `502 / 500 / 50x`，Nominatim 在该网络下 20 s 超时；
  App 会退回卫星水面提岸线，并在「岸线来源」写明「卫星水面（OSM 不可用）」。
  顺带把 Overpass 总时限 12 s → 18 s（移动网络单次实测可达 40 s+，12 s 必失手）。
- OSM 不可用时「水域类型」只能默认「河流」，千岛湖这类水库需手动点 chips 纠正。
- 模拟器是软件 GL（swiftshader），帧率约 17–28 fps；真机 GPU 下会明显更高。
- 未测：真机相机实拍取景、真机 GPS 户外漂移、iOS 构建。

## 应用内检查更新（不跟随仓库自动更新）

安卓不允许 App 静默替换自己（必须经系统安装器），所以做不到「跟着仓库自动更新」。
设置 →「版本与更新」里做成了**应用内检查 + 一键下载**：填一个公开可访问的更新源即可。

| 方案 | 改动生效 | 代价 |
|---|---|---|
| **A. 应用内检查更新**（已实现） | 重新 `assembleDebug` → 上传到**公开 Release / 网盘** → 更新 `version.json` 的 `build` 号 | 用户点一次「去下载 → 安装」，数据不丢 |
| **B. 网页热更新** | 网页放到 GitHub Pages 或任意静态托管，APK 指向远程地址 → 改完即生效 | 需要联网；离线开局能力变弱 |
| **C. 两者结合** | APK 内置页面 + Pages 作为「最新体验通道」 | 要维护两处入口 |

`version.json` 格式（`src/lib/update.ts` 读它，`build` 大于当前才算新版本）：

```json
{ "build": 19, "apk": "https://…/LureCast.apk", "notes": "这次改了什么", "url": "发布页" }
```

也可以直接填 GitHub Release API：`https://api.github.com/repos/owner/repo/releases/latest`
（公开仓库可用；App 自动取最新 release 的 `.apk` 资产与更新说明）。私有仓库需要 token，App 里不放 token。
