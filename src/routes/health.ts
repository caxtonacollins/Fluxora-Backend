import { Router } from 'express';
import { getIndexerHealth } from './indexer.js';

export const healthRouter = Router();

healthRouter.get('/', (_req: any, res: any) => {
  const indexer = getIndexerHealth();
  const status = indexer.dependency === 'healthy' ? 'ok' : 'degraded';

  res.json({
    status,
    service: 'fluxora-backend',
    timestamp: new Date().toISOString(),
    dependencies: {
      indexer,
    },
  });
});
