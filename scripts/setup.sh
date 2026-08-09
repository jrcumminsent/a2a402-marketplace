#!/usr/bin/env sh
set -eu

pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed
printf '%s\n' "a2a402.market development dependencies are ready. Run: pnpm dev"
