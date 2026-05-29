import { useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// ---------------------------------------------------------------------------
// Valid filter enum values — used for safe deserialization
// ---------------------------------------------------------------------------

export const VALID_TX_TYPES = ["deposit", "withdrawal", "transfer", "trade"] as const;
export const VALID_TX_STATUSES = ["pending", "completed", "failed"] as const;

export type TxType = (typeof VALID_TX_TYPES)[number];
export type TxStatus = (typeof VALID_TX_STATUSES)[number];

// ---------------------------------------------------------------------------
// Parsed filter shape
// ---------------------------------------------------------------------------

export interface TransactionFilters {
  /** Free-text search (hash, description, counterparty) */
  search: string;
  /** Asset filter (exact match), or empty string for all */
  asset: string;
  /** Active type filters — empty array means "all" */
  types: TxType[];
  /** Active status filters — empty array means "all" */
  statuses: TxStatus[];
  /** ISO date string (YYYY-MM-DD), or "" */
  dateFrom: string;
  /** ISO date string (YYYY-MM-DD), or "" */
  dateTo: string;
  /** Minimum amount as a string, or "" */
  amountMin: string;
  /** Maximum amount as a string, or "" */
  amountMax: string;
}

// ---------------------------------------------------------------------------
// URL param names
// ---------------------------------------------------------------------------

const PARAM = {
  SEARCH: "search",
  TYPES: "types",
  STATUSES: "statuses",
  DATE_FROM: "dateFrom",
  DATE_TO: "dateTo",
  AMOUNT_MIN: "amountMin",
  AMOUNT_MAX: "amountMax",
  ASSET: "asset",
  PAGE: "page",
} as const;

// ---------------------------------------------------------------------------
// Safe parsers
// ---------------------------------------------------------------------------

function parseCommaList<T extends string>(
  raw: string | null,
  validValues: readonly T[],
): T[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim().toLowerCase() as T)
    .filter((v): v is T => (validValues as readonly string[]).includes(v));
}

function parseIsoDate(raw: string | null): string {
  if (!raw) return "";
  // Must match YYYY-MM-DD and be a valid date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  return raw;
}

function parsePositiveNumericString(raw: string | null): string {
  if (!raw) return "";
  const n = parseFloat(raw);
  if (!isFinite(n) || n < 0) return "";
  return raw;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTransactionFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  /** Parsed, type-safe filter state derived entirely from the URL */
  const filters = useMemo<TransactionFilters>(() => {
    return {
      search: searchParams.get(PARAM.SEARCH) ?? "",
      asset: (searchParams.get(PARAM.ASSET) ?? "").trim(),
      types: parseCommaList(searchParams.get(PARAM.TYPES), VALID_TX_TYPES),
      statuses: parseCommaList(
        searchParams.get(PARAM.STATUSES),
        VALID_TX_STATUSES,
      ),
      dateFrom: parseIsoDate(searchParams.get(PARAM.DATE_FROM)),
      dateTo: parseIsoDate(searchParams.get(PARAM.DATE_TO)),
      amountMin: parsePositiveNumericString(searchParams.get(PARAM.AMOUNT_MIN)),
      amountMax: parsePositiveNumericString(searchParams.get(PARAM.AMOUNT_MAX)),
    };
  }, [searchParams]);

  /** True when any filter is non-default */
  const hasActiveFilters = useMemo(
    () =>
      Boolean(filters.search) ||
      Boolean(filters.asset) ||
      filters.types.length > 0 ||
      filters.statuses.length > 0 ||
      Boolean(filters.dateFrom) ||
      Boolean(filters.dateTo) ||
      Boolean(filters.amountMin) ||
      Boolean(filters.amountMax),
    [filters],
  );

  // ---------------------------------------------------------------------------
  // Helpers for updating the URL (always uses replace to avoid history bloat)
  // ---------------------------------------------------------------------------

  const updateParams = useCallback(
    (
      updater: (next: URLSearchParams) => void,
      resetPage = true,
    ) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          updater(next);
          if (resetPage) next.set(PARAM.PAGE, "1");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setSearch = useCallback(
    (value: string) => {
      updateParams((next) => {
        if (value) next.set(PARAM.SEARCH, value);
        else next.delete(PARAM.SEARCH);
      });
    },
    [updateParams],
  );

  const setTypes = useCallback(
    (types: TxType[]) => {
      updateParams((next) => {
        if (types.length > 0) next.set(PARAM.TYPES, types.join(","));
        else next.delete(PARAM.TYPES);
      });
    },
    [updateParams],
  );

  const setStatuses = useCallback(
    (statuses: TxStatus[]) => {
      updateParams((next) => {
        if (statuses.length > 0)
          next.set(PARAM.STATUSES, statuses.join(","));
        else next.delete(PARAM.STATUSES);
      });
    },
    [updateParams],
  );

  const setDateFrom = useCallback(
    (value: string) => {
      updateParams((next) => {
        if (value) next.set(PARAM.DATE_FROM, value);
        else next.delete(PARAM.DATE_FROM);
      });
    },
    [updateParams],
  );

  const setDateTo = useCallback(
    (value: string) => {
      updateParams((next) => {
        if (value) next.set(PARAM.DATE_TO, value);
        else next.delete(PARAM.DATE_TO);
      });
    },
    [updateParams],
  );

  const setAmountMin = useCallback(
    (value: string) => {
      updateParams((next) => {
        if (value) next.set(PARAM.AMOUNT_MIN, value);
        else next.delete(PARAM.AMOUNT_MIN);
      });
    },
    [updateParams],
  );

  const setAmountMax = useCallback(
    (value: string) => {
      updateParams((next) => {
        if (value) next.set(PARAM.AMOUNT_MAX, value);
        else next.delete(PARAM.AMOUNT_MAX);
      });
    },
    [updateParams],
  );

  const setAsset = useCallback(
    (value: string) => {
      updateParams((next) => {
        const v = (value ?? "").trim();
        if (v) next.set(PARAM.ASSET, v);
        else next.delete(PARAM.ASSET);
      });
    },
    [updateParams],
  );

  /** Strips all filter params and resets page to 1 */
  const clearAll = useCallback(() => {
    updateParams((next) => {
      next.delete(PARAM.SEARCH);
      next.delete(PARAM.TYPES);
      next.delete(PARAM.STATUSES);
      next.delete(PARAM.DATE_FROM);
      next.delete(PARAM.DATE_TO);
      next.delete(PARAM.AMOUNT_MIN);
      next.delete(PARAM.AMOUNT_MAX);
      next.delete(PARAM.ASSET);
    });
  }, [updateParams]);

  return {
    filters,
    hasActiveFilters,
    setSearch,
    setTypes,
    setStatuses,
    setDateFrom,
    setDateTo,
    setAmountMin,
    setAmountMax,
    setAsset,
    clearAll,
  };
}
