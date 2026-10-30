import { dirname } from "node:path";
import { groupEmptySpace } from "../../src/lint/geometry/empty-space";
import { geometryContextFor } from "../../src/lint/geometry/lint";
import { renderFigure } from "../../src/render/render";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing panel geometry");
  return value;
}

const panels = [];
for (const file of [
  "research/233-lora/c-h3world.sumi.yaml",
  "research/248-fill/c-h3world.sumi.yaml",
]) {
  const result = await renderFigure(await Bun.file(file).text(), {
    file,
    assetBase: dirname(file),
  });
  if (!result.ok || !("layout" in result.value))
    throw new Error(JSON.stringify(result.diagnostics));
  const { layout, inspection } = result.value;
  const context = geometryContextFor(result.value);
  const panel = required(layout.groups.find((g) => g.key === "g:lora"));
  const rect = (id: string) =>
    required(
      [...layout.groups, ...layout.nodes].find((n) => n.key === `n:${id}` || n.key === `g:${id}`),
    ).rect;
  const key = required(layout.nodes.find((n) => n.key === "n:key-axis")?.label).box;
  const caption = required(layout.nodes.find((n) => n.key === "n:mask-title")?.label).box;
  const span = (ids: string[]) =>
    Math.max(...ids.map((id) => rect(id).y + rect(id).height)) -
    Math.min(...ids.map((id) => rect(id).y));
  const pt = (units: number) => Math.round(((units * (inspection.scale ?? 1)) / 2) * 100) / 100;
  panels.push({
    file,
    empty: groupEmptySpace(context, required(context.get("g:lora"))),
    printedPt: {
      panelHeight: pt(panel.rect.height),
      matrixHeight: pt(rect("mask").height),
      projectionColumn: pt(span(["lora-in", "qkv"])),
      qkvHeight: pt(rect("qkv").height),
      loraHeight: pt(rect("lora-in").height),
      tokensHeight: pt(
        span(
          file.includes("233-lora")
            ? Array.from({ length: 9 }, (_, i) => `ct-${i + 1}`)
            : Array.from({ length: 9 }, (_, i) => `ct${i + 1}`),
        ),
      ),
      titleToKey: pt(key.y - (required(panel.label).box.y + required(panel.label).box.height)),
      captionToBorder: pt(panel.rect.y + panel.rect.height - (caption.y + caption.height)),
    },
  });
}
console.log(JSON.stringify(panels, null, 2));
await Bun.write("research/248-fill/panel-metrics.json", `${JSON.stringify(panels, null, 2)}\n`);
