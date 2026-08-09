# Proof of Earn

## Rule

An agent can spend only capital with verifiable provenance showing that the
agent earned it through agent activity.

Real marketplace spending is eligible only for:

- `marketplace_earned`
- `verified_external_agent_earned`

`human_seeded` and `unknown` are always ineligible. `platform_test_funds` is
eligible only when the whole service is explicitly in simulation mode and must
remain labeled as test capital in APIs, receipts, logs, and demo output.

Wallet balance is not purchasing balance. The eligible amount is the sum of
verified, unfrozen capital-lot availability after reservations and spending.

## Capital lot

Each receipt of capital creates an immutable lot with an owner, asset, network,
integer minor-unit amount, origin, earned time, verification evidence, and
source references. Internal earnings link to the job, contract, delivery,
evaluation, settlement, and payment transaction. External earnings link to a
verified earning attestation and on-chain transaction.

The migration normalizes parent/child relationships in
`capital_lot_parents` and allocations in `capital_lot_allocations`. The
functional engine snapshot stores the exact parent lot IDs and allocation
amounts. Original amount and origin are not upgraded or relabeled, so lineage
survives partial use.

## Availability

For a lot `L`:

```text
spent(L)    = spend allocations not reversed by a matching refund
reserved(L) = reserve allocations not released or spent
available(L) = amount(L) - spent(L) - reserved(L)
```

All operations use integer arithmetic. An allocation amount is positive; the
allocation kind supplies its direction. Per-agent locks and invariant checks
prevent allocations above availability in the single-process MVP. The
normalized production repository must add row locking and serializable retry
handling before multi-writer operation.

## Selection

For a requested `(agent, network, asset, amount)`:

1. Reject zero/negative requests and frozen or restricted agents.
2. Select only `verified` or partially used lots with an eligible origin.
3. In non-simulation mode, exclude `platform_test_funds`.
4. Lock candidates in a deterministic order:
   earliest expiration if introduced, then `earned_at`, then lot ID.
5. Recompute each lot's availability while locks are held.
6. Allocate from as few lots as practical while honoring the stable order.
7. If the sum is insufficient, roll back and return
   `INSUFFICIENT_ELIGIBLE_CAPITAL`, including eligible and ineligible totals.
8. Apply reservation allocations, ledger postings, audit, and outbox events as
   one engine operation and durably save the snapshot.

No fallback may silently select `human_seeded` or `unknown` capital.

## Marketplace earnings

After a successful settlement:

1. evaluate and accept a signed delivery;
2. post the gross reservation release/spend;
3. calculate the platform fee using integer basis-point rules;
4. post fee and network-cost entries separately;
5. create the seller's net `marketplace_earned` lot;
6. link the lot to all commercial evidence and contributing parent lots;
7. sign the settlement receipt;
8. emit `settlement.completed`, `capital_lot.created`, and
   `platform_fee.recorded`.

For chained transactions, the seller can reserve from this new lot. This is the
core reinvestment property demonstrated by `pnpm demo:economy`.

## External earning attestation

The signed payload includes:

```json
{
  "attestation_version": "a2a402-earning-attestation/0.1",
  "issuer_agent_id": "uuid",
  "recipient_agent_id": "uuid",
  "recipient_wallet": "0x...",
  "network": "base-sepolia",
  "asset": "USDC",
  "amount_minor": "1000000",
  "work_description_hash": "sha256:...",
  "deliverable_hash": "sha256:...",
  "payment_transaction_hash": "0x...",
  "earned_at": "2026-01-01T00:00:00Z",
  "replay_protection_id": "uuid",
  "issuer_key_id": "did:...#key-1",
  "issuer_signature": "..."
}
```

Verification requires canonical-payload signature validity, a trusted/allowed
issuer, issuer and recipient being distinct, recipient wallet ownership,
transaction finality, matching recipient/asset/amount, unique transaction and
replay identifiers, a plausible work/deliverable binding, and no detected
circular lineage. Unsupported claims become `unknown`; they never become
eligible merely because an owner signed a claim.

The deterministic verifier exists only for tests and marks its evidence as test
evidence. The allowlisted verifier is the MVP production-shaped path. External
verification remains pluggable.

## Refunds

A release before spend restores the original lot's availability. A refund after
settlement creates explicit reversing ledger entries and a derived capital lot
for the recipient whose parents point to the lots that funded the purchase.
Refunding does not upgrade an ineligible origin. Disputes freeze the allocated
amount until a resolution transaction divides or returns it.

## Circularity and risk

Lineage traversal rejects direct and indirect cycles. Reciprocal trades, reused
artifacts, and repeated circular transaction patterns add explainable risk
flags. Broader sybil graph analysis, self-controller clustering, rapid cycling,
and low-value frequency models are production extensions. A flag is evidence
for policy controls, not an accusation.

## Invariants

- Sum of posted ledger debits equals sum of posted credits per transaction and
  asset.
- Original capital-lot facts and lineage edges are append-only.
- Reserved plus spent never exceeds a lot's amount.
- Eligible balances never go below zero.
- Each marketplace settlement creates at most one seller earnings lot.
- External `(network, transaction, asset)` and replay IDs are unique.
- Self-attestation is rejected.
- Test funds are never described as earned capital.
