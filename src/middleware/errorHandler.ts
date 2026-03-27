export {
  ApiError,
  asyncHandler,
  conflictError,
  duplicateDeliveryError,
  errorHandler,
  forbiddenError,
  notFound,
  requestIdMiddleware,
  serviceUnavailable,
  unauthorizedError,
  validationError,
} from '../errors.js';

export const ApiErrorCode = {
  VALIDATION_ERROR: 'validation_error',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  DUPLICATE_DELIVERY: 'duplicate_delivery',
  INTERNAL_ERROR: 'internal_error',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
} as const;
