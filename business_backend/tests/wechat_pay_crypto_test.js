'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildWechatRequestMessage,
  buildWechatResponseMessage,
  createWechatAuthorization,
  createWechatJsapiPaySignature,
  decryptWechatResource,
  verifyRsaSha256,
  verifyWechatSignedMessage,
} = require('../payments/wechat_pay_crypto');
const {
  createSignedWechatMessage,
  createTemporaryPaymentKeys,
  createWechatEncryptedResource,
} = require('./payment_live_test_helpers');

test('WeChat APIv3 request and JSAPI signatures bind every field', () => {
  const keys = createTemporaryPaymentKeys();
  try {
    const input = {
      method: 'POST',
      url: 'https://api.mch.weixin.qq.com/v3/pay/transactions/h5?mode=test',
      body: '{"amount":{"total":1000}}',
      mchId: '0000000000',
      serialNo: 'ABCDEF1234567890',
      privateKey: keys.wechatMerchant.privateKey,
      timestamp: '1785657600',
      nonce: 'fixed-secure-nonce',
    };
    const signed = createWechatAuthorization(input);
    assert.match(signed.authorization, /^WECHATPAY2-SHA256-RSA2048 /);
    assert.equal(
      verifyRsaSha256(
        signed.message,
        signed.signature,
        keys.wechatMerchant.publicKey
      ),
      true
    );
    for (const mutation of [
      { method: 'GET' },
      { url: 'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi?mode=test' },
      { body: '{"amount":{"total":1001}}' },
      { timestamp: '1785657601' },
      { nonce: 'different-nonce' },
    ]) {
      const message = buildWechatRequestMessage({ ...input, ...mutation });
      assert.equal(
        verifyRsaSha256(
          message,
          signed.signature,
          keys.wechatMerchant.publicKey
        ),
        false
      );
    }

    const jsapi = createWechatJsapiPaySignature({
      appId: 'wxTESTAPPID001',
      timeStamp: '1785657600',
      nonceStr: 'jsapi-nonce',
      packageValue: 'prepay_id=test-prepay',
      privateKey: keys.wechatMerchant.privateKey,
    });
    assert.equal(
      verifyRsaSha256(
        jsapi.message,
        jsapi.signature,
        keys.wechatMerchant.publicKey
      ),
      true
    );
  } finally {
    keys.cleanup();
  }
});

test('WeChat response verification rejects body, key ID, and time changes', () => {
  const keys = createTemporaryPaymentKeys();
  try {
    const nowMs = 1785657600000;
    const rawBody = '{"prepay_id":"test"}';
    const headers = createSignedWechatMessage(rawBody, keys, {
      timestamp: String(nowMs / 1000),
      nonce: 'response-nonce',
    });
    const trustedPublicKeys = {
      PUB_KEY_ID_TEST_WECHAT: keys.wechatPlatform.publicKey,
    };
    assert.equal(
      verifyWechatSignedMessage({
        headers,
        rawBody,
        trustedPublicKeys,
        nowMs,
      }).serial,
      'PUB_KEY_ID_TEST_WECHAT'
    );
    assert.throws(
      () => verifyWechatSignedMessage({
        headers,
        rawBody: `${rawBody} `,
        trustedPublicKeys,
        nowMs,
      }),
      (error) => error && error.code === 'PAYMENT_SIGNATURE_INVALID'
    );
    assert.throws(
      () => verifyWechatSignedMessage({
        headers: { ...headers, 'Wechatpay-Serial': 'WRONG_KEY_ID' },
        rawBody,
        trustedPublicKeys,
        nowMs,
      }),
      (error) => error && error.code === 'PAYMENT_SIGNATURE_INVALID'
    );
    assert.throws(
      () => verifyWechatSignedMessage({
        headers: { ...headers, 'Wechatpay-Serial': '__proto__' },
        rawBody,
        trustedPublicKeys,
        nowMs,
      }),
      (error) => error && error.code === 'PAYMENT_SIGNATURE_INVALID'
    );
    assert.throws(
      () => verifyWechatSignedMessage({
        headers,
        rawBody,
        trustedPublicKeys,
        nowMs: nowMs + 301000,
      }),
      (error) => error && error.code === 'PAYMENT_SIGNATURE_EXPIRED'
    );
    assert.equal(
      verifyRsaSha256(
        buildWechatResponseMessage(
          headers['Wechatpay-Timestamp'],
          headers['Wechatpay-Nonce'],
          rawBody
        ),
        headers['Wechatpay-Signature'],
        keys.wechatPlatform.publicKey
      ),
      true
    );
  } finally {
    keys.cleanup();
  }
});

test('WeChat AES-256-GCM decrypts once and rejects every tampering class', () => {
  const keys = createTemporaryPaymentKeys();
  try {
    const plaintext = JSON.stringify({ out_trade_no: 'MO_TEST', total: 1000 });
    const resource = createWechatEncryptedResource(keys.apiV3Key, plaintext, {
      nonce: '123456789012',
      associatedData: 'transaction',
    });
    assert.equal(
      decryptWechatResource({
        apiV3Key: keys.apiV3Key,
        ...resource,
        associatedData: resource.associated_data,
      }),
      plaintext
    );
    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    encrypted[0] ^= 1;
    for (const mutation of [
      { ciphertext: encrypted.toString('base64') },
      { nonce: '123456789013' },
      { associatedData: 'tampered' },
      { ciphertext: `${resource.ciphertext.slice(0, -4)}AAAA` },
    ]) {
      assert.throws(
        () => decryptWechatResource({
          apiV3Key: keys.apiV3Key,
          ...resource,
          associatedData: resource.associated_data,
          ...mutation,
        }),
        (error) => error && error.code === 'PAYMENT_NOTIFICATION_INVALID'
      );
    }
  } finally {
    keys.cleanup();
  }
});
