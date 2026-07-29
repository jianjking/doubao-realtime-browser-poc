# 求签完整真实闭环稳定快照与验收记录

## 1. 快照身份

- 快照名称：`fortune_real_e2e_v1_2026-07-29`
- 创建日期：2026-07-29
- 来源分支：`main`
- 来源 commit：`c7d3f780530cb77b041efc2cc1c797e922e798e6`
- 来源 tree：`e103d07d4c87f4ad293a583d63880b6968566a41`
- 来源 parent：`dc9beffafed594e93980c239f33a594c5439918e`
- 来源提交信息：`feat: add fortune audio playback`
- 用途：固化当前已经分别完成真实验收的求签 ASR、固定抽签、结构化文字解签、TTS V3 和手机端手动播放组合状态，供审计、回归和恢复使用。
- 定位：本快照是开发稳定记录，不代表生产版本，也不是可独立启动的生产部署包。

本阶段没有新增业务功能、修改业务逻辑、调整 UI 或重构代码；`source/` 中的文件均为来源 commit 的逐字节副本。

## 2. 快照范围

本快照固化以下已有链路：

```text
ASR
→ 心愿纸
→ 固定抽签
→ 真实文本模型结构化解签
→ 安全校验
→ 真实 TTS V3
→ 手机端音频准备和手动播放
```

快照仅复制审计和恢复该链路所需的受版本控制文件。共享启动文件包含其他模块的装配代码，但本快照没有复制与求签无关的 Call、账户、计费、充值或 Relay 通话生命周期实现。

## 3. 真实业务调用链

1. 浏览器入口为 `ui_prototypes/yuhuang_mobile_v1/fortune.html`，加载 `entry.css`、`fortune_browser_asr.js` 和 `fortune.js`。
2. `fortune.js` 的 `handleIncenseOffering()`、`startSpeakingSession()` 和 `handleSpeakControl()` 驱动上香及用户主动诉说。
3. `fortune_browser_asr.js` 的 `createFortuneAsrSession()` 请求麦克风，创建 `AudioContext`，并通过 `audioContext.audioWorklet.addModule()` 加载 `/realtime-assets/pcm_capture_processor.js`。
4. `public/pcm_capture_processor.js` 的 `PcmCaptureProcessor.process()` 将浏览器输入帧发送回主线程。
5. `resampleTo16k()` 将实际输入采样率流式降采样到 16 kHz；`float32ToPcm16()` 和 `pcm16ToLittleEndianBuffer()` 生成单声道 PCM16 little-endian 字节。
6. 浏览器通过 WebSocket `/fortune-asr` 发送 `fortune.asr.start`、二进制 PCM 和 `fortune.asr.finish`。
7. `server_doubao_realtime.js` 在共享 upgrade 入口识别 `/fortune-asr`，交由 `fortune_asr_relay.js` 的 `createFortuneAsrRelayConnectionHandler()`。
8. Relay 使用 `createFortuneAsrClientFactoryFromEnv()` 创建 `fortune_asr_client.js` 的 `createFortuneAsrClient()`；客户端组装火山流式 ASR 二进制包、gzip 请求和序列号，并解析 partial、final、错误与终态。
9. Relay 将上游结果映射为 `fortune.asr.partial` 和 `fortune.asr.final`；`fortune.js` 的 `updateWishPaper()` 只用 `textContent` 更新心愿纸，用户确认后由现有焚纸状态机推进。
10. `handleFortuneDraw()` 调用 `POST /api/fortune-sessions`。`business_backend/app.js` 挂载 `createFortuneRouter()`；路由调用 `fortune_service.js` 的 `createDrawnSession()`。
11. `createDrawnSession()` 从 `fortune_lots.js` 的启用签文中固定抽取，创建 Fortune Session，并由 `MemoryFortuneSessionStore` 保存签文与处境快照。
12. `handleFortuneInterpretation()` 仅把 Session ID 放入 URL，调用 interpretation 接口。路由调用 `interpretSession()`。
13. `fortune_interpretation_client.js` 的 `buildMessages()` 将不可信处境放入明确的数据边界；`generateInterpretation()` 使用 OpenAI 兼容接口和 `response_format: { type: "json_object" }`。
14. `fortune_service.js` 的 `validateInterpretationCandidate()` 检查严格四字段、类型、长度和危险确定性表达；成功后将 interpretation 固化到内存 Session。同一 Session 单次生成，并发请求共享 in-flight Promise。
15. `handleInterpretationAudioControl()` 首次点击调用 `requestInterpretationAudio()`，向 `POST /api/fortune-sessions/:sessionId/interpretation-audio` 发送空 body。
16. 路由调用 `synthesizeInterpretationAudio()`；`buildInterpretationNarration()` 按“签意概括、道童解读、眼下可做的小事、温馨提示”顺序组装服务端播报文本，不接受客户端播报文字。
17. `fortune_tts_client.js` 的 `synthesize()` 调用单向 TTS V3 HTTP 接口；`parseAudioResponseStream()` 跨网络 chunk 增量解析 NDJSON，`parseResponseLine()` 校验业务帧并严格解码 Base64。
18. 多段音频按到达顺序聚合，最终成功帧、大小上限和终态全部通过后返回 MP3。`validateInterpretationAudioResult()` 再检查 `audio/mpeg` 和非空 Buffer，随后固化在内存 Session。
19. 前端收到原始 `audio/mpeg` Blob 后调用 `URL.createObjectURL()` 并创建内存 `Audio` 对象；`renderInterpretationAudioState()` 与 `handleInterpretationAudioControl()` 提供准备、播放、暂停、继续、自然结束和重播状态。
20. `releaseInterpretationAudio()` 在 Session 变化、页面重置、`pagehide` 或 `beforeunload` 时中止请求、停止音频、清除 src 并回收 Blob URL；请求 generation 和 Session ID 检查阻止旧异步响应污染新 Session。

