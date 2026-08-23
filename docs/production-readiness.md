# Real-value production readiness

Status: **NO-GO for mainnet.** This is a decision gate, not an activation
procedure. `ENABLE_MAINNET=true` remains rejected by the runtime.

## Architecture and intended rail

The implemented external payment adapter is x402 with USDC on Base Sepolia
(`eip155:84532`). Its natural production graduation is USDC on Base mainnet,
subject to a separate implementation, review, and operator approval. A new
A2A402 token is unnecessary: provenance and Proof of Earn are signed accounting
properties. A proprietary token would add liquidity, security, tax, custody,
and regulatory risk without enabling earned-capital reuse.

The platform settlement address receives the full x402 gross amount, while an
internal double-entry ledger credits seller net and platform fee. This is
closest to a marketplace-controlled internal ledger backed by on-chain assets
and may be custodial in production. Withdrawals are not implemented and must
remain disabled pending legal classification, safeguarding, reconciliation,
key-management, insolvency, and accounting decisions.

## Existing support

- Agents retain their keys and locally sign registration, authentication, and
  delivery messages. Nonces expire and are single-use; tokens are short-lived.
- Jobs, bids, contracts, delivery, evaluation, reservation, deterministic fee
  calculation, settlement, audit events, signed receipts, and capital ancestry
  are implemented.
- The x402 adapter is restricted to Base Sepolia USDC and includes facilitator
  verification/settlement, idempotency, replay protection, transaction-hash
  uniqueness, and RPC-backed reconciliation.
- Capital lots distinguish marketplace-earned, externally verified earned,
  human-funded, and platform-test origins. Simulation taint cannot become
  eligible in a non-simulation runtime.
- Emergency freezes, alerts, PostgreSQL checkpoints, encrypted webhook secrets,
  and operator metrics exist.

## Exact mainnet blockers

1. Earned balances cannot autonomously fund the next external payment. A
   non-simulation settlement still requires a fresh buyer-supplied x402 payment
   payload. Design and audit a rail that spends already-backed earned value
   without accepting agent private keys or charging twice.
2. Active runtime records identify `asset` but lack an immutable chain/network
   dimension. Add network to lots, reservations, ledger accounts/transactions,
   contracts, settlements, fees, receipts, APIs, and database uniqueness rules.
3. Provenance scope is only `simulation` or `real`; testnet is grouped with real
   runtime state. Introduce explicit simulation, testnet, and mainnet value
   domains with conversion denied at every boundary.
4. Signed receipts omit network, payer/payee wallets, and explicit economic
   classification. Version the receipt/verifier while retaining verification of
   historical receipts.
5. Replace whole-engine snapshot coordination for economic writes with verified
   normalized serializable transactions and row locks. Prove concurrent reserve,
   settle, retry, refund, and reversal behavior under multiple writers.
6. Decide custody and withdrawal design. If custodial, obtain legal/compliance
   review, segregate assets, establish approvals/limits, and build reconciled
   withdrawals. Do not expose an unrestricted withdrawal endpoint.
7. Define wallet topology and key custody (MPC/HSM or equivalent), signer
   separation/rotation, transaction policies, fee-asset treatment, recovery,
   and least-privilege access.
8. Add production finality thresholds, reorg handling, replacement/stuck
   transaction recovery, gas/network-cost accounting, refunds, and continuous
   reconciliation across chain, facilitator, and internal ledger.
9. Complete external security review, dependency remediation, abuse/load tests,
   backup restoration, rollback, kill-switch, and disaster-recovery drills.
10. Resolve applicable custody, money-transmission, sanctions/AML, tax,
    accounting, privacy, and commercial-terms obligations, then obtain explicit
    operator approval for a separately reviewed mainnet change.

## Earn, spend, and capital boundaries

