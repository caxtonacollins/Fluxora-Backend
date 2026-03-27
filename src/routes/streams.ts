/**
 * Streams API routes.
 *
 * All amount fields (depositAmount, ratePerSecond) are validated as decimal
 * strings before storage and returned as decimal strings in every response.
 * This prevents floating-point precision loss when amounts cross the
 * chain/API boundary.
 *
 * Trust boundaries
 * ----------------
 * - Public internet clients: may list, read, create, and cancel streams.
 *   Authentication/authorisation is a planned follow-up (see non-goals below).
 * - Internal workers: same surface; no elevated privileges yet.
 *
 * Failure modes
 * -------------
 * - Invalid decimal string  → 400 VALIDATION_ERROR with per-field details
 * - Missing required field  → 400 VALIDATION_ERROR
 * - Stream not found        → 404 NOT_FOUND
 * - Duplicate cancel        → 409 CONFLICT
 *
 * Non-goals (intentionally deferred)
 * -----------------------------------
 * - Persistent storage (in-memory only; PostgreSQL integration is follow-up)
 * - Authentication / JWT enforcement
 * - Rate limiting
 * - Duplicate-delivery protection
 *
 * @openapi
 * /api/streams:
 *   get:
 *     summary: List all streams
 *     tags: [streams]
 *     responses:
 *       200:
 *         description: List of streams
 *   post:
 *     summary: Create a new stream
 *     tags: [streams]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StreamCreateRequest'
 *     responses:
 *       201:
 *         description: Stream created
 *       400:
 *         description: Validation error
 * /api/streams/{id}:
 *   get:
 *     summary: Get a stream by ID
 *     tags: [streams]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stream details
 *       404:
 *         description: Not found
 *   delete:
 *     summary: Cancel a stream
 *     tags: [streams]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stream cancelled
 *       404:
 *         description: Not found
 *       409:
 *         description: Already cancelled or completed
 */

import express from 'express';
import type { Request, Response } from 'express';
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

export const streamsRouter = express.Router();

// Amount fields that must be decimal strings per serialization policy
const AMOUNT_FIELDS = ['depositAmount', 'ratePerSecond'] as const;

interface Stream {
  id: string;
  sender: string;
  recipient: string;
  depositAmount: string;
  ratePerSecond: string;
  startTime: number;
  endTime: number;
  status: string;
}

// In-memory stream store — placeholder until PostgreSQL integration lands
const streams: Stream[] = [];

/**
 * GET /api/streams
 * List all streams with decimal string serialization.
 */
streamsRouter.get(
  '/',
  asyncHandler(async (_req: express.Request, res: express.Response) => {
    info('Listing all streams', { count: streams.length });
    res.json({ streams, total: streams.length });
  }),
);

/**
 * GET /api/streams/:id
 * Get a single stream by ID.
 */
streamsRouter.get(
  '/:id',
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    debug('Fetching stream', { id, correlationId: req.correlationId });

    const stream = streams.find((s) => s.id === id);
    if (!stream) throw notFound('Stream', id);

    res.json(stream);
  }),
);

/**
 * POST /api/streams
 * Create a new stream with decimal string validation.
 */
streamsRouter.post(
  '/',
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const body = req.body as Record<string, unknown>;
    const { sender, recipient, depositAmount, ratePerSecond, startTime, endTime } = body;
    const correlationId = req.correlationId;

    info('Creating new stream', { correlationId });

    // Validate required string fields
    if (typeof sender !== 'string' || sender.trim() === '') {
      throw validationError('sender must be a non-empty string');
    }
    if (typeof recipient !== 'string' || recipient.trim() === '') {
      throw validationError('recipient must be a non-empty string');
    }

    // Validate amount fields against decimal string policy
    const amountValidation = validateAmountFields(
      { depositAmount, ratePerSecond } as Record<string, unknown>,
      AMOUNT_FIELDS as unknown as string[],
    );

    if (!amountValidation.valid) {
      for (const err of amountValidation.errors) {
        SerializationLogger.validationFailed(
          err.field ?? 'unknown',
          err.rawValue,
          err.code,
          correlationId,
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
        },
      );
    }

    // Semantic validation for provided amount values
    const depositResult = validateDecimalString(depositAmount, 'depositAmount');
    const validatedDepositAmount =
      depositResult.valid && depositResult.value != null ? depositResult.value : '0';

    if (depositAmount !== undefined && depositAmount !== null) {
      if (parseFloat(validatedDepositAmount) <= 0) {
        throw validationError('depositAmount must be greater than zero');
      }
    }

    const rateResult = validateDecimalString(ratePerSecond, 'ratePerSecond');
    const validatedRatePerSecond =
      rateResult.valid && rateResult.value != null ? rateResult.value : '0';

    if (ratePerSecond !== undefined && ratePerSecond !== null) {
      if (parseFloat(validatedRatePerSecond) < 0) {
        throw validationError('ratePerSecond cannot be negative');
      }
    }

    // Validate startTime
    let validatedStartTime = Math.floor(Date.now() / 1000);
    if (startTime !== undefined) {
      if (typeof startTime !== 'number' || !Number.isInteger(startTime) || startTime < 0) {
        throw validationError('startTime must be a non-negative integer');
      }
      validatedStartTime = startTime;
    }

    // Validate endTime
    let validatedEndTime = 0;
    if (endTime !== undefined) {
      if (typeof endTime !== 'number' || !Number.isInteger(endTime) || endTime < 0) {
        throw validationError('endTime must be a non-negative integer');
      }
      validatedEndTime = endTime;
    }

    const id = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const stream: Stream = {
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
    SerializationLogger.amountSerialized(2, correlationId);
    info('Stream created', { id, correlationId });

    res.status(201).json(stream);
  }),
);

/**
 * DELETE /api/streams/:id
 * Cancel a stream.
 *
 * Failure modes:
 * - Stream not found        → 404 NOT_FOUND
 * - Already cancelled       → 409 CONFLICT
 * - Already completed       → 409 CONFLICT
 */
streamsRouter.delete(
  '/:id',
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    debug('Cancelling stream', { id, correlationId: req.correlationId });

    const index = streams.findIndex((s) => s.id === id);
    if (index === -1) throw notFound('Stream', id);

    const stream = streams[index];
    // noUncheckedIndexedAccess: stream is guaranteed non-null because findIndex returned >= 0
    if (stream === undefined) throw notFound('Stream', id);

    if (stream.status === 'cancelled') {
      throw new ApiError(ApiErrorCode.CONFLICT, 'Stream is already cancelled', 409, {
        streamId: id,
      });
    }
    if (stream.status === 'completed') {
      throw new ApiError(ApiErrorCode.CONFLICT, 'Cannot cancel a completed stream', 409, {
        streamId: id,
      });
    }

    streams[index] = { ...stream, status: 'cancelled' };
    info('Stream cancelled', { id, correlationId: req.correlationId });

    res.json({ message: 'Stream cancelled', id });
  }),
);
