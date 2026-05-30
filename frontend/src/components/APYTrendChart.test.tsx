import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import APYTrendChart from "../components/APYTrendChart";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../context/PreferencesContext", () => ({
  usePreferencesContext: () => ({
    preferences: { locale: "en-US", currency: "USD" },
  }),
}));

// recharts ResizeObserver shim (jsdom doesn't implement it)
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal 10-point dataset spanning 10 days ending today */
function makeData(days = 10) {
  const MS_PER_DAY = 86_400_000;
  const now = Date.now();
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(now - (days - 1 - i) * MS_PER_DAY).toISOString().slice(0, 10),
    apy: 5 + i * 0.05,
  }));
}

const TEST_DATA = makeData(10);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("APYTrendChart", () => {
  beforeEach(() => {
    // Ensure test environment flag is set
    vi.stubEnv("NODE_ENV", "test");
  });

  it("renders the section heading", () => {
    render(<APYTrendChart data={TEST_DATA} />);
    expect(screen.getByRole("heading", { name: /apy trend/i })).toBeInTheDocument();
  });

  it("renders the primary range selector with all options", () => {
    render(<APYTrendChart data={TEST_DATA} />);
    const group = screen.getByRole("group", { name: /select primary time window/i });
    expect(group).toBeInTheDocument();
    for (const label of ["7D", "1M", "3M", "ALL"]) {
      // scope within the primary group to avoid ambiguity with comparison toggles
      const btn = Array.from(group.querySelectorAll("button")).find(
        (b) => b.textContent === label,
      );
      expect(btn).toBeTruthy();
    }
  });

  it("defaults to 1M as the active primary range", () => {
    render(<APYTrendChart data={TEST_DATA} />);
    const group = screen.getByRole("group", { name: /select primary time window/i });
    const btn = Array.from(group.querySelectorAll("button")).find(
      (b) => b.textContent === "1M",
    );
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("switches primary range when a range button is clicked", () => {
    render(<APYTrendChart data={TEST_DATA} />);
    const group = screen.getByRole("group", { name: /select primary time window/i });
    const btn7D = Array.from(group.querySelectorAll("button")).find(
      (b) => b.textContent === "7D",
    ) as HTMLElement;
    const btn1M = Array.from(group.querySelectorAll("button")).find(
      (b) => b.textContent === "1M",
    ) as HTMLElement;
    fireEvent.click(btn7D);
    expect(btn7D).toHaveAttribute("aria-pressed", "true");
    expect(btn1M).toHaveAttribute("aria-pressed", "false");
  });

  it("renders the comparison toggles group", () => {
    render(<APYTrendChart data={TEST_DATA} />);
    expect(
      screen.getByRole("group", { name: /toggle comparison windows/i }),
    ).toBeInTheDocument();
  });

  it("toggles a comparison window on and off", () => {
    render(<APYTrendChart data={TEST_DATA} />);
    const compGroup = screen.getByRole("group", { name: /toggle comparison windows/i });
    const toggleBtns = Array.from(compGroup.querySelectorAll("button"));
    expect(toggleBtns.length).toBeGreaterThan(0);

    const firstToggle = toggleBtns[0];
    const wasPressed = firstToggle.getAttribute("aria-pressed") === "true";
    fireEvent.click(firstToggle);
    expect(firstToggle).toHaveAttribute("aria-pressed", String(!wasPressed));
  });

  it("renders a chart element", () => {
    render(<APYTrendChart data={TEST_DATA} />);
    // In test env the LineChart renders directly (no ResponsiveContainer wrapper)
    // recharts renders an svg
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders with empty data without crashing", () => {
    render(<APYTrendChart data={[]} />);
    expect(screen.getByRole("heading", { name: /apy trend/i })).toBeInTheDocument();
  });

  it("renders the subtitle description", () => {
    render(<APYTrendChart data={TEST_DATA} />);
    expect(
      screen.getByText(/comparative apy across selectable time windows/i),
    ).toBeInTheDocument();
  });
});
