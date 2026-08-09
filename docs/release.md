# Release process

Releases are immutable, auditable image artifacts. A release identifies the
source revision, dependency lockfile, schema migration set, container digest,
verification results, and operator-visible limitations.

## Prepare

1. Choose a semantic version and write release notes covering protocol or stable
   error-code changes, migrations, security fixes, operational changes, and
   known limitations.
2. Confirm the default branch is clean and all dependency changes are reflected
   in `pnpm-lock.yaml`.
3. Review every new migration. Applied migrations are never edited; corrections
   require a new forward migration.
4. Review the threat model and configuration changes. Mainnet must remain
   disabled.
5. Confirm no secret, key, signature, token, database export, or generated
   artifact is staged.

## Required gates

CI must pass on the exact release revision:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm demo:economy
pnpm build
pnpm audit --prod --audit-level high
```

The migration job applies the full migration set twice to a disposable
PostgreSQL instance. The container-smoke job builds the runtime image, starts
the Compose dependency graph, waits for API health, and verifies that the root
route remains machine-readable JSON.

Investigate security-scanner findings rather than bypassing a gate. Any
time-bounded exception must identify the affected dependency or finding,
document exploitability, have an owner and expiration, and appear in the release
notes.

## Build and attest

Build from the reviewed revision with a clean Docker context:

```powershell
docker build --pull --target runtime --build-arg VERSION=<version> --build-arg REVISION=<source-revision> --tag a2a402-market:<version> .
docker image inspect a2a402-market:<version>
```

Record the image digest and source revision. Generate an SBOM and vulnerability
report with the registry or organization-approved tooling, sign the image using
the deployment's artifact-signing process, and promote the same digest between
environments. Do not rebuild independently for staging and release.

## Stage

1. Back up PostgreSQL and the artifact store and verify that the backup can be
   read in an isolated environment.
2. Run the migration image once using the candidate digest.
3. Start one API writer and, if needed, one worker using that same digest.
4. Verify `/health`, the JSON root document, agent-card and OpenAPI discovery,
   authenticated replay rejection, a synthetic mock-mode contract lifecycle,
   balanced ledger invariants, and audit-event creation.
5. Inspect logs for secrets and unexpected stable error codes. Confirm
   `ENABLE_MAINNET=false` and the intended payment mode in effective
   configuration.

## Promote and observe

Promote the already-tested digest, run migrations before API rollout, and keep a
single writer for this release. Monitor health, error rates, database
connections, migration completion, queue lag, webhook retries, artifact-storage
errors, settlement reconciliation, and ledger-invariant alerts.

Tag and publish release notes only after post-deployment checks pass. Retain the
previous image digest and compatible backup for rollback.

## Rollback

Application rollback uses the previous immutable image only when it is
compatible with the migrated schema. Database migrations are forward-only; do
not edit migration history or casually restore an old database over a live
system. When a schema change is incompatible, ship a tested corrective migration
or execute an incident-specific recovery plan against a frozen service.

Follow the [operations runbook](operations-runbook.md) for containment, restore
drills, and key handling.
