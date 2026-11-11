#!/bin/zsh
# Local development stack: API (with the job worker inline) on 127.0.0.1:8661 and the Vite dev server on
# http://localhost:5183 (which proxies /api). Real PostgreSQL database sp_drive_dev, data under .dev/.
# Usage: scripts/dev-stack.sh [--reset]   — then: scripts/dev-invite.sh you@example.com
set -euo pipefail
cd "$(dirname "$0")/.."
PG=/opt/homebrew/opt/postgresql@17/bin
[[ "${1:-}" == "--reset" ]] && { $PG/dropdb -h 127.0.0.1 --if-exists sp_drive_dev; rm -rf .dev; }
$PG/createdb -h 127.0.0.1 sp_drive_dev 2>/dev/null || true
mkdir -p .dev
source scripts/dev-env.sh
[[ -f .dev/master.key ]] || pnpm -s exec tsx services/api/src/cli.ts init-key
pkill -f "sp-drive-dev-api" 2>/dev/null || true; pkill -f "vite.*5183" 2>/dev/null || true
(exec -a sp-drive-dev-api node --import tsx services/api/src/main.ts > .dev/api.log 2>&1) &
(cd apps/web && exec node_modules/.bin/vite --port 5183 --strictPort > ../../.dev/web.log 2>&1) &
for i in {1..60}; do curl -sf http://127.0.0.1:8661/api/v1/health/live >/dev/null && break; sleep 0.5; done
curl -sf http://127.0.0.1:8661/api/v1/health/live >/dev/null && echo "API ready on :8661, web on http://localhost:5183 (logs in .dev/)" || { echo "API did not start:"; tail -20 .dev/api.log; exit 1; }
