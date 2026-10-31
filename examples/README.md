# Examples

Generic, domain-neutral figures built only from the built-in components
(`docs/design/phase1.md` §3). Each directory holds the source
(`*.sumi.yaml`, the primary source), its rendered SVG and that SVG as a
vector PDF (#59).

| Example | Theme / Profile | Shows |
| --- | --- | --- |
| [`pipeline/`](pipeline/pipeline.sumi.yaml) | `academic` / `paper-single` | groups (default and muted container), box, parallelogram, cylinder, document, emphasis / muted variants, `arrow`, `double-arrow`, dashed edge, edge labels |
| [`decision-flow/`](decision-flow/decision-flow.sumi.yaml) | `minimal` / `paper-single` | ellipse terminals, parallelogram input, diamond decisions, a retry loop, a `label` note attached with a `line`, emphasis / muted / dashed variants |
| [`system-architecture/`](system-architecture/system-architecture.sumi.yaml) | `academic` / `paper-double` | three tiers as groups (default and muted), hexagon entry point, cylinders and a document in the data tier, `double-arrow` reads/writes, a dashed path |
| [`grouped/`](grouped/grouped.sumi.yaml) | `minimal` / `paper-double` | nested groups (three levels, one muted), two parallel paths crossing group boundaries at every level, ellipse and document outside the groups |
| [`transformer/`](transformer/transformer.sumi.yaml) | `paper` / `paper-single` | the structured layout (`figure.layout.arrange`, design doc §6.23) with `density: compact`: stacks and rows, `align: stretch`, attached notes, operators and hidden junctions (smooth forks), anchored edges and shared trunks (the Transformer architecture, 78mm wide) |
| [`dit-block/`](dit-block/dit-block.sumi.yaml) | `paper` / `paper-double` | the structured layout with `fit: scale`: four panels in a row, filled tones with sublabels, a plain (frameless) group, dimmed groups, a `zoom` callout, label math, and one source feeding four labeled taps over a shared bus (DiT block variants, 180mm wide) |

`pipeline` and `decision-flow` use `direction: down`: four or more nodes in a
row to the right are already wider than `paper-single` (88mm).
`system-architecture` and `grouped` use `direction: right` so that edges enter
groups from the side (with `direction: down` they cross the groups' centered
labels, `geometry/edge-crosses-label`), which makes them wider than one paper
column: they use `paper-double` (180mm).

All six pass `sumi lint --geometry` without errors or warnings. The two
structured figures use the `paper` theme (the color, ML-paper style) and are laid out and routed by Sumi
itself, without D2. `transformer` fits one column; `dit-block` is wider than
`paper-double` and is scaled down to it (`fit: scale`).

The [component gallery](../docs/gallery/README.md) has a page for every
built-in component, a page with every example, and pages that compare themes
(the Transformer above under each one) and profiles.

## Rendering

Render with `sumi render` (or its alias `bun run example:render`, which
regenerates the committed SVGs). It needs the pinned D2 CLI:

```sh
bun run d2:install                                           # once
bun src/cli/index.ts render examples/pipeline/pipeline.sumi.yaml  # writes examples/pipeline/pipeline.svg
bun run example:render examples/pipeline/pipeline.sumi.yaml  # the same
bun run example:render <figure.sumi.yaml> <out.svg>          # any figure, any output path
```

Both run the shared render pipeline (`renderFigure()` from
`src/render`, #11): compile, the D2 CLI backend, SVG finalization and
inspection. They print diagnostics and write the finalized SVG: D2's output
with `width`/`height` in pt on the root `<svg>` (1 D2 unit = 0.5pt), so viewers
show the physical size, and Sumi's deterministic `<metadata>` (versions, theme,
profile, font set, sha256 of the YAML and the D2 source). It also prints the
output size and whether it fits the profile's `page.maxWidth`. It does not run
the lint of #12/#13.

## Committed SVGs

The SVGs are committed so the examples can be viewed without installing
anything. They are small (about 25KB, with the font subset embedded) and
deterministic for a given D2 version, font set and source. A test
(`src/compiler/builtins-render.test.ts`, run in CI) re-renders every example
and fails if a committed SVG is stale or wider than its profile allows; after
changing an example, the compiler, a theme or the fonts, re-render every
example and the gallery with one command:

```sh
bun run gallery         # re-renders examples/*/*.{svg,pdf} and docs/gallery/
bun run gallery:check   # fails if any of them is stale (run in CI)
```

## Committed PDFs

`<name>.pdf` is `<name>.svg` converted by `sumi render -o <name>.pdf`'s PDF
engine (krilla + krilla-svg compiled to WebAssembly): one page of the SVG's size in pt,
text in subsets of the bundled fonts, no raster images. They are
byte-identical goldens: `src/render/pdf/pdf.test.ts` converts the committed
SVGs on Linux and macOS in CI and compares the bytes, and checks the page
size, fonts and every label's position against Sumi's own measurement.
