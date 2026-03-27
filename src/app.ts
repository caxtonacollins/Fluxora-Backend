import express from 'express';
import type { Request, Response } from 'express';
import { streamsRouter } from './routes/streams.js';
import { healthRouter } from './routes/health.js';
import { correlationIdMiddleware } from './middleware/correlationId.js';
import { requestLoggerMiddleware } from './middleware/requestLogger.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { HealthCheckManager } from './config/health.js';
import { createPostgresChecker } from './health/checkers.js';
import { getPool } from './db/pool.js';

export const app = express();

// ── Health manager ────────────────────────────────────────────────────────────
const healthManager = new HealthCheckManager();

// Register postgres health checker backed by the singleton pool
healthManager.registerChecker(
  createPostgresChecker(() => getPool(), { maxPoolSize: parseInt(process.env.DB_POOL_MAX ?? '10', 10) }),
);

app.locals.healthManager = healthManager;

// ── Global middleware ─────────────────────────────────────────────────────────

// Payload limit — prevents oversized-body abuse
app.use(express.json({ limit: '100kb' }));

app.use(correlationIdMiddleware);
app.use(requestLoggerMiddleware);

// Rate limiter — applied globally; tighten per-router as needed
app.use(createRateLimiter());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/health', healthRouter);
app.use('/api/streams', streamsRouter);

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Fluxora API',
    version: '0.1.0',
    docs: 'Programmable treasury streaming on Stellar.',
  });
});
