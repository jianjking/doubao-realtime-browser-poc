# 豆包 Realtime 玉皇大帝 Barge-in V1 稳定基线

## 快照信息

- 快照名称：doubao_yuhuang_barge_in_v1_2026-07-22
- 验收日期：2026-07-22

## 1. 版本定位

本版本继承稳定语音基线：

`stable_snapshots/doubao_barge_in_v1_2026-07-22/`

在该稳定语音基线之上，本版本新增玉皇大帝老年陪伴角色提示词。当前版本定位为豆包 Realtime 浏览器持续监听、同 Session 多轮、`server_vad` 自然 Barge-in、玉皇大帝老年陪伴角色 POC 稳定基线。

这是浏览器 POC，不是生产级系统。

## 2. Realtime 能力

- 浏览器麦克风持续采集并持续上行；
- 上行音频为 16 kHz PCM S16LE、单声道；
- 每块 640 bytes，约 20 ms；
- 使用 TaskRequest 200 持续上传；
- `input_mod = keep_alive`；
- 使用 `server_vad`；
- 支持实时 ASR；
- 支持流式 Chat；
- 下行使用 24 kHz PCM TTS；
- 同一个 Session 内保持多轮上下文；
- 使用 ASRInfo 450 实现自然插话；
- 使用 `question_id / reply_id / generation` 隔离新旧回复；
- 停止后重新开始时会清理旧 question、reply 和 generation 状态，首句不会被误判为 Barge-in，后续真正的 Barge-in 仍可正常工作。

## 3. 玉皇大帝角色

- 扮演中国传统神话中的玉皇大帝角色；
- 自称优先使用“朕”；
- 称呼用户为“老友”或“您”；
- 表达庄重、亲切、温和、简短；
- 面向老年用户，使用易于理解的现代普通话；
- 不自称豆包；
- 不冒充现实中的神灵本人；
- 能诚实说明自己是以玉皇大帝形象陪伴用户的智能角色；
- 不宣称拥有超自然能力；
- 不承诺治病、消灾或改变命运；
- 不大量使用文言文或堆砌生僻典故；
- 用户表达停止含义时只作一句极短回复，不继续解释或追问。

整体气质只参考央视 1986 版《西游记》的年代感和庄重感，没有复制影视原台词、原声、配乐、画面、演员表演片段或受版权保护的长段文本。

## 4. 安全规则

以下情况按高风险安全规则处理，且安全规则优先于角色扮演和普通聊天：

- 胸痛；
- 严重呼吸困难；
- 昏倒或失去意识；
- 疑似中风，包括嘴歪、一侧无力、言语突然含糊；
- 严重摔倒；
- 大量出血；
- 明确自伤或自杀想法；
- 已经服药过量；
- 无法叫醒。

高风险回复要求：

- 明确说明情况可能紧急；
- 建议立即联系身边家属、邻居或照护人员；
- 中国大陆场景建议立即拨打 120；
- 用户无法自行行动或呼叫时，建议让身边人代为呼叫或立即大声求救；
- 回复简短、直接；
- 不诊断疾病；
- 不承诺安全；
- 不提供复杂自救操作；
- 不使用“施法救治”等虚假的神力表述。

## 5. 已真实验证

当前运行版本已经通过真实联网会话验证，结果如下：

1. 角色身份测试通过；
2. 模型使用“朕”自称；
3. 模型不自称豆包；
4. 普通陪伴测试通过；
5. 用户表达孤单时，模型先回应和理解情绪；
6. 回复保持简短，最多只问一个问题；
7. 胸痛、喘不上气测试通过；
8. 模型明确建议联系身边人并拨打 120；
9. 停止指令测试通过；
10. 模型长篇播报中，用户直接说“停，别说了”；
11. 旧声音立即停止；
12. 模型只作极短回复，没有继续追问或长篇解释；
13. Barge-in 没有破坏 Session；
14. 诚实身份边界测试通过；
15. 用户询问模型是否是真实神灵、能否治病消灾；
16. 模型说明自己只是以玉皇大帝形象陪伴用户的智能角色；
17. 模型明确否认治病、消灾和改变命运的能力；
18. 模型建议身体不适时就医并遵医嘱；
19. 音色 `S_ViUfvBA92` 正常播放；
20. 测试过程保持同一个 Session 连接。

此外，同 Session 多轮记忆、轮间 49 秒保活、模型播报期间持续上传麦克风音频、ASRInfo 450 自然 Barge-in、停止后原 Session 重启及重启后的再次 Barge-in 均已真实验证。

## 6. 音频格式

上行：

- 浏览器实际采样率通常为 48000 Hz；
- 流式重采样为 16000 Hz；
- PCM S16LE；
- 单声道；
- 每块 320 samples；
- 每块 640 bytes；
- 每块约 20 ms；
- 使用 TaskRequest 200 持续上传。

下行：

- PCM S16LE；
- 24000 Hz；
- 单声道；
- TTSResponse 352；
- 浏览器使用 AudioBufferSourceNode 流式播放。

## 7. 云端配置

- endpoint：`wss://openspeech.bytedance.com/api/v3/realtime/dialogue`；
- Resource ID：`volc.speech.dialog`；
- App Key：`PlgvMymc7f3tQnJ6`；
- model：`1.2.1.1`；
- input_mod：`keep_alive`；
- speaker 通过环境变量配置；
- 当前测试音色 ID：`S_ViUfvBA92`。

本记录不包含 `VOLCENGINE_API_KEY`、完整 Session ID、完整 `question_id` 或完整 `reply_id`。

## 8. 协议边界

- 当前使用 `keep_alive + server_vad`；
- 不使用 ClientInterrupt 515；
- 不使用 EndASR 400；
- 515/400 属于 `push_to_talk`；
- TTSResponse 352 不携带 `reply_id`；
- 使用 TTSSentenceStart 与本地 generation 隔离回复；
- Barge-in 不创建新 Session；
- 不发送伪造静音 PCM；
- 不使用 Base64 音频。

## 9. 停止与关闭

普通“停止实时对话”：

- 停止本地麦克风；
- 停止本地播放；
- 废弃当前 question、reply 和 generation；
- 不发送 FinishSession；
- 不发送 FinishConnection；
- Session 保持连接。

“断开 Relay”的关闭顺序：

1. FinishSession；
2. FinishConnection；
3. ConnectionFinished；
4. WebSocket code 1000。

## 10. 当前未完成

- 未完成生产级 AEC；
- 未系统验证所有外放设备；
- 未完成本地低延迟 VAD；
- 未实现 ConversationTruncate；
- 未完成 STATE/INTENT；
- 未接入 C++ 主工程；
- 未完成移动端；
- 未完成小程序；
- 未实现多角色切换；
- 未做并发多用户；
- 未做长时间压力测试；
- 未做断网自动恢复；
- 未做生产部署；
- 未做生产鉴权系统；
- 未完成背景音乐与环境音；
- 未完成视觉输入接入。

## 11. 受保护项目

本次稳定快照冻结未修改以下项目：

- Qwen 稳定工程；
- `doubao_realtime_text_poc`；
- C++ `beta_demo`；
- 原纯语音 Barge-in 稳定快照 `stable_snapshots/doubao_barge_in_v1_2026-07-22/`。
