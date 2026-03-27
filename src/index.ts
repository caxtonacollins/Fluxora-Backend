import { createApp } from './app.js';
import { initializeConfig } from './config/env.js';

const config = initializeConfig();
const app = createApp({ config });
const port = config.port;

const server = app.listen(port, () => {
  console.log(`Fluxora API listening on http://localhost:${port}`);
});

function shutdown(signal: NodeJS.Signals) {
  console.warn(`${signal} received, shutting down gracefully`);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