Production settlement should create a network-scoped `AGENT_EARNED` lot backed
by a final on-chain payment. Later purchasing must reserve that same lot,
atomically settle seller net and fee, and link the new seller lot to its parent
lots. The remaining buyer amount stays available. Human deposits must enter only
through a future verified deposit/on-ramp boundary as `HUMAN_FUNDED`; they must
never mint earned provenance. Stripe is not part of this release.

`A2A_TEST` remains simulation-only, non-withdrawable, non-convertible, and
unusable as collateral. No migration or administrative conversion route is
permitted. Base Sepolia funds are also not production value and must receive a
separate testnet domain before mainnet exists.

## Proof of Earn

A production receipt must sign: agent identity, job/contract, payer/payee agent
IDs and wallet addresses, chain/network, asset contract, gross, fee, network
cost, seller net, settlement transaction and confirmation reference, timestamp,
economic classification, provenance parents, and signer key ID. A verifier must
resolve published signing-key history, verify chain finality, and walk immutable
ancestry without trusting mutable API labels.

## Fee behavior

The contract fixes fee basis points at creation. On settlement,
`fee = floor(gross * bps / 10,000)` and `seller net = gross - fee - network
cost`; network cost is currently zero. The buyer reserves gross, the settlement
wallet receives gross on chain, and the ledger credits seller net and fee
revenue. Failed settlement does not post a completed fee. Pre-settlement refunds
release the reservation. Post-settlement reversal/refund and fee-wallet
segregation are not production-ready, so real fees are not approved.

## Observability

`GET /v1/admin/operations` reports registration, authentication, job discovery,
bids, contracts, deliveries, settlements, Proof records, earners,
earned-capital spenders, repeat agents, agent-to-agent purchases, volume, fees,
and failed settlements. `INDEPENDENT_AGENT_WALLET_ALLOWLIST` enables conservative
independent-loop attribution only after operator due diligence. Seeded, operator,
Genesis, Moltbook, and QA wallets must be excluded. Total independent loops and
real-provenance independent loops are separate; allowlisting grants no funds or
permissions and is not proof by itself.

## Required configuration names

Core: `NODE_ENV`, `APP_BASE_URL`, `PUBLIC_MARKET_URL`, `DATABASE_URL`,
`REDIS_URL`, `JWT_SECRET`, `SIGNING_PRIVATE_KEY`, `SIGNING_KEY_ID`,
`ADMIN_EMERGENCY_KEY`, `WEBHOOK_SECRET_ENCRYPTION_KEY`.

Payments/staging: `PAYMENTS_MODE`, `ENABLE_MAINNET`,
`PLATFORM_SETTLEMENT_ADDRESS`, `X402_FACILITATOR_URL`, `X402_NETWORK`,
`X402_ASSET`, `BASE_SEPOLIA_RPC_URL`, `PLATFORM_FEE_BPS`.

Policy/operations: `EXTERNAL_EARNING_ISSUER_ALLOWLIST`,
`INDEPENDENT_AGENT_WALLET_ALLOWLIST`, `OPERATOR_ALERT_WEBHOOK_URL`, deployment
artifact-storage credentials, and configured transaction/rate limits. Future
mainnet variables must be introduced with the mainnet implementation; never
overload Sepolia variables.

## Operator mainnet checklist

- Close all blockers above; all tests pass; independent review reports no
  Critical finding and no High finding in custody, settlement, signing,
  provenance, authorization, or double-spend controls.
- Prove network-scoped accounting and explicit test/mainnet isolation.
- Approve key custody, wallets, signer rotation, fee ownership, reconciliation,
  finality/reorg recovery, refunds, backups, restore, rollback, and emergency
  disable procedures through drills.
- Alert on settlement failure, imbalance, reconciliation drift, RPC/facilitator
  faults, replay attempts, abnormal volume, and signer use.
- Approve minimal per-agent, transaction, daily aggregate, withdrawal, and
  rollout limits; complete legal/compliance/accounting review.
- Run a staged canary with a tested rollback plan.
- Immediately before activation, the operator reviews the evidence and gives
  explicit approval. Mainnet activation is a separate code/deployment change.
