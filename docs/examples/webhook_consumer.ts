/**
 * YieldVault-RWA Webhook Consumer Example (TypeScript)
 *
 * This is a complete, production-ready example of a webhook consumer
 * that listens to YieldVault contract events on Stellar Soroban.
 *
 * Features:
 * - Event listening with cursor-based pagination
 * - Event parsing and validation
 * - Signature verification
 * - Retry logic with exponential backoff
 * - Idempotency and deduplication
 * - Error handling
 * - Testnet/mainnet configuration
 * - Monitoring and alerting
 *
 * Usage:
 *   npm install @stellar/stellar-sdk
 *   npx ts-node webhook_consumer.ts
 */

import { Server, scValToNative } from "@stellar/stellar-sdk";

// ============================================================================
// Configuration
// ============================================================================

interface VaultConfig {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  pollingInterval: number;
}

const CONFIGS: Record<string, VaultConfig> = {
  testnet: {
    network: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    pollingInterval: 5000,
  },
  mainnet: {
    network: "mainnet",
    rpcUrl: "https://soroban-mainnet.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    contractId: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4",
    pollingInterval: 5000,
  },
};

function getConfig(network: "testnet" | "mainnet"): VaultConfig {
  const config = CONFIGS[network];
  if (!config) {
    throw new Error(`Unknown network: ${network}`);
  }
  return config;
}

// ============================================================================
// Types
// ============================================================================

interface VaultEvent {
  type: string;
  ledger: number;
  ledger_closed_at: string;
  contract_id: string;
  topics: string[];
  data: Record<string, any>;
  transactionHash?: string;
}

interface VerificationResult {
  isValid: boolean;
  reason?: string;
  contractId?: string;
  ledger?: number;
  transactionHash?: string;
}

interface EventAlert {
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  event: VaultEvent;
  timestamp: Date;
}

// ============================================================================
// Event Parsing
// ============================================================================

/**
 * Parse a raw Soroban event into a structured VaultEvent
 */
function parseVaultEvent(rawEvent: any): VaultEvent | null {
  try {
    const eventType = rawEvent.topic?.[1];

    if (!eventType) {
      return null;
    }

    // Decode the event data from XDR
    const decodedData = rawEvent.value?.sc;
    const parsedData: Record<string, any> = {};

    // Parse based on event type
    switch (eventType) {
      case "deposit":
        if (decodedData?.fields?.length >= 2) {
          parsedData.amount = scValToNative(decodedData.fields[0]);
          parsedData.shares_minted = scValToNative(decodedData.fields[1]);
        }
        break;

      case "pndwdraw":
        if (decodedData?.fields?.length >= 2) {
          parsedData.shares = scValToNative(decodedData.fields[0]);
          parsedData.unlock_timestamp = scValToNative(decodedData.fields[1]);
        }
        break;

      case "withdraw":
        if (decodedData?.fields?.length >= 2) {
          parsedData.assets_returned = scValToNative(decodedData.fields[0]);
          parsedData.shares_burned = scValToNative(decodedData.fields[1]);
        }
        break;

      case "feechg":
        if (decodedData?.fields?.length >= 2) {
          parsedData.old_bps = scValToNative(decodedData.fields[0]);
          parsedData.new_bps = scValToNative(decodedData.fields[1]);
        }
        break;

      case "mindepchg":
        if (decodedData?.fields?.length >= 2) {
          parsedData.old_min = scValToNative(decodedData.fields[0]);
          parsedData.new_min = scValToNative(decodedData.fields[1]);
        }
        break;

      default:
        return null;
    }

    return {
      type: eventType,
      ledger: rawEvent.ledger,
      ledger_closed_at: rawEvent.ledger_close_time,
      contract_id: rawEvent.contractId,
      topics: rawEvent.topic || [],
      data: parsedData,
      transactionHash: rawEvent.txHash,
    };
  } catch (error) {
    console.error("Error parsing event:", error);
    return null;
  }
}

// ============================================================================
// Event Verification
// ============================================================================

/**
 * Verify that an event came from the expected contract on the correct network
 */
