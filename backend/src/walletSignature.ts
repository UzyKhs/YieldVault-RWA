/**
 * @file walletSignature.ts
 * Canonical signing payload and verification for wallet-bound actions.
 *
 * Verification modes (WALLET_SIGNATURE_MODE):
 *   hmac    – HMAC-SHA256 (development / automated tests)
 *   stellar – Ed25519 via @stellar/stellar-base (production)
 */

import crypto from 'crypto';
import { Keypair } from '@stellar/stellar-base';
import type { WalletAction } from './walletNonce';
import { normalizeWalletAddress } from './walletUtils';

const HMAC_SECRET =
  process.env.WALLET_ACTION_HMAC_SECRET ||
  process.env.JWT_SECRET ||
  'wallet-action-hmac-dev-secret-change-me';

export interface SignMessageParams {
  walletAddress: string;
  action: WalletAction;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

/**
 * Builds the exact UTF-8 string the wallet must sign.
 */
export function buildWalletSignMessage(params: SignMessageParams): string {
  const wallet = normalizeWalletAddress(params.walletAddress);
  return [
    'YieldVault Signed Action',
    `Wallet: ${wallet}`,
    `Action: ${params.action}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expires At: ${params.expiresAt}`,
  ].join('\n');
}

export function getWalletSignatureMode(): 'hmac' | 'stellar' {
  const configured = process.env.WALLET_SIGNATURE_MODE?.toLowerCase();
  if (configured === 'hmac' || configured === 'stellar') {
    return configured;
  }
  return process.env.NODE_ENV === 'production' ? 'stellar' : 'hmac';
}

export function isWalletSignatureEnforced(): boolean {
  const flag = process.env.WALLET_NONCE_ENFORCEMENT?.toLowerCase();
  if (flag === 'off' || flag === 'false' || flag === '0') {
    return false;
  }
  if (flag === 'strict' || flag === 'on' || flag === 'true' || flag === '1') {
    return true;
  }
  return process.env.NODE_ENV === 'production';
}

function verifyHmacSignature(message: string, signature: string): boolean {
  const expected = crypto.createHmac('sha256', HMAC_SECRET).update(message).digest('hex');
  const provided = signature.trim().toLowerCase();
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

function verifyStellarSignature(
  walletAddress: string,
  message: string,
  signature: string,
): boolean {
  try {
    const keypair = Keypair.fromPublicKey(normalizeWalletAddress(walletAddress));
    const messageBuffer = Buffer.from(message, 'utf8');
    const signatureBuffer = Buffer.from(signature.trim(), 'base64');
    return keypair.verify(messageBuffer, signatureBuffer);
  } catch {
    return false;
  }
}

export class InvalidWalletSignatureError extends Error {
  readonly code = 'SIGNATURE_INVALID';

  constructor(message = 'Wallet signature verification failed') {
    super(message);
    this.name = 'InvalidWalletSignatureError';
  }
}

/**
 * Verifies that `signature` matches the canonical message for the action.
 */
export function verifyWalletActionSignature(params: SignMessageParams & {
  signature: string;
}): void {
  const message = buildWalletSignMessage(params);
  const mode = getWalletSignatureMode();

  const valid =
    mode === 'stellar'
      ? verifyStellarSignature(params.walletAddress, message, params.signature)
      : verifyHmacSignature(message, params.signature);

  if (!valid) {
    throw new InvalidWalletSignatureError();
  }
}

/**
 * Signs a message for tests (HMAC mode only).
 */
export function signWalletActionForTests(params: SignMessageParams): string {
  const message = buildWalletSignMessage(params);
  return crypto.createHmac('sha256', HMAC_SECRET).update(message).digest('hex');
}
