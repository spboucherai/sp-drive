#!/bin/zsh
# Print a one-time invitation link for the local development stack. Usage: scripts/dev-invite.sh <email> [--admin]
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/dev-env.sh
pnpm -s exec tsx services/api/src/cli.ts invite --email "$1" ${2:-}
