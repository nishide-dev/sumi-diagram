# Sumi

[日本語](docs/README-ja.md)

**Diagrams as code, designed to fit.** Sumi turns YAML into SVG, PDF, and PPTX using a component library, design-system themes, and geometry lint that checks the rendered result. Get deterministic output with bundled fonts and a pinned layout backend, delivered as a single binary with its supporting assets—no Bun or Node.js required. Works great with Claude Code through the bundled Skill: describe a figure, then let the agent discover components, write YAML, and validate the result.

## See what you can build

Sumi-rendered recreations of public reference figures: the Transformer architecture and a DiT block.

<table>
  <tr>
    <th>Transformer</th>
    <th>DiT block</th>
  </tr>
  <tr>
    <td><img src="examples/transformer/transformer.svg" alt="Transformer architecture rendered by Sumi" height="280"></td>
    <td><img src="examples/dit-block/dit-block.svg" alt="DiT block rendered by Sumi" height="280"></td>
  </tr>
</table>

Browse the [component gallery](docs/gallery/README.md) and [examples with YAML sources](examples/README.md).

## Install

macOS and Linux, x64 and arm64. No runtime installation required.

```sh
curl -fsSL https://raw.githubusercontent.com/nishide-dev/sumi-diagram/main/install.sh | sh
```

The installer downloads the latest release, verifies SHA-256, keeps D2 and fonts beside the binary, links `~/.local/bin/sumi`, and runs `sumi doctor`. Add `~/.local/bin` to `PATH` if prompted. It needs curl or wget, tar, and sha256sum or shasum; no sudo.

To pin a version or choose directories (environment variables apply to `sh`):

```sh
curl -fsSL https://raw.githubusercontent.com/nishide-dev/sumi-diagram/main/install.sh | \
  SUMI_VERSION=0.9.0 SUMI_HOME="$HOME/.local/share/sumi" SUMI_BIN_DIR="$HOME/.local/bin" sh
```

**Upgrade:** rerun the installer. Older version directories stay available; remove them when no longer needed. **Uninstall** with the default paths:

```sh
rm "$HOME/.local/bin/sumi"
rm -rf "$HOME/.local/share/sumi"
```

Use your chosen paths if customized. See [manual installation and macOS notes](docs/usage.md#manual-installation).

## Quick start

Save as `hello.sumi.yaml`:

```yaml
version: 1
figure:
  id: hello
  layout:
    direction: down
nodes:
  - { id: input, component: box, label: Input }
  - { id: output, component: box, label: Output }
edges:
  - { from: input, to: output }
```

```sh
sumi fmt hello.sumi.yaml
sumi lint hello.sumi.yaml
sumi render hello.sumi.yaml                 # writes hello.svg
sumi render hello.sumi.yaml -o hello.pdf    # writes a vector PDF
```

Example output:

```text
Wrote hello.svg: 23.64mm × 33.69mm (paper-single, max width 88mm; theme minimal).
```

Render reports the measured size and whether it fits the output profile. Open `hello.svg` in a browser, or include `hello.pdf` in a paper. Your YAML remains the source of truth.

## Features

| Capability | What it gives you |
| --- | --- |
| [Auto and structured layout](skills/sumi/references/structured.md) | Auto layout for flows and graphs; nested rows/stacks, anchors, alignment, and routed residual connections for precise block diagrams. |
| [Themes and profiles](docs/themes.md) | `minimal`, `academic` (grayscale, print-friendly), `color`, `slides`, and `paper` (color ML-paper style); independent page-size and minimum-type constraints for papers and presentations. |
| [Math labels](skills/sumi/references/figure-format.md) | Inline math with bundled STIX Two fonts in structured figures. |
| [Icons, emoji, and images](skills/sumi/references/assets.md) | Bundled Tabler icons, multicolor Fluent emoji, and local PNG/JPEG/SVG assets. |
| [PDF and PPTX](docs/usage.md#export-formats) | Vector PDF with embedded fonts, picture-based PPTX, and experimental editable PowerPoint objects. |
| [Lint and diagnostics](docs/lint-rules.md) | Schema and reference checks plus rendered geometry checks for page limits, overflow, and collisions. [JSON output](docs/usage.md#json-output) supports scripts and agents. |

## Use with Claude Code

Install the CLI above, then add the Skill to your project:

```sh
npx skills add nishide-dev/sumi-diagram --skill sumi -a claude-code -y
```

For an interactive choice of agents, omit `-a claude-code -y`. The Skill drives the installed CLI; it does not include the executable. Make sure `sumi` is on `PATH` and `sumi doctor` passes.

Ask Claude Code: **“Use Sumi to draw this pipeline as a single-column paper figure.”** The Skill discovers the catalog, writes YAML, runs fmt → lint → render, and visually inspects the result. See the [Skill workflow](skills/sumi/SKILL.md) and [CLI discovery details](docs/usage.md#claude-code-skill).

## Documentation

- [User guide](docs/usage.md) · [日本語利用ガイド](docs/usage-ja.md): commands, diagnostics, exports, installation, and environment options
- [Themes](docs/themes.md) · [Component gallery](docs/gallery/README.md) · [Examples](examples/README.md)
- [Figure format](skills/sumi/references/figure-format.md) · [Structured layout](skills/sumi/references/structured.md) · [Layout recipes](skills/sumi/references/layout-tips.md)
- [JSON Schema for editor completion](schema/figure.v1.schema.json)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE). Bundled third-party components retain their own licenses; each release includes `NOTICE` and `licenses/`.
