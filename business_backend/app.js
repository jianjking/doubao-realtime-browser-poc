'use strict';

const express = require('express');
const { createRequireSession } = require('./middleware/require_session');
const { createAccountRouter } = require('./routes/account_routes');
const { createAuthRouter } = require('./routes/auth_routes');
const { healthRouter } = require('./routes/health_routes');
const { createSessionService } = require('./services/session_service');
const {
  MemorySessionStore,
} = require('./stores/memory_session_store');

function createApp(options = {}) {
  const sessionStore = new MemorySessionStore();
  const sessionService = createSessionService({
    sessionStore,
    clock: options.clock,
    tokenGenerator: options.tokenGenerator,
    idGenerator: options.idGenerator,
  });
  const requireSession = createRequireSession({ sessionService });
  const app = express();

  app.disable('x-powered-by');
  app.use('/api', healthRouter);
  app.use('/api', createAuthRouter({ sessionService }));
  app.use('/api', createAccountRouter({ requireSession }));
  return app;
}

module.exports = {
  createApp,
};
