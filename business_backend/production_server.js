'use strict';

const { startServer } = require('./server');

function startProductionServer() {
  process.env.NODE_ENV = 'production';
  const server = startServer();
  let shutdownStarted = false;

  function shutdown() {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    server.close((error) => {
      if (error) {
        console.error(
          `business-backend failed to stop: ${error.message}`
        );
        process.exitCode = 1;
      }
    });
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

function runProductionServer() {
  try {
    return startProductionServer();
  } catch (error) {
    console.error(`business-backend failed to start: ${error.message}`);
    process.exitCode = 1;
    return null;
  }
}

if (require.main === module) {
  runProductionServer();
}

module.exports = {
  runProductionServer,
  startProductionServer,
};
