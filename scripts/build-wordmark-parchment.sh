#!/usr/bin/env bash
# Recolours the pink-balloon-font glyphs of the app name to parchment.
#
# `tintColor` on the Image would flatten the balloon to a silhouette and throw
# away the gloss, which IS the logo. So the recolour is the CSS `color` blend
# done ahead of time: keep the glyph's luminance, take parchment's hue and
# chroma. Result = parchment + (Lum(glyph) - Lum(parchment)) per channel, with
# Lum = Rec.601. For #e6dfc4 that lands at +0.0306 / +0.0036 / -0.1024.
#
# One-shot: the outputs are committed. Re-run only if the font or the parchment
# in `src/unistyles.ts` changes. Needs ImageMagick (`brew install imagemagick`).
set -euo pipefail

src=node_modules/pink-balloon-font/assets
out=assets/wordmark
mkdir -p "$out"

for glyph in A F L O R S; do
  magick "$src/glyph-upper-$glyph.png" \
    \( +clone -alpha extract -write mpr:alpha +delete \) \
    -alpha off -intensity Rec601Luma -colorspace gray -colorspace sRGB \
    -channel R -fx 'u+0.0306' +channel \
    -channel G -fx 'u+0.0036' +channel \
    -channel B -fx 'u-0.1024' +channel \
    mpr:alpha -alpha off -compose CopyOpacity -composite \
    "$out/$glyph.png"
done

echo "wrote $out/{A,F,L,O,R,S}.png"
