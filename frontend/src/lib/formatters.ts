/**
 * Formatting utilities for numbers, currencies, and other values.
 */

const DEFAULT_LOCALE = "en-US";
const DEFAULT_CURRENCY = "USD";

export interface LocaleAwareFormatOptions {
  locale?: string;
  fallbackLocale?: string;
}

export interface NumberFormatOptions extends LocaleAwareFormatOptions {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export interface CurrencyFormatOptions extends NumberFormatOptions {
  currency?: string;
  fallbackCurrency?: string;
}

export interface PercentFormatOptions extends NumberFormatOptions {
  isDecimal?: boolean;
}

export interface DateFormatOptions extends LocaleAwareFormatOptions {
  formatOptions?: Intl.DateTimeFormatOptions;
}

export const numberFormatter = new Intl.NumberFormat(DEFAULT_LOCALE, {
  maximumFractionDigits: 2,
});

export const currencyFormatter = new Intl.NumberFormat(DEFAULT_LOCALE, {
  style: "currency",
  currency: DEFAULT_CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function getBrowserLocale(): string | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  if (Array.isArray(navigator.languages)) {
    const preferred = navigator.languages.find((locale) => typeof locale === "string" && locale.trim());
    if (preferred) {
      return preferred;
    }
  }

  return typeof navigator.language === "string" ? navigator.language : undefined;
}

function isSupportedLocale(locale: string): boolean {
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}

export function resolveLocale(preferredLocale?: string, fallbackLocale?: string): string {
  const candidates = [preferredLocale, fallbackLocale, getBrowserLocale(), DEFAULT_LOCALE];
  for (const candidate of candidates) {
    if (candidate && isSupportedLocale(candidate)) {
      return candidate;
    }
  }

  return DEFAULT_LOCALE;
}

export function resolveCurrency(
  preferredCurrency?: string,
  options: LocaleAwareFormatOptions = {},
): string {
  const locale = resolveLocale(options.locale, options.fallbackLocale);
  const candidates = [preferredCurrency, DEFAULT_CURRENCY];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: candidate,
      });
      return candidate;
    } catch {
      continue;
    }
  }

  return DEFAULT_CURRENCY;
}

function normalizeNumberFormatOptions(
  maxDecimalsOrOptions: number | NumberFormatOptions | undefined,
  locale: string | undefined,
): NumberFormatOptions {
  if (typeof maxDecimalsOrOptions === "object" && maxDecimalsOrOptions !== null) {
    return maxDecimalsOrOptions;
  }

  return {
    maximumFractionDigits: typeof maxDecimalsOrOptions === "number" ? maxDecimalsOrOptions : 2,
    locale,
  };
}

function normalizeCurrencyFormatOptions(
  currencyCodeOrOptions: string | CurrencyFormatOptions | undefined,
  maxDecimals: number | undefined,
  locale: string | undefined,
): CurrencyFormatOptions {
  if (typeof currencyCodeOrOptions === "object" && currencyCodeOrOptions !== null) {
    return currencyCodeOrOptions;
  }

  return {
    currency: currencyCodeOrOptions || DEFAULT_CURRENCY,
    minimumFractionDigits: typeof maxDecimals === "number" ? maxDecimals : 2,
    maximumFractionDigits: typeof maxDecimals === "number" ? maxDecimals : 2,
    locale,
  };
}

function normalizePercentFormatOptions(
  isDecimalOrOptions: boolean | PercentFormatOptions | undefined,
  maxDecimals: number | undefined,
  locale: string | undefined,
): PercentFormatOptions {
  if (typeof isDecimalOrOptions === "object" && isDecimalOrOptions !== null) {
    return isDecimalOrOptions;
  }

  const maximumFractionDigits = typeof maxDecimals === "number" ? maxDecimals : 2;
  return {
    isDecimal: Boolean(isDecimalOrOptions),
    minimumFractionDigits: isDecimalOrOptions ? maximumFractionDigits : 0,
    maximumFractionDigits,
    locale,
  };
}

/**
 * Formats a number with up to `maxDecimals` decimal places.
 */
