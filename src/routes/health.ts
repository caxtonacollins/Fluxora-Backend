import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const jwtSecretConfigured = !!process.env.JWT_SECRET;
  
  res.json({
    status: 'ok',
    service: 'fluxora-backend',
    timestamp: new Date().toISOString(),
    subsystems: {
      auth: {
        status: jwtSecretConfigured ? 'ok' : 'degraded',
        configured: jwtSecretConfigured,
        message: jwtSecretConfigured ? 'JWT initialized' : 'Using default development secret',
      }
    }
  });
});
