'use strict';

const express = require('express');
const { PUBLIC_ROLES } = require('./config/public_roles');
const {
  createRequireInternalToken,
} = require('./middleware/require_internal_token');
const { createRequireSession } = require('./middleware/require_session');
const { createAccountRouter } = require('./routes/account_routes');
const { createAuthRouter } = require('./routes/auth_routes');
const { createCallRouter } = require('./routes/call_routes');
const { healthRouter } = require('./routes/health_routes');
const {
  createInternalCallRouter,
} = require('./routes/internal_call_routes');
const { createRoleRouter } = require('./routes/role_routes');
const {
  createAuthService,
  maskChineseMobile,
} = require('./services/auth_service');
const { createAccountService } = require('./services/account_service');
const { createCallService } = require('./services/call_service');
const { createRoleService } = require('./services/role_service');
const { createSessionService } = require('./services/session_service');
const {
  MemoryAccountStore,
} = require('./stores/memory_account_store');
const { MemoryCallStore } = require('./stores/memory_call_store');
const {
  MemorySessionStore,
} = require('./stores/memory_session_store');
const { MemoryUserStore } = require('./stores/memory_user_store');

function createApp(options = {}) {
  const sessionStore = new MemorySessionStore();
  const userStore = new MemoryUserStore();
  const accountStore = new MemoryAccountStore();
  const callStore = new MemoryCallStore();
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
    clock: options.clock,
    idGenerator: options.callIdGenerator,
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
  app.use('/api', healthRouter);
  app.use('/api', createRoleRouter({ roleService }));
  app.use('/api', createAuthRouter({ sessionService, authService }));
  app.use('/api', createAccountRouter({
    requireSession,
    userStore,
    maskChineseMobile,
    accountService,
  }));
  app.use('/api', createCallRouter({
    requireSession,
    userStore,
    accountService,
    callService,
  }));
  app.use((error, request, response, next) => {
    if (error && error.type === 'entity.parse.failed') {
      const isCallRequest = (
        request.method === 'POST'
        && request.path === '/api/calls'
      );
      response.status(400).json({
        error: {
          code: isCallRequest
            ? 'INVALID_CALL_REQUEST'
            : 'INVALID_LOGIN_REQUEST',
          message: isCallRequest
            ? 'A valid roleSlug is required'
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
