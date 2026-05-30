import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import OnboardingPanel from "./OnboardingPanel";

function renderPanel(walletConnected = false, overrides = {}) {
  const props = {
    walletConnected,
    onConnectWallet: vi.fn(),
    onReviewVault: vi.fn(),
    onDeposit: vi.fn(),
    ...overrides,
  };
  render(<OnboardingPanel {...props} />);
  return props;
}

describe("OnboardingPanel", () => {
  it("renders all three step titles", () => {
    renderPanel();
    expect(screen.getByText("Connect Your Wallet")).toBeInTheDocument();
    expect(screen.getByText("Review Vault Details")).toBeInTheDocument();
    expect(screen.getByText("Make Your First Deposit")).toBeInTheDocument();
  });

  it("has accessible region label", () => {
    renderPanel();
    expect(screen.getByRole("region", { name: "Getting started guide" })).toBeInTheDocument();
  });

  it("marks step 1 as active (aria-current=step) when wallet is not connected", () => {
    renderPanel(false);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("aria-current", "step");
    expect(items[1]).not.toHaveAttribute("aria-current");
    expect(items[2]).not.toHaveAttribute("aria-current");
  });

  it("marks step 2 as active when wallet is connected", () => {
    renderPanel(true);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[1]).toHaveAttribute("aria-current", "step");
  });

  it("shows 'Connect Wallet' button label when wallet is not connected", () => {
    renderPanel(false);
    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeInTheDocument();
  });

  it("shows 'Connected ✓' and disables step 1 button when wallet is connected", () => {
    renderPanel(true);
    const btn = screen.getByRole("button", { name: "Connected ✓" });
    expect(btn).toBeDisabled();
  });

  it("calls onConnectWallet when Connect Wallet button is clicked", () => {
    const { onConnectWallet } = renderPanel(false);
    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    expect(onConnectWallet).toHaveBeenCalledTimes(1);
  });

  it("calls onReviewVault when View Vault button is clicked (wallet connected)", () => {
    const { onReviewVault } = renderPanel(true);
    fireEvent.click(screen.getByRole("button", { name: "View Vault" }));
    expect(onReviewVault).toHaveBeenCalledTimes(1);
  });

  it("disables future steps when wallet is not connected", () => {
    renderPanel(false);
    expect(screen.getByRole("button", { name: "View Vault" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deposit Now" })).toBeDisabled();
  });

  it("step 1 has completed class when wallet is connected", () => {
    renderPanel(true);
    const items = screen.getAllByRole("listitem");
    expect(items[0].className).toContain("onboarding-step--completed");
  });

  it("step 2 has active class when wallet is connected", () => {
    renderPanel(true);
    const items = screen.getAllByRole("listitem");
    expect(items[1].className).toContain("onboarding-step--active");
  });

  it("step 3 has future class when wallet is connected", () => {
    renderPanel(true);
    const items = screen.getAllByRole("listitem");
    expect(items[2].className).toContain("onboarding-step--future");
  });
});
