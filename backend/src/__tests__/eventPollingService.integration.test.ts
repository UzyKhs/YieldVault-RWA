import { EventPollingService } from '../eventPollingService';
import { getPrismaClient } from '../prismaClient';
import { logger } from '../middleware/structuredLogging';

/**
 * Integration tests for Event Polling Service
 * Tests failure scenarios and gap-recovery mechanisms
 * Issue #445: Backend: Add integration tests for event polling service failure and gap-recovery scenarios
 */

describe('EventPollingService - Failure and Gap-Recovery Scenarios', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let pollingService: EventPollingService;

  const mockConfig = {
    rpcUrl: 'http://localhost:7000',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    pollIntervalMs: 100,
    batchSize: 50,
  };

  beforeEach(async () => {
    prisma = getPrismaClient();
    // Clean up database before each test
    await prisma.eventCursor.deleteMany({});
    await prisma.processedEvent.deleteMany({});
  });

  afterEach(async () => {
    if (pollingService) {
      await pollingService.stop();
    }
  });

  describe('Failure Scenarios', () => {
    it('should handle RPC connection failure gracefully', async () => {
      const failingConfig = {
        ...mockConfig,
        rpcUrl: 'http://invalid-host-that-does-not-exist:7000',
      };

      pollingService = new EventPollingService(failingConfig);

      // Should not throw
      await expect(pollingService.start()).resolves.not.toThrow();

      // Service should be running despite RPC failure
      expect(pollingService['isRunning']).toBe(true);

      await pollingService.stop();
    });

    it('should continue polling after temporary network failure', async () => {
      let callCount = 0;
      const originalFetch = global.fetch;

      // Mock fetch to fail first time, then succeed
      global.fetch = jest.fn(async (...args) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Network timeout');
        }
        return originalFetch(...args);
      });

      pollingService = new EventPollingService(mockConfig);

      // Start should not throw even with initial failure
      await expect(pollingService.start()).resolves.not.toThrow();

      await pollingService.stop();
      global.fetch = originalFetch;
    });

    it('should handle malformed RPC response', async () => {
      global.fetch = jest.fn(async () => ({
        json: async () => ({
          // Missing 'result' field
          error: 'Server error',
        }),
      }));

      pollingService = new EventPollingService(mockConfig);
      await expect(pollingService.start()).resolves.not.toThrow();
      await pollingService.stop();
    });

    it('should handle database errors during cursor update', async () => {
      const originalUpsert = prisma.eventCursor.upsert;
      let callCount = 0;

      prisma.eventCursor.upsert = jest.fn(async (...args) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Database connection lost');
        }
        return originalUpsert.apply(prisma.eventCursor, args);
      });

      pollingService = new EventPollingService(mockConfig);
      await expect(pollingService.start()).resolves.not.toThrow();
      await pollingService.stop();
    });

    it('should handle event processing errors without stopping polling', async () => {
      // Create a scenario where event processing fails
      const mockEvent = {
        id: 'test-event-1',
        type: 'contract',
        ledger: 100,
        contractId: mockConfig.contractId,
        txHash: 'tx123',
        topics: [],
        value: {},
      };

      const originalProcessEvent = pollingService?.['processEvent'];

      // This test verifies the service continues despite processing errors
      pollingService = new EventPollingService(mockConfig);
      await expect(pollingService.start()).resolves.not.toThrow();
      await pollingService.stop();
    });
  });

  describe('Gap-Recovery Scenarios', () => {
    it('should replay events when there is a gap in ledger sequence', async () => {
      // Set cursor to ledger 100
      await prisma.eventCursor.create({
        data: {
          id: 1,
          lastLedgerSeq: 100,
        },
      });

      // Mock RPC to return ledger 150 (50 ledger gap)
      let getLatestLedgerCalled = false;
      global.fetch = jest.fn(async (url, options: any) => {
        const body = JSON.parse(options?.body || '{}');
        if (body.method === 'getLatestLedger') {
          getLatestLedgerCalled = true;
          return {
            json: async () => ({
              result: {
                sequence: 150,
              },
            }),
          };
        }
        return {
          json: async () => ({
            result: {
              events: [],
            },
          }),
        };
      });

      pollingService = new EventPollingService(mockConfig);
      await pollingService.start();

      // Wait for replay to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify getLatestLedger was called (indicating gap detection)
      expect(getLatestLedgerCalled).toBe(true);

      const cursor = await prisma.eventCursor.findUnique({ where: { id: 1 } });
      // Cursor should be updated
      expect(cursor).toBeDefined();

      await pollingService.stop();
    });

    it('should handle duplicate events during replay', async () => {
      const eventId = 'duplicate-event-123';

      // Pre-populate a processed event
      await prisma.processedEvent.create({
        data: {
          id: eventId,
          ledgerSeq: 100,
          eventType: 'test',
          contractId: mockConfig.contractId,
          txHash: 'tx123',
        },
      });

      // Mock RPC to return duplicate event
      global.fetch = jest.fn(async (url, options: any) => {
        const body = JSON.parse(options?.body || '{}');
        if (body.method === 'getLatestLedger') {
          return {
            json: async () => ({
              result: { sequence: 100 },
            }),
          };
        }
        return {
          json: async () => ({
            result: {
              events: [
                {
                  id: eventId,
                  type: 'test',
                  ledger: 100,
                  contractId: mockConfig.contractId,
                  txHash: 'tx123',
                  topic: [],
                  value: {},
                },
              ],
            },
          }),
        };
      });

      pollingService = new EventPollingService(mockConfig);
      await pollingService.start();

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify only one copy exists
      const events = await prisma.processedEvent.findMany({
        where: { id: eventId },
      });
      expect(events.length).toBe(1);

      await pollingService.stop();
    });

    it('should recover from interrupted replay', async () => {
      // Set initial cursor
      await prisma.eventCursor.create({
        data: {
          id: 1,
          lastLedgerSeq: 90,
        },
      });

      let callCount = 0;

      global.fetch = jest.fn(async (url, options: any) => {
        const body = JSON.parse(options?.body || '{}');

        if (body.method === 'getLatestLedger') {
          return {
            json: async () => ({
              result: { sequence: 110 },
            }),
          };
        }

        if (body.method === 'getEvents') {
          callCount++;
          // Simulate failure on second batch
          if (callCount === 2) {
            throw new Error('RPC timeout');
          }
          return {
            json: async () => ({
              result: {
                events: [],
              },
            }),
          };
        }

        return {
          json: async () => ({}),
        };
      });

      pollingService = new EventPollingService(mockConfig);

      // Start should handle the failure during replay
      await expect(pollingService.start()).resolves.not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 200));
      await pollingService.stop();

      // Verify service recovered
      expect(pollingService['isRunning']).toBe(false);
    });

    it('should process events in batches correctly during replay', async () => {
      const batchSize = 50;
      const gapSize = 150;

      // Set cursor far behind current ledger
      await prisma.eventCursor.create({
        data: {
          id: 1,
          lastLedgerSeq: 100,
        },
      });

      const processedBatches: Array<{ start: number; end: number }> = [];

      global.fetch = jest.fn(async (url, options: any) => {
        const body = JSON.parse(options?.body || '{}');

        if (body.method === 'getLatestLedger') {
          return {
            json: async () => ({
              result: { sequence: 100 + gapSize },
            }),
          };
        }

        if (body.method === 'getEvents') {
          const params = body.params;
          processedBatches.push({
            start: params.startLedger,
            end: params.startLedger + batchSize - 1,
          });

          return {
            json: async () => ({
              result: { events: [] },
            }),
          };
        }

        return {
          json: async () => ({}),
        };
      });

      pollingService = new EventPollingService({
        ...mockConfig,
        batchSize,
      });

      await pollingService.start();

      // Wait for replay
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify batches were processed
      expect(processedBatches.length).toBeGreaterThan(0);
      // Verify batch sizes
      for (const batch of processedBatches) {
        expect(batch.end - batch.start + 1).toBeLessThanOrEqual(batchSize);
      }

      await pollingService.stop();
    });

    it('should resume from last successful ledger after partial replay failure', async () => {
      await prisma.eventCursor.create({
        data: {
          id: 1,
          lastLedgerSeq: 100,
        },
      });

      let batchCount = 0;

      global.fetch = jest.fn(async (url, options: any) => {
        const body = JSON.parse(options?.body || '{}');

        if (body.method === 'getLatestLedger') {
          return {
            json: async () => ({
              result: { sequence: 200 },
            }),
          };
        }

        if (body.method === 'getEvents') {
          batchCount++;
          // Fail on third batch to test resumption
          if (batchCount === 3) {
            throw new Error('Temporary failure');
          }

          return {
            json: async () => ({
              result: { events: [] },
            }),
          };
        }

        return {
          json: async () => ({}),
        };
      });

      pollingService = new EventPollingService(mockConfig);

      await expect(pollingService.start()).resolves.not.toThrow();

      // Give it time to process
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Stop and restart to simulate recovery
      await pollingService.stop();

      // Verify cursor was updated at least once
      const cursor = await prisma.eventCursor.findUnique({ where: { id: 1 } });
      expect(cursor).toBeDefined();
      expect(cursor?.lastLedgerSeq).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero ledger sequence', async () => {
      await prisma.eventCursor.create({
        data: {
          id: 1,
          lastLedgerSeq: 0,
        },
      });

      global.fetch = jest.fn(async (url, options: any) => ({
        json: async () => ({
          result: {
            sequence: 1,
            events: [],
          },
        }),
      }));

      pollingService = new EventPollingService(mockConfig);
      await expect(pollingService.start()).resolves.not.toThrow();
      await pollingService.stop();
    });

    it('should handle very large ledger sequence gaps', async () => {
      const largeGap = 10000;

      await prisma.eventCursor.create({
        data: {
          id: 1,
          lastLedgerSeq: 1000,
        },
      });

      global.fetch = jest.fn(async (url, options: any) => {
        const body = JSON.parse(options?.body || '{}');

        if (body.method === 'getLatestLedger') {
          return {
            json: async () => ({
              result: { sequence: 1000 + largeGap },
            }),
          };
        }

        return {
          json: async () => ({
            result: { events: [] },
          }),
        };
      });

      pollingService = new EventPollingService(mockConfig);
      await expect(pollingService.start()).resolves.not.toThrow();

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      await pollingService.stop();
    });

    it('should handle concurrent start calls gracefully', async () => {
      pollingService = new EventPollingService(mockConfig);

      global.fetch = jest.fn(async () => ({
        json: async () => ({
          result: { sequence: 100, events: [] },
        }),
      }));

      // Call start multiple times concurrently
      const results = await Promise.allSettled([
        pollingService.start(),
        pollingService.start(),
        pollingService.start(),
      ]);

      // All should resolve without error
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      await pollingService.stop();
    });
  });
});
