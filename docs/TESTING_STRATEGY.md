# YieldVault-RWA Testing Strategy

This document defines how testing is split across unit, integration, and end-to-end scopes in YieldVault-RWA. It is intended to make ownership, fixture placement, and expected coverage consistent across the frontend, backend, and smart contract layers.

## Principles

- Keep tests close to the code they validate.
- Use the smallest scope that can prove the behavior.
- Promote shared fixtures only when multiple tests in the same layer use them.
- Reserve full user-journey tests for cross-screen or cross-service flows.

## Test Layers

| Layer | Primary purpose | Owned by | Typical locations | Primary commands |
| --- | --- | --- | --- | --- |
| Unit | Pure logic, rendering branches, validation, math, and state reducers/hooks | The feature owner | `frontend/src/**/*.test.ts(x)`, `backend/src/__tests__/**/*.test.ts`, `contracts/vault/src/*_tests.rs`, `contracts/vault/src/test.rs` | `cd frontend && npm run test:run`, `cd backend && npm test`, `cargo test -p vault` |
| Integration | Module-to-module behavior, HTTP handlers, provider wiring, contract scenarios with real Soroban test env | The service or feature owner | `backend/src/__tests__/*.test.ts`, `frontend/src/tests/*.test.tsx`, `frontend/src/components/*.test.tsx`, `frontend/src/pages/*.test.tsx`, `contracts/vault/src/test.rs` | Same commands as unit, plus focused suite runs |
| E2E | Real browser journeys through the running app | The frontend feature owner, with backend support when the journey crosses APIs | `frontend/e2e/*.spec.ts` | `cd frontend && npm run test:e2e` |

## Ownership Rules

- Frontend unit and component tests are owned by the UI feature owner. They should validate hooks, components, routing branches, and accessibility states.
- Backend tests are owned by the API or platform feature owner. They should validate request handling, middleware, error formatting, and service boundaries.
- Contract tests are owned by the contract feature owner. They should validate Soroban state transitions, authorization, share math, and event emission.
- E2E tests are owned by the product surface owner for the flow being validated. If a journey spans frontend and backend, the frontend owner coordinates the path and the backend owner supplies deterministic API behavior.

## Fixture Strategy

### Frontend

- Keep small test doubles inline when only one test uses them.
- Put repeated browser fixtures in `frontend/e2e/fixtures.ts`.
- Prefer local mock factories in the test file for component and hook suites.
- Use shared mock data only when it keeps multiple specs aligned on the same domain model.

### Backend

- Build request fixtures inside the test file unless they are reused across multiple suites.
- Prefer explicit seed helpers over hidden global state.
- Use `supertest` against the Express app for request/response coverage.
- Mock external services at the boundary and keep the mock shape aligned with the production contract.

### Contracts

- Use `Address::generate` and `setup_vault`-style helpers to create isolated environments.
- Keep contract setup helpers in the test module that owns the behavior.
- Prefer helper functions for repeated token minting, vault setup, and assertion setup.

## Coverage Expectations By Feature Type

| Feature type | Required coverage | Optional coverage | Notes |
| --- | --- | --- | --- |
| Pure utility or math helper | Unit tests only | Property-based tests when input space is large | Cover normal, edge, and failure cases.
| React hook or presentational component | Unit tests for state and rendering | Integration test when the component depends on a provider or routing context | Verify loading, success, and error states.
| Form or wizard flow | Unit tests for step logic | Integration test for the full local flow | Use E2E only when the journey includes real navigation or wallet/browser behavior.
| Backend route, middleware, or service | Unit tests for validation and branching | Integration tests with `supertest` and seeded state | Cover failure handling and response shape.
| Smart contract behavior | Contract unit tests in Rust | Scenario-style contract integration tests in the same suite | Cover authorization, state transitions, and accounting invariants.
| Cross-screen product journey | E2E | None | Use Playwright for the canonical browser path.

## What Belongs In Each Layer

### Unit

Use unit tests for deterministic behavior that does not need a real browser, RPC server, database, or wallet extension. Examples:

- Formatting helpers, validations, and calculators.
- Hook state transitions and rendering branches.
- Backend sanitizers, rate-limit helpers, and middleware guards.
- Contract arithmetic, access control checks, and invariant math.

### Integration

Use integration tests when more than one local module must cooperate but the full browser journey is still unnecessary. Examples:

- Backend routes that require middleware, request parsing, and seeded state.
- Frontend components that need router, query client, or context providers.
- Contract scenarios that stand up a full Soroban environment and exercise multiple contract calls.

### E2E

Use E2E tests only for user journeys that must prove the app works in a real browser. Examples:

- Wallet connection and reconnect flows.
- Deposit, withdraw, and dashboard journeys that span multiple screens.
- Regression checks for browser-only behavior such as focus handling or browser storage.

## Recommended Commands

- Frontend unit and integration: `cd frontend && npm run test:run`
- Frontend browser journeys: `cd frontend && npm run test:e2e`
- Cypress smoke checks, when specifically needed: `cd frontend && npm run test:cypress`
- Backend tests: `cd backend && npm test`
- Contract tests: `cargo test -p vault`

## Review Checklist

- The test scope matches the behavior under change.
- Fixtures live in the narrowest place that still keeps the tests readable.
- Cross-layer behavior has at least one deterministic integration test.
- Browser-only flows have at least one Playwright test.
- New feature work adds coverage in the layer that owns the behavior, not just in the widest suite.