## 4. HTTP 与 WebSocket 接口

### WebSocket `/fortune-asr`

- 浏览器先发送 JSON `fortune.asr.start`，随后发送偶数字节的 PCM16 二进制块。
- 结束时发送 `fortune.asr.finish`。
- Relay 返回 ready、started、partial、final、error 和 closed 等稳定事件。
- 浏览器不上传录音文件、WAV、Base64 音频或 Cookie。

### `POST /api/fortune-sessions`

- 客户端请求只包含当前神明键和已确认处境文本。
- 服务端选择固定原型签文，创建内存 Fortune Session，成功状态为 201。
- 公开响应只返回 Session 与签文公开投影。

### `POST /api/fortune-sessions/:sessionId/interpretation`

- 前端只使用 URL 中的 Session ID。
- 请求 body 为空；路由也只接受空 body 或空对象。
- 处境、神明键、签文和完整 prompt 均从服务端 Session 快照取得，不由客户端重复发送。
- 成功结果固化在内存 Session；重复请求返回同一公开 interpretation。

### `POST /api/fortune-sessions/:sessionId/interpretation-audio`

- 请求 body 为空或 `{}`，不得发送 `situationText`、`deityKey`、签文或播报文字。
- 接口不接受客户端提供的 narration。
- 成功响应是原始 `audio/mpeg` 二进制，带 `Content-Length` 和 `Cache-Control: no-store`，不是 JSON 或 Base64。
- 成功 MP3 固化在内存 Session；同一 Session 重复获取返回完全相同字节。

## 5. 固定签文与原型声明

- `catalogVersion`：`prototype-v1`
- 签文数量：6
- 当前签文目录：`business_backend/config/fortune_lots.js`

页面必须保留声明：

```text
当前为项目原型签文，正式签谱后续校订。
```

签文仅作传统文化体验与情绪陪伴参考，不代表正式历史签谱或现实预测。

## 6. 文本模型结构化解签

公开 interpretation 严格包含：

```text
summary
situationReflection
smallAction
safetyNote
```

当前实现具有：

- OpenAI 兼容 `response_format: json_object`；
- 只能包含四个公开字符串字段；
- 字段最大长度分别为 240、500、240、300 字符；
- 危险确定性短语与模式拦截；
- 系统规则与不可信输入数据分离，抵御提示词注入；
- 同 Session 单次生成；
- 并发请求共享同一个 in-flight Promise；
- 失败后清理 generating 状态并允许显式重试；
- 成功结果固化到 Session；
- 浏览器和公开错误不暴露完整处境、完整 prompt 或供应商原始响应。

