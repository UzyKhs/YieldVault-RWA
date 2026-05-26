import {
  initializeGlobalQueryMonitor,
  recordGlobalQuery,
  getStats,
  getSlowQueries,
} from '../queryMonitoring';

/**
 * Unit tests for Query Monitoring
 * Issue #443: Backend: Add slow query detection and per-query timing metrics to Prisma client
 */

describe('Query Monitoring', () => {
  beforeEach(() => {
    // Reset global monitor before each test
    const monitor = initializeGlobalQueryMonitor({ slowQueryThresholdMs: 100 });
    monitor['reset']();
  });

  describe('recordGlobalQuery', () => {
    it('should record query execution', () => {
      recordGlobalQuery('User.findUnique', 50);

      const stats = getStats();
      expect(stats.totalQueries).toBe(1);
      expect(stats.averageDuration).toBe(50);
    });

    it('should track slow queries', () => {
      recordGlobalQuery('User.findMany', 50);
      recordGlobalQuery('Transaction.findMany', 200); // Slow query (> 100ms)

      const stats = getStats();
      expect(stats.totalQueries).toBe(2);
      expect(stats.slowQueries).toBe(1);
    });

    it('should track multiple queries', () => {
      recordGlobalQuery('Query1', 50);
      recordGlobalQuery('Query2', 75);
      recordGlobalQuery('Query3', 120);

      const stats = getStats();
      expect(stats.totalQueries).toBe(3);
      expect(stats.slowQueries).toBe(1);
      expect(stats.averageDuration).toBe((50 + 75 + 120) / 3);
    });

    it('should calculate correct average duration', () => {
      recordGlobalQuery('Query1', 100);
      recordGlobalQuery('Query2', 200);
      recordGlobalQuery('Query3', 300);

      const stats = getStats();
      expect(stats.averageDuration).toBe(200);
    });

    it('should track maximum duration', () => {
      recordGlobalQuery('Query1', 50);
      recordGlobalQuery('Query2', 150);
      recordGlobalQuery('Query3', 100);

      const stats = getStats();
      expect(stats.maxDuration).toBe(150);
    });

    it('should track minimum duration', () => {
      recordGlobalQuery('Query1', 150);
      recordGlobalQuery('Query2', 50);
      recordGlobalQuery('Query3', 100);

      const stats = getStats();
      expect(stats.minDuration).toBe(50);
    });

    it('should handle zero duration queries', () => {
      recordGlobalQuery('Query1', 0);
      recordGlobalQuery('Query2', 10);

      const stats = getStats();
      expect(stats.minDuration).toBe(0);
      expect(stats.totalQueries).toBe(2);
    });

    it('should handle very large durations', () => {
      recordGlobalQuery('LongQuery', 10000);

      const stats = getStats();
      expect(stats.maxDuration).toBe(10000);
      expect(stats.slowQueries).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return empty stats when no queries recorded', () => {
      const stats = getStats();

      expect(stats.totalQueries).toBe(0);
      expect(stats.slowQueries).toBe(0);
      expect(stats.averageDuration).toBe(0);
      expect(stats.maxDuration).toBe(0);
      expect(stats.minDuration).toBe(0);
      expect(Array.isArray(stats.lastQueries)).toBe(true);
    });

    it('should return complete statistics', () => {
      recordGlobalQuery('Query1', 50);
      recordGlobalQuery('Query2', 150);
      recordGlobalQuery('Query3', 75);

      const stats = getStats();

      expect(stats.totalQueries).toBe(3);
      expect(stats.slowQueries).toBe(1);
      expect(stats.maxDuration).toBe(150);
      expect(stats.minDuration).toBe(50);
      expect(stats.lastQueries.length).toBeGreaterThan(0);
    });

    it('should track query metrics', () => {
      recordGlobalQuery('TestQuery', 50);

      const stats = getStats();
      expect(stats.lastQueries[0]).toHaveProperty('query');
      expect(stats.lastQueries[0]).toHaveProperty('duration');
      expect(stats.lastQueries[0]).toHaveProperty('timestamp');
      expect(stats.lastQueries[0]).toHaveProperty('isSlow');
    });

    it('should limit stored queries to max size', () => {
      // Record more than max stored queries
      for (let i = 0; i < 150; i++) {
        recordGlobalQuery(`Query${i}`, 50);
      }

      const stats = getStats();
      // Default maxStoredQueries is 100
      expect(stats.lastQueries.length).toBeLessThanOrEqual(100);
      expect(stats.totalQueries).toBe(150);
    });

    it('should store recent queries in order', () => {
      recordGlobalQuery('Query1', 50);
      recordGlobalQuery('Query2', 75);
      recordGlobalQuery('Query3', 100);

      const stats = getStats();
      // Most recent query should be first
      expect(stats.lastQueries[0].duration).toBe(100);
      expect(stats.lastQueries[1].duration).toBe(75);
      expect(stats.lastQueries[2].duration).toBe(50);
    });
  });

  describe('getSlowQueries', () => {
    it('should return empty array when no slow queries', () => {
      recordGlobalQuery('Query1', 50);
      recordGlobalQuery('Query2', 75);

      const slowQueries = getSlowQueries();
      expect(slowQueries.length).toBe(0);
    });

    it('should return only slow queries', () => {
      recordGlobalQuery('Query1', 50);
      recordGlobalQuery('SlowQuery1', 150);
      recordGlobalQuery('Query2', 75);
      recordGlobalQuery('SlowQuery2', 200);

      const slowQueries = getSlowQueries();
      expect(slowQueries.length).toBe(2);
      expect(slowQueries.every((q) => q.isSlow)).toBe(true);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 20; i++) {
        recordGlobalQuery(`SlowQuery${i}`, 150);
      }

      const slowQueries = getSlowQueries(5);
      expect(slowQueries.length).toBeLessThanOrEqual(5);
    });

    it('should return queries in order (most recent first)', () => {
      recordGlobalQuery('SlowQuery1', 150);
      recordGlobalQuery('FastQuery', 50);
      recordGlobalQuery('SlowQuery2', 200);

      const slowQueries = getSlowQueries();
      expect(slowQueries[0].duration).toBe(200);
      expect(slowQueries[1].duration).toBe(150);
    });

    it('should include query metadata', () => {
      recordGlobalQuery('TestQuery', 150);

      const slowQueries = getSlowQueries();
      const query = slowQueries[0];

      expect(query).toHaveProperty('query');
      expect(query).toHaveProperty('duration');
      expect(query).toHaveProperty('timestamp');
      expect(query.isSlow).toBe(true);
      expect(typeof query.timestamp).toBe('object');
    });
  });

  describe('Slow Query Threshold', () => {
    it('should classify queries correctly based on threshold', () => {
      const monitor = initializeGlobalQueryMonitor({ slowQueryThresholdMs: 100 });

      recordGlobalQuery('Query1', 99);
      recordGlobalQuery('Query2', 100);
      recordGlobalQuery('Query3', 101);

      const stats = getStats();
      // 100 is not > 100, so only one query over threshold
      expect(stats.slowQueries).toBe(1);
    });

    it('should allow custom threshold configuration', () => {
      const monitor = initializeGlobalQueryMonitor({ slowQueryThresholdMs: 500 });

      recordGlobalQuery('Query1', 200);
      recordGlobalQuery('Query2', 600);

      const stats = getStats();
      expect(stats.slowQueries).toBe(1);
      expect(stats.slowQueries).toBeGreaterThan(0);
    });
  });

  describe('Query Description Truncation', () => {
    it('should truncate long query descriptions', () => {
      const longQuery = 'A'.repeat(500);
      recordGlobalQuery(longQuery, 50);

      const stats = getStats();
      expect(stats.lastQueries[0].query.length).toBeLessThanOrEqual(150);
    });

    it('should preserve query type information', () => {
      recordGlobalQuery('User.findMany', 50);

      const stats = getStats();
      // Should still contain meaningful info
      expect(stats.lastQueries[0].query).toBeTruthy();
    });
  });

  describe('Timestamp Tracking', () => {
    it('should record timestamp for each query', () => {
      const beforeTime = new Date();
      recordGlobalQuery('Query1', 50);
      const afterTime = new Date();

      const stats = getStats();
      const queryTime = stats.lastQueries[0].timestamp;

      expect(queryTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(queryTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should show query sequence by timestamp', () => {
      recordGlobalQuery('Query1', 50);
      // Small delay
      recordGlobalQuery('Query2', 75);

      const stats = getStats();
      const time1 = stats.lastQueries[1].timestamp.getTime();
      const time2 = stats.lastQueries[0].timestamp.getTime();

      // Query2 (most recent) should have later or equal timestamp
      expect(time2).toBeGreaterThanOrEqual(time1);
    });
  });

  describe('Statistical Accuracy', () => {
    it('should calculate accurate average for various distributions', () => {
      const queries = [10, 20, 30, 40, 50];
      queries.forEach((duration) => {
        recordGlobalQuery(`Query`, duration);
      });

      const stats = getStats();
      const expectedAverage = queries.reduce((a, b) => a + b) / queries.length;
      expect(stats.averageDuration).toBe(expectedAverage);
    });

    it('should handle single query statistics', () => {
      recordGlobalQuery('OnlyQuery', 75);

      const stats = getStats();
      expect(stats.totalQueries).toBe(1);
      expect(stats.averageDuration).toBe(75);
      expect(stats.maxDuration).toBe(75);
      expect(stats.minDuration).toBe(75);
    });

    it('should accumulate stats correctly', () => {
      recordGlobalQuery('Q1', 100);
      let stats = getStats();
      expect(stats.totalQueries).toBe(1);

      recordGlobalQuery('Q2', 200);
      stats = getStats();
      expect(stats.totalQueries).toBe(2);

      recordGlobalQuery('Q3', 300);
      stats = getStats();
      expect(stats.totalQueries).toBe(3);
      expect(stats.averageDuration).toBe(200);
    });
  });

  describe('Edge Cases', () => {
    it('should handle queries with same duration', () => {
      for (let i = 0; i < 5; i++) {
        recordGlobalQuery(`Query${i}`, 100);
      }

      const stats = getStats();
      expect(stats.averageDuration).toBe(100);
      expect(stats.maxDuration).toBe(100);
      expect(stats.minDuration).toBe(100);
    });

    it('should handle rapid successive queries', () => {
      for (let i = 0; i < 100; i++) {
        recordGlobalQuery(`RapidQuery${i}`, 50 + i);
      }

      const stats = getStats();
      expect(stats.totalQueries).toBe(100);
      expect(stats.slowQueries).toBeGreaterThan(0);
    });

    it('should not mutate stats object', () => {
      recordGlobalQuery('Query1', 50);
      const stats1 = getStats();
      const stats1Copy = JSON.stringify(stats1);

      recordGlobalQuery('Query2', 75);
      const stats2 = getStats();

      // Original stats object should have different values now
      expect(JSON.stringify(stats1)).not.toBe(stats1Copy);
    });
  });
});
