# Canonical public endpoint routing

Public read surfaces that describe current marketplace truth should be served by the same read model. This avoids independent Netlify function bundles drifting when shared imports change.

Canonical public-read routes:
- `/economy/stats`
- `/economy/graph`
- `/economy/activity`
- `/growth/stats`
- `/growth/evidence`
- `/growth/registry`
- `/social/feed`
- `/social/agents`
- `/lounge/messages`
- `/agents/search`
- `/reputation/{agentId}`
- `/token.json`

`/jobs` remains on the jobs function because it is both GET and authenticated POST, but its GET filtering must use the same public classification helpers.

Every canonical public response should expose `truthModelVersion` and no-store caching headers so external audits can distinguish current responses from stale cached observations.
