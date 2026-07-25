# 豆包 Realtime Barge-in V1 稳定基线

## 1. 版本定位

本快照冻结的是“豆包 Realtime 浏览器持续监听、同 Session 多轮、server_vad 自然 Barge-in POC 稳定基线”，不是生产级系统。

该浏览器 POC 已具备：

- 持续麦克风上行；
- 同 Session 多轮对话；
- `input_mod = keep_alive`；
- `server_vad` 服务端语音活动检测；
- 用户在模型播报期间直接开口的自然插话；
- 收到 ASRInfo 后立即停止旧播放；
- 使用 `question_id`、`reply_id` 和本地 TTS generation 隔离新旧回复；
- 用户停止实时对话后清理未完成 question、reply、generation，并可在原 Session 中重新开始。

## 2. 音频格式

上行音频：

- 浏览器实际采样率通常为 48000 Hz；
- 流式重采样为 16000 Hz；
- PCM S16LE；
- 单声道；
- 每块 320 samples；
- 每块 640 bytes；
- 每块约 20 ms；
- 使用 TaskRequest，event 200，持续上传到豆包 Realtime Session。

下行音频：

- PCM S16LE；
- 24000 Hz；
- 单声道；
- 使用 TTSResponse，event 352；
- 浏览器通过 AudioBufferSourceNode 对原始 PCM 进行流式排队播放。

## 3. 云端配置

- endpoint：`wss://openspeech.bytedance.com/api/v3/realtime/dialogue`；
- Resource ID：`volc.speech.dialog`；
- App Key：`PlgvMymc7f3tQnJ6`；
- model：`1.2.1.1`；
- input_mod：`keep_alive`；
- speaker：通过环境变量 `DOUBAO_REALTIME_SPEAKER_ID` 配置。

本记录不包含 VOLCENGINE API Key，不包含完整 Session ID，不包含完整 `question_id`，也不包含完整 `reply_id`。

## 4. 已真实验证

截至 2026-07-22，当前稳定基线已完成以下真实联网验收：

- 单轮 ASR、Chat、TTS 完整链路正常；
- 浏览器能够接收 24000 Hz PCM 并进行有声流式播放；
- 浏览器麦克风持续采集，上行 TaskRequest 在模型播报期间保持发送；
- 同一个豆包 Session 内完成多轮对话，没有为每一轮重新建 Session；
- 用户先告诉模型暗号“青云”，后续轮次询问时模型能够回答该暗号，证明同 Session 上下文保留；
- 轮间停止上传音频并空闲 49 秒后，Session 仍然保持可用；
- 模型仍在云端生成和播报旧故事时，用户直接开口能够触发 server_vad 自然插话；
- ASRInfo 到达后浏览器立即停止旧声音，旧 reply 和旧 generation 被废弃；
- 用户插话说“二加三等于几”后，旧故事停止，新问题在原 Session 中继续处理并回答“五”；
- 新 `question_id`、`reply_id` 和 generation 正常接管，旧 Chat/TTS 事件不会推进新状态；
- 用户点击“停止实时对话”后，本地麦克风和播放停止，但豆包 Session 保持连接；
- 在 TTSEnded 已到达、浏览器尚未发送 playback_completed 时停止，未完成的旧 generation 能够被清理；
- 停止后在原 Session 中重新开始，第一句话作为普通新轮次处理，不再被误判为 Barge-in；
- 重新开始后的后续真正 Barge-in 仍能正常停止旧播放并由新 generation 接管；
- 用户最终点击“断开 Relay”时才执行 FinishSession 和 FinishConnection。

## 5. 关闭时序

普通“停止实时对话”的处理：

- 停止浏览器本地麦克风 AudioWorklet；
- 停止 MediaStream tracks 并关闭麦克风 AudioContext；
- 停止本地 TTS source 并关闭当前播放 AudioContext；
- 废弃当前未完成的 question、reply 和 TTS generation；
- 不发送 FinishSession；
- 不发送 FinishConnection；
- Relay WebSocket、豆包 Connection 和豆包 Session 保持连接，等待用户手动重新开始。

“断开 Relay”的处理时序：

1. FinishSession；
2. FinishConnection；
3. ConnectionFinished；
4. WebSocket 使用 code 1000 正常关闭。

## 6. 协议边界

- 当前采用 `keep_alive + server_vad` 路线；
- 不使用 ClientInterrupt（event 515）；
- 不使用 EndASR（event 400）；
- 515/400 属于 `push_to_talk` 路线，不属于当前稳定基线；
- TTSResponse（event 352）是没有 `reply_id` 的裸二进制 PCM；
- 当前使用 TTSSentenceStart 中的 `question_id`、`reply_id` 建立本地 generation；
- Barge-in 或用户主动停止后，Relay 通过失效 question/reply 集合、被中断 generation 集合和二进制丢弃门控隔离旧回复；
- 不为打断创建新 Session，不上传伪造静音 PCM，也不对 TTS 二进制进行 Base64 转换。

## 7. 当前未完成

本稳定基线仍有以下未完成项：

- 未完成生产级 AEC；
- 未系统验证所有外放设备；
- 未完成本地低延迟 VAD；
- 未实现 ConversationTruncate；
- 未完成移动端和小程序；
- 未接入项目角色系统；
- 未接入 STATE/INTENT；
- 未接入 C++ 主工程；
- 未做并发多用户；
- 未做长时间压力测试；
- 未做断网自动恢复；
- 未做生产部署与鉴权系统。

因此，本快照只能作为浏览器 Realtime Barge-in POC 的稳定开发基线，不能描述为生产级系统。

## 8. 受保护项目

本稳定基线开发与冻结过程未修改：

- Qwen 稳定工程；
- `doubao_realtime_text_poc`；
- C++ `beta_demo`。

