# Fluent Emoji Flat subset

- Author: Microsoft Corporation; MIT (unmodified text in `fluent-emoji-LICENSE.txt`).
- Source: <https://github.com/microsoft/fluentui-emoji>.
- Distribution: `@iconify-json/fluent-emoji-flat@1.2.6`, MIT; all 3,124
  importer-supported icons, including the original 47 (`fire`, `snowflake`, etc.). Iconify's path data and palettes are retained, wrapped in SVG
  with their original viewBox. No font or operating-system emoji renderer is used.
- Package URL: <https://registry.npmjs.org/@iconify-json/fluent-emoji-flat/-/fluent-emoji-flat-1.2.6.tgz>.
- npm SHA-512 integrity is pinned in `scripts/build-emoji.ts`.
- MIT text checked against upstream commit
  `1ffb34c752ecf5d402f04cfb4b392c77f57c54bc`;
  SHA-256 `c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383`.
- Archive SHA-256: `EMOJI_ARCHIVE_SHA256` in `src/assets/icons.ts`, updated
  automatically by `emoji:build` and verified by `emoji:check`.

Rebuild: `bun run emoji:build`; verify against the pinned upstream package
and license: `bun run emoji:check`. No runtime network dependency.

Measured sizes: npm tarball 1,172,438 bytes; full SVG JSON gzip 1,154,399 bytes
(3,174 named entries); selected 3,124-icon archive **1,128,359 bytes** (excluding
licence/code overhead; includes exclusion reasons for the remaining 50 names).
The original 47-icon archive was 13,971 bytes. Fixing hex-colour validation and
allowing validated `clip-rule` raises importer coverage from 2,747 to 3,124.
The remaining 50 require references, clipping, gradients or filters; their
names report `asset/unsupported-icon` with the importer reason on both icons
and badges. No unsupported drawing is silently simplified.
Every bundled entry passes the importer. Integration tests cover the original
47 and representative additions in SVG/PDF/picture-PPTX through both engines;
editable PPTX reports unsupported assets explicitly. Discover supported names
with `sumi catalog --icons ""` or search words with `--icons "smiling face"`.
Counts are available via `sumi catalog --section icons`; metadata does not read
the artwork, which is lazily verified and decompressed on name search or use.
Release size and performance measurements are recorded in design §6.67
(`docs/design/phase1.md` in the repository).

The binary embeds the compressed archive and license. Release packages
retain `licenses/fluent-emoji/LICENSE`, `NOTICE` and the distribution README.
Figures embed only used icons and retain their full MIT notice in SVG
metadata, PDF document properties and PPTX custom properties.
