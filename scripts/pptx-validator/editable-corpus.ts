/** Reconstruct IR for committed SVGs without invoking D2. Test/verification only. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileFigure } from "../../src/compiler/compile";
import { readSvgMetadata } from "../../src/render/finalize";
import { componentSamples, outlinedToneSample } from "../gallery/samples";

const root = resolve(import.meta.dir, "../..");
export function editableCorpus() {
  const inputs = [...new Bun.Glob("examples/*/*.sumi.yaml").scanSync(root)].sort().map((path) => ({
    id: path.replace(/\.sumi\.yaml$/, ""),
    source: readFileSync(resolve(root, path), "utf8"),
    svgPath: path.replace(/\.sumi\.yaml$/, ".svg"),
    overrides: {},
  }));
  // The outlined-tone sample (#177): outlined nodes and toned edges and legend samples.
  for (const sample of [...componentSamples(), outlinedToneSample()])
    for (const r of sample.renderings)
      inputs.push({
        id: r.output.replace(/\.svg$/, ""),
        source: sample.source,
        svgPath: r.output,
        overrides: r.overrides,
      });
  inputs.push({
    id: "japanese",
    source: readFileSync(resolve(root, "tests/fixtures/figures/export/editable.sumi.yaml"), "utf8"),
    svgPath: "tests/fixtures/pptx-editable-japanese.svg",
    overrides: {},
  });
  // Figures with icons or images (#94) are refused by the editable export
  // (`pptx/unsupported-asset`), so they are not in its corpus.
  return inputs.flatMap((input) => {
    const compiled = compileFigure(input.source, { overrides: input.overrides });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    if (compiled.value.ir.nodes.some((n) => n.icon !== undefined || n.image !== undefined)) {
      return [];
    }
    const svg = readFileSync(resolve(root, input.svgPath), "utf8");
    const metadata = readSvgMetadata(svg);
    if (
      !metadata.ok ||
      metadata.value?.inputSha256 !==
        new Bun.CryptoHasher("sha256").update(input.source).digest("hex")
    )
      throw new Error(`Stale native SVG fixture: ${input.svgPath}`);
    return [{ id: input.id, ir: compiled.value.ir, svg }];
  });
}
