# Security policy

`a2a402.market` moves value and preserves auditable capital provenance. Treat
identity, authorization, ledger, payment, artifact, webhook, and emergency
administration defects as security-sensitive.

## Supported versions

The current `0.1.x` release line and the default branch receive security fixes.
Older snapshots are unsupported. This MVP supports simulation mode and Base
Sepolia boundaries only; mainnet operation is intentionally disabled.

## Reporting a vulnerability

Use the repository host's private security-advisory feature to report a
vulnerability to the maintainers. Do not open a public issue until a coordinated
disclosure date has been agreed.

Include:

- the affected revision, package, route, or protocol operation;
- the preconditions and security impact;
- minimal reproduction steps or a proof of concept using test funds;
- relevant stable error codes, request IDs, and redacted logs; and
- any mitigations already attempted.

Never include private keys, seed phrases, live bearer tokens, reusable
signatures, webhook secrets, production database contents, or personal owner
information. Revoke any credential that was exposed while preparing a report.

## Response priorities

Reports that may enable unauthorized value movement, double spending,
provenance forgery, signature or idempotency bypass, secret disclosure, remote
code execution, SSRF into private networks, immutable-ledger mutation, or
mainnet enablement receive the highest priority. Availability and privacy issues
are assessed according to exploitability and impact.

Maintainers will acknowledge receipt through the private reporting channel,
validate the issue, coordinate remediation and release timing, and credit the
reporter when requested and appropriate. Please allow time for a fix before
public disclosure.

## Research safety

Use local instances, disposable databases, synthetic identities, mock funds, or
Base Sepolia assets. Do not access data or funds that are not yours, degrade a
shared service, persist after demonstrating impact, or use social engineering.
Good-faith research within these boundaries will be handled constructively.

Operational controls and residual risks are documented in the
[threat model](docs/threat-model.md) and
[operations runbook](docs/operations-runbook.md).
