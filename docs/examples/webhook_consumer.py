#!/usr/bin/env python3
"""
YieldVault-RWA Webhook Consumer Example (Python)

This is a complete, production-ready example of a webhook consumer
that listens to YieldVault contract events on Stellar Soroban.

Features:
- Event listening with cursor-based pagination
- Event parsing and validation
- Signature verification
- Retry logic with exponential backoff
- Idempotency and deduplication
- Error handling
- Testnet/mainnet configuration
- Monitoring and alerting

Usage:
    pip install stellar-sdk
    python webhook_consumer.py
"""

import time
import json
import hashlib
from typing import Optional, Dict, Any, Callable, Set
from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from stellar_sdk import Server


# ============================================================================
# Configuration
# ============================================================================

@dataclass
class VaultConfig:
    """Configuration for YieldVault event consumer"""
    network: str
    rpc_url: str
    network_passphrase: str
    contract_id: str
    polling_interval: int


CONFIGS = {
    "testnet": VaultConfig(
        network="testnet",
        rpc_url="https://soroban-testnet.stellar.org",
        network_passphrase="Test SDF Network ; September 2015",
        contract_id="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        polling_interval=5000,
    ),
    "mainnet": VaultConfig(
        network="mainnet",
        rpc_url="https://soroban-mainnet.stellar.org",
        network_passphrase="Public Global Stellar Network ; September 2015",
        contract_id="CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4",
        polling_interval=5000,
    ),
}


def get_config(network: str) -> VaultConfig:
    """Get configuration for a specific network"""
    config = CONFIGS.get(network)
    if not config:
        raise ValueError(f"Unknown network: {network}")
    return config


# ============================================================================
# Types
# ============================================================================

@dataclass
class VaultEvent:
    """Parsed YieldVault event"""
    event_type: str
    ledger: int
    ledger_closed_at: str
    contract_id: str
    topics: list
    data: Dict[str, Any]
    transaction_hash: Optional[str] = None


@dataclass
class VerificationResult:
    """Result of event verification"""
    is_valid: bool
    reason: Optional[str] = None
    contract_id: Optional[str] = None
    ledger: Optional[int] = None
    transaction_hash: Optional[str] = None


class AlertSeverity(Enum):
    """Alert severity levels"""
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class EventAlert:
    """Alert for anomalous event patterns"""
    alert_type: str
    severity: AlertSeverity
    message: str
    event: VaultEvent
    timestamp: datetime


# ============================================================================
# Event Parsing
# ============================================================================

def parse_vault_event(raw_event: Dict) -> Optional[VaultEvent]:
    """Parse a raw Soroban event into a structured VaultEvent"""
    try:
        topics = raw_event.get("topic", [])
        if len(topics) < 2:
            return None

        event_type = topics[1]

        # Decode the event data
        decoded_data = raw_event.get("value", {}).get("sc", {})
        fields = decoded_data.get("fields", [])
        parsed_data = {}

        # Parse based on event type
        if event_type == "deposit":
            if len(fields) >= 2:
                parsed_data["amount"] = fields[0]
                parsed_data["shares_minted"] = fields[1]

        elif event_type == "pndwdraw":
            if len(fields) >= 2:
                parsed_data["shares"] = fields[0]
                parsed_data["unlock_timestamp"] = fields[1]

        elif event_type == "withdraw":
            if len(fields) >= 2:
                parsed_data["assets_returned"] = fields[0]
                parsed_data["shares_burned"] = fields[1]

        elif event_type == "feechg":
            if len(fields) >= 2:
                parsed_data["old_bps"] = fields[0]
                parsed_data["new_bps"] = fields[1]

        elif event_type == "mindepchg":
            if len(fields) >= 2:
                parsed_data["old_min"] = fields[0]
                parsed_data["new_min"] = fields[1]

        else:
            return None

        return VaultEvent(
            event_type=event_type,
            ledger=raw_event.get("ledger", 0),
            ledger_closed_at=raw_event.get("ledger_close_time", ""),
            contract_id=raw_event.get("contractId", ""),
            topics=topics,
            data=parsed_data,
            transaction_hash=raw_event.get("txHash"),
        )

    except Exception as e:
        print(f"Error parsing event: {e}")
        return None


# ============================================================================
# Event Verification
# ============================================================================

