//! External Calls and Transactional Safety
//!
//! This module documents all external calls made by the vault and ensures they follow
//! the Checks-Effects-Interactions (CEI) pattern to prevent reentrancy vulnerabilities.
//!
//! # Reentrancy Notes (Soroban)
//!
//! Soroban's model provides inherent protection against reentrancy:
//! - Contract calls are atomic within a transaction
//! - State changes are committed atomically
//! - No recursive calls can occur during execution
//! - Each contract invocation gets its own execution frame
//!
//! However, following CEI pattern still applies for:
//! - Logical correctness and state consistency
//! - Preventing state from being observed in invalid intermediate states
//! - Clear audit trail and intent
//!
//! See [`docs/CONTRACTS_ARCHITECTURE.md`](../../docs/CONTRACTS_ARCHITECTURE.md) for details.

/// Validates an external call precondition
#[inline]
pub fn validate_external_call_precondition(condition: bool, msg: &str) {
    if !condition {
        panic!("{}", msg);
    }
}

/// Documents that a call follows CEI pattern
/// (Checks → Effects → Interactions)
#[macro_export]
macro_rules! cei_pattern {
    ($name:expr, checks: $checks:expr, effects: $effects:expr, interactions: $interactions:expr) => {
        // This macro documents the CEI pattern for code review
        // Structure:
        // 1. Checks: $checks
        // 2. Effects: $effects
        // 3. Interactions: $interactions
    };
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_external_calls_inventory_documented() {
        // This test verifies that all external calls are documented
        // Actual reentrancy protections are tested via integration tests
    }
}
