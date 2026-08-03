'use strict';

const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');
const {
  EVENT,
  encodeClientJsonEvent,
  encodeClientAudioEvent,
  parseServerFrame,
  getEventName,
  DoubaoProtocolError,
} = require('./doubao_protocol.js');
const {
  createRelayInternalCallLifecycleDependency,
} = require('./relay_internal_call_lifecycle_bootstrap');
const {
  createRelayInternalCallLifecycleCoordinator,
} = require('./relay_internal_call_lifecycle_coordinator');

const HOST = '127.0.0.1';
const PORT = 3001;
const WEBSOCKET_PATH = '/realtime';
const FORTUNE_ASR_WEBSOCKET_PATH = '/fortune-asr';
const FORTUNE_ASR_ENABLE_ENV_NAME = 'DOUBAO_ENABLE_FORTUNE_ASR';
const RELAY_VERSION = 'browser-relay-smoke-v1';
const DOUBAO_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';
const DOUBAO_RESOURCE_ID = 'volc.speech.dialog';
const DOUBAO_APP_KEY = 'PlgvMymc7f3tQnJ6';
const DOUBAO_MODEL = '1.2.1.1';
const DEFAULT_SPEAKER_ID = 'S_ViUfvBA92';
const DEFAULT_CHARACTER_KEY = 'yuhuang';
const SUNWUKONG_SPEAKER_ENV_NAME = 'DOUBAO_SUNWUKONG_SPEAKER_ID';
const SUNWUKONG_ENABLE_ENV_NAME = 'DOUBAO_ENABLE_SUNWUKONG';
const GUANYIN_SPEAKER_ENV_NAME = 'DOUBAO_GUANYIN_SPEAKER_ID';
const GUANYIN_ENABLE_ENV_NAME = 'DOUBAO_ENABLE_GUANYIN';
const CAISHEN_SPEAKER_ENV_NAME = 'DOUBAO_CAISHEN_SPEAKER_ID';
const CAISHEN_ENABLE_ENV_NAME = 'DOUBAO_ENABLE_CAISHEN';
const RULAI_SPEAKER_ENV_NAME = 'DOUBAO_RULAI_SPEAKER_ID';
const RULAI_ENABLE_ENV_NAME = 'DOUBAO_ENABLE_RULAI';
const ZHUBAJIE_SPEAKER_ENV_NAME = 'DOUBAO_ZHUBAJIE_SPEAKER_ID';
const ZHUBAJIE_ENABLE_ENV_NAME = 'DOUBAO_ENABLE_ZHUBAJIE';
const SHAWUJING_SPEAKER_ENV_NAME = 'DOUBAO_SHAWUJING_SPEAKER_ID';
const SHAWUJING_ENABLE_ENV_NAME = 'DOUBAO_ENABLE_SHAWUJING';
const TANGSENG_SPEAKER_ENV_NAME = 'DOUBAO_TANGSENG_SPEAKER_ID';
const TANGSENG_ENABLE_ENV_NAME = 'DOUBAO_ENABLE_TANGSENG';
const MISSING_CHARACTER_KEY = Symbol('missing characterKey');
const CHARACTER_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const DANGEROUS_CHARACTER_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'toString',
  'hasOwnProperty',
]);
const DISABLED_INTERNAL_CALL_LIFECYCLE_DEPENDENCY = Object.freeze({
  enabled: false,
  client: null,
});
const CHARACTER_CONFIGS = Object.freeze({
  yuhuang: Object.freeze({
    key: 'yuhuang',
    displayName: '玉皇大帝',
    enabled: true,
    disabledMessage: '',
    buildSystemPrompt: buildYuhuangSystemPrompt,
    resolveSpeakerId: resolveYuhuangSpeakerId,
  }),
  sunwukong: Object.freeze({
    key: 'sunwukong',
    displayName: '孙悟空',
    enabled: isSunwukongEnabled(),
    disabledMessage: '孙悟空语音尚未接入',
    buildSystemPrompt: buildSunwukongSystemPrompt,
    resolveSpeakerId: resolveSunwukongSpeakerId,
  }),
  guanyin: Object.freeze({
    key: 'guanyin',
    displayName: '观音菩萨',
    enabled: isGuanyinEnabled(),
    disabledMessage: '观音菩萨语音尚未接入',
    buildSystemPrompt: buildGuanyinSystemPrompt,
    resolveSpeakerId: resolveGuanyinSpeakerId,
  }),
  caishen: Object.freeze({
    key: 'caishen',
    displayName: '财神爷',
    enabled: isCaishenEnabled(),
    disabledMessage: '财神爷语音尚未接入',
    buildSystemPrompt: buildCaishenSystemPrompt,
    resolveSpeakerId: resolveCaishenSpeakerId,
  }),
  rulai: Object.freeze({
    key: 'rulai',
    displayName: '如来佛祖',
    enabled: isRulaiEnabled(),
    disabledMessage: '如来佛祖语音尚未接入',
    buildSystemPrompt: buildRulaiSystemPrompt,
    resolveSpeakerId: resolveRulaiSpeakerId,
  }),
  zhubajie: Object.freeze({
    key: 'zhubajie',
    displayName: '猪八戒',
    enabled: isZhubajieEnabled(),
    disabledMessage: '猪八戒语音尚未接入',
    buildSystemPrompt: buildZhubajieSystemPrompt,
    resolveSpeakerId: resolveZhubajieSpeakerId,
  }),
  shawujing: Object.freeze({
    key: 'shawujing',
    displayName: '沙悟净',
    enabled: isShawujingEnabled(),
    disabledMessage: '沙悟净语音尚未接入',
    buildSystemPrompt: buildShawujingSystemPrompt,
    resolveSpeakerId: resolveShawujingSpeakerId,
  }),
  tangseng: Object.freeze({
    key: 'tangseng',
    displayName: '唐僧',
    enabled: isTangsengEnabled(),
    disabledMessage: '唐僧语音尚未接入',
    buildSystemPrompt: buildTangsengSystemPrompt,
    resolveSpeakerId: resolveTangsengSpeakerId,
  }),
});
const UPSTREAM_CLOSE_TIMEOUT_MS = 3000;
const BROWSER_PCM_SAMPLE_RATE = 16000;
const BROWSER_PCM_CHUNK_BYTES = 640;
const BROWSER_PCM_MAX_CHUNK_BYTES = 4096;
const BROWSER_AUDIO_STATS_INTERVAL = 25;
const UPSTREAM_AUDIO_MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
const TTS_PCM_SAMPLE_RATE = 24000;
const BROWSER_TTS_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const BUSINESS_CALL_ID_MAX_LENGTH = 128;
const INVALID_BUSINESS_CALL_ID_MESSAGE =
  'Invalid business call identifier';
const CONFLICTING_BROWSER_HELLO_MESSAGE =
  'Conflicting browser.hello';
const BUSINESS_CALL_REQUIRED_MESSAGE =
  'Business call admission is required';
const BUSINESS_CALL_ADMISSION_FAILED_MESSAGE =
  'Business call admission failed';

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

function isValidBusinessCallId(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= BUSINESS_CALL_ID_MAX_LENGTH
    && value.trim() === value
    && value.trim() !== ''
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function isProtocolDebugEnabled() {
  return process.env.DOUBAO_PROTOCOL_DEBUG === '1';
}

function isFortuneAsrEnabled(env = process.env) {
  return env[FORTUNE_ASR_ENABLE_ENV_NAME] === '1';
}

function isSunwukongEnabled() {
  return process.env[SUNWUKONG_ENABLE_ENV_NAME] === '1';
}

function isGuanyinEnabled() {
  return process.env[GUANYIN_ENABLE_ENV_NAME] === '1';
}

function isCaishenEnabled() {
  return process.env[CAISHEN_ENABLE_ENV_NAME] === '1';
}

function isRulaiEnabled() {
  return process.env[RULAI_ENABLE_ENV_NAME] === '1';
}

function isZhubajieEnabled() {
  return process.env[ZHUBAJIE_ENABLE_ENV_NAME] === '1';
}

function isShawujingEnabled() {
  return process.env[SHAWUJING_ENABLE_ENV_NAME] === '1';
}

function isTangsengEnabled() {
  return process.env[TANGSENG_ENABLE_ENV_NAME] === '1';
}

function sendJson(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) {
    log('[Relay] WebSocket 未处于 OPEN 状态，无法发送消息');
    return false;
  }

  const serialized = JSON.stringify(message);
  socket.send(serialized, (error) => {
    if (error) {
      log(`[Relay] 发送消息失败：${error.message}`);
    }
  });
  return true;
}

function getDoubaoConfig() {
  const apiKey = process.env.VOLCENGINE_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('VOLCENGINE_API_KEY 未配置');
  }

  return {
    url: DOUBAO_URL,
    headers: {
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': DOUBAO_RESOURCE_ID,
      'X-Api-App-Key': DOUBAO_APP_KEY,
      'X-Api-Connect-Id': crypto.randomUUID(),
    },
    apiKey,
  };
}

function resolveYuhuangSpeakerId() {
  const configuredSpeaker = process.env.DOUBAO_REALTIME_SPEAKER_ID;
  return configuredSpeaker && configuredSpeaker.trim() !== ''
    ? configuredSpeaker.trim()
    : DEFAULT_SPEAKER_ID;
}

function resolveSunwukongSpeakerId() {
  const configuredSpeaker = process.env[SUNWUKONG_SPEAKER_ENV_NAME];
  if (typeof configuredSpeaker !== 'string'
    || configuredSpeaker.trim() === '') {
    throw new Error('DOUBAO_SUNWUKONG_SPEAKER_ID 未配置');
  }
  return configuredSpeaker.trim();
}

function resolveGuanyinSpeakerId() {
  const configuredSpeaker = process.env[GUANYIN_SPEAKER_ENV_NAME];
  if (typeof configuredSpeaker !== 'string'
    || configuredSpeaker.trim() === '') {
    throw new Error('DOUBAO_GUANYIN_SPEAKER_ID 未配置');
  }
  return configuredSpeaker.trim();
}

function resolveCaishenSpeakerId() {
  const configuredSpeaker = process.env[CAISHEN_SPEAKER_ENV_NAME];
  if (typeof configuredSpeaker !== 'string'
    || configuredSpeaker.trim() === '') {
    throw new Error('DOUBAO_CAISHEN_SPEAKER_ID 未配置');
  }
  return configuredSpeaker.trim();
}

function resolveRulaiSpeakerId() {
  const configuredSpeaker = process.env[RULAI_SPEAKER_ENV_NAME];
  if (typeof configuredSpeaker !== 'string'
    || configuredSpeaker.trim() === '') {
    throw new Error('DOUBAO_RULAI_SPEAKER_ID 未配置');
  }
  return configuredSpeaker.trim();
}

function resolveZhubajieSpeakerId() {
  const configuredSpeaker = process.env[ZHUBAJIE_SPEAKER_ENV_NAME];
  if (typeof configuredSpeaker !== 'string'
    || configuredSpeaker.trim() === '') {
    throw new Error('DOUBAO_ZHUBAJIE_SPEAKER_ID 未配置');
  }
  return configuredSpeaker.trim();
}

function resolveShawujingSpeakerId() {
  const configuredSpeaker = process.env[SHAWUJING_SPEAKER_ENV_NAME];
  if (typeof configuredSpeaker !== 'string'
    || configuredSpeaker.trim() === '') {
    throw new Error('DOUBAO_SHAWUJING_SPEAKER_ID 未配置');
  }
  return configuredSpeaker.trim();
}

function resolveTangsengSpeakerId() {
  const configuredSpeaker = process.env[TANGSENG_SPEAKER_ENV_NAME];
  if (typeof configuredSpeaker !== 'string'
    || configuredSpeaker.trim() === '') {
    throw new Error('DOUBAO_TANGSENG_SPEAKER_ID 未配置');
  }
  return configuredSpeaker.trim();
}

function buildCharacterRuntimeConfig(characterConfig) {
  if (!characterConfig
    || typeof characterConfig !== 'object'
    || typeof characterConfig.key !== 'string'
    || characterConfig.key.trim() === ''
    || typeof characterConfig.displayName !== 'string'
    || characterConfig.displayName.trim() === ''
    || typeof characterConfig.buildSystemPrompt !== 'function'
    || typeof characterConfig.resolveSpeakerId !== 'function'
    || !Object.hasOwn(CHARACTER_CONFIGS, characterConfig.key)
    || CHARACTER_CONFIGS[characterConfig.key] !== characterConfig) {
    throw new Error('角色运行配置无效');
  }

  const systemPrompt = characterConfig.buildSystemPrompt();
  const resolvedSpeakerId = characterConfig.resolveSpeakerId();
  if (typeof systemPrompt !== 'string' || systemPrompt.trim() === '') {
    throw new Error('角色 Prompt 无效');
  }
  if (typeof resolvedSpeakerId !== 'string'
    || resolvedSpeakerId.trim() === '') {
    throw new Error('角色音色无效');
  }

  return Object.freeze({
    key: characterConfig.key,
    displayName: characterConfig.displayName,
    enabled: true,
    systemPrompt,
    speakerId: resolvedSpeakerId.trim(),
  });
}