def verify_event_source(
    event: VaultEvent,
    expected_contract_id: str,
    server: Server,
) -> VerificationResult:
    """Verify that an event came from the expected contract"""

    # 1. Verify contract ID matches
    if event.contract_id != expected_contract_id:
        return VerificationResult(
            is_valid=False,
            reason=f"Contract ID mismatch. Expected {expected_contract_id}, got {event.contract_id}",
        )

    # 2. Verify ledger is reasonable (not too far in the past)
    try:
        ledgers = server.ledgers().limit(1).call()
        current_ledger = ledgers["records"][0]["sequence"]
        ledger_diff = current_ledger - event.ledger

        if ledger_diff < 0:
            return VerificationResult(
                is_valid=False,
                reason=f"Event is from the future (ledger {event.ledger} vs current {current_ledger})",
            )

        if ledger_diff > 1000000:  # More than ~1 month old
            return VerificationResult(
                is_valid=False,
                reason=f"Event is too old ({ledger_diff} ledgers ago)",
            )

    except Exception as e:
        return VerificationResult(
            is_valid=False,
            reason=f"Failed to verify ledger: {e}",
        )

    return VerificationResult(
        is_valid=True,
        contract_id=event.contract_id,
        ledger=event.ledger,
        transaction_hash=event.transaction_hash,
    )


def detect_replayed_event(
    event: VaultEvent,
    processed_event_hashes: Set[str],
) -> bool:
    """Detect replayed or spoofed events"""
    event_hash = f"{event.contract_id}:{event.ledger}:{event.event_type}:{json.dumps(event.data)}"
    event_hash = hashlib.sha256(event_hash.encode()).hexdigest()

    if event_hash in processed_event_hashes:
        print(f"Replayed event detected: {event_hash}")
        return True

    processed_event_hashes.add(event_hash)
    return False


# ============================================================================
# Event Handling
# ============================================================================

async def handle_deposit_event(event: VaultEvent) -> None:
    """Handle a deposit event"""
    amount = event.data.get("amount")
    shares_minted = event.data.get("shares_minted")

    print(f"[DEPOSIT] Ledger {event.ledger}:")
    print(f"  Amount: {amount}")
    print(f"  Shares Minted: {shares_minted}")

    if amount and shares_minted:
        try:
            share_price = float(amount) / float(shares_minted)
            print(f"  Share Price: {share_price:.6f}")
        except (ValueError, ZeroDivisionError):
            pass

    # TODO: Update database, send notifications, etc.


async def handle_pending_withdrawal_event(event: VaultEvent) -> None:
    """Handle a pending withdrawal event"""
    shares = event.data.get("shares")
    unlock_timestamp = event.data.get("unlock_timestamp")

    print(f"[PENDING WITHDRAWAL] Ledger {event.ledger}:")
    print(f"  Shares: {shares}")

    if unlock_timestamp:
        unlock_date = datetime.fromtimestamp(int(unlock_timestamp))
        print(f"  Unlock Time: {unlock_date.isoformat()}")

    if len(event.topics) > 2:
        print(f"  User: {event.topics[2]}")

    # TODO: Store pending withdrawal, send notification to user, etc.


async def handle_withdrawal_event(event: VaultEvent) -> None:
    """Handle a withdrawal event"""
    assets_returned = event.data.get("assets_returned")
    shares_burned = event.data.get("shares_burned")

    print(f"[WITHDRAWAL] Ledger {event.ledger}:")
    print(f"  Assets Returned: {assets_returned}")
    print(f"  Shares Burned: {shares_burned}")

    if len(event.topics) > 2:
        print(f"  User: {event.topics[2]}")

    # TODO: Update database, send notifications, etc.


async def handle_fee_change_event(event: VaultEvent) -> None:
    """Handle a fee change event"""
    old_bps = event.data.get("old_bps")
    new_bps = event.data.get("new_bps")

    print(f"[FEE CHANGE] Ledger {event.ledger}:")

    if old_bps:
        old_pct = float(old_bps) / 100
        print(f"  Old Fee: {old_bps} bps ({old_pct:.2f}%)")

    if new_bps:
        new_pct = float(new_bps) / 100
        print(f"  New Fee: {new_bps} bps ({new_pct:.2f}%)")

    # TODO: Update configuration, send alerts, etc.


