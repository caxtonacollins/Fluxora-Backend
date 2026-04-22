/**
 * Webhook delivery and management routes
 */

import express from 'express';
import { webhookService } from '../webhooks/service.js';
import { webhookDeliveryStore } from '../webhooks/store.js';
import { verifyWebhookSignature } from '../webhooks/signature.js';
import { logger } from '../lib/logger.js';
import { successResponse, errorResponse } from '../utils/response.js';

export const webhooksRouter = express.Router();

/**
 * GET /api/webhooks/deliveries/:deliveryId
 * Get the status of a webhook delivery
 */
webhooksRouter.get('/deliveries/:deliveryId', (req, res) => {
  const { deliveryId } = req.params;
  const requestId = (req as any).id as string | undefined;

  const delivery = webhookService.getDeliveryStatus(deliveryId);

  if (!delivery) {
    return res.status(404).json(
      errorResponse('DELIVERY_NOT_FOUND', `Webhook delivery ${deliveryId} not found`, undefined, requestId)
    );
  }

  res.json(successResponse({
    id: delivery.id,
    deliveryId: delivery.deliveryId,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    status: delivery.status,
    attempts: delivery.attempts.map(attempt => ({
      attemptNumber: attempt.attemptNumber,
      timestamp: new Date(attempt.timestamp).toISOString(),
      statusCode: attempt.statusCode,
      error: attempt.error,
      nextRetryAt: attempt.nextRetryAt ? new Date(attempt.nextRetryAt).toISOString() : null,
    })),
    createdAt: new Date(delivery.createdAt).toISOString(),
    updatedAt: new Date(delivery.updatedAt).toISOString(),
  }, requestId));
});

/**
 * GET /api/webhooks/deliveries
 * List all webhook deliveries (for monitoring/debugging)
 */
webhooksRouter.get('/deliveries', (req, res) => {
  const requestId = (req as any).id as string | undefined;
  const deliveries = webhookDeliveryStore.getAll();

  res.json(successResponse({
    total: deliveries.length,
    deliveries: deliveries.map(delivery => ({
      id: delivery.id,
      deliveryId: delivery.deliveryId,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      status: delivery.status,
      attemptCount: delivery.attempts.length,
      createdAt: new Date(delivery.createdAt).toISOString(),
      updatedAt: new Date(delivery.updatedAt).toISOString(),
    })),
  }, requestId));
});

/**
 * POST /api/webhooks/verify
 * Verify a webhook signature (for consumer testing)
 */
webhooksRouter.post('/verify', express.raw({ type: 'application/json' }), (req, res) => {
  const requestId = (req as any).id as string | undefined;
  const secret = req.query.secret as string;
  const deliveryId = req.header('x-fluxora-delivery-id');
  const timestamp = req.header('x-fluxora-timestamp');
  const signature = req.header('x-fluxora-signature');

  const result = verifyWebhookSignature({
    secret,
    deliveryId,
    timestamp,
    signature,
    rawBody: req.body,
    isDuplicateDelivery: (id) => webhookService.isDuplicateDelivery(id),
  });

  if (!result.ok) {
    return res.status(result.status).json(
      errorResponse(result.code, result.message, undefined, requestId)
    );
  }

  res.json(successResponse({
    ok: true,
    code: result.code,
    message: result.message,
  }, requestId));
});

/**
 * POST /internal/webhooks/retry
 * Process pending webhook retries (internal endpoint for background job)
 */
webhooksRouter.post('/retry', express.json(), async (req, res) => {
  const requestId = (req as any).id as string | undefined;
  const secret = req.query.secret as string;

  if (!secret) {
    logger.warn('Webhook retry endpoint called without secret', undefined);
    return res.status(400).json(
      errorResponse('MISSING_SECRET', 'Webhook secret is required as query parameter', undefined, requestId)
    );
  }

  try {
    await webhookService.processPendingRetries(secret);
    res.json(successResponse({
      ok: true,
      message: 'Pending webhook retries processed',
    }, requestId));
  } catch (error) {
    logger.error('Error processing webhook retries', undefined, {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json(
      errorResponse('RETRY_PROCESSING_ERROR', 'Failed to process webhook retries', undefined, requestId)
    );
  }
});
