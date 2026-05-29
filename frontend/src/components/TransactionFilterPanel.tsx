import React, { useState, useEffect, useCallback, useId } from "react";
import type { TransactionFilters, TxType, TxStatus } from "../hooks/useTransactionFilters";
import { VALID_TX_TYPES, VALID_TX_STATUSES } from "../hooks/useTransactionFilters";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<TxType, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  transfer: "Transfer",
  trade: "Trade",
};

const STATUS_LABELS: Record<TxStatus, string> = {
  pending: "Pending",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_COLORS: Record<TxStatus, string> = {
  pending: "var(--text-warning)",
  completed: "var(--accent-green)",
  failed: "var(--text-error)",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TransactionFilterPanelProps {
  filters: TransactionFilters;
  onSearchChange: (value: string) => void;
  onTypesChange: (types: TxType[]) => void;
  onStatusesChange: (statuses: TxStatus[]) => void;
  /** Asset options to show in the asset select */
  assets?: string[];
  onAssetChange?: (value: string) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onAmountMinChange: (value: string) => void;
  onAmountMaxChange: (value: string) => void;
  onClearAll: () => void;
  hasActiveFilters: boolean;
}

// ---------------------------------------------------------------------------
// Sub-component: CheckGroup
// ---------------------------------------------------------------------------

interface CheckGroupProps<T extends string> {
  id: string;
  label: string;
  options: readonly T[];
  selected: T[];
  labelMap: Record<T, string>;
  colorMap?: Record<T, string>;
  onChange: (selected: T[]) => void;
}

function CheckGroup<T extends string>({
  id,
  label,
  options,
  selected,
  labelMap,
  colorMap,
  onChange,
}: CheckGroupProps<T>) {
  const toggle = (value: T) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <fieldset className="tx-filter-fieldset" id={id}>
      <legend className="tx-filter-legend">{label}</legend>
      <div className="tx-filter-check-group">
        {options.map((option) => {
          const isChecked = selected.includes(option);
          const color = colorMap?.[option];
          return (
            <label
              key={option}
              className={`tx-filter-check-label${isChecked ? " tx-filter-check-label--active" : ""}`}
              style={isChecked && color ? { borderColor: color, color } : undefined}
            >
              <input
                type="checkbox"
                className="tx-filter-checkbox"
                checked={isChecked}
                aria-label={`Filter by ${label} ${labelMap[option]}`}
                onChange={() => toggle(option)}
              />
              <span
                className="tx-filter-check-pip"
                style={color ? { background: color } : undefined}
              />
              {labelMap[option]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300;

export const TransactionFilterPanel: React.FC<TransactionFilterPanelProps> = ({
  filters,
  onSearchChange,
  onTypesChange,
  onStatusesChange,
  onDateFromChange,
  onDateToChange,
  onAmountMinChange,
  onAmountMaxChange,
  onClearAll,
  hasActiveFilters,
}) => {
  const uid = useId();
  const [isExpanded, setIsExpanded] = useState(true);

  // ---------------------------------------------------------------------------
  // Local controlled state for debounced inputs
  // ---------------------------------------------------------------------------

  const [localSearch, setLocalSearch] = useState(filters.search);
  const [localAmountMin, setLocalAmountMin] = useState(filters.amountMin);
  const [localAmountMax, setLocalAmountMax] = useState(filters.amountMax);

  // Sync local state when URL changes externally (e.g. back/forward, clearAll)
  useEffect(() => {
    setLocalSearch(filters.search);
  }, [filters.search]);

  useEffect(() => {
    setLocalAmountMin(filters.amountMin);
  }, [filters.amountMin]);

  useEffect(() => {
    setLocalAmountMax(filters.amountMax);
  }, [filters.amountMax]);

  // ---------------------------------------------------------------------------
  // Debounced propagation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (localSearch === filters.search) return;
    const id = window.setTimeout(() => onSearchChange(localSearch), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [localSearch, filters.search, onSearchChange]);

  useEffect(() => {
    if (localAmountMin === filters.amountMin) return;
    const id = window.setTimeout(
      () => onAmountMinChange(localAmountMin),
      DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [localAmountMin, filters.amountMin, onAmountMinChange]);

  useEffect(() => {
    if (localAmountMax === filters.amountMax) return;
    const id = window.setTimeout(
      () => onAmountMaxChange(localAmountMax),
      DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [localAmountMax, filters.amountMax, onAmountMaxChange]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleClearAll = useCallback(() => {
    setLocalSearch("");
    setLocalAmountMin("");
    setLocalAmountMax("");
    onClearAll();
  }, [onClearAll]);

  const handleResetField = (fn?: () => void) => {
    if (fn) fn();
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="tx-filter-panel glass-panel" aria-label="Transaction filters">
      {/* ── Panel header ─────────────────────────────────────────── */}
      <div className="tx-filter-header">
        <div className="tx-filter-header-left">
          <span className="tx-filter-icon" aria-hidden="true">⚡</span>
          <span className="tx-filter-title">Filters</span>
          {hasActiveFilters && (
            <span className="tx-filter-badge" aria-label="Filters active">
              Active
            </span>
          )}
        </div>

        <div className="tx-filter-header-right">
          {hasActiveFilters && (
            <button
              type="button"
              id={`${uid}-clear`}
              className="tx-filter-clear-btn"
              onClick={handleClearAll}
              aria-label="Clear all filters"
            >
              ✕ Clear Filters
            </button>
          )}
          <button
            type="button"
            className="tx-filter-toggle"
            aria-expanded={isExpanded}
            aria-controls={`${uid}-body`}
            onClick={() => setIsExpanded((p) => !p)}
            aria-label={isExpanded ? "Collapse filters" : "Expand filters"}
          >
            <span
              className="tx-filter-chevron"
              style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
              aria-hidden="true"
            >
              ▾
            </span>
          </button>
        </div>
      </div>

      {/* ── Panel body ───────────────────────────────────────────── */}
      {isExpanded && (
        <div
          id={`${uid}-body`}
          className="tx-filter-body"
          role="group"
          aria-label="Filter controls"
        >
          {/* Row 1: Search + Date range */}
          <div className="tx-filter-row">
            {/* Text search */}
            <div className="tx-filter-field tx-filter-field--wide">
              <label
                htmlFor={`${uid}-search`}
                className="tx-filter-field-label"
              >
                Search
                <button
                  type="button"
                  className="tx-filter-reset-small"
                  onClick={() => handleResetField(() => onSearchChange(""))}
                  aria-label="Reset search"
                >
                  Reset
                </button>
              </label>
              <div className="tx-filter-input-wrapper">
                <span className="tx-filter-input-icon" aria-hidden="true">🔍</span>
                <input
                  id={`${uid}-search`}
                  type="search"
                  className="tx-filter-input"
                  placeholder="Hash, description, counterparty…"
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  aria-label="Search transactions"
                  autoComplete="off"
                />
                {localSearch && (
                  <button
                    type="button"
                    className="tx-filter-input-clear"
                    onClick={() => setLocalSearch("")}
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Date from */}
            <div className="tx-filter-field">
              <label
                htmlFor={`${uid}-date-from`}
                className="tx-filter-field-label"
              >
                From date
                <button
                  type="button"
                  className="tx-filter-reset-small"
                  onClick={() => handleResetField(() => onDateFromChange(""))}
                  aria-label="Reset from date"
                >
                  Reset
                </button>
              </label>
              <div className="tx-filter-input-wrapper">
                <input
                  id={`${uid}-date-from`}
                  type="date"
                  className="tx-filter-input"
                  value={filters.dateFrom}
                  max={filters.dateTo || undefined}
                  onChange={(e) => onDateFromChange(e.target.value)}
                  aria-label="Filter from date"
                />
              </div>
            </div>

            {/* Date to */}
            <div className="tx-filter-field">
              <label
                htmlFor={`${uid}-date-to`}
                className="tx-filter-field-label"
              >
                To date
                <button
                  type="button"
                  className="tx-filter-reset-small"
                  onClick={() => handleResetField(() => onDateToChange(""))}
                  aria-label="Reset to date"
                >
                  Reset
                </button>
              </label>
              <div className="tx-filter-input-wrapper">
                <input
                  id={`${uid}-date-to`}
                  type="date"
                  className="tx-filter-input"
                  value={filters.dateTo}
                  min={filters.dateFrom || undefined}
                  onChange={(e) => onDateToChange(e.target.value)}
                  aria-label="Filter to date"
                />
              </div>
            </div>
          </div>

          {/* Row 2: Amount range */}
          <div className="tx-filter-row">
            {/* Asset select */}
            <div className="tx-filter-field">
              <label htmlFor={`${uid}-asset`} className="tx-filter-field-label">
                Asset
                <button
                  type="button"
                  className="tx-filter-reset-small"
                  onClick={() => handleResetField(() => onAssetChange?.("") )}
                  aria-label="Reset asset"
                >
                  Reset
                </button>
              </label>
              <div className="tx-filter-input-wrapper">
                <select
                  id={`${uid}-asset`}
                  className="tx-filter-input"
                  value={filters.asset}
                  onChange={(e) => onAssetChange?.(e.target.value)}
                >
                  <option value="">All assets</option>
                  {assets?.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="tx-filter-field">
              <label
                htmlFor={`${uid}-amount-min`}
                className="tx-filter-field-label"
              >
                Min amount
                <button
                  type="button"
                  className="tx-filter-reset-small"
                  onClick={() => handleResetField(() => onAmountMinChange(""))}
                  aria-label="Reset min amount"
                >
                  Reset
                </button>
              </label>
              <div className="tx-filter-input-wrapper">
                <span className="tx-filter-input-prefix" aria-hidden="true">$</span>
                <input
                  id={`${uid}-amount-min`}
                  type="number"
                  className="tx-filter-input tx-filter-input--amount"
                  placeholder="0"
                  min="0"
                  step="any"
                  value={localAmountMin}
                  onChange={(e) => setLocalAmountMin(e.target.value)}
                  aria-label="Minimum transaction amount"
                />
              </div>
            </div>

            <div className="tx-filter-field">
              <label
                htmlFor={`${uid}-amount-max`}
                className="tx-filter-field-label"
              >
                Max amount
                <button
                  type="button"
                  className="tx-filter-reset-small"
                  onClick={() => handleResetField(() => onAmountMaxChange(""))}
                  aria-label="Reset max amount"
                >
                  Reset
                </button>
              </label>
              <div className="tx-filter-input-wrapper">
                <span className="tx-filter-input-prefix" aria-hidden="true">$</span>
                <input
                  id={`${uid}-amount-max`}
                  type="number"
                  className="tx-filter-input tx-filter-input--amount"
                  placeholder="∞"
                  min="0"
                  step="any"
                  value={localAmountMax}
                  onChange={(e) => setLocalAmountMax(e.target.value)}
                  aria-label="Maximum transaction amount"
                />
              </div>
            </div>
          </div>

          {/* Row 3: Type + Status multi-select */}
          <div className="tx-filter-row tx-filter-row--checks">
            <CheckGroup
              id={`${uid}-types`}
              label="Type"
              options={VALID_TX_TYPES}
              selected={filters.types}
              labelMap={TYPE_LABELS}
              onChange={(v) => onTypesChange(v as TxType[])}
            />
            <CheckGroup
              id={`${uid}-statuses`}
              label="Status"
              options={VALID_TX_STATUSES}
              selected={filters.statuses}
              labelMap={STATUS_LABELS}
              colorMap={STATUS_COLORS}
              onChange={(v) => onStatusesChange(v as TxStatus[])}
            />
            <div className="tx-filter-reset-group">
              <button
                type="button"
                className="tx-filter-reset-btn"
                onClick={() => onTypesChange([])}
                aria-label="Reset types"
              >
                Reset types
              </button>
              <button
                type="button"
                className="tx-filter-reset-btn"
                onClick={() => onStatusesChange([])}
                aria-label="Reset statuses"
              >
                Reset statuses
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransactionFilterPanel;
