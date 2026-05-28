import React from "react";
import { Modal } from "./Modal";
import { AlertTriangle, ShieldAlert, Check, Loader2 } from "./icons";
import { useTranslation } from "../i18n";

interface TransactionConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isProcessing: boolean;
  details: {
    type: "deposit" | "withdraw";
    amount: number;
    asset: string;
    network: string;
    feeXlm: number;
    protocolFeeUsdc: number;
    strategyName: string;
    isHighFee?: boolean;
  };
}

export const TransactionConfirmationModal: React.FC<TransactionConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isProcessing,
  details,
}) => {
  const { t } = useTranslation();

  const isLargeAmount = details.amount >= 10000;
  const hasRisk = isLargeAmount || details.isHighFee;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={details.type === "deposit" ? "Confirm Deposit" : "Confirm Withdrawal"}
      size="md"
    >
      <div style={{ padding: "12px 0" }}>
        {/* Risk Summary if applicable */}
        {hasRisk && (
          <div
            style={{
              background: "rgba(255, 159, 10, 0.1)",
              border: "1px solid var(--text-warning)",
              borderRadius: "8px",
              padding: "12px",
              marginBottom: "20px",
              display: "flex",
              gap: "12px",
            }}
          >
            <ShieldAlert color="var(--text-warning)" size={24} />
            <div>
              <div style={{ fontWeight: 600, color: "var(--text-warning)", marginBottom: "4px" }}>
                Security Review Required
              </div>
              <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                {isLargeAmount && (
                  <li>Large transaction amount detected ($10k+).</li>
                )}
                {details.isHighFee && (
                  <li>Network fees are unusually high relative to the amount.</li>
                )}
              </ul>
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="flex justify-between items-center">
            <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Amount</span>
            <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)" }}>
              {details.amount.toFixed(2)} {details.asset}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Network</span>
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{details.network}</span>
          </div>

          <div className="flex justify-between items-center">
            <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Estimated Fees</span>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                {details.feeXlm.toFixed(6)} XLM (Network)
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                {details.protocolFeeUsdc.toFixed(4)} USDC (Protocol)
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Target Strategy</span>
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{details.strategyName}</span>
          </div>
        </div>

        <div
          style={{
            height: "1px",
            background: "var(--border-glass)",
            margin: "24px 0",
          }}
        />

        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.5", marginBottom: "24px" }}>
          By confirming, you authorize a signature request in your wallet. 
          {details.type === "withdraw" ? " Your shares will be burned and funds will be sent to your wallet." : " Your USDC will be deposited into the fund strategy."}
        </p>

        <div className="flex gap-md">
          <button
            className="btn btn-outline"
            style={{ flex: 1 }}
            onClick={onClose}
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
            onClick={onConfirm}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 size={16} className="spin" style={{ animation: "spin 0.9s linear infinite" }} />
                Signing...
              </>
            ) : (
              <>
                <Check size={18} />
                Confirm & Sign
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};
