/**
 * @file payloadLimit.test.ts
 * Verifies that route-tier-specific payload size caps are enforced with
 * consistent 413 responses across auth, admin, and writes route groups.
 *
 * Strategy
 * ─────────
 * Each test builds an oversized JSON body that exceeds a tier's cap, sends it
 * to a representative endpoint for that tier, and asserts:
 *   - HTTP 413 status
 *   - Standard error envelope: { error, status, message, limit }
 *   - Content-Type: application/json
 *
 * We also verify the "happy path": a body *within* the cap is accepted (or
 * rejected for a business reason, never a 413).
 */

import request from 'supertest';
import app from '../index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates a JSON object whose serialized size is approximately `targetBytes`.
 * The object contains a single `pad` key whose string value fills the remainder.
 */
function buildBodyOfSize(targetBytes: number): Record<string, unknown> {
  const wrapper = '{"pad":""}';
  const padLength = Math.max(0, targetBytes - wrapper.length);
  return { pad: 'x'.repeat(padLength) };
}

/**
 * Convenience: build a Buffer of JSON whose byte size exceeds `limitBytes`.
 */
function oversizedBuffer(limitBytes: number): Buffer {
  // Add 512 bytes margin so we definitely exceed the cap even after JSON encode overhead.
  const body = buildBodyOfSize(limitBytes + 512);
  return Buffer.from(JSON.stringify(body), 'utf-8');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Payload Size Caps', () => {

  // ── Unit tests for the middleware module ────────────────────────────────────

  describe('resolvePayloadTier()', () => {
    const { resolvePayloadTier } = require('../middleware/payloadLimit');

    const req = (method: string, path: string, baseUrl = '') =>
      ({ method, path, baseUrl } as import('express').Request);

    it('selects auth for versioned and legacy auth paths', () => {
      expect(resolvePayloadTier(req('POST', '/login', '/api/v1/auth'))).toBe('auth');
      expect(resolvePayloadTier(req('POST', '/refresh', '/auth'))).toBe('auth');
    });

    it('selects admin for /admin routes', () => {
      expect(resolvePayloadTier(req('POST', '/apy/backfill', '/admin'))).toBe('admin');
      expect(resolvePayloadTier(req('GET', '/maintenance', '/admin'))).toBe('admin');
    });

    it('selects writes only for vault POST write endpoints', () => {
      expect(resolvePayloadTier(req('POST', '/api/v1/vault/deposits'))).toBe('writes');
      expect(resolvePayloadTier(req('POST', '/api/v1/vault/deposits/v2'))).toBe('writes');
      expect(resolvePayloadTier(req('POST', '/api/v1/vault/withdrawals'))).toBe('writes');
      expect(resolvePayloadTier(req('POST', '/api/v1/vault/strategy'))).toBe('writes');
      expect(resolvePayloadTier(req('GET', '/api/v1/vault/deposits'))).toBe('global');
      expect(resolvePayloadTier(req('POST', '/api/v1/vault/summary'))).toBe('global');
    });

    it('falls back to global for other routes', () => {
      expect(resolvePayloadTier(req('POST', '/api/v1/webhooks/verify'))).toBe('global');
    });
  });

  describe('resolveTierLimit()', () => {
    const { resolveTierLimit } = require('../middleware/payloadLimit');

    it('returns hardcoded default when env var is absent', () => {
      delete process.env.PAYLOAD_LIMIT_AUTH;
      expect(resolveTierLimit('auth')).toBe('4kb');
    });

    it('returns env override when set', () => {
      process.env.PAYLOAD_LIMIT_AUTH = '8kb';
      expect(resolveTierLimit('auth')).toBe('8kb');
      delete process.env.PAYLOAD_LIMIT_AUTH;
    });

    it('ignores blank env var and falls back to default', () => {
      process.env.PAYLOAD_LIMIT_GLOBAL = '   ';
      expect(resolveTierLimit('global')).toBe('1mb');
      delete process.env.PAYLOAD_LIMIT_GLOBAL;
    });

    it('returns correct defaults for all tiers', () => {
      ['PAYLOAD_LIMIT_GLOBAL', 'PAYLOAD_LIMIT_AUTH', 'PAYLOAD_LIMIT_ADMIN', 'PAYLOAD_LIMIT_WRITES']
        .forEach(k => delete process.env[k]);

      expect(resolveTierLimit('global')).toBe('1mb');
      expect(resolveTierLimit('auth')).toBe('4kb');
      expect(resolveTierLimit('admin')).toBe('16kb');
      expect(resolveTierLimit('writes')).toBe('32kb');
    });
  });

  // ── Auth tier (4 KB cap) ──────────────────────────────────────────────────

  describe('Auth tier – 4 KB cap', () => {
    const AUTH_LIMIT_BYTES = 4 * 1024; // 4096 bytes

    it('returns 413 with standard envelope when body exceeds 4 KB', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send(oversizedBuffer(AUTH_LIMIT_BYTES));

      expect(res.status).toBe(413);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toMatchObject({
        error: 'Payload Too Large',
        status: 413,
        limit: '4kb',
      });
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message.length).toBeGreaterThan(0);
    });

    it('does NOT return 413 when body is within 4 KB', async () => {
      // A valid (small) login body – will be rejected by validation (400) not size (413)
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send({ walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567', signature: 'sig' });

      expect(res.status).not.toBe(413);
    });

    it('returns 413 on auth/refresh with oversized body', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Content-Type', 'application/json')
        .send(oversizedBuffer(AUTH_LIMIT_BYTES));

      expect(res.status).toBe(413);
      expect(res.body.limit).toBe('4kb');
    });
  });

  // ── Admin tier (16 KB cap) ────────────────────────────────────────────────

  describe('Admin tier – 16 KB cap', () => {
    const ADMIN_LIMIT_BYTES = 16 * 1024; // 16384 bytes
    // A valid API key used to pass auth (accepted by the in-memory store in tests)
    const API_KEY_HEADER = { 'x-api-key': 'test-api-key' };

    it('returns 413 with standard envelope when body exceeds 16 KB', async () => {
      const res = await request(app)
        .post('/admin/apy/backfill')
        .set(API_KEY_HEADER)
        .set('Content-Type', 'application/json')
        .send(oversizedBuffer(ADMIN_LIMIT_BYTES));

      expect(res.status).toBe(413);
      expect(res.body).toMatchObject({
        error: 'Payload Too Large',
        status: 413,
        limit: '16kb',
      });
    });

    it('does NOT return 413 when body is within 16 KB', async () => {
      const res = await request(app)
        .post('/admin/apy/backfill')
        .set(API_KEY_HEADER)
        .set('Content-Type', 'application/json')
        .send({ start: '2024-01-01', end: '2024-01-31' });

      // Will be 401 (no valid API key in test env) or 400/200 – never 413
      expect(res.status).not.toBe(413);
    });

    it('returns 413 on admin/maintenance with oversized body', async () => {
      const res = await request(app)
        .post('/admin/maintenance')
        .set(API_KEY_HEADER)
        .set('Content-Type', 'application/json')
        .send(oversizedBuffer(ADMIN_LIMIT_BYTES));

      expect(res.status).toBe(413);
      expect(res.body.limit).toBe('16kb');
    });
  });

  // ── Writes tier (32 KB cap) ───────────────────────────────────────────────

  describe('Writes tier – 32 KB cap', () => {
    const WRITES_LIMIT_BYTES = 32 * 1024; // 32768 bytes

    it('returns 413 with standard envelope when body exceeds 32 KB on deposits', async () => {
      const res = await request(app)
        .post('/api/v1/vault/deposits')
        .set('Content-Type', 'application/json')
        .send(oversizedBuffer(WRITES_LIMIT_BYTES));

      expect(res.status).toBe(413);
      expect(res.body).toMatchObject({
        error: 'Payload Too Large',
        status: 413,
        limit: '32kb',
      });
    });

    it('does NOT return 413 when body is within 32 KB on deposits', async () => {
      const res = await request(app)
        .post('/api/v1/vault/deposits')
        .set('Content-Type', 'application/json')
        .send({
          amount: '100',
          asset: 'USDC',
          walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
        });

      // May be 400 (validation), 403 (allowlist), or 201 in test env – never 413
      expect(res.status).not.toBe(413);
    });

    it('returns 413 on withdrawals with oversized body', async () => {
      const res = await request(app)
        .post('/api/v1/vault/withdrawals')
        .set('Content-Type', 'application/json')
        .send(oversizedBuffer(WRITES_LIMIT_BYTES));

      expect(res.status).toBe(413);
      expect(res.body.limit).toBe('32kb');
    });
  });

  // ── 413 response shape ────────────────────────────────────────────────────

  describe('413 response envelope shape', () => {
    const AUTH_LIMIT_BYTES = 4 * 1024;

    it('always returns all required fields', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send(oversizedBuffer(AUTH_LIMIT_BYTES));

      expect(res.status).toBe(413);
      expect(res.body).toHaveProperty('error', 'Payload Too Large');
      expect(res.body).toHaveProperty('status', 413);
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('limit');
      expect(typeof res.body.message).toBe('string');
      expect(typeof res.body.limit).toBe('string');
    });

    it('does not expose internal stack traces in 413 responses', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send(oversizedBuffer(AUTH_LIMIT_BYTES));

      expect(res.body).not.toHaveProperty('stack');
      expect(res.body.message).not.toMatch(/at .+:\d+/);
    });
  });

  // ── Global fallback (1 MB cap) ────────────────────────────────────────────

  describe('Global tier – 1 MB baseline cap', () => {
    const ONE_MB_BYTES = 1024 * 1024;

    it('returns 413 when body exceeds 1 MB on a generic read endpoint', async () => {
      // GET /api/v1/vault/summary doesn't have a write-tier parser,
      // but the global 1 MB cap still applies for POST attempts.
      // We use the webhook verify endpoint as it accepts POST with a body.
      const res = await request(app)
        .post('/api/v1/webhooks/verify')
        .set('Content-Type', 'application/json')
        .send(oversizedBuffer(ONE_MB_BYTES));

      expect(res.status).toBe(413);
      expect(res.body).toMatchObject({
        error: 'Payload Too Large',
        status: 413,
        limit: '1mb',
      });
    });
  });
});
