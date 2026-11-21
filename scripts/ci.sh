#!/bin/zsh
# =============================================================================
#                  SP BOUCHER | INFRASTRUCTURE & AUTOMATION
#             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
# =============================================================================
#
# Project          : SP Drive
# File             : scripts/ci.sh
# Module           : scripts
# Repository       : https://git.spboucher.ai/sp-drive
# Project Website  : https://drive.spboucher.ai
# Created          : 2026-11-19
# Last Modified    : 2026-11-19
#
# Author           : Simon-Pierre Boucher
# Position         : Professor of Finance
# Institution      : Université du Québec en Outaouais (UQO)
# Organization     : SP Boucher
# Website          : https://spboucher.ai
# Git              : https://git.spboucher.ai
#
# Preferred Contact: support@spboucher.ai
# Technical Contact: dev@spboucher.ai
# Security/Admin   : admin@spboucher.ai
#
# Copyright (c) 2026
# Simon-Pierre Boucher
# All rights reserved where applicable. This file is governed by the
# applicable project license, copyright notices and relevant law.
# Existing third-party rights and notices remain unaffected.
#
# License          : None specified (no license file in this repository)
#
# Do not embed credentials, private keys, access tokens,
# certificates or confidential personal information.
#
# =============================================================================
# END OF SP BOUCHER SOURCE HEADER
# =============================================================================

# Continuous-integration run, on the node (or any Mac with PostgreSQL 17 and ClamAV signatures):
#   1. the local text helper is built            2. every package type-checks
#   3. unit + integration suites run against a real PostgreSQL database, a real clamd and the real sandbox
#   4. the production bundles build (unless --no-build)
# Exit code 0 only when everything passed; a summary line per step is printed at the end.
# The database is a scratch one (name ending in _test, dropped and re-created); nothing of a real drive is touched.
# Usage: scripts/ci.sh [--no-build] [--only <vitest filter>]
#   SPD_TEST_DB / SPD_TEST_ROOT pick another scratch database / directory (two checkouts can run at once)
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/opt/homebrew/opt/postgresql@17/bin:$PATH
export SPD_TEST_DB=${SPD_TEST_DB:-sp_drive_test} SPD_TEST_ROOT=${SPD_TEST_ROOT:-/tmp/sp-drive-test}
[[ "$SPD_TEST_DB" == *_test ]] || { echo "ci: SPD_TEST_DB must end in _test"; exit 2; }
BUILD=1; ONLY=()
while (( $# )); do case "$1" in --no-build) BUILD=0; shift;; --only) ONLY=("$2"); shift 2;; *) echo "unknown option $1"; exit 2;; esac; done
# LibreOffice held by a pending first-launch approval hangs for ever: use the copy when there is one (docs/runbooks/operations.md)
[[ -z "${SPD_SOFFICE:-}" && -x /Users/Shared/sp-drive-tools/LibreOffice.app/Contents/MacOS/soffice ]] && export SPD_SOFFICE=/Users/Shared/sp-drive-tools/LibreOffice.app/Contents/MacOS/soffice
LOG=$(mktemp -d /tmp/spd-ci.XXXXXX)
typeset -A result; steps=(); failed=0
step() { local name=$1; shift; local t0=$(date +%s); steps+=("$name")
  if "$@" > "$LOG/$name.log" 2>&1; then result[$name]="ok    $(( $(date +%s) - t0 )) s"; else result[$name]="FAILED $(( $(date +%s) - t0 )) s  (log: $LOG/$name.log)"; failed=1; tail -40 "$LOG/$name.log"; fi; }
step install pnpm install --frozen-lockfile
step textkit zsh scripts/textkit-build.sh
step typecheck pnpm typecheck
step tests pnpm exec vitest run $ONLY
(( BUILD )) && step build pnpm build
echo; echo "── SP Drive CI · $(git rev-parse --short HEAD 2>/dev/null) · $(date '+%Y-%m-%d %H:%M') ──"
for s in $steps; do printf '  %-10s %s\n' "$s" "${result[$s]}"; done
sed $'s/\x1b\\[[0-9;]*m//g' "$LOG/tests.log" 2>/dev/null | grep -E '^ *(Test Files|Tests) ' | sed 's/^ */  /'
if (( failed )); then echo "CI FAILED"; exit 1; fi
rm -rf "$LOG"; echo "CI OK"
