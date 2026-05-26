/**
 * Centralized Prisma Client configuration.
 * Ensures a single client instance across the application and prevents
 * multiple instrumentation patches during test runs.
 *
 * The @prisma/instrumentation package may patch the PrismaClient constructor,
 * so we need to provide the options it expects to avoid panics.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from './middleware/structuredLogging';
import { addQueryMonitoring } from './queryMonitoring';

let prismaClientInstance: PrismaClient | null = null;

/**
 * Get or create the shared Prisma Client instance.
 * This ensures only one client exists and prevents instrumentation conflicts.
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaClientInstance) {
    const isTestEnv = process.env.NODE_ENV === 'test';

    if (isTestEnv) {
      logger.log('info', 'Initializing Prisma Client for test environment', {});
    }

    // Build the client options
    const clientOptions: any = {};

    // In test environments, minimize logging
    if (isTestEnv) {
      clientOptions.log = [
        {
          emit: 'event',
          level: 'error',
        },
      ];
    }

    // Create the Prisma Client instance with explicit options
    try {
      prismaClientInstance = new PrismaClient(clientOptions) as any;

      // Add query monitoring middleware
      // Issue #443: Add slow query detection and per-query timing metrics
      const slowQueryThresholdMs = parseInt(
        process.env.SLOW_QUERY_THRESHOLD_MS || '1000',
        10,
      );
      addQueryMonitoring(prismaClientInstance, {
        slowQueryThresholdMs,
        enableDetailedLogging: process.env.NODE_ENV !== 'production',
      });

      if (!isTestEnv) {
        logger.log('info', 'Query monitoring enabled', {
          slowQueryThresholdMs,
        });
      }
    } catch (error) {
      logger.log('error', 'Failed to create Prisma Client', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  return prismaClientInstance as PrismaClient;
}

/**
 * Disconnect the Prisma Client instance.
 * Call this during graceful shutdown.
 */
export async function disconnectPrismaClient(): Promise<void> {
  if (prismaClientInstance) {
    try {
      await prismaClientInstance.$disconnect();
    } catch (error) {
      logger.log('warn', 'Error disconnecting Prisma Client', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    prismaClientInstance = null;
  }
}
