#!/bin/zsh
# =============================================================================
#                  SP BOUCHER | INFRASTRUCTURE & AUTOMATION
#             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
# =============================================================================
#
# Project          : SP Drive
# File             : scripts/textkit-build.sh
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

# Compile the local text-extraction helper (infra/textkit/main.swift → dist/spd-textkit). Idempotent; needs only the
# Command Line Tools (/usr/bin/swiftc). Run on the node from the app directory, after every change to the Swift source.
# Without the binary the API still works: content indexing is limited to text and Office families and reports it.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=infra/textkit/main.swift
OUT=${1:-dist/spd-textkit}
[[ -x /usr/bin/swiftc ]] || { echo "textkit: /usr/bin/swiftc missing (xcode-select --install) — OCR and PDF text extraction stay off"; exit 0; }
mkdir -p "$(dirname "$OUT")"
if [[ -x "$OUT" && "$OUT" -nt "$SRC" ]]; then echo "textkit: up to date ($OUT)"; exit 0; fi
/usr/bin/swiftc -O -swift-version 5 -o "$OUT.tmp" "$SRC"
mv "$OUT.tmp" "$OUT"
"$OUT" probe >/dev/null && echo "textkit: built $OUT"