export function formatNumber(value: number, maxDecimals?: number, locale?: string): string;
export function formatNumber(value: number, options?: NumberFormatOptions): string;
export function formatNumber(
  value: number,
  maxDecimalsOrOptions: number | NumberFormatOptions = 2,
  locale?: string,
): string {
  const options = normalizeNumberFormatOptions(maxDecimalsOrOptions, locale);
  const resolvedLocale = resolveLocale(options.locale, options.fallbackLocale);

  if (
    resolvedLocale === DEFAULT_LOCALE &&
    options.maximumFractionDigits === 2 &&
    options.minimumFractionDigits === undefined
  ) {
    return numberFormatter.format(value);
  }

  return new Intl.NumberFormat(resolvedLocale, {
    minimumFractionDigits: options.minimumFractionDigits,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  }).format(value);
}

/**
 * Formats a number as a currency string.
 */
export function formatCurrency(
  value: number,
  currencyCode?: string,
  maxDecimals?: number,
  locale?: string,
): string;
export function formatCurrency(value: number, options?: CurrencyFormatOptions): string;
export function formatCurrency(
  value: number,
  currencyCodeOrOptions: string | CurrencyFormatOptions = DEFAULT_CURRENCY,
  maxDecimals: number = 2,
  locale?: string,
): string {
  const options = normalizeCurrencyFormatOptions(currencyCodeOrOptions, maxDecimals, locale);
  const resolvedLocale = resolveLocale(options.locale, options.fallbackLocale);
  const resolvedCurrency = resolveCurrency(options.currency, options);

  if (
    resolvedLocale === DEFAULT_LOCALE &&
    resolvedCurrency === DEFAULT_CURRENCY &&
    options.minimumFractionDigits === 2 &&
    options.maximumFractionDigits === 2
  ) {
    return currencyFormatter.format(value);
  }

  return new Intl.NumberFormat(resolvedLocale, {
    style: "currency",
    currency: resolvedCurrency,
    minimumFractionDigits: options.minimumFractionDigits ?? options.maximumFractionDigits ?? 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  }).format(value);
}

/**
 * Formats a number as a compact string (e.g., 1.2K, 3.4M).
 */
export function formatCompactNumber(value: number, locale?: string): string {
  return new Intl.NumberFormat(resolveLocale(locale), {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Formats a number as a percentage string. 
 * Expects value in 0-100 range if `isDecimal` is false, or 0-1 range if true.
 */
export function formatPercent(value: number, isDecimal?: boolean, maxDecimals?: number, locale?: string): string;
export function formatPercent(value: number, options?: PercentFormatOptions): string;
export function formatPercent(
  value: number,
  isDecimalOrOptions: boolean | PercentFormatOptions = false,
  maxDecimals: number = 2,
  locale?: string,
): string {
  const options = normalizePercentFormatOptions(isDecimalOrOptions, maxDecimals, locale);
  const resolvedLocale = resolveLocale(options.locale, options.fallbackLocale);

  return new Intl.NumberFormat(resolvedLocale, {
    style: "percent",
    minimumFractionDigits: options.minimumFractionDigits ?? (options.isDecimal ? 2 : 0),
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  }).format(options.isDecimal ? value : value / 100);
}

export function formatDate(
  value: string | number | Date,
  formatOptions: Intl.DateTimeFormatOptions,
  locale?: string,
): string;
export function formatDate(value: string | number | Date, options?: DateFormatOptions): string;
export function formatDate(
  value: string | number | Date,
  formatOptionsOrOptions:
    | Intl.DateTimeFormatOptions
    | DateFormatOptions = {},
  locale?: string,
): string {
  const normalizedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(normalizedDate.getTime())) {
    return "";
  }

  const options =
    "formatOptions" in formatOptionsOrOptions || "locale" in formatOptionsOrOptions
      ? formatOptionsOrOptions
      : { formatOptions: formatOptionsOrOptions, locale };

  const resolvedLocale = resolveLocale(options.locale, options.fallbackLocale);
  return new Intl.DateTimeFormat(resolvedLocale, options.formatOptions).format(normalizedDate);
}
