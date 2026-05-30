import type { Request } from 'express';
import { prisma } from './prisma';
import { normalizeWalletAddress } from './walletUtils';

export type ImpersonationSessionStatus = 'active' | 'ended' | 'expired';

export type ImpersonationLedgerEventType =
  | 'session.started'
  | 'session.ended'
  | 'session.expired'
  | 'session.access';

export interface ImpersonationSessionRecord {
  id: string;
  actor: string;
  apiKeyHash: string;
  targetWallet: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  status: ImpersonationSessionStatus;
  ipAddress: string;
  userAgent: string;
}

export interface ImpersonationLedgerEntryRecord {
  id: string;
  sessionId: string;
  eventType: ImpersonationLedgerEventType;
  actor: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface StartImpersonationSessionInput {
  actor: string;
  apiKeyHash: string;
  targetWallet: string;
  reason: string;
  ipAddress: string;
  userAgent: string;
}

export interface ListImpersonationSessionsFilters {
  status?: ImpersonationSessionStatus | 'all';
  actor?: string;
  targetWallet?: string;
  limit: number;
}

type StorageMode = 'memory' | 'prisma' | 'hybrid';

const inMemorySessions = new Map<string, ImpersonationSessionRecord>();
const inMemoryLedger: ImpersonationLedgerEntryRecord[] = [];

function normalizeStorageMode(raw: string | undefined): StorageMode {
  if (raw === 'prisma' || raw === 'memory' || raw === 'hybrid') {
    return raw;
  }
  return 'hybrid';
}

function getSessionTtlMs(): number {
  const raw = process.env.IMPERSONATION_SESSION_TTL_SECONDS;
  const seconds = raw ? Number.parseInt(raw, 10) : 900;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 900_000;
  }
  return seconds * 1000;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveEffectiveStatus(
  session: ImpersonationSessionRecord,
  now = Date.now(),
): ImpersonationSessionStatus {
  if (session.status === 'ended') {
    return 'ended';
  }
  if (Date.parse(session.expiresAt) <= now) {
    return 'expired';
  }
  return session.status === 'active' ? 'active' : session.status;
}

function toSessionRecord(row: {
  id: string;
  actor: string;
  apiKeyHash: string;
  targetWallet: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  status: string;
  ipAddress: string;
  userAgent: string;
}): ImpersonationSessionRecord {
  return {
    id: row.id,
    actor: row.actor,
    apiKeyHash: row.apiKeyHash,
    targetWallet: row.targetWallet,
    reason: row.reason,
    startedAt: row.startedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    status: row.status as ImpersonationSessionStatus,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}

async function appendLedgerEntry(
  storageMode: StorageMode,
  entry: ImpersonationLedgerEntryRecord,
): Promise<void> {
  if (storageMode === 'memory') {
    inMemoryLedger.unshift(entry);
    return;
  }

  try {
    await prisma.adminImpersonationLedgerEntry.create({
      data: {
        id: entry.id,
        sessionId: entry.sessionId,
        eventType: entry.eventType,
        actor: entry.actor,
        metadata: JSON.stringify(entry.metadata),
      },
    });
  } catch {
    if (storageMode === 'prisma') {
      throw new Error('Failed to persist impersonation ledger entry');
    }
    inMemoryLedger.unshift(entry);
  }
}

async function persistSession(
  storageMode: StorageMode,
  session: ImpersonationSessionRecord,
): Promise<void> {
  if (storageMode === 'memory') {
    inMemorySessions.set(session.id, session);
    return;
  }

  try {
    await prisma.adminImpersonationSession.upsert({
      where: { id: session.id },
      create: {
        id: session.id,
        actor: session.actor,
        apiKeyHash: session.apiKeyHash,
        targetWallet: session.targetWallet,
        reason: session.reason,
        startedAt: new Date(session.startedAt),
        expiresAt: new Date(session.expiresAt),
        endedAt: session.endedAt ? new Date(session.endedAt) : null,
        status: session.status,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      },
      update: {
        endedAt: session.endedAt ? new Date(session.endedAt) : null,
        status: session.status,
      },
    });
  } catch {
    if (storageMode === 'prisma') {
      throw new Error('Failed to persist impersonation session');
    }
    inMemorySessions.set(session.id, session);
  }
}

async function getSessionById(
  storageMode: StorageMode,
  sessionId: string,
): Promise<ImpersonationSessionRecord | null> {
  if (storageMode === 'memory') {
    return inMemorySessions.get(sessionId) || null;
  }

  try {
    const row = await prisma.adminImpersonationSession.findUnique({
      where: { id: sessionId },
    });
    return row ? toSessionRecord(row) : null;
  } catch {
    if (storageMode === 'prisma') {
      throw new Error('Failed to read impersonation session');
    }
    return inMemorySessions.get(sessionId) || null;
  }
}

export async function startImpersonationSession(
  input: StartImpersonationSessionInput,
): Promise<ImpersonationSessionRecord> {
  const storageMode = normalizeStorageMode(process.env.IMPERSONATION_SESSION_STORAGE);
  const now = Date.now();
  const targetWallet = normalizeWalletAddress(input.targetWallet);
  const session: ImpersonationSessionRecord = {
    id: createId('imp_sess'),
    actor: input.actor,
    apiKeyHash: input.apiKeyHash,
    targetWallet,
    reason: input.reason.trim(),
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + getSessionTtlMs()).toISOString(),
    endedAt: null,
    status: 'active',
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  };

  await persistSession(storageMode, session);
  await appendLedgerEntry(storageMode, {
    id: createId('imp_led'),
    sessionId: session.id,
    eventType: 'session.started',
    actor: input.actor,
    metadata: {
      targetWallet,
      reason: session.reason,
      expiresAt: session.expiresAt,
    },
    createdAt: new Date(now).toISOString(),
  });

  return session;
}

export async function endImpersonationSession(
  sessionId: string,
  actor: string,
): Promise<ImpersonationSessionRecord | null> {
  const storageMode = normalizeStorageMode(process.env.IMPERSONATION_SESSION_STORAGE);
  const session = await getSessionById(storageMode, sessionId);
  if (!session) {
    return null;
  }

  const effectiveStatus = resolveEffectiveStatus(session);
  if (effectiveStatus === 'expired') {
    return null;
  }
  if (effectiveStatus === 'ended') {
    return session;
  }

  const endedSession: ImpersonationSessionRecord = {
    ...session,
    status: 'ended',
    endedAt: new Date().toISOString(),
  };

  await persistSession(storageMode, endedSession);
  await appendLedgerEntry(storageMode, {
    id: createId('imp_led'),
    sessionId: endedSession.id,
    eventType: 'session.ended',
    actor,
    metadata: {
      targetWallet: endedSession.targetWallet,
      endedAt: endedSession.endedAt,
    },
    createdAt: new Date().toISOString(),
  });

  return endedSession;
}

async function markSessionExpired(
  session: ImpersonationSessionRecord,
  actor: string,
): Promise<ImpersonationSessionRecord> {
  const storageMode = normalizeStorageMode(process.env.IMPERSONATION_SESSION_STORAGE);
  const expiredSession: ImpersonationSessionRecord = {
    ...session,
    status: 'expired',
    endedAt: session.endedAt || new Date().toISOString(),
  };

  await persistSession(storageMode, expiredSession);
  await appendLedgerEntry(storageMode, {
    id: createId('imp_led'),
    sessionId: expiredSession.id,
    eventType: 'session.expired',
    actor,
    metadata: {
      targetWallet: expiredSession.targetWallet,
      expiresAt: expiredSession.expiresAt,
    },
    createdAt: new Date().toISOString(),
  });

  return expiredSession;
}

export async function validateImpersonationSession(
  sessionId: string,
  targetWallet: string,
  actor: string,
): Promise<
  | { ok: true; session: ImpersonationSessionRecord }
  | { ok: false; reason: 'not_found' | 'expired' | 'ended' | 'wallet_mismatch' | 'actor_mismatch' }
> {
  const storageMode = normalizeStorageMode(process.env.IMPERSONATION_SESSION_STORAGE);
  const session = await getSessionById(storageMode, sessionId);
  if (!session) {
    return { ok: false, reason: 'not_found' };
  }

  if (session.actor !== actor) {
    return { ok: false, reason: 'actor_mismatch' };
  }

  const normalizedTarget = normalizeWalletAddress(targetWallet);
  if (session.targetWallet !== normalizedTarget) {
    return { ok: false, reason: 'wallet_mismatch' };
  }

  const effectiveStatus = resolveEffectiveStatus(session);
  if (effectiveStatus === 'ended') {
    return { ok: false, reason: 'ended' };
  }

  if (effectiveStatus === 'expired') {
    if (session.status !== 'expired') {
      await markSessionExpired(session, actor);
    }
    return { ok: false, reason: 'expired' };
  }

  await appendLedgerEntry(storageMode, {
    id: createId('imp_led'),
    sessionId: session.id,
    eventType: 'session.access',
    actor,
    metadata: {
      targetWallet: normalizedTarget,
    },
    createdAt: new Date().toISOString(),
  });

  return { ok: true, session };
}

export async function listImpersonationSessions(
  filters: ListImpersonationSessionsFilters,
): Promise<ImpersonationSessionRecord[]> {
  const storageMode = normalizeStorageMode(process.env.IMPERSONATION_SESSION_STORAGE);
  const statusFilter = filters.status || 'all';

  if (storageMode === 'memory') {
    return Array.from(inMemorySessions.values())
      .filter((session) => {
        const effectiveStatus = resolveEffectiveStatus(session);
        if (statusFilter !== 'all' && effectiveStatus !== statusFilter) {
          return false;
        }
        if (filters.actor && session.actor !== filters.actor) {
          return false;
        }
        if (filters.targetWallet && session.targetWallet !== normalizeWalletAddress(filters.targetWallet)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, filters.limit)
      .map((session) => ({
        ...session,
        status: resolveEffectiveStatus(session),
      }));
  }

  try {
    const rows = await prisma.adminImpersonationSession.findMany({
      where: {
        ...(filters.actor ? { actor: filters.actor } : {}),
        ...(filters.targetWallet
          ? { targetWallet: normalizeWalletAddress(filters.targetWallet) }
          : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: filters.limit,
    });

    return rows.map((row) => {
      const session = toSessionRecord(row);
      return {
        ...session,
        status: resolveEffectiveStatus(session),
      };
    });
  } catch {
    if (storageMode === 'prisma') {
      throw new Error('Failed to list impersonation sessions');
    }
    return Array.from(inMemorySessions.values())
      .filter((session) => {
        const effectiveStatus = resolveEffectiveStatus(session);
        if (statusFilter !== 'all' && effectiveStatus !== statusFilter) {
          return false;
        }
        if (filters.actor && session.actor !== filters.actor) {
          return false;
        }
        if (filters.targetWallet && session.targetWallet !== normalizeWalletAddress(filters.targetWallet)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, filters.limit)
      .map((session) => ({
        ...session,
        status: resolveEffectiveStatus(session),
      }));
  }
}

export async function listImpersonationLedgerEntries(
  sessionId: string,
): Promise<ImpersonationLedgerEntryRecord[]> {
  const storageMode = normalizeStorageMode(process.env.IMPERSONATION_SESSION_STORAGE);

  if (storageMode === 'memory') {
    return inMemoryLedger
      .filter((entry) => entry.sessionId === sessionId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  try {
    const rows = await prisma.adminImpersonationLedgerEntry.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      eventType: row.eventType as ImpersonationLedgerEventType,
      actor: row.actor,
      metadata: safeParseMetadata(row.metadata),
      createdAt: row.createdAt.toISOString(),
    }));
  } catch {
    if (storageMode === 'prisma') {
      throw new Error('Failed to list impersonation ledger entries');
    }
    return inMemoryLedger.filter((entry) => entry.sessionId === sessionId);
  }
}

function safeParseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function resolveImpersonationSessionContext(req: Request): {
  actor: string;
  apiKeyHash: string;
  ipAddress: string;
  userAgent: string;
} {
  return {
    actor:
      req.get('x-admin-address') ||
      req.get('x-admin-id') ||
      req.get('x-wallet-address') ||
      'unknown',
    apiKeyHash: req.authApiKeyHash || 'unknown',
    ipAddress: req.ip || 'unknown',
    userAgent: req.get('user-agent') || 'unknown',
  };
}

export function clearImpersonationSessionsForTests(): void {
  inMemorySessions.clear();
  inMemoryLedger.length = 0;
}
