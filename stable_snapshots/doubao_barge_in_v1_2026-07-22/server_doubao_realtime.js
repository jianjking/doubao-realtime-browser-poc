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

const HOST = '127.0.0.1';
const PORT = 3001;
const WEBSOCKET_PATH = '/realtime';
const RELAY_VERSION = 'browser-relay-smoke-v1';
const DOUBAO_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';
const DOUBAO_RESOURCE_ID = 'volc.speech.dialog';
const DOUBAO_APP_KEY = 'PlgvMymc7f3tQnJ6';
const DOUBAO_MODEL = '1.2.1.1';
const DEFAULT_SPEAKER_ID = 'S_ViUfvBA92';
const UPSTREAM_CLOSE_TIMEOUT_MS = 3000;
const BROWSER_PCM_SAMPLE_RATE = 16000;
const BROWSER_PCM_CHUNK_BYTES = 640;
const BROWSER_PCM_MAX_CHUNK_BYTES = 4096;
const BROWSER_AUDIO_STATS_INTERVAL = 25;
const UPSTREAM_AUDIO_MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
const TTS_PCM_SAMPLE_RATE = 24000;
const BROWSER_TTS_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

function isProtocolDebugEnabled() {
  return process.env.DOUBAO_PROTOCOL_DEBUG === '1';
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

  const configuredSpeaker = process.env.DOUBAO_REALTIME_SPEAKER_ID;
  const speaker = configuredSpeaker && configuredSpeaker.trim() !== ''
    ? configuredSpeaker.trim()
    : DEFAULT_SPEAKER_ID;

  return {
    url: DOUBAO_URL,
    headers: {
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': DOUBAO_RESOURCE_ID,
      'X-Api-App-Key': DOUBAO_APP_KEY,
      'X-Api-Connect-Id': crypto.randomUUID(),
    },
    speaker,
    apiKey,
  };
}

function buildStartConnectionPayload() {
  return {};
}

function buildStartSessionPayload(speakerId) {
  return {
    dialog: {
      system_role: '请始终使用中文与用户交流。',
      extra: {
        input_mod: 'keep_alive',
        model: DOUBAO_MODEL,
      },
    },
    tts: {
      speaker: speakerId,
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
    buildStartSessionPayload(context.speakerId),
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
      context.sessionStarted = true;
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

  context.speakerId = config.speaker;
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

function handleBrowserConnection(socket, request, contexts) {
  const remoteAddress = request.socket.remoteAddress || 'unknown';
  const context = {
    browserSocket: socket,
    upstreamSocket: undefined,
    sessionId: undefined,
    speakerId: undefined,
    startConnectionSent: false,
    startSessionSent: false,
    connectionStarted: false,
    sessionStarted: false,
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

function startServer() {
  const app = express();
  const server = http.createServer(app);
  const websocketServer = new WebSocketServer({ noServer: true });
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

    if (pathname !== WEBSOCKET_PATH) {
      log(`[Relay] 拒绝 WebSocket 路径：${pathname}`);
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit('connection', websocket, request);
    });
  });

  websocketServer.on('connection', (socket, request) => {
    handleBrowserConnection(socket, request, contexts);
  });

  server.on('error', (error) => {
    log(`[Relay] HTTP Server 错误：${error.message}`);
  });

  server.listen(PORT, HOST, () => {
    log(`[Relay] HTTP: http://${HOST}:${PORT}`);
    log(`[Relay] WebSocket: ws://${HOST}:${PORT}${WEBSOCKET_PATH}`);
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

      for (const client of websocketServer.clients) {
        if (client.readyState === WebSocket.OPEN
          || client.readyState === WebSocket.CONNECTING) {
          client.close(1001, 'relay shutting down');
        }
      }

      await new Promise((resolve) => {
        const forceCloseTimer = setTimeout(() => {
          for (const client of websocketServer.clients) {
            client.terminate();
          }
        }, 2000);

        websocketServer.close((error) => {
          clearTimeout(forceCloseTimer);
          if (error) {
            shutdownFailed = true;
            log(`[Relay] WebSocketServer 关闭错误：${error.message}`);
          } else {
            log('[Relay] WebSocketServer 已关闭');
          }
          resolve();
        });
      });

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
