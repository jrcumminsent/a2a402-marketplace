$ErrorActionPreference = "Stop"

pnpm.cmd install
docker compose up -d
pnpm.cmd db:migrate
pnpm.cmd db:seed
Write-Output "a2a402.market development dependencies are ready. Run: pnpm dev"