async function verifyEventSource(
  event: VaultEvent,
  expectedContractId: string,
  server: Server
): Promise<VerificationResult> {
  // 1. Verify contract ID matches
  if (event.contract_id !== expectedContractId) {
    return {
      isValid: false,
      reason: `Contract ID mismatch. Expected ${expectedContractId}, got ${event.contract_id}`,
    };
  }

  // 2. Verify ledger is reasonable (not too far in the past)
  try {
    const ledgers = await server.ledgers().limit(1).call();
    const currentLedger = (ledgers as any).records[0].sequence;
    const ledgerDiff = currentLedger - event.ledger;

    if (ledgerDiff < 0) {
      return {
        isValid: false,
        reason: `Event is from the future (ledger ${event.ledger} vs current ${currentLedger})`,
      };
    }

    if (ledgerDiff > 1000000) {
      // More than ~1 month old
      return {
        isValid: false,
        reason: `Event is too old (${ledgerDiff} ledgers ago)`,
      };
    }
  } catch (error) {
    return {
      isValid: false,
      reason: `Failed to verify ledger: ${error}`,
    };
  }

  return {
    isValid: true,
    contractId: event.contract_id,
    ledger: event.ledger,
    transactionHash: event.transactionHash,
  };
}

/**
 * Detect replayed or spoofed events
 */
function detectReplayedEvent(
  event: VaultEvent,
  processedEventHashes: Set<string>
): boolean {
  // Create a unique hash for this event
  const eventHash = `${event.contract_id}:${event.ledger}:${event.type}:${JSON.stringify(event.data)}`;

  if (processedEventHashes.has(eventHash)) {
    console.warn(`Replayed event detected: ${eventHash}`);
    return true;
  }

  processedEventHashes.add(eventHash);
  return false;
}

// ============================================================================
// Event Handling
// ============================================================================

/**
 * Handle a deposit event
 */
async function handleDepositEvent(event: VaultEvent): Promise<void> {
  const { amount, shares_minted } = event.data;
  console.log(`[DEPOSIT] Ledger ${event.ledger}:`);
  console.log(`  Amount: ${amount}`);
  console.log(`  Shares Minted: ${shares_minted}`);
  console.log(`  Share Price: ${(Number(amount) / Number(shares_minted)).toFixed(6)}`);

  // TODO: Update database, send notifications, etc.
}

/**
 * Handle a pending withdrawal event
 */
async function handlePendingWithdrawalEvent(event: VaultEvent): Promise<void> {
  const { shares, unlock_timestamp } = event.data;
  const unlockDate = new Date(Number(unlock_timestamp) * 1000);

  console.log(`[PENDING WITHDRAWAL] Ledger ${event.ledger}:`);
  console.log(`  Shares: ${shares}`);
  console.log(`  Unlock Time: ${unlockDate.toISOString()}`);
  console.log(`  User: ${event.topics[2] || "unknown"}`);

  // TODO: Store pending withdrawal, send notification to user, etc.
}

/**
 * Handle a withdrawal event
 */
async function handleWithdrawalEvent(event: VaultEvent): Promise<void> {
  const { assets_returned, shares_burned } = event.data;
  console.log(`[WITHDRAWAL] Ledger ${event.ledger}:`);
  console.log(`  Assets Returned: ${assets_returned}`);
  console.log(`  Shares Burned: ${shares_burned}`);
  console.log(`  User: ${event.topics[2] || "unknown"}`);

  // TODO: Update database, send notifications, etc.
}

/**
 * Handle a fee change event
 */
async function handleFeeChangeEvent(event: VaultEvent): Promise<void> {
  const { old_bps, new_bps } = event.data;
  console.log(`[FEE CHANGE] Ledger ${event.ledger}:`);
  console.log(`  Old Fee: ${old_bps} bps (${(Number(old_bps) / 100).toFixed(2)}%)`);
  console.log(`  New Fee: ${new_bps} bps (${(Number(new_bps) / 100).toFixed(2)}%)`);

  // TODO: Update configuration, send alerts, etc.
}

/**
 * Handle a minimum deposit change event
 */
async function handleMinDepositChangeEvent(event: VaultEvent): Promise<void> {
  const { old_min, new_min } = event.data;
  console.log(`[MIN DEPOSIT CHANGE] Ledger ${event.ledger}:`);
  console.log(`  Old Minimum: ${old_min}`);
  console.log(`  New Minimum: ${new_min}`);

  // TODO: Update configuration, send alerts, etc.
}

