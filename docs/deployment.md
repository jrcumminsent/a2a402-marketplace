# Deployment

The deployable artifact is one Node.js image containing the API, background
worker, and database migration entrypoints. Docker Compose supplies PostgreSQL,
Redis, a durable local artifact volume, health gates, and a one-shot migration
service.

The current release is suitable for local development and single-writer
simulation or testnet staging. It is not a production real-value deployment:
mainnet is disabled, live x402 settlement fails closed at the workflow boundary,
local artifact storage is single-node, and the runtime still persists an engine
snapshot rather than dual-writing every normalized table.

## Local Compose

Copy the example environment file, then build and start the API:

```powershell
Copy-Item .env.example .env
docker compose up -d --build api
docker compose ps
Invoke-WebRequest http://localhost:3000/health
Invoke-WebRequest http://localhost:3000/
```

On a POSIX shell, use `cp .env.example .env` and `curl --fail` for the health
requests. Compose starts PostgreSQL and Redis, waits for both to become healthy,
runs all database migrations once, then starts the API. The API binds to
`127.0.0.1:3000` by default.

The development Compose defaults deliberately use mock payments and a
development-only JWT secret. Replace every secret before exposing the service
outside the local machine.

To start the optional background worker:

```powershell
docker compose --profile workers up -d worker
```

The worker is disabled in the API container and enabled only in its dedicated
container. Both containers use the same database and artifact volume. Configure
`WEBHOOK_SECRET_ENCRYPTION_KEY` before creating encrypted webhook subscriptions;
there is intentionally no default for it.

Stop the stack without deleting persistent data:

```powershell
docker compose down
```

Named PostgreSQL, Redis, and artifact volumes remain intact. Adding `-v` deletes
that data and is appropriate only for an intentionally disposable environment.

## Environment boundaries

`DATABASE_URL`, `REDIS_URL`, `APP_BASE_URL`, and `PUBLIC_MARKET_URL` in
`.env.example` are for processes launched directly on the host. Compose uses the
corresponding `COMPOSE_*` variables because containers reach dependencies by
service DNS names.

Node does not automatically load `.env` for `pnpm dev`, `pnpm db:migrate`, or
other host commands. Export the variables into that shell or use an approved
environment loader. For example:

```powershell
$env:DATABASE_URL = "postgresql://a2a402:a2a402_local_only@localhost:5432/a2a402"
$env:REDIS_URL = "redis://localhost:6379"
$env:JWT_SECRET = "<unique-development-secret-of-at-least-32-characters>"
docker compose up -d postgres redis
pnpm db:migrate
pnpm dev
```

## Image entrypoints

Build the immutable runtime image:

```powershell
docker build --target runtime --tag a2a402-market:local .
```

The included commands are:

```text
API:       node dist/apps/api/server.js
Worker:    node dist/apps/api/worker.js
Migration: node dist/packages/database/src/migrate.js
```

Workspace packages are bundled into each entrypoint. Third-party runtime
dependencies and the SQL migration directory are included in the image.

## Staging configuration

Use a managed secret store or deployment-native secret injection rather than
committing `.env`. At minimum, set:

```text
NODE_ENV=production
APP_BASE_URL=https://<internal-or-public-api-origin>
PUBLIC_MARKET_URL=https://<canonical-market-origin>
DATABASE_URL=<TLS PostgreSQL URL>
REDIS_URL=<TLS Redis URL when the provider supports it>
JWT_SECRET=<unique random value of at least 32 characters>
SIGNING_PRIVATE_KEY=<deployment-owned private key>
SIGNING_KEY_ID=<published key identifier>
ADMIN_EMERGENCY_KEY=<separately controlled emergency key>
WEBHOOK_SECRET_ENCRYPTION_KEY=<deployment-owned encryption key>
PAYMENTS_MODE=mock
ALLOW_SIMULATION_MODE=true
ENABLE_MAINNET=false
EXTERNAL_EARNING_ISSUER_ALLOWLIST=<comma-separated approved issuer IDs>
```

`PAYMENTS_MODE=mock` in `NODE_ENV=production` requires the explicit
`ALLOW_SIMULATION_MODE=true` acknowledgement. `x402-testnet` additionally
requires `PLATFORM_SETTLEMENT_ADDRESS` and an HTTPS `BASE_SEPOLIA_RPC_URL`, but
workflow settlement remains fail-closed in this release. Any mainnet network or
`ENABLE_MAINNET=true` is rejected at startup.

Terminate TLS at a trusted ingress, keep PostgreSQL and Redis off the public
network, restrict egress for artifact/webhook fetches, and preserve the
container's non-root user, dropped capabilities, and read-only application
artifact. The local artifact volume must be backed up together with PostgreSQL;
a database-only restore is incomplete.

Before any horizontal or multi-writer deployment, implement and verify the
normalized serializable repository and row-locking coordinator described in the
[architecture](architecture.md). See the [operations runbook](operations-runbook.md)
for backup, rollback, and incident procedures.
