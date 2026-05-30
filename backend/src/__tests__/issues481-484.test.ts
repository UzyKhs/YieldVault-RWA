/**
 * Tests for issues #481, #480, #484, #482.
 */

import request from 'supertest';
import app from '../index';
import {
  resetMaintenanceModeState,
  getMaintenanceModeState,
  updateMaintenanceModeState,
} from '../maintenanceMode';
import {
  resetWebhookState,
  registerWebhookEndpoint,
  emitTransactionEvent,
} from '../webhookDelivery';
import { backfillApySnapshots } from '../apySnapshot';
import { parseUtcDateRange, DateRangeParseError } from '../dateRange';

const ADMIN_KEY = process.env.ADMIN_API_KEY || 'test-admin-key';
const AUTH_HEADER = { Authorization: `ApiKey ${ADMIN_KEY}` };

// ─── #481: Maintenance Mode Gate ─────────────────────────────────────────────

describe('#481 Maintenance Mode', () => {
  beforeEach(() => resetMaintenanceModeState());
  afterEach(() => resetMaintenanceModeState());

  describe('maintenanceModeMiddleware', () => {
    it('allows GET requests when maintenance is enabled', async () => {
      updateMaintenanceModeState({ enabled: true });
      const res = await request(app).get('/health');
      expect(res.status).not.toBe(503);
    });

    it('blocks POST requests with 503 when maintenance is enabled', async () => {
      updateMaintenanceModeState({ enabled: true, reason: 'Scheduled downtime' });
      const res = await request(app)
        .post('/auth/login')
        .send({ walletAddress: 'GTEST' });
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('Service Unavailable');
      expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
      expect(res.headers['retry-after']).toBeDefined();
    });

    it('includes reason in 503 payload when set', async () => {
      updateMaintenanceModeState({ enabled: true, reason: 'DB migration' });
      const res = await request(app)
        .post('/auth/login')
        .send({});
      expect(res.status).toBe(503);
      expect(res.body.message).toContain('DB migration');
    });

    it('allows POST to /admin/maintenance even when maintenance is enabled', async () => {
      updateMaintenanceModeState({ enabled: true });
      const res = await request(app)
        .post('/admin/maintenance')
        .set(AUTH_HEADER)
        .send({ enabled: false });
      expect(res.status).toBe(200);
    });

    it('passes through when maintenance is disabled', async () => {
      updateMaintenanceModeState({ enabled: false });
      const res = await request(app).get('/health');
      expect(res.status).not.toBe(503);
    });
  });

  describe('GET /admin/maintenance', () => {
    it('returns current maintenance state', async () => {
      const res = await request(app).get('/admin/maintenance').set(AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(res.body.maintenance).toHaveProperty('enabled');
      expect(res.body.maintenance).toHaveProperty('retryAfterSeconds');
    });
  });

  describe('POST /admin/maintenance', () => {
    it('enables maintenance mode', async () => {
      const res = await request(app)
        .post('/admin/maintenance')
        .set(AUTH_HEADER)
        .send({ enabled: true, reason: 'Test maintenance' });
      expect(res.status).toBe(200);
      expect(res.body.maintenance.enabled).toBe(true);
      expect(res.body.maintenance.reason).toBe('Test maintenance');
    });

    it('disables maintenance mode', async () => {
      updateMaintenanceModeState({ enabled: true });
      const res = await request(app)
        .post('/admin/maintenance')
        .set(AUTH_HEADER)
        .send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.maintenance.enabled).toBe(false);
    });

    it('returns 400 when enabled is missing', async () => {
      const res = await request(app)
        .post('/admin/maintenance')
        .set(AUTH_HEADER)
        .send({ reason: 'no enabled field' });
      expect(res.status).toBe(400);
    });

    it('persists state visible via GET', async () => {
      await request(app)
        .post('/admin/maintenance')
        .set(AUTH_HEADER)
        .send({ enabled: true, reason: 'Persist test' });
      const state = getMaintenanceModeState();
      expect(state.enabled).toBe(true);
      expect(state.reason).toBe('Persist test');
    });
  });
});

// ─── #480: Cursor-Based Webhook Pagination ────────────────────────────────────

