# 八角色配置与运行边界审计

审计日期：2026-07-24

审计方式：只读检查当前项目源文件，并运行已有离线测试；未读取 API Key，未启动真实云端会话。

## 八角色映射

| 角色 | characterKey | 音色ID | 角色配置位置 | Prompt 配置位置 | 音色配置位置 | 核对结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 玉皇大帝 | `yuhuang` | `S_ViUfvBA92` | `server_doubao_realtime.js:51-58` | `server_doubao_realtime.js:369`，身份首行 370 | 默认值 `server_doubao_realtime.js:25`；解析 `:194-198` | 精确匹配 |
| 孙悟空 | `sunwukong` | `S_UiUfvBA92` | `server_doubao_realtime.js:59-66` | `server_doubao_realtime.js:397`，身份首行 398 | 环境名 `server_doubao_realtime.js:27`；解析 `:201-207`；注入 `start_full_demo.sh:94` | 精确匹配 |
| 观音菩萨 | `guanyin` | `S_TiUfvBA92` | `server_doubao_realtime.js:67-74` | `server_doubao_realtime.js:428`，身份首行 429 | 环境名 `server_doubao_realtime.js:29`；解析 `:210-216`；注入 `start_full_demo.sh:97` | 精确匹配 |
| 财神爷 | `caishen` | `S_SiUfvBA92` | `server_doubao_realtime.js:75-82` | `server_doubao_realtime.js:459`，身份首行 460 | 环境名 `server_doubao_realtime.js:31`；解析 `:219-225`；注入 `start_full_demo.sh:100` | 精确匹配 |
| 如来佛祖 | `rulai` | `S_RiUfvBA92` | `server_doubao_realtime.js:83-90` | `server_doubao_realtime.js:490`，身份首行 491 | 环境名 `server_doubao_realtime.js:33`；解析 `:228-234`；注入 `start_full_demo.sh:103` | 精确匹配 |
| 猪八戒 | `zhubajie` | `S_PiUfvBA92` | `server_doubao_realtime.js:91-98` | `server_doubao_realtime.js:521`，身份首行 522 | 环境名 `server_doubao_realtime.js:35`；解析 `:237-243`；注入 `start_full_demo.sh:106` | 精确匹配 |
| 沙悟净 | `shawujing` | `S_OiUfvBA92` | `server_doubao_realtime.js:99-106` | `server_doubao_realtime.js:552`，身份首行 553 | 环境名 `server_doubao_realtime.js:37`；解析 `:246-252`；注入 `start_full_demo.sh:109` | 精确匹配 |
| 唐僧 | `tangseng` | `S_NiUfvBA92` | `server_doubao_realtime.js:107-114` | `server_doubao_realtime.js:583`，身份首行 584 | 环境名 `server_doubao_realtime.js:39`；解析 `:255-261`；注入 `start_full_demo.sh:112` | 精确匹配 |

核对结果：

- 八个 `characterKey` 均存在，并各自指向独立角色配置。
- 八个音色 ID 逐字符匹配且互不重复。
- 玉皇大帝为 `S_ViUfvBA92`，孙悟空为 `S_UiUfvBA92`。
- 八个 Prompt 的身份首行分别与角色名称一致。
- 服务端配置与首页 `ui_prototypes/yuhuang_mobile_v1/ui.js:20-125` 的八角色顺序一致。
- 本轮八角色顺序中没有太上老君。

## 启动与交互边界

| 核对项 | 真实位置 | 结果 |
| --- | --- | --- |
| 隐藏读取 API Key | `start_full_demo.sh:84` 使用 `read -r -s` | 通过 |
| 3001 端口预检 | `start_full_demo.sh:62` | 通过 |
| 8765 端口预检 | `start_full_demo.sh:73` | 通过 |
| Relay 启动错误立即反馈 | `public/doubao_mic_single_turn.js:1570-1607` | 通过 |
| 启动等待器拒绝 | `public/doubao_mic_single_turn.js:205-212` | 通过 |
| 返回首页固定为 `home.html` | `public/realtime_call_ui.js:4-5`，使用位置 `:187`、`:377` | 通过 |
| 通话页固定当前角色 | `public/realtime_call_ui.js:195-202` | 通过 |
| 重新通话沿用当前页面角色 | `public/realtime_call_ui.js:563-571` 重用同一 `callCharacter`；浏览器 hello 在 `public/doubao_mic_single_turn.js:1194` 重新读取同一查询参数 | 通过 |
| 新通话使用新 call ID/WebSocket | `public/doubao_mic_single_turn.js:1674`、`:1873-1880` | 通过 |
| 本地身份状态键 | `ui_prototypes/yuhuang_mobile_v1/auth.js:4`、`ui.js:5` | 通过，本地原型 |
| 音色 ID 日志脱敏 | `server_doubao_realtime.js:321-339` | 通过 |

`start_full_demo.sh` 只在运行时通过隐藏输入读取 API Key，源文件没有写死 API Key 值。本轮没有运行该启动脚本，也没有读取任何 API Key。