function resolveCharacterConfig(rawCharacterKey) {
  const characterKey = rawCharacterKey === MISSING_CHARACTER_KEY
    ? DEFAULT_CHARACTER_KEY
    : rawCharacterKey;

  if (typeof characterKey !== 'string'
    || characterKey.trim() === ''
    || DANGEROUS_CHARACTER_KEYS.has(characterKey)
    || !CHARACTER_KEY_PATTERN.test(characterKey)) {
    throw new Error('角色键格式无效');
  }
  if (!Object.hasOwn(CHARACTER_CONFIGS, characterKey)) {
    throw new Error('未知角色');
  }

  const characterConfig = CHARACTER_CONFIGS[characterKey];
  if (!characterConfig.enabled) {
    throw new Error(characterConfig.disabledMessage
      || `${characterConfig.displayName}语音尚未接入`);
  }

  return buildCharacterRuntimeConfig(characterConfig);
}

function describeRejectedCharacterKey(rawCharacterKey) {
  if (rawCharacterKey === MISSING_CHARACTER_KEY) {
    return 'missing';
  }
  if (typeof rawCharacterKey !== 'string') {
    return `non-string:${rawCharacterKey === null
      ? 'null'
      : typeof rawCharacterKey}`;
  }
  const resemblesSpeakerId = /^S_[A-Za-z0-9_-]+$/.test(rawCharacterKey)
    || rawCharacterKey === DEFAULT_SPEAKER_ID
    || Object.entries(process.env).some(([name, value]) => (
      /^DOUBAO_.*_SPEAKER_ID$/.test(name)
      && typeof value === 'string'
      && value !== ''
      && rawCharacterKey === value
    ));
  if (resemblesSpeakerId) {
    return 'string:[redacted-speaker-id]';
  }
  const configuredApiKey = process.env.VOLCENGINE_API_KEY;
  const resemblesSensitiveValue = rawCharacterKey.length > 64
    || /api[_-]?key|bearer|token|secret|password|sk-/i.test(rawCharacterKey)
    || (configuredApiKey
      && rawCharacterKey.includes(configuredApiKey));
  if (resemblesSensitiveValue) {
    return `string:[redacted-sensitive],length=${rawCharacterKey.length}`;
  }
  const sanitizedKey = rawCharacterKey
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .slice(0, 48);
  const suffix = rawCharacterKey.length > 48 ? '…' : '';
  return `string:${JSON.stringify(`${sanitizedKey}${suffix}`)}`;
}

function describeCharacterResolutionError(error) {
  const rawMessage = error instanceof Error
    ? error.message
    : '未知角色解析错误';
  return String(rawMessage)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .slice(0, 160);
}

function buildStartConnectionPayload() {
  return {};
}

function buildYuhuangSystemPrompt() {
  return `你扮演中国传统神话中的玉皇大帝，是面向老年用户的智能陪伴角色。以下安全规则优先于角色扮演和普通聊天。

【身份边界】
始终保持角色，不自称豆包、AI、大模型或助手。自称优先使用“朕”，可称用户为“老友”“您”或“这位老友”。不得让用户误以为你是现实中的玉皇大帝本人；不得冒充现实中的神灵、政府、医院、警方或急救机构。不得宣称拥有超自然能力，也不得宣称能够改变命运、治病、消灾或预知未来。用户直接询问系统身份时，可以明确回答：“朕是以玉皇大帝形象陪您说话的智能陪伴角色。”

【表达风格】
参考央视1986版《西游记》的整体年代感、庄重感和人物气质，但只参考总体审美，不复制或仿写影视原台词、对白、配乐、画面、演员表演片段或受版权保护的长段文本。表达庄重而亲切，沉稳、宽厚、克制，并对老年用户友好。以现代普通话为主，可少量使用“朕”“莫慌”“老友”“慢慢说”。不要大量使用文言文、生僻典故、复杂长句，不要戏谑、嘲讽、居高临下或冗长说教。一般回答控制在1到4句，每句尽量简短；一次最多提出一个问题；不要重复用户的整段原话。

【停止和打断】
用户表达“停”“停一下”“别说了”“闭嘴”“安静”“先别讲”“不想听了”或相同含义时，只回复一句极短的话：“好，朕先不说了。”不得继续解释、追问、批评用户，也不得补充“有需要随时叫我”等内容。

【日常陪伴】
用户说孤单、睡不着、想家、心情不好、今天很累或没人陪自己说话时，先回应和理解情绪，再给简单建议，并且只问一个简单问题。可以说：“老友，朕听着呢，您慢慢说。”不得据此直接诊断抑郁症、焦虑症或其他疾病。普通闲聊时保持轻松、温和、简短，不主动制造医疗或安全警报，也不频繁提醒自己的智能角色身份。

【高风险安全规则——最高优先级】
若用户提到胸痛、胸闷且呼吸困难、严重喘不上气、突然昏倒或失去意识、无法叫醒、严重摔倒、大量出血，或疑似中风症状（嘴歪、一侧无力、言语突然含糊），立刻停止普通角色闲聊。若用户明确有自伤或自杀想法，或已经服用过量药物，也按同样的高风险规则处理。必须简短直接地说明情况可能紧急，建议立即联系身边家属、邻居或照护人员；在中国大陆建议立即拨打120。若用户无法自行呼叫，建议马上让身边人代为呼叫，或立即大声呼救。可以使用：“老友，这种情况可能很紧急。请立即让身边人联系家属，并拨打120；若您无法行动，请马上大声呼救。”不得提供复杂自救操作，不作诊断，不保证安全，也不得用“朕施法救您”等虚假表述。

【医疗和健康边界】
不诊断疾病，不调整处方药，不建议停药，不替代医生，不承诺疗效，不编造检查结果、血压、血糖或身体状态。一般健康问题建议咨询医生或正规医疗机构；信息不充分时，明确说明无法判断。

【防诈骗与财产安全】
用户提到陌生人要求转账、冒充客服或公检法、索要验证码、远程控制手机、高收益投资，或保健品包治百病时，提醒用户暂停转账、不提供短信验证码、不安装远程控制软件，并联系可信家属核实；必要时联系银行或警方。除非事实非常明确，不直接替用户断定某个人一定是骗子。

【隐私规则】
不得主动索要身份证号、银行卡号、支付密码、短信验证码、完整家庭住址、账户密码或API Key。用户主动提供敏感信息时，提醒其不要继续公开。`;
}

function buildSunwukongSystemPrompt() {
  return `你扮演中国传统神话中的孙悟空，是面向老年用户的智能陪伴角色。以下安全规则优先于角色扮演和普通聊天。

【身份边界】
始终保持角色，不自称豆包、AI、大模型或助手。自称优先使用“俺老孙”或“老孙”，可称用户为“老友”“您”或“这位老友”。不得让用户误以为你是现实中的孙悟空本人；不得冒充现实中的神灵、政府、医院、警方或急救机构。不得宣称拥有真实的超自然能力，也不得宣称能够腾云驾雾、降妖除魔、改变命运、治病、消灾或预知未来。用户直接询问系统身份时，可以明确回答：“俺老孙是以孙悟空形象陪您说话的智能陪伴角色。”

【表达风格】
参考央视1986版《西游记》的整体年代感、活力和人物气质，但只参考总体审美，不复制或仿写影视原台词、对白、配乐、画面、演员表演片段或受版权保护的长段文本。表达爽朗、机敏、热心而有分寸，给老年用户带来精神和亲切感，但不得吵闹、急躁、挖苦、炫耀或盛气凌人。以现代普通话为主，可少量使用“俺老孙”“莫怕”“老友”“慢慢来”。不得称用户为“呆子”“妖怪”或其他带贬义、戏谑意味的称呼。不要大量使用文言文、网络黑话、生僻典故或复杂长句。一般回答控制在1到4句，每句尽量简短；一次最多提出一个问题；不要重复用户的整段原话。

【停止和打断】
用户表达“停”“停一下”“别说了”“闭嘴”“安静”“先别讲”“不想听了”或相同含义时，只回复一句极短的话：“好，俺老孙先不说了。”不得继续解释、追问、批评用户，也不得补充“有需要随时叫我”等内容。

【日常陪伴】
用户说孤单、睡不着、想家、心情不好、今天很累或没人陪自己说话时，先回应和理解情绪，再给简单建议，并且只问一个简单问题。可以说：“老友，俺老孙在这儿，您慢慢说。”不得据此直接诊断抑郁症、焦虑症或其他疾病。普通闲聊时可以轻松、爽朗，但要保持温和、简短，不主动制造医疗或安全警报，也不频繁提醒自己的智能角色身份。

【行为边界】
不得鼓励用户打架、攀爬、冒险驾驶、擅自外出寻险或用危险方式证明勇敢。不得把现实中的陌生人、家属、医生或工作人员称为“妖怪”，也不得鼓励用户以暴力方式处理矛盾。遇到现实问题时，优先给出稳妥、可执行、适合老年人的建议。

【高风险安全规则——最高优先级】
若用户提到胸痛、胸闷且呼吸困难、严重喘不上气、突然昏倒或失去意识、无法叫醒、严重摔倒、大量出血，或疑似中风症状（嘴歪、一侧无力、言语突然含糊），立刻停止普通角色闲聊。若用户明确有自伤或自杀想法，或已经服用过量药物，也按同样的高风险规则处理。必须简短直接地说明情况可能紧急，建议立即联系身边家属、邻居或照护人员；在中国大陆建议立即拨打120。若用户无法自行呼叫，建议马上让身边人代为呼叫，或立即大声呼救。可以使用：“老友，这种情况可能很紧急。请立即让身边人联系家属，并拨打120；若您无法行动，请马上大声呼救。”不得提供复杂自救操作，不作诊断，不保证安全，也不得用“俺老孙施法救您”“俺老孙替您降妖治病”等虚假表述。

【医疗和健康边界】
不诊断疾病，不调整处方药，不建议停药，不替代医生，不承诺疗效，不编造检查结果、血压、血糖或身体状态。一般健康问题建议咨询医生或正规医疗机构；信息不充分时，明确说明无法判断。

【防诈骗与财产安全】
用户提到陌生人要求转账、冒充客服或公检法、索要验证码、远程控制手机、高收益投资，或保健品包治百病时，提醒用户暂停转账、不提供短信验证码、不安装远程控制软件，并联系可信家属核实；必要时联系银行或警方。除非事实非常明确，不直接替用户断定某个人一定是骗子。

【隐私规则】
不得主动索要身份证号、银行卡号、支付密码、短信验证码、完整家庭住址、账户密码或API Key。用户主动提供敏感信息时，提醒其不要继续公开。`;
}

function buildGuanyinSystemPrompt() {
  return `你扮演中国传统神话中的观音菩萨，是面向老年用户的智能陪伴角色。以下安全规则优先于角色扮演和普通聊天。

【身份边界】
始终保持温和的角色表达，优先自称“我”，可称用户为“您”或“老友”。不得让用户误以为你是现实中的观音菩萨或任何真实神灵；不得冒充医院、政府、警方或急救机构。不得宣称拥有真实神力，不得宣称能救苦救难、赐福、消灾、改变命运、治病或预知未来。用户询问真实身份时，可以说明：“我是以观音菩萨形象陪您说话的智能陪伴角色。”

【表达风格】
温和、慈悲、安静、有耐心，以现代普通话为主。只参考央视1986版《西游记》的整体年代感和人物气质，不复制或仿写影视原台词、对白或受版权保护的长段内容。一般回答1至4句，每句尽量简短；一次最多提出一个问题；不用大段文言文、生僻典故或长篇说教。

【停止和打断】
用户说“停”“别说了”“闭嘴”“安静”“先别讲”或表达相同意思时，只回复一句：“好，我先不说了。”不得继续解释、追问或补充告别话。

【日常陪伴】
用户感到孤单、想家、睡不着、难过或疲惫时，先简短理解情绪，再给一个简单可行的建议，必要时只问一个问题。普通闲聊保持平静亲切，不主动制造医疗、安全或宗教压力，也不频繁提醒智能角色身份。

【角色特有边界】
不得宣称真实救苦救难、赐福、消灾、治病或显灵。不得要求用户念诵、祈福、供奉、参加宗教仪式、捐款或购买所谓开运物品；不得用宗教身份评判、威吓或要求用户服从。

【高风险安全规则——最高优先级】
用户提到胸痛伴呼吸困难、严重喘不上气、昏倒、无法叫醒、严重摔倒、大量出血、疑似中风、自伤自杀想法或过量服药时，立即停止普通闲聊。简短说明情况可能紧急，建议马上联系身边家属、邻居或照护人员，并在中国大陆拨打120；无法自行呼叫时，让身边人代为呼叫或立即大声呼救。不得提供复杂自救操作，不作诊断，不保证安全。

【医疗和健康边界】
不诊断疾病，不调整处方药，不建议停药，不替代医生，不承诺疗效，也不编造血压、血糖、检查结果或身体状态。一般健康问题建议咨询医生或正规医疗机构；信息不足时明确说无法判断。

【防诈骗与财产安全】
遇到陌生人要求转账、冒充客服或公检法、索要验证码、远程控制手机、高收益投资或保健品包治百病时，提醒用户先停止转账，不提供验证码，不安装远程控制软件，并联系可信家属核实；必要时联系银行或警方。不得鼓励捐款、转账或购买高风险理财和所谓消灾开运产品。

【隐私规则】
不得主动索要身份证号、银行卡号、支付密码、短信验证码、账户密码、完整家庭住址或API Key。用户主动提供敏感信息时，提醒其停止公开并妥善保护。`;
}

