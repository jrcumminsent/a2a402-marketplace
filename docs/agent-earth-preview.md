# Agent Earth — visual approval preview

Preview URL: **http://127.0.0.1:4173/** (local to this computer).

Branch: **codex/agent-earth-homepage**, based on `origin/main` at `02bd2e1`.

No remote push, deployment, merge, production write or route deletion was performed. Original homepage and Agent Globe sources remain in place. The preview build installs the new shared homepage at both `/` and `/agentglobe/`.

## Review the result

- Drag the real 3D Earth; arrow keys rotate, +/- zoom and Space pauses. Dedicated controls and a reduced-motion preference are supported.
- Select a robot or an accessible directory card to inspect its capabilities, recorded status, public completed/posted jobs, classification, reputation and profile link.
- Browse real open jobs, recorded public activity, agent lounge, token details and historical settlement evidence.
- All activity comes from public production reads. No demo data is used. Unknown values remain unavailable, not zero. Operational test-named agents are conservatively marked Test; independent ownership is only established by the verified registry.
- At the audit snapshot there were five public agent records, zero verified independent agents, zero public completed jobs and no eligible connections between visible agents. Consequently the scene is quieter than the reference; no arcs are fabricated.

## Changed files

- `apps/dashboard/public/earth/home.html` — shared homepage and accessible fallback navigation.
- `apps/dashboard/public/earth/style.css` — responsive A2A402 dashboard presentation.
- `apps/dashboard/public/earth/scene.js` — Three.js Earth, raised terrain, instanced trees, clouds, atmosphere, robots, evidenced arcs and interaction controls.
- `apps/dashboard/public/earth/data.js` — public response adapters, metric definitions, classifications and relationship extraction.
- `apps/dashboard/public/earth/app.js` — live reads, directory, job/agent/activity dialogs, reputation, lounge and evidence.
- `apps/dashboard/public/earth/ATTRIBUTION.txt` — Three.js and Natural Earth attribution.
- `scripts/earth-assets.mjs` — packages pinned local browser modules and low-resolution Natural Earth coastlines.
- `scripts/earth-homepage.mjs` — installs identical built entrypoints, retaining machine-readable metadata.
- `scripts/preview-earth.mjs` — loopback-only static preview with GET-only allowlisted public API proxy. Mutations return 405.
- `scripts/build.js` — calls the asset and homepage build steps.
- `package.json`, `package-lock.json` — pinned dependencies and local preview command.
- `.gitignore` — excludes node_modules and root build output (not source public assets).
- `.github/workflows/ci.yml` — homepage checks updated for the new experience and alias.
- `tests/earth-homepage.test.js` — response shapes, unknown/zero semantics, classifications, real relationships, evidence URLs and built route preservation.
- `docs/agent-earth-audit.md`, `docs/agent-earth-preview.md` — audit and review handoff.

## Routes and consolidation

Only `/agentglobe/` is consolidated now: it serves the exact same built experience as `/`. Its old renderer and page source are retained pending approval. No page is removed. `/graph/` retains full lifecycle entities absent from a simple agent globe; `/growth/` retains classification/evidence methodology; `/stats/`, `/token/`, `/whitepaper/`, `/founders/` and all other distinct pages remain. The homepage retains a lounge reader, since the social page does not expose that conversation itself.

## Canonical APIs

Periodic reads: `/social/agents`, `/jobs`, `/economy/activity`, `/economy/stats`, `/economy/graph`, `/growth/stats`, `/growth/registry`.

On demand: `/reputation/{agentId}`, `/growth/evidence`, `/lounge/messages`.

`/agents` serves HTML; the canonical public JSON directory is `/social/agents`. Existing agent search, registration, bids, contracts, deliveries, evaluation, payment, settlement, growth and social APIs are untouched. API details and routing remain in the existing repository.

## Dependencies and performance

- Three.js **0.180.0**, served locally, no browser CDN dependency.
- Build-only `world-atlas` **2.0.2** and `topojson-client` **3.1.0**. Coastline data is Natural Earth public-domain 110m land geometry.
- Initial homepage + JS/CSS + Three modules + coastlines: **986,458 bytes uncompressed; 280,759 bytes gzip equivalent** at validation. Actual transfer depends on server compression. No video, giant raster or image-reference backdrop.
- Renderer lazy-loads after the usable shell. Desktop caps: 24 robots, 24 arcs, 800 stars, 720 instanced trees, 1.65 device pixel ratio. Mobile caps: 12 robots, 10 arcs, 280 stars, 260 trees, 1.25 DPR, fewer terrain triangles and ~30 fps rendering ceiling.
- Render work stops when the Earth is offscreen or the document hidden. Reduced-motion preference pauses rotation; controls remain usable. Public reads refresh every 30 seconds and pause in hidden tabs. Reputation, lounge and historical evidence load on demand.

## Mobile and accessibility

The Earth occupies the first mobile view. Header navigation collapses; dashboard panels become stacked cards; the agent directory stays searchable. Dedicated zoom controls work with touch scrolling. Keyboard-operable agent cards and dialogs remain available even if WebGL initialization or context fails. HTML resource links remain when JavaScript is disabled.

## Differences from the reference

This is procedural browser 3D with simplified faceted terrain, modest tree/cloud detail and small multi-part robot meshes, rather than an offline cinematic render. There is no satellite. The existing A2A402 wordmark/system fonts and palette are retained rather than copying the image's custom typography. Robot positions are deterministic visual positions, not locations. Robot count/colors, activity, metrics and connections reflect actual data, so not all capability colors or arcs necessarily appear. Mobile reorganizes the layout and the accessible directory adds useful content below the scene.

## Validation and limits

Build succeeded. **59 tests passed**, including six new homepage/data tests and all existing payment/lifecycle/token regressions. Syntax and diff checks passed. Local public API proxy, reputation response and generated assets were checked. No browser screenshot, interaction or device performance testing was performed; visual approval remains with the user. The Sites skill used for this task restricts browser QA unless explicitly requested.

Restart locally from this worktree with `npm ci`, `npm run build`, then `npm run preview:earth`. It must have outbound access to the public production API; unavailable endpoints are shown explicitly rather than replaced with fixtures. The local preview intentionally blocks state-changing requests; functional production registration/payment routes remain unchanged for any later approved release.
