const DEFAULT_SENSITIVE_KEYS = [
  'authorization',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'token',
  'secret',
  'password',
  'signature',
  'private_key',
  'nonce',
  'passphrase',
  'credential',
];

const REDACTION_TOKEN = '[REDACTED]';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return DEFAULT_SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive));
}

export function redactSensitiveAttributes<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveAttributes(item)) as T;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      redacted[key] = REDACTION_TOKEN;
      continue;
    }

    redacted[key] = redactSensitiveAttributes(nestedValue);
  }

  return redacted as T;
}
