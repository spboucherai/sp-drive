#!/bin/zsh
# Runs scripts/perf-web.mjs against a checkout: starts that checkout's API on a scratch database with its built web
# bundle, creates an account, measures, stops. Nothing of a real drive is touched (scratch database sp_drive_perf_*).
# Usage: scripts/perf-web.sh <checkout dir> <label> [port]      (the checkout must have been built: pnpm build)
set -euo pipefail
export PATH=/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH
HERE="$(cd "$(dirname "$0")/.." && pwd)"; DIR="$(cd "$1" && pwd)"; LABEL=$2; PORT=${3:-8671}
DB="sp_drive_perf_${LABEL}"; D="/tmp/spd-perf-${LABEL}"
[[ "$DB" == sp_drive_perf_* && "$PORT" != 8660 ]] || exit 2
dropdb -h 127.0.0.1 --if-exists "$DB"; createdb -h 127.0.0.1 "$DB"; rm -rf "$D"; mkdir -p "$D/data"
cd "$DIR"
export DATABASE_URL=postgres://127.0.0.1/$DB SPD_ORIGIN=http://localhost:$PORT SPD_RP_ID=localhost PORT=$PORT HOST=127.0.0.1 SPD_DATA_DIR="$D/data" SPD_MASTER_KEY_FILE="$D/master.key" SPD_INLINE_WORKER=on SPD_APP_DIR="$DIR" SPD_AV_MODE=optional SPD_CLAMD_SOCKET= SPD_WEB_DIR="$DIR/dist/web" SPD_AI_ENV_FILE="$D/ai.env" SPD_BACKUP_DIR="$D/backups"
pnpm -s exec tsx services/api/src/cli.ts init-key >/dev/null
node --import tsx services/api/src/main.ts > "$D/api.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for i in {1..80}; do curl -sf "http://127.0.0.1:$PORT/api/v1/health/live" >/dev/null && break; sleep 0.25; done
INVITE=$(pnpm -s exec tsx services/api/src/cli.ts invite --email perf@example.test | tail -1)
cd "$HERE" && node scripts/perf-web.mjs "http://localhost:$PORT" "$INVITE"
