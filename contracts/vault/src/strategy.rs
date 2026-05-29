use soroban_sdk::{contractclient, Address, Env};

/// Strategy connector trait for pluggable yield strategies.
///
/// Implementations of this trait allow the vault to interact with different
/// yield-generating strategies (e.g., BENJI fund tokens, Korean debt instruments).
///
/// See [`docs/CONTRACTS_ARCHITECTURE.md`](../../docs/CONTRACTS_ARCHITECTURE.md) for details.
#[contractclient(name = "StrategyClient")]
pub trait StrategyTrait {
    /// Deposits an amount of the underlying asset into the strategy.
    fn deposit(env: Env, amount: i128);

    /// Withdraws an amount of the underlying asset from the strategy.
    fn withdraw(env: Env, amount: i128);

    /// Returns the total value of assets held by the strategy (including accrued yield).
    fn total_value(env: Env) -> i128;

    /// Returns the address of the underlying asset (e.g., USDC).
    fn asset(env: Env) -> Address;
}
