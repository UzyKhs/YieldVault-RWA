/**
 * Prisma Query Performance Monitoring
 * Detects slow queries and collects per-query timing metrics
 * Issue #443: Backend: Add slow query detection and per-query timing metrics to Prisma client
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from './middleware/structuredLogging';

interface QueryMetrics {
  query: string;
  duration: number;
  timestamp: Date;
  isSlow: boolean;
}

interface QueryStats {
  totalQueries: number;
  slowQueries: number;
  averageDuration: number;
  maxDuration: number;
  minDuration: number;
  lastQueries: QueryMetrics[];
}

/**
 * Configuration for query monitoring
 */
interface QueryMonitoringConfig {
  slowQueryThresholdMs: number;
  maxStoredQueries: number;
  enableDetailedLogging: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: QueryMonitoringConfig = {
  slowQueryThresholdMs: parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '1000', 10),
  maxStoredQueries: 100,
  enableDetailedLogging: process.env.NODE_ENV !== 'production',
};

/**
 * Query statistics collector
 */
class QueryMonitor {
  private config: QueryMonitoringConfig;
  private stats: QueryStats = {
    totalQueries: 0,
    slowQueries: 0,
    averageDuration: 0,
    maxDuration: 0,
    minDuration: Infinity,
    lastQueries: [],
  };

  constructor(config: Partial<QueryMonitoringConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a query execution
   */
  recordQuery(query: string, duration: number): void {
    this.stats.totalQueries++;

    const isSlow = duration > this.config.slowQueryThresholdMs;
    if (isSlow) {
      this.stats.slowQueries++;
    }

    // Update duration statistics
    this.stats.maxDuration = Math.max(this.stats.maxDuration, duration);
    this.stats.minDuration = Math.min(this.stats.minDuration, duration);
    this.stats.averageDuration =
      (this.stats.averageDuration * (this.stats.totalQueries - 1) + duration) /
      this.stats.totalQueries;

    // Store query metric
    const metric: QueryMetrics = {
      query: this.truncateQuery(query),
      duration,
      timestamp: new Date(),
      isSlow,
    };

    this.stats.lastQueries.unshift(metric);
    if (this.stats.lastQueries.length > this.config.maxStoredQueries) {
      this.stats.lastQueries.pop();
    }

    // Log slow queries
    if (isSlow) {
      logger.log('warn', 'Slow query detected', {
        duration,
        threshold: this.config.slowQueryThresholdMs,
        query: this.truncateQuery(query, 200),
      });

      if (this.config.enableDetailedLogging) {
        logger.log('debug', 'Slow query details', {
          duration,
          query: this.truncateQuery(query, 500),
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  /**
   * Get current statistics
   */
  getStats(): QueryStats {
    return { ...this.stats };
  }

  /**
   * Get slow queries
   */
  getSlowQueries(limit = 10): QueryMetrics[] {
    return this.stats.lastQueries.filter((m) => m.isSlow).slice(0, limit);
  }

  /**
   * Reset statistics
   */
  reset(): void {
    this.stats = {
      totalQueries: 0,
      slowQueries: 0,
      averageDuration: 0,
      maxDuration: 0,
      minDuration: Infinity,
      lastQueries: [],
    };
  }

  /**
   * Truncate query for logging (remove values, keep structure)
   */
  private truncateQuery(query: string, maxLength = 100): string {
    // Remove variable values to group similar queries
    const sanitized = query
      .replace(/\$[0-9]+/g, '$N')
      .replace(/'[^']*'/g, "'...'")
      .replace(/"[^"]*"/g, '"..."');

    if (sanitized.length > maxLength) {
      return sanitized.substring(0, maxLength) + '...';
    }
    return sanitized;
  }
}

/**
 * Create a monitored Prisma Client with query timing middleware
 */
export function createMonitoredPrismaClient(
  config?: Partial<QueryMonitoringConfig>,
): {
  client: PrismaClient;
  monitor: QueryMonitor;
} {
  const monitor = new QueryMonitor(config);

  const client = new PrismaClient();

  // Add $use middleware to capture query metrics
  client.$use(async (params, next) => {
    const start = Date.now();

    try {
      const result = await next(params);
      const duration = Date.now() - start;

      // Record the query
      const queryDescription = `${params.model}.${params.action}`;
      monitor.recordQuery(queryDescription, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - start;
      const queryDescription = `${params.model}.${params.action}`;
      monitor.recordQuery(queryDescription, duration);

      throw error;
    }
  });

  return { client, monitor };
}

/**
 * Add monitoring to existing Prisma Client
 */
export function addQueryMonitoring(
  client: PrismaClient,
  config?: Partial<QueryMonitoringConfig>,
): QueryMonitor {
  const monitor = new QueryMonitor(config);

  client.$use(async (params, next) => {
    const start = Date.now();

    try {
      const result = await next(params);
      const duration = Date.now() - start;

      const queryDescription = `${params.model}.${params.action}`;
      monitor.recordQuery(queryDescription, duration);

      return result;
    } catch (error) {
      const duration = Date.now() - start;
      const queryDescription = `${params.model}.${params.action}`;
      monitor.recordQuery(queryDescription, duration);

      throw error;
    }
  });

  return monitor;
}

/**
 * Get query monitoring metrics endpoint handler
 */
export function getQueryMetricsHandler() {
  return {
    getStats,
    getSlowQueries,
  };
}

// Global monitor instance (if using singleton pattern)
let globalMonitor: QueryMonitor | null = null;

/**
 * Initialize global query monitor
 */
export function initializeGlobalQueryMonitor(
  config?: Partial<QueryMonitoringConfig>,
): QueryMonitor {
  if (!globalMonitor) {
    globalMonitor = new QueryMonitor(config);
  }
  return globalMonitor;
}

/**
 * Record query in global monitor
 */
export function recordGlobalQuery(query: string, duration: number): void {
  if (globalMonitor) {
    globalMonitor.recordQuery(query, duration);
  }
}

/**
 * Get stats from global monitor
 */
export function getStats(): QueryStats {
  if (!globalMonitor) {
    return {
      totalQueries: 0,
      slowQueries: 0,
      averageDuration: 0,
      maxDuration: 0,
      minDuration: 0,
      lastQueries: [],
    };
  }
  return globalMonitor.getStats();
}

/**
 * Get slow queries from global monitor
 */
export function getSlowQueries(limit = 10): QueryMetrics[] {
  if (!globalMonitor) {
    return [];
  }
  return globalMonitor.getSlowQueries(limit);
}

export type { QueryMetrics, QueryStats, QueryMonitoringConfig };
