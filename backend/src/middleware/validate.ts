/**
 * Request schema validation middleware using Zod.
 *
 * Usage:
 *   router.post('/deposits', validate({ body: DepositSchema }), handler)
 *
 * Validates req.body, req.query, and/or req.params against the provided schemas.
 * Strips unknown fields from req.body when a body schema is provided (strict mode).
 * Returns a uniform 400 response on failure.
 */

import { z, ZodError, ZodTypeAny } from 'zod';
import type { Request, Response, NextFunction } from 'express';

// ─── Shared field schemas ─────────────────────────────────────────────────────

/** Stellar wallet address: G + 55 base32 chars, uppercase */
export const walletAddressSchema = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, 'Invalid Stellar wallet address format');

/** Positive numeric amount (accepts number or numeric string) */
export const amountSchema = z
  .union([z.number(), z.string().regex(/^\d+(\.\d+)?$/, 'Amount must be a positive number')])
  .transform((v) => Number(v))
  .refine((v) => v > 0, 'Amount must be greater than 0')
  .refine((v) => isFinite(v), 'Amount must be a finite number');

// ─── Body schemas ─────────────────────────────────────────────────────────────

const signedActionFields = {
  nonce: z.string().min(16).max(128),
  signature: z.string().min(32).max(512),
};

/** POST /api/v1/vault/deposits  and  POST /api/v1/vault/withdrawals */
export const VaultOperationSchema = z
  .object({
    amount: amountSchema,
    asset: z.string().min(1).max(12),
    walletAddress: walletAddressSchema,
    email: z.string().email().optional(),
    referralCode: z.string().max(64).optional(),
    nonce: z.string().min(16).max(128).optional(),
    signature: z.string().min(32).max(512).optional(),
  })
  .strict();

/** Vault write body when wallet nonce enforcement is strict */
export const SignedVaultOperationSchema = z
  .object({
    amount: amountSchema,
    asset: z.string().min(1).max(12),
    walletAddress: walletAddressSchema,
    email: z.string().email().optional(),
    referralCode: z.string().max(64).optional(),
    ...signedActionFields,
  })
  .strict();

/** POST /api/v1/auth/nonce */
export const NonceRequestSchema = z
  .object({
    walletAddress: walletAddressSchema,
    action: z.enum(['login', 'deposit', 'withdrawal']),
  })
  .strict();

/** POST /api/v1/auth/login */
export const LoginSchema = z
  .object({
    walletAddress: walletAddressSchema,
    nonce: z.string().min(16).max(128).optional(),
    signature: z.string().min(32).max(512).optional(),
  })
  .strict();

/** POST /api/v1/auth/login when wallet nonce enforcement is strict */
export const SignedLoginSchema = z
  .object({
    walletAddress: walletAddressSchema,
    ...signedActionFields,
  })
  .strict();

/** POST /api/v1/auth/refresh */
export const RefreshSchema = z
  .object({
    refreshToken: z.string().min(1, 'refreshToken is required'),
  })
  .strict();

// ─── Middleware factory ───────────────────────────────────────────────────────

interface ValidateTargets {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function formatZodError(err: ZodError): string {
  return err.errors
    .map((e) => `${e.path.length ? e.path.join('.') + ': ' : ''}${e.message}`)
    .join('; ');
}

export function validate(schemas: ValidateTargets) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: 'Bad Request',
          status: 400,
          message: formatZodError(err),
          details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
        });
        return;
      }
      next(err);
    }
  };
}

// Re-export z for convenience in tests
export { z };
