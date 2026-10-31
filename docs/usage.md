# Sumi user guide

[日本語](usage-ja.md) · [Product README](../README.md)

Sumi keeps `*.sumi.yaml` as the primary source. Components, themes and profiles resolve into a figure that is laid out, rendered, and inspected. Use the [Figure Schema](../schema/figure.v1.schema.json) for editor completion and the [figure-format reference](../skills/sumi/references/figure-format.md) for YAML fields.

## Manual installation

The [one-line installer](../README.md#install) is the simplest option. Alternatively, download a tarball from [GitHub Releases](https://github.com/nishide-dev/sumi-diagram/releases). Supported targets are `darwin-arm64`, `darwin-x64`, `linux-x64`, and `linux-arm64`; Windows is not supported. Bun and Node.js are unnecessary, and Sumi is not published to npm.

```sh
version=0.8.0 target=darwin-arm64
base=https://github.com/nishide-dev/sumi-diagram/releases/download/v$version
curl -fLO "$base/sumi-$version-$target.tar.gz"
curl -fLO "$base/SHA256SUMS"
shasum -a 256 --check --ignore-missing SHA256SUMS
# Linux: sha256sum --check --ignore-missing SHA256SUMS
mkdir -p "$HOME/.local/share/sumi" "$HOME/.local/bin"
tar -xzf "sumi-$version-$target.tar.gz" -C "$HOME/.local/share/sumi"
ln -sf "$HOME/.local/share/sumi/sumi-$version-$target/bin/sumi" "$HOME/.local/bin/sumi"
sumi doctor
```

Keep the extracted layout intact. Sumi resolves symlinks and finds D2 and fonts relative to its real executable; copying only `bin/sumi` breaks discovery.

| Archive path | Contents |
| --- | --- |
| `bin/sumi` | Single executable, compiled with Bun |
| `libexec/sumi/d2` | Unmodified, pinned D2 v0.9.0 (MPL-2.0) |
| `share/sumi/fonts/` | BIZ UD Gothic, STIX Two math fonts, and Inter (SIL OFL 1.1) |
| `LICENSE`, `licenses/`, `NOTICE` | MIT license plus licenses, origins, and versions of bundled runtimes, packages, engines, icons, and fonts |
| `VERSION`, `README.md` | Release version and distribution instructions |
| `SHA256SUMS` | SHA-256 of every other file in the extracted tree; the release-level list verifies tarballs |

`doctor` reports compiled mode, bundled D2 and its version, font checksums, and readable geometry-lint font metrics. macOS browser downloads can be quarantined: the executables are not notarized. Download using curl or `gh release download`, or run `xattr -dr com.apple.quarantine <extracted-directory>` after verifying the archive.

Installer options: `SUMI_VERSION` accepts a version with or without `v`; otherwise the GitHub latest-release API is used. `SUMI_HOME` defaults to `~/.local/share/sumi`, and `SUMI_BIN_DIR` to `~/.local/bin`. `SUMI_DOWNLOAD_BASE` overrides the directory containing the tarball and `SHA256SUMS` (HTTP(S), curl's `file://`, or an absolute local directory). Rerun to upgrade; old version directories remain. Remove the symlink and installation home to uninstall.

For mirrors and offline installation, `SUMI_LATEST_URL` overrides the latest-release API endpoint with an HTTP(S) URL, curl's `file://` URL, or an absolute local JSON file path containing `tag_name`. Reinstalling the same version stages a fresh copy inside the installation home, then replaces that version's directory.

## CLI commands

Use `sumi --help` and `sumi <command> --help`. For source development, use `bun src/cli/index.ts <command>` or `bun link`; see [Contributing](../CONTRIBUTING.md).

```sh
sumi render figure.sumi.yaml
sumi render figure.sumi.yaml -o figure.pdf
sumi render figure.sumi.yaml -o out.svg --emit-d2 out.d2 --profile paper-double --theme academic
sumi lint figures/*.sumi.yaml --max-warnings 0
sumi lint --geometry figure.sumi.yaml
sumi fmt figure.sumi.yaml
sumi doctor
sumi catalog --kind node
sumi catalog --json --section themes --section profiles
```

| Command | Behavior and options |
| --- | --- |
| `render <file>` | Compile and render SVG/PDF/PPTX; run geometry lint by default. `-o, --out`, `--format svg\|pdf\|pptx`, `--pptx-mode picture\|editable` (editable is experimental), `--pptx-connectors freeform\|glued` (editable only), `--emit-d2`, `--theme`, `--profile`, `--no-geometry`, `--json`. Only SVG supports `-o -` (stdout). |
| `lint <files...>` | Validate schema, references, components, assets, themes/profiles, and structural rules without drawing. `--geometry` also renders in memory and checks geometry without writing files. `--json`, `--config <lint.json>`, repeated `--rule <id>=<level>` (including `geometry/*`), `--max-warnings <n>` across all input files. See [lint rules](lint-rules.md). |
| `fmt <files...>` | Format YAML without changing meaning; preserve comments, quotes, and key order. Invalid YAML is not rewritten. `--check` lists unformatted files without writing; `--stdout` prints YAML; `--canonical-order` sorts known keys into schema order. |
| `doctor` | Check Sumi/runtime versions, D2, bundled font hashes and geometry metrics. `--json`. |
| `catalog` | List components, themes, and profiles. `--json`; repeated `--section components\|themes\|profiles`; `--kind node\|group\|edge` (without a section, returns only components); `--icons <words>` searches bundled icons, `--icons ""` lists all icon names. |

Format selection is explicit `--format`, otherwise a recognized `-o` extension, otherwise SVG. Conflicting format and extension is a usage error. The default output replaces the input YAML extension with the selected format. Files are written via temporary files. Geometry errors leave the rendered output available and return 1; conversion failures do not write output. `render` does not run structural `lint/*` rules, so run `lint` first.

### Components and layout

Discover available components, variants, props and engine support with `sumi catalog --json`. The [gallery](gallery/README.md) is an index with one page per component (every variant and theme, descriptions, props, YAML) and pages for examples, themes, tones, dimmed groups and theme/profile comparisons; [examples](../examples/README.md) include source YAML and SVG/PDF outputs.

Auto layout uses D2/ELK and `figure.layout.direction`. Structured layout uses Sumi's own nested row/stack arrangement, anchors, alignment and routing, without D2. Math labels require structured layout. `--emit-d2` is unavailable for structured figures. See [structured layout](../skills/sumi/references/structured.md), [layout tips](../skills/sumi/references/layout-tips.md), and [math syntax](../skills/sumi/references/figure-format.md).

`trapezoid` has a wide top and narrow bottom; `stack` draws three offset rectangles with text on the front. Both accept optional `width`/`height`; omit them for automatic text sizing. Their slopes, number of sheets, and offsets are fixed. Standard variants include `default`, `emphasis`, and `muted`; consult the catalog for current theme support. Catalog `render` metadata describes synthesized outlines, not a YAML field. In auto layout ELK selects connection sides/positions and Sumi extends edges to the outline; arbitrary ports are not provided there.

## Output and exit codes

| Stream | Contents |
| --- | --- |
| stdout | lint/doctor/catalog reports, JSON, filenames changed by fmt (or unformatted files with `--check`), `fmt --stdout` YAML, render's `Wrote …`, and `render -o -` SVG |
| stderr | render/fmt diagnostics, usage errors, logs; render's `Wrote …` when SVG goes to stdout |

| Code | Meaning |
| --- | --- |
| 0 | Success; warnings and info are allowed |
| 1 | Diagnostics contain errors (including geometry errors, with output retained); warnings exceed `--max-warnings`; fmt check finds unformatted files or input is invalid YAML; required doctor checks fail |
| 2 | Usage/internal error: invalid flags/config, unreadable/unwritable files, unknown theme/profile, exceptions |

Color is terminal-only; `--no-color` or `NO_COLOR=1` disables it, `FORCE_COLOR=1` forces it. Usage errors are one line without a stack trace; set `SUMI_DEBUG=1` for internal-error stacks. If a downstream reader closes a pipe (EPIPE), remaining output is silently discarded and the command retains its own exit status. Rendering and file formatting still finish.

Output is deterministic for the same input, Sumi version, layout backend, fonts, and options. JSON is versioned; within a version fields may be added, so ignore unknown fields.

## JSON output

`catalog --json` emits `{ version: 1, components, themes, profiles }`. Themes include descriptions, font sets/styles, font-size ranges and `compatibleProfiles`. Profiles include page bounds, margins, minimum font size and layout spacing, preserving written values and normalized pt/mm/D2 units.

```json
{
  "version": 1,
  "file": "figure.sumi.yaml",
  "diagnostics": [],
  "summary": { "errors": 0, "warnings": 0, "infos": 0 },
  "output": "figure.svg",
  "d2": null,
  "size": {
    "widthPt": 138.5,
    "heightPt": 439,
    "widthMm": 48.86,
    "heightMm": 154.87,
    "profile": { "id": "paper-single", "maxWidthMm": 88, "maxHeightMm": 220, "minFontSizePt": 7 },
    "fits": true
  },
  "format": "svg"
}
```

`render --json` and each file result of `lint --geometry --json` include `size` (`null` if not rendered). `fits` measures width/height only; text-size problems appear as diagnostics. Render's `format` is `svg`, `pdf`, or `pptx`. Diagnostics include `code`, `severity`, `message`, YAML `path`, source `location`, and often a corrective `hint`. See [diagnostic reference](../skills/sumi/references/diagnostics.md).

## Export formats

### PDF

`sumi render figure.sumi.yaml -o figure.pdf` (or `--format pdf`) makes one PDF 1.7 page matching the SVG's physical width/height in pt. Text remains searchable/copyable with bundled font subsets embedded; shapes and lines remain vector. User raster images remain raster. No browser, system fonts or extra conversion binary is needed: krilla/krilla-svg run as bundled WebAssembly. Identical inputs and Sumi versions give byte-identical PDFs across supported OSes.

PDF/A and PDF/X are not supported; edge-label backgrounds use transparency/soft masks. The PDF engine changed in v0.3.0, so internal representation, Producer and bytes differ from v0.2.0 while dimensions, searchable Japanese text, vectors and provenance remain; see [engine verification](verification/74-krilla.md).

Include with `graphicx` and `\includegraphics{figure.pdf}` in pdfLaTeX/LuaLaTeX. No CJK package or system font is required for the figure. If needed, request PDF 1.7 at the document start: `\pdfminorversion=7` (pdfLaTeX), `\pdfvariable minorversion=7` (LuaLaTeX). See [LaTeX verification](verification/63-pdf-latex.md).

### PPTX

```sh
sumi render figure.sumi.yaml -o figure.pptx
sumi render figure.sumi.yaml --format pptx
sumi render figure.sumi.yaml -o editable.pptx --pptx-mode editable
sumi render figure.sumi.yaml -o glued.pptx --pptx-mode editable --pptx-connectors glued
```

Default `picture` mode puts the whole figure on one slide as a single picture, containing outlined SVG and a resvg PNG fallback. It does not depend on viewer fonts; individual shapes, text and arrows cannot be edited. Vector preservation on re-export to PDF is not guaranteed.

The picture keeps SVG physical dimensions. Slides are 1–56 inches per side: smaller figures are centered with padding; larger ones fail with `pptx/unsupported-size`. PNG is normally 192 dpi, reduced to stay within 8192 pixels per side and about 16 million pixels. JSON `size` still describes the figure, not the padded slide. Generation supports macOS/Linux on x64/arm64; viewing has been checked in PowerPoint for Mac 16.114.1. Windows PowerPoint, Keynote and Google Slides are not guaranteed. See [PPTX verification](verification/61-pptx.md).

Experimental `editable` mode creates separate DrawingML shapes/text. Only individual selection/editing is promised, not exact appearance, layout after edits or round-trip YAML. Fonts are referenced, not embedded: viewers need BIZ UDPGothic/BIZ UDGothic or substitute fonts. Default `freeform` connectors preserve routes but do not follow moved nodes. `glued` replaces routes with straight standard connectors attached at cardinal points; bends/curves are lost and labels do not follow. Containers are independent frames, not PowerPoint groups. Icons/images are not supported in editable mode. See [editable PPTX limitations and verification](verification/62-editable-pptx.md).

## Themes and profiles

`figure.theme` selects appearance; `figure.profile` selects page limits, minimum text size and spacing. They are independent. A profile never scales the diagram or its text. There are five built-in themes:

| Theme | Appearance |
| --- | --- |
| `minimal` (default) | Monochrome, clear lines; nodes/groups 8pt, edges 7pt |
| `academic` | Thin lines, black text, gray emphasis; 8pt/7pt |
| `slides` | Nodes 16pt, groups 18pt, edges 14pt, lines 2pt; pair with `presentation-16x9` |
| `color` | Minimal's typography/lines with pastel tones and blue emphasis; 8pt/7pt |
| `paper` | Rounded boxes/groups, pastel tones, black 1pt outlines, 0.5pt edges and small arrows; Inter Latin text in structured layout (`sumi/inter-biz-ud-gothic`); 8pt/7pt |

Nodes/groups accept `tone`: `gray`, `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`. Themes determine the actual colors: color/paper use distinct pale fills, minimal/academic/slides use three gray levels for grayscale printing.

| Profile | Maximum width | Maximum height | Minimum text |
| --- | --- | --- | --- |
| `paper-single` (default) | 88mm | 220mm | 7pt |
| `paper-double` | 180mm | 220mm | 7pt |
| `presentation-16x9` | 338.7mm | 190.5mm | 14pt |

Use slides + presentation-16x9 together. Other built-in themes are too small for that profile and report `profile/font-too-small`. See [theme/profile comparisons](gallery/compare.md).

## Icons and images

Use `icon: tabler/<name>` instead of a node label for one of 4,808 bundled Tabler outline icons (Brand category excluded; MIT). Icons follow text color. The 47 bundled `emoji/<name>` Fluent Emoji Flat icons retain their multicolor palette, including in dimmed groups. Search with `sumi catalog --icons <words>`; `--icons ""` lists all names. Badges can place icons on node corners.

```yaml
nodes:
  - { id: pe, component: circle, icon: tabler/wave-sine }
  - { id: photo, component: image, props: { src: img/photo.png, height: 30pt } }
```

Local PNG/JPEG/SVG paths are relative to the YAML. Specify image width or height. Images are embedded without alteration; SVG imports accept only permitted shapes and reject scripts/external references with source-position diagnostics. Editable PPTX does not support icons/images. See [assets reference](../skills/sumi/references/assets.md).

## D2 version and discovery

Auto layout requires **D2 v0.9.0**; other versions fail with `backend/d2-version-mismatch`. Releases bundle it. Structured figures use Sumi's own layout instead. Determinism requires the pinned backend/fonts.

Discovery order (`doctor` reports `source`):

1. Explicit API option (`option`).
2. `SUMI_D2_PATH` (`env`).
3. Compiled release's `libexec/sumi/d2` (`bundled`).
4. Working directory's `.sumi/bin/d2` (`managed`).
5. `d2` on `PATH` (`path`).

Missing explicit option/environment paths fail rather than falling back. Set `SUMI_D2_PATH=/path/to/d2` to use another installation of the pinned version. See [development D2 installation](../CONTRIBUTING.md#開発環境のセットアップ).

## Claude Code Skill

Install with `npx skills add nishide-dev/sumi-diagram --skill sumi -a claude-code -y`, or omit agent/yes flags for interactive selection. The Skill does not include the CLI: install Sumi, put it on PATH and run doctor first.

The [workflow](../skills/sumi/SKILL.md) clarifies content/output profile, checks doctor and catalog, writes YAML, formats/lints and fixes diagnostic paths/hints, renders with geometry checks, visually inspects a PNG preview, and reports files, dimensions, remaining warnings and assumptions. It asks when facts or output choices are missing or fixes stall.

The `skills/sumi/scripts/sumi` wrapper searches in this order:

1. `SUMI_BIN` executable path.
2. Source checkout containing the resolved wrapper (preferred during repository development).
3. `sumi` on PATH, excluding the wrapper itself and its copies.
4. Source checkout above the working directory.

If absent, it prints installation instructions and exits 127. Source checkouts run `bun <repo>/src/cli/index.ts` and default `SUMI_D2_PATH` to the repository's `.sumi/bin/d2` if unset. References ship with the Skill in `skills/sumi/references/`; repository development setup is in [Contributing](../CONTRIBUTING.md#claude-code-skill).
