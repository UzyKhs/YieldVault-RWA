import request from 'supertest';
import app from '../index';
import { prisma } from '../prisma';
import { clearAdminAuditLogsForTests } from '../adminAudit';
import { clearWithdrawalLimitStateForTests } from '../middleware/withdrawalDailyLimit';
import { registerApiKey } from '../middleware/apiKeyAuth';
import { normalizeWalletAddress } from '../walletUtils';

describe('Withdrawal daily limit guard', () => {
  const superAdminApiKey = 'super-admin-withdrawal-key';
  const walletAddress = `G${'A'.repeat(55)}`;

  beforeEach(async () => {
    clearAdminAuditLogsForTests();
    clearWithdrawalLimitStateForTests();
    process.env.ALLOWLIST_ENABLED = 'false';
    process.env.WITHDRAWAL_DAILY_LIMIT_USDC = '1000';
    registerApiKey(superAdminApiKey, { role: 'super-admin' });
    await prisma.transaction.deleteMany({ where: { user: walletAddress, type: 'withdrawal' } });
  });

  async function seedWithdrawals(total: string) {
    await prisma.transaction.create({
      data: {
        id: `seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        user: walletAddress,
        amount: total,
        type: 'withdrawal',
        timestamp: new Date(),
      },
    });
  }

  it('blocks withdrawals that exceed the configured daily limit', async () => {
    await seedWithdrawals('900');

    const response = await request(app)
      .post('/api/v1/vault/withdrawals')
      .send({ amount: 200, asset: 'USDC', walletAddress });

    expect(response.status).toBe(429);
    expect(response.body.message).toMatch(/daily withdrawal limit/i);
    expect(response.body.limit).toMatchObject({
      dailyLimit: '1000',
      usedToday: '900',
      remaining: '100',
      requested: '200',
    });
    expect(response.body.limit.resetsAt).toBeTruthy();
  });

  it('allows admin override with reason for super-admins', async () => {
    await seedWithdrawals('900');

    const response = await request(app)
      .post('/api/v1/vault/withdrawals')
      .set('Authorization', `ApiKey ${superAdminApiKey}`)
      .set('x-admin-override-withdrawal', 'true')
      .set('x-admin-id', 'GADMIN000000000000000000000000000000000000000000000001')
      .send({
        amount: 200,
        asset: 'USDC',
        walletAddress,
        overrideReason: 'manual fraud review clearance',
      });

    expect(response.status).not.toBe(429);
    expect(response.body.message || '').not.toMatch(/daily withdrawal limit/i);
  });

  it('creates a temporary override via admin endpoint', async () => {
    const response = await request(app)
      .post('/admin/withdrawal-limits/override')
      .set('Authorization', `ApiKey ${superAdminApiKey}`)
      .set('x-admin-id', 'GADMIN000000000000000000000000000000000000000000000001')
      .send({
        walletAddress,
        reason: 'support ticket #991',
        ttlSeconds: 1800,
      });

    expect(response.status).toBe(201);
    expect(response.body.override).toMatchObject({
      wallet: walletAddress,
      reason: 'support ticket #991',
    });
  });
});
