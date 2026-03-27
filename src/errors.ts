import { randomUUID } from 'node:crypto';

import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';

import { CORRELATION_ID_HEADER } from './middleware/correlationId.js';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  expose: boolean;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    expose = true,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = expose;
  }
}

export const requestIdMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const requestId =
    req.header('x-request-id') ||
    req.header(CORRELATION_ID_HEADER) ||
    req.correlationId ||
    randomUUID();

  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
};

export const notFoundHandler: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  next(
    new ApiError(404, 'not_found', `No route matches ${req.method} ${req.originalUrl}`),
  );
};

function normalizeExpressError(error: unknown) {
  const candidate = error as {
    status?: number;
    type?: string;
    message?: string;
  };

  if (candidate?.type === 'entity.parse.failed') {
    return new ApiError(400, 'invalid_json', 'Request body must be valid JSON');
  }

  if (candidate?.type === 'entity.too.large' || candidate?.status === 413) {
    return new ApiError(
      413,
      'payload_too_large',
      'Request body exceeds the 256 KiB limit',
    );
  }

  if (error instanceof ApiError) {
    return error;
  }

  return new ApiError(500, 'internal_error', 'Internal server error', undefined, false);
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

export function validationError(
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return new ApiError(400, 'validation_error', message, details);
}

export function notFound(resource: string, id?: string): ApiError {
  const message = id
    ? `${resource} '${id}' was not found`
    : `${resource} was not found`;

  return new ApiError(404, 'not_found', message, { resource, ...(id ? { id } : {}) });
}

export function conflictError(
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return new ApiError(409, 'conflict', message, details);
}

export function duplicateDeliveryError(
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return new ApiError(409, 'duplicate_delivery', message, details);
}

export function unauthorizedError(
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return new ApiError(401, 'unauthorized', message, details);
}

export function forbiddenError(
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return new ApiError(403, 'forbidden', message, details);
}

export function serviceUnavailable(
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return new ApiError(503, 'service_unavailable', message, details);
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const normalized = normalizeExpressError(error);
  const requestId = res.locals.requestId as string;

  const log = {
    requestId,
    status: normalized.status,
    code: normalized.code,
    method: req.method,
    path: req.originalUrl,
    message: error instanceof Error ? error.message : normalized.message,
    details: normalized.details,
  };

  if (normalized.status >= 500) {
    console.error('API error', log);
  } else {
    console.warn('API error', log);
  }

  const body: Record<string, unknown> = {
    error: {
      code: normalized.code,
      message: normalized.message,
      status: normalized.status,
      requestId,
    },
  };

  if (normalized.details) {
    (body.error as Record<string, unknown>).details = normalized.details;
  }

  res.status(normalized.status).json(body);
};
