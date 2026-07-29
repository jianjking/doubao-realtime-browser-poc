'use strict';

const MAX_INTERPRETATION_TEXT_LENGTH = 1280;
const INTERPRETATION_FIELDS = Object.freeze(['text']);
const PROHIBITED_PRESENTATION_PATTERNS = Object.freeze([
  /签意概括/,
  /道童解读/,
  /眼下可做的小事/,
  /温馨提示/,
  /安全免责声明/,
  /仅供参考/,
  /解签仅供/,
  /内容仅作(?:传统文化|文化)体验/,
  /签文与解读仅作传统文化体验及情绪陪伴参考/,
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeInterpretationCandidate(candidate) {
  if (!isPlainObject(candidate)) {
    throw new TypeError('interpretation must be a plain object');
  }
  const fields = Reflect.ownKeys(candidate).filter(
    (field) => Object.prototype.propertyIsEnumerable.call(
      candidate,
      field
    )
  );
  if (
    fields.length !== INTERPRETATION_FIELDS.length
    || fields[0] !== INTERPRETATION_FIELDS[0]
  ) {
    throw new TypeError('interpretation must contain only text');
  }

  const text = candidate.text;
  if (
    typeof text !== 'string'
    || text.trim() === ''
    || text.trim().length > MAX_INTERPRETATION_TEXT_LENGTH
    || /[<>]/.test(text)
    || PROHIBITED_PRESENTATION_PATTERNS.some(
      (pattern) => pattern.test(text)
    )
  ) {
    throw new TypeError('interpretation text is invalid');
  }
  return { text: text.trim() };
}

module.exports = {
  INTERPRETATION_FIELDS,
  MAX_INTERPRETATION_TEXT_LENGTH,
  normalizeInterpretationCandidate,
};
