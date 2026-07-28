'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { PUBLIC_ROLES } = require('../config/public_roles');
const { createCallService } = require('../services/call_service');
const { createRoleService } = require('../services/role_service');
const { MemoryCallStore } = require('../stores/memory_call_store');

const CREATED_AT = '2026-07-25T00:00:00.000Z';
const ACTIVE_AT = '2026-07-25T00:01:00.000Z';
const ENDED_AT = '2026-07-25T00:02:00.000Z';

function createCall(overrides = {}) {
  return {
    id: 'call-state-1',
    userId: 'user-state-owner',
    roleSlug: 'yuhuang',
    billingUnitMs: 6000,
    pricePerBillingUnitFen: 10,
    chargeFen: null,
    status: 'pending',
    createdAt: CREATED_AT,
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

function createService({
  callStore = new MemoryCallStore(),
  clock = () => Date.parse(CREATED_AT),
  idGenerator = () => 'call-state-1',
} = {}) {
  return {
    callStore,
    callService: createCallService({
      callStore,
      roleService: createRoleService({ roles: PUBLIC_ROLES }),
      clock,
      idGenerator,
    }),
  };
}

function createPendingCall(callService, overrides = {}) {
  return callService.createPendingCall({
    userId: 'user-state-owner',
    roleSlug: 'yuhuang',
    ...overrides,
  });
}

function readPublicError(error) {
  return {
    statusCode: error.statusCode,
    code: error.code,
    publicMessage: error.publicMessage,
  };
}

function assertPublicError(action, expected) {
  assert.throws(action, (error) => {
    assert.deepEqual(readPublicError(error), expected);
    return true;
  });
}

test('memory call store supports valid lifecycle shapes', () => {
  const callStore = new MemoryCallStore();
  const pendingCall = createCall();
  callStore.save(pendingCall);

  const connectingCall = createCall({
    status: 'connecting',
  });
  callStore.replace(connectingCall);
  assert.deepEqual(callStore.findById(pendingCall.id), connectingCall);

  const activeCall = createCall({
    status: 'active',
    startedAt: ACTIVE_AT,
  });
  callStore.replace(activeCall);
  assert.deepEqual(callStore.findById(pendingCall.id), activeCall);

  const endedCall = createCall({
    status: 'ended',
    startedAt: ACTIVE_AT,
    endedAt: ENDED_AT,
    chargeFen: 100,
  });
  callStore.replace(endedCall);
  const foundCall = callStore.findById(pendingCall.id);
  assert.deepEqual(foundCall, endedCall);
  assert.throws(() => {
    callStore.replace({
      ...endedCall,
      chargeFen: 90,
    });
  }, /Terminal call charge cannot be changed/);
  foundCall.status = 'changed outside store';
  assert.deepEqual(callStore.findById(pendingCall.id), endedCall);

  assert.throws(() => {
    callStore.save(createCall({
      id: 'non-pending-save',
      status: 'active',
      startedAt: ACTIVE_AT,
    }));
  }, /status must be pending/);
});

test('memory call store rejects invalid state and timestamp shapes', () => {
  const callStore = new MemoryCallStore();
  callStore.save(createCall());

  const invalidCalls = [
    [createCall({ status: 'unknown' }), /status/],
    [createCall({ billingUnitMs: 0 }), /billingUnitMs/],
    [createCall({ billingUnitMs: 1.5 }), /billingUnitMs/],
    [
      createCall({ pricePerBillingUnitFen: 0 }),
      /pricePerBillingUnitFen/,
    ],
    [
      createCall({ pricePerBillingUnitFen: 1.5 }),
      /pricePerBillingUnitFen/,
    ],
    [createCall({ chargeFen: 0 }), /chargeFen/],
    [
      createCall({
        status: 'active',
        startedAt: ACTIVE_AT,
        chargeFen: 0,
      }),
      /chargeFen/,
    ],
    [
      createCall({
        status: 'ended',
        startedAt: ACTIVE_AT,
        endedAt: ENDED_AT,
        chargeFen: -1,
      }),
      /chargeFen/,
    ],
    [
      createCall({
        status: 'ended',
        startedAt: ACTIVE_AT,
        endedAt: ENDED_AT,
        chargeFen: 1.5,
      }),
      /chargeFen/,
    ],
    [
      createCall({
        status: 'failed',
        endedAt: ENDED_AT,
        chargeFen: 1,
      }),
      /chargeFen/,
    ],
    [createCall({ startedAt: ACTIVE_AT }), /startedAt/],
    [
      createCall({
        status: 'connecting',
        startedAt: ACTIVE_AT,
      }),
      /startedAt/,
    ],
    [createCall({ status: 'active' }), /startedAt/],
    [
      createCall({
        status: 'active',
        startedAt: ACTIVE_AT,
        endedAt: ENDED_AT,
      }),
      /endedAt/,
    ],
    [
      createCall({
        status: 'ended',
        startedAt: ACTIVE_AT,
        chargeFen: 0,
      }),
      /endedAt/,
    ],
    [
      createCall({
        status: 'ended',
        endedAt: ENDED_AT,
        chargeFen: 0,
      }),
      /startedAt/,
    ],
    [
      createCall({
        status: 'failed',
        chargeFen: 0,
      }),
      /endedAt/,
    ],
  ];

  for (const [call, expectedMessage] of invalidCalls) {
    assert.throws(() => {
      callStore.replace(call);
    }, expectedMessage);
  }
  assert.deepEqual(callStore.findById('call-state-1'), createCall());
});

test('memory call store replace protects identity fields', () => {
  const callStore = new MemoryCallStore();
  const originalCall = createCall();
  callStore.save(originalCall);

  assert.throws(() => {
    callStore.replace(createCall({
      id: 'missing-call',
      status: 'connecting',
    }));
  }, /Call does not exist/);

  for (const changedIdentity of [
    { userId: 'another-user' },
    { roleSlug: 'sunwukong' },
    { billingUnitMs: 3000 },
    { pricePerBillingUnitFen: 99 },
    { createdAt: '2026-07-24T00:00:00.000Z' },
  ]) {
    assert.throws(() => {
      callStore.replace(createCall({
        ...changedIdentity,
        status: 'connecting',
      }));
    }, /Call identity fields cannot be changed/);
  }

  assert.throws(() => {
    callStore.replace(createCall({
      id: 'changed-call-id',
      status: 'connecting',
    }));
  }, /Call does not exist/);
  assert.deepEqual(callStore.findById(originalCall.id), originalCall);
});

test('pending calls transition to connecting', () => {
  const { callStore, callService } = createService();
  const createdCall = createPendingCall(callService);
  const connectingCall = callService.markCallConnecting({
    callId: createdCall.id,
  });

  assert.deepEqual(connectingCall, {
    ...createdCall,
    status: 'connecting',
  });
  assert.equal(Object.hasOwn(connectingCall, 'userId'), false);
  assert.deepEqual(callService.getPublicCallForUser({
    userId: 'user-state-owner',
    callId: createdCall.id,
  }), connectingCall);
  assert.deepEqual(callStore.findById(createdCall.id), {
    id: createdCall.id,
    userId: 'user-state-owner',
    roleSlug: 'yuhuang',
    billingUnitMs: 6000,
    pricePerBillingUnitFen: 10,
    chargeFen: null,
    status: 'connecting',
    createdAt: CREATED_AT,
    startedAt: null,
    endedAt: null,
  });
});

test('connecting calls transition to active with a server timestamp', () => {
  const clockValues = [
    Date.parse(CREATED_AT),
    Date.parse(ACTIVE_AT),
  ];
  const { callService } = createService({
    clock: () => clockValues.shift(),
  });
  const createdCall = createPendingCall(callService);
  callService.markCallConnecting({ callId: createdCall.id });
  const activeCall = callService.markCallActive({
    callId: createdCall.id,
  });

  assert.deepEqual(activeCall, {
    ...createdCall,
    status: 'active',
    startedAt: ACTIVE_AT,
  });
  assert.deepEqual(callService.getPublicCallForUser({
    userId: 'user-state-owner',
    callId: createdCall.id,
  }), activeCall);
});

test('active calls transition to ended while preserving startedAt', () => {
  const clockValues = [
    Date.parse(CREATED_AT),
    Date.parse(ACTIVE_AT),
    Date.parse(ENDED_AT),
  ];
  const { callService } = createService({
    clock: () => clockValues.shift(),
  });
  const createdCall = createPendingCall(callService);
  callService.markCallConnecting({ callId: createdCall.id });
  const activeCall = callService.markCallActive({
    callId: createdCall.id,
  });
  const endedCall = callService.markCallEnded({
    callId: createdCall.id,
  });

  assert.deepEqual(endedCall, {
    ...activeCall,
    status: 'ended',
    endedAt: ENDED_AT,
    durationMs: 60000,
  });
  assert.equal(endedCall.startedAt, ACTIVE_AT);
  assert.equal(Object.hasOwn(endedCall, 'userId'), false);
  assert.deepEqual(callService.getPublicCallForUser({
    userId: 'user-state-owner',
    callId: createdCall.id,
  }), endedCall);
});

test('pending, connecting, and active calls can transition to failed', () => {
  const clockValues = [
    '2026-07-25T01:00:00.000Z',
    '2026-07-25T01:01:00.000Z',
    '2026-07-25T02:00:00.000Z',
    '2026-07-25T02:01:00.000Z',
    '2026-07-25T03:00:00.000Z',
    '2026-07-25T03:01:00.000Z',
    '2026-07-25T03:02:00.000Z',
  ].map(Date.parse);
  const callIds = [
    'call-fail-pending',
    'call-fail-connecting',
    'call-fail-active',
  ];
  const { callService } = createService({
    clock: () => clockValues.shift(),
    idGenerator: () => callIds.shift(),
  });

  const pendingCall = createPendingCall(callService);
  const pendingFailed = callService.markCallFailed({
    callId: pendingCall.id,
  });
  assert.equal(pendingFailed.status, 'failed');
  assert.equal(pendingFailed.startedAt, null);
  assert.equal(
    pendingFailed.endedAt,
    '2026-07-25T01:01:00.000Z'
  );
  assert.deepEqual(callService.getPublicCallForUser({
    userId: 'user-state-owner',
    callId: pendingCall.id,
  }), pendingFailed);

  const connectingCall = createPendingCall(callService);
  callService.markCallConnecting({ callId: connectingCall.id });
  const connectingFailed = callService.markCallFailed({
    callId: connectingCall.id,
  });
  assert.equal(connectingFailed.status, 'failed');
  assert.equal(connectingFailed.startedAt, null);
  assert.equal(
    connectingFailed.endedAt,
    '2026-07-25T02:01:00.000Z'
  );
  assert.deepEqual(callService.getPublicCallForUser({
    userId: 'user-state-owner',
    callId: connectingCall.id,
  }), connectingFailed);

  const activeSource = createPendingCall(callService);
  callService.markCallConnecting({ callId: activeSource.id });
  const activeCall = callService.markCallActive({
    callId: activeSource.id,
  });
  const activeFailed = callService.markCallFailed({
    callId: activeSource.id,
  });
  assert.equal(activeFailed.status, 'failed');
  assert.equal(activeFailed.startedAt, activeCall.startedAt);
  assert.equal(
    activeFailed.endedAt,
    '2026-07-25T03:02:00.000Z'
  );
  assert.deepEqual(callService.getPublicCallForUser({
    userId: 'user-state-owner',
    callId: activeSource.id,
  }), activeFailed);
});

test('repeated transitions to the same status are idempotent', () => {
  let clockCalls = 0;
  const baseTime = Date.parse('2026-07-25T04:00:00.000Z');
  const callIds = [
    'call-idempotent-connecting',
    'call-idempotent-active',
    'call-idempotent-ended',
    'call-idempotent-failed',
  ];
  const { callService } = createService({
    clock: () => {
      const currentTime = baseTime + (clockCalls * 1000);
      clockCalls += 1;
      return currentTime;
    },
    idGenerator: () => callIds.shift(),
  });
  const calls = Array.from(
    { length: 4 },
    () => createPendingCall(callService)
  );
  assert.equal(clockCalls, 4);

  const connectingFirst = callService.markCallConnecting({
    callId: calls[0].id,
  });
  const connectingClockCalls = clockCalls;
  const connectingSecond = callService.markCallConnecting({
    callId: calls[0].id,
  });
  assert.deepEqual(connectingSecond, connectingFirst);
  assert.equal(clockCalls, connectingClockCalls);

  callService.markCallConnecting({ callId: calls[1].id });
  const activeFirst = callService.markCallActive({
    callId: calls[1].id,
  });
  const activeClockCalls = clockCalls;
  const activeSecond = callService.markCallActive({
    callId: calls[1].id,
  });
  assert.deepEqual(activeSecond, activeFirst);
  assert.equal(activeSecond.startedAt, activeFirst.startedAt);
  assert.equal(clockCalls, activeClockCalls);

  callService.markCallConnecting({ callId: calls[2].id });
  callService.markCallActive({ callId: calls[2].id });
  const endedFirst = callService.markCallEnded({
    callId: calls[2].id,
  });
  const endedClockCalls = clockCalls;
  const endedSecond = callService.markCallEnded({
    callId: calls[2].id,
  });
  assert.deepEqual(endedSecond, endedFirst);
  assert.equal(endedSecond.endedAt, endedFirst.endedAt);
  assert.equal(clockCalls, endedClockCalls);

  const failedFirst = callService.markCallFailed({
    callId: calls[3].id,
  });
  const failedClockCalls = clockCalls;
  const failedSecond = callService.markCallFailed({
    callId: calls[3].id,
  });
  assert.deepEqual(failedSecond, failedFirst);
  assert.equal(failedSecond.endedAt, failedFirst.endedAt);
  assert.equal(clockCalls, failedClockCalls);
});

test('duration starts at active and is fixed on ended', () => {
  const activeAt = '2026-07-25T05:00:00.000Z';
  const endedAt = '2026-07-25T05:00:12.500Z';
  const clockValues = [
    Date.parse(CREATED_AT),
    Date.parse(activeAt),
    Date.parse(endedAt),
  ];
  const { callStore, callService } = createService({
    clock: () => clockValues.shift(),
    idGenerator: () => 'call-duration-ended',
  });

  const pendingCall = createPendingCall(callService);
  assert.equal(pendingCall.durationMs, null);
  assert.equal(Object.hasOwn(pendingCall, 'durationMs'), true);

  const connectingCall = callService.markCallConnecting({
    callId: pendingCall.id,
  });
  assert.equal(connectingCall.durationMs, null);

  const activeCall = callService.markCallActive({
    callId: pendingCall.id,
  });
  assert.equal(activeCall.startedAt, activeAt);
  assert.equal(activeCall.durationMs, null);

  const endedCall = callService.markCallEnded({
    callId: pendingCall.id,
  });
  assert.equal(endedCall.endedAt, endedAt);
  assert.equal(endedCall.durationMs, 12500);
  assert.equal(
    Object.hasOwn(endedCall, 'chargeFen'),
    false
  );
  assert.equal(
    callStore.findById(pendingCall.id).chargeFen,
    30
  );
});

test('failed duration covers active and pre-active sources', () => {
  const activeAt = '2026-07-25T06:00:00.000Z';
  const failedAt = '2026-07-25T06:00:03.200Z';
  const activeClockValues = [
    Date.parse(CREATED_AT),
    Date.parse(activeAt),
    Date.parse(failedAt),
  ];
  const {
    callStore: activeCallStore,
    callService: activeService,
  } = createService({
    clock: () => activeClockValues.shift(),
    idGenerator: () => 'call-duration-active-failed',
  });
  const activeSource = createPendingCall(activeService);
  activeService.markCallConnecting({ callId: activeSource.id });
  const activeCall = activeService.markCallActive({
    callId: activeSource.id,
  });
  const activeFailed = activeService.markCallFailed({
    callId: activeSource.id,
  });
  assert.equal(activeFailed.startedAt, activeCall.startedAt);
  assert.equal(activeFailed.endedAt, failedAt);
  assert.equal(activeFailed.durationMs, 3200);
  assert.equal(
    Object.hasOwn(activeFailed, 'chargeFen'),
    false
  );
  assert.equal(
    activeCallStore.findById(activeSource.id).chargeFen,
    0
  );

  const pendingClockValues = [
    Date.parse(CREATED_AT),
    Date.parse('2026-07-25T06:01:00.000Z'),
  ];
  const {
    callStore: pendingCallStore,
    callService: pendingService,
  } = createService({
    clock: () => pendingClockValues.shift(),
    idGenerator: () => 'call-duration-pending-failed',
  });
  const pendingSource = createPendingCall(pendingService);
  const pendingFailed = pendingService.markCallFailed({
    callId: pendingSource.id,
  });
  assert.equal(pendingFailed.startedAt, null);
  assert.equal(pendingFailed.durationMs, 0);
  assert.equal(
    pendingCallStore.findById(pendingSource.id).chargeFen,
    0
  );
});

test('terminal duration is idempotent and opposite terminal is rejected', () => {
  const invalidTransitionError = {
    statusCode: 409,
    code: 'INVALID_CALL_TRANSITION',
    publicMessage: 'Call state transition is not allowed',
  };
  let endedClockCalls = 0;
  const endedClockValues = [
    Date.parse(CREATED_AT),
    Date.parse('2026-07-25T07:00:00.000Z'),
    Date.parse('2026-07-25T07:00:04.000Z'),
  ];
  const endedService = createService({
    clock: () => {
      endedClockCalls += 1;
      return endedClockValues.shift();
    },
    idGenerator: () => 'call-duration-idempotent-ended',
  }).callService;
  const endedSource = createPendingCall(endedService);
  endedService.markCallConnecting({ callId: endedSource.id });
  endedService.markCallActive({ callId: endedSource.id });
  const endedFirst = endedService.markCallEnded({
    callId: endedSource.id,
  });
  const endedClockCallsAfterFirst = endedClockCalls;
  const endedSecond = endedService.markCallEnded({
    callId: endedSource.id,
  });
  assert.equal(endedSecond.endedAt, endedFirst.endedAt);
  assert.equal(endedSecond.durationMs, endedFirst.durationMs);
  assert.equal(endedClockCalls, endedClockCallsAfterFirst);
  assertPublicError(() => {
    endedService.markCallFailed({ callId: endedSource.id });
  }, invalidTransitionError);
  const endedAfterRejected = endedService.getPublicCallForUser({
    userId: 'user-state-owner',
    callId: endedSource.id,
  });
  assert.equal(endedAfterRejected.endedAt, endedFirst.endedAt);
  assert.equal(endedAfterRejected.durationMs, endedFirst.durationMs);

  let failedClockCalls = 0;
  const failedClockValues = [
    Date.parse(CREATED_AT),
    Date.parse('2026-07-25T08:00:00.000Z'),
  ];
  const failedService = createService({
    clock: () => {
      failedClockCalls += 1;
      return failedClockValues.shift();
    },
    idGenerator: () => 'call-duration-idempotent-failed',
  }).callService;
  const failedSource = createPendingCall(failedService);
  const failedFirst = failedService.markCallFailed({
    callId: failedSource.id,
  });
  const failedClockCallsAfterFirst = failedClockCalls;
  const failedSecond = failedService.markCallFailed({
    callId: failedSource.id,
  });
  assert.equal(failedSecond.endedAt, failedFirst.endedAt);
  assert.equal(failedSecond.durationMs, failedFirst.durationMs);
  assert.equal(failedClockCalls, failedClockCallsAfterFirst);
  assertPublicError(() => {
    failedService.markCallEnded({ callId: failedSource.id });
  }, invalidTransitionError);
  const failedAfterRejected = failedService.getPublicCallForUser({
    userId: 'user-state-owner',
    callId: failedSource.id,
  });
  assert.equal(failedAfterRejected.endedAt, failedFirst.endedAt);
  assert.equal(failedAfterRejected.durationMs, failedFirst.durationMs);
});

test('duration never becomes negative when the clock moves backward', () => {
  const activeAt = '2026-07-25T09:00:01.000Z';
  const endedAt = '2026-07-25T09:00:00.000Z';
  const clockValues = [
    Date.parse(CREATED_AT),
    Date.parse(activeAt),
    Date.parse(endedAt),
  ];
  const { callService } = createService({
    clock: () => clockValues.shift(),
    idGenerator: () => 'call-duration-clock-reversal',
  });
  const createdCall = createPendingCall(callService);
  callService.markCallConnecting({ callId: createdCall.id });
  callService.markCallActive({ callId: createdCall.id });
  const endedCall = callService.markCallEnded({
    callId: createdCall.id,
  });

  assert.equal(endedCall.startedAt, activeAt);
  assert.equal(endedCall.endedAt, endedAt);
  assert.equal(endedCall.durationMs, 0);
});

test('invalid transitions and call IDs fail without changing calls', () => {
  let callNumber = 0;
  const { callStore, callService } = createService({
    idGenerator: () => {
      callNumber += 1;
      return `call-invalid-${callNumber}`;
    },
  });
  const invalidTransitionError = {
    statusCode: 409,
    code: 'INVALID_CALL_TRANSITION',
    publicMessage: 'Call state transition is not allowed',
  };

  function verifyInvalidTransition(callId, transition) {
    const beforeCall = callStore.findById(callId);
    assertPublicError(transition, invalidTransitionError);
    assert.deepEqual(callStore.findById(callId), beforeCall);
  }

  const pendingToActive = createPendingCall(callService);
  verifyInvalidTransition(pendingToActive.id, () => {
    callService.markCallActive({ callId: pendingToActive.id });
  });

  const pendingToEnded = createPendingCall(callService);
  verifyInvalidTransition(pendingToEnded.id, () => {
    callService.markCallEnded({ callId: pendingToEnded.id });
  });

  const connectingToEnded = createPendingCall(callService);
  callService.markCallConnecting({ callId: connectingToEnded.id });
  verifyInvalidTransition(connectingToEnded.id, () => {
    callService.markCallEnded({ callId: connectingToEnded.id });
  });

  const activeToConnecting = createPendingCall(callService);
  callService.markCallConnecting({ callId: activeToConnecting.id });
  callService.markCallActive({ callId: activeToConnecting.id });
  verifyInvalidTransition(activeToConnecting.id, () => {
    callService.markCallConnecting({ callId: activeToConnecting.id });
  });

  const endedToFailed = createPendingCall(callService);
  callService.markCallConnecting({ callId: endedToFailed.id });
  callService.markCallActive({ callId: endedToFailed.id });
  callService.markCallEnded({ callId: endedToFailed.id });
  verifyInvalidTransition(endedToFailed.id, () => {
    callService.markCallFailed({ callId: endedToFailed.id });
  });

  const failedToActive = createPendingCall(callService);
  callService.markCallFailed({ callId: failedToActive.id });
  verifyInvalidTransition(failedToActive.id, () => {
    callService.markCallActive({ callId: failedToActive.id });
  });
  verifyInvalidTransition(failedToActive.id, () => {
    callService.markCallEnded({ callId: failedToActive.id });
  });
  verifyInvalidTransition(failedToActive.id, () => {
    callService.markCallConnecting({ callId: failedToActive.id });
  });

  const transitionMethods = [
    callService.markCallConnecting,
    callService.markCallActive,
    callService.markCallEnded,
    callService.markCallFailed,
  ];
  for (const transition of transitionMethods) {
    for (const callId of [null, '', '   ', ' call-1', 'call-1 ']) {
      assert.throws(() => {
        transition({ callId });
      }, {
        name: 'TypeError',
        message: 'callId must be a non-empty string',
      });
    }
    assertPublicError(() => {
      transition({ callId: 'missing-call' });
    }, {
      statusCode: 404,
      code: 'CALL_NOT_FOUND',
      publicMessage: 'Requested call was not found',
    });
  }
});
