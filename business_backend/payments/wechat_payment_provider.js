'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const {
  WECHAT_PAY_API_ORIGIN,
} = require('../config/payments');
const { PaymentProvider } = require('./payment_provider');
const {
  createPaymentProtocolError,
} = require('./payment_errors');
const {
  createPaymentHttpTransport,
} = require('./payment_http_transport');
const {
  createWechatAuthorization,
  createWechatJsapiPaySignature,
  decryptWechatResource,
  verifyWechatSignedMessage,
} = require('./wechat_pay_crypto');

const WECHAT_TRADE_STATE_MAP = Object.freeze({
  CLOSED: 'closed',
  NOTPAY: 'pending',
  PAYERROR: 'failed',
  REFUND: 'refunded',
  SUCCESS: 'succeeded',
  USERPAYING: 'pending',
});

function normalizeIpAddress(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.startsWith('::ffff:') ? value.slice(7) : value;
  return net.isIP(normalized) ? normalized : '';
}

function mapWechatH5Type(userAgent) {
  const value = typeof userAgent === 'string' ? userAgent.slice(0, 512) : '';
  if (/Android/i.test(value)) {
    return 'Android';
  }
  if (/(?:iPhone|iPad|iPod)/i.test(value)) {
    return 'iOS';
  }
  return 'Wap';
}

function isDefaultSafeWechatH5Url(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'wx.tenpay.com'
      && url.port === ''
      && url.username === ''
      && url.password === '';
  } catch {
    return false;
  }
}

function requireNonEmptyString(value, code, message) {
  if (typeof value !== 'string' || value === '') {
    throw createPaymentProtocolError(502, code, message);
  }
  return value;
}

class WeChatPaymentProvider extends PaymentProvider {
  constructor({
    config,
    transport,
    apiBaseUrl = WECHAT_PAY_API_ORIGIN,
    allowTestUrls = false,
    h5UrlValidator = isDefaultSafeWechatH5Url,
    clock = Date.now,
    nonceGenerator = () => crypto.randomBytes(16).toString('hex'),
    responseSignatureMaxSkewSeconds,
  } = {}) {
    super();
    if (!config || config.configured !== true) {
      throw new TypeError('Configured WeChat payment settings are required');
    }
    const parsedBaseUrl = new URL(apiBaseUrl);
    if (
      !allowTestUrls
      && parsedBaseUrl.origin !== WECHAT_PAY_API_ORIGIN
    ) {
      throw new TypeError('WeChat API base URL must be the official origin');
    }
    if (typeof h5UrlValidator !== 'function') {
      throw new TypeError('h5UrlValidator must be a function');
    }
    if (typeof clock !== 'function' || typeof nonceGenerator !== 'function') {
      throw new TypeError('clock and nonceGenerator must be functions');
    }
    this.config = config;
    this.apiBaseUrl = parsedBaseUrl.origin;
    this.transport = transport || createPaymentHttpTransport({
      allowedOrigins: [parsedBaseUrl.origin],
    });
    this.h5UrlValidator = h5UrlValidator;
    this.clock = clock;
    this.nonceGenerator = nonceGenerator;
    this.responseSignatureMaxSkewSeconds =
      responseSignatureMaxSkewSeconds;
    this.trustedPublicKeys = Object.freeze({
      [config.platformPublicKeyId]: config.platformPublicKey,
    });
  }

  getRequestedScene(context = {}) {
    return /MicroMessenger/i.test(String(context.userAgent || ''))
      ? 'wechat_jsapi'
      : 'wechat_h5';
  }

