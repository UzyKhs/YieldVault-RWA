import Decimal from 'decimal.js';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma';
import { normalizeWalletAddress } from '../walletUtils';
import { recordAdminAuditLog } from '../adminAudit';
import { hasRequiredApiKeyRole, authenticateApiKeyValue } from './apiKeyAuth';

export interface WithdrawalLimitCheckResult {
  allowed: boolean;
  limit: string;
  used: string;
  remaining: string;
  requested: string;
  resetsAt: string;
  overridden: boolean;
}

interface WithdrawalLimitOverrideRecord {
  wallet: string;
  reason: string;
  actor: string;
  expiresAt: string;
  createdAt: string;
}

const inMemoryOverrides = new Map<string, WithdrawalLimitOverrideRecord>();
const inMemoryAuditLog: Array<Record<string, unknown>> = [];

function getDailyLimit(): Decimal {
  const raw = process.env.WITHDRAWAL_DAILY_LIMIT_USDC || '10000';
  const parsed = new Decimal(raw);
  if (!parsed.isFinite() || parsed.lte(0)) {
    return new Decimal(10000);
  }
  return parsed;
}

function getUtcDayBounds(now = new Date()): { start: Date; end: Date; resetsAt: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    start,
    end,
    resetsAt: end.toISOString(),
  };
}

async function sumWithdrawalsForDay(wallet: string, start: Date, end: Date): Promise<Decimal> {
  const rows = await prisma.transaction.findMany({
    where: {
      user: wallet,
      type: 'withdrawal',
      timestamp: {
        gte: start,
        lt: end,
      },
    },
    select: { amount: true },
  });

  return rows.reduce((total: Decimal, row: { amount: string }) => total.plus(new Decimal(row.amount || '0')), new Decimal(0));
}

function getActiveOverride(wallet: string): WithdrawalLimitOverrideRecord | null {
  const override = inMemoryOverrides.get(wallet);
  if (!override) {
    return null;
  }
  if (Date.parse(override.expiresAt) <= Date.now()) {
    inMemoryOverrides.delete(wallet);
    return null;
  }
  return override;
}

export function setWithdrawalLimitOverride(
  wallet: string,
  reason: string,
  actor: string,
  ttlSeconds = 3600,
): WithdrawalLimitOverrideRecord {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const record: WithdrawalLimitOverrideRecord = {
    wallet: normalizedWallet,
    reason: reason.trim(),
    actor,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
  inMemoryOverrides.set(normalizedWallet, record);
  return record;
}

export async function evaluateWithdrawalLimit(
  walletAddress: string,
  amount: number | string,
  options: { overridden?: boolean } = {},
): Promise<WithdrawalLimitCheckResult> {
  const wallet = normalizeWalletAddress(walletAddress);
  const limit = getDailyLimit();
  const requested = new Decimal(amount);
  const { start, end, resetsAt } = getUtcDayBounds();
  const used = await sumWithdrawalsForDay(wallet, start, end);
  const remaining = Decimal.max(limit.minus(used), 0);
  const overrideActive = Boolean(getActiveOverride(wallet));
  const overridden = options.overridden === true || overrideActive;

  return {
    allowed: overridden || used.plus(requested).lte(limit),
    limit: limit.toString(),
    used: used.toString(),
    remaining: remaining.toString(),
    requested: requested.toString(),
    resetsAt,
    overridden,
  };
}

export function withdrawalDailyLimitMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const walletAddress = req.body?.walletAddress as string | undefined;
    const amount = req.body?.amount;

    if (!walletAddress || amount === undefined) {
      next();
      return;
    }

    const adminOverrideRequested =
      req.get('x-admin-override-withdrawal') === 'true' ||
      req.get('x-withdrawal-limit-override') === 'true';

    if (adminOverrideRequested) {
      const authHeader = req.get('authorization') || '';
      const apiKeyMatch = authHeader.match(/^ApiKey\s+(.+)$/i);
      if (apiKeyMatch) {
        const authenticated = authenticateApiKeyValue(apiKeyMatch[1]);
        if (authenticated) {
          req.authApiKeyHash = authenticated.hash;
          req.authApiKeyRole = authenticated.role;
        }
      }
    }

    const overridden =
      adminOverrideRequested &&
      hasRequiredApiKeyRole(req, 'super-admin') &&
      typeof req.body?.overrideReason === 'string' &&
      req.body.overrideReason.trim().length > 0;

    if (adminOverrideRequested && !overridden) {
      await recordAdminAuditLog(req, 'withdrawal.limit.override.denied', 403, {
        walletAddress,
        reason: 'Super-admin role and overrideReason are required for withdrawal limit override',
      });
      res.status(403).json({
        error: 'Forbidden',
        status: 403,
        message: 'Super-admin role and overrideReason are required to override withdrawal limits',
      });
      return;
    }

    const evaluation = await evaluateWithdrawalLimit(walletAddress, amount, { overridden });

    if (!evaluation.allowed) {
      await recordAdminAuditLog(req, 'withdrawal.limit.blocked', 429, {
        walletAddress: normalizeWalletAddress(walletAddress),
        ...evaluation,
      });
      inMemoryAuditLog.unshift({
        type: 'blocked',
        walletAddress: normalizeWalletAddress(walletAddress),
        ...evaluation,
        at: new Date().toISOString(),
      });
      res.status(429).json({
        error: 'Too Many Requests',
        status: 429,
        message: 'Daily withdrawal limit exceeded',
        limit: {
          dailyLimit: evaluation.limit,
          usedToday: evaluation.used,
          remaining: evaluation.remaining,
          requested: evaluation.requested,
          resetsAt: evaluation.resetsAt,
        },
      });
      return;
    }

    if (overridden) {
      await recordAdminAuditLog(req, 'withdrawal.limit.override', 200, {
        walletAddress: normalizeWalletAddress(walletAddress),
        overrideReason: req.body.overrideReason,
        ...evaluation,
      });
      inMemoryAuditLog.unshift({
        type: 'override',
        walletAddress: normalizeWalletAddress(walletAddress),
        overrideReason: req.body.overrideReason,
        ...evaluation,
        at: new Date().toISOString(),
      });
    }

    next();
  };
}

export function listWithdrawalLimitAuditEntries(limit = 50): Array<Record<string, unknown>> {
  return inMemoryAuditLog.slice(0, limit);
}

export function clearWithdrawalLimitStateForTests(): void {
  inMemoryOverrides.clear();
  inMemoryAuditLog.length = 0;
}
