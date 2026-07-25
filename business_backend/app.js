'use strict';

const express = require('express');
const { createRequireSession } = require('./middleware/require_session');
const { createAccountRouter } = require('./routes/account_routes');
const { createAuthRouter } = require('./routes/auth_routes');
const { healthRouter } = require('./routes/health_routes');
const {
  createAuthService,
  maskChineseMobile,
} = require('./services/auth_service');
const { createSessionService } = require('./services/session_service');
const {
  MemorySessionStore,
} = require('./stores/memory_session_store');
const { MemoryUserStore } = require('./stores/memory_user_store');

function createApp(options = {}) {
  const sessionStore = new MemorySessionStore();
  const userStore = new MemoryUserStore();
  const sessionService = createSessionService({
    sessionStore,
    clock: options.clock,
    tokenGenerator: options.tokenGenerator,
    idGenerator: options.idGenerator,
  });
  const authService = createAuthService({
    userStore,
    sessionService,
    clock: options.clock,
    idGenerator: options.idGenerator,
    developmentVerificationCode: options.developmentVerificationCode,
  });
  const requireSession = createRequireSession({ sessionService });
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', healthRouter);
  app.use('/api', createAuthRouter({ sessionService, authService }));
  app.use('/api', createAccountRouter({
    requireSession,
    userStore,
    maskChineseMobile,
  }));
  app.use((error, _request, response, next) => {
    if (error && error.type === 'entity.parse.failed') {
      response.status(400).json({
        error: {
          code: 'INVALID_LOGIN_REQUEST',
          message: 'Phone and verification code are required',
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
