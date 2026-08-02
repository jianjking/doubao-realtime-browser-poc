'use strict';

const crypto = require('node:crypto');

const {
  ALIPAY_GATEWAY_URL,
} = require('../config/payments');
const { PaymentProvider } = require('./payment_provider');
const {
  alipayAmountToCents,
  alipayDateTimeToIso,
  canonicalizeAlipayParameters,
  centsToAlipayAmount,
  createSignedAlipayParameters,
  encodeAlipayForm,
  formatAlipayTimestamp,
  sha256Hex,
  verifyAlipayNotificationParameters,
  verifyAndParseAlipayResponse,
} = require('./alipay_crypto');
const {
  createPaymentProtocolError,
} = require('./payment_errors');
const {
  createPaymentHttpTransport,
} = require('./payment_http_transport');

const ALIPAY_TRADE_STATE_MAP = Object.freeze({
  TRADE_CLOSED: 'closed',
  TRADE_FINISHED: 'succeeded',
  TRADE_SUCCESS: 'succeeded',
  WAIT_BUYER_PAY: 'pending',
});

function requireAlipayString(value, code, message) {
  if (typeof value !== 'string' || value === '') {
    throw createPaymentProtocolError(400, code, message);
  }
  return value;
}

class AlipayPaymentProvider extends PaymentProvider {
  constructor({
    config,
    transport,
    gatewayUrl = config && config.gatewayUrl
      ? config.gatewayUrl
      : ALIPAY_GATEWAY_URL,
    allowTestUrls = false,
    clock = Date.now,
  } = {}) {
    super();
    if (!config || config.configured !== true) {
      throw new TypeError('Configured Alipay settings are required');
    }
    const parsedGateway = new URL(gatewayUrl);
    if (!allowTestUrls && parsedGateway.toString() !== ALIPAY_GATEWAY_URL) {
      throw new TypeError('Alipay gateway must be the official HTTPS gateway');
    }
    if (typeof clock !== 'function') {
      throw new TypeError('clock must be a function');
    }
    this.config = config;
    this.gatewayUrl = parsedGateway.toString();
    this.transport = transport || createPaymentHttpTransport({
      allowedOrigins: [parsedGateway.origin],
    });
    this.clock = clock;
  }

  getRequestedScene() {
    return 'alipay_wap';
  }

  buildSignedParameters(method, bizContent, { includeCheckoutUrls = false } = {}) {
    const parameters = {
      app_id: this.config.appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: formatAlipayTimestamp(this.clock()),
      version: '1.0',
      ...(includeCheckoutUrls ? {
        notify_url: this.config.notifyUrl,
        return_url: this.config.returnUrl,
      } : {}),
      biz_content: JSON.stringify(bizContent),
    };
    return createSignedAlipayParameters(
      parameters,
      this.config.appPrivateKey
    );
  }

