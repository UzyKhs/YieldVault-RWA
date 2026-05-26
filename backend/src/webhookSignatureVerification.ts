/**
 * Webhook Signature Verification Utilities
 * Implements HMAC-SHA256 signature verification for webhook payloads
 * Issue #442: Backend: Add HMAC-SHA256 signature verification for webhook payload delivery
 */

import crypto from 'crypto';
import { logger } from './middleware/structuredLogging';

/**
 * Signature header name used for webhook verification
 */
export const SIGNATURE_HEADER = 'x-yieldvault-signature';

/**
 * Timestamp header name to prevent replay attacks
 */
export const TIMESTAMP_HEADER = 'x-yieldvault-timestamp';

/**
 * Compute HMAC-SHA256 signature for a payload
 * @param payload The payload to sign (as string or object)
 * @param secret The shared secret for signing
 * @returns The hex-encoded signature
 */
export function computeSignature(payload: string | object, secret: string): string {
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
}

/**
 * Verify webhook signature
 * @param payload The payload that was received (as string or object)
 * @param signature The signature header value to verify against
 * @param secret The shared secret for verification
 * @returns True if signature is valid, false otherwise
 */
export function verifySignature(
  payload: string | object,
  signature: string,
  secret: string,
): boolean {
  try {
    const expectedSignature = computeSignature(payload, secret);
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch (error) {
    logger.log('warn', 'Signature verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Verify webhook request signature and timestamp
 * Prevents replay attacks by checking timestamp is within tolerance
 * @param payload The request body (as string or object)
 * @param signature The signature header value
 * @param timestamp The timestamp header value
 * @param secret The shared secret for verification
 * @param maxAgeSeconds Maximum age of the request in seconds (default: 5 minutes)
 * @returns Object with verification result and any errors
 */
export function verifyWebhookRequest(
  payload: string | object,
  signature: string,
  timestamp: string,
  secret: string,
  maxAgeSeconds: number = 300,
): {
  isValid: boolean;
  error?: string;
} {
  try {
    // Verify signature exists
    if (!signature) {
      return {
        isValid: false,
        error: 'Missing signature header',
      };
    }

    // Verify timestamp exists
    if (!timestamp) {
      return {
        isValid: false,
        error: 'Missing timestamp header',
      };
    }

    // Verify timestamp is recent (prevent replay attacks)
    const timestampMs = parseInt(timestamp, 10);
    if (isNaN(timestampMs)) {
      return {
        isValid: false,
        error: 'Invalid timestamp format',
      };
    }

    const now = Date.now();
    const ageSeconds = (now - timestampMs) / 1000;

    if (ageSeconds < 0) {
      return {
        isValid: false,
        error: 'Request timestamp is in the future',
      };
    }

    if (ageSeconds > maxAgeSeconds) {
      return {
        isValid: false,
        error: `Request is too old (${Math.floor(ageSeconds)}s > ${maxAgeSeconds}s)`,
      };
    }

    // Verify signature
    const isSignatureValid = verifySignature(payload, signature, secret);
    if (!isSignatureValid) {
      return {
        isValid: false,
        error: 'Signature verification failed',
      };
    }

    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    };
  }
}

/**
 * Create a webhook signature header value
 * @param payload The payload to sign
 * @param secret The shared secret for signing
 * @returns The signature header value to send in webhook request
 */
export function createSignatureHeader(payload: string | object, secret: string): string {
  return computeSignature(payload, secret);
}

/**
 * Create a timestamp header value (current time in milliseconds)
 * @returns The timestamp header value to send in webhook request
 */
export function createTimestampHeader(): string {
  return Date.now().toString();
}
