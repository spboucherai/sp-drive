#!/bin/zsh
# =============================================================================
#                  SP BOUCHER | INFRASTRUCTURE & AUTOMATION
#             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
# =============================================================================
#
# Project          : SP Drive
# File             : scripts/backup.sh
# Module           : scripts
# Repository       : https://git.spboucher.ai/sp-drive
# Project Website  : https://drive.spboucher.ai
# Created          : 2026-11-11
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

# Nightly backup: a dump of the metadata plus an incremental copy of the encrypted objects. The objects are already
# sealed (AES-256-GCM); the dump is sealed here with the master key, so a backup directory alone reveals nothing.
# The master key itself is NOT in the backup: it must be kept separately (see docs/runbooks/operations.md).
#
# Since 2.0 the script also keeps, next to the copy:
#   manifest.tsv  one line per sealed object: relative path, size, SHA-256 of the sealed file (grown incrementally)
#   status.json   what the last run did (read by GET /api/v1/admin/system and by scripts/backup-verify.sh)
set -euo pipefail
export PATH=/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/bin:/bin
DATA=${SPD_DATA_DIR:-$HOME/sp-drive-data}
KEY=${SPD_MASTER_KEY_FILE:-$HOME/.config/sp-drive/master.key}
OUT=${SPD_BACKUP_DIR:-$HOME/backups/sp-drive}
STAMP=$(date +%Y%m%d-%H%M)
STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ); T0=$(date +%s)
umask 077; mkdir -p "$OUT/db" "$OUT/blobs"
status() { print -r -- "$1" > "$OUT/status.json.tmp" && mv "$OUT/status.json.tmp" "$OUT/status.json"; }
# a run that stops half-way says so: the administration view shows the failure instead of yesterday's success
TRAPZERR() { status "{\"ok\":false,\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"startedAt\":\"$STARTED\",\"error\":\"backup stopped before the end (see the sp-drive-backup log)\"}"; }
# 1. objects first, then metadata: every object the dump references is already in the copy
rsync -a "$DATA/blobs/" "$OUT/blobs/"
DUMP="sp-drive-$STAMP.dump.enc"
pg_dump --format=custom "$DATABASE_URL" | openssl enc -aes-256-ctr -pbkdf2 -iter 200000 -pass "file:$KEY" -out "$OUT/db/$DUMP"
[[ -s "$OUT/db/$DUMP" ]] || { echo "empty dump"; false; }
ls -1t "$OUT"/db/sp-drive-*.dump.enc | tail -n +31 | xargs -I{} rm -f {}
# 2. manifest of the sealed objects: only files not listed yet are hashed, entries of files that left the copy are dropped
MAN="$OUT/manifest.tsv"; touch "$MAN"
(cd "$OUT/blobs" && find . -type f | sed 's#^\./##' | LC_ALL=C sort) > "$OUT/.files.now"
cut -f1 "$MAN" | LC_ALL=C sort > "$OUT/.files.known"
LC_ALL=C comm -23 "$OUT/.files.now" "$OUT/.files.known" | while IFS= read -r f; do
  print -r -- "$f"$'\t'"$(stat -f %z "$OUT/blobs/$f")"$'\t'"$(shasum -a 256 "$OUT/blobs/$f" | cut -d' ' -f1)"
done >> "$MAN"
LC_ALL=C sort -t $'\t' -k1,1 "$MAN" | LC_ALL=C join -t $'\t' - "$OUT/.files.now" > "$MAN.tmp" && mv "$MAN.tmp" "$MAN"
rm -f "$OUT/.files.now" "$OUT/.files.known"
# 3. optional second copy on another machine (SPD_BACKUP_REMOTE=host:path, reachable by ssh from a login session)
REMOTE=null
if [[ -n "${SPD_BACKUP_REMOTE:-}" ]]; then
  if rsync -a -e "ssh -o BatchMode=yes -o ConnectTimeout=15" "$OUT/" "$SPD_BACKUP_REMOTE/"; then REMOTE='{"ok":true}'; echo "remote copy ok"; else REMOTE='{"ok":false}'; echo "remote copy FAILED"; fi
fi
BLOBS=$(wc -l < "$MAN" | tr -d ' ')
BLOB_BYTES=$(awk -F'\t' '{ n += $2 } END { printf "%.0f", n }' "$MAN")
status "{\"ok\":true,\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"startedAt\":\"$STARTED\",\"durationS\":$(( $(date +%s) - T0 )),\"dump\":\"$DUMP\",\"dumpBytes\":$(stat -f %z "$OUT/db/$DUMP"),\"dumpSha256\":\"$(shasum -a 256 "$OUT/db/$DUMP" | cut -d' ' -f1)\",\"dumpsKept\":$(ls -1 "$OUT"/db/sp-drive-*.dump.enc | wc -l | tr -d ' '),\"blobs\":$BLOBS,\"blobBytes\":$BLOB_BYTES,\"remote\":$REMOTE}"
echo "{\"level\":\"info\",\"msg\":\"backup done\",\"dump\":\"$DUMP\",\"blobs\":$BLOBS}"
