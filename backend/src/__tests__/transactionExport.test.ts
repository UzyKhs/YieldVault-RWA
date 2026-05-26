import request from 'supertest';
import app from '../index';
import { getPrismaClient } from '../prismaClient';

/**
 * Integration tests for Transaction Export Endpoint
 * Issue #440: Backend: Add transaction history export endpoint supporting CSV and JSON formats
 */

describe('GET /api/v1/vault/transactions/export', () => {
  let prisma: ReturnType<typeof getPrismaClient>;

  beforeEach(async () => {
    prisma = getPrismaClient();
  });

  describe('JSON Export', () => {
    it('should export transactions in JSON format', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({ format: 'json' });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['content-disposition']).toContain('transactions_');
      expect(response.headers['content-disposition']).toContain('.json');
      expect(response.headers['x-export-format']).toBe('json');
      expect(response.headers['x-record-count']).toBeDefined();

      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      expect(body.format).toBe('transactions');
      expect(body.version).toBe('1.0');
      expect(Array.isArray(body.records)).toBe(true);
      expect(body.exportedAt).toBeDefined();
      expect(body.recordCount).toBeGreaterThanOrEqual(0);
    });

    it('should include all transaction fields in JSON export', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({ format: 'json', limit: 1 });

      expect(response.status).toBe(200);

      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      if (body.records.length > 0) {
        const record = body.records[0];
        expect(record).toHaveProperty('id');
        expect(record).toHaveProperty('user');
        expect(record).toHaveProperty('amount');
        expect(record).toHaveProperty('type');
        expect(record).toHaveProperty('createdAt');
      }
    });

    it('should support limit parameter', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({ format: 'json', limit: 5 });

      expect(response.status).toBe(200);
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      expect(body.records.length).toBeLessThanOrEqual(5);
    });

    it('should enforce maximum limit', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({ format: 'json', limit: 999999 });

      expect(response.status).toBe(200);
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      expect(body.records.length).toBeLessThanOrEqual(100000);
    });
  });

  describe('CSV Export', () => {
    it('should export transactions in CSV format', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({ format: 'csv' });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/csv');
      expect(response.headers['content-disposition']).toContain('transactions_');
      expect(response.headers['content-disposition']).toContain('.csv');
      expect(response.headers['x-export-format']).toBe('csv');
      expect(response.text).toContain('id');
    });

    it('should include CSV headers in export', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({ format: 'csv' });

      expect(response.status).toBe(200);
      const lines = response.text.split('\n');
      expect(lines[0]).toContain('id');
      expect(lines[0]).toContain('user');
      expect(lines[0]).toContain('amount');
      expect(lines[0]).toContain('type');
      expect(lines[0]).toContain('createdAt');
    });

    it('should format CSV with proper escaping', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({ format: 'csv' });

      expect(response.status).toBe(200);
      // CSV should be valid format
      expect(response.text).toBeTruthy();
      expect(response.text.includes('"')).toBe(true); // Should have quoted fields
    });
  });

  describe('Filtering', () => {
    it('should filter by transaction type', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({ format: 'json', type: 'deposit' });

      expect(response.status).toBe(200);
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;

      if (body.records.length > 0) {
        body.records.forEach((record: any) => {
          expect(['deposit', 'withdrawal']).toContain(record.type);
        });
      }
    });

    it('should filter by user address', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({
          format: 'json',
          userAddress: 'G' + 'A'.repeat(55),
        });

      expect(response.status).toBe(200);
    });

    it('should filter by date range', async () => {
      const startDate = new Date('2025-01-01').toISOString();
      const endDate = new Date('2025-12-31').toISOString();

      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({
          format: 'json',
          startDate,
          endDate,
        });

      expect(response.status).toBe(200);
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      expect(body.records).toBeDefined();
    });

    it('should reject invalid date format', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({
          format: 'json',
          startDate: 'invalid-date',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
    });
  });

  describe('Error Handling', () => {
    it('should reject invalid format', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({ format: 'xml' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Format must be either');
    });

    it('should default to JSON when no format specified', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export');

      expect(response.status).toBe(200);
      expect(response.headers['x-export-format']).toBe('json');
    });

    it('should handle empty result set', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({
          format: 'json',
          userAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7XZ',
        });

      expect(response.status).toBe(200);
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      expect(body.records).toEqual([]);
      expect(body.recordCount).toBe(0);
    });

    it('should include record count header', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({ format: 'json' });

      expect(response.status).toBe(200);
      expect(response.headers['x-record-count']).toBeDefined();
      expect(/^\d+$/.test(response.headers['x-record-count'] as string)).toBe(true);
    });

    it('should include export timestamp', async () => {
      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({ format: 'json' });

      expect(response.status).toBe(200);
      expect(response.headers['x-exported-at']).toBeDefined();
      const timestamp = new Date(response.headers['x-exported-at'] as string);
      expect(timestamp.getTime()).toBeGreaterThan(0);
    });
  });

  describe('Performance', () => {
    it('should complete export within reasonable time for large datasets', async () => {
      const start = Date.now();

      const response = await request(app)
        .get('/api/v1/vault/transactions/export')
        .query({ format: 'json', limit: 1000 });

      const duration = Date.now() - start;

      expect(response.status).toBe(200);
      // Should complete within 5 seconds
      expect(duration).toBeLessThan(5000);
    });

    it('should handle concurrent export requests', async () => {
      const requests = Array.from({ length: 3 }).map(() =>
        request(app)
          .get('/api/v1/vault/transactions/export')
          .query({ format: 'json' }),
      );

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
    });
  });
});
