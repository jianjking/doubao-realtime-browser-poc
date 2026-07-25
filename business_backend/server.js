'use strict';

const { createApp } = require('./app');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3002;

function parsePort(rawPort) {
  if (typeof rawPort !== 'string' || !/^\d+$/.test(rawPort)) {
    throw new Error(
      'BUSINESS_BACKEND_PORT must be an integer between 1 and 65535'
    );
  }

  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      'BUSINESS_BACKEND_PORT must be an integer between 1 and 65535'
    );
  }
  return port;
}

function startServer() {
  const configuredHost = process.env.BUSINESS_BACKEND_HOST;
  const host = typeof configuredHost === 'string'
    && configuredHost.trim() !== ''
    ? configuredHost.trim()
    : DEFAULT_HOST;
  const rawPort = process.env.BUSINESS_BACKEND_PORT === undefined
    ? String(DEFAULT_PORT)
    : process.env.BUSINESS_BACKEND_PORT;
  const port = parsePort(rawPort);
  const app = createApp();

  const server = app.listen(port, host, () => {
    console.log(`business-backend listening on ${host}:${port}`);
  });
  server.on('error', (error) => {
    console.error(`business-backend failed to start: ${error.message}`);
    process.exitCode = 1;
  });
  return server;
}

if (require.main === module) {
  try {
    startServer();
  } catch (error) {
    console.error(`business-backend failed to start: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parsePort,
  startServer,
};
