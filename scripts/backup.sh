#!/bin/zsh
# Nightly backup: a dump of the metadata plus an incremental copy of the encrypted objects. The objects are already
# sealed (AES-256-GCM); the dump is sealed here with the master key, so a backup directory alone reveals nothing.
# The master key itself is NOT in the backup: it must be kept separately (see docs/runbooks/operations.md).
set -euo pipefail
export PATH=/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/bin:/bin
DATA=${SPD_DATA_DIR:-$HOME/sp-drive-data}
KEY=${SPD_MASTER_KEY_FILE:-$HOME/.config/sp-drive/master.key}
OUT=${SPD_BACKUP_DIR:-$HOME/backups/sp-drive}
STAMP=$(date +%Y%m%d-%H%M)
umask 077; mkdir -p "$OUT/db" "$OUT/blobs"
# 1. objects first, then metadata: every object the dump references is already in the copy
rsync -a "$DATA/blobs/" "$OUT/blobs/"
pg_dump --format=custom "$DATABASE_URL" | openssl enc -aes-256-ctr -pbkdf2 -iter 200000 -pass "file:$KEY" -out "$OUT/db/sp-drive-$STAMP.dump.enc"
[[ -s "$OUT/db/sp-drive-$STAMP.dump.enc" ]] || { echo "empty dump"; exit 1; }
ls -1t "$OUT"/db/sp-drive-*.dump.enc | tail -n +31 | xargs -I{} rm -f {}
# 2. optional second copy on another machine (SPD_BACKUP_REMOTE=host:path, reachable by ssh from a login session)
if [[ -n "${SPD_BACKUP_REMOTE:-}" ]]; then rsync -a -e "ssh -o BatchMode=yes -o ConnectTimeout=15" "$OUT/" "$SPD_BACKUP_REMOTE/" && echo "remote copy ok"; fi
echo "{\"level\":\"info\",\"msg\":\"backup done\",\"dump\":\"sp-drive-$STAMP.dump.enc\",\"blobs\":$(find "$OUT/blobs" -type f | wc -l | tr -d ' ')}"
