# Examples

Generic, domain-neutral figures built only from the built-in components
(`docs/design/phase1.md` §3). Each directory holds the source
(`*.sumi.yaml`, the primary source) and its rendered SVG.

| Example | Theme / Profile | Shows |
| --- | --- | --- |
| [`pipeline/`](pipeline/pipeline.sumi.yaml) | `academic` / `paper-single` | groups (default and muted container), box, parallelogram, cylinder, document, emphasis / muted variants, `arrow`, `double-arrow`, dashed edge, edge labels |
| [`decision-flow/`](decision-flow/decision-flow.sumi.yaml) | `minimal` / `paper-single` | ellipse terminals, parallelogram input, diamond decisions, a retry loop, a `label` note attached with a `line`, emphasis / muted / dashed variants |

Both use `direction: down`: four or more nodes in a row to the right are
already wider than `paper-single` (88mm).

## Rendering

Until `sumi render` lands (#14), render with the helper script. It needs the
pinned D2 CLI:

```sh
bun run d2:install                                           # once
bun run example:render examples/pipeline/pipeline.sumi.yaml  # writes examples/pipeline/pipeline.svg
bun run example:render <figure.sumi.yaml> <out.svg>          # any figure, any output path
```

The script runs the shared render pipeline (`renderFigure()` from
`src/render`, #11): compile, the D2 CLI backend, SVG finalization and
inspection. It prints diagnostics and writes the finalized SVG: D2's output
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
changing an example, the compiler, a theme or the fonts, re-render the
affected examples with the command above.
