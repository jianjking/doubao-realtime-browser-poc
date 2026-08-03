'use strict';

const http = require('node:http');

const {
  MockSmsVerificationProvider,
} = require('../sms/mock_sms_verification_provider');

const TEST_SMS_CODE = '654321';

function createMockSmsTestOptions({
  clock = Date.now,
  exposeCode = true,
  provider,
} = {}) {
  return {
    smsRuntimeConfig: {
      aliyun: { configured: false },
      mockExposeCode: exposeCode,
      mode: 'mock',
      nodeEnv: 'test',
    },
    smsVerificationProvider: provider
      || new MockSmsVerificationProvider({
        clock,
        codeGenerator: () => TEST_SMS_CODE,
        exposeCode,
      }),
  };
}

function requestSmsChallenge(port, phone) {
  const body = JSON.stringify({ phone });
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/auth/sms/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      response.setEncoding('utf8');
      let responseBody = '';
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        let parsedBody;
        try {
          parsedBody = JSON.parse(responseBody);
        } catch (error) {
          reject(error);
          return;
        }
        if (
          response.statusCode !== 201
          || typeof parsedBody.challengeId !== 'string'
        ) {
          reject(new Error(
            `SMS challenge request failed with ${response.statusCode}`
          ));
          return;
        }
        resolve(parsedBody);
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(body);
  });
}

module.exports = {
  TEST_SMS_CODE,
  createMockSmsTestOptions,
  requestSmsChallenge,
};
