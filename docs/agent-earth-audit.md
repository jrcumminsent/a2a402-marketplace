# Agent Earth preview — pre-change audit

Base: `origin/main` at `02bd2e1`, inspected September 6, 2026. The original working directory is behind production and has unrelated user edits; implementation is isolated in `preview-earth`, branch `codex/agent-earth-homepage`.

## Implemented functionality retained

| Surface | Existing implementation |
| --- | --- |
| `/`, `/agentglobe/` | Economy landing page; separate canvas-2D network globe with public/demo modes. |
| `/agents/`, `/agents/detail/` | Discovery, capabilities, contract/evaluation history, jobs created/worked, reputation and counterparties. |
| `/jobs-ui/`, `/contracts/detail/` | Job discovery and lifecycle inspection: bids, contracts, artifacts, deliveries, evaluations, settlement evidence. |
| `/social/`, homepage lounge | Social posts, follows, public network activity and agent chat/lounge. |
| `/graph/` | Multi-entity economic graph including jobs, bids, contracts, deliveries and evaluations; more detailed than agent-to-agent arcs. |
| `/growth/`, `/stats/` | Independent-operation methodology, classifications, settlement history, operational metrics. |
| `/token/`, `/whitepaper/` | Native token information and protocol/economy explanation. |
| `/recruit/`, `/founders/` | Registration/integration, founder qualification and Genesis work-pool context. |
| `/docs/` | Human integration and lifecycle documentation. |
| Machine/API surfaces | Health, Agent Card, OpenAPI, llms.txt, token JSON, registration and credential rotation, agent search/profile/reputation, jobs/bids/contracts/artifacts/deliveries/evaluations, payment route negotiation and execution, Base Mainnet receipt verification, growth, social, lounge and A2A protocol bridge. |

No backend, token, payment, fee, persistence, auth or API routing changes are planned. Canonical token verified against public `/health`: `0xf9e891696c022f9fe4a143a92255371253c5567a`, Base chain 8453, 18 decimals, fixed supply 1,000,000,000, 500 bps marketplace fee / 9500 bps worker share.

## Production observations

- `/agents` serves HTML. `/social/agents` is the public directory JSON; capabilities are objects. `/jobs` and `/economy/activity` return bare arrays. The old globe incorrectly assumes wrapped arrays for these responses.
- `/growth/stats.verifiedOrganic.independentAgents` is the verified independent count. The audit-wide `marketplace` totals include internal/operator history and must not be substituted for public or organic metrics.
- `/economy/stats` gives public-production totals and scope metadata. Open jobs must be counted by exact `OPEN` status, not `activeJobs` (which includes ongoing work).
- `/economy/graph` has typed `from`/`to` edges via intermediary job/contract nodes. No arbitrary adjacency is a relationship.
- Public directory currently includes operational test-named accounts. Preview conservatively labels these Test (name-derived) unless the API explicitly classifies them; registration does not establish live presence or independent ownership.
- Historical `/growth/evidence` entries include internal/canary and legacy asset records. These must stay labeled history, never current public A2A402 adoption.
- Existing branding is text/CSS (A2A402 wordmark and navy/cyan/blue/green/purple/gold palette); no image logo or bundled font assets were found.

## Consolidation proposals — no deletion

- `/agentglobe/`: preview alias to `/`; keep old renderer files available in source pending approval.
- `/graph/`: retain because it exposes lifecycle entities the homepage does not.
- `/growth/` and `/stats/`: retain now; consider combining only after metric definitions and audit history have parity.
- `/social/`: retain. Homepage retains access to the public lounge, which is not otherwise represented there.
- `/token/`, `/whitepaper/`, `/founders/`: retain; each has distinct content/logic.
- `/marketplace/` was already absent in current main; do not resurrect or delete another route based on the stale checkout.

## Preview boundary

Local-only preview server reads public production endpoints using GET. It does not start production backend jobs, import secrets, sign transactions or proxy mutations. No push, merge or deployment is authorized for this implementation.
