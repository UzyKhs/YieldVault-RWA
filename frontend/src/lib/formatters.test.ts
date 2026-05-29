import { describe, it, expect } from "vitest";
import {
  formatNumber,
  formatCurrency,
  formatCompactNumber,
  formatPercent,
  formatDate,
  resolveLocale,
  resolveCurrency,
} from "./formatters";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

describe("formatters", () => {
  describe("formatNumber", () => {
    it("formats numbers with default 2 decimal places", () => {
      expect(formatNumber(1234.567)).toBe("1,234.57");
      expect(formatNumber(1000)).toBe("1,000");
    });

    it("formats numbers with custom decimal places", () => {
      expect(formatNumber(1234.5678, 4)).toBe("1,234.5678");
      expect(formatNumber(1000, 0)).toBe("1,000");
    });
  });

  describe("formatCurrency", () => {
    it("formats as USD by default", () => {
      expect(formatCurrency(1234.56)).toBe("$1,234.56");
      expect(formatCurrency(1000)).toBe("$1,000.00");
    });

    it("formats with custom currency", () => {
      const formatted = formatCurrency(1234.56, "EUR");
      // Depending on node version/locale, this could be "€1,234.56" or similar.
      // We check that it contains the number and some symbol
      expect(formatted).toContain("1,234.56");
      expect(formatted).not.toContain("$");
    });

    it("formats currency using the requested locale and fixed decimals", () => {
      const formatted = normalizeWhitespace(
        formatCurrency(1234.5, {
          locale: "de-DE",
          currency: "EUR",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      );

      expect(formatted).toContain("1.234,50");
      expect(formatted).toContain("€");
    });
  });

  describe("formatCompactNumber", () => {
    it("formats thousands", () => {
      expect(formatCompactNumber(1200)).toBe("1.2K");
      expect(formatCompactNumber(1000)).toBe("1K");
    });

    it("formats millions", () => {
      expect(formatCompactNumber(1500000)).toBe("1.5M");
      expect(formatCompactNumber(2000000)).toBe("2M");
    });
  });

  describe("formatPercent", () => {
    it("formats normal numbers as percent", () => {
      expect(formatPercent(5)).toBe("5%");
      expect(formatPercent(5.555)).toBe("5.56%");
    });

    it("formats decimal values as percent when specified", () => {
      expect(formatPercent(0.05, true)).toBe("5.00%");
      expect(formatPercent(0.05555, true)).toBe("5.56%");
    });

    it("supports fixed fraction digits for table and chart consistency", () => {
      expect(
        formatPercent(8.4, {
          locale: "en-US",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      ).toBe("8.40%");
    });
  });

  describe("locale fallbacks", () => {
    it("falls back to the configured fallback locale when the preferred locale is invalid", () => {
      expect(resolveLocale("invalid-locale-tag", "fr-FR")).toBe("fr-FR");
    });

    it("falls back to USD when the requested currency code is invalid", () => {
      expect(resolveCurrency("INVALID", { locale: "en-US" })).toBe("USD");
    });
  });

  describe("formatDate", () => {
    it("formats dates with the requested locale", () => {
      const formatted = formatDate("2026-03-25T00:00:00.000Z", {
        locale: "de-DE",
        formatOptions: { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
      });

      expect(formatted).toContain("25.");
    });

    it("returns an empty string for invalid dates", () => {
      expect(formatDate("not-a-date", { month: "short", day: "numeric" }, "en-US")).toBe("");
    });
  });
});
