/**
 * @file walletNonce.ts
 * Server-side nonce tracking for signed wallet actions (replay protection).
 *
 * Each nonce is single-use and expires after WALLET_NONCE_TTL_SECONDS.
 * Backed by in-memory storage with optional Redis when REDIS_URL is set.
 */

import crypto from 'crypto';
import NodeCache from 'node-cache';
import Redis from 'ioredis';
import { logger } from './middleware/structuredLogging';
import { normalizeWalletAddress } from './walletUtils';

// ─── Config ───────────────────────────────────────────────────────────────────

export type WalletAction = 'login' | 'deposit' | 'withdrawal';

const DEFAULT_NONCE_TTL_SECONDS = parseInt(process.env.WALLET_NONCE_TTL_SECONDS || '300', 10);
const MAX_ACTIVE_NONCES_PER_WALLET = parseInt(
  process.env.WALLET_NONCE_MAX_ACTIVE_PER_WALLET || '10',
  10,
);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IssuedWalletNonce {
  nonce: string;
  walletAddress: string;
  action: WalletAction;
  issuedAt: string;
  expiresAt: string;
  expiresIn: number;
  message: string;
}

interface StoredNonce {
  nonce: string;
  walletAddress: string;
  action: WalletAction;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
}

export interface NonceStoreMetrics {
  issued: number;
  consumed: number;
  replayRejected: number;
  expiredRejected: number;
  notFoundRejected: number;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class NonceNotFoundError extends Error {
  readonly code = 'NONCE_NOT_FOUND';

  constructor(message = 'Nonce was not issued for this wallet and action') {
    super(message);
    this.name = 'NonceNotFoundError';
  }
}

export class NonceExpiredError extends Error {
  readonly code = 'NONCE_EXPIRED';

  constructor(message = 'Nonce has expired. Request a new nonce and sign again.') {
    super(message);
    this.name = 'NonceExpiredError';
  }
}

export class NonceReplayError extends Error {
  readonly code = 'NONCE_REPLAY';

  constructor(message = 'Nonce has already been used. Request a new nonce and sign again.') {
    super(message);
    this.name = 'NonceReplayError';
  }
}

export class NonceActionMismatchError extends Error {
  readonly code = 'NONCE_ACTION_MISMATCH';

  constructor(message = 'Nonce was issued for a different action') {
    super(message);
    this.name = 'NonceActionMismatchError';
  }
}

export class NonceWalletMismatchError extends Error {
  readonly code = 'NONCE_WALLET_MISMATCH';

  constructor(message = 'Nonce was issued for a different wallet') {
    super(message);
    this.name = 'NonceWalletMismatchError';
  }
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface INonceStore {
  save(entry: StoredNonce, ttlSeconds: number): Promise<void>;
  get(nonce: string): Promise<StoredNonce | null>;
  markUsed(nonce: string): Promise<boolean>;
  countActiveForWallet(walletAddress: string): Promise<number>;
}

// ─── In-memory store ─────────────────────────────────────────────────────────

class InMemoryNonceStore implements INonceStore {
  private readonly byNonce: NodeCache;
  private readonly walletIndex = new Map<string, Set<string>>();

  constructor(ttlSeconds: number) {
    this.byNonce = new NodeCache({
      stdTTL: ttlSeconds,
      checkperiod: Math.min(60, ttlSeconds),
      useClones: false,
    });
  }

  async save(entry: StoredNonce, ttlSeconds: number): Promise<void> {
    this.byNonce.set(entry.nonce, entry, ttlSeconds);
    const set = this.walletIndex.get(entry.walletAddress) ?? new Set();
    set.add(entry.nonce);
    this.walletIndex.set(entry.walletAddress, set);
  }

  async get(nonce: string): Promise<StoredNonce | null> {
    return this.byNonce.get<StoredNonce>(nonce) ?? null;
  }

  async markUsed(nonce: string): Promise<boolean> {
    const entry = this.byNonce.get<StoredNonce>(nonce);
    if (!entry || entry.used) {
      return false;
    }
    entry.used = true;
    this.byNonce.set(nonce, entry);
    return true;
  }

  async countActiveForWallet(walletAddress: string): Promise<number> {
    const set = this.walletIndex.get(walletAddress);
    if (!set) return 0;
    let count = 0;
    for (const nonce of set) {
      const entry = this.byNonce.get<StoredNonce>(nonce);
      if (entry && !entry.used) count++;
    }
    return count;
  }

  flushAll(): void {
    this.byNonce.flushAll();
    this.walletIndex.clear();
  }
}

// ─── Redis store ─────────────────────────────────────────────────────────────

class RedisNonceStore implements INonceStore {
  constructor(private readonly redis: Redis) {}

  private entryKey(nonce: string): string {
    return `wallet-nonce:${nonce}`;
  }

  private walletSetKey(walletAddress: string): string {
    return `wallet-nonce:active:${walletAddress}`;
  }

  async save(entry: StoredNonce, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.entryKey(entry.nonce), JSON.stringify(entry), 'EX', ttlSeconds);
    await this.redis.sadd(this.walletSetKey(entry.walletAddress), entry.nonce);
    await this.redis.expire(this.walletSetKey(entry.walletAddress), ttlSeconds);
  }

  async get(nonce: string): Promise<StoredNonce | null> {
    const raw = await this.redis.get(this.entryKey(nonce));
    if (!raw) return null;
    return JSON.parse(raw) as StoredNonce;
  }

