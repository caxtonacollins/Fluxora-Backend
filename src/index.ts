/**
 * Fluxora Backend — server entry point.
 *
 * Starts the HTTP server and wires up graceful shutdown for SIGTERM / SIGINT.
 * All application logic lives in app.ts; this file is intentionally thin.
 */

import { app } from './app.js';
import { logger } from './lib/logger.js';

const PORT = Number(process.env['PORT'] ?? 3000);

const server = app.listen(PORT, () => {
  logger.info(`Fluxora API listening on http://localhost:${PORT}`);
});

function shutdown(signal: string): void {
  logger.warn(`${signal} received — shutting down gracefully`);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
