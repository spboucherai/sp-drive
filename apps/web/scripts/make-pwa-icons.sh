#!/bin/zsh
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
