import React from "react";
import { Wallet, Layers, TrendingUp } from "./icons";
import "./OnboardingPanel.css";

interface OnboardingStep {
  step: number;
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  completed: boolean;
}

interface OnboardingPanelProps {
  walletConnected: boolean;
  onConnectWallet: () => void;
  onReviewVault: () => void;
  onDeposit: () => void;
}

const OnboardingPanel: React.FC<OnboardingPanelProps> = ({
  walletConnected,
  onConnectWallet,
  onReviewVault,
  onDeposit,
}) => {
  const steps: OnboardingStep[] = [
    {
      step: 1,
      icon: <Wallet size={24} />,
      title: "Connect Your Wallet",
      description: "Link your Freighter wallet to get started with YieldVault.",
      actionLabel: walletConnected ? "Connected ✓" : "Connect Wallet",
      onAction: onConnectWallet,
      completed: walletConnected,
    },
    {
      step: 2,
      icon: <Layers size={24} />,
      title: "Review Vault Details",
      description: "Explore APY, strategy, and TVL before committing funds.",
      actionLabel: "View Vault",
      onAction: onReviewVault,
      completed: false,
    },
    {
      step: 3,
      icon: <TrendingUp size={24} />,
      title: "Make Your First Deposit",
      description: "Deposit USDC to start earning yield backed by real-world assets.",
      actionLabel: "Deposit Now",
      onAction: onDeposit,
      completed: false,
    },
  ];

  const activeStep = walletConnected ? 1 : 0;

  return (
    <div className="onboarding-panel" role="region" aria-label="Getting started guide">
      <div className="onboarding-panel-header">
        <h2 className="onboarding-panel-title">Get Started with YieldVault</h2>
        <p className="onboarding-panel-subtitle">
          Follow these steps to start earning institutional-grade yield on your USDC.
        </p>
      </div>

      <ol className="onboarding-steps" aria-label="Onboarding steps">
        {steps.map((s, idx) => {
          const isActive = idx === activeStep;
          const isPast = s.completed;
          const isFuture = idx > activeStep && !s.completed;

          return (
            <li
              key={s.step}
              className={[
                "onboarding-step",
                isPast ? "onboarding-step--completed" : "",
                isActive ? "onboarding-step--active" : "",
                isFuture ? "onboarding-step--future" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={isActive ? "step" : undefined}
            >
              <div className="onboarding-step-indicator" aria-hidden="true">
                {isPast ? (
                  <span className="onboarding-step-check">✓</span>
                ) : (
                  <span className="onboarding-step-number">{s.step}</span>
                )}
              </div>

              <div className="onboarding-step-icon" aria-hidden="true">
                {s.icon}
              </div>

              <div className="onboarding-step-content">
                <h3 className="onboarding-step-title">{s.title}</h3>
                <p className="onboarding-step-description">{s.description}</p>
              </div>

              <button
                type="button"
                className={`btn ${isActive ? "btn-primary" : "btn-outline"} onboarding-step-action`}
                onClick={s.onAction}
                disabled={isPast || isFuture}
                aria-label={s.actionLabel}
              >
                {s.actionLabel}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default OnboardingPanel;
