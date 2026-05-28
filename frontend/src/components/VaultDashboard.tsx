import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Check,
  Loader2,
  Share2,
  ShieldCheck,
  TrendingUp,
  Wallet as WalletIcon,
} from "./icons";
import Skeleton, { DashboardCardSkeleton, SkeletonText, SkeletonCircle } from "./Skeleton";
import { useDelayedLoading } from "../hooks/useDelayedLoading";
import { useVault } from "../context/VaultContext";
import ApiStatusBanner from "./ApiStatusBanner";
import SharePriceDisplay from "./SharePriceDisplay";
import VaultPerformanceChart from "./VaultPerformanceChart";
import { useToast } from "../context/ToastContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";
import { FormField } from "../forms";
import { isValidationError } from "../lib/api";
import { useForm } from "../forms/useForm";
import type { ValidationSchema } from "../forms/validate";
import { useDepositMutation, useWithdrawMutation } from "../hooks/useVaultMutations";
import { useTokenAllowance } from "../hooks/useTokenAllowance";
import CopyButton from "./CopyButton";
import { copyTextToClipboard } from "../lib/clipboard";
import { useFeeEstimate } from "../hooks/useFeeEstimate";
import HelpIcon from "./ui/HelpIcon";
import EmptyState from "./ui/EmptyState";
import { TransactionConfirmationModal } from "./TransactionConfirmationModal";
import { useTranslation } from "../i18n";
import { networkConfig } from "../config/network";

/**
 * Valid transaction tabs in the vault dashboard.
 */
type TransactionTab = "deposit" | "withdraw";

/**
 * Current step in the transaction wizard flow.
 */
type TransactionStep = "amount" | "review" | "result";

/**
 * Visual indicator for the 3-step transaction wizard.
 * Shows progress through Amount, Review, and Result stages.
 */
