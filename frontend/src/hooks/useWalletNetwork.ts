import { useEffect, useState } from "react";
import { networkConfig } from "../config/network";

const POLL_MS = 10_000;

export interface WalletNetworkState {
  /** Human-readable label of the wallet's current network, e.g. "Testnet" */
  walletNetwork: string | null;
  /** True when the wallet is connected to a different network than the app expects */
  isMismatch: boolean;
  /** Human-readable label of the network the app expects */
  expectedNetwork: string;
}

/**
 * Polls Freighter's getNetworkDetails and compares the wallet's network
 * passphrase against the app's configured networkPassphrase.
 */
export function useWalletNetwork(walletAddress: string | null): WalletNetworkState {
  const expectedNetwork = networkConfig.isTestnet ? "Testnet" : "Mainnet";
  const [walletNetwork, setWalletNetwork] = useState<string | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      setWalletNetwork(null);
      return;
    }

    let active = true;

    const poll = async () => {
      try {
        const { getNetworkDetails } = await import("@stellar/freighter-api");
        if (typeof getNetworkDetails !== "function") return;
        const details = await getNetworkDetails();
        if (!active || !details?.networkPassphrase) return;
        const isMainnet = details.networkPassphrase.toLowerCase().includes("public");
        setWalletNetwork(isMainnet ? "Mainnet" : "Testnet");
      } catch {
        // leave previous value; don't flash a false mismatch on transient errors
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [walletAddress]);

  const isMismatch =
    walletNetwork !== null && walletNetwork !== expectedNetwork;

  return { walletNetwork, isMismatch, expectedNetwork };
}
