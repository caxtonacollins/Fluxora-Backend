import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import { initializeConfig, type Config } from './config/env.js';
import {
  createDatabaseHealthChecker,
  createHorizonHealthChecker,
  createRedisHealthChecker,
  HealthCheckManager,
} from './config/health.js';
import {
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
} from './errors.js';
import { correlationIdMiddleware } from './middleware/correlationId.js';
import { requestLoggerMiddleware } from './middleware/requestLogger.js';
import { createBearerTokenAuth } from './middleware/tokenAuth.js';
import { createHealthRouter } from './routes/health.js';
import { createStreamsRouter } from './routes/streams.js';

export interface CreateAppOptions {
  config?: Config;
  healthManager?: HealthCheckManager;
  includeTestRoutes?: boolean;
}

function buildHealthManager(config: Config): HealthCheckManager {
  const healthManager = new HealthCheckManager();
  healthManager.registerChecker(createDatabaseHealthChecker());

  if (config.redisEnabled) {
    healthManager.registerChecker(createRedisHealthChecker());
  }

  if (config.nodeEnv !== 'development') {
    healthManager.registerChecker(createHorizonHealthChecker(config.horizonUrl));
  }

  return healthManager;
}

const allowAnonymous: RequestHandler = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => {
  next();
};

export function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? initializeConfig();
  const healthManager = options.healthManager ?? buildHealthManager(config);

  const adminAuth = createBearerTokenAuth({
    role: 'administrator',
    token: config.adminApiToken,
    required: config.requireAdminAuth,
  });

  const partnerAuth =
    config.requirePartnerAuth || config.partnerApiToken
      ? createBearerTokenAuth({
          role: 'partner',
          token: config.partnerApiToken,
          required: config.requirePartnerAuth,
        })
      : allowAnonymous;

  const app = express();

  app.use(correlationIdMiddleware);
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(express.json({ limit: '256kb' }));

  app.get('/', (_req, res) => {
    res.json({
      name: 'Fluxora API',
      version: config.apiVersion,
      service: 'fluxora-backend',
      environment: config.nodeEnv,
      docs: {
        health: '/health',
        readiness: '/health/ready',
        deployment: '/health/deployment',
        streams: '/api/streams',
      },
      guarantees: [
        'Normalized JSON error envelopes with request IDs',
        'Explicit readiness behavior for dependency and indexer failures',
        'Admin and partner trust boundaries enforced where configured',
      ],
    });
  });

  app.use(
    '/health',
    createHealthRouter({
      adminAuth,
      config,
      healthManager,
    }),
  );
  app.use('/api/streams', createStreamsRouter({ partnerAuth }));

  if (options.includeTestRoutes) {
    app.get('/__test/error', () => {
      throw new Error('boom');
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
