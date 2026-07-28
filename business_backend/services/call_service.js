'use strict';

const crypto = require('node:crypto');

const ALLOWED_SOURCE_STATUSES = Object.freeze({
  connecting: Object.freeze(['pending']),
  active: Object.freeze(['connecting']),
  ended: Object.freeze(['active']),
  failed: Object.freeze(['pending', 'connecting', 'active']),
});

function createPublicError(statusCode, code, publicMessage) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.code = code;
  error.publicMessage = publicMessage;
  return error;
}

function createCallService({
  callStore,
  roleService,
  accountService = null,
  clock = Date.now,
  idGenerator = () => crypto.randomUUID(),
} = {}) {
  if (!callStore || !roleService) {
    throw new TypeError('callStore and roleService are required');
  }
  if (
    accountService !== null
    && (
      typeof accountService !== 'object'
      || typeof accountService.debitBalanceCentsForUser !== 'function'
    )
  ) {
    throw new TypeError(
      'accountService must provide debitBalanceCentsForUser'
    );
  }
  if (typeof clock !== 'function') {
    throw new TypeError('clock must be a function');
  }
  if (typeof idGenerator !== 'function') {
    throw new TypeError('idGenerator must be a function');
  }

  function validateUserId(userId) {
    if (typeof userId !== 'string' || userId === '') {
      throw new TypeError('userId must be a non-empty string');
    }
  }

  function validateInternalCallId(callId) {
    if (
      typeof callId !== 'string'
      || callId === ''
      || callId.trim() === ''
      || callId.trim() !== callId
    ) {
      throw new TypeError('callId must be a non-empty string');
    }
  }

  function getDurationMs(call) {
    if (call.status !== 'ended' && call.status !== 'failed') {
      return null;
    }
    if (call.startedAt === null) {
      return 0;
    }

    const elapsedMs = Date.parse(call.endedAt)
      - Date.parse(call.startedAt);
    return Number.isFinite(elapsedMs)
      ? Math.max(0, elapsedMs)
      : 0;
  }

  function buildPublicCall(call) {
    const role = roleService.findPublicRoleBySlug(call.roleSlug);
    if (!role) {
      throw new Error('Stored call references an unknown role');
    }

    const publicCall = {
      id: call.id,
      role: {
        slug: role.slug,
        displayName: role.displayName,
      },
      status: call.status,
      createdAt: call.createdAt,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
    };
    const durationMs = getDurationMs(call);
    Object.defineProperty(publicCall, 'durationMs', {
      configurable: true,
      enumerable: durationMs !== null,
      value: durationMs,
      writable: true,
    });
    return publicCall;
  }

  function createPendingCall({ userId, roleSlug } = {}) {
    validateUserId(userId);
    if (
      typeof roleSlug !== 'string'
      || roleSlug === ''
      || roleSlug.trim() !== roleSlug
    ) {
      throw createPublicError(
        400,
        'INVALID_CALL_REQUEST',
        'A valid roleSlug is required'
      );
    }

    const role = roleService.findPublicRoleBySlug(roleSlug);
    if (!role) {
      throw createPublicError(
        404,
        'ROLE_NOT_FOUND',
        'Requested role was not found'
      );
    }
    if (!role.available) {
      throw createPublicError(
        409,
        'ROLE_UNAVAILABLE',
        'Requested role is currently unavailable'
      );
    }

    const createdAt = new Date(clock()).toISOString();
    const call = {
      id: idGenerator(),
      userId,
      roleSlug,
      billingUnitMs: role.billingUnitMs,
      pricePerBillingUnitFen: role.pricePerBillingUnitFen,
      chargeFen: null,
      status: 'pending',
      createdAt,
      startedAt: null,
      endedAt: null,
    };
    callStore.save(call);

    return buildPublicCall(call);
  }

  function getPublicCallForUser({ userId, callId } = {}) {
    validateUserId(userId);
    if (
      typeof callId !== 'string'
      || callId === ''
      || callId.trim() === ''
      || callId.trim() !== callId
    ) {
      throw createPublicError(
        400,
        'INVALID_CALL_ID',
        'A valid callId is required'
      );
    }

    const call = callStore.findById(callId);
    if (!call || call.userId !== userId) {
      throw createPublicError(
        404,
        'CALL_NOT_FOUND',
        'Requested call was not found'
      );
    }

    return buildPublicCall(call);
  }

  function transitionCall(callId, targetStatus) {
    validateInternalCallId(callId);
    const call = callStore.findById(callId);
    if (!call) {
      throw createPublicError(
        404,
        'CALL_NOT_FOUND',
        'Requested call was not found'
      );
    }
    if (call.status === targetStatus) {
      return buildPublicCall(call);
    }
    if (
      !ALLOWED_SOURCE_STATUSES[targetStatus].includes(call.status)
    ) {
      throw createPublicError(
        409,
        'INVALID_CALL_TRANSITION',
        'Call state transition is not allowed'
      );
    }

    const nextCall = {
      ...call,
      status: targetStatus,
    };
    if (targetStatus === 'connecting') {
      nextCall.startedAt = null;
      nextCall.endedAt = null;
    } else if (targetStatus === 'active') {
      nextCall.startedAt = new Date(clock()).toISOString();
      nextCall.endedAt = null;
    } else {
      nextCall.endedAt = new Date(clock()).toISOString();

      if (targetStatus === 'failed') {
        nextCall.chargeFen = 0;
      } else {
        const durationMs = getDurationMs(nextCall);
        const billableUnits = Math.ceil(
          durationMs / nextCall.billingUnitMs
        );
        const chargeFen = billableUnits
          * nextCall.pricePerBillingUnitFen;

        if (!Number.isSafeInteger(chargeFen)) {
          throw new Error(
            'Call charge exceeds safe integer range'
          );
        }

        nextCall.chargeFen = chargeFen;

        if (accountService !== null) {
          accountService.debitBalanceCentsForUser(
            call.userId,
            nextCall.chargeFen
          );
        }
      }
    }

    callStore.replace(nextCall);
    return buildPublicCall(nextCall);
  }

  function markCallConnecting({ callId } = {}) {
    return transitionCall(callId, 'connecting');
  }

  function markCallActive({ callId } = {}) {
    return transitionCall(callId, 'active');
  }

  function markCallEnded({ callId } = {}) {
    return transitionCall(callId, 'ended');
  }

  function markCallFailed({ callId } = {}) {
    return transitionCall(callId, 'failed');
  }

  return {
    createPendingCall,
    getPublicCallForUser,
    markCallConnecting,
    markCallActive,
    markCallEnded,
    markCallFailed,
  };
}

module.exports = {
  createCallService,
};
