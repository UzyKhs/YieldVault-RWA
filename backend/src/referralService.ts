import { getPrismaClient } from './prismaClient';
import { logger } from './middleware/structuredLogging';

const getPrisma = () => getPrismaClient();

const REFERRAL_REWARD_PERCENTAGE = Number(process.env.REFERRAL_REWARD_PERCENTAGE || '0.05');
const REFERRAL_YIELD_PRECISION = 6;

function roundToPrecision(value: number, precision = REFERRAL_YIELD_PRECISION): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

type WalletTransactionType = 'deposit' | 'withdrawal';

interface WalletTransactionRecord {
  amount: string;
  type: WalletTransactionType;
  timestamp: Date;
}

interface SharePriceSnapshotRecord {
  sharePrice: string;
  recordedAt: Date;
}

function maskWalletAddress(walletAddress: string): string {
  if (walletAddress.length <= 10) {
    return walletAddress;
  }

  return `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
}

export class ReferralService {
  /**
   * Records a referral relationship if it doesn't exist.
   * Updates firstDepositAt if it's the user's first deposit.
   */
  async recordDeposit(walletAddress: string, referralCode?: string): Promise<void> {
    const prisma = getPrisma();
    try {
      await prisma.$transaction(async (tx) => {
        if (referralCode) {
          const code = await tx.referralCode.findUnique({
            where: { code: referralCode },
          });

          if (code) {
            const existing = await tx.referral.findUnique({
              where: { referredAddress: walletAddress },
            });

            if (!existing) {
              await tx.referral.create({
                data: {
                  referrerAddress: code.ownerAddress,
                  referredAddress: walletAddress,
                },
              });
              logger.log('info', 'New referral relationship recorded', {
                referrer: code.ownerAddress,
                referred: walletAddress,
              });
            }
          }
        }

        const referral = await tx.referral.findUnique({
          where: { referredAddress: walletAddress },
        });

        if (referral && !referral.firstDepositAt) {
          await tx.referral.update({
            where: { referredAddress: walletAddress },
            data: { firstDepositAt: new Date() },
          });
          logger.log('info', 'First deposit timestamp recorded for referral', {
            referred: walletAddress,
          });
        }
      });
    } catch (error) {
      logger.log('error', 'Failed to record referral deposit', {
        error: error instanceof Error ? error.message : String(error),
        walletAddress,
      });
    }
  }

  /**
   * Calculates total rewards for a referrer.
   * Rewards are computed from referred wallet net yield with 6-decimal precision.
   */
  async getReferralStats(
    referrerAddress: string,
  ): Promise<{ referral_count: number; total_reward_earned: string } | null> {
    const prisma = getPrisma();
    const referrals = await prisma.referral.findMany({
      where: {
        referrerAddress,
        firstDepositAt: { not: null },
      },
    });

    if (referrals.length === 0) {
      return null;
    }

    let totalReward = 0;
    let profitableReferrals = 0;

    for (const ref of referrals) {
      const yieldEarned = await this.calculateUserYield(ref.referredAddress);
      if (yieldEarned > 0) {
        const reward = yieldEarned * REFERRAL_REWARD_PERCENTAGE;
        totalReward += reward;
        profitableReferrals += 1;
      }
    }

    const roundedReward = roundToPrecision(totalReward);

    logger.log('info', 'Referral reward summary computed', {
      referrer: maskWalletAddress(referrerAddress),
      referralCount: referrals.length,
      profitableReferrals,
      totalRewardEarned: roundedReward.toFixed(REFERRAL_YIELD_PRECISION),
    });

    return {
      referral_count: referrals.length,
      total_reward_earned: roundedReward.toFixed(REFERRAL_YIELD_PRECISION),
    };
  }

  /**
   * Calculates user net yield from transaction history and share price snapshots.
   */
  private async calculateUserYield(walletAddress: string): Promise<number> {
    const prisma = getPrisma();
    const [transactions, snapshots] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          user: walletAddress,
          type: { in: ['deposit', 'withdrawal'] },
        },
        orderBy: { timestamp: 'asc' },
        select: {
          amount: true,
          type: true,
          timestamp: true,
        },
      }),
      prisma.sharePriceSnapshot.findMany({
        orderBy: { recordedAt: 'asc' },
        select: {
          sharePrice: true,
          recordedAt: true,
        },
      }),
    ]);

    if (transactions.length === 0 || snapshots.length === 0) {
      logger.log('info', 'Referral yield calculation skipped due to missing historical data', {
        wallet: maskWalletAddress(walletAddress),
        transactionCount: transactions.length,
        snapshotCount: snapshots.length,
      });
      return 0;
    }

    let shareBalance = 0;
    let totalDeposited = 0;
    let totalWithdrawn = 0;
    let depositCount = 0;
    let withdrawalCount = 0;

    for (const transaction of transactions as WalletTransactionRecord[]) {
      const sharePrice = this.getSharePriceForTimestamp(
        snapshots as SharePriceSnapshotRecord[],
        transaction.timestamp,
      );
      if (sharePrice <= 0) {
        logger.log('warn', 'Referral yield calculation aborted due to invalid share price', {
          wallet: maskWalletAddress(walletAddress),
          transactionTimestamp: transaction.timestamp.toISOString(),
          transactionType: transaction.type,
        });
        return 0;
      }

      const amount = Number(transaction.amount);

      if (transaction.type === 'deposit') {
        depositCount += 1;
        totalDeposited += amount;
        shareBalance += amount / sharePrice;
      } else {
        withdrawalCount += 1;
        totalWithdrawn += amount;
        shareBalance -= amount / sharePrice;
      }
    }

    const latestSnapshot = snapshots[snapshots.length - 1];
    const latestSharePrice = Number(latestSnapshot.sharePrice);
    const endingValue = shareBalance * latestSharePrice;
    const netYield = endingValue + totalWithdrawn - totalDeposited;

    logger.log('info', 'Referral yield calculated from history', {
      wallet: maskWalletAddress(walletAddress),
      transactionCount: transactions.length,
      depositCount,
      withdrawalCount,
      snapshotCount: snapshots.length,
      latestSnapshotAt: latestSnapshot.recordedAt.toISOString(),
      latestSharePrice: latestSharePrice.toFixed(REFERRAL_YIELD_PRECISION),
      totalDeposited: totalDeposited.toFixed(REFERRAL_YIELD_PRECISION),
      totalWithdrawn: totalWithdrawn.toFixed(REFERRAL_YIELD_PRECISION),
      endingValue: endingValue.toFixed(REFERRAL_YIELD_PRECISION),
      netYield: netYield.toFixed(REFERRAL_YIELD_PRECISION),
    });

    return roundToPrecision(netYield);
  }

  private getSharePriceForTimestamp(
    snapshots: SharePriceSnapshotRecord[],
    timestamp: Date,
  ): number {
    let candidate = snapshots[0];

    for (const snapshot of snapshots) {
      if (snapshot.recordedAt.getTime() > timestamp.getTime()) {
        break;
      }
      candidate = snapshot;
    }

    return Number(candidate.sharePrice);
  }

  /**
   * Get or create a referral code for a wallet address.
   */
  async getOrCreateReferralCode(ownerAddress: string): Promise<string> {
    const prisma = getPrisma();

    const existing = await prisma.referralCode.findFirst({
      where: { ownerAddress },
    });

    if (existing) {
      return existing.code;
    }

    let code: string;
    let attempts = 0;
    do {
      code = this.generateReferralCode();
      attempts++;
      if (attempts > 10) {
        throw new Error('Failed to generate unique referral code after 10 attempts');
      }
    } while (await prisma.referralCode.findUnique({ where: { code } }));

    await prisma.referralCode.create({
      data: { code, ownerAddress },
    });

    return code;
  }

  private generateReferralCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Create a referral code for a wallet (helper for tests).
   */
  async createReferralCode(ownerAddress: string, code: string): Promise<void> {
    const prisma = getPrisma();
    await prisma.referralCode.create({
      data: { code, ownerAddress },
    });
  }
}

export const referralService = new ReferralService();
