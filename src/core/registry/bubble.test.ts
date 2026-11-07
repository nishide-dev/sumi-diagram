import { expect, test } from "bun:test";
import { compileFigure } from "../../compiler/compile";
import { BUILTIN_THEMES } from "../theme/builtin";
import { builtinRegistry } from "./builtins";

test("bubble has documented props, variants, defaults and strict length validation", () => {
  const manifest = builtinRegistry().get("sumi/bubble");
  if (!manifest) throw new Error("missing bubble");
  expect(manifest.since).toBe("0.16.0");
  expect(manifest.props.parse({})).toEqual({ tail: "none" });
  for (const tail of ["none", "left", "right", "top", "bottom"])
    for (const tailAt of ["start", "center", "end", "12pt"])
      expect(manifest.props.safeParse({ tail, tailAt, tailSize: "4pt" }).success).toBe(true);
  for (const props of [
    { tail: "north" },
    { tailAt: -1 },
    { tailSize: "0pt" },
    { tailSize: "1.1pt" },
    { maxWidth: 80 },
    { unknown: true },
  ])
    expect(manifest.props.safeParse(props).success).toBe(false);
});

test("all themes resolve every variant and tone without fallback; filled and solid are borderless", () => {
  const manifest = builtinRegistry().get("sumi/bubble");
  if (!manifest) throw new Error("missing bubble");
  for (const theme of BUILTIN_THEMES.keys())
    for (const variant of manifest.variants) {
      const result = compileFigure(`version: 1
figure: { id: bubble-style, theme: ${theme}, profile: paper-double }
nodes: [{id: a, component: bubble, label: Hello, variant: ${variant}, tone: green}]
`);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.diagnostics).toEqual([]);
      const n = result.value.ir.nodes[0];
      if (!n) throw new Error("missing bubble");
      if (variant === "filled" || variant === "solid") expect(n.style.strokeWidth.pt).toBe(0);
      expect(n.render?.params?.tailSize).toBe(n.style.fontSize.units * 1.1 * 0.6);
      expect(n.render?.params?.radius).toBe(n.style.fontSize.units * 1.1);
    }
});
