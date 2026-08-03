# 本地演示说明

## 付费求签

当前每次成功抽到签文默认从登录用户的“当前话费”扣除 ¥2.00。打开页面、敬香、开始语音识别、ASR 失败或尚未生成签文时均不扣费；签文快照与扣款在同一 SQLite 事务中成功后费用才成立。一次费用包含该签文的文字解签和道童解签音频，解签或音频临时失败可免费重试。

价格由 `FORTUNE_DRAW_PRICE_CENTS` 集中配置，默认值为 `200`（整数分），可设置为 1 至 100000 分的十进制正整数。每条付费记录保存当次价格快照，后续调整价格不会改变历史记录；新价格只影响新的求签意图。后续产品价格可能继续调整。

微信与支付宝只用于给现有话费账户充值，不会在每次求签时直接发起平台扣款。

## 支付实现状态

当前仓库已经完成 Mock 支付闭环，以及微信支付 APIv3、支付宝手机网站支付的生产协议代码和离线验收。离线测试只连接本机伪平台，不会调用微信、支付宝真实域名，不会创建真实平台订单，也不会产生真实扣款。

### 已完成

- Mock 支付订单、幂等通知、账户余额和充值流水的 SQLite 事务闭环。
- 微信普通商户 APIv3 的 JSAPI/H5 下单、请求签名、响应验签、通知验签、AES-256-GCM 解密、查询和安全关单。
- 支付宝 WAP 的 RSA2 请求签名、POST 表单、异步通知验签、查询和安全关单。
- 回调原始请求体、大小限制、严格表单解析、渠道身份/金额/场景核对及统一幂等入账。
- 前端 `wechat_jsapi`、`wechat_h5`、`alipay_wap` 收银台调起结构；前端回调或返回页均不能直接确认到账，最终状态只信任服务端。
- 运行时生成临时 RSA 密钥和本地伪支付平台的全离线自动化测试。

### 尚未完成

- 域名 ICP 备案及正式 HTTPS 回调地址。
- 正式商户资料和密钥注入。
- 微信 OAuth/OpenID 绑定与微信商户平台支付域名配置。
- 支付宝正式应用签约与生产配置。
- 真实小额支付验收。
- 退款和生产对账。

**live 模式尚未进行真实扣款验收，不能视为真实支付已经上线。**

## 运行模式

默认支付模式为关闭：

```text
PAYMENT_PROVIDER_MODE=disabled
PAYMENT_MOCK_CONFIRMATION_ENABLED=0
```

`start_full_demo.sh` 会为本地完整演示显式设置 `mock` 和 `1`，并在启动日志与充值页面显示“模拟支付，不会产生真实扣款”。`NODE_ENV=production` 时禁止启用 Mock 支付或 Mock 完成接口。`live` 模式不会降级成 Mock；某个渠道未启用或资料不完整时，该渠道返回 `PAYMENT_PROVIDER_NOT_CONFIGURED`。

## Live 配置入口

仓库内不得填写或提交真实值、PEM、回调报文或 APIv3 密钥。私钥与平台公钥只从仓库外文件读取；通知地址必须为 HTTPS 且不得带查询参数。配置名称如下：

```text
WECHAT_PAY_ENABLED
WECHAT_PAY_MCH_ID
WECHAT_PAY_APP_ID
WECHAT_PAY_API_V3_KEY
WECHAT_PAY_MERCHANT_SERIAL_NO
WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH
WECHAT_PAY_PUBLIC_KEY_ID
WECHAT_PAY_PUBLIC_KEY_PATH
WECHAT_PAY_NOTIFY_URL
WECHAT_PAY_H5_RETURN_URL

ALIPAY_ENABLED
ALIPAY_APP_ID
ALIPAY_APP_PRIVATE_KEY_PATH
ALIPAY_PUBLIC_KEY_PATH
ALIPAY_NOTIFY_URL
ALIPAY_RETURN_URL
ALIPAY_SELLER_ID
ALIPAY_GATEWAY_URL
```

生产代码固定使用微信官方 API Host 和支付宝官方 HTTPS Gateway；本地伪平台地址只能通过测试构造参数注入。微信 JSAPI 还要求服务端提供经过可信 OAuth 流程绑定的 OpenID，绝不接受前端请求体自报 OpenID。

## 离线验证

```bash
npm run test:payment-live-offline
npm run test:payments
```

第一条命令覆盖临时密钥、密码学篡改、伪平台 HTTP、查询/关单、原始回调、并发幂等和前端三种 live checkout；第二条保留原有 Mock 支付、数据库事务和页面流程回归。两者都不应访问真实支付域名。
