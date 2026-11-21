#!/bin/zsh
# =============================================================================
#                  SP BOUCHER | INFRASTRUCTURE & AUTOMATION
#             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
# =============================================================================
#
# Project          : SP Drive
# File             : apps/web/scripts/make-pwa-icons.sh
# Module           : web
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

# Regenerate the PWA icons from public/pwa/favicon.svg (same mark). Needs rsvg-convert (brew install librsvg).
#   icon-192 / icon-512      : the favicon as drawn (rounded square)
#   icon-maskable-512        : full-bleed background, mark at 85 % (its box then spans 48 % of the icon, inside the 80 % maskable safe circle)
#   apple-touch-icon (180)   : full-bleed square (iOS rounds the corners itself), mark at full size
set -euo pipefail
cd "$(dirname "$0")/../public/pwa"
defs=$(sed -E 's/^<svg[^>]*>//; s/<\/defs>.*$/<\/defs>/' favicon.svg)
mark=$(sed -E 's/^.*<\/defs>//; s/<\/svg>$//; s/<rect width="64"[^>]*\/>//' favicon.svg)
bleed() { # $1 = scale of the mark around the centre
  print -r -- "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">$defs<rect width=\"64\" height=\"64\" fill=\"url(#g)\"/><g transform=\"translate(32 32) scale($1) translate(-32 -32)\">$mark</g></svg>"
}
rsvg-convert -w 192 -h 192 favicon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 favicon.svg -o icon-512.png
bleed 0.85 | rsvg-convert -w 512 -h 512 -o icon-maskable-512.png
bleed 1 | rsvg-convert -w 180 -h 180 -o apple-touch-icon.png
ls -l *.png