快照保留受版本控制的客户端源文件以供审计，但本文不复制完整 prompt。

## 7. TTS V3 音频链路

当前实现：

- 使用火山单向 TTS V3 HTTP 接口；
- 每次真实供应商请求使用唯一 UUID v4 request ID；
- 增量解析 NDJSON；
- 支持网络 chunk 跨 JSON 行拼接以及一个 chunk 中多行 JSON；
- 多段 Base64 音频按顺序聚合；
- Base64 必须为严格、规范编码；
- 必须收到最终成功帧且至少收到一段音频；
- 音频总大小上限为 16 MiB；
- 使用 `AbortController` 和总超时，不自动重试；
- HTTP、业务、网络、超时和响应结构错误均脱敏；
- 成功音频作为 Buffer 快照固化在内存 Fortune Session；
- 重复请求读取固化副本，返回完全相同字节。

此前真实 TTS 验收记录的非敏感属性：

```text
Content-Type: audio/mpeg
字节数: 824685
采样率: 24 kHz
码率: 64 kbps
声道: 单声道
同 Session 两次 SHA-256: 完全一致
```

真实 MP3 未复制进本快照。

## 8. 手机端播放状态机

当前已经实现并验收：

- 文字解签成功后显示“听道童解签”；
- 首次点击只请求并准备音频，不自动播放；
- 准备完成后再次点击才播放；
- 播放；
- 暂停；
- 继续；
- 自然结束；
- 重新播放；
- 同一 Session 只请求一次 interpretation-audio；
- 暂停、继续和重播复用当前 Blob URL；
- Session 变化、页面重置和离页时清理请求、音频对象和 Blob URL；
- 旧 Session 异步响应不得污染新 Session；
- 不支持 Audio 或 Blob URL 时显示可重试错误，不静默失败。

## 9. 真实验收与 Fake ASR 边界

### 已真实验收的部分

- 火山引擎流式 ASR 链路此前已进行真实网络验收；
- 固定签文 Session 创建使用真实业务后端；
- interpretation 已使用真实豆包文本模型验收；
- interpretation-audio 已使用真实豆包 TTS V3 验收；
- 返回音频已由基础音频工具识别为真实 MP3；
- 同一 Session 两次音频字节数和 SHA-256 完全一致；
- 手机浏览器已真实下载 Blob 并完成播放控制。

### 最新 430×932 手机浏览器音频播放验收中的 Fake ASR

最新 430×932 手机浏览器音频播放验收，为避免重复触发真实 ASR，使用 Fake ASR 将页面推进到抽签状态。

该次验收真实覆盖：

- `POST /api/fortune-sessions` 返回 201；
- interpretation 返回 200；
- interpretation-audio 返回 200；
- Content-Type 为 `audio/mpeg`；
- interpretation 和 interpretation-audio 请求均只使用 Session ID，body 为空；
- Blob URL 创建一次；
- 播放、暂停、继续、自然结束和重新播放；
- 重播后 interpretation-audio 请求总数仍为一次；
- 四段文字顺序正确；
- 原型签文和文化体验提示可见；
- 无横向溢出；
- 权威真实求签页面控制台错误为 0。

不得声称最新一次 430×932 验收是在同一浏览器 Session 中从真实麦克风、真实 ASR 一直连续跑到真实 TTS 播放，也不得写成“本次完成了全链路单次连续真实云端验收”。

准确边界是：各真实云端环节均已有独立真实验收；最新音频 UI 验收使用 Fake ASR 进入后续真实业务链路；本快照固化当前组合状态。

## 10. 测试记录

`package.json` 的 `test` 是默认失败占位符，未把 `npm test` 冒充正式测试。以下均为仓库中真实存在的离线测试入口；“不访问外部网络”允许测试内部使用本机 loopback、Fake WebSocket 和注入的 Fake fetch。

### 修改前完整测试

