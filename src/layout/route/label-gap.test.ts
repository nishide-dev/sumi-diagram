import { expect, test } from "bun:test";
import { getTheme } from "../../core/theme/builtin";
import { EDGE_LABEL_GAP, labelGap } from "./labels";

test("an edge label keeps the router's gap unless the theme sets one (#546)", () => {
  expect(labelGap(undefined)).toBe(EDGE_LABEL_GAP);
  expect(labelGap({ textScale: 2 })).toBe(EDGE_LABEL_GAP * 2);
  expect(labelGap({ labelGap: 6 })).toBe(6);
  expect(labelGap({ labelGap: 6, textScale: 1.5 })).toBe(9);
});

test("only the sumi themes widen the label gap, so the paper reproductions keep theirs (#546)", () => {
  expect(getTheme("sumi")?.edgeLabelGap).toBe(6);
  expect(getTheme("sumi-dark")?.edgeLabelGap).toBe(6);
  for (const id of ["paper", "llama", "minimal", "academic", "slides", "color"])
    expect(getTheme(id)?.edgeLabelGap, id).toBeUndefined();
});
