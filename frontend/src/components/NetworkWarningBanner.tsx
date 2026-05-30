import React from "react";
import { AlertTriangle } from "./icons";
import { useWalletNetwork } from "../hooks/useWalletNetwork";

interface NetworkWarningBannerProps {
  walletAddress: string | null;
}

const NetworkWarningBanner: React.FC<NetworkWarningBannerProps> = ({ walletAddress }) => {
  const { isMismatch, walletNetwork, expectedNetwork } = useWalletNetwork(walletAddress);

  if (!isMismatch) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "fixed",
        top: "72px",
        left: 0,
        right: 0,
        zIndex: 200,
        background: "rgba(220, 38, 38, 0.95)",
        borderBottom: "1px solid rgba(255, 100, 100, 0.5)",
        backdropFilter: "blur(8px)",
        color: "#fff",
        padding: "10px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        fontSize: "0.875rem",
        lineHeight: "1.5",
      }}
    >
      <AlertTriangle size={18} style={{ flexShrink: 0 }} />
      <span>
        <strong>Wrong network:</strong> your wallet is on{" "}
        <strong>{walletNetwork}</strong>, but this app requires{" "}
        <strong>{expectedNetwork}</strong>.{" "}
        Open Freighter → Settings → Network and switch to{" "}
        <strong>{expectedNetwork}</strong> to continue.
      </span>
    </div>
  );
};

export default NetworkWarningBanner;
