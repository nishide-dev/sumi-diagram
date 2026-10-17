#!/usr/bin/env bash
# #19 research: copies a small, curated set of outputs into results/ (committed):
# reports, the svg2pdf PoC PDFs, two PPTX PoCs and labelled comparison sheets.
# Run after render-inputs.ts, pdf.ts, pptx.ts and (macOS) validate-pptx.ts.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/out"
RES="$HERE/results"
FONT="$HERE/../../assets/fonts/biz-ud-gothic/BIZUDPGothic-Regular.ttf"
mkdir -p "$RES"

cp "$OUT/pdf/report.json" "$RES/pdf-report.json"
[ -f "$OUT/pptx/report.json" ] && cp "$OUT/pptx/report.json" "$RES/pptx-report.json"
for id in system-architecture decision-flow ja-review; do
  cp "$OUT/pdf/$id.0.pdf" "$RES/$id.svg2pdf.pdf"
done
cp "$OUT/pptx/ja-review.native.pptx" "$OUT/pptx/ja-review.native-glued.pptx" "$OUT/pptx/ja-review.image.pptx" "$RES/"
# Control cases (pptx.ts --controls): PNG-vs-SVG and the minimal connector files.
for f in "$OUT"/pptx/ja-review.image-control.pptx "$OUT"/pptx/control.*.pptx; do
  [ -f "$f" ] && cp "$f" "$RES/"
done

sheet() { # sheet <out.png> <cols> <label:file>...
  local out="$1" cols="$2"
  shift 2
  local args=()
  for item in "$@"; do args+=(-label "${item%%:*}" "${item#*:}"); done
  magick montage -font "$FONT" -pointsize 14 "${args[@]}" -tile "${cols}x" -geometry +6+6 \
    -resize 900x900\> -colors 64 "$out"
}

P="$OUT/pdf/system-architecture"
sheet "$RES/pdf-system-architecture.png" 2 \
  "Chrome (SVG reference):$P.reference.png" "svg2pdf PoC (bundled TTF):$P.0.png" \
  "svg2pdf-cli (system fonts, dpi 72):$P.2.png" "rsvg-convert on macOS (CoreText fallback):$P.3.png" \
  "Inkscape 1.4 (fill=transparent → black):$P.4.png" "Chrome print-to-PDF:$P.5.png"
P="$OUT/pdf/ja-review"
sheet "$RES/pdf-ja-review.png" 4 \
  "Chrome (SVG reference):$P.reference.png" "svg2pdf PoC:$P.0.png" "svg2pdf-cli:$P.2.png" "Chrome PDF:$P.5.png"
if [ -f "$OUT/pptx/ja-review.native.powerpoint.png" ]; then
  P="$OUT/pptx/ja-review"
  sheet "$RES/pptx-ja-review-powerpoint.png" 4 \
    "SVG reference:$OUT/pdf/ja-review.reference.png" "(a) SVG image:$P.image.powerpoint.png" \
    "(b1) native, freeform edges:$P.native.powerpoint.png" "(b2) native, glued connectors:$P.native-glued.powerpoint.png"
  P="$OUT/pptx/system-architecture"
  sheet "$RES/pptx-system-architecture-powerpoint.png" 1 \
    "(b1) native, freeform edges:$P.native.powerpoint.png" "(b2) native, glued connectors:$P.native-glued.powerpoint.png"
fi
if [ -f "$OUT/pptx/ja-review.image-control.powerpoint.png" ]; then
  sheet "$RES/pptx-png-fallback-control.png" 3 \
    "PNG fallback in image-control.pptx:$OUT/pptx/ja-review.control.png" \
    "PowerPoint: image-control.pptx:$OUT/pptx/ja-review.image-control.powerpoint.png" \
    "PowerPoint: image.pptx:$OUT/pptx/ja-review.image.powerpoint.png"
fi
if [ -f "$OUT/pptx/moved/sa-free-moved.pdf" ]; then
  pdftoppm -r 100 -png -singlefile "$OUT/pptx/moved/sa-free-moved.pdf" "$OUT/pptx/moved/free"
  pdftoppm -r 100 -png -singlefile "$OUT/pptx/moved/sa-glued-moved.pdf" "$OUT/pptx/moved/glued"
  sheet "$RES/pptx-move-gateway.png" 1 \
    "(b1) freeform edges: Gateway moved 60pt down in PowerPoint:$OUT/pptx/moved/free.png" \
    "(b2) glued connectors: Gateway moved 60pt down in PowerPoint:$OUT/pptx/moved/glued.png"
fi
ls -l "$RES"
