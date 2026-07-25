'use strict';

const crypto = require('node:crypto');

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
  clock = Date.now,
  idGenerator = () => crypto.randomUUID(),
} = {}) {
  if (!callStore || !roleService) {
    throw new TypeError('callStore and roleService are required');
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

  function buildPublicCall(call) {
    const role = roleService.findPublicRoleBySlug(call.roleSlug);
    if (!role) {
      throw new Error('Stored call references an unknown role');
    }

    return {
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

  return {
    createPendingCall,
    getPublicCallForUser,
  };
}

module.exports = {
  createCallService,
};
