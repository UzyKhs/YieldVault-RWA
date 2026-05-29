import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth';
import { getApiKeyFingerprintFromHash } from './apiKeyAudit';
import { prisma } from './prisma';

export type ExportJobFormat = 'csv' | 'json';

export interface ExportJobRecord {
  id: string;
  format: ExportJobFormat;
  fileName: string;
  contentType: string;
  checksum: string;
  checksumAlgorithm: string;
  generatedBy: string;
  walletAddress: string | null;
  rowCount: number;
  filters: Record<string, unknown>;
  createdAt: string;
}

export interface ExportJobFilters {
  format?: ExportJobFormat;
  generatedBy?: string;
  walletAddress?: string;
  checksum?: string;
  start?: string;
  end?: string;
  limit: number;
}

export interface RecordExportJobInput {
  format: ExportJobFormat;
  fileName: string;
  contentType: string;
  checksum: string;
  checksumAlgorithm: string;
  generatedBy: string;
  walletAddress?: string;
  rowCount: number;
  filters: Record<string, unknown>;
  createdAt?: Date;
}

export function resolveExportGeneratedBy(req: Request): string {
  if (req.authApiKeyHash) {
    return `apiKey:${getApiKeyFingerprintFromHash(req.authApiKeyHash)}`;
  }

  const authenticatedReq = req as AuthenticatedRequest;
  return (
    authenticatedReq.jwtPayload?.sub ||
    req.get('x-admin-address') ||
    req.get('x-admin-id') ||
    req.get('x-wallet-address') ||
    'unknown'
  );
}

export function buildExportMetadataHeaderValue(job: ExportJobRecord): string {
  return JSON.stringify({
    exportJobId: job.id,
    checksum: job.checksum,
    checksumAlgorithm: job.checksumAlgorithm,
    generatedBy: job.generatedBy,
    rowCount: job.rowCount,
    createdAt: job.createdAt,
  });
}

export async function recordExportJob(input: RecordExportJobInput): Promise<ExportJobRecord> {
  const id = createExportJobId();
  const createdAt = input.createdAt || new Date();

  await prisma.$executeRaw`
    INSERT INTO "ExportJob" (
      "id",
      "format",
      "fileName",
      "contentType",
      "checksum",
      "checksumAlgorithm",
      "generatedBy",
      "walletAddress",
      "rowCount",
      "filters",
      "createdAt"
    )
    VALUES (
      ${id},
      ${input.format},
      ${input.fileName},
      ${input.contentType},
      ${input.checksum},
      ${input.checksumAlgorithm},
      ${input.generatedBy},
      ${input.walletAddress || null},
      ${input.rowCount},
      ${JSON.stringify(input.filters)},
      ${createdAt}
    )
  `;

  return {
    id,
    format: input.format,
    fileName: input.fileName,
    contentType: input.contentType,
    checksum: input.checksum,
    checksumAlgorithm: input.checksumAlgorithm,
    generatedBy: input.generatedBy,
    walletAddress: input.walletAddress || null,
    rowCount: input.rowCount,
    filters: input.filters,
    createdAt: createdAt.toISOString(),
  };
}

export async function listExportJobs(filters: ExportJobFilters): Promise<ExportJobRecord[]> {
  const whereClauses: Prisma.Sql[] = [];
  if (filters.format) {
    whereClauses.push(Prisma.sql`"format" = ${filters.format}`);
  }
  if (filters.generatedBy) {
    whereClauses.push(Prisma.sql`"generatedBy" = ${filters.generatedBy}`);
  }
  if (filters.walletAddress) {
    whereClauses.push(Prisma.sql`"walletAddress" = ${filters.walletAddress}`);
  }
  if (filters.checksum) {
    whereClauses.push(Prisma.sql`"checksum" = ${filters.checksum.toLowerCase()}`);
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
      format: ExportJobFormat;
      fileName: string;
      contentType: string;
      checksum: string;
      checksumAlgorithm: string;
      generatedBy: string;
      walletAddress: string | null;
      rowCount: number;
      filters: string;
      createdAt: Date;
    }>
  >(Prisma.sql`
    SELECT
      "id",
      "format",
      "fileName",
      "contentType",
      "checksum",
      "checksumAlgorithm",
      "generatedBy",
      "walletAddress",
      "rowCount",
      "filters",
      "createdAt"
    FROM "ExportJob"
    ${whereSql}
    ORDER BY "createdAt" DESC
    LIMIT ${filters.limit}
  `);

  return rows.map(mapExportJobRow);
}

export async function getExportJobById(id: string): Promise<ExportJobRecord | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      format: ExportJobFormat;
      fileName: string;
      contentType: string;
      checksum: string;
      checksumAlgorithm: string;
      generatedBy: string;
      walletAddress: string | null;
      rowCount: number;
      filters: string;
      createdAt: Date;
    }>
  >(Prisma.sql`
    SELECT
      "id",
      "format",
      "fileName",
      "contentType",
      "checksum",
      "checksumAlgorithm",
      "generatedBy",
      "walletAddress",
      "rowCount",
      "filters",
      "createdAt"
    FROM "ExportJob"
    WHERE "id" = ${id}
    LIMIT 1
  `);

  return rows[0] ? mapExportJobRow(rows[0]) : null;
}

function mapExportJobRow(row: {
  id: string;
  format: ExportJobFormat;
  fileName: string;
  contentType: string;
  checksum: string;
  checksumAlgorithm: string;
  generatedBy: string;
  walletAddress: string | null;
  rowCount: number;
  filters: string;
  createdAt: Date;
}): ExportJobRecord {
  return {
    id: row.id,
    format: row.format,
    fileName: row.fileName,
    contentType: row.contentType,
    checksum: row.checksum,
    checksumAlgorithm: row.checksumAlgorithm,
    generatedBy: row.generatedBy,
    walletAddress: row.walletAddress,
    rowCount: row.rowCount,
    filters: safeParseFilters(row.filters),
    createdAt: row.createdAt.toISOString(),
  };
}

function safeParseFilters(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function createExportJobId(): string {
  return `export_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}