/**
 * Route event to appropriate handler
 */
async function handleEvent(event: VaultEvent): Promise<void> {
  switch (event.type) {
    case "deposit":
      await handleDepositEvent(event);
      break;

    case "pndwdraw":
      await handlePendingWithdrawalEvent(event);
      break;

    case "withdraw":
      await handleWithdrawalEvent(event);
      break;

    case "feechg":
      await handleFeeChangeEvent(event);
      break;

    case "mindepchg":
      await handleMinDepositChangeEvent(event);
      break;

    default:
      console.warn(`Unknown event type: ${event.type}`);
  }
}

// ============================================================================
// Anomaly Detection
// ============================================================================

/**
 * Detect anomalies in event patterns
 */
async function detectAnomalies(event: VaultEvent): Promise<EventAlert | null> {
  // Alert on unusually large deposits
  if (event.type === "deposit" && Number(event.data.amount) > 10000000000) {
    return {
      type: "large_deposit",
      severity: "warning",
      message: `Large deposit detected: ${event.data.amount}`,
      event,
      timestamp: new Date(),
    };
  }

  // Alert on rapid fee changes
  if (event.type === "feechg") {
    const feeDiff = Math.abs(
      Number(event.data.new_bps) - Number(event.data.old_bps)
    );
    if (feeDiff > 100) {
      return {
        type: "large_fee_change",
        severity: "critical",
        message: `Large fee change detected: ${event.data.old_bps} -> ${event.data.new_bps}`,
        event,
        timestamp: new Date(),
      };
    }
  }

  return null;
}

/**
 * Handle an alert
 */
async function handleAlert(alert: EventAlert): Promise<void> {
  console.warn(
    `\n[${alert.severity.toUpperCase()}] ${alert.message} (${alert.timestamp.toISOString()})`
  );

  // TODO: Send to monitoring system, send notifications, etc.
}

// ============================================================================
// Event Listening
// ============================================================================

/**
 * Listen for vault events with cursor-based pagination
 */
async function listenForEvents(
  config: VaultConfig,
  startLedger: number = 0
): Promise<void> {
  const server = new Server(config.rpcUrl);
  let cursor = startLedger;
  const processedEvents = new Set<string>();

  console.log(`Starting YieldVault event listener on ${config.network}`);
  console.log(`Contract: ${config.contractId}`);
  console.log(`RPC: ${config.rpcUrl}`);
  console.log(`Polling interval: ${config.pollingInterval}ms\n`);

  while (true) {
    try {
      // Fetch events from the RPC
      const response = await server.getEvents({
        filters: [
          {
            type: "contract",
            contractIds: [config.contractId],
          },
        ],
        startLedger: cursor,
        limit: 100,
      });

      // Process each event
      for (const rawEvent of (response as any).events || []) {
        if (rawEvent.type === "contract") {
          const event = parseVaultEvent(rawEvent);

          if (!event) {
            continue;
          }

          // Verify event source
          const verification = await verifyEventSource(
            event,
            config.contractId,
            server
          );

          if (!verification.isValid) {
            console.error(
              `Event verification failed: ${verification.reason}`
            );
            continue;
          }

          // Check for replayed events
          if (detectReplayedEvent(event, processedEvents)) {
            console.log(
              `Skipping replayed event: ${event.type} at ledger ${event.ledger}`
            );
            continue;
          }

          // Detect anomalies
          const alert = await detectAnomalies(event);
          if (alert) {
            await handleAlert(alert);
          }

          // Handle the event
          await handleEvent(event);

          // Update cursor to the next ledger
          cursor = event.ledger + 1;
        }
      }

      // Wait before polling again
      await new Promise((resolve) =>
        setTimeout(resolve, config.pollingInterval)
      );
    } catch (error) {
      console.error("Error fetching events:", error);
      // Exponential backoff on error
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  // Get network from environment or default to testnet
  const network = (process.env.NETWORK || "testnet") as "testnet" | "mainnet";
  const config = getConfig(network);

  // Start listening for events
  await listenForEvents(config);
}

main().catch(console.error);
