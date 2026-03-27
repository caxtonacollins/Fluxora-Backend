import request from 'supertest';

import { createApp } from './app.js';
import { resetStreamsStore } from './routes/streams.js';

describe('app error envelopes', () => {
  beforeEach(() => {
    resetStreamsStore();
  });

  it('returns a normalized 404 envelope for unknown routes', async () => {
    const response = await request(createApp({ includeTestRoutes: true })).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
    expect(response.body.error.status).toBe(404);
    expect(response.body.error.requestId).toBeDefined();
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('returns a normalized 400 envelope for invalid JSON', async () => {
    const response = await request(createApp({ includeTestRoutes: true }))
      .post('/api/streams')
      .set('content-type', 'application/json')
      .send('{"sender":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_json');
    expect(response.body.error.status).toBe(400);
  });

  it('returns a normalized 413 envelope for oversized payloads', async () => {
    const response = await request(createApp({ includeTestRoutes: true }))
      .post('/api/streams')
      .send({
        sender: 'alice',
        recipient: 'bob',
        depositAmount: '10',
        ratePerSecond: '1',
        startTime: 1710000000,
        blob: 'a'.repeat(300_000),
      });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('payload_too_large');
    expect(response.body.error.status).toBe(413);
  });

  it('returns validation errors in the normalized envelope', async () => {
    const response = await request(createApp({ includeTestRoutes: true }))
      .post('/api/streams')
      .send({
        sender: 'alice',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
    expect(response.body.error.status).toBe(400);
    expect(response.body.error.details).toEqual({
      field: 'recipient',
    });
  });

  it('returns a normalized 500 envelope for unexpected failures', async () => {
    const response = await request(createApp({ includeTestRoutes: true })).get('/__test/error');

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('internal_error');
    expect(response.body.error.status).toBe(500);
    expect(response.body.error.message).toBe('Internal server error');
  });
});
