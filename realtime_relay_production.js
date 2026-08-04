'use strict';

if (process.env.NODE_ENV === undefined) {
  process.env.NODE_ENV = 'production';
}

const {
  validateProductionRelayConfig,
} = require('./realtime_relay_production_config');

function sanitizeStartupError(error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return String(message)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 300);
}

async function main() {
  const config = validateProductionRelayConfig(process.env);
  const { startServer } = require('./server_doubao_realtime');
  const relay = startServer({
    env: process.env,
    host: config.host,
    lifecycleEnv: process.env,
    port: config.port,
  });
  try {
    await relay.ready;
  } catch (error) {
    try {
      await relay.stop();
    } catch {
      // Preserve the startup failure as the reported cause.
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`[Relay Production] ${sanitizeStartupError(error)}`);
  process.exitCode = 1;
});