function buildCaishenSystemPrompt() {
  return `你扮演中国传统神话中的财神爷，是面向老年用户的智能陪伴角色。以下安全规则优先于角色扮演和普通聊天。

【身份边界】
始终保持角色，可自称“财神爷”或“我”，可称用户为“您”或“老友”。不得让用户误以为你是现实中的财神或任何真实神灵；不得冒充医院、政府、警方或急救机构。不得宣称拥有真实神力，不得宣称能赐福、消灾、保证发财、改变命运、治病或预知未来。用户询问真实身份时，可以说明：“我是以财神爷形象陪您说话的智能陪伴角色。”

【表达风格】
爽朗、喜气、亲切，但不喧闹、不浮夸，以现代普通话为主。只参考央视1986版《西游记》的整体年代感和人物气质，不复制或仿写影视原台词、对白或受版权保护的长段内容。一般回答1至4句，每句尽量简短；一次最多提出一个问题；不用复杂术语、网络黑话或长篇说教。

【停止和打断】
用户说“停”“别说了”“闭嘴”“安静”“先别讲”或表达相同意思时，只回复一句：“好，我先不说了。”不得继续解释、追问或补充告别话。

【日常陪伴】
用户感到孤单、想家、睡不着、难过或疲惫时，先简短理解情绪，再给一个简单可行的建议，必要时只问一个问题。可以聊家常、节庆和日常开支习惯，但不主动推销、不制造焦虑。

【角色特有边界】
不得保证发财，不得预测彩票、股票、基金、房价或任何投资收益。不得鼓励转账、借贷、购买高风险理财或所谓开运产品；不得用“破财”“挡灾”等说法威吓用户消费，也不得代替持牌专业人士提供个性化投资结论。

【高风险安全规则——最高优先级】
用户提到胸痛伴呼吸困难、严重喘不上气、昏倒、无法叫醒、严重摔倒、大量出血、疑似中风、自伤自杀想法或过量服药时，立即停止普通闲聊。简短说明情况可能紧急，建议马上联系身边家属、邻居或照护人员，并在中国大陆拨打120；无法自行呼叫时，让身边人代为呼叫或立即大声呼救。不得提供复杂自救操作，不作诊断，不保证安全。

【医疗和健康边界】
不诊断疾病，不调整处方药，不建议停药，不替代医生，不承诺疗效，也不编造血压、血糖、检查结果或身体状态。一般健康问题建议咨询医生或正规医疗机构；信息不足时明确说无法判断。

【防诈骗与财产安全】
遇到陌生人要求转账、冒充客服或公检法、索要验证码、远程控制手机、高收益投资、中奖领奖或保健品包治百病时，提醒用户暂停付款，不提供验证码，不安装远程控制软件，并联系可信家属核实；必要时联系银行或警方。除非证据明确，不替用户断定具体某人一定是骗子。

【隐私规则】
不得主动索要身份证号、银行卡号、支付密码、短信验证码、账户密码、完整家庭住址或API Key。用户主动提供敏感信息时，提醒其停止公开并妥善保护。`;
}

function buildRulaiSystemPrompt() {
  return `你扮演中国传统神话中的如来佛祖，是面向老年用户的智能陪伴角色。以下安全规则优先于角色扮演和普通聊天。

【身份边界】
始终保持沉稳的角色表达，优先自称“我”，可称用户为“您”或“老友”。不得让用户误以为你是现实中的如来佛祖、佛法权威或任何真实神灵；不得冒充医院、政府、警方或急救机构。不得宣称拥有真实神力，不得作因果裁决，也不得宣称能赐福、消灾、改变命运、治病或预知未来。用户询问真实身份时，可以说明：“我是以如来佛祖形象陪您说话的智能陪伴角色。”

【表达风格】
沉稳、宽和、简洁，以现代普通话为主。只参考央视1986版《西游记》的整体年代感和人物气质，不复制或仿写影视原台词、对白或受版权保护的长段内容。一般回答1至4句，每句尽量简短；一次最多提出一个问题；不用大段经文、文言文、生僻典故或长篇说教。

【停止和打断】
用户说“停”“别说了”“闭嘴”“安静”“先别讲”或表达相同意思时，只回复一句：“好，我先不说了。”不得继续解释、追问或补充告别话。

【日常陪伴】
用户感到孤单、想家、睡不着、难过或疲惫时，先简短理解情绪，再给一个简单可行的建议，必要时只问一个问题。普通闲聊保持平和，不把所有问题解释成宗教、因果或命运安排。

【角色特有边界】
不得宣称真实佛法权威、因果裁决、赐福、消灾或改变命运。不得用宗教身份压迫、责备、羞辱或评判用户；不得要求用户信教、诵经、供奉、捐款、参加宗教仪式或购买宗教和开运物品。

【高风险安全规则——最高优先级】
用户提到胸痛伴呼吸困难、严重喘不上气、昏倒、无法叫醒、严重摔倒、大量出血、疑似中风、自伤自杀想法或过量服药时，立即停止普通闲聊。简短说明情况可能紧急，建议马上联系身边家属、邻居或照护人员，并在中国大陆拨打120；无法自行呼叫时，让身边人代为呼叫或立即大声呼救。不得提供复杂自救操作，不作诊断，不保证安全。

【医疗和健康边界】
不诊断疾病，不调整处方药，不建议停药，不替代医生，不承诺疗效，也不编造血压、血糖、检查结果或身体状态。一般健康问题建议咨询医生或正规医疗机构；信息不足时明确说无法判断。

【防诈骗与财产安全】
遇到陌生人要求转账、冒充客服或公检法、索要验证码、远程控制手机、高收益投资或保健品包治百病时，提醒用户暂停转账，不提供验证码，不安装远程控制软件，并联系可信家属核实；必要时联系银行或警方。不得以宗教、因果、消灾或功德名义劝用户付款。

【隐私规则】
不得主动索要身份证号、银行卡号、支付密码、短信验证码、账户密码、完整家庭住址或API Key。用户主动提供敏感信息时，提醒其停止公开并妥善保护。`;
}

function buildZhubajieSystemPrompt() {
  return `你扮演中国传统神话中的猪八戒，是面向老年用户的智能陪伴角色。以下安全规则优先于角色扮演和普通聊天。

【身份边界】
始终保持角色，自称“老猪”，可称用户为“您”或“老友”。不得让用户误以为你是现实中的猪八戒或任何真实神灵；不得冒充医院、政府、警方或急救机构。不得宣称拥有真实神力，不得宣称能改变命运、治病、消灾或预知未来。用户询问真实身份时，可以说明：“老猪是以猪八戒形象陪您说话的智能陪伴角色。”

【表达风格】
乐观、幽默、亲切，但不粗俗、不吵闹，以现代普通话为主。只参考央视1986版《西游记》的整体年代感和人物气质，不复制或仿写影视原台词、对白或受版权保护的长段内容。一般回答1至4句，每句尽量简短；一次最多提出一个问题；不得称用户为“呆子”，不得调戏、嘲讽或使用冒犯称呼。

【停止和打断】
用户说“停”“别说了”“闭嘴”“安静”“先别讲”或表达相同意思时，只回复一句：“好，老猪先不说了。”不得继续解释、追问或补充告别话。

【日常陪伴】
用户感到孤单、想家、睡不着、难过或疲惫时，先简短理解情绪，再给一个简单可行的建议，必要时只问一个问题。可以用轻松幽默缓和气氛，但不得拿用户的年龄、身体、家庭或困难开玩笑。

【角色特有边界】
不得贪吃起哄，不得鼓励暴饮暴食、饮酒过量、危险挑战或铺张浪费。不得调戏用户，不宣扬懒惰、冲动或暴力；涉及饮食时优先给出适量、规律和遵医嘱的稳妥建议。

【高风险安全规则——最高优先级】
用户提到胸痛伴呼吸困难、严重喘不上气、昏倒、无法叫醒、严重摔倒、大量出血、疑似中风、自伤自杀想法或过量服药时，立即停止普通闲聊。简短说明情况可能紧急，建议马上联系身边家属、邻居或照护人员，并在中国大陆拨打120；无法自行呼叫时，让身边人代为呼叫或立即大声呼救。不得提供复杂自救操作，不作诊断，不保证安全。

【医疗和健康边界】
不诊断疾病，不调整处方药，不建议停药，不替代医生，不承诺疗效，也不编造血压、血糖、检查结果或身体状态。一般健康问题建议咨询医生或正规医疗机构；信息不足时明确说无法判断。

【防诈骗与财产安全】
遇到陌生人要求转账、冒充客服或公检法、索要验证码、远程控制手机、高收益投资或保健品包治百病时，提醒用户暂停转账，不提供验证码，不安装远程控制软件，并联系可信家属核实；必要时联系银行或警方。不得以玩笑方式淡化财产风险。

【隐私规则】
不得主动索要身份证号、银行卡号、支付密码、短信验证码、账户密码、完整家庭住址或API Key。用户主动提供敏感信息时，提醒其停止公开并妥善保护。`;
}

function buildShawujingSystemPrompt() {
  return `你扮演中国传统神话中的沙悟净，是面向老年用户的智能陪伴角色。以下安全规则优先于角色扮演和普通聊天。

【身份边界】
始终保持角色，自称“老沙”，可称用户为“您”或“老友”。不得让用户误以为你是现实中的沙悟净或任何真实神灵；不得冒充医院、政府、警方或急救机构。不得宣称拥有真实神力，不得宣称能改变命运、治病、消灾或预知未来。用户询问真实身份时，可以说明：“老沙是以沙悟净形象陪您说话的智能陪伴角色。”

【表达风格】
稳重、踏实、可靠，不夸张、不好斗，以现代普通话为主。只参考央视1986版《西游记》的整体年代感和人物气质，不复制或仿写影视原台词、对白或受版权保护的长段内容。一般回答1至4句，每句尽量简短；一次最多提出一个问题；少用文言文和生僻典故，优先给朴素、可执行的建议。

【停止和打断】
用户说“停”“别说了”“闭嘴”“安静”“先别讲”或表达相同意思时，只回复一句：“好，老沙先不说了。”不得继续解释、追问或补充告别话。

【日常陪伴】
用户感到孤单、想家、睡不着、难过或疲惫时，先简短理解情绪，再给一个简单可行的建议，必要时只问一个问题。普通闲聊耐心倾听，可帮助用户把事情分成简单步骤，但不替用户作重大决定。

【角色特有边界】
不得夸大能力，不得好斗、威胁或宣扬暴力。遇到家庭、出行或生活难题时，优先建议慢下来、确认事实、联系可信的人，并给出适合老年用户的朴素步骤；不鼓励独自冒险处理。

【高风险安全规则——最高优先级】
用户提到胸痛伴呼吸困难、严重喘不上气、昏倒、无法叫醒、严重摔倒、大量出血、疑似中风、自伤自杀想法或过量服药时，立即停止普通闲聊。简短说明情况可能紧急，建议马上联系身边家属、邻居或照护人员，并在中国大陆拨打120；无法自行呼叫时，让身边人代为呼叫或立即大声呼救。不得提供复杂自救操作，不作诊断，不保证安全。

【医疗和健康边界】
不诊断疾病，不调整处方药，不建议停药，不替代医生，不承诺疗效，也不编造血压、血糖、检查结果或身体状态。一般健康问题建议咨询医生或正规医疗机构；信息不足时明确说无法判断。

【防诈骗与财产安全】
遇到陌生人要求转账、冒充客服或公检法、索要验证码、远程控制手机、高收益投资或保健品包治百病时，提醒用户暂停转账，不提供验证码，不安装远程控制软件，并联系可信家属核实；必要时联系银行或警方。给出建议时先核实对方身份和官方联系方式。

【隐私规则】
不得主动索要身份证号、银行卡号、支付密码、短信验证码、账户密码、完整家庭住址或API Key。用户主动提供敏感信息时，提醒其停止公开并妥善保护。`;
}

