import request from 'supertest';
import app from '../index';
import { VALID_TEST_WALLET } from './setup';

describe('Schema validation middleware', () => {
  // ─── POST /api/v1/auth/login ──────────────────────────────────────────────

  describe('POST /api/v1/auth/login', () => {
    it('rejects missing walletAddress with 400', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
      expect(res.body.details).toBeDefined();
    });

    it('rejects invalid wallet address format with 400', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ walletAddress: 'not-a-stellar-address' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/wallet/i);
    });

    it('rejects unknown fields with 400', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ walletAddress: VALID_TEST_WALLET, extra: 'field' });
      expect(res.status).toBe(400);
    });

    it('accepts a valid Stellar wallet address', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ walletAddress: VALID_TEST_WALLET });
      expect(res.status).toBe(200);
    });
  });

  // ─── POST /api/v1/auth/refresh ────────────────────────────────────────────

  describe('POST /api/v1/auth/refresh', () => {
    it('rejects missing refreshToken with 400', async () => {
      const res = await request(app).post('/api/v1/auth/refresh').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
    });

    it('rejects unknown fields with 400', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'sometoken', extra: true });
      expect(res.status).toBe(400);
    });

    it('returns 401 (not 400) for a syntactically valid but unknown token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'valid-looking-but-unknown-token' });
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /api/v1/vault/deposits ─────────────────────────────────────────

  describe('POST /api/v1/vault/deposits', () => {
    const validPayload = {
      amount: 100,
      asset: 'USDC',
      walletAddress: VALID_TEST_WALLET,
    };

    it('rejects missing required fields with 400', async () => {
      const res = await request(app).post('/api/v1/vault/deposits').send({ asset: 'USDC' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
      expect(Array.isArray(res.body.details)).toBe(true);
    });

    it('rejects amount <= 0 with 400', async () => {
      const res = await request(app)
        .post('/api/v1/vault/deposits')
        .send({ ...validPayload, amount: 0 });
      expect(res.status).toBe(400);
    });

    it('rejects invalid wallet address with 400', async () => {
      const res = await request(app)
        .post('/api/v1/vault/deposits')
        .send({ ...validPayload, walletAddress: 'bad-address' });
      expect(res.status).toBe(400);
    });

    it('rejects invalid email format with 400', async () => {
      const res = await request(app)
        .post('/api/v1/vault/deposits')
        .send({ ...validPayload, email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    it('rejects unknown fields with 400', async () => {
      const res = await request(app)
        .post('/api/v1/vault/deposits')
        .send({ ...validPayload, unknownField: 'value' });
      expect(res.status).toBe(400);
    });

    it('accepts a valid payload and reaches business logic', async () => {
      const res = await request(app)
        .post('/api/v1/vault/deposits')
        .send(validPayload);
      // 201 = success, 503 = circuit open, 429 = rate limited — all mean validation passed
      expect([201, 503, 429]).toContain(res.status);
    });

    it('accepts numeric string amount', async () => {
      const res = await request(app)
        .post('/api/v1/vault/deposits')
        .send({ ...validPayload, amount: '50.5' });
      expect([201, 503, 429]).toContain(res.status);
    });
  });

  // ─── POST /api/v1/vault/withdrawals ──────────────────────────────────────

  describe('POST /api/v1/vault/withdrawals', () => {
    const validPayload = {
      amount: 50,
      asset: 'USDC',
      walletAddress: VALID_TEST_WALLET,
    };

    it('rejects missing walletAddress with 400', async () => {
      const res = await request(app)
        .post('/api/v1/vault/withdrawals')
        .send({ amount: 50, asset: 'USDC' });
      expect(res.status).toBe(400);
    });

    it('rejects negative amount with 400', async () => {
      const res = await request(app)
        .post('/api/v1/vault/withdrawals')
        .send({ ...validPayload, amount: -10 });
      expect(res.status).toBe(400);
    });

    it('accepts a valid payload and reaches business logic', async () => {
      const res = await request(app)
        .post('/api/v1/vault/withdrawals')
        .send(validPayload);
      expect([201, 503, 429]).toContain(res.status);
    });
  });
});
