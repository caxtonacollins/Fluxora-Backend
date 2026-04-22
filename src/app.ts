import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import { streamsRouter } from './routes/streams.js';
import { healthRouter } from './routes/health.js';
import { indexerRouter } from './routes/indexer.js';
import { auditRouter } from './routes/audit.js';
import { dlqRouter } from './routes/dlq.js';
import { correlationIdMiddleware } from './middleware/correlationId.js';
import { corsAllowlistMiddleware } from './middleware/cors.js';
import { requestLoggerMiddleware } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createRequestTimeoutMiddleware } from './middleware/requestProtection.js';
import { isShuttingDown } from './shutdown.js';

export interface AppOptions {
  /** When true, mounts a /__test/error and /__test/timeout route. */
  includeTestRoutes?: boolean;
  /** Milliseconds before a request is forcefully timed out. Defaults to 30000ms. */
  requestTimeoutMs?: number;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const timeoutMs = options.requestTimeoutMs ?? 30000;

  app.use(express.json({ limit: '256kb' }));
  app.use(correlationIdMiddleware);
  app.use(corsAllowlistMiddleware);
  app.use(requestLoggerMiddleware);

  // Attach AbortSignal and enforce timeout limits before hitting complex routes
  app.use(createRequestTimeoutMiddleware(timeoutMs));

  app.use((_req: Request, res: Response, next: NextFunction) => {
    if (isShuttingDown()) {
      res.setHeader('Connection', 'close');
    }
    next();
  });

  if (options.includeTestRoutes) {
    app.get('/__test/error', () => {
      throw new Error('Intentional test error');
    });

    app.get('/__test/timeout', async (req: Request, res: Response, next: NextFunction) => {
      try {
        await new Promise<void>((resolve, reject) => {
          // Simulate a long running operation
          const timer = setTimeout(() => resolve(), 5000);

          // Listen to the abort signal to halt operation
          req.abortSignal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Operation aborted by signal'));
          });
        });

        if (!res.headersSent) {
          res.json({ success: true });
        }
      } catch (err) {
        next(err);
      }
    });
  }

  app.use('/health', healthRouter);
  app.use('/api/streams', streamsRouter);
  app.use('/internal/indexer', indexerRouter);
  app.use('/api/audit', auditRouter);
  app.use('/admin/dlq', dlqRouter);

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'Fluxora API',
      version: '0.1.0',
      docs: 'Programmable treasury streaming on Stellar.',
    });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'The requested resource was not found' },
    });
  });

  app.use(errorHandler);

  return app;
}

export const app = createApp();
export default app;
