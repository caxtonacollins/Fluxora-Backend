import { Router, Request, Response } from 'express';

import {
  validateDecimalString,
  validateAmountFields,
} from '../serialization/decimal.js';

import {
  ApiError,
  ApiErrorCode,
  notFound,
  validationError,
  asyncHandler,
} from '../middleware/errorHandler.js';

import { SerializationLogger, info, debug } from '../utils/logger.js';
import { successResponse } from '../utils/response.js';

export const streamsRouter = Router();

// Amount fields that must be decimal strings per serialization policy
const AMOUNT_FIELDS = ['depositAmount', 'ratePerSecond'] as const;

// In-memory stream store (placeholder for DB integration)
const streams: Array<{
  id: string;
  sender: string;
  recipient: string;
  depositAmount: string;
  ratePerSecond: string;
  startTime: number;
  endTime: number;
  status: string;
}> = [];

/**
 * GET /api/streams
 * List all streams
 */
streamsRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    info('Listing all streams', { count: streams.length });

    res.json(
      successResponse({
        streams,
        total: streams.length,
      })
    );
  })
);

/**
 * GET /api/streams/:id
 * Get a single stream by ID
 */
streamsRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    debug('Fetching stream', { id });

    const stream = streams.find((s) => s.id === id);

    if (!stream) {
      throw notFound('Stream', id);
    }

    res.json(successResponse({ stream }));
  })
);

/**
 * POST /api/streams
 * Create a new stream
 */
streamsRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { sender, recipient, depositAmount, ratePerSecond, startTime, endTime } = req.body ?? {};

    info('Creating new stream');

    // Validate required fields
    if (typeof sender !== 'string' || sender.trim() === '') {
      throw validationError('sender must be a non-empty string');
    }

    if (typeof recipient !== 'string' || recipient.trim() === '') {
      throw validationError('recipient must be a non-empty string');
    }

    // Validate decimal amount fields
    const amountValidation = validateAmountFields(
      { depositAmount, ratePerSecond },
      AMOUNT_FIELDS as unknown as string[]
    );

    if (!amountValidation.valid) {
      for (const err of amountValidation.errors) {
        SerializationLogger.validationFailed(
          err.field || 'unknown',
          err.rawValue,
          err.code
        );
      }

      throw new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid decimal string format for amount fields',
        400,
        {
          errors: amountValidation.errors.map((e) => ({
            field: e.field,
            code: e.code,
            message: e.message,
          })),
        }
      );
    }

    // Semantic validation
    const deposit = validateDecimalString(depositAmount, 'depositAmount');
    const rate = validateDecimalString(ratePerSecond, 'ratePerSecond');

    const validatedDepositAmount = deposit.value!;
    const validatedRatePerSecond = rate.value!;

    if (parseFloat(validatedDepositAmount) <= 0) {
      throw validationError('depositAmount must be greater than zero');
    }

    if (parseFloat(validatedRatePerSecond) < 0) {
      throw validationError('ratePerSecond cannot be negative');
    }

    // Validate startTime
    const validatedStartTime =
      typeof startTime === 'number' && Number.isInteger(startTime) && startTime >= 0
        ? startTime
        : Math.floor(Date.now() / 1000);

    // Validate endTime
    const validatedEndTime =
      typeof endTime === 'number' && Number.isInteger(endTime) && endTime >= 0
        ? endTime
        : 0;

    // Create stream
    const id = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const stream = {
      id,
      sender: sender.trim(),
      recipient: recipient.trim(),
      depositAmount: validatedDepositAmount,
      ratePerSecond: validatedRatePerSecond,
      startTime: validatedStartTime,
      endTime: validatedEndTime,
      status: 'active',
    };

    streams.push(stream);

    SerializationLogger.amountSerialized(2);
    info('Stream created', { id });

    res.status(201).json(successResponse({ stream }));
  })
);

/**
 * DELETE /api/streams/:id
 * Cancel a stream
 */
streamsRouter.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    debug('Deleting stream', { id });

    const index = streams.findIndex((s) => s.id === id);

    if (index === -1) {
      throw notFound('Stream', id);
    }

    const stream = streams[index];

    if (stream.status === 'cancelled') {
      throw new ApiError(
        ApiErrorCode.CONFLICT,
        'Stream is already cancelled',
        409,
        { streamId: id }
      );
    }

    if (stream.status === 'completed') {
      throw new ApiError(
        ApiErrorCode.CONFLICT,
        'Cannot cancel a completed stream',
        409,
        { streamId: id }
      );
    }

    streams[index] = { ...stream, status: 'cancelled' };

    info('Stream cancelled', { id });

    res.json(successResponse({ message: 'Stream cancelled', id }));
  })
);