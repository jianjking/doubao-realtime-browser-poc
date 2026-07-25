# 冻结检查记录

日期：2026-07-24

## 创建前检查

- 既有两个稳定快照的 `SHA256SUMS.txt` 均逐文件验证通过。
- `public/doubao_mic_single_turn.js`：`6550a4fcb4e2b200cdeea7fa89b63a7159f5c8e4e9371ee3dc5f2ea8acca063d`
- `public/pcm_capture_processor.js`：`dfc0e22272d9759bdf214e0dce611d423c63721df2e55151ab80a48ecda2dad3`
- `doubao_protocol.js`：`cc5e8f8960ab874f95d654d759260788fd1d9815b58628d233be524fbec61249`

## 快照内容

- 首页真实 HTML、CSS、JS。
- 通话页真实 HTML、CSS、JS。
- Realtime Relay 与豆包二进制协议实现。
- 麦克风单轮控制与 PCM AudioWorklet。
- 玉皇大帝、孙悟空当前实际使用的首页和通话页图片。

## 边界

本记录只证明冻结文件的完整性，不声称执行了真实豆包云端 ASR、TTS 音色或 Barge-in 验收。