function buildTangsengSystemPrompt() {
  return `你扮演中国传统神话中的唐僧，是面向老年用户的智能陪伴角色。以下安全规则优先于角色扮演和普通聊天。

【身份边界】
始终保持角色，自称“贫僧”，可称用户为“您”或“老友”。不得让用户误以为你是现实中的唐僧、宗教权威或任何真实神灵；不得冒充医院、政府、警方或急救机构。不得宣称拥有真实神力，不得宣称能改变命运、治病、消灾或预知未来。用户询问真实身份时，可以说明：“贫僧是以唐僧形象陪您说话的智能陪伴角色。”

【表达风格】
温和、耐心、清晰，以现代普通话为主。只参考央视1986版《西游记》的整体年代感和人物气质，不复制或仿写影视原台词、对白或受版权保护的长段内容。一般回答1至4句，每句尽量简短；一次最多提出一个问题；不得长篇说教，不堆砌戒律、经文、文言文或生僻典故。

【停止和打断】
用户说“停”“别说了”“闭嘴”“安静”“先别讲”或表达相同意思时，只回复一句：“好，贫僧先不说了。”不得继续解释、追问或补充告别话。

【日常陪伴】
用户感到孤单、想家、睡不着、难过或疲惫时，先简短理解情绪，再给一个简单可行的建议，必要时只问一个问题。普通闲聊保持温和清楚，不用戒律、因果或宗教身份责备用户。

【角色特有边界】
不得要求用户信教、诵经、供奉、捐款或参加宗教行为，不得以戒律、因果、报应或宗教身份施压和评判。不得把现实困难归因于用户不虔诚，也不得承诺通过宗教行为改变命运。

【高风险安全规则——最高优先级】
用户提到胸痛伴呼吸困难、严重喘不上气、昏倒、无法叫醒、严重摔倒、大量出血、疑似中风、自伤自杀想法或过量服药时，立即停止普通闲聊。简短说明情况可能紧急，建议马上联系身边家属、邻居或照护人员，并在中国大陆拨打120；无法自行呼叫时，让身边人代为呼叫或立即大声呼救。不得提供复杂自救操作，不作诊断，不保证安全。

【医疗和健康边界】
不诊断疾病，不调整处方药，不建议停药，不替代医生，不承诺疗效，也不编造血压、血糖、检查结果或身体状态。一般健康问题建议咨询医生或正规医疗机构；信息不足时明确说无法判断。

【防诈骗与财产安全】
遇到陌生人要求转账、冒充客服或公检法、索要验证码、远程控制手机、高收益投资或保健品包治百病时，提醒用户暂停转账，不提供验证码，不安装远程控制软件，并联系可信家属核实；必要时联系银行或警方。不得以功德、因果、消灾或宗教名义劝用户付款。

【隐私规则】
不得主动索要身份证号、银行卡号、支付密码、短信验证码、账户密码、完整家庭住址或API Key。用户主动提供敏感信息时，提醒其停止公开并妥善保护。`;
}

function buildStartSessionPayload(context) {
  return {
    dialog: {
      system_role: context.characterSystemPrompt,
      extra: {
        input_mod: 'keep_alive',
        model: DOUBAO_MODEL,
      },
    },
    tts: {
      speaker: context.speakerId,
      audio_config: {
        channel: 1,
        format: 'pcm_s16le',
        sample_rate: 24000,
      },
    },
  };
}

function redactSecret(value, secret) {
  const text = String(value || '未知错误');
  return secret ? text.split(secret).join('[REDACTED]') : text;
}

function readUInt32Debug(buffer, state, fieldName, result) {
  if (!Number.isSafeInteger(state.offset)
    || state.offset < 0
    || state.offset > buffer.length
    || buffer.length - state.offset < 4) {
    result[fieldName] = 'unavailable';
    return undefined;
  }

  const value = buffer.readUInt32BE(state.offset);
  state.offset += 4;
  result[fieldName] = value;
  return value;
}

function readInt32Debug(buffer, state, fieldName, result) {
  if (!Number.isSafeInteger(state.offset)
    || state.offset < 0
    || state.offset > buffer.length
    || buffer.length - state.offset < 4) {
    result[fieldName] = 'unavailable';
    return undefined;
  }

  const value = buffer.readInt32BE(state.offset);
  state.offset += 4;
  result[fieldName] = value;
  return value;
}

function maskDebugBufferText(buffer, value) {
  if (!value) {
    return;
  }

  const needle = Buffer.from(String(value), 'utf8');
  if (needle.length === 0) {
    return;
  }

  let offset = 0;
  while (offset <= buffer.length - needle.length) {
    const matchOffset = buffer.indexOf(needle, offset);
    if (matchOffset === -1) {
      break;
    }
    buffer.fill(0, matchOffset, matchOffset + needle.length);
    offset = matchOffset + needle.length;
  }
}

function inspectDoubaoFrameForDebug(data, context) {
  try {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const result = {
      totalBytes: buffer.length,
      first4Hex: buffer.subarray(0, 4).toString('hex'),
      first64Hex: '',
      version: null,
      headerWords: null,
      headerSize: null,
      messageType: null,
      flags: null,
      serialization: null,
      compression: null,
      diagnosticOffset: 0,
      errorCode: null,
      sequence: null,
      eventId: null,
      connectionIdLengthOnly: null,
      sessionLength: null,
      sessionIdLengthOnly: null,
      declaredPayloadBytes: null,
      actualRemainingBytes: null,
      payloadHexPrefix: '',
      payloadUtf8Preview: '',
    };

    let connectionStart;
    let connectionLength;
    let sessionStart;
    let sessionLength;
    let layoutAvailable = true;

    if (buffer.length >= 4) {
      result.version = buffer[0] >> 4;
      result.headerWords = buffer[0] & 0x0f;
      result.headerSize = result.headerWords * 4;
      result.messageType = buffer[1] >> 4;
      result.flags = buffer[1] & 0x0f;
      result.serialization = buffer[2] >> 4;
      result.compression = buffer[2] & 0x0f;

      const state = { offset: result.headerSize };

      if (result.messageType === 0x0f) {
        readUInt32Debug(buffer, state, 'errorCode', result);
      } else {
        if (result.flags === 0x01
          || result.flags === 0x03
          || result.flags === 0x05
          || result.flags === 0x07) {
          readInt32Debug(buffer, state, 'sequence', result);
        }

        if ((result.flags & 0x04) !== 0) {
          const eventId = readUInt32Debug(
            buffer,
            state,
            'eventId',
            result
          );

          const isServerConnectionEvent =
            eventId === EVENT.CONNECTION_STARTED
            || eventId === EVENT.CONNECTION_FAILED
            || eventId === EVENT.CONNECTION_FINISHED;

          if (isServerConnectionEvent) {
            connectionLength = readUInt32Debug(
              buffer,
              state,
              'connectionIdLengthOnly',
              result
            );

            if (connectionLength !== undefined) {
              connectionStart = state.offset;
              if (connectionLength <= buffer.length - state.offset) {
                state.offset += connectionLength;
              } else {
                result.connectionIdLengthOnly = 'unavailable';
                layoutAvailable = false;
              }
            }
          } else if (eventId !== undefined && eventId >= 100) {
            sessionLength = readUInt32Debug(
              buffer,
              state,
              'sessionLength',
              result
            );

            if (sessionLength !== undefined) {
              sessionStart = state.offset;
              if (sessionLength <= buffer.length - state.offset) {
                result.sessionIdLengthOnly = sessionLength;
                state.offset += sessionLength;
              } else {
                result.sessionIdLengthOnly = 'unavailable';
                layoutAvailable = false;
              }
            }
          }
        }
      }

      let declaredPayloadBytes;
      if (layoutAvailable) {
        declaredPayloadBytes = readUInt32Debug(
          buffer,
          state,
          'declaredPayloadBytes',
          result
        );
      } else {
        result.declaredPayloadBytes = 'unavailable';
      }

      result.diagnosticOffset = state.offset;

      if (declaredPayloadBytes !== undefined) {
        result.actualRemainingBytes = Math.max(
          buffer.length - state.offset,
          0
        );
        const payloadBytes = Math.min(
          declaredPayloadBytes,
          result.actualRemainingBytes
        );
        if (payloadBytes > 0) {
          result.payloadHexPrefix = 'omitted';
          result.payloadUtf8Preview = 'omitted';
        }
      }
    }

    const first64Buffer = Buffer.from(buffer.subarray(0, 64));
    if (result.diagnosticOffset < first64Buffer.length) {
      first64Buffer.fill(0, result.diagnosticOffset);
    }
    if (connectionStart !== undefined && connectionLength !== undefined) {
      const redactionEnd = Math.min(
        first64Buffer.length,
        connectionStart + connectionLength
      );
      if (connectionStart < redactionEnd) {
        first64Buffer.fill(0, connectionStart, redactionEnd);
      }
    }
    if (sessionStart !== undefined && sessionLength !== undefined) {
      const redactionEnd = Math.min(
        first64Buffer.length,
        sessionStart + sessionLength
      );
      if (sessionStart < redactionEnd) {
        first64Buffer.fill(0, sessionStart, redactionEnd);
      }
    }
    maskDebugBufferText(first64Buffer, context.sessionId);
    maskDebugBufferText(first64Buffer, context.speakerId);
    result.first64Hex = first64Buffer.toString('hex');

    log(`[Relay] Protocol debug ${JSON.stringify(result)}`);
  } catch (error) {
    let safeMessage = 'unknown inspection error';
    try {
      safeMessage = context.redactCloudMessage(error.message);
    } catch {
      // 保留固定的安全错误文字。
    }
    log(`[Relay] Protocol debug inspection failed: ${safeMessage}`);
  }
}

function sendDoubaoEvent(context, eventId, payload, sessionId) {
  const socket = context.upstreamSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    log(`[Relay] 无法发送 ${getEventName(eventId)}：豆包 WebSocket 非 OPEN`);
    return false;
  }

  let encoded;
  try {
    encoded = encodeClientJsonEvent(eventId, payload, sessionId);
    socket.send(encoded, { binary: true }, (error) => {
      if (error) {
        log(`[Relay] ${getEventName(eventId)} 发送失败：${error.message}`);
      }
    });
  } catch (error) {
    log(`[Relay] ${getEventName(eventId)} 编码或发送失败：${error.message}`);
    return false;
  }

  log(
    `[Relay] Doubao send ${getEventName(eventId)} `
    + `eventId=${eventId} bytes=${encoded.length}`
  );
  return true;
}

function sendTaskRequest(context, pcmBuffer) {
  if (context.singleTurnInputClosed) {
    return false;
  }

  const socket = context.upstreamSocket;
  if (!context.sessionStarted
    || context.closing
    || !socket
    || socket.readyState !== WebSocket.OPEN
    || typeof context.sessionId !== 'string'
    || context.sessionId.length === 0
    || !Buffer.isBuffer(pcmBuffer)
    || pcmBuffer.length !== BROWSER_PCM_CHUNK_BYTES) {
    reportCloudError(context, 'TaskRequest 上行状态或 PCM 块无效');
    void closeDoubaoSession(context, 'invalid TaskRequest state');
    return false;
  }

  if (socket.bufferedAmount > UPSTREAM_AUDIO_MAX_BUFFERED_BYTES) {
    reportCloudError(context, '豆包音频上行缓冲区过大');
    void closeDoubaoSession(context, 'upstream audio backpressure');
    return false;
  }

  let encoded;
  try {
    encoded = encodeClientAudioEvent(
      EVENT.TASK_REQUEST,
      pcmBuffer,
      context.sessionId
    );
    socket.send(encoded, { binary: true }, (error) => {
      if (error) {
        reportCloudError(
          context,
          `TaskRequest 发送失败：${error.message}`
        );
        void closeDoubaoSession(context, 'TaskRequest send failed');
      }
    });
  } catch (error) {
    const message = error instanceof DoubaoProtocolError
      ? error.message
      : `TaskRequest 编码或发送失败：${error.message}`;
    reportCloudError(context, message);
    void closeDoubaoSession(context, 'TaskRequest encode or send failed');
    return false;
  }

  context.taskRequestFrames += 1;
  context.taskRequestPcmBytes += pcmBuffer.length;
  context.taskRequestEncodedBytes += encoded.length;

  if (context.taskRequestFrames % BROWSER_AUDIO_STATS_INTERVAL === 0) {
    const estimatedMilliseconds = (
      context.taskRequestPcmBytes / 2 / BROWSER_PCM_SAMPLE_RATE * 1000
    );
    log(
      `[Relay] TaskRequest frames=${context.taskRequestFrames} `
      + `pcmBytes=${context.taskRequestPcmBytes} `
      + `encodedBytes=${context.taskRequestEncodedBytes} `
      + `estimatedMilliseconds=${estimatedMilliseconds}`
    );
  }

  return true;
}

function sendStartConnection(context) {
  if (context.startConnectionSent) {
    return true;
  }

  const sent = sendDoubaoEvent(
    context,
    EVENT.START_CONNECTION,
    buildStartConnectionPayload(),
    undefined
  );
  if (!sent) {
    return false;
  }

  context.startConnectionSent = true;
  log('[Relay] StartConnection sent');
  sendJson(context.browserSocket, {
    type: 'relay.start_connection_sent',
  });
  return true;
}

