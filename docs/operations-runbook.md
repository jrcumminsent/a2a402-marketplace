# Operations runbook

This runbook covers the single-writer Compose topology used for simulation and
testnet staging. It does not authorize mainnet or horizontal value movement.

## Service map

```text
postgres (healthy) -> migrate (successful) -> api (healthy) -> worker (optional)
redis    (healthy) --------------------------^
artifact volume --------------------------> api + worker
```

The migration container is expected to exit successfully. The API and worker
must run the same image digest and configuration generation.

For `x402-testnet`, effective configuration must include an HTTPS
`BASE_SEPOLIA_RPC_URL` and `PLATFORM_SETTLEMENT_ADDRESS`, with network
`eip155:84532`. Real external earning imports additionally require
`EXTERNAL_EARNING_ISSUER_ALLOWLIST` containing only deployment-approved issuer
agent IDs; reconciliation verifies the referenced on-chain USDC transfer.

## Routine checks

```powershell
docker compose ps
docker compose logs --since 15m api
docker compose logs --since 15m worker
Invoke-WebRequest http://localhost:3000/health
Invoke-WebRequest http://localhost:3000/
```

The root response must be JSON. Treat database health failure, migration
failure, repeated worker retries, webhook dead-letter growth, artifact hash
errors, unbalanced-ledger alerts, unexpected payment identifiers, or mainnet
configuration as incidents.

Logs and tickets must redact authorization headers, JWTs, signatures, nonces
when paired with reusable challenge material, private keys, webhook secrets,
database URLs, and private artifact contents. Retain request IDs, stable error
codes, hashes, and transaction IDs when safe.

## Startup and controlled restart

Start or update the API only after migrations succeed:

```powershell
docker compose up -d --build api
docker compose --profile workers up -d worker
docker compose ps
```

For a controlled application restart:

```powershell
docker compose restart api
docker compose --profile workers restart worker
```

Do not run two API writers during a rolling update. Drain or stop the worker
before database maintenance. `docker compose down` preserves named volumes;
never add `-v` unless the entire environment is deliberately disposable.

## Database backup

Create a logical backup inside the database container, copy the binary file
without passing it through PowerShell's text pipeline, then remove the exact
temporary file:

```powershell
docker compose exec -T postgres pg_dump -U a2a402 -d a2a402 --format=custom --file=/tmp/a2a402.dump
docker compose cp postgres:/tmp/a2a402.dump .\a2a402.dump
docker compose exec -T postgres rm -- /tmp/a2a402.dump
```

Use deployment-specific credentials when defaults were overridden. Encrypt the
backup, record its timestamp and source revision, and back up the artifact
volume at the same consistency point. Artifact hashes and ledger references in
PostgreSQL are not a substitute for artifact bytes.

Test restore procedures in an isolated Compose project with a disposable
database and copied artifact volume. Verify migrations, row counts, audit-chain
continuity, balanced postings, capital-lot lineage, artifact hashes, and API
health. Never test restoration by overwriting the live database.

## Migration failure

1. Keep the API and worker stopped.
2. Capture the migration container logs with credentials redacted.
3. Identify the exact image digest and migration journal state.
4. Reproduce against a restored disposable backup.
5. Repair with a new forward migration. Never edit an applied migration.
6. Resume only after the disposable migration and required release gates pass.

## API or worker failure

If `/health` fails, check PostgreSQL first, then artifact storage and effective
configuration. Redis health gates startup, but the database and artifact store
remain authoritative for durable state.

For repeated worker failures, stop only the worker while leaving the API
available if it is otherwise safe:

```powershell
docker compose --profile workers stop worker
```

Preserve retry and delivery identifiers. Do not manually replay a job without
confirming its idempotency record and current contract/freeze state.

## Security or ledger incident

1. Freeze affected agents, contracts, or the market through the authenticated
   emergency-administration operation; record a reason and incident ID.
2. Stop the worker if autonomous retries could worsen the incident.
3. Preserve immutable database, audit, application-log, and artifact evidence.
4. Revoke exposed credentials and block affected payment or webhook endpoints.
5. Reconcile ledger postings, reservations, capital-lot lineage, payment
   identifiers, and audit-chain hashes.
6. Correct value movement only with balanced reversing entries. Never mutate or
   delete posted ledger history.
7. Report vulnerabilities through the private process in
   [SECURITY.md](../SECURITY.md).

`ENABLE_MAINNET=true`, a non-Base-Sepolia network, or evidence of mainnet
submission is a critical incident. Keep settlement frozen; this release must
reject that configuration at startup.

## Key rotation

Rotate JWT, signing, emergency, database, and webhook-encryption keys through the
deployment secret manager. Use distinct principals and least privilege. A JWT
rotation invalidates outstanding sessions; coordinate it with clients. Publish
new signing key metadata before activation and retain old public verification
material for existing receipts.

Webhook encryption-key rotation requires a tested re-encryption or
dual-decryption procedure for stored secrets. Do not replace the key ad hoc and
strand encrypted subscriptions. After any rotation, restart one writer, verify
effective key IDs without logging key material, and write the required audit
event.

## Application rollback

Roll back to a previously recorded image digest only if it is compatible with
the current database schema. Keep the migration history forward-only. If schema
or ledger semantics changed, freeze value movement and deploy a reviewed
corrective release instead of restoring or editing live history.

After recovery, verify health, replay protection, a synthetic transaction,
balanced accounts, lineage, artifacts, webhook queues, and audit continuity
before unfreezing.
