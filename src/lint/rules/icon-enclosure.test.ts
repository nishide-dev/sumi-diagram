/** `lint/icon-enclosure` (#424): an icon wrapped in a plain frame only to enlarge it. */

import { describe, expect, test } from "bun:test";
import { lintFigure } from "..";

const figure = (node: string) =>
  `version: 1\nfigure: { id: f }\nnodes:\n  - ${node}\n  - { id: other, component: box, label: Other }\nedges:\n  - { from: a, to: other }\n`;

const enclosure = (node: string) =>
  lintFigure(figure(node)).diagnostics.filter((d) => d.code === "lint/icon-enclosure");

describe("lint/icon-enclosure", () => {
  test.each(["circle", "box"])(
    "a plain %s with only an icon is an info that suggests iconSize",
    (c) => {
      const found = enclosure(`{ id: a, component: ${c}, icon: tabler/database }`);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ severity: "info", path: ["nodes", 0, "component"] });
      expect(found[0]?.hint).toContain("iconSize");
    },
  );

  test.each([
    ["a tone", "{ id: a, component: circle, icon: tabler/database, tone: blue }"],
    ["a variant", "{ id: a, component: circle, icon: tabler/database, variant: tinted }"],
    [
      "an explicit size",
      "{ id: a, component: circle, icon: tabler/database, props: { width: 30pt } }",
    ],
    ["an iconSize", "{ id: a, component: circle, icon: tabler/database, iconSize: 2 }"],
    [
      "a badge",
      "{ id: a, component: box, icon: tabler/database, badge: { icon: emoji/fire, corner: north-east } }",
    ],
    ["a bare label", "{ id: a, component: label, icon: tabler/database }"],
    ["a text label", "{ id: a, component: box, label: Store }"],
  ])("%s is not reported", (_, node) => {
    expect(enclosure(node)).toEqual([]);
  });

  test("legend samples are not reported", () => {
    const text =
      "version: 1\nfigure: { id: f, layout: { arrange: { stack: { items: [a, key] } } } }\nnodes:\n  - { id: a, component: label, icon: tabler/flame }\n  - { id: key, component: legend, props: { entries: [{ icon: tabler/flame, label: Fire }] } }\n";
    expect(lintFigure(text).diagnostics.filter((d) => d.code === "lint/icon-enclosure")).toEqual(
      [],
    );
  });
});
