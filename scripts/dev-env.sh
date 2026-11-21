# =============================================================================
#                  SP BOUCHER | INFRASTRUCTURE & AUTOMATION
#             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
# =============================================================================
#
# Project          : SP Drive
# File             : scripts/dev-env.sh
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

# Environment of the local development stack (sourced by dev-stack.sh and dev-invite.sh). No secret here.
export DATABASE_URL=postgres://127.0.0.1/sp_drive_dev SPD_ORIGIN=http://localhost:5183 SPD_RP_ID=localhost PORT=8661 HOST=127.0.0.1
export SPD_DATA_DIR="$PWD/.dev/data" SPD_MASTER_KEY_FILE="$PWD/.dev/master.key" SPD_INLINE_WORKER=on SPD_APP_DIR="$PWD"
export SPD_AV_MODE=${SPD_AV_MODE:-optional} SPD_CLAMD_SOCKET=${SPD_CLAMD_SOCKET:-/tmp/sp-drive-test/clamd.sock}
# AI providers are read from the stack's own file, never from the node's ~/.config/sp-drive/ai.env (that is production's).
export SPD_AI_ENV_FILE="$PWD/.dev/ai.env"
