'use strict';

const { gunzipSync } = require('node:zlib');

const EVENT = Object.freeze({
  START_CONNECTION: 1,
  FINISH_CONNECTION: 2,
  CONNECTION_STARTED: 50,
  CONNECTION_FAILED: 51,
  CONNECTION_FINISHED: 52,

  START_SESSION: 100,
  TASK_REQUEST: 200,
  FINISH_SESSION: 102,
  SESSION_STARTED: 150,
  SESSION_FINISHED: 152,
  SESSION_FAILED: 153,
  USAGE_RESPONSE: 154,

  ASR_INFO: 450,
  ASR_RESPONSE: 451,
  ASR_ENDED: 459,

  TTS_SENTENCE_START: 350,
  TTS_SENTENCE_END: 351,
  TTS_RESPONSE: 352,
  TTS_ENDED: 359,

  CHAT_TEXT_QUERY: 501,
  CHAT_RESPONSE: 550,
  CHAT_TEXT_QUERY_CONFIRMED: 553,
  CHAT_ENDED: 559,
  DIALOG_COMMON_ERROR: 599,
});

const EVENT_NAMES = new Map([
  [EVENT.START_CONNECTION, 'StartConnection'],
  [EVENT.FINISH_CONNECTION, 'FinishConnection'],
  [EVENT.CONNECTION_STARTED, 'ConnectionStarted'],
  [EVENT.CONNECTION_FAILED, 'ConnectionFailed'],
  [EVENT.CONNECTION_FINISHED, 'ConnectionFinished'],

  [EVENT.START_SESSION, 'StartSession'],
  [EVENT.TASK_REQUEST, 'TaskRequest'],
  [EVENT.FINISH_SESSION, 'FinishSession'],
  [EVENT.SESSION_STARTED, 'SessionStarted'],
  [EVENT.SESSION_FINISHED, 'SessionFinished'],
  [EVENT.SESSION_FAILED, 'SessionFailed'],
  [EVENT.USAGE_RESPONSE, 'UsageResponse'],

  [EVENT.ASR_INFO, 'ASRInfo'],
  [EVENT.ASR_RESPONSE, 'ASRResponse'],
  [EVENT.ASR_ENDED, 'ASREnded'],

  [EVENT.TTS_SENTENCE_START, 'TTSSentenceStart'],
  [EVENT.TTS_SENTENCE_END, 'TTSSentenceEnd'],
  [EVENT.TTS_RESPONSE, 'TTSResponse'],
  [EVENT.TTS_ENDED, 'TTSEnded'],

  [EVENT.CHAT_TEXT_QUERY, 'ChatTextQuery'],
  [EVENT.CHAT_RESPONSE, 'ChatResponse'],
  [EVENT.CHAT_TEXT_QUERY_CONFIRMED, 'ChatTextQueryConfirmed'],
  [EVENT.CHAT_ENDED, 'ChatEnded'],
  [EVENT.DIALOG_COMMON_ERROR, 'DialogCommonError'],
]);

class DoubaoProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DoubaoProtocolError';
  }
}

function getEventName(eventId) {
  return EVENT_NAMES.get(eventId) || `Event${eventId}`;
}

function uint32Buffer(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function encodeClientJsonEvent(eventId, payload, sessionId) {
  const header = Buffer.from([0x11, 0x14, 0x10, 0x00]);
  let payloadBuffer;

  try {
    payloadBuffer = Buffer.from(JSON.stringify(payload || {}), 'utf8');
  } catch {
    throw new DoubaoProtocolError('客户端事件 payload 无法序列化为 JSON');
  }

  const parts = [header, uint32Buffer(eventId)];

  if (sessionId) {
    const sessionBuffer = Buffer.from(sessionId, 'utf8');
    parts.push(uint32Buffer(sessionBuffer.length), sessionBuffer);
  }

  parts.push(uint32Buffer(payloadBuffer.length), payloadBuffer);
  return Buffer.concat(parts);
}

function encodeClientAudioEvent(eventId, pcmData, sessionId) {
  if (!Number.isInteger(eventId)
    || eventId < 0
    || eventId > 0xffffffff
    || eventId !== EVENT.TASK_REQUEST) {
    throw new DoubaoProtocolError('客户端音频事件 eventId 无效');
  }
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new DoubaoProtocolError('客户端音频事件缺少有效的 Session ID');
  }

  let pcmBuffer;
  try {
    pcmBuffer = Buffer.isBuffer(pcmData)
      ? pcmData
      : Buffer.from(pcmData);
  } catch {
    throw new DoubaoProtocolError('客户端音频事件 PCM 不是可读取的 Buffer 数据');
  }

  if (pcmBuffer.length === 0) {
    throw new DoubaoProtocolError('客户端音频事件 PCM 不能为空');
  }
  if (pcmBuffer.length % 2 !== 0) {
    throw new DoubaoProtocolError('客户端音频事件 PCM 字节数必须为偶数');
  }

  const header = Buffer.from([0x11, 0x24, 0x00, 0x00]);
  const sessionBuffer = Buffer.from(sessionId, 'utf8');
  return Buffer.concat([
    header,
    uint32Buffer(eventId),
    uint32Buffer(sessionBuffer.length),
    sessionBuffer,
    uint32Buffer(pcmBuffer.length),
    pcmBuffer,
  ]);
}

