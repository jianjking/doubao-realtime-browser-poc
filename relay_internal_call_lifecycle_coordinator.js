'use strict';

const DEPENDENCY_ERROR_MESSAGE =
  'dependency must be a valid Relay internal lifecycle dependency';
const CALL_ID_ERROR_MESSAGE =
  'callId must be a non-empty trimmed string when lifecycle is enabled';
const NO_OP_PROMISE = Promise.resolve(null);

function validateDependency(dependency) {
  if (
    dependency === null
    || typeof dependency !== 'object'
    || Array.isArray(dependency)
  ) {
    throw new TypeError(DEPENDENCY_ERROR_MESSAGE);
  }

  let enabled;
  let client;
  try {
    enabled = dependency.enabled;
    client = dependency.client;
  } catch {
    throw new TypeError(DEPENDENCY_ERROR_MESSAGE);
  }

  if (typeof enabled !== 'boolean') {
    throw new TypeError(DEPENDENCY_ERROR_MESSAGE);
  }
  if (!enabled) {
    if (client !== null) {
      throw new TypeError(DEPENDENCY_ERROR_MESSAGE);
    }
    return null;
  }

  if (
    client === null
    || typeof client !== 'object'
    || Array.isArray(client)
  ) {
    throw new TypeError(DEPENDENCY_ERROR_MESSAGE);
  }

  let markConnecting;
  let markActive;
  let markEnded;
  let markFailed;
  try {
    markConnecting = client.markConnecting;
    markActive = client.markActive;
    markEnded = client.markEnded;
    markFailed = client.markFailed;
  } catch {
    throw new TypeError(DEPENDENCY_ERROR_MESSAGE);
  }

  if (
    typeof markConnecting !== 'function'
    || typeof markActive !== 'function'
    || typeof markEnded !== 'function'
    || typeof markFailed !== 'function'
  ) {
    throw new TypeError(DEPENDENCY_ERROR_MESSAGE);
  }

  return {
    client,
    methods: {
      markConnecting,
      markActive,
      markEnded,
      markFailed,
    },
  };
}

function validateCallId(callId) {
  if (
    typeof callId !== 'string'
    || callId === ''
    || callId.trim() === ''
    || callId.trim() !== callId
  ) {
    throw new TypeError(CALL_ID_ERROR_MESSAGE);
  }
}

function createRelayInternalCallLifecycleCoordinator({
  dependency,
  callId = null,
} = {}) {
  const validationResult = validateDependency(dependency);

  if (validationResult === null) {
    return Object.freeze({
      markActive() {
        return NO_OP_PROMISE;
      },
      markConnecting() {
        return NO_OP_PROMISE;
      },
      markEnded() {
        return NO_OP_PROMISE;
      },
      markFailed() {
        return NO_OP_PROMISE;
      },
    });
  }

  validateCallId(callId);

  const {
    client,
    methods,
  } = validationResult;
  let state = 'idle';
  let tail = Promise.resolve();
  let connectingPromise = null;
  let activePromise = null;
  let endedPromise = null;
  let failedPromise = null;

  function enqueue(clientMethod) {
    const requestPromise = tail.then(() => {
      return clientMethod.call(client, callId);
    });
    tail = requestPromise.catch(() => undefined);
    return requestPromise;
  }

  function markActive() {
    if (state === 'active') {
      return activePromise;
    }
    if (state !== 'idle' && state !== 'connecting') {
      return NO_OP_PROMISE;
    }

    state = 'active';
    activePromise = enqueue(methods.markActive);
    return activePromise;
  }

  function markConnecting() {
    if (state === 'connecting') {
      return connectingPromise;
    }
    if (state !== 'idle') {
      return NO_OP_PROMISE;
    }

    state = 'connecting';
    connectingPromise = enqueue(methods.markConnecting);
    return connectingPromise;
  }

  function markEnded() {
    if (state === 'ended') {
      return endedPromise;
    }
    if (state === 'failed') {
      return NO_OP_PROMISE;
    }

    state = 'ended';
    endedPromise = enqueue(methods.markEnded);
    return endedPromise;
  }

  function markFailed() {
    if (state === 'failed') {
      return failedPromise;
    }
    if (state === 'ended') {
      return NO_OP_PROMISE;
    }

    state = 'failed';
    failedPromise = enqueue(methods.markFailed);
    return failedPromise;
  }

  return Object.freeze({
    markActive,
    markConnecting,
    markEnded,
    markFailed,
  });
}

module.exports = {
  createRelayInternalCallLifecycleCoordinator,
};