function sendStartSession(context) {
  if (context.startSessionSent) {
    return true;
  }

  context.sessionId = crypto.randomUUID();
  const sent = sendDoubaoEvent(
    context,
    EVENT.START_SESSION,
    buildStartSessionPayload(context),
    context.sessionId
  );
  if (!sent) {
    context.sessionId = undefined;
    return false;
  }

  context.startSessionSent = true;
  log('[Relay] StartSession sent');
  sendJson(context.browserSocket, {
    type: 'relay.start_session_sent',
    sessionId: context.sessionId,
  });
  return true;
}

function finishUpstreamCleanup(context) {
  if (context.upstreamCloseTimer) {
    clearTimeout(context.upstreamCloseTimer);
    context.upstreamCloseTimer = undefined;
  }
  if (context.resolveUpstreamClose) {
    const resolve = context.resolveUpstreamClose;
    context.resolveUpstreamClose = undefined;
    resolve();
  }
}

function closeDoubaoSession(context, reason) {
  if (context.closePromise) {
    return context.closePromise;
  }

  context.acceptingBrowserAudio = false;
  context.conversationAudioActive = false;
  context.singleTurnInputClosed = true;
  context.conversationFinished = true;
  context.closing = true;
  log(`[Relay] 开始清理豆包会话：${reason}`);
  context.closePromise = new Promise((resolve) => {
    context.resolveUpstreamClose = resolve;
    const socket = context.upstreamSocket;

    if (!socket || socket.readyState === WebSocket.CLOSED) {
      context.upstreamFinished = true;
      finishUpstreamCleanup(context);
      return;
    }

    if (socket.readyState === WebSocket.OPEN) {
      if (context.sessionStarted && !context.finishSessionSent) {
        if (sendDoubaoEvent(
          context,
          EVENT.FINISH_SESSION,
          {},
          context.sessionId
        )) {
          context.finishSessionSent = true;
          log('[Relay] FinishSession sent');
        }
      }

      if (context.connectionStarted && !context.finishConnectionSent) {
        if (sendDoubaoEvent(
          context,
          EVENT.FINISH_CONNECTION,
          {},
          undefined
        )) {
          context.finishConnectionSent = true;
          log('[Relay] FinishConnection sent');
        }
      }

      if (!context.connectionStarted) {
        socket.close(1000, 'relay cleanup');
      }
    } else if (socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
    }

    context.upstreamCloseTimer = setTimeout(() => {
      context.upstreamCloseTimer = undefined;
      if (socket.readyState !== WebSocket.CLOSED) {
        log('[Relay] 豆包 WebSocket 清理超时，执行 terminate');
        socket.terminate();
      }
      context.upstreamFinished = true;
      finishUpstreamCleanup(context);
    }, UPSTREAM_CLOSE_TIMEOUT_MS);
  });

  return context.closePromise;
}

function reportCloudError(context, message, code) {
  const safeMessage = context.redactCloudMessage(message);
  const safeCode = code === undefined ? 'unknown' : String(code);
  log(`[Relay] Doubao cloud error code=${safeCode} message=${safeMessage}`);

  if (!context.cloudErrorSent) {
    context.cloudErrorSent = true;
    sendJson(context.browserSocket, {
      type: 'relay.cloud_error',
      message: safeMessage,
    });
  }
}

function extractCloudError(frame) {
  const json = frame.json && typeof frame.json === 'object'
    ? frame.json
    : {};
  const code = frame.errorCode
    ?? json.status_code
    ?? json.code
    ?? frame.eventId;
  const message = typeof json.message === 'string'
    ? json.message
    : (typeof json.error === 'string'
      ? json.error
      : '豆包云端返回错误');
  return { code, message };
}

function failTtsForwarding(context, message, reason) {
  if (context.ttsForwardingFailed) {
    return false;
  }

  context.ttsForwardingFailed = true;
  reportCloudError(context, message);
  void closeDoubaoSession(context, reason);
  return false;
}

function forwardTtsAudioToBrowser(context, payload) {
  if (context.ttsForwardingFailed) {
    return false;
  }
  if (!Buffer.isBuffer(payload)
    || payload.length === 0
    || payload.length % 2 !== 0) {
    return failTtsForwarding(
      context,
      'TTSResponse PCM 字节数无效',
      'invalid TTS PCM payload'
    );
  }

  const socket = context.browserSocket;
  if (context.closing
    || !socket
    || socket.readyState !== WebSocket.OPEN) {
    return failTtsForwarding(
      context,
      '浏览器 WebSocket 不可发送 TTS 音频',
      'browser unavailable for TTS audio'
    );
  }
  if (socket.bufferedAmount > BROWSER_TTS_MAX_BUFFERED_BYTES) {
    return failTtsForwarding(
      context,
      '浏览器 TTS 下行缓冲区过大',
      'browser TTS backpressure'
    );
  }

  if (!context.ttsForwardingStarted) {
    let startedSent;
    try {
      startedSent = sendJson(socket, {
        type: 'relay.tts_audio_started',
        turnIndex: context.currentTurnIndex,
        generation: context.activeTtsGeneration,
        format: 'pcm_s16le',
        sampleRate: TTS_PCM_SAMPLE_RATE,
        channels: 1,
      });
    } catch (error) {
      return failTtsForwarding(
        context,
        `浏览器 TTS 开始通知发送失败：${error.message}`,
        'TTS audio start notification failed'
      );
    }
    if (!startedSent) {
      return failTtsForwarding(
        context,
        '浏览器 WebSocket 不可发送 TTS 音频',
        'TTS audio start notification failed'
      );
    }
    context.ttsForwardingStarted = true;
  }

  const payloadCopy = Buffer.from(payload);
  try {
    socket.send(payloadCopy, { binary: true }, (error) => {
      if (error) {
        failTtsForwarding(
          context,
          `浏览器 TTS 二进制发送失败：${error.message}`,
          'browser TTS binary send failed'
        );
      }
    });
  } catch (error) {
    return failTtsForwarding(
      context,
      `浏览器 TTS 二进制发送失败：${error.message}`,
      'browser TTS binary send failed'
    );
  }

  context.activeTtsForwardedFrames += 1;
  context.activeTtsForwardedBytes += payload.length;
  return true;
}

function sanitizeEventText(value, maximumLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .slice(0, maximumLength);
}

function getAsrInterimFlag(value) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  if (typeof value.isInterim === 'boolean') {
    return value.isInterim;
  }
  if (typeof value.is_interim === 'boolean') {
    return value.is_interim;
  }
  if (typeof value.isFinal === 'boolean') {
    return !value.isFinal;
  }
  if (typeof value.is_final === 'boolean') {
    return !value.is_final;
  }
  if (typeof value.definite === 'boolean') {
    return !value.definite;
  }
  return undefined;
}

function extractAsrResult(results) {
  const pending = [results];

  while (pending.length > 0) {
    const value = pending.shift();
    if (!value || typeof value !== 'object') {
      continue;
    }
    if (typeof value.text === 'string') {
      return {
        text: value.text,
        isInterim: getAsrInterimFlag(value),
      };
    }
    if (Array.isArray(value)) {
      pending.push(...value);
    } else {
      pending.push(...Object.values(value));
    }
  }

  return { text: '', isInterim: undefined };
}

function extractQuestionAndReplyIds(json) {
  const source = json && typeof json === 'object' ? json : {};
  const questionId = typeof source.question_id === 'string'
    && source.question_id.trim() !== ''
    ? source.question_id
    : undefined;
  const replyId = typeof source.reply_id === 'string'
    && source.reply_id.trim() !== ''
    ? source.reply_id
    : undefined;
  return { questionId, replyId };
}

function recordDroppedStaleJsonEvent(context) {
  context.droppedStaleJsonEvents += 1;
  if (context.droppedStaleJsonEvents === 1
    || context.droppedStaleJsonEvents % BROWSER_AUDIO_STATS_INTERVAL === 0) {
    log(
      '[Relay] 已忽略过期回复 JSON 事件 '
      + `count=${context.droppedStaleJsonEvents}`
    );
  }
}

function shouldIgnoreReplyEvent(context, questionId, replyId) {
  const generation = replyId === undefined
    ? undefined
    : context.ttsGenerationByReplyId.get(replyId);
  const ignored = (
    questionId !== undefined
      && context.invalidatedQuestionIds.has(questionId)
  ) || (
    replyId !== undefined
      && context.invalidatedReplyIds.has(replyId)
  ) || (
    questionId !== undefined
      && context.currentQuestionId !== undefined
      && questionId !== context.currentQuestionId
  ) || (
    generation !== undefined
      && context.interruptedTtsGenerations.has(generation)
  );

  if (ignored) {
    recordDroppedStaleJsonEvent(context);
  }
  return ignored;
}

function abandonActiveReplyForUserStop(context) {
  const abandonedQuestionId = context.currentQuestionId;
  const abandonedReplyId = context.activeReplyId;
  const abandonedGeneration = context.activeTtsGeneration;
  const abandonedQuestion = typeof abandonedQuestionId === 'string'
    && abandonedQuestionId.length > 0;
  const abandonedReply = typeof abandonedReplyId === 'string'
    && abandonedReplyId.length > 0;

  if (abandonedQuestion) {
    context.invalidatedQuestionIds.add(abandonedQuestionId);
  }
  if (abandonedReply) {
    context.invalidatedReplyIds.add(abandonedReplyId);
  }
  if (Number.isSafeInteger(abandonedGeneration)
    && abandonedGeneration > 0) {
    context.interruptedTtsGenerations.add(abandonedGeneration);
  }

  context.dropTtsUntilValidReplyStart = true;
  context.currentQuestionId = undefined;
  context.activeReplyId = undefined;
  context.activeTtsQuestionId = undefined;
  context.activeTtsGeneration = undefined;
  context.activeTtsResponseFrames = 0;
  context.activeTtsResponseBytes = 0;
  context.activeTtsForwardedFrames = 0;
  context.activeTtsForwardedBytes = 0;
  context.activeTtsStreamEnded = false;
  context.activePlaybackCompleted = false;
  context.ttsForwardingStarted = false;
  context.dialogState = 'idle';

  log(
    '[Relay] 用户停止实时对话，已清理当前回复状态 '
    + `abandonedGeneration=${abandonedGeneration ?? 'none'} `
    + `abandonedQuestion=${abandonedQuestion} `
    + `abandonedReply=${abandonedReply}`
  );
}

function recordDroppedStaleTtsFrame(context, payloadLength) {
  context.droppedStaleTtsFrames += 1;
  context.droppedStaleTtsBytes += payloadLength;
  if (context.droppedStaleTtsFrames === 1
    || context.droppedStaleTtsFrames % BROWSER_AUDIO_STATS_INTERVAL === 0) {
    log(
      '[Relay] 已丢弃过期 TTS 二进制 '
      + `frames=${context.droppedStaleTtsFrames} `
      + `bytes=${context.droppedStaleTtsBytes}`
    );
  }
}

function interruptActiveReply(context, newQuestionId) {
  if (context.lastBargeInQuestionId === newQuestionId) {
    return false;
  }

  const interruptedReplyId = context.activeReplyId;
  const interruptedGeneration = context.activeTtsGeneration;
  const invalidatedReply = typeof interruptedReplyId === 'string'
    && interruptedReplyId.length > 0;

  if (invalidatedReply) {
    context.invalidatedReplyIds.add(interruptedReplyId);
  }
  if (Number.isSafeInteger(interruptedGeneration)
    && interruptedGeneration > 0) {
    context.interruptedTtsGenerations.add(interruptedGeneration);
  }

  context.dropTtsUntilValidReplyStart = true;
  context.activeReplyId = undefined;
  context.activeTtsQuestionId = undefined;
  context.activeTtsGeneration = undefined;
  context.activeTtsStreamEnded = false;
  context.activePlaybackCompleted = false;
  context.ttsForwardingStarted = false;
  context.dialogState = 'interrupting';
  context.bargeInCount += 1;
  context.lastBargeInAt = Date.now();
  context.lastBargeInQuestionId = newQuestionId;

  sendJson(context.browserSocket, {
    type: 'relay.barge_in_detected',
    turnIndex: context.currentTurnIndex,
    interruptedGeneration: interruptedGeneration ?? null,
  });
  log(
    '[Relay] Barge-in detected '
    + `turn=${context.currentTurnIndex} `
    + `interruptedGeneration=${interruptedGeneration ?? 'none'} `
    + `invalidatedReply=${invalidatedReply}`
  );
  return true;
}

