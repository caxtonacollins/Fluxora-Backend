import express from 'express';
import type { Request, Response } from 'express';
import { assessIndexerHealth } from '../indexer/stall.js';

export const healthRouter = express.Router();

/**
 * GET /health
 *
 * Liveness probe — always 200 so load-balancers know the process is alive.
 * `status` reflects indexer freshness so operators can distinguish
 * running-but-degraded from dead.
 *
 * Trust boundary: public, read-only — no authentication required.
 */
healthRouter.get('/', (_req: Request, res: Response) => {
  const indexer = assessIndexerHealth({ enabled: false });
  const status =
    indexer.status === 'stalled' || indexer.status === 'starting' ? 'degraded' : 'ok';

  res.json({
    status,
    service: 'fluxora-backend',
    timestamp: new Date().toISOString(),
    indexer,
  });
});
