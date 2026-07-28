'use strict';

const FORTUNE_CATALOG_VERSION = 'prototype-v1';

const FORTUNE_LOTS = Object.freeze([
  Object.freeze({
    id: 'prototype-001',
    number: 1,
    level: '上吉',
    title: '静水映心',
    verseLines: Object.freeze([
      '静水澄明照本心',
      '从容徐行自有春',
    ]),
    enabled: true,
  }),
  Object.freeze({
    id: 'prototype-002',
    number: 2,
    level: '中吉',
    title: '守心待时',
    verseLines: Object.freeze([
      '眼前云淡风初定',
      '守得心安路自明',
    ]),
    enabled: true,
  }),
  Object.freeze({
    id: 'prototype-003',
    number: 3,
    level: '小吉',
    title: '循序渐进',
    verseLines: Object.freeze([
      '小步徐行休急促',
      '日积微光亦可期',
    ]),
    enabled: true,
  }),
  Object.freeze({
    id: 'prototype-004',
    number: 4,
    level: '平',
    title: '安住当下',
    verseLines: Object.freeze([
      '且将纷绪轻轻放',
      '安住今朝候转机',
    ]),
    enabled: true,
  }),
  Object.freeze({
    id: 'prototype-005',
    number: 5,
    level: '中吉',
    title: '和合相助',
    verseLines: Object.freeze([
      '一言温厚添和气',
      '同心相助路宽舒',
    ]),
    enabled: true,
  }),
  Object.freeze({
    id: 'prototype-006',
    number: 6,
    level: '小吉',
    title: '云开见月',
    verseLines: Object.freeze([
      '云影虽遮明月在',
      '耐心静候见清辉',
    ]),
    enabled: true,
  }),
]);

module.exports = {
  FORTUNE_CATALOG_VERSION,
  FORTUNE_LOTS,
};