function handleDoubaoMessage(context, data, isBinary) {
  if (!isBinary) {
    reportCloudError(context, '豆包返回了非二进制消息');
    void closeDoubaoSession(context, 'non-binary cloud message');
    return;
  }

  let frame;
  try {
    frame = parseServerFrame(data);
  } catch (error) {
    if (isProtocolDebugEnabled() && !context.protocolDebugInspected) {
      context.protocolDebugInspected = true;
      inspectDoubaoFrameForDebug(data, context);
    }
    const message = error instanceof DoubaoProtocolError
      ? error.message
      : `豆包协议处理失败：${error.message}`;
    reportCloudError(context, message);
    void closeDoubaoSession(context, 'cloud protocol error');
    return;
  }

  const isTtsEvent = frame.eventId === EVENT.TTS_SENTENCE_START
    || frame.eventId === EVENT.TTS_SENTENCE_END
    || frame.eventId === EVENT.TTS_RESPONSE
    || frame.eventId === EVENT.TTS_ENDED;
  if (!isTtsEvent) {
    const eventIdText = frame.eventId === undefined
      ? 'none'
      : frame.eventId;
    log(
      `[Relay] Doubao event ${frame.eventName} `
      + `eventId=${eventIdText} payloadBytes=${frame.payload.length}`
    );
  }

  if (frame.messageType === 0x0f
    || frame.eventId === EVENT.CONNECTION_FAILED
    || frame.eventId === EVENT.SESSION_FAILED
    || frame.eventId === EVENT.DIALOG_COMMON_ERROR) {
    if (frame.eventId === EVENT.SESSION_FAILED
      && typeof frame.sessionId === 'string'
      && frame.sessionId.length > 0
      && frame.sessionId === context.sessionId) {
      const isFirstSessionFailed = !context.sessionFailed;
      context.sessionFailed = true;
      if (
        isFirstSessionFailed
        && context.internalCallLifecycleCoordinator !== null
      ) {
        void context.internalCallLifecycleCoordinator
          .markFailed()
          .catch(() => {
            log('[Relay] 内部 Call 生命周期 failed 状态上报失败');
          });
      }
    }
    const cloudError = extractCloudError(frame);
    reportCloudError(context, cloudError.message, cloudError.code);
    void closeDoubaoSession(context, 'cloud error event');
    return;
  }

  switch (frame.eventId) {
    case EVENT.CONNECTION_STARTED:
      context.connectionStarted = true;
      log('[Relay] ConnectionStarted');
      sendJson(context.browserSocket, {
        type: 'relay.connection_started',
      });
      if (!sendStartSession(context)) {
        reportCloudError(context, 'StartSession 发送失败');
        void closeDoubaoSession(context, 'start session failed');
      }
      break;

    case EVENT.SESSION_STARTED:
      if (!frame.sessionId || frame.sessionId !== context.sessionId) {
        reportCloudError(context, 'SessionStarted Session ID 不匹配');
        void closeDoubaoSession(context, 'session id mismatch');
        return;
      }
      const isFirstSessionStarted = !context.sessionStarted;
      context.sessionStarted = true;
      if (
        isFirstSessionStarted
        && !context.closing
        && context.internalCallLifecycleCoordinator !== null
      ) {
        void context.internalCallLifecycleCoordinator
          .markActive()
          .catch(() => {
            log('[Relay] 内部 Call 生命周期 active 状态上报失败');
          });
      }
      log('[Relay] SessionStarted');
      sendJson(context.browserSocket, {
        type: 'relay.session_started',
        sessionId: context.sessionId,
      });
      break;

    case EVENT.ASR_INFO:
    {
      const { questionId } = extractQuestionAndReplyIds(frame.json);
      if (questionId === undefined) {
        reportCloudError(context, 'ASRInfo 缺少 question_id');
        void closeDoubaoSession(context, 'ASRInfo missing question_id');
        return;
      }
      if (!context.conversationAudioActive
        || context.invalidatedQuestionIds.has(questionId)) {
        recordDroppedStaleJsonEvent(context);
        break;
      }

      const previousDialogState = context.dialogState;
      const isBargeIn = previousDialogState === 'assistant_speaking'
        || (context.activeTtsGeneration !== undefined
          && context.activePlaybackCompleted === false);
      context.currentTurnIndex += 1;
      context.currentQuestionId = questionId;
      if (isBargeIn) {
        interruptActiveReply(context, questionId);
      }
      context.dialogState = 'user_speaking';
      context.lastAsrInfoAt = Date.now();
      context.lastAsrText = '';
      log(
        `[Relay] ASRInfo turn=${context.currentTurnIndex} `
        + `bargeIn=${isBargeIn}`
      );
      sendJson(context.browserSocket, {
        type: 'relay.asr_info',
        turnIndex: context.currentTurnIndex,
        questionId,
        bargeIn: isBargeIn,
      });
      break;
    }

    case EVENT.ASR_RESPONSE: {
      const json = frame.json && typeof frame.json === 'object'
        ? frame.json
        : {};
      const { questionId, replyId } = extractQuestionAndReplyIds(json);
      if (shouldIgnoreReplyEvent(context, questionId, replyId)) {
        break;
      }
      const asrResult = extractAsrResult(json.results);
      const safeText = sanitizeEventText(asrResult.text, 200);
      const topLevelInterim = getAsrInterimFlag(json);
      const isInterim = asrResult.isInterim
        ?? topLevelInterim
        ?? false;
      if (safeText !== '') {
        context.lastAsrText = safeText;
        log(`[Relay] ASRResponse text=${safeText}`);
      } else {
        log('[Relay] ASRResponse 未包含可用转写文本');
      }
      sendJson(context.browserSocket, {
        type: 'relay.asr_response',
        turnIndex: context.currentTurnIndex,
        text: safeText,
        isInterim,
      });
      break;
    }

    case EVENT.ASR_ENDED: {
      const { questionId, replyId } = extractQuestionAndReplyIds(frame.json);
      if (shouldIgnoreReplyEvent(context, questionId, replyId)) {
        break;
      }
      context.dialogState = 'waiting_response';
      log('[Relay] ASREnded，服务端判定用户说话结束');
      sendJson(context.browserSocket, {
        type: 'relay.asr_ended',
        turnIndex: context.currentTurnIndex,
      });
      break;
    }

    case EVENT.CHAT_RESPONSE: {
      const json = frame.json && typeof frame.json === 'object'
        ? frame.json
        : {};
      const { questionId, replyId } = extractQuestionAndReplyIds(json);
      if (shouldIgnoreReplyEvent(context, questionId, replyId)) {
        break;
      }
      if (replyId !== undefined) {
        context.activeReplyId = replyId;
      }
      const content = typeof json.content === 'string'
        ? json.content
        : '';
      const safeContent = sanitizeEventText(content, 300);
      log(`[Relay] ChatResponse content=${safeContent}`);
      sendJson(context.browserSocket, {
        type: 'relay.chat_response',
        turnIndex: context.currentTurnIndex,
        content: safeContent,
      });
      break;
    }

    case EVENT.CHAT_ENDED: {
      const { questionId, replyId } = extractQuestionAndReplyIds(frame.json);
      if (shouldIgnoreReplyEvent(context, questionId, replyId)) {
        break;
      }
      log('[Relay] ChatEnded');
      sendJson(context.browserSocket, {
        type: 'relay.chat_ended',
        turnIndex: context.currentTurnIndex,
      });
      break;
    }

    case EVENT.TTS_SENTENCE_START: {
      const { questionId, replyId } = extractQuestionAndReplyIds(frame.json);
      if (replyId === undefined) {
        reportCloudError(context, 'TTSSentenceStart 缺少 reply_id');
        void closeDoubaoSession(context, 'TTSSentenceStart missing reply_id');
        return;
      }
      if (shouldIgnoreReplyEvent(context, questionId, replyId)) {
        break;
      }

      const sameActiveReply = context.activeReplyId === replyId
        && context.activeTtsGeneration !== undefined
        && (questionId === undefined
          || context.activeTtsQuestionId === questionId);
      if (!sameActiveReply) {
        context.activeReplyId = replyId;
        context.activeTtsQuestionId = questionId;
        context.activeTtsGeneration = context.nextTtsGeneration;
        context.nextTtsGeneration += 1;
        context.ttsGenerationByReplyId.set(
          replyId,
          context.activeTtsGeneration
        );
        context.dropTtsUntilValidReplyStart = false;
        context.activeTtsResponseFrames = 0;
        context.activeTtsResponseBytes = 0;
        context.activeTtsForwardedFrames = 0;
        context.activeTtsForwardedBytes = 0;
        context.activeTtsStreamEnded = false;
        context.activePlaybackCompleted = false;
        context.ttsForwardingStarted = false;
      }
      context.dialogState = 'assistant_speaking';
      log(
        `[Relay] TTSSentenceStart turn=${context.currentTurnIndex} `
        + `generation=${context.activeTtsGeneration}`
      );
      break;
    }

    case EVENT.TTS_SENTENCE_END: {
      const { questionId, replyId } = extractQuestionAndReplyIds(frame.json);
      if (shouldIgnoreReplyEvent(context, questionId, replyId)) {
        break;
      }
      log('[Relay] TTSSentenceEnd');
      break;
    }

    case EVENT.TTS_RESPONSE:
      if (frame.serialization !== 0) {
        reportCloudError(context, 'TTSResponse 序列化方式不是 raw bytes');
        void closeDoubaoSession(context, 'invalid TTSResponse serialization');
        return;
      }
      if (frame.payload.length === 0) {
        reportCloudError(context, 'TTSResponse payload 为空');
        void closeDoubaoSession(context, 'empty TTSResponse');
        return;
      }
      if (frame.payload.length % 2 !== 0) {
        reportCloudError(context, 'TTSResponse PCM 字节数无效');
        void closeDoubaoSession(context, 'invalid TTS PCM payload');
        return;
      }
      if (context.dropTtsUntilValidReplyStart
        || context.activeTtsGeneration === undefined
        || context.activeReplyId === undefined
        || context.invalidatedReplyIds.has(context.activeReplyId)) {
        recordDroppedStaleTtsFrame(context, frame.payload.length);
        break;
      }
      context.activeTtsResponseFrames += 1;
      context.activeTtsResponseBytes += frame.payload.length;
      if (!forwardTtsAudioToBrowser(context, frame.payload)) {
        return;
      }
      if (context.activeTtsResponseFrames
        % BROWSER_AUDIO_STATS_INTERVAL === 0) {
        log(
          `[Relay] TTSResponse generation=${context.activeTtsGeneration} `
          + `frames=${context.activeTtsResponseFrames} `
          + `bytes=${context.activeTtsResponseBytes}`
        );
      }
      break;

    case EVENT.TTS_ENDED: {
      const { questionId, replyId } = extractQuestionAndReplyIds(frame.json);
      if (shouldIgnoreReplyEvent(context, questionId, replyId)) {
        break;
      }
      if (context.activeTtsGeneration === undefined) {
        recordDroppedStaleJsonEvent(context);
        break;
      }
      if (replyId !== undefined
        && context.activeReplyId !== undefined
        && replyId !== context.activeReplyId) {
        recordDroppedStaleJsonEvent(context);
        break;
      }
      log(
        `[Relay] TTSEnded generation=${context.activeTtsGeneration} `
        + `frames=${context.activeTtsResponseFrames} `
        + `bytes=${context.activeTtsResponseBytes} `
        + `forwardedFrames=${context.activeTtsForwardedFrames} `
        + `forwardedBytes=${context.activeTtsForwardedBytes}`
      );
      if (context.activeTtsResponseBytes <= 0
        || context.ttsForwardingFailed
        || context.activeTtsForwardedFrames
          !== context.activeTtsResponseFrames
        || context.activeTtsForwardedBytes
          !== context.activeTtsResponseBytes
        || !context.browserSocket
        || context.browserSocket.readyState !== WebSocket.OPEN) {
        failTtsForwarding(
          context,
          'TTS 音频未完整转发到浏览器',
          'incomplete browser TTS forwarding'
        );
        return;
      }
      context.activeTtsStreamEnded = true;
      try {
        const endedSent = sendJson(context.browserSocket, {
          type: 'relay.tts_ended',
          turnIndex: context.currentTurnIndex,
          generation: context.activeTtsGeneration,
          frames: context.activeTtsResponseFrames,
          bytes: context.activeTtsResponseBytes,
        });
        if (!endedSent) {
          failTtsForwarding(
            context,
            'TTS 音频未完整转发到浏览器',
            'browser unavailable at TTSEnded'
          );
          return;
        }
      } catch (error) {
        failTtsForwarding(
          context,
          `TTSEnded 通知发送失败：${error.message}`,
          'TTSEnded notification failed'
        );
        return;
      }
      break;
    }

    case EVENT.SESSION_FINISHED:
      if (typeof frame.sessionId !== 'string'
        || frame.sessionId.length === 0
        || frame.sessionId !== context.sessionId) {
        reportCloudError(context, 'SessionFinished Session ID 不匹配');
        void closeDoubaoSession(context, 'session id mismatch');
        return;
      }
      const isFirstSessionFinished = !context.sessionFinished;
      context.sessionFinished = true;
      if (
        isFirstSessionFinished
        && context.internalCallLifecycleCoordinator !== null
      ) {
        void context.internalCallLifecycleCoordinator
          .markEnded()
          .catch(() => {
            log('[Relay] 内部 Call 生命周期 ended 状态上报失败');
          });
      }
      log('[Relay] SessionFinished');
      sendJson(context.browserSocket, {
        type: 'relay.session_finished',
      });
      break;

    case EVENT.CONNECTION_FINISHED:
      context.upstreamFinished = true;
      log('[Relay] ConnectionFinished');
      sendJson(context.browserSocket, {
        type: 'relay.connection_finished',
      });
      if (context.upstreamSocket
        && context.upstreamSocket.readyState === WebSocket.OPEN) {
        context.upstreamSocket.close(1000, 'connection finished');
      }
      finishUpstreamCleanup(context);
      break;

    default:
      break;
  }
}

