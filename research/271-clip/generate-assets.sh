#!/bin/sh
# Run from the repository root. Original synthetic scene; no external images.
set -eu
magick -size 240x180 gradient:'#b3d5e9-#ecedde' \
  -fill '#72966a' -draw 'rectangle 0,116 240,180' \
  -fill '#557651' -draw 'ellipse 120,157 64,10 0,360' \
  -fill '#83654c' -draw 'ellipse 121,122 48,33 0,360' \
  -fill '#514a45' -draw 'polygon 79,57 66,28 100,44 polygon 140,44 171,27 160,72' \
  -fill '#998d7d' -draw 'ellipse 119,74 45,41 0,360' \
  -fill '#faf1dc' -draw 'polygon 114,37 127,38 133,83 118,106 104,84' \
  -fill '#f6e7d0' -draw 'ellipse 119,91 26,18 0,360' \
  -fill '#25282b' -draw 'circle 96,69 100,69 circle 142,69 146,69 ellipse 120,85 8,5 0,360' \
  -fill '#c47778' -draw 'roundrectangle 114,99 126,116 5,5' \
  -fill '#ecddc5' -draw 'ellipse 97,148 12,12 0,360 ellipse 145,148 12,12 0,360' \
  -strip PNG24:research/271-clip/assets/synthetic-dog.png
