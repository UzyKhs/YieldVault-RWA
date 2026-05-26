/**
 * Transaction Export Service
 * Supports exporting transactions in CSV and JSON formats
 * Issue #440: Backend: Add transaction history export endpoint supporting CSV and JSON formats
 */

import { Parser } from 'json2csv';
import { getPrismaClient } from './prismaClient';
import { logger } from './middleware/structuredLogging';

export interface ExportOptions {
  format: 'csv' | 'json';
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  userAddress?: string;
  type?: 'deposit' | 'withdrawal';
}

export interface ExportResult {
  format: string;
  content: string;
  mimeType: string;
  filename: string;
  recordCount: number;
  exportedAt: string;
}

interface TransactionRecord {
  id: string;
  user: string;
  amount: string;
  type: 'deposit' | 'withdrawal';
  referralCode?: string | null;
  createdAt: string;
}

/**
 * Export transactions in the requested format
 */
export async function exportTransactions(options: ExportOptions): Promise<ExportResult> {
  const prisma = getPrismaClient();
  const startTime = Date.now();

  try {
    // Build query filters
    const where: any = {};

    if (options.startDate || options.endDate) {
      where.createdAt = {};
      if (options.startDate) {
        where.createdAt.gte = options.startDate;
      }
      if (options.endDate) {
        where.createdAt.lte = options.endDate;
      }
    }

    if (options.userAddress) {
      where.user = options.userAddress;
    }

    if (options.type) {
      where.type = options.type;
    }

    // Fetch transactions from database
    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.limit || 10000,
    });

    if (transactions.length === 0) {
      logger.log('warn', 'No transactions found for export', {
        filters: options,
        durationMs: Date.now() - startTime,
      });
    }

    // Format the data
    const records: TransactionRecord[] = transactions.map((tx: any) => ({
      id: tx.id,
      user: tx.user,
      amount: tx.amount,
      type: tx.type,
      referralCode: tx.referralCode,
      createdAt: new Date(tx.createdAt).toISOString(),
    }));

    // Generate export based on format
    let result: ExportResult;

    if (options.format === 'csv') {
      result = generateCSV(records);
    } else {
      result = generateJSON(records);
    }

    logger.log('info', 'Transactions exported successfully', {
      format: options.format,
      recordCount: transactions.length,
      durationMs: Date.now() - startTime,
    });

    return result;
  } catch (error) {
    logger.log('error', 'Failed to export transactions', {
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    throw error;
  }
}

/**
 * Generate CSV format
 */
function generateCSV(records: TransactionRecord[]): ExportResult {
  try {
    const fields = ['id', 'user', 'amount', 'type', 'referralCode', 'createdAt'];
    const parser = new Parser({ fields });
    const csv = parser.parse(records);

    const timestamp = new Date().toISOString().split('T')[0];
    return {
      format: 'csv',
      content: csv,
      mimeType: 'text/csv',
      filename: `transactions_${timestamp}.csv`,
      recordCount: records.length,
      exportedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.log('error', 'Failed to generate CSV', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Generate JSON format
 */
function generateJSON(records: TransactionRecord[]): ExportResult {
  try {
    const json = JSON.stringify({
      format: 'transactions',
      version: '1.0',
      exportedAt: new Date().toISOString(),
      recordCount: records.length,
      records,
    }, null, 2);

    const timestamp = new Date().toISOString().split('T')[0];
    return {
      format: 'json',
      content: json,
      mimeType: 'application/json',
      filename: `transactions_${timestamp}.json`,
      recordCount: records.length,
      exportedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.log('error', 'Failed to generate JSON', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
