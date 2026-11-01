# Takumi 2.19.0 notices

Unmodified upstream license texts from https://github.com/kane50613/takumi/tree/d482d86c081156760d72842fe28c31f8a0e8f64f.
Geist-OFL.txt is from https://github.com/vercel/geist-font/blob/c40c1aec7e72b9ebdce65a4fccd03cb3950a359b/OFL.txt (Takumi's assets/fonts/OFL.txt is for Scheherazade, not Geist).

Both @takumi-rs/wasm and its transitive @takumi-rs/helpers dependency are MIT OR Apache-2.0. Sumi does not import helpers/html; its bundled ultrahtml parser is not reachable in the executable.
The WASM includes Geist (OFL), IJG JPEG algorithms, Chromium/Skia algorithms, emoji-segmenter and ICU. The upstream notice also includes native-only libwebp for completeness.

HTML source projection uses Sumi's validated parse and entities 9.0.0 solely for character-reference decoding (no HTML parser). entities-LICENSE.txt is its unmodified BSD-2-Clause notice, copied from the pinned npm package and SHA-256 checked by the generation script.

Regenerate with `bun scripts/vendor-takumi-licenses.ts`. Distributed in licenses/takumi/.
