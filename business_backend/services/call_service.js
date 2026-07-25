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

  function createPendingCall({ userId, roleSlug } = {}) {
    if (typeof userId !== 'string' || userId === '') {
      throw createPublicError(
        400,
        'INVALID_CALL_REQUEST',
        'A valid roleSlug is required'
      );
    }
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

  return {
    createPendingCall,
  };
}

module.exports = {
  createCallService,
};