  async markUsed(nonce: string): Promise<boolean> {
    const entry = await this.get(nonce);
    if (!entry || entry.used) {
      return false;
    }
    entry.used = true;
    const ttl = await this.redis.ttl(this.entryKey(nonce));
    await this.redis.set(
      this.entryKey(nonce),
      JSON.stringify(entry),
      'EX',
      ttl > 0 ? ttl : DEFAULT_NONCE_TTL_SECONDS,
    );
    return true;
  }

  async countActiveForWallet(walletAddress: string): Promise<number> {
    const nonces = await this.redis.smembers(this.walletSetKey(walletAddress));
    if (!nonces.length) return 0;
    let active = 0;
    for (const nonce of nonces) {
      const entry = await this.get(nonce);
      if (entry && !entry.used) active++;
    }
    return active;
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

function createNonceStore(): INonceStore {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const redis = new Redis(redisUrl, { lazyConnect: true, enableOfflineQueue: false });
    redis.on('error', (err) => {
      logger.log('error', 'Redis wallet nonce store error', { error: err.message });
    });
    return new RedisNonceStore(redis);
  }
  return new InMemoryNonceStore(DEFAULT_NONCE_TTL_SECONDS);
}

class WalletNonceService {
  private readonly store: INonceStore;
  private readonly inMemoryStore: InMemoryNonceStore | null;
  private metrics: NonceStoreMetrics = {
    issued: 0,
    consumed: 0,
    replayRejected: 0,
    expiredRejected: 0,
    notFoundRejected: 0,
  };

  constructor(store: INonceStore) {
    this.store = store;
    this.inMemoryStore = store instanceof InMemoryNonceStore ? store : null;
  }

  getMetrics(): NonceStoreMetrics {
    return { ...this.metrics };
  }

  getTtlSeconds(): number {
    return DEFAULT_NONCE_TTL_SECONDS;
  }

  async issue(
    walletAddress: string,
    action: WalletAction,
    buildMessage: (meta: Omit<IssuedWalletNonce, 'message'>) => string,
  ): Promise<IssuedWalletNonce> {
    const wallet = normalizeWalletAddress(walletAddress);
    const active = await this.store.countActiveForWallet(wallet);
    if (active >= MAX_ACTIVE_NONCES_PER_WALLET) {
      throw new Error(
        `Too many active nonces for wallet (max ${MAX_ACTIVE_NONCES_PER_WALLET}). ` +
          'Complete or wait for existing nonces to expire.',
      );
    }

    const now = Date.now();
    const expiresAt = now + DEFAULT_NONCE_TTL_SECONDS * 1000;
    const nonce = crypto.randomBytes(24).toString('hex');

    const base: Omit<IssuedWalletNonce, 'message'> = {
      nonce,
      walletAddress: wallet,
      action,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      expiresIn: DEFAULT_NONCE_TTL_SECONDS,
    };

    const issued: IssuedWalletNonce = {
      ...base,
      message: buildMessage(base),
    };

    const stored: StoredNonce = {
      nonce,
      walletAddress: wallet,
      action,
      issuedAt: now,
      expiresAt,
      used: false,
    };

    await this.store.save(stored, DEFAULT_NONCE_TTL_SECONDS);
    this.metrics.issued++;

    return issued;
  }

  /**
   * Loads nonce metadata and validates wallet/action/expiry without consuming.
   */
  async validateForUse(
    walletAddress: string,
    action: WalletAction,
    nonce: string,
  ): Promise<IssuedWalletNonce> {
    const wallet = normalizeWalletAddress(walletAddress);
    const trimmed = nonce.trim();
    const entry = await this.store.get(trimmed);

    if (!entry) {
      this.metrics.notFoundRejected++;
      throw new NonceNotFoundError();
    }

    if (entry.walletAddress !== wallet) {
      this.metrics.notFoundRejected++;
      throw new NonceWalletMismatchError();
    }

    if (entry.action !== action) {
      this.metrics.notFoundRejected++;
      throw new NonceActionMismatchError();
    }

    if (entry.expiresAt < Date.now()) {
      this.metrics.expiredRejected++;
      throw new NonceExpiredError();
    }

    if (entry.used) {
      this.metrics.replayRejected++;
      throw new NonceReplayError();
    }

    return {
      nonce: trimmed,
      walletAddress: wallet,
      action,
      issuedAt: new Date(entry.issuedAt).toISOString(),
      expiresAt: new Date(entry.expiresAt).toISOString(),
      expiresIn: Math.max(0, Math.floor((entry.expiresAt - Date.now()) / 1000)),
      message: '',
    };
  }

  /**
   * Atomically consumes a nonce after signature verification.
   */
  async consume(walletAddress: string, action: WalletAction, nonce: string): Promise<void> {
    await this.validateForUse(walletAddress, action, nonce);
    const marked = await this.store.markUsed(nonce.trim());
    if (!marked) {
      this.metrics.replayRejected++;
      throw new NonceReplayError();
    }
    this.metrics.consumed++;
  }

  clearForTests(): void {
    this.inMemoryStore?.flushAll();
    this.metrics = {
      issued: 0,
      consumed: 0,
      replayRejected: 0,
      expiredRejected: 0,
      notFoundRejected: 0,
    };
  }

  /** Forces a nonce to appear expired (in-memory store tests only). */
  async expireNonceForTests(nonce: string): Promise<void> {
    if (!this.inMemoryStore) {
      return;
    }
    const entry = await this.store.get(nonce);
    if (!entry) {
      return;
    }
    entry.expiresAt = Date.now() - 1000;
    await this.store.save(entry, 1);
  }
}

export const walletNonceService = new WalletNonceService(createNonceStore());
