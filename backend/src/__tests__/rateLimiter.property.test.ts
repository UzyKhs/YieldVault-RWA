/**
 * @file rateLimiter.property.test.ts
 * Property-style tests for the Redis-backed rate limiter.
 */

import express, { Request, Response } from 'express';
import request from 'supertest';

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomAlphaNumeric(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

// Helper: build a minimal express app with a fresh in-memory limiter
function buildApp(max: number, windowMs = 60000) {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createLimiter } = require('../rateLimiter');
  const app = express();
  app.use(express.json());
  const limiter = createLimiter({ routePrefix: '/prop-test', max, windowMs });
  app.get('/test', limiter, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  return app;
}

// ─── Property 5: Requests beyond the limit receive 429 with required headers/body ──

// Feature: redis-rate-limiting, Property 5: 429 headers and body
describe('Property 5: Requests beyond the limit receive 429 with required headers and body', () => {
  it('holds for randomly generated limit values', async () => {
    for (let run = 0; run < 10; run++) {
      const limit = randomInt(1, 20);
      const app = buildApp(limit);
      const key = `wallet-p5-${limit}-${run}-${Date.now()}`;

      for (let i = 0; i < limit; i++) {
        await request(app).get('/test').set('x-api-key', key);
      }

      const res = await request(app).get('/test').set('x-api-key', key);
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBeTruthy();
      expect(res.headers['ratelimit-limit']).toBeTruthy();
      expect(res.headers['ratelimit-remaining']).toBeTruthy();
      expect(res.headers['ratelimit-reset']).toBeTruthy();

      const body = res.body as Record<string, unknown>;
      expect(body.error).toBeTruthy();
      expect(body.status).toBe(429);
      expect(body.message).toBeTruthy();
      expect(typeof body.retryAfter).toBe('number');
    }
  });
});

// ─── Property 6: Requests within the limit include rate-limit headers ────────

// Feature: redis-rate-limiting, Property 6: 200 includes rate-limit headers
describe('Property 6: Requests within the limit include rate-limit headers', () => {
  it('holds for randomly generated request counts within limit', async () => {
    for (let run = 0; run < 10; run++) {
      const count = randomInt(1, 10);
      const limit = count + 5;
      const app = buildApp(limit);
      const key = `wallet-p6-${count}-${run}-${Date.now()}`;

      for (let i = 0; i < count; i++) {
        const res = await request(app).get('/test').set('x-api-key', key);
        expect(res.status).toBe(200);
        expect(res.headers['ratelimit-limit']).toBeTruthy();
        expect(res.headers['ratelimit-remaining']).toBeTruthy();
        expect(res.headers['ratelimit-reset']).toBeTruthy();
      }
    }
  });
});

// ─── Property 7: Counter initialises to 1 on first request in a window ───────

// Feature: redis-rate-limiting, Property 7: Counter initialises to 1
describe('Property 7: Counter initialises to 1 on first request in a window', () => {
  it('RateLimit-Remaining equals limit-1 after first request', async () => {
    for (let run = 0; run < 10; run++) {
      const limit = randomInt(2, 30);
      const walletSuffix = randomAlphaNumeric(randomInt(5, 20));
      const app = buildApp(limit);
      const key = `wallet-p7-${walletSuffix}-${run}`;

      const res = await request(app).get('/test').set('x-api-key', key);
      expect(res.status).toBe(200);

      const remaining = parseInt(res.headers['ratelimit-remaining'] as string, 10);
      expect(remaining).toBe(limit - 1);
    }
  });
});

// ─── Property 8: Log fields and PII masking ───────────────────────────────────

// Feature: redis-rate-limiting, Property 8: Log fields and PII masking
describe('Property 8: Rate-limit log entries contain required fields without exposing full wallet address', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('log contains required fields and masks wallet in production', async () => {
    for (let run = 0; run < 10; run++) {
      const walletAddress = randomAlphaNumeric(randomInt(10, 40));

      process.env = { ...originalEnv, NODE_ENV: 'production' };
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createLimiter } = require('../rateLimiter');

      const logEntries: Record<string, unknown>[] = [];
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation((msg: string) => {
        try {
          logEntries.push(JSON.parse(msg));
        } catch {
          // Ignore non-JSON log lines.
        }
      });

      const app = express();
      app.use(express.json());
      const limiter = createLimiter({ routePrefix: '/prop-p8', max: 1, windowMs: 60000 });
      app.get('/test', limiter, (_req: Request, res: Response) => res.json({ ok: true }));

      await request(app).get('/test').set('x-wallet-address', walletAddress);
      await request(app).get('/test').set('x-wallet-address', walletAddress);

      consoleSpy.mockRestore();

      const rateLimitedLog = logEntries.find((e) => e.event === 'rate_limited');
      expect(rateLimitedLog).toBeTruthy();
      expect(rateLimitedLog?.path).toBeTruthy();
      expect(rateLimitedLog?.resetTime).toBeDefined();
      expect(rateLimitedLog?.key).toBeTruthy();
      if (walletAddress.length > 8) {
        expect(rateLimitedLog?.key).not.toBe(walletAddress);
      }
    }
  });
});
