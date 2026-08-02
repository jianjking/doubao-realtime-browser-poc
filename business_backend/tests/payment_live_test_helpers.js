'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const {
  canonicalizeAlipayParameters,
  encodeAlipayForm,
  parseAlipayFormBodyStrict,
} = require('../payments/alipay_crypto');
const {
  buildWechatRequestMessage,
  buildWechatResponseMessage,
  signRsaSha256,
  verifyRsaSha256,
} = require('../payments/wechat_pay_crypto');

function generateRsaPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
}

function writeKeyFile(directory, name, key, type) {
  const filePath = path.join(directory, name);
  const bytes = key.export(type === 'private'
    ? { type: 'pkcs8', format: 'pem' }
    : { type: 'spki', format: 'pem' });
  fs.writeFileSync(filePath, bytes, { mode: 0o600 });
  return filePath;
}

function createTemporaryPaymentKeys() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-live-keys-'));
  const wechatMerchant = generateRsaPair();
  const wechatPlatform = generateRsaPair();
  const alipayApp = generateRsaPair();
  const alipayPlatform = generateRsaPair();
  const paths = {
    alipayAppPrivate: writeKeyFile(
      directory,
      'alipay-app-private.pem',
      alipayApp.privateKey,
      'private'
    ),
    alipayPlatformPublic: writeKeyFile(
      directory,
      'alipay-platform-public.pem',
      alipayPlatform.publicKey,
      'public'
    ),
    wechatMerchantPrivate: writeKeyFile(
      directory,
      'wechat-merchant-private.pem',
      wechatMerchant.privateKey,
      'private'
    ),
    wechatPlatformPublic: writeKeyFile(
      directory,
      'wechat-platform-public.pem',
      wechatPlatform.publicKey,
      'public'
    ),
  };
  return {
    alipayApp,
    alipayPlatform,
    apiV3Key: crypto.randomBytes(32),
    directory,
    paths,
    wechatMerchant,
    wechatPlatform,
    cleanup() {
      fs.rmSync(directory, { recursive: true, force: true });
      if (fs.existsSync(directory)) {
        throw new Error('Temporary payment key directory was not removed');
      }
    },
  };
}

function readRequestBody(request, maximumBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > maximumBytes) {
        reject(new Error('request too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks, total)));
    request.on('error', reject);
  });
}

function parseWechatAuthorization(value) {
  if (typeof value !== 'string' || !value.startsWith(
    'WECHATPAY2-SHA256-RSA2048 '
  )) {
    return null;
  }
  const fields = Object.create(null);
  const rest = value.slice('WECHATPAY2-SHA256-RSA2048 '.length);
  for (const match of rest.matchAll(/([a-z_]+)="([^"]*)"/g)) {
    if (Object.hasOwn(fields, match[1])) {
      return null;
    }
    fields[match[1]] = match[2];
  }
  return fields;
}

function createWechatEncryptedResource(apiV3Key, plaintext, {
  nonce = crypto.randomBytes(12).toString('base64url').slice(0, 12),
  associatedData = 'transaction',
} = {}) {
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    apiV3Key,
    Buffer.from(nonce, 'utf8')
  );
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext: encrypted.toString('base64'),
    nonce,
    associated_data: associatedData,
  };
}

function createSignedWechatMessage(rawBody, keys, {
  timestamp = String(Math.floor(Date.now() / 1000)),
  nonce = crypto.randomBytes(12).toString('hex'),
} = {}) {
  const signature = signRsaSha256(
    buildWechatResponseMessage(timestamp, nonce, rawBody),
    keys.wechatPlatform.privateKey
  );
  return {
    'Wechatpay-Timestamp': timestamp,
    'Wechatpay-Nonce': nonce,
    'Wechatpay-Signature': signature,
    'Wechatpay-Serial': 'PUB_KEY_ID_TEST_WECHAT',
  };
}

function createWechatNotification(keys, transaction, {
  eventId = `wx_notice_${crypto.randomUUID()}`,
  timestamp,
} = {}) {
  const outer = {
    id: eventId,
    event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    resource: createWechatEncryptedResource(
      keys.apiV3Key,
      JSON.stringify(transaction)
    ),
    summary: 'payment success',
  };
  const rawBody = Buffer.from(JSON.stringify(outer), 'utf8');
  return {
    headers: createSignedWechatMessage(rawBody.toString('utf8'), keys, {
      ...(timestamp === undefined ? {} : { timestamp }),
    }),
    rawBody,
  };
}

