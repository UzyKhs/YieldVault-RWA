import { useSyncExternalStore, useCallback } from 'react';

/** Threshold in ms after which data is considered stale for display purposes. */
const STALE_THRESHOLD_MS = 60_000; // 1 minute

function subscribeToTime(cb: () => void): () => void {
  const id = setInterval(cb, 15_000);
  return () => clearInterval(id);
}

export interface StaleIndicatorResult {
  /** True when lastUpdated is older than STALE_THRESHOLD_MS. */
  isStale: boolean;
  /** Human-readable age string, e.g. "2 min ago". Empty when no date. */
  ageText: string;
}

/**
 * Derives a live-updating stale indicator from a `lastUpdated` timestamp.
 * Re-evaluates every 15 seconds via `useSyncExternalStore`.
 */
export function useStaleIndicator(lastUpdated: Date | null | undefined): StaleIndicatorResult {
  const getSnapshot = useCallback((): StaleIndicatorResult => {
    if (!lastUpdated) return { isStale: false, ageText: '' };

    const ageMs = Date.now() - lastUpdated.getTime();
    const isStale = ageMs > STALE_THRESHOLD_MS;

    const seconds = Math.floor(ageMs / 1000);
    let ageText = '';
    if (seconds < 60) {
      ageText = 'just now';
    } else {
      const minutes = Math.floor(seconds / 60);
      ageText = minutes === 1 ? '1 min ago' : `${minutes} min ago`;
    }

    return { isStale, ageText };
  }, [lastUpdated]);

  return useSyncExternalStore(subscribeToTime, getSnapshot, getSnapshot);
}
