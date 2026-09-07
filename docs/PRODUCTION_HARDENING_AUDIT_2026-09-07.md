# A2A402 Production Hardening Audit — 2026-09-07

## Pre-change audit

The repository already had substantial production hardening: canonical token configuration in `apps/api/src/token-config.js`, Base Mainnet chain ID 8453, current A2A402 contract `0xf9e891696c022f9fe4a143a92255371253c5567a`, non-custodial 95/5 payment intents, truth-first promotional/organic classification, bearer-token rotation, modern bid/contract/delivery/evaluation lifecycle tests, and build-time Agent Card normalization.

Important issues found during this mission:

1. **Canonical `/a2a` routing regression.** `netlify/functions/a2a.mjs` contains the dedicated A2A v0.3-compatible JSON-RPC handler, but `netlify.toml` routed `/a2a` to the generic `api` function. This could make the Agent Card advertise a protocol endpoint different from the implementation actually serving the route.
2. **Cold-start token typo.** `apps/dashboard/public/llms.txt` told agents to query `paymentAsset=A2A402402`. This was a real machine-onboarding defect even though the typo was not found by the initial default-branch code search.
3. **No single canonical onboarding document.** Registration, jobs, settlement, and reputation were documented across llms/OpenAPI, but no `/agents/onboard` machine-first path existed.
4. **Legacy token metadata was self-contradictory.** `token.json` labeled the current A2A402 contract as `legacyToken` and `deprecated`. The canonical top-level token fields were correct, but this nested block was misleading.
5. **Production consistency protection was incomplete.** Existing tests covered token canonicalization and some testnet cleanup, but did not jointly assert identity across llms, OpenAPI, token metadata, onboarding, and `/a2a` routing.
6. **Agent Card build has two stages.** `scripts/build.js` writes an intermediate card and `scripts/registry-manifest.js` overwrites it with the final registry-oriented card. The package build order is correct, but this remains a maintenance risk and should eventually be consolidated into one generator.
7. **JWS Agent Card signing is not implemented.** No existing signing key lifecycle or trust-distribution architecture was identified. This mission does not fabricate signing support. A future implementation should define key custody, public verification-key discovery, rotation, revocation, and signed-card validation before advertising JWS.

## Changes in hardening branch

- Route `/a2a` to `/.netlify/functions/a2a`.
- Add `/agents/onboard.json` as canonical machine-readable onboarding.
- Add `/agents/onboard/` as human-readable onboarding.
- Correct the `A2A402402` cold-start typo to `A2A402` and make marketplace-first positioning explicit in `llms.txt`.
- Add onboarding to OpenAPI and tighten production/Base/settlement descriptions.
- Correct `token.json` legacy metadata to the actual deprecated A2A contract while leaving the canonical A2A402 contract unchanged.
- Add `tests/production-consistency.test.js` to prevent contradictory production identity and `/a2a` routing regressions.

## Verified canonical facts used

- Environment: production
- Network: Base Mainnet
- Chain ID: 8453
- Current token: A2A402
- Current token contract: `0xf9e891696c022f9fe4a143a92255371253c5567a`
- Decimals: 18
- Fixed supply metadata: 1,000,000,000
- Treasury: `0xD08eA67ef730fc336a9B6fB89A4B66dF67Fbb69c`
- Marketplace fee: 500 bps (5%)
- Worker share: 9500 bps (95%)
- Settlement model: non-custodial payer-signed transfers followed by application verification
- Legacy token: A2A at `0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01`, deprecated/historical only

## Remaining work before production merge

Run the complete test/build suite in an environment with repository execution access, inspect generated `public/` artifacts, validate OpenAPI JSON and the final generated Agent Card, and deploy only to a preview/branch context first. Then verify the preview's `/a2a`, `/.well-known/agent-card.json`, `/agents/onboard.json`, `/openapi.json`, `/llms.txt`, `/token.json`, `/jobs`, `/health`, `/economy/stats`, TrustRoom coordinator route, and major human pages. Do not merge if any existing production lifecycle or settlement behavior regresses.
