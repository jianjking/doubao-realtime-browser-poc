# 本地演示说明

## Mock 支付订单闭环

当前支付是本地 Mock 工程闭环，不会调用微信支付或支付宝接口，也不会产生真实扣款。页面会先创建服务端支付订单，再由本地 Mock Provider 生成验证事件；账户余额、充值流水、订单状态和通知去重记录在同一个 SQLite 事务内提交。

默认支付模式为关闭：

```text
PAYMENT_PROVIDER_MODE=disabled
PAYMENT_MOCK_CONFIRMATION_ENABLED=0
```

`start_full_demo.sh` 会为本地完整演示显式设置 `mock` 和 `1`，并在启动日志与充值页面显示“模拟支付，不会产生真实扣款”。`NODE_ENV=production` 时禁止启用 Mock 支付或 Mock 完成接口；`live` 模式在真实 Provider 未配置前返回 `PAYMENT_PROVIDER_NOT_CONFIGURED`，不会降级成 Mock。

真实接入需要商户资料、HTTPS 异步通知地址、签名验证和渠道证书。预留环境变量如下，仓库内不要填写或提交真实值：

```text
WECHAT_PAY_MCH_ID
WECHAT_PAY_APP_ID
WECHAT_PAY_API_V3_KEY
WECHAT_PAY_MERCHANT_SERIAL_NO
WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH
WECHAT_PAY_PUBLIC_KEY_ID
WECHAT_PAY_PUBLIC_KEY_PATH

ALIPAY_APP_ID
ALIPAY_APP_PRIVATE_KEY_PATH
ALIPAY_PUBLIC_KEY
ALIPAY_NOTIFY_URL
ALIPAY_RETURN_URL
```

真实 Provider 尚未实现；不要在当前代码中放入 APIv3 密钥、商户私钥、Cookie 或真实回调载荷。