function createAlipayNotification(keys, overrides = {}) {
  const parameters = {
    app_id: '0000000000000000',
    seller_id: '0000000000000000',
    out_trade_no: 'MO_TEST_ORDER',
    trade_no: 'ALI_TEST_TRADE',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '10.00',
    receipt_amount: '10.00',
    gmt_payment: '2026-08-02 16:00:00',
    notify_id: 'ALI_NOTICE_TEST',
    sign_type: 'RSA2',
    ...overrides,
  };
  if (overrides.notify_id === null) {
    delete parameters.notify_id;
  }
  const signContent = canonicalizeAlipayParameters(parameters, {
    excludeSignType: true,
  });
  parameters.sign = signRsaSha256(
    signContent,
    keys.alipayPlatform.privateKey
  );
  return {
    parameters,
    rawBody: Buffer.from(encodeAlipayForm(parameters), 'utf8'),
  };
}

async function startFakePaymentPlatform(keys) {
  const requests = [];
  const wechatTrades = new Map();
  const alipayTrades = new Map();

  function sendWechat(response, statusCode, bodyValue) {
    const rawBody = bodyValue === '' ? '' : JSON.stringify(bodyValue);
    response.writeHead(statusCode, {
      ...createSignedWechatMessage(rawBody, keys),
      ...(rawBody ? { 'Content-Type': 'application/json' } : {}),
      'Content-Length': Buffer.byteLength(rawBody),
    });
    response.end(rawBody);
  }

  function sendAlipay(response, member, bodyValue) {
    const rawResponse = JSON.stringify(bodyValue);
    const signature = signRsaSha256(
      rawResponse,
      keys.alipayPlatform.privateKey
    );
    const rawBody = `{"${member}":${rawResponse},"sign":${JSON.stringify(signature)}}`;
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(rawBody),
    });
    response.end(rawBody);
  }

  const server = http.createServer(async (request, response) => {
    try {
      const rawBody = await readRequestBody(request);
      requests.push({
        method: request.method,
        path: request.url,
        body: rawBody.toString('utf8'),
      });
      if (request.url.startsWith('/v3/')) {
        const authorization = parseWechatAuthorization(
          request.headers.authorization
        );
        const message = authorization && buildWechatRequestMessage({
          method: request.method,
          url: `http://127.0.0.1${request.url}`,
          timestamp: authorization.timestamp,
          nonce: authorization.nonce_str,
          body: rawBody.toString('utf8'),
        });
        if (
          !authorization
          || authorization.mchid !== '0000000000'
          || authorization.serial_no !== 'ABCDEF1234567890'
          || !verifyRsaSha256(
            message,
            authorization.signature,
            keys.wechatMerchant.publicKey
          )
        ) {
          sendWechat(response, 401, { code: 'SIGN_ERROR' });
          return;
        }
        if (request.url === '/v3/pay/transactions/jsapi') {
          const body = JSON.parse(rawBody.toString('utf8'));
          wechatTrades.set(body.out_trade_no, {
            appid: body.appid,
            mchid: body.mchid,
            out_trade_no: body.out_trade_no,
            transaction_id: `WX_${body.out_trade_no}`,
            trade_state: 'NOTPAY',
            trade_type: 'JSAPI',
            amount: {
              total: body.amount.total,
              payer_total: body.amount.total,
              currency: body.amount.currency,
            },
            success_time: '2026-08-02T08:00:00.000Z',
          });
          sendWechat(response, 200, { prepay_id: `prepay_${body.out_trade_no}` });
          return;
        }
        if (request.url === '/v3/pay/transactions/h5') {
          const body = JSON.parse(rawBody.toString('utf8'));
          wechatTrades.set(body.out_trade_no, {
            appid: body.appid,
            mchid: body.mchid,
            out_trade_no: body.out_trade_no,
            transaction_id: `WX_${body.out_trade_no}`,
            trade_state: 'NOTPAY',
            trade_type: 'MWEB',
            amount: {
              total: body.amount.total,
              payer_total: body.amount.total,
              currency: body.amount.currency,
            },
            success_time: '2026-08-02T08:00:00.000Z',
          });
          sendWechat(response, 200, {
            h5_url: `https://wx.tenpay.com/cgi-bin/mmpayweb-bin/checkmweb?prepay_id=${encodeURIComponent(body.out_trade_no)}`,
          });
          return;
        }
        const queryMatch = /^\/v3\/pay\/transactions\/out-trade-no\/([^/?]+)\?mchid=/.exec(request.url);
        if (queryMatch) {
          const trade = wechatTrades.get(decodeURIComponent(queryMatch[1]));
          sendWechat(response, trade ? 200 : 404, trade || { code: 'ORDER_NOT_EXIST' });
          return;
        }
        const closeMatch = /^\/v3\/pay\/transactions\/out-trade-no\/([^/?]+)\/close$/.exec(request.url);
        if (closeMatch) {
          const orderNo = decodeURIComponent(closeMatch[1]);
          const trade = wechatTrades.get(orderNo);
          if (trade) {
            trade.trade_state = 'CLOSED';
          }
          sendWechat(response, 204, '');
          return;
        }
      }

      if (request.url === '/gateway.do') {
        const parameters = parseAlipayFormBodyStrict(rawBody);
        if (
          parameters.app_id !== '0000000000000000'
          || !verifyRsaSha256(
            canonicalizeAlipayParameters(parameters),
            parameters.sign,
            keys.alipayApp.publicKey
          )
        ) {
          response.writeHead(400).end();
          return;
        }
        const bizContent = JSON.parse(parameters.biz_content);
        if (parameters.method === 'alipay.trade.query') {
          const trade = alipayTrades.get(bizContent.out_trade_no) || {
            code: '10000',
            msg: 'Success',
            out_trade_no: bizContent.out_trade_no,
            trade_no: `ALI_${bizContent.out_trade_no}`,
            trade_status: 'WAIT_BUYER_PAY',
            total_amount: '10.00',
          };
          sendAlipay(response, 'alipay_trade_query_response', trade);
          return;
        }
        if (parameters.method === 'alipay.trade.close') {
          const trade = alipayTrades.get(bizContent.out_trade_no);
          if (trade) {
            trade.trade_status = 'TRADE_CLOSED';
          }
          sendAlipay(response, 'alipay_trade_close_response', {
            code: '10000',
            msg: 'Success',
            out_trade_no: bizContent.out_trade_no,
          });
          return;
        }
        if (parameters.method === 'alipay.trade.wap.pay') {
          response.writeHead(200, { 'Content-Type': 'text/plain' });
          response.end('wap accepted');
          return;
        }
      }
      response.writeHead(404).end();
    } catch {
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    alipayTrades,
    gatewayUrl: `${origin}/gateway.do`,
    origin,
    requests,
    wechatTrades,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function createTestWechatConfig(keys) {
  return Object.freeze({
    apiV3Key: keys.apiV3Key,
    appId: 'wxTESTAPPID001',
    configured: true,
    enabled: true,
    h5ReturnUrl: 'https://merchant.example/payment-return',
    mchId: '0000000000',
    merchantPrivateKey: keys.wechatMerchant.privateKey,
    merchantSerialNo: 'ABCDEF1234567890',
    notifyUrl: 'https://merchant.example/api/payment-notifications/wechat',
    platformPublicKey: keys.wechatPlatform.publicKey,
    platformPublicKeyId: 'PUB_KEY_ID_TEST_WECHAT',
  });
}

function createTestAlipayConfig(keys, gatewayUrl = ALIPAY_GATEWAY_FALLBACK) {
  return Object.freeze({
    appId: '0000000000000000',
    appPrivateKey: keys.alipayApp.privateKey,
    configured: true,
    enabled: true,
    gatewayUrl,
    notifyUrl: 'https://merchant.example/api/payment-notifications/alipay',
    platformPublicKey: keys.alipayPlatform.publicKey,
    returnUrl: 'https://merchant.example/payment-return',
    sellerId: '0000000000000000',
  });
}

const ALIPAY_GATEWAY_FALLBACK = 'https://openapi.alipay.com/gateway.do';

module.exports = {
  createAlipayNotification,
  createSignedWechatMessage,
  createTemporaryPaymentKeys,
  createTestAlipayConfig,
  createTestWechatConfig,
  createWechatEncryptedResource,
  createWechatNotification,
  startFakePaymentPlatform,
};
