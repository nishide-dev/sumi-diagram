import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { HintTrials, MAX_HINT_ELEMENTS, MAX_HINT_TRIALS } from "./hint-trials";
import { layoutStructuredFigure } from "./index";

function figure(count = 4) {
  const result = layoutStructuredFigure(
    stringify({
      version: 1,
      figure: {
        id: "trials",
        theme: "paper",
        profile: "paper-single",
        layout: {
          arrange: {
            row: {
              gap: "20pt",
              items: Array.from({ length: count }, (_, i) => `n${i}`),
            },
          },
        },
      },
      nodes: Array.from({ length: count }, (_, i) => ({
        id: `n${i}`,
        component: "box",
        label: "Wide label",
      })),
      edges: [],
    }),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

test("performance guard: at most six trials; large figures and auto figures do zero layout work", () => {
  const { ir } = figure();
  const first = ir.nodes[0];
  const arrange = ir.arrange;
  if (!first || !arrange) throw new Error("missing fixture node/arrange");
  const trials = new HintTrials(ir);
  for (let i = 0; i < 20; i++) trials.run(ir);
  expect(trials.count).toBe(MAX_HINT_TRIALS);
  const large = {
    ...ir,
    elements: new Map(
      Array.from({ length: MAX_HINT_ELEMENTS + 1 }, (_, i) => [`n:${i}` as const, first]),
    ),
  };
  const huge = { ...ir, arrange: { ...arrange, items: Array(241).fill(null) } };
  const auto = { ...ir, meta: { ...ir.meta, engine: "auto" as const } };
  for (const skipped of [large, huge, auto]) {
    const guard = new HintTrials(skipped);
    expect(guard.run(skipped)).toBeUndefined();
    expect(guard.count).toBe(0);
  }
});
