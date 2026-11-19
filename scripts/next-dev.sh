#!/bin/zsh
# Shared development API of the 2.0 branch, on the node: its own database, data directory and throw-away master key.
# Nothing here can touch production (sp_drive, ~/sp-drive-data, ~/.config/sp-drive): the script refuses those values.
#
#   scripts/next-dev.sh start | stop | restart | status | log
#   scripts/next-dev.sh seed                 two accounts (alice = admin, bob) + sample content + bearer tokens
#   scripts/next-dev.sh token alice|bob      print a seeded bearer token
#   scripts/next-dev.sh invite <email> [--admin]   one-time invitation link (register a real passkey in a browser)
#   scripts/next-dev.sh reindex              queue the text extraction of everything not indexed yet
#
# Environment: SPD_NEXT_DATA (default ~/dev/sp-drive-next-data), SPD_NEXT_PORT (8667), SPD_NEXT_DB (sp_drive_next).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH=/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH
D=${SPD_NEXT_DATA:-$HOME/dev/sp-drive-next-data}; PORT=${SPD_NEXT_PORT:-8667}; DB=${SPD_NEXT_DB:-sp_drive_next}
[[ "$DB" != sp_drive && "$DB" != sp_drive_iostest && "$D" != "$HOME/sp-drive-data"* && "$PORT" != 8660 ]] || { echo "refused: production values"; exit 2; }
mkdir -p "$D/data"; chmod 700 "$D"
export DATABASE_URL=postgres://127.0.0.1/$DB SPD_ORIGIN=${SPD_NEXT_ORIGIN:-http://localhost:$PORT} SPD_RP_ID=localhost PORT=$PORT HOST=0.0.0.0
export SPD_DATA_DIR="$D/data" SPD_MASTER_KEY_FILE="$D/master.key" SPD_INLINE_WORKER=on SPD_APP_DIR="$PWD" SPD_AV_MODE=optional SPD_CLAMD_SOCKET= SPD_BACKUP_DIR="$D/backups"
export SPD_AI_ENV_FILE="$D/ai.env" SPD_TRUST_PROXY=127.0.0.1
[[ -d dist/web ]] && export SPD_WEB_DIR="$PWD/dist/web"
[[ -x /Users/Shared/sp-drive-tools/LibreOffice.app/Contents/MacOS/soffice ]] && export SPD_SOFFICE=/Users/Shared/sp-drive-tools/LibreOffice.app/Contents/MacOS/soffice
[[ -f "$D/extra.env" ]] && source "$D/extra.env"   # e.g. SPD_AI_EXTERNAL=on for a test
PIDF="$D/api.pid"
cli() { pnpm -s exec tsx services/api/src/cli.ts "$@"; }
running() { [[ -f "$PIDF" ]] && kill -0 "$(cat "$PIDF")" 2>/dev/null; }
stop() { if running; then kill "$(cat "$PIDF")"; for i in {1..40}; do running || break; sleep 0.25; done; fi; rm -f "$PIDF"; }
case "${1:-status}" in
  start|restart)
    stop
    createdb -h 127.0.0.1 "$DB" 2>/dev/null || true
    [[ -f "$SPD_MASTER_KEY_FILE" ]] || cli init-key >/dev/null
    zsh scripts/textkit-build.sh | tail -1
    nohup node --import tsx services/api/src/main.ts >> "$D/api.log" 2>&1 &
    echo $! > "$PIDF"
    for i in {1..80}; do curl -sf "http://127.0.0.1:$PORT/api/v1/health/live" >/dev/null && break; sleep 0.25; done
    curl -sf "http://127.0.0.1:$PORT/api/v1/meta" && echo && echo "dev API on :$PORT (pid $(cat "$PIDF"), log $D/api.log)" || { echo "did not start:"; tail -20 "$D/api.log"; exit 1; } ;;
  stop) stop; echo stopped ;;
  status) running && { echo "running (pid $(cat "$PIDF")) on :$PORT"; curl -s "http://127.0.0.1:$PORT/api/v1/meta"; echo; } || echo "not running" ;;
  log) tail -${2:-40} "$D/api.log" ;;
  seed) running || { echo "start it first"; exit 1; }; pnpm -s exec tsx scripts/dev-seed.mts "http://127.0.0.1:$PORT" "$D/tokens.json" ;;
  token) node -e 'const t = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; if (!t) process.exit(1); console.log(t.token)' "$D/tokens.json" "${2:-alice}" ;;
  invite) cli invite --email "$2" ${3:-} ;;
  reindex) cli reindex ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
