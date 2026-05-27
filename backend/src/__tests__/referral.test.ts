import request from 'supertest';
import app from '../index';
import { getPrismaClient, disconnectPrismaClient } from '../prismaClient';
import Decimal from 'decimal.js';

// Use the centralized Prisma Client instance
const getPrisma = () => getPrismaClient();

describe('Referral System Integration', () => {
  const referrerWallet = 'G_REFERRER_WALLET_ADDRESS';
  const referredWallet = 'G_REFERRED_WALLET_ADDRESS';
  const secondReferredWallet = 'G_REFERRED_WALLET_ADDRESS_2';
  const nonProfitableWallet = 'G_REFERRED_WALLET_ADDRESS_3';
  const referralCode = 'WELCOME2026';
  const rewardRate = new Decimal(process.env.REFERRAL_REWARD_PERCENTAGE || '0.05');
  let baseReferralReward = new Decimal(0);

  const createTransaction = async (
    user: string,
    amount: string,
    type: 'deposit' | 'withdrawal',
    timestamp: string,
  ) => {
    const prisma = getPrisma();
    await prisma.transaction.create({
      data: {
        user,
        amount,
        type,
        referralCode,
        timestamp: new Date(timestamp),
      },
    });
  };

  beforeAll(async () => {
    // Clear relevant data
    const prisma = getPrisma();
    await prisma.referral.deleteMany();
    await prisma.referralCode.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.sharePriceSnapshot.deleteMany();

    await prisma.sharePriceSnapshot.createMany({
      data: [
        {
          sharePrice: '1.000000',
          recordedAt: new Date('2026-01-01T00:00:00.000Z'),
          ledgerSeq: 100,
        },
        {
          sharePrice: '1.200000',
          recordedAt: new Date('2026-01-10T00:00:00.000Z'),
          ledgerSeq: 200,
        },
        {
          sharePrice: '1.250000',
          recordedAt: new Date('2026-01-20T00:00:00.000Z'),
          ledgerSeq: 300,
        },
      ],
    });

    // Setup referral code
    await prisma.referralCode.create({
      data: {
        code: referralCode,
        ownerAddress: referrerWallet,
      },
    });

    // Seed one additional referral with explicit ledger-backed transaction history.
    await prisma.referral.create({
      data: {
        referrerAddress: referrerWallet,
        referredAddress: secondReferredWallet,
        firstDepositAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await createTransaction(secondReferredWallet, '100', 'deposit', '2026-01-02T00:00:00.000Z');
    await createTransaction(secondReferredWallet, '20', 'withdrawal', '2026-01-12T00:00:00.000Z');

    // Expected second wallet yield:
    // shares = 100/1.0 - 20/1.2 = 83.3333333333...
    // ending value = shares * 1.25 = 104.1666666666...
    // net yield = ending + withdrawn - deposited = 24.1666666666...
    // reward = 24.1666666666... * 0.05 = 1.2083333333...
    const wallet2Yield = new Decimal('100')
      .div('1')
      .minus(new Decimal('20').div('1.2'))
      .mul('1.25')
      .plus('20')
      .minus('100');
    baseReferralReward = wallet2Yield.mul(rewardRate).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);

    await prisma.referral.create({
      data: {
        referrerAddress: referrerWallet,
        referredAddress: nonProfitableWallet,
        firstDepositAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await createTransaction(nonProfitableWallet, '50', 'deposit', '2026-01-20T00:00:00.000Z');
  });

  afterAll(async () => {
    await disconnectPrismaClient();
  });

  describe('POST /api/v1/vault/deposits with referral', () => {
    it('should record referral relationship on first deposit', async () => {
      const response = await request(app)
        .post('/api/v1/vault/deposits')
        .send({
          amount: '1000',
          asset: 'USDC',
          walletAddress: referredWallet,
          referralCode: referralCode,
        });

      expect(response.status).toBe(201);

      // Verify referral record
      const prisma = getPrisma();
      const referral = await prisma.referral.findUnique({
        where: { referredAddress: referredWallet },
      });

      expect(referral).toBeDefined();
      expect(referral?.referrerAddress).toBe(referrerWallet);
      expect(referral?.firstDepositAt).not.toBeNull();
    });

    it('should not update firstDepositAt on subsequent deposits', async () => {
      const prisma = getPrisma();
      const referralBefore = await prisma.referral.findUnique({
        where: { referredAddress: referredWallet },
      });

      // Wait a bit to ensure timestamp would be different
      await new Promise(resolve => setTimeout(resolve, 100));

      await request(app)
        .post('/api/v1/vault/deposits')
        .send({
          amount: '500',
          asset: 'USDC',
          walletAddress: referredWallet,
          referralCode: referralCode,
        });

      const referralAfter = await prisma.referral.findUnique({
        where: { referredAddress: referredWallet },
      });

      expect(referralAfter?.firstDepositAt?.toISOString()).toBe(referralBefore?.firstDepositAt?.toISOString());
    });
  });

  describe('GET /api/v1/referrals/:wallet', () => {
    it('should return referral stats with 6-decimal precision', async () => {
      const response = await request(app).get(`/api/v1/referrals/${referrerWallet}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('referral_count', 3);
      expect(response.body.total_reward_earned).toBe(baseReferralReward.toFixed(6));
    });

    it('should return 404 for wallet with no referral activity', async () => {
      const response = await request(app).get('/api/v1/referrals/G_UNKNOWN_WALLET');
      expect(response.status).toBe(404);
    });
  });

  describe('Reward Calculation Precision', () => {
    it('should handle small yields with deterministic precision from snapshots', async () => {
      const smallReferredWallet = 'G_SMALL_REFERRED';
      const prisma = getPrisma();

      await prisma.referral.create({
        data: {
          referrerAddress: referrerWallet,
          referredAddress: smallReferredWallet,
          firstDepositAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });
      
      await createTransaction(smallReferredWallet, '0.012345', 'deposit', '2026-01-02T00:00:00.000Z');

      const response = await request(app).get(`/api/v1/referrals/${referrerWallet}`);

      const smallWalletYield = new Decimal('0.012345').mul(new Decimal('1.25').minus('1'));
      const smallWalletReward = smallWalletYield.mul(rewardRate);
      const expectedReward = baseReferralReward
        .plus(smallWalletReward)
        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP);

      expect(response.body.total_reward_earned).toBe(expectedReward.toFixed(6));
      expect(response.body.total_reward_earned).toMatch(/^\d+\.\d{6}$/);
    });

    it('should ignore referrals with zero or negative net yield', async () => {
      const response = await request(app).get(`/api/v1/referrals/${referrerWallet}`);

      // Non-profitable wallet contributes 0 reward even though it has referral + tx history.
      expect(response.status).toBe(200);
      expect(response.body.total_reward_earned).toBe('1.208488');
    });
  });
});
