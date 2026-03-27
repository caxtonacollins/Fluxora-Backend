/**
 * Request / response logger middleware.
 *
 * Logs two structured records per request:
 *  1. "request received"  — on the way in (method, path, ip).
 *  2. "request completed" — after the response is flushed (statusCode, durationMs).
 *
 * Both records carry `correlationId`. Must be registered after `correlationIdMiddleware`.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const { correlationId } = req;
  const startMs = Date.now();

  logger.info('request received', correlationId, {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });

  res.on('finish', () => {
    logger.info('request completed', correlationId, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startMs,
    });
  });

  next();
}
