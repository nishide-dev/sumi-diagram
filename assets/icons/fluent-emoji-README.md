# Fluent Emoji Flat subset

- Author: Microsoft Corporation; MIT (unmodified text in `fluent-emoji-LICENSE.txt`).
- Source: <https://github.com/microsoft/fluentui-emoji>.
- Distribution: `@iconify-json/fluent-emoji-flat@1.2.6`, MIT; only `fire` and
  `snowflake`. Iconify's path data and palettes are retained, wrapped in SVG
  with their original viewBox. No font or operating-system emoji renderer is used.
- Package URL: <https://registry.npmjs.org/@iconify-json/fluent-emoji-flat/-/fluent-emoji-flat-1.2.6.tgz>.
- npm SHA-512 integrity is pinned in `scripts/build-emoji.ts`.
- MIT text checked against upstream commit
  `1ffb34c752ecf5d402f04cfb4b392c77f57c54bc`;
  SHA-256 `c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383`.
- Archive SHA-256:
  `b2f2942692bc9dc1349fd5c816f7fae5225b0903bee97e61c656fb3a43415fed`.

Rebuild: `bun run emoji:build`; verify against the pinned upstream package
and license: `bun run emoji:check`. No runtime network dependency.

Measured sizes: npm tarball 1,172,438 bytes; full SVG JSON gzip 1,154,399 bytes
(3,174 named entries); selected two-icon archive **1,016 bytes**. The full
set contains clipping resources not accepted by Sumi's basic-shape SVG
importer (e.g. `airplane-arrival`). The subset covers #188's acceptance
figure without adding a new SVG resource model. Future additions must pass
the same importer and SVG/PDF/picture-PPTX checks; discover the supported
names with `sumi catalog --icons ""`.

The binary embeds the compressed archive and license. Release packages
retain `licenses/fluent-emoji/LICENSE`, `NOTICE` and the distribution README.
Figures embed only used icons and retain their full MIT notice in SVG
metadata, PDF document properties and PPTX custom properties.
