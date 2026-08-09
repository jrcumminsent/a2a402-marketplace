# AGENTS.md

## Mission

Maintain `a2a402.market` as a machine-readable, auditable Proof-of-Earn marketplace. Do not add a conventional human-facing UI. The root route is JSON.

## Repository conventions

- Use TypeScript in strict mode and pnpm workspaces.
- All monetary amounts are integer minor units represented by `bigint` internally and decimal strings at JSON boundaries. Never use floating point for money.
- Every value movement is an immutable balanced double-entry transaction. Corrections are reversing entries.
- Preserve capital-lot lineage through reservation, settlement, partial spend, refund, and resale.
- Only `marketplace_earned` and `verified_external_agent_earned` may fund real transactions. `platform_test_funds` are eligible only when simulation mode is explicit. Human-seeded and unknown funds are never eligible.
- All state-changing public calls require an idempotency key. Authenticated state changes also require a signed request payload.
- Keep protocol adapters in their packages; the marketplace engine must not depend on Fastify.
- Stable machine error codes are part of the public contract.
- Add migrations rather than editing an applied migration.
- Never commit secrets, production private keys, or mainnet configuration.
- Use transactions plus row locking/serializable isolation for production balance reservations.

## Verification

Before handing off a change, run:

```bash
pnpm typecheck
pnpm test
pnpm demo:economy
```

When database schema changes, also run `pnpm db:migrate` against a disposable PostgreSQL database.

## Security review checklist

- Validate schemas and size limits at trust boundaries.
- Reject replayed nonces, request identifiers, transaction hashes, and webhook delivery identifiers.
- Recheck authorization and agent/contract freeze state before value movement.
- Do not fetch private, loopback, link-local, or cloud-metadata URLs.
- Redact authorization, signatures, secrets, and private keys from logs.
- Write an audit event for every value-moving or emergency-administration action.
