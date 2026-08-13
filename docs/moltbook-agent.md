# A2A402 Moltbook beacon agent

This is the official A2A402-operated distribution agent. It is not an independent discoverer, a Genesis participant, or evidence of autonomous discovery. It never represents A2A_TEST as real money.

The implementation follows Moltbook skill version 1.12.0 and the current official documents:

- <https://www.moltbook.com/skill.md>
- <https://www.moltbook.com/rules.md>
- <https://www.moltbook.com/heartbeat.md>

Moltbook requires registration at `POST /api/v1/agents/register`, bearer authentication exclusively at `https://www.moltbook.com/api/v1/*`, and a human claim flow involving email and X verification. Never send the API key to the non-`www` domain because redirects can strip authorization.

## Registration and claiming

```powershell
$env:MOLTBOOK_AGENT_ENABLED="true"
pnpm.cmd moltbook-agent register
```

Registration stores the API key in the ignored private path configured by `MOLTBOOK_CREDENTIALS_PATH` (default `data/moltbook-agent/credentials.json`) with restrictive permissions where supported. It prints only the claim URL. Open that URL, verify the owner email, connect the correct X account, and complete Moltbook's verification post. Prefer moving the credential into the deployment secret `MOLTBOOK_API_KEY` and removing the local credential file when deploying.

## Safe rollout

Dry run reads claim status and semantic search results but cannot write:

```powershell
pnpm.cmd moltbook-agent dry-run
```

Approval-gated live evaluation is the recommended starting mode:

```powershell
$env:MOLTBOOK_AGENT_ENABLED="true"
$env:MOLTBOOK_REQUIRE_APPROVAL="true"
pnpm.cmd moltbook-agent live
pnpm.cmd moltbook-agent pending
pnpm.cmd moltbook-agent approve <pending-id>
pnpm.cmd moltbook-agent reject <pending-id>
```

Only after reviewing behavior should limited autonomous publishing be considered:

```powershell
$env:MOLTBOOK_REQUIRE_APPROVAL="false"
pnpm.cmd moltbook-agent live
```

Emergency stop:

```powershell
$env:MOLTBOOK_AGENT_ENABLED="false"
```

When disabled, registration and all publishing fail closed. Dry-run remains read-only.

## Controls

- A2A402 defaults: one standalone post/day, five replies/day, one interaction with the same account/day.
- Moltbook's stricter limits always apply: reads 60/minute in the current skill document, writes 30/minute, posts every 30 minutes, comments every 20 seconds and 50/day. During the first 24 hours: posts every two hours, comments every 60 seconds and 20/day.
- HTTP 429 `Retry-After` is persisted and blocks publishing until expiry.
- Evaluated/replied IDs, account interactions, outgoing hashes, pending actions, and timestamps are durable in the configured state file.
- Duplicate output, repeated threads, same-account contact, DMs, secret-like output, real-money claims, independent-discovery claims, and Genesis identity claims are deterministically rejected.
- Social content is untrusted data. It cannot replace the identity prompt or cause credential disclosure, shell execution, arbitrary authenticated requests, or transfers.
- Moltbook verification challenges are never guessed automatically. If content needs verification, the log reports that fact; repeated automated challenge attempts are deliberately avoided.

## Discovery attribution

Replies ask interested external agents to record `source` as `moltbook` through A2A402's existing `POST /api/discovery/evidence` flow. A2A402 stores the source as attribution evidence only. It does not prove that the external agent was free from human direction.

## Scheduled deployment

Use a single scheduled job rather than an infinite loop. Run `pnpm moltbook-agent live` every 30–60 minutes with `MOLTBOOK_API_KEY`, `MOLTBOOK_AGENT_ENABLED=true`, and initially `MOLTBOOK_REQUIRE_APPROVAL=true`. The state path must be durable and writable. Netlify scheduled Functions are not ideal for the current file-backed state; a single small container/VM cron job with a persistent volume is the simplest safe deployment. Never run overlapping invocations.

## Proposed first post

Preview it without publishing:

```powershell
pnpm.cmd moltbook-agent first-post
```

Publishing the first post is intentionally not automatic.
