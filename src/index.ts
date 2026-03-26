/**
 * Fluxora Backend Server
 * 
 * Purpose: Off-chain companion to the streaming contract presenting a trustworthy,
 * operator-grade HTTP surface for discovery and automation.
 * 
 * Key Guarantees:
 * - Amounts crossing the chain/API boundary are serialized as decimal strings
 * - All errors are classified and logged for diagnostics
 * - Health endpoints for operational monitoring
 * 
 * @module index
 */

import express, { Request, Response, NextFunction } from 'express';
import { streamsRouter } from './routes/streams.js';
import { healthRouter } from './routes/health.js';
import { initializeConfig, getConfig, ConfigError } from './config/env.js';
import { initializeLogger, getLogger } from './config/logger.js';
import { HealthCheckManager, createDatabaseHealthChecker, createRedisHealthChecker, createHorizonHealthChecker } from './config/health.js';
import { createRequestSizeLimitMiddleware, createJsonDepthValidationMiddleware, createRequestTimeoutMiddleware, requestProtectionErrorHandler } from './middleware/requestProtection.js';
import { successResponse, errorResponse } from './utils/response.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestIdMiddleware, info, warn } from './utils/logger.js';

const PORT = process.env.PORT ?? 3000;

// Trust boundary: Add request ID for tracing
app.use(requestIdMiddleware);

// Trust boundary: Parse JSON with size limits
app.use(express.json({ limit: '1mb' }));

// Create Express app
const app = express();

// Request protection middleware (must be before express.json)
app.use(createRequestSizeLimitMiddleware(config.maxRequestSizeBytes));

// JSON parsing with configured size limit
app.use(express.json({ limit: `${config.maxRequestSizeBytes}b` }));

// JSON depth validation (must be after express.json)
app.use(createJsonDepthValidationMiddleware(config.maxJsonDepth));

// Request timeout protection
app.use(createRequestTimeoutMiddleware(config.requestTimeoutMs));

// Trust boundary: Log all requests
app.use((req: Request, _res: Response, next: NextFunction) => {
  const requestId = (req as Request & { id?: string }).id;
  info('Incoming request', {
    method: req.method,
    path: req.path,
    requestId,
  });
  next();
});

// Mount health router for operational monitoring
// Public: Anyone can check health (trust boundary: read-only)
app.use('/health', healthRouter);

// Log request protection configuration
logger.info('Request protection enabled', {
  maxRequestSizeBytes: config.maxRequestSizeBytes,
  maxJsonDepth: config.maxJsonDepth,
  requestTimeoutMs: config.requestTimeoutMs,
});

logger.info('Stellar network configuration', {
  network: config.stellarNetwork,
  horizonUrl: config.horizonUrl,
  streamingContract: config.contractAddresses.streaming,
});

// Routes
app.use('/health', healthRouter);
app.use('/api/streams', streamsRouter);

app.get('/', (_req, res) => {
  res.json(successResponse({
    name: 'Fluxora API',
    version: config.apiVersion,
    network: config.stellarNetwork,
    docs: 'Programmable treasury streaming on Stellar.',
  }));
});

// Error handler
app.use(requestProtectionErrorHandler);
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json(
    errorResponse(
      'Internal server error',
      'INTERNAL_ERROR',
      config.nodeEnv === 'development' ? err.message : undefined
    )
  );
});

// Mount streams router for stream management
// Note: In production, this should be protected by authentication
app.use('/api/streams', streamsRouter);

// Root endpoint with API documentation
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Fluxora API',
    version: '0.1.0',
    description: 'Programmable treasury streaming on Stellar.',
    documentation: {
      openapi: '/api/streams (see source for OpenAPI spec)',
      health: '/health',
    },
    decimalPolicy: {
      description: 'All amount fields are serialized as decimal strings',
      fields: ['depositAmount', 'ratePerSecond'],
      format: '^[+-]?\\d+(\\.\\d+)?$',
    },
  });
});

// Trust boundary: 404 handler for unknown routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found',
    },
  });
});

// Global error handler (must be last)
// Catches all errors and returns consistent JSON responses
// Trust boundary: Never exposes internal error details in production
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const requestId = (req as Request & { id?: string }).id;
  
  // Handle JSON parsing errors
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid JSON in request body',
        requestId,
      },
    });
    return;
  }
  
  errorHandler(err, req, res, _next);
});

// Start server
const server = app.listen(PORT, () => {
  info(`Fluxora API listening on http://localhost:${PORT}`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  warn('SIGTERM received, shutting down gracefully');
  server.close(() => {
    info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  warn('SIGINT received, shutting down gracefully');
  server.close(() => {
    info('Server closed');
    process.exit(0);
  });
});

export { app };