| 命令 | 用途 | 退出码 | 通过数量 | strict | 外部网络 | 结果 |
| --- | --- | ---: | ---: | --- | --- | --- |
| `npm run test:business-backend` | 业务后端完整测试 | 0 | 144/144，跳过 0 | 否 | 否 | PASS |
| `node --test business_backend/tests/fortune_session_test.js business_backend/tests/fortune_interpretation_client_test.js business_backend/tests/fortune_interpretation_test.js business_backend/tests/fortune_interpretation_audio_test.js business_backend/tests/fortune_tts_client_test.js` | Fortune 定向服务、文本模型、音频与 TTS | 0 | 52/52，跳过 0 | 否 | 否 | PASS |
| `node tests/fortune_incense_interaction_test.js` | 求签 UI、ASR、音频对象和 Blob URL 生命周期 | 0 | 1 个脚本 | 否 | 否 | PASS |
| `node tests/eight_character_ui_matrix_test.js` | 八角色 UI 与求签入口回归 | 0 | 1 个脚本 | 否 | 否 | PASS |
| `node --use-strict tests/eight_character_ui_matrix_test.js` | 八角色 UI strict 回归 | 0 | 1 个脚本 | 是 | 否 | PASS |
| `$testFiles = @(Get-ChildItem -LiteralPath tests -Filter '*_test.js' \| Sort-Object Name); foreach ($testFile in $testFiles) { node $testFile }` | 根目录全部现有测试脚本 | 0 | 12/12 个脚本 | 否 | 否 | PASS |
| `$testFiles = @(Get-ChildItem -LiteralPath tests -Filter '*_test.js' \| Sort-Object Name); foreach ($testFile in $testFiles) { node --use-strict $testFile }` | 根目录全部现有测试脚本 strict | 0 | 12/12 个脚本 | 是 | 否 | PASS |

修改前合计：7 组命令全部退出 0；业务后端 144/144、Fortune 定向 52/52；根目录 12 个脚本普通和 12 个脚本 strict 全部通过；音频生命周期与八角色 UI 定向执行均通过。

### 快照一致性检查

- 31 个 `source/` 文件均由 `git ls-files` 确认为来源 commit 的受版本控制文件。
- 每个源文件与快照副本逐字节比较。
- `SHA256SUMS.txt` 排除自身，覆盖 `TEST_RECORD.md` 与全部 `source/` 文件。
- 禁止类别与疑似敏感值扫描在提交前执行。
- 最终校验数量和结果见本文生成后完整性审计及 Git 提交报告。

### 修改后完整测试

| 命令 | 用途 | 退出码 | 通过数量 | strict | 外部网络 | 结果 |
| --- | --- | ---: | ---: | --- | --- | --- |
| `npm run test:business-backend` | 业务后端完整测试 | 0 | 144/144，跳过 0 | 否 | 否 | PASS |
| `node --test business_backend/tests/fortune_session_test.js business_backend/tests/fortune_interpretation_client_test.js business_backend/tests/fortune_interpretation_test.js business_backend/tests/fortune_interpretation_audio_test.js business_backend/tests/fortune_tts_client_test.js` | Fortune 定向服务、文本模型、音频与 TTS | 0 | 52/52，跳过 0 | 否 | 否 | PASS |
| `node tests/fortune_incense_interaction_test.js` | 求签 UI、ASR、音频对象和 Blob URL 生命周期 | 0 | 1 个脚本 | 否 | 否 | PASS |
| `node tests/eight_character_ui_matrix_test.js` | 八角色 UI 与求签入口回归 | 0 | 1 个脚本 | 否 | 否 | PASS |
| `node --use-strict tests/eight_character_ui_matrix_test.js` | 八角色 UI strict 回归 | 0 | 1 个脚本 | 是 | 否 | PASS |
| `$testFiles = @(Get-ChildItem -LiteralPath tests -Filter '*_test.js' \| Sort-Object Name); foreach ($testFile in $testFiles) { node $testFile }` | 根目录全部现有测试脚本 | 0 | 12/12 个脚本 | 否 | 否 | PASS |
| `$testFiles = @(Get-ChildItem -LiteralPath tests -Filter '*_test.js' \| Sort-Object Name); foreach ($testFile in $testFiles) { node --use-strict $testFile }` | 根目录全部现有测试脚本 strict | 0 | 12/12 个脚本 | 是 | 否 | PASS |