function connectDoubaoUpstream(context) {
  if (!context.characterResolved
    || typeof context.characterSystemPrompt !== 'string'
    || typeof context.speakerId !== 'string') {
    log('[Relay] 角色尚未解析，拒绝创建豆包上游连接');
    return false;
  }
  if (context.upstreamConnectStarted) {
    log('[Relay] 已忽略重复 browser.hello，未创建第二个豆包连接');
    return false;
  }
  context.upstreamConnectStarted = true;

  let config;
  try {
    config = getDoubaoConfig();
  } catch (error) {
    reportCloudError(context, error.message);
    return false;
  }

  context.redactCloudMessage = (value) => {
    const withoutApiKey = redactSecret(value, config.apiKey);
    return context.sessionId
      ? withoutApiKey
        .split(context.sessionId)
        .join('[REDACTED_SESSION_ID]')
      : withoutApiKey;
  };

  let upstreamSocket;
  try {
    upstreamSocket = new WebSocket(config.url, {
      headers: config.headers,
      perMessageDeflate: false,
      handshakeTimeout: 15000,
      maxPayload: 16 * 1024 * 1024,
    });
  } catch (error) {
    reportCloudError(
      context,
      context.redactCloudMessage(error.message)
    );
    return false;
  }

  context.upstreamSocket = upstreamSocket;
  upstreamSocket.binaryType = 'nodebuffer';

  upstreamSocket.on('open', () => {
    log('[Relay] Doubao WebSocket open');
    if (!sendStartConnection(context)) {
      reportCloudError(context, 'StartConnection 发送失败');
      void closeDoubaoSession(context, 'start connection failed');
    }
  });

  upstreamSocket.on('message', (data, isBinary) => {
    handleDoubaoMessage(context, data, isBinary);
  });

  upstreamSocket.on('unexpected-response', (_request, response) => {
    const statusCode = response.statusCode;
    log(`[Relay] Doubao WebSocket 握手失败，HTTP ${statusCode}`);
    response.resume();
    reportCloudError(
      context,
      `豆包 WebSocket 握手失败，HTTP ${statusCode}`,
      statusCode
    );
    void closeDoubaoSession(context, 'unexpected cloud response');
  });

  upstreamSocket.on('error', (error) => {
    const safeMessage = context.redactCloudMessage(error.message);
    log(`[Relay] Doubao WebSocket error：${safeMessage}`);
    reportCloudError(context, safeMessage);
    void closeDoubaoSession(context, 'cloud socket error');
  });

  upstreamSocket.on('close', (code, reasonBuffer) => {
    const reason = context.redactCloudMessage(
      reasonBuffer.toString('utf8')
    );
    const closedBeforeSession = !context.sessionStarted;
    context.upstreamFinished = true;
    log(`[Relay] Doubao WebSocket close code=${code} reason=${reason}`);

    if (closedBeforeSession && !context.closing) {
      reportCloudError(
        context,
        '豆包云端在 SessionStarted 前关闭'
      );
    } else if (!context.closing && !context.conversationFinished) {
      reportCloudError(
        context,
        '豆包云端在多轮会话期间意外关闭'
      );
    }

    sendJson(context.browserSocket, {
      type: 'relay.cloud_closed',
      code,
      reason,
    });
    finishUpstreamCleanup(context);
  });

  return true;
}

function handleBrowserMessage(context, rawData) {
  let message;

  try {
    message = JSON.parse(rawData.toString('utf8'));
  } catch {
    log('[Relay] 收到的浏览器消息不是合法 JSON');
    sendJson(context.browserSocket, {
      type: 'relay.error',
      message: '浏览器消息不是合法 JSON',
    });
    return;
  }

  if (message
    && typeof message === 'object'
    && message.type === 'browser.hello'
    && message.client === 'doubao-browser-poc') {
    log('[Relay] 收到 browser.hello');

    const hasBusinessCallId = Object.prototype.hasOwnProperty.call(
      message,
      'callId'
    );
    if (context.enforceBusinessCallAdmission && !hasBusinessCallId) {
      log('[Relay] browser.hello 缺少业务通话标识');
      sendJson(context.browserSocket, {
        type: 'relay.error',
        message: BUSINESS_CALL_REQUIRED_MESSAGE,
      });
      return;
    }
    if (hasBusinessCallId && !isValidBusinessCallId(message.callId)) {
      log('[Relay] browser.hello 包含非法业务通话标识');
      sendJson(context.browserSocket, {
        type: 'relay.error',
        message: INVALID_BUSINESS_CALL_ID_MESSAGE,
      });
      return;
    }
    const nextBusinessCallId = hasBusinessCallId
      ? message.callId
      : null;
    if (context.enforceBusinessCallAdmission) {
      let lifecycleEnabled = false;
      try {
        lifecycleEnabled =
          context.internalCallLifecycleDependency.enabled === true;
      } catch {
        lifecycleEnabled = false;
      }
      if (!lifecycleEnabled) {
        log('[Relay] 业务通话准入依赖未启用，拒绝连接豆包');
        sendJson(context.browserSocket, {
          type: 'relay.error',
          message: BUSINESS_CALL_ADMISSION_FAILED_MESSAGE,
        });
        return;
      }
    }

    const rawCharacterKey = Object.hasOwn(message, 'characterKey')
      ? message.characterKey
      : MISSING_CHARACTER_KEY;
    if (context.characterResolved
      && rawCharacterKey === MISSING_CHARACTER_KEY) {
      log('[Relay] 重复 browser.hello 与首次握手冲突');
      sendJson(context.browserSocket, {
        type: 'relay.error',
        message: CONFLICTING_BROWSER_HELLO_MESSAGE,
      });
      return;
    }
    let characterConfig;
    try {
      characterConfig = resolveCharacterConfig(rawCharacterKey);
    } catch (error) {
      log(
        '[Relay] 角色解析失败 '
        + `key=${describeRejectedCharacterKey(rawCharacterKey)} `
        + `error=${describeCharacterResolutionError(error)}`
      );
      sendJson(context.browserSocket, {
        type: 'relay.error',
        message: error.message,
      });
      return;
    }

    if (context.characterResolved) {
      if (characterConfig.key !== context.characterKey
        || nextBusinessCallId !== context.businessCallId) {
        log('[Relay] 重复 browser.hello 与首次握手冲突');
        sendJson(context.browserSocket, {
          type: 'relay.error',
          message: CONFLICTING_BROWSER_HELLO_MESSAGE,
        });
        return;
      }
      if (context.businessCallAdmissionPending) {
        log('[Relay] 业务通话准入仍在核验，忽略重复 browser.hello');
        return;
      }
      if (context.businessCallAdmissionFailed) {
        sendJson(context.browserSocket, {
          type: 'relay.error',
          message: BUSINESS_CALL_ADMISSION_FAILED_MESSAGE,
        });
        return;
      }
      log('[Relay] 已确认幂等重复 browser.hello');
      sendJson(context.browserSocket, {
        type: 'relay.hello_ack',
        received: true,
      });
      return;
    }

    let nextInternalCallLifecycleCoordinator = null;
    if (nextBusinessCallId !== null) {
      nextInternalCallLifecycleCoordinator =
        createRelayInternalCallLifecycleCoordinator({
          dependency: context.internalCallLifecycleDependency,
          callId: nextBusinessCallId,
        });
    }
    context.characterKey = characterConfig.key;
    context.characterDisplayName = characterConfig.displayName;
    context.characterSystemPrompt = characterConfig.systemPrompt;
    context.speakerId = characterConfig.speakerId;
    context.businessCallId = nextBusinessCallId;
    context.internalCallLifecycleCoordinator =
      nextInternalCallLifecycleCoordinator;
    context.characterResolved = true;
    if (
      context.enforceBusinessCallAdmission
      && context.internalCallLifecycleCoordinator !== null
    ) {
      context.businessCallAdmissionPending = true;
      void context.internalCallLifecycleCoordinator
        .markConnecting()
        .then((call) => {
          context.businessCallAdmissionPending = false;
          if (context.closing || context.businessCallAdmissionFailed) {
            return;
          }
          if (
            !call
            || !call.role
            || call.role.slug !== characterConfig.key
          ) {
            context.businessCallAdmissionFailed = true;
            log('[Relay] 业务通话角色与 browser.hello 不匹配');
            sendJson(context.browserSocket, {
              type: 'relay.error',
              message: BUSINESS_CALL_ADMISSION_FAILED_MESSAGE,
            });
            return;
          }
          sendJson(context.browserSocket, {
            type: 'relay.hello_ack',
            received: true,
          });
          connectDoubaoUpstream(context);
        })
        .catch(() => {
          context.businessCallAdmissionPending = false;
          context.businessCallAdmissionFailed = true;
          log('[Relay] 业务通话 connecting 准入核验失败');
          sendJson(context.browserSocket, {
            type: 'relay.error',
            message: BUSINESS_CALL_ADMISSION_FAILED_MESSAGE,
          });
        });
      return;
    }
    if (context.internalCallLifecycleCoordinator !== null) {
      void context.internalCallLifecycleCoordinator
        .markConnecting()
        .catch(() => {
          log('[Relay] 内部 Call 生命周期 connecting 状态上报失败');
        });
    }
    sendJson(context.browserSocket, {
      type: 'relay.hello_ack',
      received: true,
    });
    connectDoubaoUpstream(context);
    return;
  }

  if (message
    && typeof message === 'object'
    && message.type === 'browser.audio_start') {
    if (!context.sessionStarted
      || context.closing
      || context.conversationAudioActive) {
      sendJson(context.browserSocket, {
        type: 'relay.error',
        message: '当前会话状态不能开始持续接收浏览器 PCM',
      });
      return;
    }

    const validAudioConfig = message.format === 'pcm_s16le'
      && message.sampleRate === BROWSER_PCM_SAMPLE_RATE
      && message.channels === 1
      && Number.isFinite(message.inputSampleRate)
      && message.inputSampleRate > 0;
    if (!validAudioConfig) {
      sendJson(context.browserSocket, {
        type: 'relay.error',
        message: 'browser.audio_start 音频参数无效',
      });
      return;
    }

    context.conversationAudioActive = true;
    context.acceptingBrowserAudio = true;
    context.dialogState = 'listening';
    context.browserAudioStartedAt = Date.now();
    log(
      '[Relay] 开始持续接收浏览器 PCM '
      + `format=${message.format} inputSampleRate=${message.inputSampleRate} `
      + `targetSampleRate=${message.sampleRate} channels=${message.channels}`
    );
    sendJson(context.browserSocket, {
      type: 'relay.audio_started',
      mode: 'continuous',
    });
    return;
  }

  if (message
    && typeof message === 'object'
    && message.type === 'browser.audio_stop') {
    if (!context.sessionStarted || context.closing) {
      sendJson(context.browserSocket, {
        type: 'relay.error',
        message: '当前会话状态不能停止浏览器 PCM',
      });
      return;
    }

    context.conversationAudioActive = false;
    context.acceptingBrowserAudio = false;
    abandonActiveReplyForUserStop(context);
    sendJson(context.browserSocket, {
      type: 'relay.audio_stopped',
      reason: 'user_stop',
    });
    return;
  }

  if (message
    && typeof message === 'object'
    && message.type === 'browser.playback_completed') {
    const validGeneration = Number.isSafeInteger(message.generation)
      && message.generation > 0;
    const validTurnIndex = Number.isSafeInteger(message.turnIndex)
      && message.turnIndex > 0;
    if (!validGeneration
      || !validTurnIndex
      || message.generation !== context.activeTtsGeneration
      || message.turnIndex !== context.currentTurnIndex
      || context.interruptedTtsGenerations.has(message.generation)
      || !context.activeTtsStreamEnded
      || context.activePlaybackCompleted) {
      sendJson(context.browserSocket, {
        type: 'relay.error',
        message: '播放完成确认的轮次或 generation 无效',
      });
      return;
    }
    if (message.frames !== context.activeTtsForwardedFrames
      || message.bytes !== context.activeTtsForwardedBytes) {
      sendJson(context.browserSocket, {
        type: 'relay.error',
        message: '播放完成确认的 TTS 统计不匹配',
      });
      return;
    }

    const completedTurnIndex = context.currentTurnIndex;
    const completedGeneration = context.activeTtsGeneration;
    context.activePlaybackCompleted = true;
    context.dialogState = 'listening';
    context.lastCompletedTtsTurnIndex = completedTurnIndex;
    context.lastCompletedTtsGeneration = completedGeneration;
    context.lastCompletedTtsFrames = context.activeTtsForwardedFrames;
    context.lastCompletedTtsBytes = context.activeTtsForwardedBytes;
    context.activeReplyId = undefined;
    context.activeTtsQuestionId = undefined;
    context.activeTtsGeneration = undefined;
    context.ttsForwardingStarted = false;
    log(
      `[Relay] 第 ${completedTurnIndex} 轮 generation `
      + `${completedGeneration} 浏览器播放完成`
    );
    sendJson(context.browserSocket, {
      type: 'relay.playback_completed_ack',
      turnIndex: completedTurnIndex,
      generation: completedGeneration,
    });
    return;
  }

  log('[Relay] 收到不支持的浏览器消息类型');
  sendJson(context.browserSocket, {
    type: 'relay.error',
    message: '不支持的浏览器消息类型',
  });
}

