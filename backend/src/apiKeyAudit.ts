import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from './prisma';
import { hashApiKey } from './middleware/apiKeyAuth';

export const API_KEY_AUDIT_ACTIONS = {
  created: 'created',
  rotated: 'rotated',
  revoked: 'revoked',
} as const;

export type ApiKeyAuditAction =
  (typeof API_KEY_AUDIT_ACTIONS)[keyof typeof API_KEY_AUDIT_ACTIONS];

export interface ApiKeyAuditEventRecord {
  id: string;
  actor: string;
  action: ApiKeyAuditAction;
  keyFingerprint: string;
  createdAt: string;
}

export interface ApiKeyAuditEventFilters {
  action?: ApiKeyAuditAction;
  start?: string;
  end?: string;
  limit: number;
}

const API_KEY_HASH_PATTERN = /^[a-f0-9]{64}$/i;

export function isApiKeyHash(value: unknown): value is string {
  return typeof value === 'string' && API_KEY_HASH_PATTERN.test(value.trim());
}

export function getApiKeyFingerprintFromValue(key: string): string {
  return getApiKeyFingerprintFromHash(hashApiKey(key));
}

export function getApiKeyFingerprintFromHash(hash: string): string {
  const normalizedHash = hash.trim().toLowerCase();
  return `sha256:${normalizedHash.slice(0, 16)}`;
}

export function resolveApiKeyAuditActor(req: Request): string {
  return (
    req.get('x-admin-address') ||
    req.get('x-admin-id') ||
    req.get('x-wallet-address') ||
    (req.authApiKeyHash ? `apiKey:${getApiKeyFingerprintFromHash(req.authApiKeyHash)}` : 'unknown')
  );
}

export async function recordApiKeyAuditEvent(input: {
  actor: string;
  action: ApiKeyAuditAction;
  keyFingerprint: string;
  createdAt?: Date;
}): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "ApiKeyAuditEvent" ("id", "actor", "action", "keyFingerprint", "createdAt")
    VALUES (
      ${createApiKeyAuditEventId()},
      ${input.actor},
      ${input.action},
      ${input.keyFingerprint},
      ${input.createdAt || new Date()}
    )
  `;
}

export async function listApiKeyAuditEvents(
  filters: ApiKeyAuditEventFilters,
): Promise<ApiKeyAuditEventRecord[]> {
  const whereClauses: Prisma.Sql[] = [];
  if (filters.action) {
    whereClauses.push(Prisma.sql`"action" = ${filters.action}`);
  }
  if (filters.start) {
    whereClauses.push(Prisma.sql`"createdAt" >= ${new Date(filters.start)}`);
  }
  if (filters.end) {
    whereClauses.push(Prisma.sql`"createdAt" <= ${new Date(filters.end)}`);
  }

  const whereSql =
    whereClauses.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(whereClauses, Prisma.sql` AND `)}`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      actor: string;
      action: ApiKeyAuditAction;
      keyFingerprint: string;
      createdAt: Date;
    }>
  >(Prisma.sql`
    SELECT "id", "actor", "action", "keyFingerprint", "createdAt"
    FROM "ApiKeyAuditEvent"
    ${whereSql}
    ORDER BY "createdAt" DESC
    LIMIT ${filters.limit}
  `);

  return rows.map((row: any) => ({
    id: row.id,
    actor: row.actor,
    action: row.action,
    keyFingerprint: row.keyFingerprint,
    createdAt: row.createdAt.toISOString(),
  }));
}

function createApiKeyAuditEventId(): string {
  return `api_key_audit_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}