修改后合计：7 组命令全部退出 0；业务后端 144/144、Fortune 定向 52/52；根目录 12 个脚本普通和 12 个脚本 strict 全部通过；音频生命周期与八角色 UI 定向执行均通过。修改前后测试命令和数量一致，未减少测试，未访问外部网络。

## 11. 环境变量清单

下表只记录变量名和语义，不记录、推断或遮罩任何真实值。

| 变量名 | 必需性与用途 | 类型/语义 | 敏感 |
| --- | --- | --- | --- |
| `DOUBAO_ENABLE_FORTUNE_ASR` | 启用 `/fortune-asr`；真实 ASR Relay 必需 | 字符串 `1` 启用，其他值关闭 | 否 |
| `DOUBAO_ASR_WS_URL` | 火山流式 ASR WebSocket 地址 | 可选 URL；未设置时使用受版本控制默认地址 | 否 |
| `DOUBAO_ASR_API_KEY` | 火山流式 ASR 鉴权 | 非空字符串；启用真实 ASR 时必需 | 是 |
| `DOUBAO_ASR_RESOURCE_ID` | ASR Resource ID | 小写字母、数字和点组成的非空标识；启用真实 ASR 时必需 | 配置标识，不记录值 |
| `FORTUNE_TEXT_MODEL_BASE_URL` | OpenAI 兼容文本模型基础地址 | 非空 HTTPS URL；与 Key、模型名成组配置 | 否 |
| `FORTUNE_TEXT_MODEL_API_KEY` | 文本模型鉴权 | 非空字符串；真实 interpretation 必需 | 是 |
| `FORTUNE_TEXT_MODEL_NAME` | 文本模型或推理接入点名称 | 非空字符串；与地址、Key 成组配置 | 配置标识，不记录值 |
| `FORTUNE_TEXT_MODEL_TIMEOUT_MS` | 文本模型总超时 | 100–60000 毫秒整数；默认 10000 | 否 |
| `FORTUNE_TEXT_MODEL_DISABLE_THINKING` | 控制是否发送禁用思考参数 | 见下方精确语义 | 否 |
| `FORTUNE_TTS_API_KEY` | TTS V3 鉴权 | 非空字符串；与 Resource、Speaker 成组配置 | 是 |
| `FORTUNE_TTS_RESOURCE_ID` | TTS Resource ID | 非空字符串；真实 TTS 必需 | 配置标识，不记录值 |
| `FORTUNE_TTS_SPEAKER_ID` | TTS Speaker ID | 非空字符串；当前为临时中文男声音色 | 配置标识，不记录值 |
| `FORTUNE_TTS_TIMEOUT_MS` | TTS 总超时 | 100–60000 毫秒整数；默认 60000 | 否 |
| `BUSINESS_BACKEND_HOST` | 业务后端监听地址 | 可选非空字符串；默认 `127.0.0.1` | 否 |
| `BUSINESS_BACKEND_PORT` | 业务后端监听端口 | 1–65535 整数；默认 3002，验收可显式使用 8765 | 否 |
| `VOLCENGINE_API_KEY` | 共享 Relay 的 `/realtime` 鉴权 | 非空字符串；不是 `/fortune-asr` 使用的 Key | 是 |

`FORTUNE_TEXT_MODEL_DISABLE_THINKING` 精确语义：

```text
未设置、空字符串、0、false：
不发送 thinking

1、true：
发送 thinking.type = disabled

其他非空值：
启动装配阶段拒绝
```

TTS 大小上限固定在代码中为 16 MiB，不通过环境变量扩大。

## 12. 快照文件清单

