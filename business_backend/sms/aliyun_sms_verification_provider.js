'use strict';

const Dypnsapi20170525 = require('@alicloud/dypnsapi20170525');
const { $OpenApiUtil } = require('@alicloud/openapi-core');

const { SmsProviderError } = require('./sms_provider_error');

function toNationalPhone(phoneNumber) {
  if (typeof phoneNumber !== 'string' || !/^\+861[3-9]\d{9}$/.test(phoneNumber)) {
    throw new TypeError('A normalized Chinese mobile number is required');
  }
  return phoneNumber.slice(3);
}

class AliyunSmsVerificationProvider {
  #client;
  #settings;

  constructor({ client, settings } = {}) {
    if (!settings || settings.configured !== true) {
      throw new Error('Aliyun SMS credentials are not configured');
    }
    this.#settings = settings;
    this.#client = client || new Dypnsapi20170525.default(
      new $OpenApiUtil.Config({
        accessKeyId: settings.accessKeyId,
        accessKeySecret: settings.accessKeySecret,
        endpoint: settings.endpoint,
      })
    );
  }

  async send({ challengeId, phoneNumber }) {
    const request = new Dypnsapi20170525.SendSmsVerifyCodeRequest({
      codeLength: this.#settings.codeLength,
      codeType: this.#settings.codeType,
      countryCode: this.#settings.countryCode,
      duplicatePolicy: this.#settings.duplicatePolicy,
      outId: challengeId,
      phoneNumber: toNationalPhone(phoneNumber),
      returnVerifyCode: false,
      signName: this.#settings.signName,
      templateCode: this.#settings.templateCode,
      templateParam: this.#settings.templateParam,
      validTime: this.#settings.validTime,
    });
    const response = await this.#client.sendSmsVerifyCode(request);
    const body = response && response.body;
    if (!body || body.code !== 'OK' || body.success !== true) {
      throw new SmsProviderError(
        'ALIYUN_SMS_SEND_REJECTED',
        'Aliyun rejected the SMS send request'
      );
    }
    const model = body.model || {};
    return {
      providerBizId: typeof model.bizId === 'string'
        ? model.bizId
        : null,
      providerRequestId: typeof body.requestId === 'string'
        ? body.requestId
        : typeof model.requestId === 'string'
          ? model.requestId
          : null,
    };
  }

  async verify({ challengeId, code, phoneNumber }) {
    const request = new Dypnsapi20170525.CheckSmsVerifyCodeRequest({
      countryCode: this.#settings.countryCode,
      outId: challengeId,
      phoneNumber: toNationalPhone(phoneNumber),
      verifyCode: code,
    });
    const response = await this.#client.checkSmsVerifyCode(request);
    const body = response && response.body;
    if (!body || body.code !== 'OK' || body.success !== true) {
      throw new SmsProviderError(
        'ALIYUN_SMS_CHECK_REJECTED',
        'Aliyun rejected the SMS verification request'
      );
    }
    const verifyResult = body.model
      && typeof body.model.verifyResult === 'string'
      ? body.model.verifyResult
      : 'UNKNOWN';
    return {
      code: body.code,
      success: body.success,
      verifyResult,
      passed: body.code === 'OK'
        && body.success === true
        && verifyResult === 'PASS',
    };
  }
}

module.exports = {
  AliyunSmsVerificationProvider,
  toNationalPhone,
};
