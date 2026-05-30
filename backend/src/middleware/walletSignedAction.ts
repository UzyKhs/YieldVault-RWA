/**
 * Middleware: validates wallet signature + consumes server-issued nonce.
 */

import type { Request, Response, NextFunction } from 'express';
import {
  walletNonceService,
  NonceExpiredError,
  NonceReplayError,
  NonceNotFoundError,
  NonceActionMismatchError,
  NonceWalletMismatchError,
  type WalletAction,
} from '../walletNonce';
import {
  verifyWalletActionSignature,
  InvalidWalletSignatureError,
  isWalletSignatureEnforced,
  buildWalletSignMessage,
} from '../walletSignature';
import { normalizeWalletAddress } from '../walletUtils';

function sendSignedActionError(res: Response, err: unknown): void {
  if (err instanceof NonceReplayError) {
    res.status(401).json({
      error: 'Nonce Replay',
      status: 401,
      code: err.code,
      message: err.message,
    });
    return;
  }

  if (err instanceof NonceExpiredError) {
    res.status(401).json({
      error: 'Nonce Expired',
      status: 401,
      code: err.code,
      message: err.message,
    });
    return;
  }

  if (
    err instanceof NonceNotFoundError ||
    err instanceof NonceActionMismatchError ||
    err instanceof NonceWalletMismatchError
  ) {
    res.status(401).json({
      error: 'Invalid Nonce',
      status: 401,
      code: err instanceof NonceNotFoundError ? err.code : (err as { code: string }).code,
      message: err instanceof Error ? err.message : 'Invalid nonce',
    });
    return;
  }

  if (err instanceof InvalidWalletSignatureError) {
    res.status(401).json({
      error: 'Invalid Signature',
      status: 401,
      code: err.code,
      message: err.message,
    });
    return;
  }

  res.status(500).json({
    error: 'Internal Server Error',
    status: 500,
    message: err instanceof Error ? err.message : 'Failed to verify signed wallet action',
  });
}

export interface SignedWalletBody {
  walletAddress: string;
  nonce: string;
  signature: string;
}

/**
 * When enforcement is enabled, requires nonce + signature on the request body.
 */
export function requireSignedWalletAction(action: WalletAction) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!isWalletSignatureEnforced()) {
      next();
      return;
    }

    const body = req.body as SignedWalletBody;
    const { walletAddress, nonce, signature } = body;

    if (!walletAddress || !nonce || !signature) {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        code: 'SIGNED_ACTION_REQUIRED',
        message:
          'walletAddress, nonce, and signature are required. ' +
          'Obtain a nonce from POST /api/v1/auth/nonce before signing.',
      });
      return;
    }

    try {
      const meta = await walletNonceService.validateForUse(walletAddress, action, nonce);

      verifyWalletActionSignature({
        walletAddress,
        action,
        nonce: meta.nonce,
        issuedAt: meta.issuedAt,
        expiresAt: meta.expiresAt,
        signature,
      });

      await walletNonceService.consume(walletAddress, action, nonce);
      req.body.walletAddress = normalizeWalletAddress(walletAddress);
      next();
    } catch (err) {
      sendSignedActionError(res, err);
    }
  };
}

export { buildWalletSignMessage };
