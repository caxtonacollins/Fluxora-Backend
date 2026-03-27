import { assessIndexerHealth } from './stall.js';

describe('assessIndexerHealth', () => {
  it('returns not_configured when the indexer is disabled', () => {
    const health = assessIndexerHealth({
      enabled: false,
    });

    expect(health.status).toBe('not_configured');
    expect(health.clientImpact).toBe('none');
    expect(health.operatorAction).toBe('none');
  });

  it('returns healthy when the checkpoint is fresh', () => {
    const health = assessIndexerHealth({
      enabled: true,
      lastSuccessfulSyncAt: '2026-03-25T20:00:00.000Z',
      now: '2026-03-25T20:03:00.000Z',
      stallThresholdMs: 5 * 60 * 1000,
    });

    expect(health.status).toBe('healthy');
    expect(health.stalled).toBe(false);
    expect(health.clientImpact).toBe('none');
  });

  it('returns stalled when the checkpoint is too old', () => {
    const health = assessIndexerHealth({
      enabled: true,
      lastSuccessfulSyncAt: '2026-03-25T20:00:00.000Z',
      now: '2026-03-25T20:06:00.000Z',
      stallThresholdMs: 5 * 60 * 1000,
    });

    expect(health.status).toBe('stalled');
    expect(health.stalled).toBe(true);
    expect(health.clientImpact).toBe('stale_chain_state');
    expect(health.operatorAction).toBe('page');
  });
});
