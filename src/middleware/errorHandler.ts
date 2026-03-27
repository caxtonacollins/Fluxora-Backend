import type { Request, Response, NextFunction } from 'express';
import { DecimalSerializationError, DecimalErrorCode } from '../serialization/decimal.js';
import { SerializationLogger, error as logError } from '../utils/logger.js';

export interface ApiErrorResponse {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export enum ApiErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  DECIMAL_ERROR = 'DECIMAL_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId: string | undefined = req.correlationId;
  if (err instanceof DecimalSerializationError) {
    SerializationLogger.validationFailed(err.field ?? 'unknown', err.rawValue, err.code, requestId);
    res.status(400).json({ error: { code: ApiErrorCode.DECIMAL_ERROR, message: err.message, details: { decimalErrorCode: err.code, field: err.field }, requestId } });
    return;
  }
  if (err instanceof ApiError) {
    logError(`API error: ${err.message}`, { code: err.code, statusCode: err.statusCode, details: err.details, requestId });
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    return;
  }
  const e = err instanceof Error ? err : new Error(String(err));
  logError('Unexpected error', { errorName: e.name, errorMessage: e.message, stack: e.stack, requestId });
  res.status(500).json({ error: { code: ApiErrorCode.INTERNAL_ERROR, message: 'An unexpected error occurred.', requestId } });
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => { fn(req, res, next).catch(next); };
}

export function notFound(resource: string, id?: string): ApiError {
  return new ApiError(ApiErrorCode.NOT_FOUND, id !== undefined ? `${resource} '${id}' not found` : `${resource} not found`, 404);
}

export function validationError(message: string, details?: unknown): ApiError {
  return new ApiError(ApiErrorCode.VALIDATION_ERROR, message, 400, details);
}

export function conflictError(message: string, details?: unknown): ApiError {
  return new ApiError(ApiErrorCode.CONFLICT, message, 409, details);
}

export function serviceUnavailable(message: string): ApiError {
  return new ApiError(ApiErrorCode.SERVICE_UNAVAILABLE, message, 503);
}
