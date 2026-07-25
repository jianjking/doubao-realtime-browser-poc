# 文件清单

本快照采用“记录文件 + 外部源文件 SHA-256”的轻量归档方式，不复制业务运行文件。

## 快照内文件

| 相对路径 | 用途 | 来源 | 文件 SHA-256 |
| --- | --- | --- | --- |
| `README.md` | 快照定位、基线、边界与使用说明 | 阶段 9.2B 新生成 | `7a701505e0c7d91f61f613baf2f870d3687d224206659fac814116dafdfc6e2c` |
| `CLOUD_ACCEPTANCE_RECORD.md` | 项目负责人既有真实云端人工验收结论 | 阶段 9.2B 新生成 | `9e55e9451fff931d322c1dfa163aa5c93a9e35a4c6f0a7e1c0f739623c0b91ed` |
| `CONFIG_AUDIT.md` | 八角色映射与运行边界只读审计 | 阶段 9.2B 新生成 | `9265adf935e698b07dda70606e4c59fd196fcdc22b8dd37a04b8de3d8cd37e95` |
| `TEST_RECORD.md` | 人工验收来源与本轮离线测试结果 | 阶段 9.2B 新生成 | `e344b398f0c0ea75fe5be6b6bc5c412cd90b09281edc5d62325e7e18b7a8c67a` |
| `GIT_STATE.txt` | 项目与父仓库边界记录 | 阶段 9.2B 新生成 | `a359a0fd7c0966696fa5e434aae3e20e9c0c57411213d8d09a7c0050e01ec47e` |
| `FILE_MANIFEST.md` | 本文件及外部审计源文件清单 | 阶段 9.2B 新生成 | 由 `SHA256SUMS.txt` 记录，避免在文件内部形成自引用哈希 |
| `SHA256SUMS.txt` | 快照内其余六个普通文件的权威 SHA-256 清单 | 阶段 9.2B 新生成 | 按规范不把自身收入内部清单；自身哈希在最终报告单独记录 |

## 外部审计源文件

以下文件均未复制进本快照。

| 源文件相对路径 | 用途 | 本轮 SHA-256 | 是否复制进快照 |
| --- | --- | --- | --- |
| `server_doubao_realtime.js` | 八角色配置、Prompt、音色解析与 Relay | `32a1488965c955f891d56faa4cc04fe80acaef3ad967f4589f8538e5e494aed4` | 否 |
| `start_full_demo.sh` | 启动、隐藏读取 Key、端口预检与音色环境注入 | `a107dcd02f43acbe7e0bea32f9ac43f0c3f8b874b7fd0bff5c453152939c1774` | 否 |
| `doubao_protocol.js` | 豆包二进制协议实现 | `cc5e8f8960ab874f95d654d759260788fd1d9815b58628d233be524fbec61249` | 否 |
| `ui_prototypes/yuhuang_mobile_v1/index.html` | 身份入口 | `4d5733cd80d0132479e5d4c8a52883d011bc892f0b51d41577e70979a13b1e94` | 否 |
| `ui_prototypes/yuhuang_mobile_v1/home.html` | 八角色首页 | `d9142a30f14cdd3d5178c1a358894441b73eedd2938f349b55ba1405a4e2d6f2` | 否 |
| `ui_prototypes/yuhuang_mobile_v1/auth.css` | 身份入口样式 | `0ff4f44ac95a110db2ef08e79a8c95e2eaf7c8557da80edfe22be35158bcd046` | 否 |
| `ui_prototypes/yuhuang_mobile_v1/auth.js` | 本地身份原型 | `2294e0f85653258714744bc6bf4c4d0c77d40b33863487718359e888c8c7b749` | 否 |
| `ui_prototypes/yuhuang_mobile_v1/ui.css` | 八角色首页样式 | `d8ec2b54558723c9ba2534992387e970e329a6a96226beb9fe9bc54acc89c0d0` | 否 |
| `ui_prototypes/yuhuang_mobile_v1/ui.js` | 八角色顺序、滑动、通话 URL 和本地账户交互 | `a206d18b7ec31b66ce6be992e851db9292d4ec4735c61a605d187fa277e62d33` | 否 |
| `public/index.html` | Realtime 通话页 | `208ebfa9a05a7d6f5553b986a094ecc113632c19e0207e9e601aaac3e272183e` | 否 |
| `public/doubao_realtime.css` | 通话页样式 | `de460f58f3c0b33abd50bfe5f8ec23a69640c46f0aae152a4c7ca72284e0ee7e` | 否 |
| `public/realtime_call_ui.js` | 通话页角色、重试与返回首页状态 | `474651e6675075868a57742f290cf64e5a1340d6c06979119802d30c56f9c8e8` | 否 |
| `public/doubao_mic_single_turn.js` | 浏览器 Realtime、麦克风和启动错误反馈 | `2c5bd33b1a84136930d16bad7e30e82b1287a0bcdb3fc9f4701cb2ea3f16ec8d` | 否 |
| `public/pcm_capture_processor.js` | AudioWorklet PCM 捕获 | `dfc0e22272d9759bdf214e0dce611d423c63721df2e55151ab80a48ecda2dad3` | 否 |
| `tests/eight_character_role_matrix_test.js` | 八角色键、Prompt、音色及连接状态机回归 | `633c7121adc1631d6a1c9ec6655763e8c0169ba87607f2f88a70ee45d4bed416` | 否 |
| `tests/eight_character_ui_matrix_test.js` | 首页、通话、滑动与重试回归 | `74f3fd2603921b5186106c36bf803228cff11f843712b6753616111a692d40e1` | 否 |
| `tests/auth_guest_recharge_gate_test.js` | 身份门禁、游客和充值原型回归 | `c04bb4a67dcb55f48b89c5308c020391d1803e44fcf74197348b62c12269c5ac` | 否 |
| `tests/startup_error_feedback_test.js` | 启动错误、端口和音色日志脱敏回归 | `4f426abf87addaa1986909044893bf9ab57480f17c6e805348c401cc3794bc28` | 否 |
| `stable_snapshots/eight_character_auth_gate_v1_2026-07-24/SHA256SUMS.txt` | 前一稳定快照完整性基线 | `60ee1f44f0cf731d02819405f019c0aa3be8fda862ce1c4cf8fe7a33d4c56179` | 否 |

## 自引用说明

文件无法在自身内容中稳定记录自身最终 SHA-256。`FILE_MANIFEST.md` 的最终哈希由同目录 `SHA256SUMS.txt` 记录；`SHA256SUMS.txt` 按要求排除自身，其自身 SHA-256 在最终审计报告中单独给出。

