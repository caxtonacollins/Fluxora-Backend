import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import { buildDeploymentChecklistReport } from '../config/deployment.js';
import type { Config } from '../config/env.js';
import type { HealthCheckManager, HealthReport } from '../config/health.js';
import { asyncHandler } from '../errors.js';
import { assessIndexerHealth } from '../indexer/stall.js';

export interface CreateHealthRouterOptions {
  adminAuth: RequestHandler;
  config: Config;
  healthManager: HealthCheckManager;
}

function buildIndexerHealth(config: Config) {
  return assessIndexerHealth({
    enabled: config.indexerEnabled,
    lastSuccessfulSyncAt: config.indexerLastSuccessfulSyncAt,
    stallThresholdMs: config.indexerStallThresholdMs,
  });
}

function isReady(
  config: Config,
  dependencyHealth: HealthReport,
  deploymentStatus: ReturnType<typeof buildDeploymentChecklistReport>,
): boolean {
  if (dependencyHealth.status !== 'healthy') {
    return false;
  }

  if (config.indexerEnabled && deploymentStatus.status !== 'pass') {
    return false;
  }

  return deploymentStatus.status !== 'fail';
}

function buildSnapshot(
  config: Config,
  dependencyHealth: HealthReport,
) {
  const indexer = buildIndexerHealth(config);
  const deployment = buildDeploymentChecklistReport({
    config,
    dependencyHealth,
    indexerHealth: indexer,
  });
  const ready = isReady(config, dependencyHealth, deployment);

  return {
    timestamp: new Date().toISOString(),
    service: 'fluxora-backend',
    environment: config.nodeEnv,
    status: ready ? 'ok' : 'degraded',
    ready,
    dependencyHealth,
    indexer,
    deployment,
  };
}

export function createHealthRouter(options: CreateHealthRouterOptions) {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const snapshot = buildSnapshot(
      options.config,
      options.healthManager.getLastReport(options.config.apiVersion),
    );

    res.json({
      status: snapshot.status,
      service: snapshot.service,
      environment: snapshot.environment,
      timestamp: snapshot.timestamp,
      readiness: snapshot.ready ? 'ready' : 'not_ready',
      dependencies: {
        status: snapshot.dependencyHealth.status,
      },
      indexer: {
        status: snapshot.indexer.status,
        summary: snapshot.indexer.summary,
      },
      deployment: {
        status: snapshot.deployment.status,
        parityRequired: snapshot.deployment.parityRequired,
      },
    });
  });

  router.get(
    '/ready',
    asyncHandler(async (_req, res) => {
      const dependencyHealth = await options.healthManager.checkAll();
      const snapshot = buildSnapshot(options.config, dependencyHealth);
      const statusCode = snapshot.ready ? 200 : 503;

      res.status(statusCode).json({
        status: snapshot.ready ? 'ready' : 'not_ready',
        service: snapshot.service,
        environment: snapshot.environment,
        timestamp: snapshot.timestamp,
        dependencyHealth: snapshot.dependencyHealth,
        indexer: snapshot.indexer,
        deployment: {
          status: snapshot.deployment.status,
          summary: snapshot.deployment.summary,
        },
      });
    }),
  );

  router.get(
    '/live',
    options.adminAuth,
    asyncHandler(async (_req, res) => {
      const dependencyHealth = await options.healthManager.checkAll();
      const snapshot = buildSnapshot(options.config, dependencyHealth);
      const statusCode = snapshot.ready ? 200 : 503;

      res.status(statusCode).json(snapshot);
    }),
  );

  router.get(
    '/deployment',
    options.adminAuth,
    asyncHandler(async (_req, res) => {
      const dependencyHealth = await options.healthManager.checkAll();
      const snapshot = buildSnapshot(options.config, dependencyHealth);
      const statusCode = snapshot.deployment.status === 'fail' ? 503 : 200;

      res.status(statusCode).json({
        timestamp: snapshot.timestamp,
        service: snapshot.service,
        environment: snapshot.environment,
        dependencyHealth: {
          status: snapshot.dependencyHealth.status,
        },
        indexer: {
          status: snapshot.indexer.status,
          summary: snapshot.indexer.summary,
        },
        report: snapshot.deployment,
      });
    }),
  );

  return router;
}

export const healthRouter = createHealthRouter({
  adminAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  config: {
    apiVersion: '0.1.0',
    port: 3000,
    nodeEnv: 'development',
    databaseUrl: 'postgresql://localhost/fluxora',
    databasePoolSize: 10,
    databaseConnectionTimeout: 5000,
    redisUrl: 'redis://localhost:6379',
    redisEnabled: false,
    horizonUrl: 'https://horizon-testnet.stellar.org',
    horizonNetworkPassphrase: 'Test SDF Network ; September 2015',
    jwtSecret: 'dev-secret-key-change-in-production',
    jwtExpiresIn: '24h',
    logLevel: 'info',
    metricsEnabled: true,
    enableStreamValidation: true,
    enableRateLimit: false,
    requirePartnerAuth: false,
    requireAdminAuth: false,
    indexerEnabled: false,
    workerEnabled: false,
    indexerStallThresholdMs: 5 * 60 * 1000,
    deploymentChecklistVersion: '2026-03-27',
  },
  healthManager: {
    async checkAll() {
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: 0,
        dependencies: [],
        version: '0.1.0',
      };
    },
    getLastReport() {
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: 0,
        dependencies: [],
        version: '0.1.0',
      };
    },
    registerChecker() {
      return undefined;
    },
  } as unknown as HealthCheckManager,
});
