import { expect, test } from "bun:test";
import { chatSource } from "../../compiler/chat.fixture";
import { compileFigure } from "../../compiler/compile";
import type { Rect } from "../../core/geometry";
import { placeStructured } from "./engine";

function layout(source = chatSource) {
  const c = compileFigure(source);
  if (!c.ok) throw new Error(JSON.stringify(c.diagnostics));
  const p = placeStructured(c.value.ir);
  const rect = (key: string): Rect => {
    const n = p.layout.nodes.find((n) => n.key === key);
    if (!n) throw new Error(`missing ${key}`);
    return n.rect;
  };
  return { ...p, ir: c.value.ir, rect };
}
const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;

test("chat sides, constant body indent, run gaps and top-aligned avatars", () => {
  const p = layout();
  const rows = p.ir.groups[0]?.arrange?.chat?.rows;
  if (!rows) throw new Error("missing rows");
  const a = p.rect("n:m1"),
    b = p.rect("n:m2"),
    c = p.rect("n:m3"),
    d = p.rect("n:m4");
  const horn = p.ir.nodes.find((n) => n.id === "m1")?.render?.params?.tailSize as number;
  expect(b.x).toBeCloseTo(a.x + horn, 3);
  expect(right(d)).toBeCloseTo(right(c) - horn, 3);
  expect(a.x).toBeLessThan(c.x);
  expect(b.y - bottom(a)).toBeLessThan(c.y - bottom(b));
  expect(p.rect(rows[1]?.avatar ?? "missing").y).toBe(a.y);
  expect(p.rect(rows[5]?.avatar ?? "missing").y).toBe(p.rect("n:m5").y);
  expect(p.diagnostics).toEqual([]);
});

test("continuations keep the run-start horn reserve even with a custom tail size", () => {
  const p = layout(
    chatSource.replace(
      "id: m1, component: bubble,",
      "id: m1, component: bubble, props: { tailSize: 10pt },",
    ),
  );
  expect(p.rect("n:m2").x).toBeCloseTo(p.rect("n:m1").x + 20, 3);
});

test("meta notes sit on the inner side, bottom-aligned; divider is centered", () => {
  const p = layout();
  const box = p.ir.groups[0]?.arrange;
  const rows = box?.chat?.rows;
  if (!rows) throw new Error("missing rows");
  for (const row of rows) {
    if (!row.meta) continue;
    const bubble = p.rect(row.node),
      meta = p.rect(row.meta);
    expect(bottom(meta)).toBeCloseTo(bottom(bubble), 3);
    if (row.side === "left") expect(meta.x).toBeGreaterThan(right(bubble));
    else expect(right(meta)).toBeLessThan(bubble.x);
  }
  const pill = p.rect(rows[0]?.node ?? "missing");
  const content = p.layout.groups[0]?.content;
  if (!content) throw new Error("missing group content");
  expect(Math.abs(pill.x + pill.width / 2 - content.x - content.width / 2)).toBeLessThanOrEqual(
    0.001,
  );
  for (const id of ["m2", "m3"])
    expect(p.rect(`n:${id}`).width).toBeLessThanOrEqual((box?.chat?.widthPt ?? 0) * 2 * 0.7);
});

test("physical maxWidth, nesting, divider run reset, profile defaults and overflow", () => {
  const p = layout(chatSource.replace("maxWidth: 0.7", "maxWidth: 100pt"));
  expect(p.rect("n:m2").width).toBeLessThanOrEqual(200);
  const reset = layout(
    chatSource.replace("- { node: m2", "- divider: 明日\n          - { node: m2"),
  );
  expect(reset.ir.nodes.find((n) => n.id === "m2")?.render?.params?.tail).toBe("left");
  expect(layout(chatSource.replace("width: 72mm", "")).diagnostics).toEqual([]);
  const narrow = layout(chatSource.replace("width: 72mm", "width: 20pt"));
  expect(narrow.diagnostics.some((d) => d.code === "layout/chat-overflow")).toBe(true);
});

test("root chat reserves the full column even for a single short incoming message", () => {
  const p = layout(`version: 1
figure:
  id: one-message
  layout:
    arrange:
      chat:
        width: 80mm
        speakers: { friend: { side: left } }
        items: [{ node: m, from: friend }]
nodes: [{ id: m, component: bubble, label: Hi }]
`);
  expect(p.layout.content.width).toBeCloseTo(((80 * 72) / 25.4) * 2, 2);
});

test("nested chat stays rigid under parent stretch and compact spacing follows the profile", () => {
  const source = `version: 1
figure:
  id: nested-chat
  profile: paper-double
  layout:
    arrange:
      row:
        align: stretch
        items:
          - chat:
              width: 80mm
              speakers: { friend: { side: left } }
              items: [{ node: a, from: friend }, { node: b, from: friend }]
          - tall
nodes:
  - { id: a, component: bubble, label: Hi }
  - { id: b, component: bubble, label: Again }
  - { id: tall, component: box, props: { height: 120pt } }
`;
  const normal = layout(source),
    compact = layout(source.replace("layout:", "layout:\n    density: compact"));
  const a = normal.rect("n:a"),
    b = normal.rect("n:b"),
    tall = normal.rect("n:tall");
  expect(a.height).toBeLessThan(tall.height / 2);
  expect((a.y + bottom(b)) / 2).toBeCloseTo(tall.y + tall.height / 2, 3);
  expect(compact.rect("n:b").y - bottom(compact.rect("n:a"))).toBeLessThan(b.y - bottom(a));
});
