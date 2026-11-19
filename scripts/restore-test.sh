#!/bin/zsh
# Proves a backup can be restored: loads the latest dump into a scratch database, points a scratch data directory at
# the backed-up objects, and re-hashes EVERY object after decryption (cli verify --deep). Touches nothing in production.
# Usage: scripts/restore-test.sh [backup-dir]      (run from the app directory; needs the master key)
set -euo pipefail
export PATH=/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/bin:/bin
OUT=${1:-${SPD_BACKUP_DIR:-$HOME/backups/sp-drive}}
KEY=${SPD_MASTER_KEY_FILE:-$HOME/.config/sp-drive/master.key}
DUMP=$(ls -1t "$OUT"/db/sp-drive-*.dump.enc | head -1)
SCRATCH_DB=sp_drive_restore_test
SCRATCH=$(mktemp -d /tmp/spd-restore.XXXXXX)
RESULT=false; OBJECTS=0; FILES=0
# the outcome is kept next to the backups (read by GET /api/v1/admin/system): a restore test that fails is visible
finish() { dropdb -h 127.0.0.1 --if-exists $SCRATCH_DB; rm -rf "$SCRATCH"; umask 077
  print -r -- "{\"ok\":$RESULT,\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"dump\":\"${DUMP:t}\",\"objects\":$OBJECTS,\"files\":$FILES}" > "$OUT/restore-test.json.tmp" && mv "$OUT/restore-test.json.tmp" "$OUT/restore-test.json"; }
trap finish EXIT
echo "restoring $DUMP"
dropdb -h 127.0.0.1 --if-exists $SCRATCH_DB; createdb -h 127.0.0.1 $SCRATCH_DB
openssl enc -d -aes-256-ctr -pbkdf2 -iter 200000 -pass "file:$KEY" -in "$DUMP" | pg_restore --no-owner -h 127.0.0.1 -d $SCRATCH_DB
mkdir -p "$SCRATCH/data"; ln -s "$OUT/blobs" "$SCRATCH/data/blobs"
CLI=dist/cli.mjs; RUN=(node $CLI); [[ -f $CLI ]] || RUN=(pnpm -s exec tsx services/api/src/cli.ts)
DATABASE_URL=postgres://127.0.0.1/$SCRATCH_DB SPD_DATA_DIR="$SCRATCH/data" SPD_MASTER_KEY_FILE="$KEY" SPD_ORIGIN=${SPD_ORIGIN:-https://drive.spboucher.ai} SPD_RP_ID=${SPD_RP_ID:-drive.spboucher.ai} "${RUN[@]}" verify --deep
OBJECTS=$(psql -h 127.0.0.1 -At -d $SCRATCH_DB -c 'select count(*) from storage_objects'); FILES=$(psql -h 127.0.0.1 -At -d $SCRATCH_DB -c 'select count(*) from files')
echo "files in restored metadata: $FILES"
RESULT=true
echo "RESTORE TEST OK"