  async requestApi({ method, path, bodyObject }) {
    const url = new URL(path, this.apiBaseUrl).toString();
    const body = bodyObject === undefined ? '' : JSON.stringify(bodyObject);
    const timestamp = String(Math.floor(this.clock() / 1000));
    const nonce = this.nonceGenerator();
    const signedRequest = createWechatAuthorization({
      method,
      url,
      body,
      mchId: this.config.mchId,
      serialNo: this.config.merchantSerialNo,
      privateKey: this.config.merchantPrivateKey,
      timestamp,
      nonce,
    });
    const response = await this.transport.request({
      method,
      url,
      headers: {
        Accept: 'application/json',
        Authorization: signedRequest.authorization,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    });
    verifyWechatSignedMessage({
      headers: response.headers,
      rawBody: response.bodyText,
      trustedPublicKeys: this.trustedPublicKeys,
      nowMs: this.clock(),
      ...(this.responseSignatureMaxSkewSeconds === undefined ? {} : {
        maxSkewSeconds: this.responseSignatureMaxSkewSeconds,
      }),
    });

    let responseBody = null;
    if (response.bodyText !== '') {
      try {
        responseBody = JSON.parse(response.bodyText);
      } catch {
        throw createPaymentProtocolError(
          502,
          'PAYMENT_PLATFORM_RESPONSE_INVALID',
          'Payment platform response is invalid'
        );
      }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw createPaymentProtocolError(
        502,
        'PAYMENT_PLATFORM_ERROR',
        'Payment platform rejected the request'
      );
    }
    return Object.freeze({
      body: responseBody,
      rawBody: response.bodyText,
      statusCode: response.statusCode,
    });
  }

  createVerifiedEventFromTransaction(transaction, {
    providerEventId,
    rawDigest,
  }) {
    if (
      !transaction
      || transaction.appid !== this.config.appId
      || transaction.mchid !== this.config.mchId
      || transaction.trade_state !== 'SUCCESS'
    ) {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'WeChat payment transaction fields are invalid'
      );
    }
    const requestedScene = transaction.trade_type === 'JSAPI'
      ? 'wechat_jsapi'
      : transaction.trade_type === 'MWEB'
        ? 'wechat_h5'
        : '';
    if (!requestedScene) {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'WeChat payment trade type is invalid'
      );
    }
    if (
      !transaction.amount
      || !Number.isSafeInteger(transaction.amount.total)
      || !Number.isSafeInteger(transaction.amount.payer_total)
      || transaction.amount.total < 1
      || transaction.amount.payer_total !== transaction.amount.total
      || transaction.amount.currency !== 'CNY'
    ) {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_AMOUNT_MISMATCH',
        'WeChat payment amount is invalid'
      );
    }
    const paidAt = requireNonEmptyString(
      transaction.success_time,
      'PAYMENT_NOTIFICATION_INVALID',
      'WeChat payment time is invalid'
    );
    if (Number.isNaN(Date.parse(paidAt))) {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'WeChat payment time is invalid'
      );
    }
    return Object.freeze({
      provider: 'wechat',
      providerEventId: requireNonEmptyString(
        providerEventId,
        'PAYMENT_NOTIFICATION_INVALID',
        'WeChat payment event ID is invalid'
      ),
      providerTradeNo: requireNonEmptyString(
        transaction.transaction_id,
        'PAYMENT_NOTIFICATION_INVALID',
        'WeChat payment transaction ID is invalid'
      ),
      merchantOrderNo: requireNonEmptyString(
        transaction.out_trade_no,
        'PAYMENT_NOTIFICATION_INVALID',
        'WeChat payment order number is invalid'
      ),
      amountCents: transaction.amount.total,
      currency: 'CNY',
      paymentStatus: 'success',
      paidAt: new Date(paidAt).toISOString(),
      rawDigest,
      requestedScene,
    });
  }

  async createCheckout(order, context = {}) {
    const commonBody = {
      appid: this.config.appId,
      mchid: this.config.mchId,
      description: '传统文化智慧陪伴话费充值',
      out_trade_no: order.merchantOrderNo,
      time_expire: order.expiresAt,
      notify_url: this.config.notifyUrl,
      amount: {
        total: order.amountCents,
        currency: 'CNY',
      },
    };
    if (order.requestedScene === 'wechat_jsapi') {
      if (
        typeof context.wechatOpenId !== 'string'
        || !/^[A-Za-z0-9_-]{1,128}$/.test(context.wechatOpenId)
      ) {
        throw createPaymentProtocolError(
          409,
          'WECHAT_OPENID_REQUIRED',
          'A verified WeChat OpenID is required for JSAPI payment'
        );
      }
      const response = await this.requestApi({
        method: 'POST',
        path: '/v3/pay/transactions/jsapi',
        bodyObject: {
          ...commonBody,
          payer: { openid: context.wechatOpenId },
        },
      });
      const prepayId = requireNonEmptyString(
        response.body && response.body.prepay_id,
        'PAYMENT_PLATFORM_RESPONSE_INVALID',
        'WeChat prepay response is invalid'
      );
      const timeStamp = String(Math.floor(this.clock() / 1000));
      const nonceStr = this.nonceGenerator();
      const packageValue = `prepay_id=${prepayId}`;
      const paySignature = createWechatJsapiPaySignature({
        appId: this.config.appId,
        timeStamp,
        nonceStr,
        packageValue,
        privateKey: this.config.merchantPrivateKey,
      });
      return Object.freeze({
        kind: 'wechat_jsapi',
        payload: Object.freeze({
          appId: this.config.appId,
          timeStamp,
          nonceStr,
          package: packageValue,
          signType: 'RSA',
          paySign: paySignature.signature,
        }),
      });
    }

    if (order.requestedScene !== 'wechat_h5') {
      throw createPaymentProtocolError(
        400,
        'INVALID_PAYMENT_REQUEST',
        'WeChat payment scene is invalid'
      );
    }
    const payerClientIp = normalizeIpAddress(context.payerClientIp);
    if (!payerClientIp) {
      throw createPaymentProtocolError(
        400,
        'INVALID_PAYMENT_REQUEST',
        'A valid payer client IP is required'
      );
    }
    const response = await this.requestApi({
      method: 'POST',
      path: '/v3/pay/transactions/h5',
      bodyObject: {
        ...commonBody,
        scene_info: {
          payer_client_ip: payerClientIp,
          h5_info: { type: mapWechatH5Type(context.userAgent) },
        },
      },
    });
    const h5Url = response.body && response.body.h5_url;
    if (!this.h5UrlValidator(h5Url)) {
      throw createPaymentProtocolError(
        502,
        'PAYMENT_PLATFORM_RESPONSE_INVALID',
        'WeChat H5 payment URL is invalid'
      );
    }
    const resultUrl = new URL(h5Url);
    resultUrl.searchParams.set('redirect_url', this.config.h5ReturnUrl);
    return Object.freeze({
      kind: 'wechat_h5',
      h5Url: resultUrl.toString(),
    });
  }

  async verifyNotification({ headers, rawBody } = {}) {
    if (!Buffer.isBuffer(rawBody)) {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'WeChat notification body is invalid'
      );
    }
    const rawText = rawBody.toString('utf8');
    verifyWechatSignedMessage({
      headers,
      rawBody: rawText,
      trustedPublicKeys: this.trustedPublicKeys,
      nowMs: this.clock(),
      ...(this.responseSignatureMaxSkewSeconds === undefined ? {} : {
        maxSkewSeconds: this.responseSignatureMaxSkewSeconds,
      }),
    });
    let notification;
    try {
      notification = JSON.parse(rawText);
    } catch {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'WeChat notification JSON is invalid'
      );
    }
    if (
      !notification
      || notification.event_type !== 'TRANSACTION.SUCCESS'
      || notification.resource_type !== 'encrypt-resource'
      || !notification.resource
    ) {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'WeChat notification type is invalid'
      );
    }
    const plaintext = decryptWechatResource({
      apiV3Key: this.config.apiV3Key,
      algorithm: notification.resource.algorithm,
      ciphertext: notification.resource.ciphertext,
      nonce: notification.resource.nonce,
      associatedData: notification.resource.associated_data || '',
    });
    let transaction;
    try {
      transaction = JSON.parse(plaintext);
    } catch {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'WeChat transaction JSON is invalid'
      );
    }
    return this.createVerifiedEventFromTransaction(transaction, {
      providerEventId: notification.id,
      rawDigest: crypto.createHash('sha256').update(rawBody).digest('hex'),
    });
  }

  async queryPayment(order) {
    const path = '/v3/pay/transactions/out-trade-no/'
      + `${encodeURIComponent(order.merchantOrderNo)}`
      + `?mchid=${encodeURIComponent(this.config.mchId)}`;
    const response = await this.requestApi({ method: 'GET', path });
    const transaction = response.body;
    if (
      !transaction
      || transaction.out_trade_no !== order.merchantOrderNo
      || transaction.appid !== this.config.appId
      || transaction.mchid !== this.config.mchId
      || !Object.hasOwn(WECHAT_TRADE_STATE_MAP, transaction.trade_state)
    ) {
      throw createPaymentProtocolError(
        502,
        'PAYMENT_PLATFORM_RESPONSE_INVALID',
        'WeChat query response is invalid'
      );
    }
    const result = {
      provider: 'wechat',
      providerStatus: transaction.trade_state,
      status: WECHAT_TRADE_STATE_MAP[transaction.trade_state],
    };
    if (transaction.trade_state === 'SUCCESS') {
      result.verifiedEvent = this.createVerifiedEventFromTransaction(
        transaction,
        {
          providerEventId: `wechat_query_${transaction.transaction_id}`,
          rawDigest: crypto.createHash('sha256')
            .update(response.rawBody)
            .digest('hex'),
        }
      );
    }
    return Object.freeze(result);
  }

  async closePayment(order) {
    const queryResult = await this.queryPayment(order);
    if (queryResult.status === 'succeeded') {
      return Object.freeze({
        closed: false,
        paid: true,
        verifiedEvent: queryResult.verifiedEvent,
      });
    }
    if (queryResult.status === 'closed') {
      return Object.freeze({ closed: true, alreadyClosed: true });
    }
    if (queryResult.providerStatus !== 'NOTPAY') {
      throw createPaymentProtocolError(
        409,
        'PAYMENT_ORDER_STATUS_UNCERTAIN',
        'Payment order status is not safe to close',
        { retryable: true }
      );
    }
    const path = '/v3/pay/transactions/out-trade-no/'
      + `${encodeURIComponent(order.merchantOrderNo)}/close`;
    await this.requestApi({
      method: 'POST',
      path,
      bodyObject: { mchid: this.config.mchId },
    });
    return Object.freeze({ closed: true, alreadyClosed: false });
  }
}

module.exports = {
  WECHAT_TRADE_STATE_MAP,
  WeChatPaymentProvider,
  isDefaultSafeWechatH5Url,
  mapWechatH5Type,
  normalizeIpAddress,
};