  async requestApi(method, responseMember, bizContent) {
    const parameters = this.buildSignedParameters(method, bizContent);
    const requestBody = encodeAlipayForm(parameters);
    const response = await this.transport.request({
      method: 'POST',
      url: this.gatewayUrl,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body: requestBody,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw createPaymentProtocolError(
        502,
        'PAYMENT_PLATFORM_ERROR',
        'Payment platform rejected the request'
      );
    }
    const parsed = verifyAndParseAlipayResponse(
      response.bodyText,
      responseMember,
      this.config.platformPublicKey
    );
    if (parsed.code !== '10000') {
      throw createPaymentProtocolError(
        502,
        'PAYMENT_PLATFORM_ERROR',
        'Payment platform rejected the request'
      );
    }
    return Object.freeze({ body: parsed, rawBody: response.bodyText });
  }

  createVerifiedEventFromTrade(trade, {
    providerEventId,
    rawDigest,
  }) {
    if (
      !trade
      || !['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(trade.trade_status)
    ) {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'Alipay trade status is invalid'
      );
    }
    return Object.freeze({
      provider: 'alipay',
      providerEventId: requireAlipayString(
        providerEventId,
        'PAYMENT_NOTIFICATION_INVALID',
        'Alipay event ID is invalid'
      ),
      providerTradeNo: requireAlipayString(
        trade.trade_no,
        'PAYMENT_NOTIFICATION_INVALID',
        'Alipay trade number is invalid'
      ),
      merchantOrderNo: requireAlipayString(
        trade.out_trade_no,
        'PAYMENT_NOTIFICATION_INVALID',
        'Alipay order number is invalid'
      ),
      amountCents: alipayAmountToCents(trade.total_amount),
      currency: 'CNY',
      paymentStatus: 'success',
      paidAt: alipayDateTimeToIso(
        trade.gmt_payment || trade.send_pay_date
      ),
      rawDigest,
      requestedScene: 'alipay_wap',
    });
  }

  async createCheckout(order) {
    if (order.requestedScene !== 'alipay_wap') {
      throw createPaymentProtocolError(
        400,
        'INVALID_PAYMENT_REQUEST',
        'Alipay payment scene is invalid'
      );
    }
    const fields = this.buildSignedParameters(
      'alipay.trade.wap.pay',
      {
        out_trade_no: order.merchantOrderNo,
        total_amount: centsToAlipayAmount(order.amountCents),
        subject: '传统文化智慧陪伴话费充值',
        product_code: 'QUICK_WAP_WAY',
        quit_url: this.config.returnUrl,
        timeout_express: '15m',
      },
      { includeCheckoutUrls: true }
    );
    return Object.freeze({
      kind: 'alipay_wap',
      action: this.gatewayUrl,
      method: 'POST',
      fields,
    });
  }

  async verifyNotification({ parameters, rawBody } = {}) {
    if (
      !parameters
      || !Buffer.isBuffer(rawBody)
      || !verifyAlipayNotificationParameters(
        parameters,
        this.config.platformPublicKey
      )
    ) {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_SIGNATURE_INVALID',
        'Alipay notification signature is invalid'
      );
    }
    if (
      parameters.app_id !== this.config.appId
      || (
        this.config.sellerId
        && parameters.seller_id !== this.config.sellerId
      )
      || !['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(
        parameters.trade_status
      )
    ) {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_NOTIFICATION_INVALID',
        'Alipay notification fields are invalid'
      );
    }
    const totalAmountCents = alipayAmountToCents(parameters.total_amount);
    const receiptAmountCents = alipayAmountToCents(parameters.receipt_amount);
    if (receiptAmountCents < 1 || receiptAmountCents > totalAmountCents) {
      throw createPaymentProtocolError(
        400,
        'PAYMENT_AMOUNT_MISMATCH',
        'Alipay receipt amount is invalid'
      );
    }
    const deterministicContent = canonicalizeAlipayParameters(parameters, {
      excludeSignType: true,
    });
    const providerEventId = parameters.notify_id
      ? parameters.notify_id
      : `alipay_digest_${sha256Hex(deterministicContent)}`;
    return this.createVerifiedEventFromTrade(parameters, {
      providerEventId,
      rawDigest: sha256Hex(rawBody),
    });
  }

  async queryPayment(order) {
    const response = await this.requestApi(
      'alipay.trade.query',
      'alipay_trade_query_response',
      { out_trade_no: order.merchantOrderNo }
    );
    const trade = response.body;
    if (
      trade.out_trade_no !== order.merchantOrderNo
      || !Object.hasOwn(ALIPAY_TRADE_STATE_MAP, trade.trade_status)
    ) {
      throw createPaymentProtocolError(
        502,
        'PAYMENT_PLATFORM_RESPONSE_INVALID',
        'Alipay query response is invalid'
      );
    }
    const result = {
      provider: 'alipay',
      providerStatus: trade.trade_status,
      status: ALIPAY_TRADE_STATE_MAP[trade.trade_status],
    };
    if (result.status === 'succeeded') {
      result.verifiedEvent = this.createVerifiedEventFromTrade(trade, {
        providerEventId: `alipay_query_${trade.trade_no}`,
        rawDigest: sha256Hex(response.rawBody),
      });
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
    const response = await this.requestApi(
      'alipay.trade.close',
      'alipay_trade_close_response',
      { out_trade_no: order.merchantOrderNo }
    );
    if (
      response.body.out_trade_no
      && response.body.out_trade_no !== order.merchantOrderNo
    ) {
      throw createPaymentProtocolError(
        502,
        'PAYMENT_PLATFORM_RESPONSE_INVALID',
        'Alipay close response is invalid'
      );
    }
    return Object.freeze({ closed: true, alreadyClosed: false });
  }
}

module.exports = {
  ALIPAY_TRADE_STATE_MAP,
  AlipayPaymentProvider,
};
