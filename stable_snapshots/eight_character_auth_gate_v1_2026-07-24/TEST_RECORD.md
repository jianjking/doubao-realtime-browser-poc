# 测试记录

测试日期：2026-07-24

## 静态检查

- `node --check`：身份、首页、通话、Realtime 浏览器、Relay 与四个测试文件全部通过。
- `bash -n start_full_demo.sh`：通过。
- 实际启动端口预检：3001 已占用时立即输出指定中文错误并退出。

## 自动回归

- `tests/eight_character_role_matrix_test.js`：PASS
- `tests/eight_character_ui_matrix_test.js`：PASS
- `tests/auth_guest_recharge_gate_test.js`：PASS
- `tests/startup_error_feedback_test.js`：PASS

覆盖身份入口、严格本地状态、home 路由保护、账户摘要、个人信息、退出确认、profile/recharge 单次回跳、游客充值双重拦截、原充值演示、八角色滑动、图片失败、竞态保护、通话结束、重新通话、角色 URL、端口冲突、启动阶段 Relay 错误立即反馈和安全服务端日志。

四组测试也已在本快照目录内再次执行并全部通过；角色矩阵使用快照内附带的上一阶段只读 Relay 基线副本完成 Prompt 回归。

## 浏览器验证

- 视口：360×800、390×844、430×932、1366×768。
- 最终关键截图：手机号首页、手机号账户摘要、滑动至孙悟空。
- 旧选择器 `.character-switch`、`.character-picker`、`.role-list`、`.role-card`：0 个。
- 最终浏览器控制台：0 error、0 warning。

## 阶段 9.1：日志音色 ID 脱敏

- `describeRejectedCharacterKey()` 对 `S_` 格式、默认音色以及任一 `DOUBAO_*_SPEAKER_ID` 环境变量值统一记录为 `string:[redacted-speaker-id]`。
- `characterKey=S_TiUfvBA92`、`characterKey=S_ViUfvBA92` 和自定义环境音色值均保持原有 `relay.error` 与角色拒绝行为。
- 三个场景的终端日志均不包含原始音色 ID，上游 WebSocket 创建次数均为 0。
- `node --check server_doubao_realtime.js`、启动错误回归、八角色矩阵回归与 `sha256sum -c SHA256SUMS.txt` 均通过。
- 本快照 `SHA256SUMS.txt` 使用 UTF-8 无 BOM 和 LF 换行。
