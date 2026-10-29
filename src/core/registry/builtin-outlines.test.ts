import { expect, test } from "bun:test";
import { createBuiltinRegistry } from "./builtins";
import { buildCatalog } from "./catalog";

const registry = createBuiltinRegistry();
for (const [name, params] of [
  ["trapezoid", { slant: 0.4 }],
  ["stack", { layers: 3, offset: 8 }],
  ["bowtie", {}],
] as const) {
  test(`${name}: manifest, catalog and short-name resolution describe the public component`, () => {
    const resolved = registry.resolve(name, "node");
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
    expect(registry.resolve(`sumi/${name}`, "node")).toEqual(resolved);
    expect(resolved.value).toMatchObject({
      kind: "node",
      shape: "rectangle",
      sizing: "auto",
      since: name === "bowtie" ? "0.7.0" : "0.3.0",
      // A stack has no `filled` (#174): without outlines its rectangles merge.
      variants: [
        "default",
        "emphasis",
        "muted",
        ...(name === "stack" ? [] : ["filled"]),
        "outlined",
        "solid",
        "tinted",
      ],
      render: { type: "outline", renderer: `sumi/${name}`, params },
    });
    const entry = buildCatalog(registry).components.find((e) => e.id === `sumi/${name}`);
    expect(entry?.description.length).toBeGreaterThan(20);
    expect(entry?.kind === "node" && entry.render).toEqual(resolved.value.render);
    expect(Object.keys(entry?.props.properties ?? {}).sort()).toEqual(["height", "width"]);
    for (const prop of Object.values(entry?.props.properties ?? {})) {
      expect(prop).toMatchObject({
        type: "string",
        description: expect.stringContaining("Explicit"),
      });
    }
    expect(registry.validateUsage(resolved.value).diagnostics).toEqual([]);
    expect(
      registry.validateUsage(resolved.value, { props: { width: "40pt", height: "30pt" } }),
    ).toMatchObject({ ok: true, value: { props: { width: 40, height: 30 } } });
    for (const prop of ["slant", "layers", "offset", "render"]) {
      expect(
        registry.validateUsage(resolved.value, { props: { [prop]: 1 } }).diagnostics[0],
      ).toMatchObject({ code: "component/unknown-prop", path: ["props", prop] });
    }
  });
}