const StepIndicator: React.FC<{ currentStep: TransactionStep }> = ({ currentStep }) => {
  const steps: Array<{ id: TransactionStep; label: string }> = [
    { id: "amount", label: "Amount" },
    { id: "review", label: "Review" },
    { id: "result", label: "Result" },
  ];
  const stepOrder: TransactionStep[] = ["amount", "review", "result"];
  const currentIndex = stepOrder.indexOf(currentStep);

  return (
    <div className="step-indicator-container">
      {steps.map((step, index) => {
        const status =
          index < currentIndex
            ? "completed"
            : index === currentIndex
              ? "active"
              : "pending";

        return (
          <React.Fragment key={step.id}>
            <div className={`step-item ${status}`}>
              <div className="step-number">
                {status === "completed" ? <Check size={12} /> : index + 1}
              </div>
              <span className="step-label">{step.label}</span>
            </div>
            {index < steps.length - 1 && (
              <div className={`step-line ${status === "completed" ? "completed" : ""}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

interface VaultDashboardProps {
  walletAddress: string | null;
  usdcBalance?: number;
}

const MIN_DEPOSIT_AMOUNT = 1;

const VaultCapWarning: React.FC<{ utilization: number; isReached: boolean }> = ({
  utilization,
  isReached,
}) => {
  const percent = (utilization * 100).toFixed(1);

  return (
    <div
      className="glass-panel"
      style={{
        padding: "16px",
        marginBottom: "24px",
        border: `1px solid ${isReached ? "var(--text-error)" : "var(--text-warning)"}`,
        background: isReached ? "rgba(255, 69, 58, 0.1)" : "rgba(255, 159, 10, 0.1)",
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
      }}
    >
      {isReached ? (
        <AlertCircle color="var(--text-error)" size={20} />
      ) : (
        <AlertCircle color="var(--text-warning)" size={20} />
      )}
      <div>
        <div
          style={{
            fontWeight: 600,
            color: isReached ? "var(--text-error)" : "var(--text-warning)",
            marginBottom: "4px",
          }}
        >
          {isReached ? "Vault Capacity Reached" : "Vault Near Capacity"}
        </div>
        <div
          style={{
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            lineHeight: "1.4",
          }}
        >
          {isReached
            ? `This vault has reached its maximum deposit cap of ${percent}%. Deposits are temporarily disabled.`
            : `This vault is at ${percent}% capacity. New deposits may be restricted soon.`}
        </div>
      </div>
    </div>
  );
};



const VaultDashboard: React.FC<VaultDashboardProps> = ({
  walletAddress,
  usdcBalance = 0,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    formattedTvl,
    formattedApy,
    summary,
    error,
    isLoading,
    utilization,
    isCapWarning,
    isCapReached,
  } = useVault();
  const toast = useToast();
  const delayedLoading = useDelayedLoading(isLoading);

  const [activeTab, setActiveTab] = useState<TransactionTab>("deposit");
  const availableBalance = walletAddress ? usdcBalance : 0;

  const transactionSchema = React.useMemo<ValidationSchema<{ amount: string }>>(() => ({
    amount: {
      required: "Amount is required.",
      custom: (value) => {
        const num = Number(value);
        if (isNaN(num) || !isFinite(num)) return "Enter a valid number.";
        if (num <= 0) return "Amount must be greater than 0.";

        if (activeTab === "deposit") {
          if (num < MIN_DEPOSIT_AMOUNT) {
            return `Minimum deposit is ${MIN_DEPOSIT_AMOUNT.toFixed(2)} USDC.`;
          }
          if (isCapReached) {
            return "Deposits are temporarily disabled because the vault is at capacity.";
          }
          if (num > availableBalance) {
            return "Deposit amount cannot exceed your available USDC balance.";
          }
        } else {
          if (num > availableBalance) {
            return "The withdrawal amount exceeds your available USDC balance.";
          }
        }
        return undefined;
      }
    }
  }), [activeTab, availableBalance, isCapReached]);

  const {
    values,
    errors,
    touched,
    handleChange,
    handleBlur,
    setValues,
    setFieldError
  } = useForm({ amount: "" }, transactionSchema);

  const amount = values.amount;

  // Wizard state
  const [currentStep, setCurrentStep] = useState<TransactionStep>("amount");
  const [transactionResult, setTransactionResult] = useState<{
    success: boolean;
    message: string;
    txHash?: string
  } | null>(null);

  const { isOffline, countdown } = useOfflineRetryCountdown();

  // Handle deep link parameters
  useEffect(() => {
    const action = searchParams.get("action");
    const amountParam = searchParams.get("amount");

    if (action !== "deposit") {
      return;
    }

    setActiveTab("deposit");

    const parsedAmount = amountParam === null ? Number.NaN : Number(amountParam);
    if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
      setValues({ amount: parsedAmount.toString() });
    } else {
      setValues({ amount: "" });
    }

    // Remove only deep-link query params while preserving any unrelated URL state.
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("action");
    nextParams.delete("amount");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const depositMutation = useDepositMutation();
  const withdrawMutation = useWithdrawMutation();
  const { approvalStatus, needsApproval, approve, resetApproval } =
    useTokenAllowance(walletAddress);

  // Reset approval when deposit amount changes
  useEffect(() => {
    resetApproval();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  const { feeXlm, isEstimating, isHighFee } = useFeeEstimate(
    walletAddress,
    amount,
    activeTab
  );

  const resetWizard = () => {
    setValues({ amount: "" });
    setCurrentStep("amount");
    setTransactionResult(null);
  };

  const goToReview = () => {
    if (errors.amount || !amount) {
      setFieldError("amount", errors.amount || "Amount is required.");
      toast.warning({
        title: "Enter a valid amount",
        description: errors.amount || "Amount is required.",
      });
      return;
    }

    setCurrentStep("review");
  };

  useEffect(() => {
    const handleDeposit = () => {
      setActiveTab("deposit");
      setTimeout(() => {
        const input = document.querySelector(".input-field") as HTMLInputElement | null;
        if (input) input.focus();
      }, 0);
    };
    const handleWithdraw = () => {
      setActiveTab("withdraw");
      setTimeout(() => {
        const input = document.querySelector(".input-field") as HTMLInputElement | null;
        if (input) input.focus();
      }, 0);
    };
    window.addEventListener("TRIGGER_DEPOSIT", handleDeposit);
    window.addEventListener("TRIGGER_WITHDRAW", handleWithdraw);
    return () => {
      window.removeEventListener("TRIGGER_DEPOSIT", handleDeposit);
      window.removeEventListener("TRIGGER_WITHDRAW", handleWithdraw);
    };
  }, []);

  const isProcessing = depositMutation.isPending
    ? "deposit"
    : withdrawMutation.isPending
      ? "withdraw"
      : null;
  const isBusy = isProcessing !== null;

  const strategy = summary.strategy;
  const enteredAmount = Number(amount);
  const activeAmountError = errors.amount;
  const isValidAmount = !activeAmountError && amount.length > 0;
  const showInlineError = touched.amount && Boolean(activeAmountError);
  const managementFeeBps = 35;
  const estimatedFee = isValidAmount
    ? (enteredAmount * managementFeeBps) / 10_000
    : 0;
  const estimatedNetAmount = isValidAmount
    ? Math.max(enteredAmount - estimatedFee, 0)
    : 0;
  const isSubmitDisabled =
    !walletAddress ||
    isBusy ||
    Boolean(activeAmountError) ||
    !amount ||
    (activeTab === "deposit" && isCapReached);


  const handleTransaction = async (actionType: TransactionTab) => {
    const value = Number(amount);
    
    if (!walletAddress) {
      toast.warning({
        title: "Wallet required",
        description: "Connect your wallet before submitting a transaction.",
      });
      return;
    }

    try {
      if (actionType === "deposit") {
        await depositMutation.mutateAsync({ walletAddress, amount: value });
        
        try {
          const depositKey = `has_deposited_${walletAddress}`;
          const alreadyDeposited = localStorage.getItem(depositKey);
          const isTest = typeof process !== "undefined" && process.env?.NODE_ENV === "test";
          if (!alreadyDeposited && !isTest) {
            confetti({
              particleCount: 150,
              spread: 80,
              origin: { y: 0.6 },
              colors: ["#00f0ff", "#a855f7", "#ffffff", "#3b82f6"]
            });
            localStorage.setItem(depositKey, "true");
          }
        } catch (storageErr) {
          console.warn("Storage access failed, triggering confetti anyway", storageErr);
          const isTest = typeof process !== "undefined" && process.env?.NODE_ENV === "test";
          if (!isTest) {
            confetti({
              particleCount: 150,
              spread: 80,
              origin: { y: 0.6 },
              colors: ["#00f0ff", "#a855f7", "#ffffff", "#3b82f6"]
            });
          }
        }
      } else {
        await withdrawMutation.mutateAsync({ walletAddress, amount: value });
      }

      setTransactionResult({
        success: true,
        message: actionType === "deposit"
          ? `${value.toFixed(2)} USDC has been deposited into the vault.`
          : `${value.toFixed(2)} USDC has been withdrawn from the vault.`,
      });
      setCurrentStep("result");
      
      toast.success({
        title: actionType === "deposit" ? "Deposit Successful" : "Withdrawal Successful",
        description:
          actionType === "deposit"
            ? `${value.toFixed(2)} USDC has been deposited into the vault.`
            : `${value.toFixed(2)} USDC has been withdrawn from the vault.`,
      });
    } catch (err: unknown) {
      if (isValidationError(err)) {
        err.details.forEach((detail) => {
          if (detail.field === "amount") {
            setFieldError("amount", detail.message);
          }
        });
        setCurrentStep("amount");
      }

      setTransactionResult({
        success: false,
        message:
          err instanceof Error
            ? err.message
            : "An error occurred during the transaction.",
      });
      setCurrentStep("result");
      
      toast.error({
        title: "Transaction Failed",
        description:
          err instanceof Error
            ? err.message
            : "An error occurred during the transaction.",
      });
    }
  };

  return (
    <div className="vault-dashboard gap-lg">
      <div className="vault-dashboard-stats" aria-busy={delayedLoading}>
        <div className="glass-panel vault-stats-panel">
          {error && (
            <ApiStatusBanner error={{ ...error, userMessage: "Failed to load vault data" }} />
          )}
          <div className="vault-stats-header flex justify-between items-center" style={{ marginBottom: "24px" }}>
            <div>
              <h2 style={{ fontSize: "1.5rem", marginBottom: "4px" }}>
                {delayedLoading ? <SkeletonText width="240px" lineHeight="1.5rem" /> : "Global RWA Yield Fund"}
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {delayedLoading ? (
                  <SkeletonText width="100px" lineHeight="1.5rem" />
                ) : (
                  <>
                    <span
                      className="tag"
                      style={{
                        background: "rgba(255, 255, 255, 0.05)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      Tokens: USDC
                    </span>
                    <SharePriceDisplay />
                  </>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}>
                Current APY
                <HelpIcon
                  variant="tooltip"
                  content="Annualized yield based on the historical performance of the vault's underlying assets."
                />
              </div>
              <div className="text-gradient" style={{ fontSize: "2rem", fontFamily: "var(--font-display)", fontWeight: 700 }}>
                {delayedLoading ? <Skeleton width="100px" height="2.5rem" /> : formattedApy}
              </div>
            </div>
          </div>

          <div
            style={{
              height: "1px",
              background: "var(--border-glass)",
              margin: "24px 0",
            }}
          />

          <div className="vault-stats-meta flex gap-xl" style={{ marginBottom: "32px" }}>
            <div>
              <div
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "0.85rem",
                  marginBottom: "4px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                Total Value Locked
                <span
                  className="flex items-center gap-xs"
                  style={{
                    color: isOffline ? "rgba(255, 159, 10, 0.9)" : "var(--accent-cyan)",
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {!isOffline && <Activity size={10} className={isLoading ? "animate-pulse" : undefined} />}
                  {isOffline ? `Retrying in ${countdown}s...` : isLoading ? "Syncing" : "Live"}
                </span>
              </div>
              <div style={{ fontSize: "1.25rem", fontFamily: "var(--font-display)", fontWeight: 600 }}>
                {delayedLoading ? <Skeleton width="140px" height="1.5rem" /> : formattedTvl}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "4px" }}>
                Underlying Asset
              </div>
              <div className="flex items-center gap-sm">
                {delayedLoading ? (
                  <>
                    <SkeletonCircle width={16} height={16} />
                    <SkeletonText width="100px" lineHeight="1.1rem" />
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} color="var(--accent-cyan)" />
                    <span style={{ fontSize: "1.1rem", fontWeight: 500 }}>{summary.assetLabel}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: "20px", background: "var(--bg-muted)" }}>
            {delayedLoading ? (
              <DashboardCardSkeleton />
            ) : (
              <>
                <h3
                  style={{
                fontSize: "1.1rem",
                marginBottom: "12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <TrendingUp size={18} color="var(--accent-purple)" />
              Strategy Overview
            </h3>
            <div
              style={{
                marginBottom: "12px",
                color: "var(--text-secondary)",
                fontSize: "0.8rem",
                fontWeight: 600,
              }}
            >
              BENJI Strategy
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: "1.6" }}>
              This vault pools USDC and deploys it into verified tokenized sovereign bonds available on
              the Stellar network.
            </p>
            <div className="flex gap-md" style={{ marginTop: "14px", flexWrap: "wrap" }}>
              <div
                style={{
                  flex: "1 1 150px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid var(--border-glass)",
                }}
              >
                <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: "4px" }}>
                  Target Allocation
                </div>
                <div style={{ fontWeight: 600 }}>70% Treasuries</div>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>30% Cash Reserve</div>
              </div>
              <div
                style={{
                  flex: "1 1 150px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid var(--border-glass)",
                }}
              >
                <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: "4px" }}>
                  Yield Distribution
                </div>
                <div style={{ fontWeight: 600 }}>Daily Compounding</div>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                  Reflected in yvUSDC NAV
                </div>
              </div>
              <div
                style={{
                  flex: "1 1 150px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid var(--border-glass)",
                }}
              >
                <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: "4px" }}>
                  Risk Controls
                </div>
                <div style={{ fontWeight: 600 }}>Issuer + Duration Caps</div>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                  Rebalanced every epoch
                </div>
              </div>
            </div>
            <div style={{ marginTop: "12px", color: "var(--text-secondary)", fontSize: "0.82rem" }}>
              Strategy: <span style={{ color: "var(--text-primary)" }}>{strategy.name}</span> ({strategy.issuer})
            </div>
            <div
              className="copy-field"
              style={{ marginTop: "8px", color: "var(--text-secondary)", fontSize: "0.78rem" }}
            >
              <span>Strategy ID:</span>
              <span className="copy-field-value copy-field-value-mono">{strategy.id}</span>
              <CopyButton value={strategy.id} label="strategy ID" />
            </div>
          </>
            )}
          </div>

          {/* Empty state: wallet connected, loading done, no USDC balance */}
          {!isLoading && walletAddress && usdcBalance === 0 && (
            <EmptyState
              title="No deposits yet."
              description="Start earning yield by depositing USDC into our high-efficiency vaults."
              icon={<TrendingUp />}
              actionLabel="Deposit Now"
              onAction={() => {
                window.dispatchEvent(new Event("TRIGGER_DEPOSIT"));
              }}
            />
          )}
        </div>
      </div>

      <div className="vault-dashboard-chart">
        <div className="glass-panel vault-chart-panel">
          <VaultPerformanceChart />
        </div>
      </div>

      <div className="vault-dashboard-actions">
        <div
          className="glass-panel vault-actions-panel"
          style={{ position: "relative", overflow: "hidden" }}
        >
          <div
            style={{
              position: "absolute",
              top: "-50px",
              right: "-50px",
              width: "150px",
              height: "150px",
              background: "var(--accent-purple)",
              filter: "blur(80px)",
              opacity: 0.2,
              borderRadius: "50%",
              pointerEvents: "none",
            }}
          />

          {!walletAddress && (
            <div
              className="wallet-overlay"
              style={{
                position: "absolute",
                inset: 0,
                background: "var(--bg-overlay)",
                backdropFilter: "blur(8px)",
                zIndex: 10,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "32px",
                textAlign: "center",
              }}
            >
              <WalletIcon size={48} color="var(--accent-cyan)" style={{ marginBottom: "16px", opacity: 0.8 }} />
              <h3>Wallet Not Connected</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                Please connect your Freighter wallet to interact with the vault.
              </p>
            </div>
          )}

          <Tabs
            value={activeTab}
            defaultValue="deposit"
            onValueChange={(value) => {
              setActiveTab(value as TransactionTab);
              setValues({ amount: "" });
            }}
          >
            {currentStep === "amount" && (
              <TabsList style={{ marginBottom: "24px" }}>
                <TabsTrigger value="deposit">Deposit</TabsTrigger>
                <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
              </TabsList>
            )}

            <StepIndicator currentStep={currentStep} />

            {(["deposit", "withdraw"] as const).map((tab) => (
              <TabsContent key={tab} value={tab}>
                {(isCapReached || isCapWarning) && tab === "deposit" && (
                  <VaultCapWarning utilization={utilization} isReached={isCapReached} />
                )}

                  <div style={{ minHeight: "380px", display: "flex", flexDirection: "column" }}>
                    {currentStep === "amount" && (
                      <div className="animate-in fade-in duration-300">
                        <div style={{ marginBottom: "24px" }}>
                          <div className="flex justify-between items-center" style={{ marginBottom: "16px" }}>
                            <div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                              {tab === "deposit" ? "Amount to deposit" : "Amount to withdraw"}
                            </div>
                            <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                              Balance: <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{availableBalance.toFixed(2)}</span>
                            </div>
                          </div>

                          <FormField
                            label={tab === "deposit" ? "Deposit amount" : "Withdrawal amount"}
                            name="amount"
                            type="number"
                            step="any"
                            placeholder="0.00"
                            value={amount}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            disabled={isBusy || (tab === "deposit" && isCapReached)}
                            error={showInlineError ? activeAmountError ?? undefined : undefined}
                            helperText={tab === "deposit" ? `Min: ${MIN_DEPOSIT_AMOUNT.toFixed(2)} USDC` : `Max: ${availableBalance.toFixed(2)} USDC`}
                          />

                          <div className="flex justify-between items-center" style={{ margin: "16px 0 24px" }}>
                            <div className="flex items-center gap-sm">
                              <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Asset: USDC</span>
                              {tab === "deposit" && (
                                <>
                                  <div style={{ width: "1px", height: "14px", background: "var(--border-glass)", margin: "0 4px" }} />
                                  <button
                                    type="button"
                                    className="btn-link flex items-center gap-xs"
                                    style={{ fontSize: "0.75rem", color: "var(--accent-cyan)", padding: 0 }}
                                    onClick={async () => {
                                      const baseUrl = window.location.origin + window.location.pathname;
                                      const shareUrl = amount && !isNaN(Number(amount)) && Number(amount) > 0
                                        ? `${baseUrl}?action=deposit&amount=${amount}`
                                        : baseUrl;
                                      
                                      try {
                                        await copyTextToClipboard(shareUrl);
                                        toast.success({
                                          title: "Link copied",
                                          description: "Shareable vault link is ready to paste."
                                        });
                                      } catch {
                                        toast.error({
                                          title: "Copy failed",
                                          description: "Could not copy link to clipboard."
                                        });
                                      }
                                    }}
                                  >
                                    <Share2 size={12} />
                                    Share Link
                                  </button>
                                </>
                              )}
                            </div>
                            <button
                              type="button"
                              className="btn-max"
                              onClick={() => {
                                setValues({ amount: availableBalance.toFixed(2) });
                              }}
                              disabled={
                                !walletAddress ||
                                availableBalance <= 0 ||
                                isBusy ||
                                (tab === "deposit" && isCapReached)
                              }
                            >
                              MAX
                            </button>
                          </div>
                        </div>

                        <div
                          className="glass-panel"
                          style={{
                            padding: "14px 16px",
                            background: "rgba(0, 0, 0, 0.15)",
                            marginBottom: "24px",
                          }}
                        >
                          <div className="flex justify-between items-center" style={{ marginBottom: "6px" }}>
                            <span style={{ color: "var(--text-secondary)", fontSize: "0.86rem", display: "flex", alignItems: "center", gap: "6px" }}>
                              Estimated protocol fee
                              <HelpIcon
                                variant="popover"
                                content="A protocol fee of 35 basis points (0.35%) of the transaction amount is applied. This fee is deducted before settlement."
                              />
                            </span>
                            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                              {isValidAmount ? `${estimatedFee.toFixed(4)} USDC` : "0.0000 USDC"}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>
                              {tab === "deposit" ? "Estimated net deposit" : "Estimated net withdrawal"}
                            </span>
                            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                              {isValidAmount ? `${estimatedNetAmount.toFixed(4)} USDC` : "0.0000 USDC"}
                            </span>
                          </div>
                        </div>

                        <button
                          className="btn btn-primary"
                          style={{ width: "100%", padding: "16px" }}
                          type="button"
                          onClick={goToReview}
                          disabled={isSubmitDisabled}
                        >
                          Review Transaction
                        </button>
                      </div>
                    )}

                    {currentStep === "review" && (
                      <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex-1 flex flex-col">
                        <div className="flex-1">
                          <h4 style={{ marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
                            <AlertCircle size={20} color="var(--accent-cyan)" />
                            Confirm Transaction
                          </h4>
                          
                          <div 
                            className="glass-panel" 
                            style={{ 
                              padding: "20px", 
                              background: "rgba(255, 255, 255, 0.02)",
                              border: "1px solid var(--border-glass)",
                              marginBottom: "20px"
                            }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                              <div className="flex justify-between">
                                <span style={{ color: "var(--text-secondary)" }}>Action</span>
                                <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{tab}</span>
                              </div>
                              <div className="flex justify-between">
                                <span style={{ color: "var(--text-secondary)" }}>Amount</span>
                                <span style={{ fontWeight: 600 }}>{enteredAmount.toFixed(2)} USDC</span>
                              </div>
                              <div style={{ height: "1px", background: "var(--border-glass)" }} />
                              <div className="flex justify-between">
                                <span style={{ color: "var(--text-secondary)" }}>Protocol Fee (0.35%)</span>
                                <span style={{ fontWeight: 600 }}>{estimatedFee.toFixed(4)} USDC</span>
                              </div>
                              <div className="flex justify-between">
                                <span style={{ color: "var(--text-secondary)" }}>Network Fee</span>
                                <span style={{ fontWeight: 600, textAlign: "right" }}>
                                  {isEstimating ? <Skeleton width="60px" height="1.1rem" /> : `${feeXlm.toFixed(4)} XLM`}
                                </span>
                              </div>
                              <div style={{ height: "1px", background: "var(--border-glass)" }} />
                              <div className="flex justify-between items-center">
                                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>Total To {tab === "deposit" ? "Vault" : "Wallet"}</span>
                                <span style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--accent-cyan)" }}>
                                  {estimatedNetAmount.toFixed(4)} USDC
                                </span>
                              </div>
                            </div>
                          </div>

                          {isHighFee && (
                            <div
                              className="flex items-start gap-sm"
                              style={{
                                marginBottom: "20px",
                                padding: "12px",
                                borderRadius: "8px",
                                background: "rgba(255, 69, 58, 0.1)",
                                border: "1px solid rgba(255, 69, 58, 0.2)",
                              }}
                            >
                              <AlertTriangle size={16} color="var(--text-error)" style={{ marginTop: "2px" }} />
                              <div style={{ fontSize: "0.82rem", color: "var(--text-error)", lineHeight: "1.4" }}>
                                <strong style={{ display: "block", marginBottom: "2px" }}>High network fee</strong>
                                The estimated network fee exceeds 1% of your transaction value.
                              </div>
                            </div>
                          )}

                          {tab === "deposit" && isValidAmount && needsApproval(enteredAmount) && (
                            <div
                              className="glass-panel"
                              style={{
                                padding: "14px 16px",
                                marginBottom: "20px",
                                border: approvalStatus === "confirmed"
                                  ? "1px solid rgba(0, 240, 255, 0.4)"
                                  : "1px solid rgba(255, 159, 10, 0.4)",
                                background: approvalStatus === "confirmed"
                                  ? "rgba(0, 240, 255, 0.05)"
                                  : "rgba(255, 159, 10, 0.05)",
                              }}
                            >
                              <div className="flex items-center gap-sm" style={{ marginBottom: "10px" }}>
                                <div
                                  className="flex items-center gap-xs"
                                  style={{
                                    fontSize: "0.78rem",
                                    fontWeight: 600,
                                    color: approvalStatus === "confirmed" ? "var(--accent-cyan)" : "rgba(255, 159, 10, 0.9)",
                                  }}
                                >
                                  <div style={{
                                    width: "20px", height: "20px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                                    background: approvalStatus === "confirmed" ? "var(--accent-cyan)" : "rgba(255, 159, 10, 0.2)",
                                    border: approvalStatus === "confirmed" ? "none" : "1px solid rgba(255, 159, 10, 0.6)",
                                    fontSize: "0.7rem", color: approvalStatus === "confirmed" ? "#000" : "inherit"
                                  }}>
                                    {approvalStatus === "confirmed" ? <Check size={12} /> : "1"}
                                  </div>
                                  Approve USDC
                                </div>
                                <div style={{ flex: 1, height: "1px", background: "var(--border-glass)" }} />
                                <div className="flex items-center gap-xs" style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                                  <div style={{ width: "20px", height: "20px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-glass)", fontSize: "0.7rem" }}>2</div>
                                  Deposit
                                </div>
                              </div>
                              {approvalStatus !== "confirmed" && (
                                <button
                                  type="button"
                                  className="btn btn-outline"
                                  style={{ width: "100%", padding: "10px" }}
                                  disabled={approvalStatus === "pending"}
                                  onClick={async () => {
                                    try {
                                      await approve(enteredAmount);
                                      toast.success({ title: "USDC Approved" });
                                    } catch {
                                      toast.error({ title: "Approval Failed" });
                                    }
                                  }}
                                >
                                  {approvalStatus === "pending" ? "Approving..." : "Approve USDC"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex gap-md" style={{ marginTop: "auto" }}>
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ flex: 1 }}
                            onClick={() => setCurrentStep("amount")}
                            disabled={isBusy}
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ flex: 2 }}
                            onClick={() => void handleTransaction(tab)}
                            disabled={
                              isBusy || 
                              (tab === "deposit" && needsApproval(enteredAmount) && approvalStatus !== "confirmed")
                            }
                          >
                            {isBusy ? (
                              <>
                                <Loader2 size={16} className="spin" style={{ animation: "spin 0.9s linear infinite" }} />
                                Processing...
                              </>
                            ) : (
                              `Confirm ${tab}`
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {currentStep === "result" && transactionResult && (
                      <div className="result-view flex-1 flex flex-col justify-center">
                        <div className={`result-icon-container ${transactionResult.success ? "success" : "error"} animate-scale-in`}>
                          {transactionResult.success ? <Check size={32} /> : <AlertTriangle size={32} />}
                        </div>
                        <h3 style={{ marginBottom: "12px" }}>
                          {transactionResult.success ? "Transaction Successful" : "Transaction Failed"}
                        </h3>
                        <p style={{ color: "var(--text-secondary)", marginBottom: "32px", maxWidth: "300px" }}>
                          {transactionResult.message}
                        </p>
                        
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ width: "100%", padding: "16px" }}
                          onClick={resetWizard}
                        >
                          {transactionResult.success ? "Done" : "Try Again"}
                        </button>
                      </div>
                    )}
                  </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default VaultDashboard;