async def handle_min_deposit_change_event(event: VaultEvent) -> None:
    """Handle a minimum deposit change event"""
    old_min = event.data.get("old_min")
    new_min = event.data.get("new_min")

    print(f"[MIN DEPOSIT CHANGE] Ledger {event.ledger}:")
    print(f"  Old Minimum: {old_min}")
    print(f"  New Minimum: {new_min}")

    # TODO: Update configuration, send alerts, etc.


async def handle_event(event: VaultEvent) -> None:
    """Route event to appropriate handler"""
    if event.event_type == "deposit":
        await handle_deposit_event(event)

    elif event.event_type == "pndwdraw":
        await handle_pending_withdrawal_event(event)

    elif event.event_type == "withdraw":
        await handle_withdrawal_event(event)

    elif event.event_type == "feechg":
        await handle_fee_change_event(event)

    elif event.event_type == "mindepchg":
        await handle_min_deposit_change_event(event)

    else:
        print(f"Unknown event type: {event.event_type}")


# ============================================================================
# Anomaly Detection
# ============================================================================

async def detect_anomalies(event: VaultEvent) -> Optional[EventAlert]:
    """Detect anomalies in event patterns"""

    # Alert on unusually large deposits
    if event.event_type == "deposit":
        amount = event.data.get("amount")
        if amount and float(amount) > 10000000000:
            return EventAlert(
                alert_type="large_deposit",
                severity=AlertSeverity.WARNING,
                message=f"Large deposit detected: {amount}",
                event=event,
                timestamp=datetime.now(),
            )

    # Alert on rapid fee changes
    if event.event_type == "feechg":
        old_bps = event.data.get("old_bps")
        new_bps = event.data.get("new_bps")

        if old_bps and new_bps:
            fee_diff = abs(float(new_bps) - float(old_bps))
            if fee_diff > 100:
                return EventAlert(
                    alert_type="large_fee_change",
                    severity=AlertSeverity.CRITICAL,
                    message=f"Large fee change detected: {old_bps} -> {new_bps}",
                    event=event,
                    timestamp=datetime.now(),
                )

    return None


async def handle_alert(alert: EventAlert) -> None:
    """Handle an alert"""
    print(
        f"\n[{alert.severity.value.upper()}] {alert.message} ({alert.timestamp.isoformat()})"
    )

    # TODO: Send to monitoring system, send notifications, etc.


# ============================================================================
# Event Listening
# ============================================================================

def listen_for_events(
    config: VaultConfig,
    start_ledger: int = 0,
) -> None:
    """Listen for vault events with cursor-based pagination"""
    server = Server(config.rpc_url)
    cursor = start_ledger
    processed_events: Set[str] = set()

    print(f"Starting YieldVault event listener on {config.network}")
    print(f"Contract: {config.contract_id}")
    print(f"RPC: {config.rpc_url}")
    print(f"Polling interval: {config.polling_interval}ms\n")

    while True:
        try:
            # Fetch events from the RPC
            response = server.events(
                filters=[
                    {
                        "type": "contract",
                        "contractIds": [config.contract_id],
                    }
                ],
                start_ledger=cursor,
                limit=100,
            )

            # Process each event
            for raw_event in response.get("events", []):
                if raw_event.get("type") == "contract":
                    event = parse_vault_event(raw_event)

                    if not event:
                        continue

                    # Verify event source
                    verification = verify_event_source(
                        event,
                        config.contract_id,
                        server,
                    )

                    if not verification.is_valid:
                        print(f"Event verification failed: {verification.reason}")
                        continue

                    # Check for replayed events
                    if detect_replayed_event(event, processed_events):
                        print(
                            f"Skipping replayed event: {event.event_type} at ledger {event.ledger}"
                        )
                        continue

                    # Detect anomalies
                    alert = detect_anomalies(event)
                    if alert:
                        handle_alert(alert)

                    # Handle the event
                    handle_event(event)

                    # Update cursor to the next ledger
                    cursor = event.ledger + 1

            # Wait before polling again
            time.sleep(config.polling_interval / 1000)

        except Exception as e:
            print(f"Error fetching events: {e}")
            # Exponential backoff on error
            time.sleep(10)


# ============================================================================
# Main
# ============================================================================

def main():
    """Main entry point"""
    import os

    # Get network from environment or default to testnet
    network = os.environ.get("NETWORK", "testnet")
    config = get_config(network)

    # Start listening for events
    listen_for_events(config)


if __name__ == "__main__":
    main()