| 快照路径 | 原仓库路径 | 所属模块 | 纳入原因 | 类型 |
| --- | --- | --- | --- | --- |
| `TEST_RECORD.md` | 本阶段新建 | 验收记录 | 来源、调用链、测试、配置、边界与恢复依据 | 文档 |
| `SHA256SUMS.txt` | 本阶段生成 | 完整性 | 除自身外全部快照文件的 SHA-256 | 校验清单 |
| `source/package.json` | `package.json` | 依赖结构 | Node 版本语义、正式脚本和 express/ws 依赖 | 配置结构 |
| `source/package-lock.json` | `package-lock.json` | 依赖结构 | 锁定可恢复的依赖版本 | 配置结构 |
| `source/server_doubao_realtime.js` | `server_doubao_realtime.js` | Relay 装配 | 共享 upgrade 入口与 `/fortune-asr` 注册；文件也含无关 Realtime 代码 | 源文件 |
| `source/fortune_asr_client.js` | `fortune_asr_client.js` | ASR 客户端 | 火山流式 ASR 协议、PCM 包、结果与终态解析 | 源文件 |
| `source/fortune_asr_relay.js` | `fortune_asr_relay.js` | ASR Relay | 浏览器与上游 ASR 状态机及安全映射 | 源文件 |
| `source/scripts/fortune_asr_smoke_test.js` | `scripts/fortune_asr_smoke_test.js` | ASR 验收工具 | 显式开启的真实 ASR PCM/WAV 冒烟入口 | 源文件 |
| `source/public/pcm_capture_processor.js` | `public/pcm_capture_processor.js` | AudioWorklet | 权威麦克风 PCM 捕获 Worklet | 源文件 |
| `source/ui_prototypes/yuhuang_mobile_v1/fortune.html` | 同路径 | 手机 UI | 求签页面、四段解签和语音控制 DOM | 源文件 |
| `source/ui_prototypes/yuhuang_mobile_v1/entry.css` | 同路径 | 手机 UI | 求签页布局、430px 壳、状态与音频按钮样式 | 源文件 |
| `source/ui_prototypes/yuhuang_mobile_v1/fortune_browser_asr.js` | 同路径 | 浏览器 ASR | 麦克风、AudioContext、16 kHz PCM16 和 `/fortune-asr` | 源文件 |
| `source/ui_prototypes/yuhuang_mobile_v1/fortune.js` | 同路径 | 求签 UI | 心愿纸、抽签、interpretation 与音频播放状态机 | 源文件 |
| `source/business_backend/server.js` | `business_backend/server.js` | 后端装配 | 文本模型、TTS、移动 UI 和 Worklet 注入 | 源文件 |
| `source/business_backend/app.js` | `business_backend/app.js` | 后端装配 | Fortune Store/Service/Router 与静态资源路由注册；共享文件也含其他模块 | 源文件 |
| `source/business_backend/middleware/require_session.js` | 同路径 | 可选身份 | Fortune 创建路由读取可选 Session Cookie 的直接依赖 | 源文件 |
| `source/business_backend/routes/fortune_routes.js` | 同路径 | Fortune HTTP | 三个业务接口、空 body 与音频二进制响应边界 | 源文件 |
| `source/business_backend/services/fortune_service.js` | 同路径 | Fortune 核心 | 固定抽签、四字段安全、幂等、TTS narration 与音频固化 | 源文件 |
| `source/business_backend/stores/memory_fortune_session_store.js` | 同路径 | Fortune Store | Session、interpretation 和 Buffer 的内存快照与复制 | 源文件 |
| `source/business_backend/config/fortune_lots.js` | 同路径 | 签文目录 | `prototype-v1` 六签固定目录 | 配置结构 |
| `source/business_backend/clients/fortune_interpretation_client.js` | 同路径 | 文本模型 | 安全消息、JSON 模式、thinking 和超时 | 源文件 |
| `source/business_backend/clients/fortune_tts_client.js` | 同路径 | TTS V3 | 鉴权结构、NDJSON、Base64、终态、大小与超时 | 源文件 |
| `source/business_backend/tests/health_test.js` | 同路径 | 静态路由测试 | 移动 UI 与唯一 Worklet 只读路由 | 测试 |
| `source/business_backend/tests/fortune_session_test.js` | 同路径 | Fortune 测试 | 签文目录、固定抽取、Session 和 HTTP 创建 | 测试 |
| `source/business_backend/tests/fortune_interpretation_client_test.js` | 同路径 | 文本模型测试 | 配置、thinking、提示词隔离、超时和脱敏 | 测试 |
| `source/business_backend/tests/fortune_interpretation_test.js` | 同路径 | interpretation 测试 | 四字段、安全、并发、固化、重试和 HTTP | 测试 |
| `source/business_backend/tests/fortune_interpretation_audio_test.js` | 同路径 | 音频服务测试 | narration 顺序、并发、Buffer 固化与 HTTP 二进制 | 测试 |
| `source/business_backend/tests/fortune_tts_client_test.js` | 同路径 | TTS 测试 | V3 请求、NDJSON、Base64、终态、错误和大小 | 测试 |
| `source/tests/fortune_asr_client_test.js` | 同路径 | ASR 客户端测试 | 二进制协议、序列、partial/final 与关闭 | 测试 |
| `source/tests/fortune_asr_relay_test.js` | 同路径 | ASR Relay 测试 | 浏览器消息、PCM 边界、映射与清理 | 测试 |
| `source/tests/fortune_asr_smoke_test_test.js` | 同路径 | ASR 冒烟工具测试 | WAV/PCM 输入、节奏、终态与安全错误 | 测试 |
| `source/tests/fortune_incense_interaction_test.js` | 同路径 | 求签 UI 测试 | 心愿纸、抽签、文本解签、音频对象与 Blob 生命周期 | 测试 |
| `source/tests/eight_character_ui_matrix_test.js` | 同路径 | 跨 UI 回归 | 功能入口、求签页面结构、移动布局和按钮尺寸 | 测试 |

