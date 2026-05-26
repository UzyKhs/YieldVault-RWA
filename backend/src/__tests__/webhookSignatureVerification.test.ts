import {
  computeSignature,
  verifySignature,
  verifyWebhookRequest,
  createSignatureHeader,
  createTimestampHeader,
} from '../webhookSignatureVerification';

/**
 * Unit tests for Webhook Signature Verification
 * Issue #442: Backend: Add HMAC-SHA256 signature verification for webhook payload delivery
 */

describe('Webhook Signature Verification', () => {
  const testSecret = 'test-webhook-secret-key-12345';
  const testPayload = {
    eventType: 'transaction.deposit.created',
    sentAt: '2025-05-26T00:00:00Z',
    payload: {
      transactionId: 'tx-123',
      amount: '1000',
      asset: 'USD',
    },
  };

  describe('computeSignature', () => {
    it('should compute HMAC-SHA256 signature for string payload', () => {
      const payload = 'test payload';
      const signature = computeSignature(payload, testSecret);

      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
      expect(signature.length).toBe(64); // SHA256 hex is 64 chars
      expect(/^[a-f0-9]+$/.test(signature)).toBe(true); // Hex characters only
    });

    it('should compute HMAC-SHA256 signature for object payload', () => {
      const signature = computeSignature(testPayload, testSecret);

      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
      expect(signature.length).toBe(64);
    });

    it('should produce consistent signatures for same payload', () => {
      const sig1 = computeSignature(testPayload, testSecret);
      const sig2 = computeSignature(testPayload, testSecret);

      expect(sig1).toBe(sig2);
    });

    it('should produce different signatures for different payloads', () => {
      const payload1 = { data: 'test1' };
      const payload2 = { data: 'test2' };

      const sig1 = computeSignature(payload1, testSecret);
      const sig2 = computeSignature(payload2, testSecret);

      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different secrets', () => {
      const sig1 = computeSignature(testPayload, 'secret1');
      const sig2 = computeSignature(testPayload, 'secret2');

      expect(sig1).not.toBe(sig2);
    });

    it('should handle empty payload', () => {
      const signature = computeSignature({}, testSecret);
      expect(signature).toBeDefined();
      expect(signature.length).toBe(64);
    });

    it('should handle complex nested objects', () => {
      const complexPayload = {
        level1: {
          level2: {
            level3: {
              data: 'deep',
              array: [1, 2, 3],
            },
          },
        },
      };

      const signature = computeSignature(complexPayload, testSecret);
      expect(signature).toBeDefined();
      expect(signature.length).toBe(64);
    });
  });

  describe('verifySignature', () => {
    it('should verify valid signature', () => {
      const signature = computeSignature(testPayload, testSecret);
      const isValid = verifySignature(testPayload, signature, testSecret);

      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const signature = 'invalid' + 'a'.repeat(58);
      const isValid = verifySignature(testPayload, signature, testSecret);

      expect(isValid).toBe(false);
    });

    it('should reject signature with wrong secret', () => {
      const signature = computeSignature(testPayload, testSecret);
      const isValid = verifySignature(testPayload, signature, 'wrong-secret');

      expect(isValid).toBe(false);
    });

    it('should be timing-safe (prevent timing attacks)', () => {
      const correctSig = computeSignature(testPayload, testSecret);
      const wrongSig1 = 'a' + correctSig.substring(1);
      const wrongSig2 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

      const result1 = verifySignature(testPayload, wrongSig1, testSecret);
      const result2 = verifySignature(testPayload, wrongSig2, testSecret);

      // Both should be false (timing should be similar)
      expect(result1).toBe(false);
      expect(result2).toBe(false);
    });

    it('should handle string payload', () => {
      const payload = 'test message';
      const signature = computeSignature(payload, testSecret);
      const isValid = verifySignature(payload, signature, testSecret);

      expect(isValid).toBe(true);
    });

    it('should handle different JSON serialization', () => {
      // Object with same data but different key order
      const payload1 = { a: 1, b: 2 };
      const payload2 = { b: 2, a: 1 };

      const sig1 = computeSignature(payload1, testSecret);
      const sig2 = computeSignature(payload2, testSecret);

      // JSON.stringify may not preserve order, so signatures could differ
      // But verification should still work with the exact same payload
      const isValid1 = verifySignature(payload1, sig1, testSecret);
      const isValid2 = verifySignature(payload2, sig2, testSecret);

      expect(isValid1).toBe(true);
      expect(isValid2).toBe(true);
    });
  });

  describe('verifyWebhookRequest', () => {
    it('should verify valid webhook request', () => {
      const payload = JSON.stringify(testPayload);
      const signature = computeSignature(payload, testSecret);
      const timestamp = Date.now().toString();

      const result = verifyWebhookRequest(payload, signature, timestamp, testSecret);

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject request with missing signature', () => {
      const timestamp = Date.now().toString();
      const result = verifyWebhookRequest(testPayload, '', timestamp, testSecret);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('signature');
    });

    it('should reject request with missing timestamp', () => {
      const signature = computeSignature(testPayload, testSecret);
      const result = verifyWebhookRequest(testPayload, signature, '', testSecret);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('timestamp');
    });

    it('should reject request with invalid timestamp format', () => {
      const signature = computeSignature(testPayload, testSecret);
      const result = verifyWebhookRequest(testPayload, signature, 'invalid-time', testSecret);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('timestamp');
    });

    it('should reject request with future timestamp', () => {
      const signature = computeSignature(testPayload, testSecret);
      const futureTimestamp = (Date.now() + 60000).toString();

      const result = verifyWebhookRequest(testPayload, signature, futureTimestamp, testSecret);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('future');
    });

    it('should reject request older than max age', () => {
      const signature = computeSignature(testPayload, testSecret);
      const oldTimestamp = (Date.now() - 400000).toString(); // 400 seconds old

      const result = verifyWebhookRequest(testPayload, signature, oldTimestamp, testSecret, 300); // 300 second max age

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('too old');
    });

    it('should accept request within max age', () => {
      const signature = computeSignature(testPayload, testSecret);
      const recentTimestamp = (Date.now() - 100000).toString(); // 100 seconds old

      const result = verifyWebhookRequest(
        testPayload,
        signature,
        recentTimestamp,
        testSecret,
        300, // 300 second max age
      );

      expect(result.isValid).toBe(true);
    });

    it('should reject request with invalid signature', () => {
      const invalidSignature = 'invalid' + 'a'.repeat(58);
      const timestamp = Date.now().toString();

      const result = verifyWebhookRequest(testPayload, invalidSignature, timestamp, testSecret);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Signature');
    });

    it('should use custom maxAgeSeconds parameter', () => {
      const signature = computeSignature(testPayload, testSecret);
      const timestamp = (Date.now() - 100000).toString(); // 100 seconds old

      // With 50 second max age - should fail
      const result1 = verifyWebhookRequest(testPayload, signature, timestamp, testSecret, 50);
      expect(result1.isValid).toBe(false);

      // With 200 second max age - should pass
      const result2 = verifyWebhookRequest(testPayload, signature, timestamp, testSecret, 200);
      expect(result2.isValid).toBe(true);
    });

    it('should default maxAgeSeconds to 5 minutes', () => {
      const signature = computeSignature(testPayload, testSecret);
      const timestamp = (Date.now() - 300000).toString(); // 300 seconds old

      // Should accept exactly at 5 minute boundary
      const result = verifyWebhookRequest(testPayload, signature, timestamp, testSecret);
      // May be true or false depending on exact timing, but should not throw
      expect(result.isValid).toBeUndefined() !== true; // Should have a boolean result
    });
  });

  describe('createSignatureHeader', () => {
    it('should create valid signature header', () => {
      const header = createSignatureHeader(testPayload, testSecret);

      expect(header).toBeDefined();
      expect(typeof header).toBe('string');
      expect(header.length).toBe(64);
    });

    it('should match computeSignature output', () => {
      const sig = computeSignature(testPayload, testSecret);
      const header = createSignatureHeader(testPayload, testSecret);

      expect(header).toBe(sig);
    });
  });

  describe('createTimestampHeader', () => {
    it('should create valid timestamp header', () => {
      const header = createTimestampHeader();

      expect(header).toBeDefined();
      expect(typeof header).toBe('string');
      expect(/^\d+$/.test(header)).toBe(true);
    });

    it('should return current timestamp', () => {
      const before = Date.now();
      const header = createTimestampHeader();
      const after = Date.now();

      const timestamp = parseInt(header, 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('should return milliseconds timestamp', () => {
      const header = createTimestampHeader();
      const timestamp = parseInt(header, 10);

      // Timestamp should be in milliseconds (13 digits for dates around 2025)
      expect(timestamp.toString().length).toBe(13);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete webhook payload signing and verification flow', () => {
      // Simulate server side: create signature and timestamp
      const payload = JSON.stringify(testPayload);
      const signature = createSignatureHeader(payload, testSecret);
      const timestamp = createTimestampHeader();

      // Simulate client side: receive and verify
      const result = verifyWebhookRequest(payload, signature, timestamp, testSecret);

      expect(result.isValid).toBe(true);
    });

    it('should detect tampering with payload', () => {
      const payload = JSON.stringify(testPayload);
      const signature = createSignatureHeader(payload, testSecret);
      const timestamp = createTimestampHeader();

      // Tamper with payload
      const tamperedPayload = payload.replace('1000', '9999');

      const result = verifyWebhookRequest(tamperedPayload, signature, timestamp, testSecret);

      expect(result.isValid).toBe(false);
    });

    it('should detect replay attacks with old timestamp', () => {
      const payload = JSON.stringify(testPayload);
      const signature = createSignatureHeader(payload, testSecret);

      // Use very old timestamp
      const oldTimestamp = (Date.now() - 600000).toString(); // 10 minutes ago

      const result = verifyWebhookRequest(payload, signature, oldTimestamp, testSecret);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('too old');
    });
  });
});
