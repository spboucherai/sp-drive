#!/bin/zsh
# =============================================================================
#                  SP BOUCHER | INFRASTRUCTURE & AUTOMATION
#             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
# =============================================================================
#
# Project          : SP Drive
# File             : scripts/node-setup.sh
# Module           : scripts
# Repository       : https://git.spboucher.ai/sp-drive
# Project Website  : https://drive.spboucher.ai
# Created          : 2026-11-11
# Last Modified    : 2026-11-11
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

# One-time preparation of the node that hosts SP Drive (idempotent). Run on the node, from the app directory.
# Creates the database, the data directories, the master key, the antivirus configuration and its first signatures.
set -euo pipefail
export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/opt/homebrew/opt/postgresql@17/bin:$PATH
DATA=${SPD_DATA_DIR:-$HOME/sp-drive-data}
KEY=${SPD_MASTER_KEY_FILE:-$HOME/.config/sp-drive/master.key}
DB=$DATA/clamav-db
umask 077
mkdir -p "$DATA"/{blobs,tmp,quarantine,work,run,logs} "$DB" "$(dirname "$KEY")" "$HOME/backups/sp-drive"
chmod 700 "$DATA" "$(dirname "$KEY")" "$HOME/backups/sp-drive"
createdb -h 127.0.0.1 sp_drive 2>/dev/null || true
if [[ ! -f "$KEY" ]]; then
  head -c 32 /dev/urandom | xxd -p -c 64 > "$KEY"; chmod 600 "$KEY"
  echo "master key created: $KEY — COPY IT OFF THIS NODE NOW (without it stored files cannot be read)"
fi
for f in clamd freshclam; do sed -e "s#{{DATA}}#$DATA#g" -e "s#{{DB}}#$DB#g" infra/$f.conf.template > "$DATA/run/$f.conf"; done
[[ -f "$DB/main.cvd" || -f "$DB/main.cld" ]] || freshclam --config-file="$DATA/run/freshclam.conf" --user "$(id -un)"
echo "node ready: data $DATA, database sp_drive, signatures $(ls "$DB" | grep -c -E 'c[vl]d$') files"
