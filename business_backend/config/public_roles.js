'use strict';

const PUBLIC_ROLES = Object.freeze([
  Object.freeze({
    slug: 'yuhuang',
    displayName: '玉皇大帝',
    available: true,
    sortOrder: 1,
  }),
  Object.freeze({
    slug: 'sunwukong',
    displayName: '孙悟空',
    available: true,
    sortOrder: 2,
  }),
  Object.freeze({
    slug: 'guanyin',
    displayName: '观音菩萨',
    available: true,
    sortOrder: 3,
  }),
  Object.freeze({
    slug: 'caishen',
    displayName: '财神爷',
    available: true,
    sortOrder: 4,
  }),
  Object.freeze({
    slug: 'rulai',
    displayName: '如来佛祖',
    available: true,
    sortOrder: 5,
  }),
  Object.freeze({
    slug: 'zhubajie',
    displayName: '猪八戒',
    available: true,
    sortOrder: 6,
  }),
  Object.freeze({
    slug: 'shawujing',
    displayName: '沙悟净',
    available: true,
    sortOrder: 7,
  }),
  Object.freeze({
    slug: 'tangseng',
    displayName: '唐僧',
    available: true,
    sortOrder: 8,
  }),
]);

module.exports = {
  PUBLIC_ROLES,
};
