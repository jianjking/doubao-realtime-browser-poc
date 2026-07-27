'use strict';

const BILLING_UNIT_MS = 6000;

const PUBLIC_ROLES = Object.freeze([
  Object.freeze({
    slug: 'yuhuang',
    displayName: '玉皇大帝',
    available: true,
    billingUnitMs: BILLING_UNIT_MS,
    pricePerBillingUnitFen: 10,
    sortOrder: 1,
  }),
  Object.freeze({
    slug: 'sunwukong',
    displayName: '孙悟空',
    available: true,
    billingUnitMs: BILLING_UNIT_MS,
    pricePerBillingUnitFen: 9,
    sortOrder: 2,
  }),
  Object.freeze({
    slug: 'guanyin',
    displayName: '观音菩萨',
    available: true,
    billingUnitMs: BILLING_UNIT_MS,
    pricePerBillingUnitFen: 11,
    sortOrder: 3,
  }),
  Object.freeze({
    slug: 'caishen',
    displayName: '财神爷',
    available: true,
    billingUnitMs: BILLING_UNIT_MS,
    pricePerBillingUnitFen: 13,
    sortOrder: 4,
  }),
  Object.freeze({
    slug: 'rulai',
    displayName: '如来佛祖',
    available: true,
    billingUnitMs: BILLING_UNIT_MS,
    pricePerBillingUnitFen: 15,
    sortOrder: 5,
  }),
  Object.freeze({
    slug: 'zhubajie',
    displayName: '猪八戒',
    available: true,
    billingUnitMs: BILLING_UNIT_MS,
    pricePerBillingUnitFen: 8,
    sortOrder: 6,
  }),
  Object.freeze({
    slug: 'shawujing',
    displayName: '沙悟净',
    available: true,
    billingUnitMs: BILLING_UNIT_MS,
    pricePerBillingUnitFen: 6,
    sortOrder: 7,
  }),
  Object.freeze({
    slug: 'tangseng',
    displayName: '唐僧',
    available: true,
    billingUnitMs: BILLING_UNIT_MS,
    pricePerBillingUnitFen: 7,
    sortOrder: 8,
  }),
]);

module.exports = {
  PUBLIC_ROLES,
};