describe('#480 Webhook Cursor Pagination', () => {
  beforeEach(async () => resetWebhookState());
  afterEach(async () => resetWebhookState());

  async function seedDeliveries(count: number) {
    await registerWebhookEndpoint({ url: 'https://example.com/hook' });
    for (let i = 0; i < count; i++) {
      await emitTransactionEvent('transaction.deposit.created', {
        transactionId: `tx-${i}`,
        amount: '100',
        asset: 'USDC',
        walletAddress: 'GTEST',
        transactionHash: `hash-${i}`,
        status: 'completed',
        timestamp: new Date().toISOString(),
      });
    }
    // Allow micro-tasks to settle
    await new Promise((r) => setTimeout(r, 10));
  }

  it('returns deliveries with hasNextPage=false when under limit', async () => {
    await seedDeliveries(3);
    const res = await request(app)
      .get('/admin/webhooks/deliveries?limit=10')
      .set(AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.hasNextPage).toBe(false);
    expect(res.body.nextCursor).toBeUndefined();
    expect(Array.isArray(res.body.deliveries)).toBe(true);
  });

  it('returns nextCursor when more pages exist', async () => {
    await seedDeliveries(5);
    const res = await request(app)
      .get('/admin/webhooks/deliveries?limit=2')
      .set(AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.body.hasNextPage).toBe(true);
    expect(typeof res.body.nextCursor).toBe('string');
    expect(res.body.deliveries).toHaveLength(2);
  });

  it('paginates without duplicates across pages', async () => {
    await seedDeliveries(5);
    const page1 = await request(app)
      .get('/admin/webhooks/deliveries?limit=2')
      .set(AUTH_HEADER);
    expect(page1.status).toBe(200);

    const cursor = page1.body.nextCursor;
    const page2 = await request(app)
      .get(`/admin/webhooks/deliveries?limit=2&cursor=${cursor}`)
      .set(AUTH_HEADER);
    expect(page2.status).toBe(200);

    const ids1 = page1.body.deliveries.map((d: { id: string }) => d.id);
    const ids2 = page2.body.deliveries.map((d: { id: string }) => d.id);
    const overlap = ids1.filter((id: string) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('returns 400 for invalid cursor', async () => {
    const res = await request(app)
      .get('/admin/webhooks/deliveries?cursor=not-a-valid-cursor')
      .set(AUTH_HEADER);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Bad Request');
  });
});

// ─── #484: APY Backfill Endpoint ─────────────────────────────────────────────

describe('#484 APY Backfill', () => {
  describe('backfillApySnapshots()', () => {
    it('returns created/skipped counts', async () => {
      const result = await backfillApySnapshots('2025-01-01', '2025-01-03');
      expect(typeof result.created).toBe('number');
      expect(typeof result.skipped).toBe('number');
      expect(result.created + result.skipped).toBe(3);
    });

    it('does not duplicate on second run', async () => {
      await backfillApySnapshots('2025-02-01', '2025-02-02');
      const second = await backfillApySnapshots('2025-02-01', '2025-02-02');
      expect(second.created).toBe(0);
      expect(second.skipped).toBe(2);
    });
  });

  describe('POST /admin/apy/backfill', () => {
    it('returns 200 with job summary', async () => {
      const res = await request(app)
        .post('/admin/apy/backfill')
        .set(AUTH_HEADER)
        .send({ start: '2025-03-01', end: '2025-03-03' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('created');
      expect(res.body).toHaveProperty('skipped');
      expect(res.body).toHaveProperty('durationMs');
      expect(res.body.start).toBe('2025-03-01');
      expect(res.body.end).toBe('2025-03-03');
    });

    it('returns 400 when start/end are missing', async () => {
      const res = await request(app)
        .post('/admin/apy/backfill')
        .set(AUTH_HEADER)
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid date format', async () => {
      const res = await request(app)
        .post('/admin/apy/backfill')
        .set(AUTH_HEADER)
        .send({ start: '01-01-2025', end: '01-03-2025' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when end < start', async () => {
      const res = await request(app)
        .post('/admin/apy/backfill')
        .set(AUTH_HEADER)
        .send({ start: '2025-03-05', end: '2025-03-01' });
      expect(res.status).toBe(400);
    });
  });
});

// ─── #482: UTC Date Range Parser ─────────────────────────────────────────────

describe('#482 parseUtcDateRange', () => {
  it('normalizes YYYY-MM-DD from to start of day', () => {
    const result = parseUtcDateRange({ from: '2025-01-15' });
    expect(result.normalizedStart).toBe('2025-01-15T00:00:00.000Z');
  });

  it('normalizes YYYY-MM-DD to to end of day', () => {
    const result = parseUtcDateRange({ to: '2025-01-15' });
    expect(result.normalizedEnd).toBe('2025-01-15T23:59:59.999Z');
  });

  it('accepts ISO 8601 with timezone', () => {
    const result = parseUtcDateRange({ from: '2025-01-15T10:00:00+05:30' });
    expect(result.normalizedStart).toBeDefined();
    expect(result.normalizedStart).toMatch(/Z$/);
  });

  it('throws DateRangeParseError for ambiguous format (no timezone)', () => {
    expect(() => parseUtcDateRange({ from: '2025-01-15T10:00:00' })).toThrow(DateRangeParseError);
  });

  it('throws when end < start', () => {
    expect(() =>
      parseUtcDateRange({ from: '2025-01-20', to: '2025-01-10' })
    ).toThrow(DateRangeParseError);
  });

  it('throws when range exceeds max days', () => {
    expect(() =>
      parseUtcDateRange({ from: '2024-01-01', to: '2025-12-31' }, { maxRangeDays: 30 })
    ).toThrow(DateRangeParseError);
  });

  it('returns rawStart/rawEnd alongside normalized values', () => {
    const result = parseUtcDateRange({ from: '2025-06-01', to: '2025-06-30' });
    expect(result.rawStart).toBe('2025-06-01');
    expect(result.rawEnd).toBe('2025-06-30');
  });

  describe('GET /api/v1/transactions with date range', () => {
    it('returns 400 for ambiguous timestamp (no timezone)', async () => {
      const res = await request(app).get(
        '/api/v1/transactions?from=2025-01-15T10:00:00'
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
    });

    it('returns 200 with normalizedDateRange when valid dates provided', async () => {
      const res = await request(app).get(
        '/api/v1/transactions?from=2025-01-01&to=2025-01-31'
      );
      expect(res.status).toBe(200);
    });

    it('returns 400 when end < start', async () => {
      const res = await request(app).get(
        '/api/v1/transactions?from=2025-06-30&to=2025-01-01'
      );
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/vault/history with date range', () => {
    it('returns 400 for invalid date format', async () => {
      const res = await request(app).get(
        '/api/v1/vault/history?from=not-a-date'
      );
      expect(res.status).toBe(400);
    });

    it('returns 200 with valid date range', async () => {
      const res = await request(app).get(
        '/api/v1/vault/history?from=2025-01-01&to=2025-03-31'
      );
      expect(res.status).toBe(200);
    });
  });
});
