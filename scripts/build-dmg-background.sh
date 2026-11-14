#!/bin/sh
# Generates the macOS DMG background (build/dmg/background.png + @2x).
# Solid icon green (#1f4d2b) with headline, footer, curved white arrow and
# short-line sparkles around the tree (left icon position).
# White pills sit behind the Finder and app icon labels (black)
# so the app/folder names stay readable on the dark green.
#
# Regenerate with: sh scripts/build-dmg-background.sh
# Requires ImageMagick (`magick`) and macOS system fonts.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/dmg"
# SFNS.ttf is Apple's San Francisco
# (System Font, i.e. system-ui as in the app).
# ImageMagick only reads the first face of a .ttc/.ttf (Regular),
# so the headline fakes SF Semibold with a 1px (2px at 2x) stroke.
FONT_REGULAR="/System/Library/Fonts/SFNS.ttf"
mkdir -p "$OUT"

# --- 1x: 660x460 logical points ---
# Icon centers:
# (must match dmg.contents in electron-builder.yml, where y is measured from the top, matching image coordinates)
#   left (tree) (165,185), right (Applications) (495,185), icon size 80.
# No sparkles below the tree: the app-name label sits there.
magick -size 660x460 "xc:#1f4d2b" \
    -font "$FONT_REGULAR" -fill white -stroke white -strokewidth 1 -pointsize 26 -gravity north \
    -annotate +0+30 "Plant your next browser" \
    -stroke none -fill "rgba(255,255,255,0.75)" -pointsize 14 -gravity south \
    -annotate +0+170 "Drag the tree into the Applications folder" \
    -fill white -stroke none \
    -draw "roundrectangle 123,228 207,254 13,13" \
    -draw "roundrectangle 440,228 550,254 13,13" \
    -stroke white -strokewidth 5 -fill none \
    -draw "stroke-linecap round line 120,159 104,150" \
    -draw "stroke-linecap round line 147,136 141,119" \
    -draw "stroke-linecap round line 178,135 183,117" \
    -draw "stroke-linecap round line 205,152 219,140" \
    -draw "stroke-linecap round line 120,211 104,220" \
    -strokewidth 7 \
    -draw "path 'M 225,183 Q 330,123 425,171'" \
    -fill white -stroke none \
    -draw "polygon 436,176 404,176 418,150" \
    "$OUT/background.png"

# --- 2x: 1320x920 for Retina (dmg-builder combines via tiffutil) ---
magick -size 1320x920 "xc:#1f4d2b" \
    -font "$FONT_REGULAR" -fill white -stroke white -strokewidth 2 -pointsize 52 -gravity north \
    -annotate +0+60 "Plant your next browser" \
    -stroke none -fill "rgba(255,255,255,0.75)" -pointsize 28 -gravity south \
    -annotate +0+340 "Drag the tree into the Applications folder" \
    -fill white -stroke none \
    -draw "roundrectangle 246,456 414,508 26,26" \
    -draw "roundrectangle 880,456 1100,508 26,26" \
    -stroke white -strokewidth 10 -fill none \
    -draw "stroke-linecap round line 240,318 208,300" \
    -draw "stroke-linecap round line 294,272 282,238" \
    -draw "stroke-linecap round line 356,270 366,234" \
    -draw "stroke-linecap round line 410,304 438,280" \
    -draw "stroke-linecap round line 240,422 208,440" \
    -strokewidth 14 \
    -draw "path 'M 450,366 Q 660,246 850,342'" \
    -fill white -stroke none \
    -draw "polygon 872,352 808,352 836,300" \
    "$OUT/background@2x.png"

echo "Wrote $OUT/background.png and $OUT/background@2x.png"
