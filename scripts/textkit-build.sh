#!/bin/zsh
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
