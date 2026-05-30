import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import FirstTimePortfolioPanel from "./FirstTimePortfolioPanel";

const defaultProps = {
  walletConnected: false,
  onConnectWallet: vi.fn(),
  onReviewVault: vi.fn(),
  onDeposit: vi.fn(),
};

describe("FirstTimePortfolioPanel", () => {
  it("renders all three step titles", () => {
    render(<FirstTimePortfolioPanel {...defaultProps} />);

    expect(screen.getByText("Connect Your Wallet")).toBeInTheDocument();
    expect(screen.getByText("Review Vault Details")).toBeInTheDocument();
    expect(screen.getByText("Make Your First Deposit")).toBeInTheDocument();
  });

  it("renders the panel heading", () => {
    render(<FirstTimePortfolioPanel {...defaultProps} />);

    expect(screen.getByText("Get Started with YieldVault")).toBeInTheDocument();
  });

  it("has role=region with accessible label", () => {
    render(<FirstTimePortfolioPanel {...defaultProps} />);

    expect(screen.getByRole("region", { name: "Getting started guide" })).toBeInTheDocument();
  });

  describe("when wallet is NOT connected", () => {
    it("marks step 1 as active (aria-current=step)", () => {
      render(<FirstTimePortfolioPanel {...defaultProps} walletConnected={false} />);

      const steps = screen.getAllByRole("listitem");
      expect(steps[0]).toHaveAttribute("aria-current", "step");
      expect(steps[1]).not.toHaveAttribute("aria-current");
      expect(steps[2]).not.toHaveAttribute("aria-current");
    });

    it("enables only the Connect Wallet button", () => {
      render(<FirstTimePortfolioPanel {...defaultProps} walletConnected={false} />);

      const connectBtn = screen.getByRole("button", { name: /connect wallet/i });
      const reviewBtn = screen.getByRole("button", { name: /view vault/i });
      const depositBtn = screen.getByRole("button", { name: /deposit now/i });

      expect(connectBtn).not.toBeDisabled();
      expect(reviewBtn).toBeDisabled();
      expect(depositBtn).toBeDisabled();
    });

    it("calls onConnectWallet when Connect Wallet is clicked", () => {
      const onConnectWallet = vi.fn();
      render(<FirstTimePortfolioPanel {...defaultProps} onConnectWallet={onConnectWallet} />);

      fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
      expect(onConnectWallet).toHaveBeenCalledTimes(1);
    });
  });

  describe("when wallet IS connected", () => {
    it("marks step 2 as active (aria-current=step)", () => {
      render(<FirstTimePortfolioPanel {...defaultProps} walletConnected={true} />);

      const steps = screen.getAllByRole("listitem");
      expect(steps[0]).not.toHaveAttribute("aria-current");
      expect(steps[1]).toHaveAttribute("aria-current", "step");
      expect(steps[2]).not.toHaveAttribute("aria-current");
    });

    it("shows 'Connected' label on step 1 and disables it", () => {
      render(<FirstTimePortfolioPanel {...defaultProps} walletConnected={true} />);

      const connectedBtn = screen.getByRole("button", { name: /connected/i });
      expect(connectedBtn).toBeDisabled();
    });

    it("enables only the View Vault button", () => {
      render(<FirstTimePortfolioPanel {...defaultProps} walletConnected={true} />);

      const reviewBtn = screen.getByRole("button", { name: /view vault/i });
      const depositBtn = screen.getByRole("button", { name: /deposit now/i });

      expect(reviewBtn).not.toBeDisabled();
      expect(depositBtn).toBeDisabled();
    });

    it("calls onReviewVault when View Vault is clicked", () => {
      const onReviewVault = vi.fn();
      render(<FirstTimePortfolioPanel {...defaultProps} walletConnected={true} onReviewVault={onReviewVault} />);

      fireEvent.click(screen.getByRole("button", { name: /view vault/i }));
      expect(onReviewVault).toHaveBeenCalledTimes(1);
    });
  });
});
