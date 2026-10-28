#!/bin/sh
# One iteration of the #167 drawing loop for one figure:
#   fmt -> lint --geometry -> render SVG + PDF -> PNG preview (pdftoppm).
# Usage (from the repository root):
#   sh research/167-stage-c/render.sh research/167-stage-c/figures/a-transformer.sumi.yaml [dpi]
# Writes <figure>.svg / .pdf / .png under research/167-stage-c/out/ (ignored,
# not committed) and a reduced copy previews/<figure>.png (committed).
# Needs pdftoppm (Poppler) and magick (ImageMagick).
set -eu
fig="$1"
dpi="${2:-200}"
here="$(dirname "$0")"
name="$(basename "$fig" .sumi.yaml)"
out="$here/out"
mkdir -p "$out" "$here/previews"
sumi="bun src/cli/index.ts"
$sumi fmt "$fig" >/dev/null
$sumi lint --geometry "$fig" || true
$sumi render "$fig" -o "$out/$name.svg" >/dev/null 2>&1 || true
$sumi render "$fig" -o "$out/$name.pdf" || true
pdftoppm -r "$dpi" -png -singlefile "$out/$name.pdf" "$out/$name"
# keep the committed previews small (< 150KB): 64 colours
magick "$out/$name.png" -colors 64 "$here/previews/$name.png"
ls -l "$here/previews/$name.png" | awk '{print $5, $9}'
