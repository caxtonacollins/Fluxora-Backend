import request from 'supertest';

import { createApp } from '../src/app.js';
import type { Config } from '../src/config/env.js';
import { HealthCheckManager } from '../src/config/health.js';
import { resetStreamsStore } from '../src/routes/streams.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 3000,
    nodeEnv: 'development',
    apiVersion: '0.1.0',
    databaseUrl: 'postgresql://localhost/fluxora',
    databasePoolSize: 10,
    databaseConnectionTimeout: 5000,
    redisUrl: 'redis://localhost:6379',
    redisEnabled: false,
    horizonUrl: 'https://horizon-testnet.stellar.org',
    horizonNetworkPassphrase: 'Test SDF Network ; September 2015',
    jwtSecret: 'dev-secret-key-change-in-production',
    jwtExpiresIn: '24h',
    logLevel: 'info',
    metricsEnabled: true,
    enableStreamValidation: true,
    enableRateLimit: false,
    requirePartnerAuth: false,
    requireAdminAuth: false,
    indexerEnabled: false,
    workerEnabled: false,
    indexerStallThresholdMs: 5 * 60 * 1000,
    deploymentChecklistVersion: '2026-03-27',
    ...overrides,
  };
}

function makeApp(overrides: Partial<Config> = {}) {
  return createApp({
    config: makeConfig(overrides),
    healthManager: new HealthCheckManager(),
  });
}

describe('Streams API', () => {
  beforeEach(() => {
    resetStreamsStore();
  });

  it('creates a stream with valid decimal string inputs', async () => {
    const response = await request(makeApp())
      .post('/api/streams')
      .send({
        sender: 'GCSX2XXXXXXXXXXXXXXXXXXXXXXX',
        recipient: 'GDRX2XXXXXXXXXXXXXXXXXXXXXXX',
        depositAmount: '1000000.0000000',
        ratePerSecond: '0.0000116',
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();
    expect(response.body.depositAmount).toBe('1000000.0000000');
    expect(response.body.ratePerSecond).toBe('0.0000116');
    expect(response.body.status).toBe('active');
  });

  it('marks future streams as scheduled', async () => {
    const response = await request(
      createApp({
        config: makeConfig(),
        healthManager: new HealthCheckManager(),
      }),
    )
      .post('/api/streams')
      .send({
        sender: 'alice',
        recipient: 'bob',
        depositAmount: '100',
        ratePerSecond: '1',
        startTime: Math.floor(Date.now() / 1000) + 3600,
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('scheduled');
  });

  it('rejects missing required fields with normalized validation errors', async () => {
    const response = await request(makeApp())
      .post('/api/streams')
      .send({
        sender: 'alice',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
    expect(response.body.error.details).toEqual({ field: 'recipient' });
  });

  it('rejects malformed decimal values with field-level details', async () => {
    const response = await request(makeApp())
      .post('/api/streams')
      .send({
        sender: 'alice',
        recipient: 'bob',
        depositAmount: 100,
        ratePerSecond: '1',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
    expect(response.body.error.details).toEqual(
      expect.objectContaining({
        field: 'depositAmount',
      }),
    );
  });

  it('rejects duplicate delivery for a reused Idempotency-Key', async () => {
    const app = makeApp();
    const payload = {
      sender: 'alice',
      recipient: 'bob',
      depositAmount: '100',
      ratePerSecond: '1',
    };

    const first = await request(app)
      .post('/api/streams')
      .set('idempotency-key', 'stream-create-1')
      .send(payload);
    const second = await request(app)
      .post('/api/streams')
      .set('idempotency-key', 'stream-create-1')
      .send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('duplicate_delivery');
    expect(second.body.error.details.streamId).toBe(first.body.id);
  });

  it('lists streams with a total count', async () => {
    const app = makeApp();

    await request(app).post('/api/streams').send({
      sender: 'alice',
      recipient: 'bob',
      depositAmount: '100',
      ratePerSecond: '1',
    });

    const response = await request(app).get('/api/streams');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.streams)).toBe(true);
    expect(response.body.total).toBe(1);
  });

  it('returns 404 for a non-existent stream', async () => {
    const response = await request(makeApp()).get('/api/streams/non-existent-id');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });

  it('rejects unauthenticated partner writes when partner auth is required', async () => {
    const response = await request(
      makeApp({
        nodeEnv: 'staging',
        requirePartnerAuth: true,
        partnerApiToken: 'partner-secret',
      }),
    )
      .post('/api/streams')
      .send({
        sender: 'alice',
        recipient: 'bob',
        depositAmount: '100',
        ratePerSecond: '1',
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthorized');
  });

  it('allows authenticated partner writes and deletes when partner auth is required', async () => {
    const app = makeApp({
      nodeEnv: 'staging',
      requirePartnerAuth: true,
      partnerApiToken: 'partner-secret',
    });

    const createResponse = await request(app)
      .post('/api/streams')
      .set('authorization', 'Bearer partner-secret')
      .send({
        sender: 'alice',
        recipient: 'bob',
        depositAmount: '100',
        ratePerSecond: '1',
      });

    const deleteResponse = await request(app)
      .delete(`/api/streams/${createResponse.body.id}`)
      .set('authorization', 'Bearer partner-secret');

    expect(createResponse.status).toBe(201);
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.stream.status).toBe('cancelled');
  });
});
