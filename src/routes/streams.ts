import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import {
  asyncHandler,
  conflictError,
  duplicateDeliveryError,
  notFound,
  validationError,
} from '../errors.js';
import { validateDecimalString } from '../serialization/decimal.js';
import {
  defaultChainStatusForStartTime,
  mapChainStatusToApiStatus,
  type ChainStreamStatus,
} from '../streams/status.js';

type StoredStream = {
  id: string;
  sender: string;
  recipient: string;
  depositAmount: string;
  ratePerSecond: string;
  startTime: number;
  endTime: number;
  status: string;
  chainStatus: ChainStreamStatus;
  idempotencyKey?: string;
};

export interface CreateStreamsRouterOptions {
  partnerAuth?: RequestHandler;
  now?: () => number;
}

const streams: StoredStream[] = [];
const idempotencyIndex = new Map<string, string>();
let streamCounter = 0;

const allowAnonymous: RequestHandler = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => {
  next();
};

function nextStreamId(now: number): string {
  streamCounter += 1;
  return `stream-${now}-${streamCounter}`;
}

function serializeStream(stream: StoredStream) {
  return {
    id: stream.id,
    sender: stream.sender,
    recipient: stream.recipient,
    depositAmount: stream.depositAmount,
    ratePerSecond: stream.ratePerSecond,
    startTime: stream.startTime,
    endTime: stream.endTime,
    status: stream.status,
  };
}

function requireTextField(body: Record<string, unknown>, field: string): string {
  const value = body[field];

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError(`${field} must be a non-empty string`, { field });
  }

  return value.trim();
}

function requireIntegerField(
  body: Record<string, unknown>,
  field: string,
  defaultValue: number,
): number {
  const value = body[field];
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw validationError(`${field} must be a non-negative integer`, { field });
  }

  return value;
}

function requirePositiveDecimal(
  body: Record<string, unknown>,
  field: 'depositAmount' | 'ratePerSecond',
): string {
  const value = body[field];
  const validated = validateDecimalString(value, field);

  if (!validated.valid || !validated.value) {
    throw validationError(validated.error?.message ?? `${field} is invalid`, {
      field,
      decimalErrorCode: validated.error?.code,
    });
  }

  const normalized = validated.value.replace(/^[+-]/, '').replace('.', '');
  if (/^0+$/.test(normalized) || validated.value.startsWith('-')) {
    throw validationError(`${field} must be greater than zero`, { field });
  }

  return validated.value;
}

function findStream(id: string): StoredStream {
  const stream = streams.find((candidate) => candidate.id === id);
  if (!stream) {
    throw notFound('Stream', id);
  }

  return stream;
}

export function resetStreamsStore(): void {
  streams.length = 0;
  idempotencyIndex.clear();
  streamCounter = 0;
}

export function createStreamsRouter(options: CreateStreamsRouterOptions = {}) {
  const router = Router();
  const partnerAuth = options.partnerAuth ?? allowAnonymous;
  const getNow = options.now ?? (() => Date.now());

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({
        streams: streams.map(serializeStream),
        total: streams.length,
      });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const stream = findStream(req.params.id);
      res.json(serializeStream(stream));
    }),
  );

  router.post(
    '/',
    partnerAuth,
    asyncHandler(async (req, res) => {
      const body =
        req.body && typeof req.body === 'object'
          ? (req.body as Record<string, unknown>)
          : {};

      const sender = requireTextField(body, 'sender');
      const recipient = requireTextField(body, 'recipient');
      const depositAmount = requirePositiveDecimal(body, 'depositAmount');
      const ratePerSecond = requirePositiveDecimal(body, 'ratePerSecond');
      const startTime = requireIntegerField(
        body,
        'startTime',
        Math.floor(getNow() / 1000),
      );
      const endTime = requireIntegerField(body, 'endTime', 0);

      if (endTime !== 0 && endTime < startTime) {
        throw validationError('endTime must be greater than or equal to startTime', {
          field: 'endTime',
        });
      }

      const idempotencyKey = req.header('idempotency-key')?.trim() || undefined;
      if (idempotencyKey && idempotencyIndex.has(idempotencyKey)) {
        throw duplicateDeliveryError('Idempotency-Key has already been consumed', {
          idempotencyKey,
          streamId: idempotencyIndex.get(idempotencyKey),
        });
      }

      const chainStatus = defaultChainStatusForStartTime(startTime);
      const stream: StoredStream = {
        id: nextStreamId(getNow()),
        sender,
        recipient,
        depositAmount,
        ratePerSecond,
        startTime,
        endTime,
        chainStatus,
        status: mapChainStatusToApiStatus(chainStatus).status,
        idempotencyKey,
      };

      streams.push(stream);

      if (idempotencyKey) {
        idempotencyIndex.set(idempotencyKey, stream.id);
      }

      res.status(201).json(serializeStream(stream));
    }),
  );

  router.delete(
    '/:id',
    partnerAuth,
    asyncHandler(async (req, res) => {
      const stream = findStream(req.params.id);

      if (stream.status === 'cancelled') {
        throw conflictError('Stream is already cancelled', { streamId: stream.id });
      }

      if (stream.status === 'completed') {
        throw conflictError('Cannot cancel a completed stream', { streamId: stream.id });
      }

      stream.chainStatus = 'cancelled';
      stream.status = 'cancelled';

      res.json({
        message: 'Stream cancelled',
        stream: serializeStream(stream),
      });
    }),
  );

  return router;
}

export const streamsRouter = createStreamsRouter();
