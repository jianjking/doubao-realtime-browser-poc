# 测试与验收记录

日期：2026-07-24

## A. 人工真实云端验收

```text
执行者：项目负责人
执行方式：真实浏览器、真实麦克风、真实豆包 Realtime 云端链路
Codex 本轮是否重跑：否
```

以下结论**经项目负责人实际操作验收确认**：

1. 八角色均能建立真实豆包 Session。
2. 八角色 ASR 正常。
3. 八角色 TTS 正常。
4. 八角色实际使用各自对应音色。
5. 八角色 Prompt 人物气质正确。
6. 用户说话时可以打断模型。
7. 打断后可以继续正常倾听。
8. 结束通话可以正确清理。
9. 重新通话创建新的 WebSocket。
10. 重新通话创建新的 Session。
11. 重新通话仍保持当前角色。
12. 返回首页保留游客或登录状态。
13. 八角色之间没有发生 Prompt 串用。
14. 八角色之间没有发生音色串用。
15. 危险健康表达可以触发正确安全提醒。

## B. 本轮离线自动测试和审计

项目 `package.json` 的 `test` 脚本只是默认失败占位符，因此没有把 `npm test` 伪装成有效测试；本轮直接运行项目真实存在的四个测试文件。

| 测试名称 | 命令 | 退出码 | 通过数 | 失败数 | 跳过数 | 是否访问真实云端 | 最终结论 |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| 八角色配置与连接状态机 | `node tests/eight_character_role_matrix_test.js` | 0 | 1 | 0 | 0 | 否，VM 与假 WebSocket | PASS |
| 首页、通话、重试与 UI 回归 | `node tests/eight_character_ui_matrix_test.js` | 0 | 1 | 0 | 0 | 否，VM/本地逻辑 | PASS |
| 身份门禁、游客与充值原型 | `node tests/auth_guest_recharge_gate_test.js` | 0 | 1 | 0 | 0 | 否，VM/本地状态 | PASS |
| 端口、启动错误与日志脱敏 | `node tests/startup_error_feedback_test.js` | 0 | 1 | 0 | 0 | 否，端口与 WebSocket 均为模拟 | PASS |
| 前一快照完整性 | `sha256sum -c stable_snapshots/eight_character_auth_gate_v1_2026-07-24/SHA256SUMS.txt` | 0 | 42 | 0 | 0 | 否 | 42/42 通过 |

自动测试合计：4 个测试命令通过、0 失败、0 跳过；另有旧快照 42 个文件哈希通过。

现有浏览器截图回归产物位于 `output/playwright/eight_character_auth_gate/`，共 20 张。本轮没有重新启动浏览器或静态服务，也没有重新生成截图。

**离线自动测试不能证明真实音色听感正确；真实音色、ASR/TTS 听感和人物气质以项目负责人此前人工验收为依据。**