function ensureReadable(buffer, offset, length, fieldName) {
  if (!Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset > buffer.length
    || length > buffer.length - offset) {
    throw new DoubaoProtocolError(`服务端二进制帧缺少 ${fieldName}`);
  }
}

function readUInt32(buffer, state, fieldName) {
  ensureReadable(buffer, state.offset, 4, fieldName);
  const value = buffer.readUInt32BE(state.offset);
  state.offset += 4;
  return value;
}

function readInt32(buffer, state, fieldName) {
  ensureReadable(buffer, state.offset, 4, fieldName);
  const value = buffer.readInt32BE(state.offset);
  state.offset += 4;
  return value;
}

function parseJsonPayload(payload) {
  if (payload.length === 0) {
    return {};
  }

  try {
    return JSON.parse(payload.toString('utf8'));
  } catch {
    throw new DoubaoProtocolError('服务端返回了无法解析的 JSON 事件');
  }
}

function toBuffer(data) {
  try {
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
  } catch {
    throw new DoubaoProtocolError('服务端二进制帧不是可读取的 Buffer 数据');
  }
}

function parseServerFrame(data) {
  const buffer = toBuffer(data);
  ensureReadable(buffer, 0, 4, 'header');

  const version = buffer[0] >> 4;
  const headerWords = buffer[0] & 0x0f;
  const headerSize = headerWords * 4;
  const messageType = buffer[1] >> 4;
  const flags = buffer[1] & 0x0f;
  const serialization = buffer[2] >> 4;
  const compression = buffer[2] & 0x0f;

  if (version !== 1 || headerSize < 4) {
    throw new DoubaoProtocolError('服务端返回了不支持的二进制协议版本或头长度');
  }
  ensureReadable(buffer, 0, headerSize, '扩展 header');

  const state = { offset: headerSize };
  let errorCode;
  let sequence;
  let eventId;
  let connectionId;
  let sessionId;

  if (messageType === 0x0f) {
    errorCode = readUInt32(buffer, state, 'error code');
  } else {
    if (flags === 0x01 || flags === 0x03 || flags === 0x05 || flags === 0x07) {
      sequence = readInt32(buffer, state, 'sequence');
    }
    if ((flags & 0x04) !== 0) {
      eventId = readUInt32(buffer, state, 'event');
    }

    const isServerConnectionEvent =
      eventId === EVENT.CONNECTION_STARTED
      || eventId === EVENT.CONNECTION_FAILED
      || eventId === EVENT.CONNECTION_FINISHED;

    if (isServerConnectionEvent) {
      const connectionLength = readUInt32(
        buffer,
        state,
        'connection id length'
      );
      ensureReadable(
        buffer,
        state.offset,
        connectionLength,
        'connection id'
      );
      connectionId = buffer
        .subarray(
          state.offset,
          state.offset + connectionLength
        )
        .toString('utf8');
      state.offset += connectionLength;
    } else if (eventId !== undefined && eventId >= 100) {
      const sessionLength = readUInt32(buffer, state, 'session id length');
      ensureReadable(buffer, state.offset, sessionLength, 'session id');
      sessionId = buffer.subarray(state.offset, state.offset + sessionLength).toString('utf8');
      state.offset += sessionLength;
    }
  }

  const payloadLength = readUInt32(buffer, state, 'payload length');
  ensureReadable(buffer, state.offset, payloadLength, 'payload');
  let payload = buffer.subarray(state.offset, state.offset + payloadLength);

  if (compression === 1 && payload.length > 0) {
    try {
      payload = gunzipSync(payload);
    } catch {
      throw new DoubaoProtocolError('服务端返回了无法解压的 gzip payload');
    }
  } else if (compression !== 0) {
    throw new DoubaoProtocolError(`服务端返回了不支持的压缩方式：${compression}`);
  }

  let json;
  if (serialization === 1) {
    json = parseJsonPayload(payload);
  } else if (serialization !== 0) {
    throw new DoubaoProtocolError(`服务端返回了不支持的序列化方式：${serialization}`);
  }

  return {
    messageType,
    flags,
    serialization,
    compression,
    errorCode,
    sequence,
    eventId,
    eventName: getEventName(eventId),
    connectionId,
    sessionId,
    payload,
    json,
  };
}

module.exports = {
  EVENT,
  DoubaoProtocolError,
  getEventName,
  encodeClientJsonEvent,
  encodeClientAudioEvent,
  parseServerFrame,
};
