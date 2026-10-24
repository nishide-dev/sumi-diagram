/** Reconstruct IR for committed SVGs without invoking D2. Test/verification only. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileFigure } from "../../src/compiler/compile";
import { readSvgMetadata } from "../../src/render/finalize";
import { componentSamples } from "../gallery/samples";

const root = resolve(import.meta.dir, "../..");
export function editableCorpus() {
  const inputs = [...new Bun.Glob("examples/*/*.sumi.yaml").scanSync(root)].sort().map((path) => ({
    id: path.replace(/\.sumi\.yaml$/, ""),
    source: readFileSync(resolve(root, path), "utf8"),
    svgPath: path.replace(/\.sumi\.yaml$/, ".svg"),
    overrides: {},
  }));
  for (const sample of componentSamples())
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
  return inputs.map((input) => {
    const compiled = compileFigure(input.source, { overrides: input.overrides });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const svg = readFileSync(resolve(root, input.svgPath), "utf8");
    const metadata = readSvgMetadata(svg);
    if (
      !metadata.ok ||
      metadata.value?.inputSha256 !==
        new Bun.CryptoHasher("sha256").update(input.source).digest("hex")
    )
      throw new Error(`Stale native SVG fixture: ${input.svgPath}`);
    return {
      id: input.id,
      ir: compiled.value.ir,
      svg,
    };
  });
}
