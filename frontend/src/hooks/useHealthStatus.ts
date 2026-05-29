import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HealthState = "healthy" | "degraded" | "unhealthy";

export interface HealthStatus {
  state: HealthState;
  message: string;
  checks?: Record<string, "up" | "down" | string>;
  lastChecked: Date | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;

const INITIAL_STATUS: HealthStatus = {
  state: "healthy",
  message: "All systems operational",
  lastChecked: null,
};

const UNREACHABLE_STATUS: HealthStatus = {
  state: "unhealthy",
  message: "Unable to connect to health service",
  lastChecked: null,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHealthStatus(
  url = "/health",
  intervalMs = POLL_INTERVAL_MS
): HealthStatus & { refetch: () => void } {
  const [status, setStatus] = useState<HealthStatus>(INITIAL_STATUS);
  const abortRef = useRef<AbortController | null>(null);

  const fetchHealth = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([
          abortRef.current.signal,
          AbortSignal.timeout(FETCH_TIMEOUT_MS),
        ]),
        credentials: "same-origin",
      });

      const data = await response.json();
      const { checks } = data as { checks?: Record<string, string> };
      const timestamp = new Date();

      if (!response.ok) {
        setStatus({
          state: "unhealthy",
          message: data?.message ?? "System unavailable",
          checks,
          lastChecked: timestamp,
        });
        return;
      }

      if (checks) {
        const downServices = Object.entries(checks)
          .filter(([, v]) => v !== "up")
          .map(([k]) => k);

        if (downServices.length > 0) {
          setStatus({
            state: "degraded",
            message: `Issues with: ${downServices.join(", ")}`,
            checks,
            lastChecked: timestamp,
          });
          return;
        }
      }

      setStatus({
        state: "healthy",
        message: "All systems operational",
        checks,
        lastChecked: timestamp,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;

      setStatus((prev) => ({
        ...UNREACHABLE_STATUS,
        lastChecked: new Date(),
        checks: prev.checks,
      }));
    }
  }, [url]);

  useEffect(() => {
    void fetchHealth();

    const intervalId = window.setInterval(() => {
      void fetchHealth();
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
      abortRef.current?.abort();
    };
  }, [fetchHealth, intervalMs]);

  return { ...status, refetch: fetchHealth };
}