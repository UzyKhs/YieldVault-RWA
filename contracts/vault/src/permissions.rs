//! Permission Matrix and Access Control
//!
//! This module defines the authorization requirements for all vault operations.
//!
//! See [`docs/CONTRACTS_ARCHITECTURE.md`](../../docs/CONTRACTS_ARCHITECTURE.md) for the full
//! permission matrix and security model.

use soroban_sdk::Address;

/// Verifies that the caller is the admin
///
/// # Examples
///
/// ```ignore
/// require_admin_auth(&env, &admin)?;
/// ```
pub fn require_admin_auth(admin: &Address) {
    admin.require_auth();
}

/// Verifies that the caller is an authorized address
pub fn require_caller_auth(caller: &Address) {
    caller.require_auth();
}

/// Verifies that the caller is a specific strategy (external call validation)
pub fn require_strategy_auth(caller: &Address, expected_strategy: &Address) {
    caller.require_auth();
    assert_eq!(caller, expected_strategy, "unauthorized strategy");
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_permission_matrix_documentation_exists() {
        // This test documents that the permission matrix is defined
        // Actual enforcement is tested in lib.rs via role gating tests
    }
}
