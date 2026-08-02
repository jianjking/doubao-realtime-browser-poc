'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createPaymentHttpTransport,
} = require('../payments/payment_http_transport');

test('payment HTTP transport preserves raw bytes and disables redirects', async () => {
  let observed = null;
  const transport = createPaymentHttpTransport({
    allowedOrigins: ['http://127.0.0.1:3456'],
    fetchImpl: async (url, options) => {
      observed = { url: url.toString(), options };
      return new Response(Uint8Array.from([0x7b, 0x7d, 0x0a]), {
        status: 200,
        headers: { 'X-Test-Header': 'preserved' },
      });
    },
  });
  const response = await transport.request({
    method: 'POST',
    url: 'http://127.0.0.1:3456/payment',
    headers: { Authorization: 'redacted-in-test' },
    body: '{}',
  });
  assert.equal(observed.options.redirect, 'manual');
  assert.equal(observed.options.method, 'POST');
  assert.deepEqual([...response.body], [0x7b, 0x7d, 0x0a]);
  assert.equal(response.bodyText, '{}\n');
  assert.equal(response.headers['x-test-header'], 'preserved');
});

test('payment HTTP transport blocks non-allowlisted domains before fetch', async () => {
  let fetchCount = 0;
  const transport = createPaymentHttpTransport({
    allowedOrigins: ['http://127.0.0.1:3456'],
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response('unexpected');
    },
  });
  await assert.rejects(
    transport.request({
      method: 'GET',
      url: 'https://api.mch.weixin.qq.com/v3/pay/transactions',
    }),
    (error) => error && error.code === 'PAYMENT_NETWORK_DESTINATION_REJECTED'
  );
  await assert.rejects(
    transport.request({
      method: 'POST',
      url: 'https://openapi.alipay.com/gateway.do',
    }),
    (error) => error && error.code === 'PAYMENT_NETWORK_DESTINATION_REJECTED'
  );
  assert.equal(fetchCount, 0);
});

test('payment HTTP transport bounds response size and timeout', async () => {
  const oversized = createPaymentHttpTransport({
    allowedOrigins: ['http://localhost:3456'],
    maxResponseBytes: 4,
    fetchImpl: async () => new Response('12345'),
  });
  await assert.rejects(
    oversized.request({ method: 'GET', url: 'http://localhost:3456/test' }),
    (error) => error && error.code === 'PAYMENT_PLATFORM_RESPONSE_TOO_LARGE'
  );

  const timeout = createPaymentHttpTransport({
    allowedOrigins: ['http://localhost:3456'],
    defaultTimeoutMs: 5,
    fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(new Error('aborted'));
      }, { once: true });
    }),
  });
  await assert.rejects(
    timeout.request({ method: 'GET', url: 'http://localhost:3456/test' }),
    (error) => error && error.code === 'PAYMENT_NETWORK_TIMEOUT'
  );
});
