import { expect, test } from "bun:test";
import { BUILTIN_THEMES } from "../../core/theme/builtin";
import { lintGeometry } from "../../lint";
import { renderFigure } from "../../render";

const fixture = `${import.meta.dir}/../../../tests/fixtures/figures/layout/side-inputs.sumi.yaml`;

for (const theme of BUILTIN_THEMES.keys()) {
  for (const above of [false, true]) {
    test(`side inputs preserve the centerline and reserve space (${theme}, ${above ? "above" : "below"})`, async () => {
      const source = await Bun.file(fixture).text();
      const text = above
        ? source
            .replaceAll("centerOn:", "direction: up\n              centerOn:")
            .replaceAll("fromAnchor: north, toAnchor: south", "fromAnchor: south, toAnchor: north")
        : source;
      const result = await renderFigure(text, { overrides: { theme } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
      const rendered = result.value;
      if (!("layout" in rendered)) throw new Error("expected structured layout");
      const rect = (id: string) => {
        const node = rendered.layout.nodes.find((n) => n.key === `n:${id}`);
        if (!node) throw new Error(`missing ${id}`);
        return node.rect;
      };
      const main = ["features", "encoder", "decoder", "predictions"].map(rect);
      const centers = main.map((r) => r.y + r.height / 2);
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(0.001);
      const geometry = lintGeometry(rendered, { source: text });
      expect(geometry.filter((d) => d.severity !== "info")).toEqual([]);
      // Main-flow edges remain visibly straight, including encoder → decoder.
      for (const edge of rendered.layout.edges.slice(0, 3)) {
        expect(
          edge.route?.points.every((p) => Math.abs(p.y - (edge.route?.points[0]?.y ?? 0)) < 0.001),
        ).toBe(true);
      }
    });
  }
}
