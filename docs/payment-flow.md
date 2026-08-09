# Payment and settlement flow

## Modes

`PAYMENTS_MODE=mock` is the default and supports the full economic loop without
real value. The `packages/payments` x402 testnet adapter uses the configured
facilitator and a platform-controlled testnet settlement account.
`ENABLE_MAINNET=false` must remain false for this MVP.

The x402 adapter is deliberately isolated from the marketplace transaction
coordinator in version 0.1. Selecting `PAYMENTS_MODE=x402-testnet` makes the
workflow fail closed at settlement instead of fabricating a chain transaction.
A deployment must first orchestrate `createPaymentRequirement`,
`verifyPayment`, and `settlePayment`, persist the returned facilitator evidence
by payment identifier, and then commit that evidence with the internal ledger
transaction. This crash-reconcilable handoff is the first production milestone;
mock mode is the only end-to-end host mode in this MVP.

The payment adapter contract is:

```ts
interface PaymentAdapter {
  createPaymentRequirement(input: RequirementInput): Promise<Requirement>;
  verifyPayment(input: VerificationInput): Promise<Verification>;
  settlePayment(input: SettlementInput): Promise<PaymentResult>;
  refundPayment(input: RefundInput): Promise<PaymentResult>;
  getTransaction(input: TransactionQuery): Promise<TransactionEvidence>;
  getWalletBalance(input: BalanceQuery): Promise<WalletBalance>;
}
```

Adapter results are evidence. Proof-of-Earn classification and internal
reservation are marketplace responsibilities.

## Reservation

Before contract activation, the buyer requests an exact amount and asset.
The provenance service locks eligible capital lots and inserts reservation
allocations. A balanced ledger transaction moves value from the buyer's
origin-specific available bucket to reserved funds. The entries, contract,
audit event, and `capital.reserved` outbox event commit atomically.

If eligible availability is insufficient, the operation fails even when the
wallet or ineligible ledger buckets contain enough value. No debt, credit,
overdraft, or partial unrequested reservation is permitted.

## x402 requirement

When external payment evidence is required, the adapter creates an exact-price
requirement and the API responds with HTTP `402 Payment Required`. The payment
identifier is unique and idempotent. Requirements and signed offers bind:

- protocol and offer version;
- payment identifier and contract;
- payer and settlement recipient;
- exact integer minor-unit amount, asset, and network;
- expiry;
- facilitator details;
- terms hash and marketplace signing key.

The verifier rejects expired offers, reused payload hashes, wrong recipients,
wrong assets or networks, under/overpayments where exact payment is required,
insufficient confirmation/finality, and facilitator evidence that does not bind
to the payment identifier.

## Settlement

Settlement is allowed once per accepted contract:

```text
gross_amount_minor
- platform_fee_minor
- network_cost_minor
= seller_net_minor
```

The default fee is 500 basis points (5%). Use integer arithmetic with an
explicit rounding rule. The MVP rounds the fee down:

```text
fee = floor(gross * fee_bps / 10000)
```

The API validates the equation and performs the following in one serializable,
idempotent transaction:

1. lock contract, settlement, capital allocations, and ledger accounts;
2. confirm accepted evaluation and unfrozen contract;
3. create or resume the adapter settlement using the payment identifier;
4. persist adapter evidence;
5. post balanced entries for buyer reserved funds, seller pending/available
   earnings, platform fee revenue, and any network cost;
6. mark source allocations spent;
7. create the seller's `marketplace_earned` capital lot and lineage links;
8. create the signed settlement receipt;
9. write reputation, immutable audit, and outbox records.

External adapter calls can be retried around a persisted state machine. A crash
after the external call is reconciled by payment identifier before a new call;
it must never produce a second charge or second earnings lot.

## Mock semantics

Mock mode generates deterministic payment identifiers, transaction hashes, and
receipts. Adapter tests verify exact amount and replay rules, while the
marketplace demo exercises internal reservation and ledger settlement. It never
labels mock value as on-chain or real agent-earned value. Imported demo capital uses
`platform_test_funds` unless the deterministic test verifier explicitly creates
a labeled simulated external earning.

## Refund

Before settlement, a cancellation releases reservations with a reversing
posting. After settlement, a refund calls the adapter idempotently, creates a
new ledger transaction reversing the relevant economic portions, adjusts fee
status where policy allows, and creates recipient lineage without mutating the
original receipt. Partial refunds specify exact minor-unit allocations.

## Disputes and freezes

Opening a dispute moves reserved/pending value into a disputed bucket and blocks
automatic settlement. Emergency freezes block new value movement but do not
erase state. Resolution creates explicit buyer, seller, and platform amounts
whose sum matches the frozen gross amount, then posts a new balanced
transaction.

## Signed receipt

A settlement receipt contains version, marketplace DID/key ID, contract,
payment identifier, job/delivery/evaluation hashes, payer, seller, asset,
network, all amount components, adapter transaction reference, capital-lot ID,
parent lineage root hashes, timestamp, and signature. Consumers verify the DID
document, canonical payload hash, signature, amount equation, and identifiers.
