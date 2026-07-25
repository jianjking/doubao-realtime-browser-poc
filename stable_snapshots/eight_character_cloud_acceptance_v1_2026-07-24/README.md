# eight_character_cloud_acceptance_v1_2026-07-24

创建日期：2026-07-24

## 定位

本快照用于归档八角色真实豆包 Realtime 云端人工验收结论及当前代码审计证据。

这是本地产品原型的稳定记录，不是生产账户系统，不是真实支付系统，也不是线上部署版本。

## 前一稳定基线

```text
stable_snapshots/eight_character_auth_gate_v1_2026-07-24/
```

前一稳定快照未修改；其内部 `SHA256SUMS.txt` 已在本轮再次校验，结果为 42/42 通过、失败 0。

## 人工验收来源

本快照中的真实云端验收结论，**经项目负责人实际操作验收确认**。项目负责人此前使用真实浏览器、真实麦克风和真实豆包 Realtime 云端链路完成验收。

Codex 本轮未重新发起真实云端会话，只负责验收结果归档、配置核对、离线测试和哈希审计。离线自动测试不能证明真实音色听感或人物气质正确。

## 当前已验收范围

- 八角色独立 `characterKey`
- 八角色独立 Prompt
- 八角色独立豆包音色
- SessionStarted
- ASR
- TTS
- 真实音色听感
- 人物气质
- Barge-in
- 打断后继续倾听
- 结束清理
- 重新通话创建新 WebSocket
- 重新通话创建新 Session
- 重新通话保持当前角色
- 返回首页
- 游客或登录状态保持
- 无 Prompt 串用
- 无音色串用
- 危险健康表达安全提醒

## 尚未接入

1. 真实短信验证码
2. 真实用户数据库
3. 服务端登录会话
4. 真实余额
5. 真实支付
6. 真实 VIP 计费
7. 订单与充值记录后端
8. HTTPS 和线上部署
9. 生产监控和异常上报

## 启动方式

```bash
cd /c/Users/xiaob/Desktop/梦/realtime_web_poc/doubao_realtime_browser_poc
bash start_full_demo.sh
```

脚本通过 `read -s` 隐藏输入 `VOLCENGINE_API_KEY`。不得把 API Key 直接写入命令、源码或日志。

产品入口：

```text
http://127.0.0.1:8765/ui_prototypes/yuhuang_mobile_v1/index.html
```

## 审计依据

本项目没有独立 Git 仓库，在父仓库中也整体未跟踪，因此父仓库分支、HEAD 和 remote 不作为本快照版本依据。本快照使用当前源文件 SHA-256、前一快照完整性校验、八角色配置核对和现有离线自动测试作为代码稳定性证据。

