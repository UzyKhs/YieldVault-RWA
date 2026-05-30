/**
 * Tests for server-side wallet nonce tracking and signed action verification.
 */

import request from 'supertest';
import app from '../index';
import { walletNonceService } from '../walletNonce';
import {
  buildWalletSignMessage,
  signWalletActionForTests,
} from '../walletSignature';

const TEST_WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function enableNonceEnforcement(): void {
  process.env.WALLET_NONCE_ENFORCEMENT = 'strict';
  process.env.WALLET_SIGNATURE_MODE = 'hmac';
}

function disableNonceEnforcement(): void {
  delete process.env.WALLET_NONCE_ENFORCEMENT;
  delete process.env.WALLET_SIGNATURE_MODE;
}

async function issueAndSign(action: 'login' | 'deposit' | 'withdrawal') {
  const nonceRes = await request(app)
    .post('/api/v1/auth/nonce')
    .send({ walletAddress: TEST_WALLET, action });

  expect(nonceRes.status).toBe(200);
  const { nonce, issuedAt, expiresAt } = nonceRes.body;

  const signature = signWalletActionForTests({
    walletAddress: TEST_WALLET,
    action,
    nonce,
    issuedAt,
    expiresAt,
  });

  return { nonce, signature };
}

describe('Wallet nonce service', () => {
  beforeEach(() => {
    walletNonceService.clearForTests();
    enableNonceEnforcement();
  });

  afterEach(() => {
    disableNonceEnforcement();
  });

  it('issues a nonce with expiry metadata', async () => {
    const res = await request(app)
      .post('/api/v1/auth/nonce')
      .send({ walletAddress: TEST_WALLET, action: 'login' });

    expect(res.status).toBe(200);
    expect(res.body.nonce).toMatch(/^[a-f0-9]{48}$/);
    expect(res.body.expiresIn).toBeGreaterThan(0);
    expect(res.body.message).toContain('YieldVault Signed Action');
    expect(res.body.message).toContain(res.body.nonce);
  });

  it('rejects replay of the same nonce on login', async () => {
    const { nonce, signature } = await issueAndSign('login');

    const first = await request(app)
      .post('/api/v1/auth/login')
      .send({ walletAddress: TEST_WALLET, nonce, signature });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post('/api/v1/auth/login')
      .send({ walletAddress: TEST_WALLET, nonce, signature });

    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('NONCE_REPLAY');
    expect(replay.body.error).toBe('Nonce Replay');
  });

  it('rejects login when signature does not match', async () => {
    const { nonce } = await issueAndSign('login');

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ walletAddress: TEST_WALLET, nonce, signature: 'deadbeef'.repeat(8) });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SIGNATURE_INVALID');
  });

  it('rejects expired nonces', async () => {
    const issued = await walletNonceService.issue(
      TEST_WALLET,
      'login',
      (base) =>
        buildWalletSignMessage({
          walletAddress: base.walletAddress,
          action: base.action,
          nonce: base.nonce,
          issuedAt: base.issuedAt,
          expiresAt: base.expiresAt,
        }),
    );

    await walletNonceService.expireNonceForTests(issued.nonce);

    const signature = signWalletActionForTests({
      walletAddress: TEST_WALLET,
      action: 'login',
      nonce: issued.nonce,
      issuedAt: issued.issuedAt,
      expiresAt: issued.expiresAt,
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ walletAddress: TEST_WALLET, nonce: issued.nonce, signature });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('NONCE_EXPIRED');
    expect(res.body.error).toBe('Nonce Expired');
  });

  it('rejects vault deposit when nonce was issued for login', async () => {
    const { nonce, signature } = await issueAndSign('login');

    const res = await request(app)
      .post('/api/v1/vault/deposits')
      .send({
        walletAddress: TEST_WALLET,
        nonce,
        signature,
        amount: '100',
        asset: 'USDC',
      });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('NONCE_ACTION_MISMATCH');
  });
});

describe('Wallet nonce enforcement flag', () => {
  beforeEach(() => {
    walletNonceService.clearForTests();
    disableNonceEnforcement();
  });

  it('allows login without nonce when enforcement is off', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ walletAddress: TEST_WALLET });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });
});
