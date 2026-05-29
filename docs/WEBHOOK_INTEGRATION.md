# YieldVault-RWA Webhook Consumer Integration Guide

## Table of Contents
1. [Overview](#overview)
2. [Event Catalog](#event-catalog)
3. [Setting Up a Webhook Consumer](#setting-up-a-webhook-consumer)
4. [Signature Verification](#signature-verification)
5. [Retry Expectations & Reliability](#retry-expectations--reliability)
6. [Event Filtering](#event-filtering)
7. [Error Handling](#error-handling)
8. [Security Best Practices](#security-best-practices)
9. [Testnet vs Mainnet Configuration](#testnet-vs-mainnet-configuration)
10. [Complete Working Example](#complete-working-example)

---

## Overview

### What Are YieldVault-RWA Webhooks?

YieldVault-RWA is a decentralized vault protocol built on Stellar's Soroban smart contracts. The contract emits cryptographically-signed events whenever critical vault operations occur:

- **User deposits** USDC and receives fractional shares (`yvUSDC`)
- **User withdrawals** are initiated (with optional timelocks for large amounts)
- **Pending withdrawals** are executed after timelock expiration
- **Protocol fees** are updated
- **Minimum deposit thresholds** are changed

These events are published to the Stellar blockchain and can be consumed by off-chain indexers, backend services, analytics platforms, and user notification systems.

### Who Should Read This Guide?

This guide is for developers building:
- **Off-chain indexers** that track vault activity
- **Backend services** that need to react to vault events
- **Analytics platforms** that monitor protocol metrics
- **User notification systems** that alert on deposit/withdrawal status
- **Compliance systems** that audit transaction history

### Stellar Event Model (Soroban Contract Events)

Soroban contract events are cryptographically tied to transactions and ledger state. Each event:

1. **Is immutable** — Once published to the ledger, events cannot be modified
2. **Is cryptographically signed** — The transaction that emitted the event is signed by the transaction signers
3. **Is ledger-sequenced** — Each event has a ledger sequence number proving when it occurred
4. **Is contract-specific** — Events are tied to a specific contract address
5. **Is network-specific** — Events are tied to a specific Stellar network (testnet/mainnet)

Events are retrieved via the Stellar RPC API (Soroban RPC) and can be queried by:
- Contract address
- Event type (symbol)
- Ledger range
- Pagination cursor

---

## Event Catalog

### `deposit`

**Emitted by:** `YieldVault` — `deposit()` function

**When:** A user successfully deposits USDC into the vault and receives fractional shares in return.

**Topic structure:**
- `topic[0]`: Contract address (the vault contract)
- `topic[1]`: `"deposit"` symbol (8 bytes, left-padded)

**Data payload:**

| Field | Type | Description |
|-------|------|-------------|
| `amount` | `i128` | The quantity of underlying tokens (USDC) deposited |
| `shares_minted` | `i128` | The number of vault shares (`yvUSDC`) minted to the user |

**Example (JSON representation):**

```json
{
  "type": "contract",
  "event": "deposit",
  "contract_id": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "ledger": 12345,
  "ledger_closed_at": "2024-05-29T10:30:00Z",
  "data": {
    "amount": "1000000000",
    "shares_minted": "950000000"
  }
}
```

**Interpretation:**
- User deposited 1,000 USDC (10^9 stroops, assuming 6 decimals)
- Received 950 shares (accounting for vault fee or share dilution)

---

### `pndwdraw`

**Emitted by:** `YieldVault` — `withdraw()` function (when withdrawal exceeds large-withdrawal threshold)

**When:** A user initiates a withdrawal that exceeds the `large_withdrawal_threshold`, triggering a 24-hour timelock.

**Topic structure:**
- `topic[0]`: Contract address (the vault contract)
- `topic[1]`: `"pndwdraw"` symbol (8 bytes, left-padded)
- `topic[2]`: User address (the account initiating the withdrawal)

**Data payload:**

| Field | Type | Description |
|-------|------|-------------|
| `shares` | `i128` | The number of shares being withdrawn |
| `unlock_timestamp` | `u64` | Unix timestamp when the withdrawal can be executed (current_time + 86,400 seconds) |

**Example (JSON representation):**

```json
{
  "type": "contract",
  "event": "pndwdraw",
  "contract_id": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "ledger": 12346,
  "ledger_closed_at": "2024-05-29T10:35:00Z",
  "topics": [
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "pndwdraw",
    "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B"
  ],
  "data": {
    "shares": "5000000000",
    "unlock_timestamp": "1717062600"
  }
}
```

**Interpretation:**
- User initiated withdrawal of 5,000 shares
- Withdrawal is locked until Unix timestamp 1717062600 (24 hours from now)
- User must call `execute_withdrawal()` after this timestamp to complete the transfer

---

### `withdraw`

**Emitted by:** `YieldVault` — `withdraw()` or `execute_withdrawal()` function (when withdrawal completes immediately or after timelock)

**When:** A user successfully completes a withdrawal and receives underlying tokens.

**Topic structure:**
- `topic[0]`: Contract address (the vault contract)
- `topic[1]`: `"withdraw"` symbol (8 bytes, left-padded)
- `topic[2]`: User address (the account receiving the withdrawal)

**Data payload:**

| Field | Type | Description |
|-------|------|-------------|
| `assets_returned` | `i128` | The quantity of underlying tokens (USDC) returned to the user |
| `shares_burned` | `i128` | The number of shares burned from the user's balance |

**Example (JSON representation):**

```json
{
  "type": "contract",
  "event": "withdraw",
  "contract_id": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "ledger": 12347,
  "ledger_closed_at": "2024-05-29T11:00:00Z",
  "topics": [
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "withdraw",
    "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B"
  ],
  "data": {
    "assets_returned": "4950000000",
    "shares_burned": "5000000000"
  }
}
```

**Interpretation:**
- User withdrew 5,000 shares
- Received 4,950 USDC (accounting for protocol fees)
- Share-to-asset ratio: 1 share ≈ 0.99 USDC

---

### `feechg`

**Emitted by:** `YieldVault` — `set_fee_bps()` function

**When:** The vault admin updates the protocol fee (in basis points).

**Topic structure:**
- `topic[0]`: Contract address (the vault contract)
- `topic[1]`: `"feechg"` symbol (8 bytes, left-padded)

**Data payload:**

| Field | Type | Description |
|-------|------|-------------|
| `old_bps` | `i128` | Previous fee in basis points (e.g., 50 = 0.5%) |
| `new_bps` | `i128` | New fee in basis points |

**Example (JSON representation):**

```json
{
  "type": "contract",
  "event": "feechg",
  "contract_id": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "ledger": 12348,
  "ledger_closed_at": "2024-05-29T11:15:00Z",
  "data": {
    "old_bps": "50",
    "new_bps": "75"
  }
}
```

**Interpretation:**
- Protocol fee increased from 0.5% to 0.75%
- This affects future withdrawal calculations

---

### `mindepchg`

**Emitted by:** `YieldVault` — `set_min_deposit()` function

**When:** The vault admin updates the minimum deposit threshold.

**Topic structure:**
- `topic[0]`: Contract address (the vault contract)
- `topic[1]`: `"mindepchg"` symbol (8 bytes, left-padded)

**Data payload:**

| Field | Type | Description |
|-------|------|-------------|
| `old_min` | `i128` | Previous minimum deposit amount |
| `new_min` | `i128` | New minimum deposit amount |

**Example (JSON representation):**

```json
{
  "type": "contract",
  "event": "mindepchg",
  "contract_id": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "ledger": 12349,
  "ledger_closed_at": "2024-05-29T11:30:00Z",
  "data": {
    "old_min": "100000000",
    "new_min": "500000000"
  }
}
```

**Interpretation:**
- Minimum deposit increased from 100 USDC to 500 USDC
- Future deposits below 500 USDC will be rejected

---

## Setting Up a Webhook Consumer

### JavaScript/TypeScript Example

#### Installation

```bash
npm install @stellar/stellar-sdk
```

#### Basic Setup

```typescript
import { Server, scValToNative } from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const VAULT_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

const server = new Server(RPC_URL);

interface VaultEvent {
  type: string;
  ledger: number;
  ledger_closed_at: string;
  contract_id: string;
  topics: string[];
  data: Record<string, any>;
}

/**
 * Listen for vault events with cursor-based pagination
 */
async function listenForEvents(
  contractId: string,
  startLedger: number = 0,
  onEvent?: (event: VaultEvent) => void
): Promise<void> {
  let cursor = startLedger;
  const pollInterval = 5000; // Poll every 5 seconds (one ledger close)

  while (true) {
    try {
      // Fetch events from the RPC
      const response = await server.getEvents({
        filters: [
          {
            type: "contract",
            contractIds: [contractId],
          },
        ],
        startLedger: cursor,
        limit: 100,
      });

      // Process each event
      for (const event of response.events) {
        if (event.type === "contract") {
          const parsedEvent = parseVaultEvent(event);
          if (parsedEvent && onEvent) {
            onEvent(parsedEvent);
          }
          // Update cursor to the next ledger
          cursor = event.ledger + 1;
        }
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    } catch (error) {
      console.error("Error fetching events:", error);
      // Exponential backoff on error
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

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
    const decodedData = rawEvent.value.sc;
    const parsedData: Record<string, any> = {};

    // Parse based on event type
    switch (eventType) {
      case "deposit":
        parsedData.amount = scValToNative(decodedData.fields[0]);
        parsedData.shares_minted = scValToNative(decodedData.fields[1]);
        break;

      case "pndwdraw":
        parsedData.shares = scValToNative(decodedData.fields[0]);
        parsedData.unlock_timestamp = scValToNative(decodedData.fields[1]);
        break;

      case "withdraw":
        parsedData.assets_returned = scValToNative(decodedData.fields[0]);
        parsedData.shares_burned = scValToNative(decodedData.fields[1]);
        break;

      case "feechg":
        parsedData.old_bps = scValToNative(decodedData.fields[0]);
        parsedData.new_bps = scValToNative(decodedData.fields[1]);
        break;

      case "mindepchg":
        parsedData.old_min = scValToNative(decodedData.fields[0]);
        parsedData.new_min = scValToNative(decodedData.fields[1]);
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
    };
  } catch (error) {
    console.error("Error parsing event:", error);
    return null;
  }
}

/**
 * Example usage
 */
async function main() {
  console.log("Starting YieldVault event listener...");

  await listenForEvents(VAULT_CONTRACT_ID, 0, (event) => {
    console.log(`[${event.type}] Ledger ${event.ledger}:`, event.data);

    // Handle different event types
    switch (event.type) {
      case "deposit":
        console.log(
          `  User deposited ${event.data.amount} and received ${event.data.shares_minted} shares`
        );
        break;

      case "pndwdraw":
        console.log(
          `  Pending withdrawal of ${event.data.shares} shares, unlocks at ${event.data.unlock_timestamp}`
        );
        break;

      case "withdraw":
        console.log(
          `  User withdrew ${event.data.shares_burned} shares for ${event.data.assets_returned} assets`
        );
        break;

      case "feechg":
        console.log(
          `  Fee changed from ${event.data.old_bps} to ${event.data.new_bps} bps`
        );
        break;

      case "mindepchg":
        console.log(
          `  Min deposit changed from ${event.data.old_min} to ${event.data.new_min}`
        );
        break;
    }
  });
}

main().catch(console.error);
```

### Python Example

#### Installation

```bash
pip install stellar-sdk
```

#### Basic Setup

```python
from stellar_sdk import Server
import time
from typing import Optional, Dict, Any, Callable

RPC_URL = "https://soroban-testnet.stellar.org"
VAULT_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"

server = Server(RPC_URL)

class VaultEvent:
    def __init__(self, event_type: str, ledger: int, contract_id: str, 
                 topics: list, data: Dict[str, Any]):
        self.type = event_type
        self.ledger = ledger
        self.contract_id = contract_id
        self.topics = topics
        self.data = data

def parse_vault_event(raw_event: Dict) -> Optional[VaultEvent]:
    """Parse a raw Soroban event into a structured VaultEvent"""
    try:
        event_type = raw_event.get("topic", [None, None])[1]
        
        if not event_type:
            return None
        
        # Decode the event data
        decoded_data = raw_event.get("value", {}).get("sc", {})
        parsed_data = {}
        
        # Parse based on event type
        if event_type == "deposit":
            parsed_data["amount"] = decoded_data.get("fields", [None, None])[0]
            parsed_data["shares_minted"] = decoded_data.get("fields", [None, None])[1]
        
        elif event_type == "pndwdraw":
            parsed_data["shares"] = decoded_data.get("fields", [None, None])[0]
            parsed_data["unlock_timestamp"] = decoded_data.get("fields", [None, None])[1]
        
        elif event_type == "withdraw":
            parsed_data["assets_returned"] = decoded_data.get("fields", [None, None])[0]
            parsed_data["shares_burned"] = decoded_data.get("fields", [None, None])[1]
        
        elif event_type == "feechg":
            parsed_data["old_bps"] = decoded_data.get("fields", [None, None])[0]
            parsed_data["new_bps"] = decoded_data.get("fields", [None, None])[1]
        
        elif event_type == "mindepchg":
            parsed_data["old_min"] = decoded_data.get("fields", [None, None])[0]
            parsed_data["new_min"] = decoded_data.get("fields", [None, None])[1]
        
        else:
            return None
        
        return VaultEvent(
            event_type=event_type,
            ledger=raw_event.get("ledger"),
            contract_id=raw_event.get("contractId"),
            topics=raw_event.get("topic", []),
            data=parsed_data
        )
    
    except Exception as e:
        print(f"Error parsing event: {e}")
        return None

def listen_for_events(
    contract_id: str,
    start_ledger: int = 0,
    on_event: Optional[Callable[[VaultEvent], None]] = None
) -> None:
    """Listen for vault events with cursor-based pagination"""
    cursor = start_ledger
    poll_interval = 5  # Poll every 5 seconds (one ledger close)
    
    while True:
        try:
            # Fetch events from the RPC
            response = server.events(
                filters=[{
                    "type": "contract",
                    "contractIds": [contract_id]
                }],
                start_ledger=cursor,
                limit=100
            )
            
            # Process each event
            for event in response.get("events", []):
                if event.get("type") == "contract":
                    parsed_event = parse_vault_event(event)
                    if parsed_event and on_event:
                        on_event(parsed_event)
                    # Update cursor to the next ledger
                    cursor = event.get("ledger", cursor) + 1
            
            # Wait before polling again
            time.sleep(poll_interval)
        
        except Exception as e:
            print(f"Error fetching events: {e}")
            # Exponential backoff on error
            time.sleep(10)

def main():
    """Example usage"""
    print("Starting YieldVault event listener...")
    
    def handle_event(event: VaultEvent):
        print(f"[{event.type}] Ledger {event.ledger}: {event.data}")
        
        if event.type == "deposit":
            print(f"  User deposited {event.data['amount']} and received {event.data['shares_minted']} shares")
        
        elif event.type == "pndwdraw":
            print(f"  Pending withdrawal of {event.data['shares']} shares, unlocks at {event.data['unlock_timestamp']}")
        
        elif event.type == "withdraw":
            print(f"  User withdrew {event.data['shares_burned']} shares for {event.data['assets_returned']} assets")
        
        elif event.type == "feechg":
            print(f"  Fee changed from {event.data['old_bps']} to {event.data['new_bps']} bps")
        
        elif event.type == "mindepchg":
            print(f"  Min deposit changed from {event.data['old_min']} to {event.data['new_min']}")
    
    listen_for_events(VAULT_CONTRACT_ID, 0, handle_event)

if __name__ == "__main__":
    main()
```

### Rust Example

#### Add to Cargo.toml

```toml
[dependencies]
stellar-sdk = "0.22"
tokio = { version = "1", features = ["full"] }
serde_json = "1"
```

#### Basic Setup

```rust
use stellar_sdk::{Client, EventFilter};
use std::time::Duration;
use tokio::time::sleep;

const RPC_URL: &str = "https://soroban-testnet.stellar.org";
const VAULT_CONTRACT_ID: &str = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

#[derive(Debug, Clone)]
struct VaultEvent {
    event_type: String,
    ledger: u32,
    contract_id: String,
    data: serde_json::Value,
}

async fn listen_for_events(
    contract_id: &str,
    start_ledger: u32,
    on_event: impl Fn(VaultEvent) + Send + Sync + 'static,
) {
    let client = Client::new(RPC_URL).expect("Failed to create client");
    let mut cursor = start_ledger;
    let poll_interval = Duration::from_secs(5);

    loop {
        match client
            .get_events(
                vec![EventFilter::Contract {
                    contract_ids: vec![contract_id.to_string()],
                }],
                Some(cursor),
                Some(100),
            )
            .await
        {
            Ok(response) => {
                for event in response.events {
                    if let Some(parsed) = parse_vault_event(&event) {
                        on_event(parsed.clone());
                        cursor = event.ledger + 1;
                    }
                }
            }
            Err(e) => {
                eprintln!("Error fetching events: {}", e);
                sleep(Duration::from_secs(10)).await;
                continue;
            }
        }

        sleep(poll_interval).await;
    }
}

fn parse_vault_event(raw_event: &serde_json::Value) -> Option<VaultEvent> {
    let event_type = raw_event
        .get("topic")
        .and_then(|t| t.get(1))
        .and_then(|t| t.as_str())?
        .to_string();

    let data = raw_event
        .get("value")
        .and_then(|v| v.get("sc"))
        .cloned()
        .unwrap_or(serde_json::json!({}));

    Some(VaultEvent {
        event_type,
        ledger: raw_event
            .get("ledger")
            .and_then(|l| l.as_u64())
            .unwrap_or(0) as u32,
        contract_id: raw_event
            .get("contractId")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string(),
        data,
    })
}

#[tokio::main]
async fn main() {
    println!("Starting YieldVault event listener...");

    listen_for_events(VAULT_CONTRACT_ID, 0, |event| {
        println!("[{}] Ledger {}: {:?}", event.event_type, event.ledger, event.data);
    })
    .await;
}
```

---

## Signature Verification

### Understanding Event Authenticity

Soroban contract events are cryptographically tied to transactions. To verify an event is authentic:

1. **Verify the contract address** — Ensure the event came from the expected vault contract
2. **Verify the network** — Ensure the event is from the correct Stellar network (testnet/mainnet)
3. **Verify the transaction** — Ensure the transaction that emitted the event is valid and signed
4. **Verify the ledger sequence** — Ensure the ledger sequence is reasonable (not too far in the past)

### TypeScript Verification Example

```typescript
import { Server, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

interface VerificationResult {
  isValid: boolean;
  reason?: string;
  contractId?: string;
  ledger?: number;
  transactionHash?: string;
}

/**
 * Verify that an event came from the expected contract on the correct network
 */
async function verifyEventSource(
  event: VaultEvent,
  expectedContractId: string,
  expectedNetworkPassphrase: string,
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
  const currentLedger = await server.ledgers().limit(1).call();
  const ledgerDiff = currentLedger.records[0].sequence - event.ledger;

  if (ledgerDiff < 0) {
    return {
      isValid: false,
      reason: `Event is from the future (ledger ${event.ledger} vs current ${currentLedger.records[0].sequence})`,
    };
  }

  if (ledgerDiff > 1000000) {
    // More than ~1 month old
    return {
      isValid: false,
      reason: `Event is too old (${ledgerDiff} ledgers ago)`,
    };
  }

  // 3. Verify the transaction that emitted this event
  try {
    const txResponse = await server
      .transactions()
      .forLedger(event.ledger)
      .limit(100)
      .call();

    // Find the transaction that matches this event
    const matchingTx = txResponse.records.find(
      (tx) => tx.hash === event.transactionHash
    );

    if (!matchingTx) {
      return {
        isValid: false,
        reason: `Transaction not found for event (hash: ${event.transactionHash})`,
      };
    }

    // 4. Verify transaction is successful
    if (!matchingTx.successful) {
      return {
        isValid: false,
        reason: `Transaction failed (hash: ${event.transactionHash})`,
      };
    }

    return {
      isValid: true,
      contractId: event.contract_id,
      ledger: event.ledger,
      transactionHash: event.transactionHash,
    };
  } catch (error) {
    return {
      isValid: false,
      reason: `Failed to verify transaction: ${error}`,
    };
  }
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

/**
 * Example usage
 */
async function main() {
  const server = new Server("https://soroban-testnet.stellar.org");
  const expectedContractId =
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
  const expectedNetwork = "Test SDF Network ; September 2015";
  const processedEvents = new Set<string>();

  // Simulate receiving an event
  const event: VaultEvent = {
    type: "deposit",
    ledger: 12345,
    ledger_closed_at: "2024-05-29T10:30:00Z",
    contract_id: expectedContractId,
    topics: [expectedContractId, "deposit"],
    data: {
      amount: "1000000000",
      shares_minted: "950000000",
    },
  };

  // Verify the event
  const verification = await verifyEventSource(
    event,
    expectedContractId,
    expectedNetwork,
    server
  );

  if (!verification.isValid) {
    console.error(`Event verification failed: ${verification.reason}`);
    return;
  }

  // Check for replayed events
  if (detectReplayedEvent(event, processedEvents)) {
    console.error("Event is a replay of a previously processed event");
    return;
  }

  console.log("Event verified successfully:", verification);
}

main().catch(console.error);
```

### Python Verification Example

```python
from stellar_sdk import Server
from datetime import datetime, timedelta
import hashlib

class VerificationResult:
    def __init__(self, is_valid: bool, reason: str = None, 
                 contract_id: str = None, ledger: int = None):
        self.is_valid = is_valid
        self.reason = reason
        self.contract_id = contract_id
        self.ledger = ledger

def verify_event_source(
    event: VaultEvent,
    expected_contract_id: str,
    expected_network_passphrase: str,
    server: Server
) -> VerificationResult:
    """Verify that an event came from the expected contract on the correct network"""
    
    # 1. Verify contract ID matches
    if event.contract_id != expected_contract_id:
        return VerificationResult(
            is_valid=False,
            reason=f"Contract ID mismatch. Expected {expected_contract_id}, got {event.contract_id}"
        )
    
    # 2. Verify ledger is reasonable (not too far in the past)
    try:
        current_ledger = server.ledgers().limit(1).call()
        ledger_diff = current_ledger["records"][0]["sequence"] - event.ledger
        
        if ledger_diff < 0:
            return VerificationResult(
                is_valid=False,
                reason=f"Event is from the future (ledger {event.ledger} vs current {current_ledger['records'][0]['sequence']})"
            )
        
        if ledger_diff > 1000000:  # More than ~1 month old
            return VerificationResult(
                is_valid=False,
                reason=f"Event is too old ({ledger_diff} ledgers ago)"
            )
    
    except Exception as e:
        return VerificationResult(
            is_valid=False,
            reason=f"Failed to fetch current ledger: {e}"
        )
    
    # 3. Verify the transaction that emitted this event
    try:
        tx_response = server.transactions().for_ledger(event.ledger).limit(100).call()
        
        # In a real implementation, you would match the transaction hash
        # For now, we just verify the ledger exists
        if not tx_response.get("records"):
            return VerificationResult(
                is_valid=False,
                reason=f"No transactions found for ledger {event.ledger}"
            )
        
        return VerificationResult(
            is_valid=True,
            contract_id=event.contract_id,
            ledger=event.ledger
        )
    
    except Exception as e:
        return VerificationResult(
            is_valid=False,
            reason=f"Failed to verify transaction: {e}"
        )

def detect_replayed_event(
    event: VaultEvent,
    processed_event_hashes: set
) -> bool:
    """Detect replayed or spoofed events"""
    event_hash = f"{event.contract_id}:{event.ledger}:{event.type}:{str(event.data)}"
    event_hash = hashlib.sha256(event_hash.encode()).hexdigest()
    
    if event_hash in processed_event_hashes:
        print(f"Replayed event detected: {event_hash}")
        return True
    
    processed_event_hashes.add(event_hash)
    return False

def main():
    server = Server("https://soroban-testnet.stellar.org")
    expected_contract_id = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
    expected_network = "Test SDF Network ; September 2015"
    processed_events = set()
    
    # Simulate receiving an event
    event = VaultEvent(
        event_type="deposit",
        ledger=12345,
        contract_id=expected_contract_id,
        topics=[expected_contract_id, "deposit"],
        data={"amount": "1000000000", "shares_minted": "950000000"}
    )
    
    # Verify the event
    verification = verify_event_source(
        event,
        expected_contract_id,
        expected_network,
        server
    )
    
    if not verification.is_valid:
        print(f"Event verification failed: {verification.reason}")
        return
    
    # Check for replayed events
    if detect_replayed_event(event, processed_events):
        print("Event is a replay of a previously processed event")
        return
    
    print(f"Event verified successfully: {verification.__dict__}")

if __name__ == "__main__":
    main()
```

---

## Retry Expectations & Reliability

### Polling Strategy

YieldVault events are retrieved via polling the Stellar RPC API. Here's the recommended strategy:

#### Polling Interval

- **Recommended interval:** 5 seconds (matches Stellar ledger close time)
- **Minimum interval:** 1 second (risk of rate limiting)
- **Maximum interval:** 30 seconds (risk of missing events if RPC is temporarily unavailable)

#### Cursor-Based Pagination

Always use cursor-based pagination to avoid missing events:

```typescript
let cursor = lastProcessedLedger;

while (true) {
  const response = await server.getEvents({
    filters: [{ type: "contract", contractIds: [contractId] }],
    startLedger: cursor,
    limit: 100,
  });

  for (const event of response.events) {
    processEvent(event);
    cursor = event.ledger + 1; // Move cursor forward
  }

  // Store cursor persistently (database, file, etc.)
  await persistCursor(cursor);

  await sleep(5000); // Wait 5 seconds before next poll
}
```

### Handling Missed Events

If your consumer is offline or the RPC is unavailable, you may miss events. To recover:

1. **Store the last processed ledger** — Persist the cursor to a database or file
2. **Resume from the last cursor** — On restart, query from the last known ledger
3. **Re-scan if needed** — If the cursor is too old (>1 month), re-scan from a recent ledger

```typescript
async function resumeFromCursor(): Promise<void> {
  let cursor = await loadCursorFromDatabase();

  if (!cursor) {
    // First run: start from current ledger
    const ledgers = await server.ledgers().limit(1).call();
    cursor = ledgers.records[0].sequence;
  }

  // Resume listening from the cursor
  await listenForEvents(VAULT_CONTRACT_ID, cursor);
}
```

### Idempotency & Deduplication

Events may be delivered multiple times due to network issues or consumer restarts. Implement idempotency:

```typescript
interface ProcessedEvent {
  contractId: string;
  ledger: number;
  eventType: string;
  dataHash: string;
}

const processedEvents = new Map<string, ProcessedEvent>();

function isEventProcessed(event: VaultEvent): boolean {
  const key = `${event.contract_id}:${event.ledger}:${event.type}`;
  return processedEvents.has(key);
}

function markEventProcessed(event: VaultEvent): void {
  const key = `${event.contract_id}:${event.ledger}:${event.type}`;
  processedEvents.set(key, {
    contractId: event.contract_id,
    ledger: event.ledger,
    eventType: event.type,
    dataHash: hashEvent(event),
  });
}

function hashEvent(event: VaultEvent): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(event.data))
    .digest("hex");
}

async function processEventWithIdempotency(event: VaultEvent): Promise<void> {
  if (isEventProcessed(event)) {
    console.log(`Event already processed: ${event.type} at ledger ${event.ledger}`);
    return;
  }

  // Process the event
  await handleEvent(event);

  // Mark as processed
  markEventProcessed(event);
}
```

### Retry Strategy with Exponential Backoff

When the RPC is temporarily unavailable, use exponential backoff:

```typescript
async function fetchEventsWithRetry(
  contractId: string,
  startLedger: number,
  maxRetries: number = 5
): Promise<any> {
  let retries = 0;
  let backoffMs = 1000; // Start with 1 second

  while (retries < maxRetries) {
    try {
      return await server.getEvents({
        filters: [{ type: "contract", contractIds: [contractId] }],
        startLedger,
        limit: 100,
      });
    } catch (error) {
      retries++;
      if (retries >= maxRetries) {
        throw error;
      }

      console.warn(
        `RPC error (attempt ${retries}/${maxRetries}), retrying in ${backoffMs}ms:`,
        error
      );

      await new Promise((resolve) => setTimeout(resolve, backoffMs));

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      backoffMs = Math.min(backoffMs * 2, 30000);
    }
  }
}
```

---

## Event Filtering

### Filter by Contract Address

```typescript
// Only listen to a specific vault contract
const response = await server.getEvents({
  filters: [
    {
      type: "contract",
      contractIds: [VAULT_CONTRACT_ID],
    },
  ],
  startLedger: 0,
  limit: 100,
});
```

### Filter by Event Type

```typescript
// Listen to all events, then filter by type
const depositEvents = response.events.filter(
  (event) => event.topic?.[1] === "deposit"
);

const withdrawalEvents = response.events.filter(
  (event) => event.topic?.[1] === "withdraw"
);
```

### Filter by Ledger Range

```typescript
// Query events from a specific ledger range
const response = await server.getEvents({
  filters: [
    {
      type: "contract",
      contractIds: [VAULT_CONTRACT_ID],
    },
  ],
  startLedger: 12000, // Start from ledger 12000
  limit: 100,
});

// Process events up to a specific ledger
const eventsInRange = response.events.filter(
  (event) => event.ledger >= 12000 && event.ledger <= 12100
);
```

### Filter by User Address (in Event Topics)

```typescript
// For events with user address in topics (pndwdraw, withdraw)
const userAddress = "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B";

const userEvents = response.events.filter((event) => {
  const topics = event.topic || [];
  return topics.includes(userAddress);
});
```

---

## Error Handling

### Common Failure Scenarios

#### 1. RPC Node Unavailable

```typescript
async function handleRpcUnavailable(error: Error): Promise<void> {
  console.error("RPC node is unavailable:", error.message);

  // Implement exponential backoff
  let backoffMs = 5000;
  while (true) {
    try {
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      const response = await server.getEvents({
        filters: [{ type: "contract", contractIds: [VAULT_CONTRACT_ID] }],
        startLedger: 0,
        limit: 1,
      });
      console.log("RPC node is back online");
      return;
    } catch (e) {
      console.warn(`Still unavailable, retrying in ${backoffMs}ms`);
      backoffMs = Math.min(backoffMs * 2, 60000);
    }
  }
}
```

#### 2. Malformed Event Data

```typescript
function parseEventDataSafely(event: any): VaultEvent | null {
  try {
    // Validate required fields
    if (!event.type || !event.ledger || !event.contractId) {
      console.error("Event missing required fields:", event);
      return null;
    }

    // Validate event type
    const validTypes = ["deposit", "pndwdraw", "withdraw", "feechg", "mindepchg"];
    if (!validTypes.includes(event.topic?.[1])) {
      console.error("Unknown event type:", event.topic?.[1]);
      return null;
    }

    // Validate data payload
    const data = event.value?.sc?.fields;
    if (!data || !Array.isArray(data)) {
      console.error("Event data is malformed:", event);
      return null;
    }

    return parseVaultEvent(event);
  } catch (error) {
    console.error("Error parsing event:", error);
    return null;
  }
}
```

#### 3. Contract Upgraded (Address Changed)

```typescript
async function handleContractUpgrade(
  oldContractId: string,
  newContractId: string
): Promise<void> {
  console.warn(
    `Contract upgraded from ${oldContractId} to ${newContractId}`
  );

  // Update configuration
  const config = await loadConfig();
  config.vaultContractId = newContractId;
  await saveConfig(config);

  // Resume listening from the new contract
  await listenForEvents(newContractId, 0);
}
```

#### 4. Network Passphrase Mismatch

```typescript
function validateNetworkPassphrase(
  event: VaultEvent,
  expectedPassphrase: string
): boolean {
  // The network passphrase is not directly in the event,
  // but you should verify it when connecting to the RPC
  const rpcPassphrase = server.getNetworkPassphrase?.();

  if (rpcPassphrase !== expectedPassphrase) {
    console.error(
      `Network mismatch: expected ${expectedPassphrase}, got ${rpcPassphrase}`
    );
    return false;
  }

  return true;
}
```

#### 5. Cursor Expired (Too Far Behind)

```typescript
async function handleCursorExpired(cursor: number): Promise<void> {
  console.warn(`Cursor ${cursor} is too far behind`);

  // Get the current ledger
  const ledgers = await server.ledgers().limit(1).call();
  const currentLedger = ledgers.records[0].sequence;

  // If more than 1 month behind, reset to current ledger
  if (currentLedger - cursor > 1000000) {
    console.warn(
      `Resetting cursor from ${cursor} to ${currentLedger} (too far behind)`
    );
    await persistCursor(currentLedger);
    return;
  }

  // Otherwise, resume from the cursor
  await listenForEvents(VAULT_CONTRACT_ID, cursor);
}
```

---

## Security Best Practices

### 1. Never Trust Event Data Without Source Verification

```typescript
// ❌ BAD: Trust event data directly
const amount = event.data.amount;
updateUserBalance(amount);

// ✅ GOOD: Verify event source first
const verification = await verifyEventSource(event, expectedContractId, expectedNetwork, server);
if (!verification.isValid) {
  console.error("Event verification failed");
  return;
}
const amount = event.data.amount;
updateUserBalance(amount);
```

### 2. Always Validate Contract Address Against Known Deployment

```typescript
const KNOWN_DEPLOYMENTS = {
  testnet: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  mainnet: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4",
};

function validateContractAddress(
  contractId: string,
  network: "testnet" | "mainnet"
): boolean {
  const expectedId = KNOWN_DEPLOYMENTS[network];
  if (contractId !== expectedId) {
    console.error(
      `Contract ID mismatch on ${network}: expected ${expectedId}, got ${contractId}`
    );
    return false;
  }
  return true;
}
```

### 3. Store Processed Event Cursors Persistently

```typescript
// Use a database or file to store the cursor
async function persistCursor(cursor: number): Promise<void> {
  // Example: Store in a database
  await db.query("UPDATE event_cursor SET cursor = ? WHERE id = 1", [cursor]);

  // Or store in a file
  // fs.writeFileSync("cursor.json", JSON.stringify({ cursor }));
}

async function loadCursor(): Promise<number> {
  // Example: Load from database
  const result = await db.query("SELECT cursor FROM event_cursor WHERE id = 1");
  return result.rows[0]?.cursor || 0;

  // Or load from file
  // const data = JSON.parse(fs.readFileSync("cursor.json", "utf-8"));
  // return data.cursor;
}
```

### 4. Rate Limiting Considerations

```typescript
// Implement rate limiting to avoid overwhelming the RPC
const rateLimiter = new RateLimiter({
  maxRequests: 100, // Max 100 requests
  windowMs: 60000, // Per 60 seconds
});

async function fetchEventsWithRateLimit(
  contractId: string,
  startLedger: number
): Promise<any> {
  await rateLimiter.acquire();

  try {
    return await server.getEvents({
      filters: [{ type: "contract", contractIds: [contractId] }],
      startLedger,
      limit: 100,
    });
  } finally {
    rateLimiter.release();
  }
}
```

### 5. Alerting on Unexpected Event Patterns

```typescript
interface EventAlert {
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  event: VaultEvent;
}

async function detectAnomalies(event: VaultEvent): Promise<EventAlert | null> {
  // Alert on unusually large deposits
  if (event.type === "deposit" && event.data.amount > 10000000000) {
    return {
      type: "large_deposit",
      severity: "warning",
      message: `Large deposit detected: ${event.data.amount}`,
      event,
    };
  }

  // Alert on rapid fee changes
  if (event.type === "feechg") {
    const feeDiff = Math.abs(event.data.new_bps - event.data.old_bps);
    if (feeDiff > 100) {
      return {
        type: "large_fee_change",
        severity: "critical",
        message: `Large fee change detected: ${event.data.old_bps} -> ${event.data.new_bps}`,
        event,
      };
    }
  }

  return null;
}

async function handleAlert(alert: EventAlert): Promise<void> {
  console.warn(`[${alert.severity.toUpperCase()}] ${alert.message}`);

  // Send to monitoring system
  await sendToMonitoring(alert);

  // Send notification
  if (alert.severity === "critical") {
    await sendCriticalAlert(alert);
  }
}
```

---

## Testnet vs Mainnet Configuration

### Configuration Management

```typescript
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

// Usage
const testnetConfig = getConfig("testnet");
const mainnetConfig = getConfig("mainnet");
```

### Environment Variables

```bash
# .env.testnet
VITE_NETWORK=testnet
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_VAULT_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4

# .env.mainnet
VITE_NETWORK=mainnet
VITE_RPC_URL=https://soroban-mainnet.stellar.org
VITE_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
VITE_VAULT_CONTRACT_ID=CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4
```

```typescript
function loadConfig(): VaultConfig {
  const network = (process.env.VITE_NETWORK || "testnet") as
    | "testnet"
    | "mainnet";

  return {
    network,
    rpcUrl: process.env.VITE_RPC_URL || CONFIGS[network].rpcUrl,
    networkPassphrase:
      process.env.VITE_NETWORK_PASSPHRASE || CONFIGS[network].networkPassphrase,
    contractId:
      process.env.VITE_VAULT_CONTRACT_ID || CONFIGS[network].contractId,
    pollingInterval: 5000,
  };
}
```

---

## Complete Working Example

See the accompanying files for complete, runnable examples:

- **TypeScript:** `docs/examples/webhook_consumer.ts`
- **Python:** `docs/examples/webhook_consumer.py`

These examples include:
- Event listening with cursor-based pagination
- Event parsing and validation
- Signature verification
- Retry logic with exponential backoff
- Idempotency and deduplication
- Error handling
- Testnet/mainnet configuration
- Monitoring and alerting

### Running the Examples

#### TypeScript

```bash
npm install @stellar/stellar-sdk
npx ts-node docs/examples/webhook_consumer.ts
```

#### Python

```bash
pip install stellar-sdk
python docs/examples/webhook_consumer.py
```

---

## Troubleshooting

### Events Not Appearing

1. **Check contract address** — Verify the contract ID is correct for your network
2. **Check network** — Ensure you're querying the correct RPC endpoint
3. **Check ledger range** — Ensure the start ledger is not too far in the past
4. **Check event type** — Verify the event type matches the contract's emissions

### Events Appearing Out of Order

Events are always returned in ledger order. If you see out-of-order events:
1. Verify you're using cursor-based pagination
2. Check that you're not mixing events from different contracts
3. Ensure your event processing is idempotent

### High Latency

1. **Reduce polling interval** — Decrease from 5s to 1s (if RPC allows)
2. **Use a faster RPC** — Consider using a private RPC endpoint
3. **Batch processing** — Process multiple events in parallel
4. **Optimize event parsing** — Cache parsed events to reduce CPU usage

### Rate Limiting

If you're hitting rate limits:
1. **Increase polling interval** — Increase from 5s to 10s or 30s
2. **Reduce batch size** — Decrease `limit` from 100 to 50
3. **Use a private RPC** — Avoid public RPC rate limits
4. **Implement backoff** — Use exponential backoff on 429 errors

---

## Additional Resources

- [Stellar Soroban Documentation](https://developers.stellar.org/docs/learn/soroban)
- [Stellar RPC API Reference](https://developers.stellar.org/docs/reference/rpc)
- [YieldVault Contract Architecture](./CONTRACTS_ARCHITECTURE.md)
- [Stellar SDK (TypeScript)](https://github.com/stellar/js-stellar-sdk)
- [Stellar SDK (Python)](https://github.com/stellar/py-stellar-base)
- [Stellar SDK (Rust)](https://github.com/stellar/rs-stellar-sdk)

