'use strict';

const express = require('express');
const { healthRouter } = require('./routes/health_routes');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', healthRouter);
  return app;
}

module.exports = {
  createApp,
};