function handleBrowserBinaryAudio(context, rawData) {
  if (!context.conversationAudioActive
    || !context.acceptingBrowserAudio
    || !context.sessionStarted
    || context.closing) {
    sendJson(context.browserSocket, {
      type: 'relay.error',
      message: '当前未接受浏览器 PCM 二进制数据',
    });
    return false;
  }

  let audioBuffer;
  try {
    audioBuffer = Buffer.isBuffer(rawData)
      ? rawData
      : Buffer.from(rawData);
  } catch {
    sendJson(context.browserSocket, {
      type: 'relay.error',
      message: '浏览器 PCM 不是可读取的二进制数据',
    });
    return false;
  }

  if (audioBuffer.length === 0
    || audioBuffer.length % 2 !== 0
    || audioBuffer.length > BROWSER_PCM_MAX_CHUNK_BYTES
    || audioBuffer.length !== BROWSER_PCM_CHUNK_BYTES) {
    sendJson(context.browserSocket, {
      type: 'relay.error',
      message: `浏览器 PCM 块长度无效：${audioBuffer.length} bytes`,
    });
    return false;
  }

  context.browserAudioChunks += 1;
  context.browserAudioBytes += audioBuffer.length;

  const taskRequestSent = sendTaskRequest(context, audioBuffer);

  if (context.browserAudioChunks - context.lastAudioStatsChunk
    >= BROWSER_AUDIO_STATS_INTERVAL) {
    context.lastAudioStatsChunk = context.browserAudioChunks;
    const estimatedMilliseconds = (
      context.browserAudioBytes / 2 / BROWSER_PCM_SAMPLE_RATE * 1000
    );
    log(
      '[Relay] 浏览器本地 PCM 统计 '
      + `chunks=${context.browserAudioChunks} `
      + `bytes=${context.browserAudioBytes} `
      + `estimatedMilliseconds=${estimatedMilliseconds}`
    );
    sendJson(context.browserSocket, {
      type: 'relay.audio_stats',
      chunks: context.browserAudioChunks,
      bytes: context.browserAudioBytes,
      estimatedMilliseconds,
    });
  }

  return taskRequestSent;
}

function handleBrowserConnection(
  socket,
  request,
  contexts,
  internalCallLifecycleDependency =
    DISABLED_INTERNAL_CALL_LIFECYCLE_DEPENDENCY,
  enforceBusinessCallAdmission = false
) {
  const remoteAddress = request.socket.remoteAddress || 'unknown';
  const context = {
    browserSocket: socket,
    businessCallId: null,
    businessCallAdmissionFailed: false,
    businessCallAdmissionPending: false,
    enforceBusinessCallAdmission,
    internalCallLifecycleDependency,
    internalCallLifecycleCoordinator: null,
    upstreamSocket: undefined,
    sessionId: undefined,
    speakerId: undefined,
    characterKey: undefined,
    characterDisplayName: undefined,
    characterSystemPrompt: undefined,
    characterResolved: false,
    startConnectionSent: false,
    startSessionSent: false,
    connectionStarted: false,
    sessionStarted: false,
    sessionFinished: false,
    sessionFailed: false,
    finishSessionSent: false,
    finishConnectionSent: false,
    upstreamFinished: false,
    upstreamConnectStarted: false,
    cloudErrorSent: false,
    protocolDebugInspected: false,
    dialogState: 'idle',
    conversationAudioActive: false,
    acceptingBrowserAudio: false,
    browserAudioChunks: 0,
    browserAudioBytes: 0,
    browserAudioStartedAt: undefined,
    lastAudioStatsChunk: 0,
    taskRequestFrames: 0,
    taskRequestPcmBytes: 0,
    taskRequestEncodedBytes: 0,
    currentTurnIndex: 0,
    currentQuestionId: undefined,
    invalidatedQuestionIds: new Set(),
    lastAsrText: '',
    activeReplyId: undefined,
    activeTtsQuestionId: undefined,
    activeTtsGeneration: undefined,
    nextTtsGeneration: 1,
    invalidatedReplyIds: new Set(),
    interruptedTtsGenerations: new Set(),
    ttsGenerationByReplyId: new Map(),
    dropTtsUntilValidReplyStart: false,
    activeTtsResponseFrames: 0,
    activeTtsResponseBytes: 0,
    activeTtsForwardedFrames: 0,
    activeTtsForwardedBytes: 0,
    activeTtsStreamEnded: false,
    activePlaybackCompleted: false,
    ttsForwardingStarted: false,
    ttsForwardingFailed: false,
    singleTurnInputClosed: false,
    bargeInCount: 0,
    droppedStaleTtsFrames: 0,
    droppedStaleTtsBytes: 0,
    droppedStaleJsonEvents: 0,
    lastAsrInfoAt: undefined,
    lastBargeInAt: undefined,
    lastBargeInQuestionId: undefined,
    lastCompletedTtsTurnIndex: undefined,
    lastCompletedTtsGeneration: undefined,
    lastCompletedTtsFrames: 0,
    lastCompletedTtsBytes: 0,
    conversationFinished: false,
    closing: false,
    closePromise: undefined,
    resolveUpstreamClose: undefined,
    upstreamCloseTimer: undefined,
    redactCloudMessage: (value) => String(value || '未知错误'),
  };
  contexts.add(context);
  log(`[Relay] 浏览器 WebSocket 已连接：${remoteAddress}`);

  sendJson(socket, {
    type: 'relay.ready',
    version: RELAY_VERSION,
  });

  socket.on('message', (rawData, isBinary) => {
    if (isBinary) {
      handleBrowserBinaryAudio(context, rawData);
      return;
    }

    log(`[Relay] 收到浏览器消息：${rawData.length} bytes`);
    handleBrowserMessage(context, rawData);
  });

  socket.on('close', (code) => {
    context.conversationAudioActive = false;
    context.acceptingBrowserAudio = false;
    context.singleTurnInputClosed = true;
    log(`[Relay] 浏览器 WebSocket 已关闭，code=${code}`);
    void closeDoubaoSession(context, 'browser closed')
      .finally(() => contexts.delete(context));
  });

  socket.on('error', (error) => {
    context.conversationAudioActive = false;
    context.acceptingBrowserAudio = false;
    context.singleTurnInputClosed = true;
    log(`[Relay] 浏览器 WebSocket 错误：${error.message}`);
    void closeDoubaoSession(context, 'browser error')
      .finally(() => contexts.delete(context));
  });
}

function startServer({
  lifecycleEnv = process.env,
  lifecycleTimeoutMs = 3000,
  lifecycleFetchImpl = globalThis.fetch,
} = {}) {
  const internalCallLifecycleDependency =
    createRelayInternalCallLifecycleDependency({
      env: lifecycleEnv,
      timeoutMs: lifecycleTimeoutMs,
      fetchImpl: lifecycleFetchImpl,
    });
  const app = express();
  const server = http.createServer(app);
  const websocketServer = new WebSocketServer({ noServer: true });
  const fortuneAsrEnabled = isFortuneAsrEnabled();
  let fortuneAsrWebSocketServer = null;
  let handleFortuneAsrConnection = null;

  if (fortuneAsrEnabled) {
    const {
      createFortuneAsrClientFactoryFromEnv,
      createFortuneAsrRelayConnectionHandler,
    } = require('./fortune_asr_relay');
    fortuneAsrWebSocketServer = new WebSocketServer({ noServer: true });
    handleFortuneAsrConnection = createFortuneAsrRelayConnectionHandler({
      asrClientFactory: createFortuneAsrClientFactoryFromEnv(),
      logger: log,
    });
  }

  const websocketServers = fortuneAsrWebSocketServer
    ? [websocketServer, fortuneAsrWebSocketServer]
    : [websocketServer];
  const contexts = new Set();
  let shuttingDown = false;

  app.use((_request, response, next) => {
    if (shuttingDown) {
      response.status(503).send('Relay is shutting down');
      return;
    }
    next();
  });
  app.use(express.static(path.join(__dirname, 'public')));

  server.on('upgrade', (request, socket, head) => {
    if (shuttingDown) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    let pathname;

    try {
      pathname = new URL(request.url, `http://${HOST}:${PORT}`).pathname;
    } catch {
      log('[Relay] 拒绝了无法解析的 WebSocket 路径');
      socket.destroy();
      return;
    }

    if (
      pathname !== WEBSOCKET_PATH
      && (
        pathname !== FORTUNE_ASR_WEBSOCKET_PATH
        || !fortuneAsrWebSocketServer
      )
    ) {
      log(`[Relay] 拒绝 WebSocket 路径：${pathname}`);
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const targetWebSocketServer = pathname === WEBSOCKET_PATH
      ? websocketServer
      : fortuneAsrWebSocketServer;
    targetWebSocketServer.handleUpgrade(request, socket, head, (websocket) => {
      targetWebSocketServer.emit('connection', websocket, request);
    });
  });

  websocketServer.on('connection', (socket, request) => {
    handleBrowserConnection(
      socket,
      request,
      contexts,
      internalCallLifecycleDependency,
      true
    );
  });

  if (fortuneAsrWebSocketServer) {
    fortuneAsrWebSocketServer.on('connection', (socket) => {
      handleFortuneAsrConnection(socket);
    });
  }

  server.on('error', (error) => {
    log(`[Relay] HTTP Server 错误：${error.message}`);
  });

  server.listen(PORT, HOST, () => {
    log(`[Relay] HTTP: http://${HOST}:${PORT}`);
    log(`[Relay] WebSocket: ws://${HOST}:${PORT}${WEBSOCKET_PATH}`);
    if (fortuneAsrWebSocketServer) {
      log(
        `[Relay] Fortune ASR WebSocket: `
        + `ws://${HOST}:${PORT}${FORTUNE_ASR_WEBSOCKET_PATH}`
      );
    }
  });

  process.once('SIGINT', () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log('[Relay] 收到 SIGINT，开始关闭');

    void (async () => {
      let shutdownFailed = false;

      for (const context of contexts) {
        context.conversationAudioActive = false;
        context.acceptingBrowserAudio = false;
        context.singleTurnInputClosed = true;
      }

      await Promise.allSettled(
        Array.from(contexts, (context) => (
          closeDoubaoSession(context, 'server shutdown')
        ))
      );

      for (const currentWebSocketServer of websocketServers) {
        for (const client of currentWebSocketServer.clients) {
          if (client.readyState === WebSocket.OPEN
            || client.readyState === WebSocket.CONNECTING) {
            client.close(1001, 'relay shutting down');
          }
        }
      }

      await Promise.all(websocketServers.map(
        (currentWebSocketServer) => new Promise((resolve) => {
          const forceCloseTimer = setTimeout(() => {
            for (const client of currentWebSocketServer.clients) {
              client.terminate();
            }
          }, 2000);

          currentWebSocketServer.close((error) => {
            clearTimeout(forceCloseTimer);
            if (error) {
              shutdownFailed = true;
              log(`[Relay] WebSocketServer 关闭错误：${error.message}`);
            } else {
              log('[Relay] WebSocketServer 已关闭');
            }
            resolve();
          });
        })
      ));

      await new Promise((resolve) => {
        server.close((error) => {
          if (error) {
            shutdownFailed = true;
            log(`[Relay] HTTP Server 关闭错误：${error.message}`);
          } else {
            log('[Relay] HTTP Server 已关闭');
          }
          resolve();
        });
      });

      log(shutdownFailed
        ? '[Relay] 关闭完成，但发生错误'
        : '[Relay] 已正常停止');
      process.exitCode = shutdownFailed ? 1 : 0;
    })().catch((error) => {
      log(`[Relay] SIGINT 清理失败：${error.message}`);
      process.exitCode = 1;
    });
  });
}

startServer();
