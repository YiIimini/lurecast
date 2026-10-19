# AI 助手与识图（可选，Key 只存本机）

两者都不配也能用其它全部功能：点开只会引导你去设置。

## 应用内助手（Agent）

顶栏四角星按钮。它不是挂着玩的聊天框——**模型只能通过工具读这份应用里的真实数据**，
读不到就说没数据，不允许凭印象编温度、分数或坐标（`src/lib/agent.ts`）。

共 15 个工具，模型按需调：

| 类型 | 工具 |
|---|---|
| 读 | `app_status`（定位/水域/目标鱼/数据新鲜度）、`weather_now`、`bite_score`（环境分 + 六因子 + 时段）、`spots`（推荐钓点含理由与拟饵）、`wind_info`（风向/迎风岸）、`water_info`、`terrain_info`（岸坡/岬角/近岸深度）、`satellite_info`、`species_info`、`catch_log`（渔获统计） |
| 写 | `set_location`、`set_water_type`、`set_target_fish`、`goto_tab`、`refresh_data` |

- 每次回答的气泡上方会列这次**查了什么 / 改了什么**（`查 · bite_score`、`已执行 · set_water_type`）。
- 写操作只在你明确要求时执行，等价于替你点了界面上同一个按钮（可以再点回去）。
- **助手能发图**：输入框左边相机按钮 → 拍照/选图 → 压到 900 px JPEG 随问题发给模型，
  可以问「这条鱼是什么」「这个岸边怎么打」。图片不进历史（历史里只留「（附图）」），避免撑爆本机存储。

### 配模型

设置 → 识图与助手 → 选厂商 + 填 Key，**识图与助手共用同一个模型**。
DeepSeek `deepseek-flash`、OpenAI `gpt-4o-mini`、Gemini `gemini-2.0-flash` 本身就同时支持图片输入与
function calling / 工具调用，不用填两个模型名（DeepSeek 旧的 `deepseek-chat` 已下线，请求由 Flash 承接）。
只有当模型不支持工具调用时（某些「视觉预览版」），才需要在设置里单独填「对话模型」。
OpenAI 兼容协议与 Gemini 原生两套都实现了（含工具的声明与回填），不用额外中转。

## 识图

「我的 → 渔获档案 → 拍照」会自动调用你选的视觉模型认鱼，把结果对到本地 25 种鱼库并自动选中，
标出置信度与依据；不对就手动改。没配模型时就是纯手动选（**本地不做 AI 识别**，避免认错鱼）。

| 服务 | 接口形态 | 备注 |
|---|---|---|
| OpenAI（gpt-4o-mini） | OpenAI 兼容 | 模型可换 |
| Google Gemini（gemini-2.0-flash） | Gemini 原生（`?key=`） | `.../models/gemini-2.0-flash:generateContent?key=…` |
| 通义千问 VL（qwen-vl-max） | OpenAI 兼容 | `dashscope.aliyuncs.com/compatible-mode/v1` |
| 豆包 视觉（火山方舟） | OpenAI 兼容 | 模型填推理接入点 `ep-xxx` |
| 智谱 GLM-4V / Kimi 视觉 | OpenAI 兼容 | — |
| DeepSeek（deepseek-flash） | OpenAI 兼容 | 支持图片输入（JPEG/PNG/GIF/WebP，按文件内容判格式） |
| 自定义（OpenAI 兼容） | OpenAI 兼容 | baseURL + 模型名自己填，任何代理都能接 |

- 「测试连接」会把模型原始返回与本地匹配结果直接打出来，失败也把 HTTP 错误原样显示
  （浏览器直连有些厂商不放 CORS，这时只能走代理）。
- 图片发给模型前会压到 720 px。

## 隐私边界

- Key 只存在本机 IndexedDB，不离开设备；但它会出现在浏览器/App 发往厂商的网络请求里 —— **请给 Key 设额度上限**。
- 坐标、渔获、常用地点不会上传；发给模型的只有「你的问题 + 工具取到的那些数值」（发图时再加那张图）。
- 数据来源与缓存见 [`DATA-SOURCES.md`](DATA-SOURCES.md)。
