/**
 * Lightweight tracing facade.
 *
 * This module intentionally avoids hard dependencies on OpenTelemetry packages
 * so backend builds remain portable across CI environments.
 */

export enum SpanStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}

export interface Span {
  setAttributes: (attributes: Record<string, string | number | boolean>) => void;
  setStatus: (status: { code: SpanStatusCode; message?: string }) => void;
  recordException: (error: Error) => void;
  end: () => void;
}

export interface Tracer {
  startSpan: (name: string) => Span;
  startActiveSpan: <T>(name: string, callback: (span: Span) => Promise<T>) => Promise<T>;
}

const noopSpan: Span = {
  setAttributes: () => undefined,
  setStatus: () => undefined,
  recordException: () => undefined,
  end: () => undefined,
};

const tracer: Tracer = {
  startSpan: () => noopSpan,
  startActiveSpan: async <T>(_name: string, callback: (span: Span) => Promise<T>) => {
    return callback(noopSpan);
  },
};

const OTEL_ENABLED = process.env.NODE_ENV !== 'test' && process.env.OTEL_ENABLED !== 'false';

export function initTracing(): void {
  if (!OTEL_ENABLED) {
    return;
  }
}

export async function shutdownTracing(): Promise<void> {
  return;
}

export function getTracer(): Tracer {
  return tracer;
}

export async function withSpan<T>(
  _name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  if (attributes) {
    noopSpan.setAttributes(attributes);
  }

  try {
    const result = await fn(noopSpan);
    noopSpan.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    noopSpan.recordException(err as Error);
    noopSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    noopSpan.end();
  }
}

export function getCurrentTraceId(): string | undefined {
  return undefined;
}

export const context = {};