明确排除：`.env`、真实 API Key、Token、Authorization、Cookie、Session 导出、浏览器存储、MP3/WAV/PCM、录音、Blob、模型原始响应、真实用户处境、日志、抓包、截图、临时文件、浏览器 Profile、`node_modules`、coverage、dist、build、缓存、压缩包、数据库、未跟踪文件、旧快照副本以及与求签无关的 Call、账户、计费、充值和 Relay 通话生命周期文件。

## 13. 快照自包含性

- `source/` 保留仓库根目录相对路径，包含理解和恢复当前求签闭环所需的必要受版本控制文件。
- 快照不包含依赖安装目录；依赖由 `package.json` 和 `package-lock.json` 描述。
- 快照不包含外部云服务凭据、真实 MP3、录音、日志、抓包、截图或用户数据。
- 恢复真实云端能力仍需操作者合法配置环境变量，不能从快照中寻找密钥。
- 共享 `server_doubao_realtime.js` 和 `business_backend/app.js` 包含其他模块的装配引用；因此恢复应从来源 commit 的干净工作副本开始，而不是把本目录当成独立项目运行。
- 当前没有数据库，所以快照不包含数据库。
- Session、interpretation 与 MP3 都是服务端内存状态；Node 重启后丢失。
- 浏览器音频是临时 Blob URL；页面刷新或离页后丢失。

## 14. 恢复说明

1. 从来源 commit `c7d3f780530cb77b041efc2cc1c797e922e798e6` 创建新的干净工作副本；不要改写当前工作区。
2. 在快照根目录使用 `sha256sum -c SHA256SUMS.txt` 或等价 SHA-256 校验逐项验证。
3. 按 `source/` 下保留的仓库相对路径，把需要恢复的文件复制到干净副本。
4. 使用锁文件对应的包管理方式安装依赖，例如 `npm ci`；不要复制 `node_modules`。
5. 只配置本文列出的环境变量；不要从快照、日志或命令历史寻找密钥。
6. 运行第 10 节记录的完整普通与 strict 测试集合，确认数量没有减少。
7. 只有在显式启用、合法配置并接受供应商费用时，才分别进行 ASR、文本模型和 TTS 真实网络验收。
8. 再使用 430×932 手机浏览器检查文字与音频 UI；必须如实区分真实 ASR 与 Fake ASR。
9. 不要把本快照目录直接当成可独立启动的生产部署包。

恢复流程不得使用 `git reset --hard` 或 `git clean -fd`。

## 15. 已知边界

当前仍未实现：

```text
自动播放
前端流式音频播放
音频下载功能
音频进度条
倍速
后台播放
最终道童音色
Realtime 解签
Realtime 追问
多轮追问
数据库
Session 持久化
求签历史
求签收费
正式历史签谱
正式 HTTPS/WSS
```

当前 TTS 使用临时中文男声音色，不是最终道童音色。

音频目前只存在于服务端内存 Fortune Session 和浏览器临时 Blob URL。Node 重启后服务端 Session、interpretation 和音频丢失，页面刷新后浏览器 Blob URL 丢失。
