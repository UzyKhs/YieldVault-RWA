#![cfg(test)]

use crate::oracle::{
    price_data_new, price_data_scaled_price, validate_conversion_rate,
    validate_price_for_calculation, OracleValidator, DEFAULT_HEARTBEAT_SECONDS,
    MAX_PRICE_DEVIATION_BPS,
};
use crate::{YieldVault, YieldVaultClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};

fn create_token_contract<'a>(e: &Env, admin: &Address) -> token::Client<'a> {
    let token_address = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::Client::new(e, &token_address)
}

const _SCALE: i128 = 1_000_000_000_000_000_000i128;

#[test]
fn test_oracle_price_data_creation() {
    let price = price_data_new(1_000_000_000i128, 1000, 18);
    assert_eq!(price.0, 1_000_000_000i128);
    assert_eq!(price.1, 1000);
    assert_eq!(price.2, 18);
}

#[test]
fn test_price_data_scaled_18_decimals() {
    let price_data = price_data_new(1_500_000_000_000_000_000i128, 0, 18);
    assert_eq!(
        price_data_scaled_price(&price_data),
        1_500_000_000_000_000_000i128
    );
}

#[test]
fn test_price_data_scaled_high_decimals() {
    let price_data = price_data_new(2_500_000_000_000_000_000i128, 0, 36);
    assert_eq!(price_data_scaled_price(&price_data), 2i128);
}

#[test]
fn test_price_data_scaled_low_decimals() {
    let price_data = price_data_new(5_000_000i128, 0, 6);
    assert_eq!(
        price_data_scaled_price(&price_data),
        5_000_000_000_000_000_000i128
    );
}

#[test]
fn test_validate_price_valid() {
    let env = Env::default();
    let price_data = price_data_new(1_000_000_000i128, env.ledger().timestamp(), 18);
    let result = OracleValidator::validate_price_data(&env, &price_data, 3600, None, None);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 1_000_000_000i128);
}

#[test]
fn test_validate_deviation_within_bounds() {
    let env = Env::default();
    let ledger_ts = env.ledger().timestamp();
    let timestamp = ledger_ts;
    let last_price = price_data_new(1_000_000_000i128, timestamp, 18);
    let current_price = price_data_new(1_010_000_000i128, timestamp, 18);

    let result = OracleValidator::validate_price_data(
        &env,
        &current_price,
        3600,
        Some(5000),
        Some(&last_price),
    );
    match result {
        Ok(_) => assert!(true),
        Err(e) => panic!("Validation error: {:?}", e),
    }
}

#[test]
fn test_validate_price_for_calculation_valid() {
    let result = validate_price_for_calculation(1_000_000_000i128, 100i128);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 100_000_000_000i128);
}

#[test]
fn test_validate_conversion_rate_valid() {
    let result = validate_conversion_rate(1_000_000_000i128, 0i128, 2_000_000_000i128);
    assert!(result.is_ok());
}

#[test]
fn test_default_heartbeat() {
    assert_eq!(DEFAULT_HEARTBEAT_SECONDS, 3600);
}

#[test]
fn test_max_price_deviation_bps() {
    assert_eq!(MAX_PRICE_DEVIATION_BPS, 5000);
}

#[test]
fn test_oracle_config_functions() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &usdc.address);

    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);

    vault.initialize(&admin, &usdc.address);

    assert!(vault.price_oracle().is_none());
    assert!(!vault.is_oracle_enabled());
    assert_eq!(vault.oracle_heartbeat(), 3600);

    let oracle_addr = Address::generate(&env);
    vault.set_price_oracle(&oracle_addr);
    assert_eq!(vault.price_oracle(), Some(oracle_addr));

    vault.set_oracle_enabled(&true);
    assert!(vault.is_oracle_enabled());

    vault.set_oracle_heartbeat(&7200);
    assert_eq!(vault.oracle_heartbeat(), 7200);
}

#[test]
fn test_oracle_heartbeat_minimum() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &usdc.address);

    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);

    vault.initialize(&admin, &usdc.address);

    vault.set_oracle_heartbeat(&1);
    assert_eq!(vault.oracle_heartbeat(), 1);
}
