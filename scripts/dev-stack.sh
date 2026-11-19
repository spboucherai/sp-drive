#!/bin/zsh
# Local development stack: API (with the job worker inline) on 127.0.0.1:8661 and the Vite dev server on
# http://localhost:5183 (which proxies /api). Real PostgreSQL database sp_drive_dev, data under .dev/.
# Usage: [SPD_DEV_AI=fake] scripts/dev-stack.sh [--reset | --stop]   — then: scripts/dev-invite.sh you@example.com
set -euo pipefail
cd "$(dirname "$0")/.."
PG=/opt/homebrew/opt/postgresql@17/bin
[[ "${1:-}" == "--reset" ]] && { $PG/dropdb -h 127.0.0.1 --if-exists sp_drive_dev; rm -rf .dev; }
$PG/createdb -h 127.0.0.1 sp_drive_dev 2>/dev/null || true
mkdir -p .dev
source scripts/dev-env.sh
# LibreOffice held by a pending first-launch approval hangs for ever: use the copy when there is one (as scripts/ci.sh does)
[[ -z "${SPD_SOFFICE:-}" && -x /Users/Shared/sp-drive-tools/LibreOffice.app/Contents/MacOS/soffice ]] && export SPD_SOFFICE=/Users/Shared/sp-drive-tools/LibreOffice.app/Contents/MacOS/soffice
[[ -f .dev/master.key ]] || pnpm -s exec tsx services/api/src/cli.ts init-key
# SPD_DEV_AI=fake: a fake OpenAI-compatible endpoint (scripts/fake-llm.mjs — not a model) stands in for the local
# provider, so the AI screens and their end-to-end tests have something to talk to. Without it, AI is off.
if [[ "${SPD_DEV_AI:-}" == fake ]]; then
  print -r -- $'SPD_AI_MACLUSTR_URL=http://127.0.0.1:8669/v1\nSPD_AI_MACLUSTR_KEY=dev-fake\nSPD_AI_MACLUSTR_MODEL=fake-qwen\nSPD_AI_MACLUSTR_MODELS=fake-qwen|Faux Qwen (test)|Alibaba, fake-mistral|Faux Mistral (test)|Mistral AI' > .dev/ai.env
else rm -f .dev/ai.env; fi
# Stop a previous run by PID file (never by name pattern: the node is shared with other stacks).
stop() { for f in .dev/api.pid .dev/web.pid .dev/llm.pid; do [[ -f $f ]] && kill "$(cat $f)" 2>/dev/null || true; rm -f $f; done; }
stop; [[ "${1:-}" == "--stop" ]] && { echo stopped; exit 0; }
[[ "${SPD_DEV_AI:-}" == fake ]] && { nohup node scripts/fake-llm.mjs 8669 > .dev/llm.log 2>&1 & echo $! > .dev/llm.pid; }
nohup node --import tsx services/api/src/main.ts > .dev/api.log 2>&1 &
echo $! > .dev/api.pid
(cd apps/web && nohup node node_modules/vite/bin/vite.js --port 5183 --strictPort > ../../.dev/web.log 2>&1 & echo $! > ../../.dev/web.pid)
for i in {1..60}; do curl -sf http://127.0.0.1:8661/api/v1/health/live >/dev/null && break; sleep 0.5; done
curl -sf http://127.0.0.1:8661/api/v1/health/live >/dev/null && echo "API ready on :8661, web on http://localhost:5183 (logs in .dev/)" || { echo "API did not start:"; tail -20 .dev/api.log; exit 1; }
