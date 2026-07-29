'use strict';

const express = require('express');
const {
  FORTUNE_CATALOG_VERSION,
  FORTUNE_LOTS,
} = require('./config/fortune_lots');
const { PUBLIC_ROLES } = require('./config/public_roles');
const {
  createRequireInternalToken,
} = require('./middleware/require_internal_token');
const { createRequireSession } = require('./middleware/require_session');
const { createAccountRouter } = require('./routes/account_routes');
const { createAuthRouter } = require('./routes/auth_routes');
const { createCallRouter } = require('./routes/call_routes');
const {
  createDevRechargeRouter,
} = require('./routes/dev_recharge_routes');
const { healthRouter } = require('./routes/health_routes');
const {
  createInternalCallRouter,
} = require('./routes/internal_call_routes');
const { createFortuneRouter } = require('./routes/fortune_routes');
const { createRoleRouter } = require('./routes/role_routes');
const {
  createAuthService,
  maskChineseMobile,
} = require('./services/auth_service');
const { createAccountService } = require('./services/account_service');
const { createCallService } = require('./services/call_service');
const { createFortuneService } = require('./services/fortune_service');
const { createRoleService } = require('./services/role_service');
const { createSessionService } = require('./services/session_service');
const {
  MemoryAccountStore,
} = require('./stores/memory_account_store');
const { MemoryCallStore } = require('./stores/memory_call_store');
const {
  MemoryFortuneSessionStore,
} = require('./stores/memory_fortune_session_store');
const {
  MemorySessionStore,
} = require('./stores/memory_session_store');
const { MemoryUserStore } = require('./stores/memory_user_store');

function createApp(options = {}) {
  const sessionStore = new MemorySessionStore();
  const userStore = new MemoryUserStore();
  const accountStore = new MemoryAccountStore();
  const callStore = new MemoryCallStore();
  const fortuneSessionStore = new MemoryFortuneSessionStore();
  const roleService = createRoleService({ roles: PUBLIC_ROLES });
  const sessionService = createSessionService({
    sessionStore,
    clock: options.clock,
    tokenGenerator: options.tokenGenerator,
    idGenerator: options.idGenerator,
  });
  const accountService = createAccountService({
    accountStore,
    clock: options.clock,
    initialBalanceCents: options.initialBalanceCents,
    initialRemainingSeconds: options.initialRemainingSeconds,
  });
  const authService = createAuthService({
    userStore,
    sessionService,
    accountService,
    clock: options.clock,
    idGenerator: options.idGenerator,
    developmentVerificationCode: options.developmentVerificationCode,
  });
  const callService = createCallService({
    callStore,
    roleService,
    accountService,
    clock: options.clock,
    idGenerator: options.callIdGenerator,
  });
  const fortuneService = createFortuneService({
    fortuneSessionStore,
    catalogVersion: options.fortuneCatalogVersion === undefined
      ? FORTUNE_CATALOG_VERSION
      : options.fortuneCatalogVersion,
    lots: options.fortuneLots === undefined
      ? FORTUNE_LOTS
      : options.fortuneLots,
    clock: options.clock,
    idGenerator: options.fortuneSessionIdGenerator,
    randomInt: options.fortuneRandomInt,
    interpretationClient: options.fortuneInterpretationClient,
    ttsClient: options.fortuneTtsClient,
  });
  const requireSession = createRequireSession({ sessionService });
  const app = express();

  app.disable('x-powered-by');
  if (
    options.internalApiToken !== undefined
    && options.internalApiToken !== null
    && options.internalApiToken !== ''
  ) {
    const requireInternalToken = createRequireInternalToken({
      token: options.internalApiToken,
    });
    app.use('/internal', createInternalCallRouter({
      requireInternalToken,
      callService,
    }));
  }
  app.use(express.json({ limit: '16kb' }));
  if (options.mobileUiDirectory !== undefined) {
    if (
      typeof options.mobileUiDirectory !== 'string'
      || options.mobileUiDirectory === ''
    ) {
      throw new TypeError('mobileUiDirectory must be a non-empty string');
    }
    app.use(
      '/ui_prototypes/yuhuang_mobile_v1',
      express.static(options.mobileUiDirectory, {
        dotfiles: 'deny',
        fallthrough: false,
      })
    );
  }
  if (options.fortuneAudioWorkletFile !== undefined) {
    if (
      typeof options.fortuneAudioWorkletFile !== 'string'
      || options.fortuneAudioWorkletFile === ''
    ) {
      throw new TypeError(
        'fortuneAudioWorkletFile must be a non-empty string'
      );
    }
    app.get(
      '/realtime-assets/pcm_capture_processor.js',
      (request, response, next) => {
        response.sendFile(
          options.fortuneAudioWorkletFile,
          { dotfiles: 'deny' },
          (error) => {
            if (error) {
              next(error);
            }
          }
        );
      }
    );
  }
  app.use('/api', healthRouter);
  app.use('/api', createRoleRouter({ roleService }));
  app.use('/api', createAuthRouter({ sessionService, authService }));
  app.use('/api', createFortuneRouter({
    fortuneService,
    sessionService,
  }));
  app.use('/api', createAccountRouter({
    requireSession,
    userStore,
    maskChineseMobile,
    accountService,
  }));
  if (options.enableDevRecharge === true) {
    app.use('/api', createDevRechargeRouter({
      requireSession,
      userStore,
      accountService,
    }));
  }
  app.use('/api', createCallRouter({
    requireSession,
    userStore,
    accountService,
    callService,
  }));
  app.use((error, request, response, next) => {
    if (error && error.type === 'entity.parse.failed') {
      const isFortuneRequest = (
        request.method === 'POST'
        && request.path === '/api/fortune-sessions'
      );
      const isFortuneInterpretationRequest = (
        request.method === 'POST'
        && /^\/api\/fortune-sessions\/[^/]+\/interpretation$/
          .test(request.path)
      );
      const isFortuneInterpretationAudioRequest = (
        request.method === 'POST'
        && /^\/api\/fortune-sessions\/[^/]+\/interpretation-audio$/
          .test(request.path)
      );
      const isCallRequest = (
        request.method === 'POST'
        && request.path === '/api/calls'
      );
      const isDevRechargeRequest = (
        request.method === 'POST'
        && request.path === '/api/dev/recharge'
      );
      response.status(400).json({
        error: {
          code: isCallRequest
            ? 'INVALID_CALL_REQUEST'
            : isFortuneInterpretationAudioRequest
              ? 'INVALID_FORTUNE_INTERPRETATION_AUDIO_REQUEST'
            : isFortuneInterpretationRequest
              ? 'INVALID_FORTUNE_INTERPRETATION_REQUEST'
            : isFortuneRequest
              ? 'INVALID_FORTUNE_REQUEST'
            : isDevRechargeRequest
              ? 'INVALID_RECHARGE_AMOUNT'
              : 'INVALID_LOGIN_REQUEST',
          message: isCallRequest
            ? 'A valid roleSlug is required'
            : isFortuneInterpretationAudioRequest
              ? 'Interpretation audio request body must be empty'
            : isFortuneInterpretationRequest
              ? 'Interpretation request body must be empty'
            : isFortuneRequest
              ? 'A valid fortune request is required'
            : isDevRechargeRequest
              ? 'A valid recharge amount is required'
              : 'Phone and verification code are required',
        },
      });
      return;
    }
    next(error);
  });
  return app;
}

module.exports = {
  createApp,
};
