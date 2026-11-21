#!/bin/zsh
# =============================================================================
#                  SP BOUCHER | INFRASTRUCTURE & AUTOMATION
#             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
# =============================================================================
#
# Project          : SP Drive
# File             : scripts/backup-verify.sh
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

# Checks a backup set without restoring it (minutes, not hours; scripts/restore-test.sh is the full proof):
#   1. the latest sealed dump is the file the backup wrote (SHA-256 from status.json) and, when the master key is at
#      hand, it decrypts into a PostgreSQL archive whose table of contents reads completely;
#   2. a sample of sealed objects (the newest ones and random ones) still hashes to what the manifest recorded, and
#      — on the node itself — to the live object in the blob store.
# Works on the node and on an off-node copy (no master key there: --no-key). Writes a small JSON status file the API
# reports (verify.json on the node, offnode.json for an off-node copy). Read-only for everything else.
#
# Usage: scripts/backup-verify.sh [backup-dir] [--sample N] [--no-key] [--write verify.json|offnode.json] [--label text]
set -uo pipefail
export PATH=/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/bin:/bin
OUT=${SPD_BACKUP_DIR:-$HOME/backups/sp-drive}; SAMPLE=25; USE_KEY=1; WRITE=verify.json; LABEL=$(hostname -s)
while (( $# )); do case "$1" in
  --sample) SAMPLE=$2; shift 2;; --no-key) USE_KEY=0; shift;; --write) WRITE=$2; shift 2;; --label) LABEL=$2; shift 2;;
  -*) echo "unknown option $1"; exit 2;; *) OUT=$1; shift;; esac; done
[[ "$WRITE" == verify.json || "$WRITE" == offnode.json ]] || { echo "--write takes verify.json or offnode.json"; exit 2; }
KEY=${SPD_MASTER_KEY_FILE:-$HOME/.config/sp-drive/master.key}
LIVE=${SPD_DATA_DIR:-$HOME/sp-drive-data}/blobs
MAN="$OUT/manifest.tsv"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
errors=(); dumpOk=false; sampled=0; mismatched=0; missing=0; liveChecked=0
json_str() { print -rn -- "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
DUMP=$(ls -1t "$OUT"/db/sp-drive-*.dump.enc 2>/dev/null | head -1)
if [[ -z "$DUMP" ]]; then errors+=("no dump in $OUT/db")
else
  want=$(sed -n 's/.*"dumpSha256":"\([0-9a-f]\{64\}\)".*/\1/p' "$OUT/status.json" 2>/dev/null)
  wantName=$(sed -n 's/.*"dump":"\([^"]*\)".*/\1/p' "$OUT/status.json" 2>/dev/null)
  got=$(shasum -a 256 "$DUMP" | cut -d' ' -f1)
  hashOk=false
  if [[ -n "$want" && "$wantName" == "${DUMP:t}" ]]; then
    if [[ "$want" == "$got" ]]; then hashOk=true; else errors+=("the dump ${DUMP:t} does not hash to what the backup recorded"); fi
  fi
  if (( ${#errors} )); then :
  elif (( USE_KEY )); then
    if [[ ! -r "$KEY" ]]; then errors+=("master key not readable (use --no-key on an off-node copy)")
    elif n=$(openssl enc -d -aes-256-ctr -pbkdf2 -iter 200000 -pass "file:$KEY" -in "$DUMP" 2>/dev/null | pg_restore --list 2>/dev/null | grep -c 'TABLE DATA'); (( n > 10 )); then dumpOk=true
    else errors+=("the dump ${DUMP:t} does not decrypt into a readable PostgreSQL archive"); fi
  # without the key the recorded hash is the only proof: no hash for THIS dump means the dump was not checked
  elif $hashOk; then dumpOk=true
  else errors+=("the dump ${DUMP:t} could not be checked: status.json records no hash for it (copy incomplete, or made by a backup older than 2.0)"); fi
fi
if [[ ! -s "$MAN" ]]; then [[ -d "$OUT/blobs" && -n "$(find "$OUT/blobs" -type f -print -quit)" ]] && errors+=("no manifest.tsv (written by scripts/backup.sh since 2.0)")
else
  # the newest objects (most likely to be half-copied) and a random draw from the rest
  { (cd "$OUT/blobs" 2>/dev/null && ls -1t */*/* 2>/dev/null | head -5); awk -v n="$SAMPLE" -v seed="$RANDOM" 'BEGIN { srand(seed) } { if (rand() < 2) a[NR] = $1 } END { for (i = 0; i < n && NR > 0; i++) print a[int(rand() * NR) + 1] }' "$MAN"; } | LC_ALL=C sort -u > "$OUT/.sample"
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    line=$(awk -F'\t' -v f="$f" '$1 == f { print $2 "\t" $3; exit }' "$MAN")
    [[ -n "$line" ]] || continue # newer than the manifest: the next backup lists it
    sampled=$((sampled + 1))
    if [[ ! -f "$OUT/blobs/$f" ]]; then missing=$((missing + 1)); continue; fi
    h=$(shasum -a 256 "$OUT/blobs/$f" | cut -d' ' -f1)
    if [[ "$h" != "${line#*$'\t'}" || "$(stat -f %z "$OUT/blobs/$f")" != "${line%%$'\t'*}" ]]; then mismatched=$((mismatched + 1)); continue; fi
    if [[ -f "$LIVE/$f" ]]; then liveChecked=$((liveChecked + 1)); [[ "$(shasum -a 256 "$LIVE/$f" | cut -d' ' -f1)" == "$h" ]] || mismatched=$((mismatched + 1)); fi
  done < "$OUT/.sample"
  rm -f "$OUT/.sample"
  (( missing )) && errors+=("$missing sampled objects are missing from the copy")
  (( mismatched )) && errors+=("$mismatched sampled objects do not match the manifest")
fi
ok=true; (( ${#errors} )) && ok=false
errJson=$(for e in $errors; do print -rn -- "\"$(json_str "$e")\","; done)
OUTJSON="{\"ok\":$ok,\"at\":\"$NOW\",\"host\":\"$(json_str "$LABEL")\",\"dump\":\"${DUMP:t}\",\"dumpChecked\":$dumpOk,\"dumpHashMatched\":${hashOk:-false},\"dumpDecrypted\":$([[ $USE_KEY == 1 && $dumpOk == true ]] && echo true || echo false),\"sampled\":$sampled,\"liveCompared\":$liveChecked,\"mismatched\":$mismatched,\"missing\":$missing,\"objects\":$( [[ -f "$MAN" ]] && wc -l < "$MAN" | tr -d ' ' || echo 0),\"errors\":[${errJson%,}]}"
umask 077; print -r -- "$OUTJSON" > "$OUT/$WRITE.tmp" && mv "$OUT/$WRITE.tmp" "$OUT/$WRITE"
print -r -- "$OUTJSON"
$ok && echo "BACKUP VERIFY OK" || { echo "BACKUP VERIFY FAILED"; exit 1; }
