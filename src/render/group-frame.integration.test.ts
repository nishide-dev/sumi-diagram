import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { renderFigure } from "./render";

// #312: a title belongs to the whole frame, even when one-sided attachments
// make the arranged body asymmetric. This applies to invisible frames too.
for (const theme of BUILTIN_THEMES.keys()) {
  for (const variant of ["default", "plain", "dashed"]) {
    for (const side of ["west", "east"]) {
      test(`${theme}/${variant}/${side}: group titles use the expanded frame`, async () => {
        for (const labelAt of [
          undefined,
          "top",
          "bottom",
          "top-left",
          "top-right",
          "bottom-left",
          "bottom-right",
        ]) {
          const result = await renderFigure(
            stringify({
              version: 1,
              figure: {
                id: "attached-panel",
                theme,
                layout: { arrange: { row: { items: ["panel"] } } },
              },
              groups: [
                {
                  id: "panel",
                  label: "Panel",
                  variant,
                  labelAt,
                  arrange: { stack: { items: ["body"] } },
                },
              ],
              nodes: [
                {
                  id: "body",
                  component: "box",
                  label: "Body",
                  props: { width: "60pt", height: "40pt" },
                },
                {
                  id: "input",
                  component: "box",
                  label: "Input",
                  attach: { to: "body", side, gap: "10pt" },
                  props: { width: "40pt", height: "30pt" },
                },
              ],
            }),
          );
          if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
          expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
          if (!("layout" in result.value)) throw new Error("expected structured layout");
          const group = result.value.layout.groups[0];
          const body = result.value.layout.nodes.find((n) => n.key === "n:body");
          const input = result.value.layout.nodes.find((n) => n.key === "n:input");
          if (!group?.label || !body || !input) throw new Error("missing panel members");
          const label = group.label.box;
          expect(input.parent).toBe("g:panel");
          expect(group.rect.x).toBeLessThanOrEqual(input.rect.x);
          expect(group.rect.x + group.rect.width).toBeGreaterThanOrEqual(
            input.rect.x + input.rect.width,
          );
          const pad = group.content.x - group.rect.x;
          const at = labelAt ?? "top";
          const expectedX = at.endsWith("-left")
            ? group.rect.x + pad
            : at.endsWith("-right")
              ? group.rect.x + group.rect.width - pad - label.width
              : group.rect.x + (group.rect.width - label.width) / 2;
          expect(label.x).toBeCloseTo(expectedX, 2);
          if (at === "top" || at === "bottom") {
            expect(
              Math.abs(group.label.anchor.x - (body.rect.x + body.rect.width / 2)),
            ).toBeGreaterThan(1);
          }
          // Verify the writer/inspection kept the same title anchor as the layout.
          const drawn = result.value.inspection.elements.find((e) => e.key === "g:panel")
            ?.labels[0];
          expect(drawn?.anchor.x).toBeCloseTo(group.label.anchor.x, 2);
          expect(drawn?.anchor.y).toBeCloseTo(group.label.anchor.y, 2);
        }
      });
    }
  }
}
