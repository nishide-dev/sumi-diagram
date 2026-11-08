import { expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { formatFigureSource } from "../core/figure/format";
import { ChatSchema } from "../core/figure/schema";
import { lintFigure } from "../lint";
import { chatSource } from "./chat.fixture";
import { compileFigure } from "./compile";

test("chat preserves authored IDs, inherits speaker paint and suppresses run horns", () => {
  const result = compileFigure(chatSource);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const ir = result.value.ir;
  const node = (id: string) => ir.nodes.find((n) => n.id === id);
  expect([1, 2, 3, 4, 5].map((i) => node(`m${i}`)?.render?.params?.tail)).toEqual([
    "left",
    "none",
    "right",
    "none",
    "left",
  ]);
  for (const i of [1, 2, 3, 4, 5]) {
    expect(node(`m${i}`)?.render?.params?.tailAt).toBe("start");
    expect(node(`m${i}`)?.textAlign).toBe("left");
    expect(node(`m${i}`)?.parent).toBe("g:conversation");
  }
  expect(node("m1")?.variant).toBe("default");
  expect(node("m1")?.style.fill).toBe("#ffffff");
  expect(node("m3")?.variant).toBe("filled");
  expect(node("m3")?.style.fill).not.toBe(node("m1")?.style.fill);
  expect(node("m2")?.label).toContain("\n");
  expect(node("m3")?.label).toContain("\n");
  expect(node("m3")?.label.replaceAll("\n", " ")).toBe(
    "This English message wraps at word boundaries within the maximum bubble width.",
  );
  const rows = ir.groups[0]?.arrange?.chat?.rows;
  expect(rows?.map((r) => !!r.avatar)).toEqual([false, true, false, false, false, true]);
  expect(rows?.[5]?.avatar).not.toBe(rows?.[1]?.avatar);
  expect(ir.sourceMap.get(rows?.[3]?.meta ?? "n:missing")?.path).toEqual([
    "groups",
    0,
    "arrange",
    "chat",
    "items",
    3,
    "meta",
  ]);
});

test("node tone and explicit default variant override speaker settings", () => {
  const r = compileFigure(
    chatSource.replace(
      "id: m3, component: bubble,",
      "id: m3, component: bubble, tone: orange, variant: default,",
    ),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  const n = r.value.ir.nodes.find((n) => n.id === "m3");
  expect(n?.variant).toBe("default");
  const check = checkFigure(
    chatSource.replace(
      "id: m3, component: bubble,",
      "id: m3, component: bubble, tone: orange, variant: default,",
    ),
  );
  expect(check.state.doc.nodes?.find((n) => n?.id === "m3")?.tone).toBe("orange");
});

test("authored bubble IDs remain valid edge endpoints", () => {
  const r = compileFigure(`${chatSource}\nedges: [{ from: m1, to: m3, label: reply }]\n`);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  expect(r.value.ir.edges[0]?.from).toBe("n:m1");
  expect(r.value.ir.edges[0]?.to).toBe("n:m3");
});

test("avatar edges connect only to the authored first occurrence", () => {
  const r = compileFigure(`${chatSource}\nedges: [{ from: avatar, to: m1 }]\n`);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  const rows = r.value.ir.groups[0]?.arrange?.chat?.rows;
  expect(rows?.[1]?.avatar).toBe("n:avatar");
  expect(rows?.[5]?.avatar).toBeDefined();
  expect(rows?.[5]?.avatar).not.toBe("n:avatar");
  expect(r.value.ir.edges).toHaveLength(1);
  expect(r.value.ir.edges[0]?.from).toBe(rows?.[1]?.avatar);
});

test("chat maxWidth overrides node maxWidth, including when chat uses its default", () => {
  for (const source of [chatSource, chatSource.replace("        maxWidth: 0.7\n", "")]) {
    const baseline = compileFigure(source);
    const overridden = compileFigure(
      source.replace(
        "id: m3, component: bubble,",
        "id: m3, component: bubble, props: { maxWidth: 10pt },",
      ),
    );
    if (!baseline.ok || !overridden.ok) throw new Error("chat must compile");
    expect(overridden.value.ir.nodes.find((n) => n.id === "m3")?.label).toBe(
      baseline.value.ir.nodes.find((n) => n.id === "m3")?.label,
    );
  }
});

test("chat errors identify unknown speakers, nodes, avatars, non-bubbles and duplicate placement", () => {
  for (const [source, code] of [
    [chatSource.replace("from: me", "from: missing"), "layout/chat-unknown-speaker"],
    [chatSource.replace("node: m1", "node: missing"), "layout/unknown-item"],
    [chatSource.replace("avatar: avatar", "avatar: missing"), "layout/chat-unknown-avatar"],
    [
      chatSource.replace("id: m1, component: bubble", "id: m1, component: box"),
      "layout/chat-non-bubble",
    ],
    [chatSource.replace("node: m2", "node: m1"), "layout/duplicate-placement"],
    [chatSource.replace("id: avatar,", "id: chat-1-1-divider,"), "ref/reserved-id"],
  ]) {
    const r = compileFigure(source as string, { file: "chat.sumi.yaml" });
    expect(r.ok).toBe(false);
    const diagnostic = r.diagnostics.find((d) => d.code === code);
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.location?.file).toBe("chat.sumi.yaml");
  }
});

test("chat schema accepts a fractional or physical maximum and rejects invalid dimensions", () => {
  const spec = { speakers: { me: { side: "right" } }, items: [{ node: "m", from: "me" }] };
  expect(ChatSchema.parse({ ...spec, maxWidth: "0.5pt" }).maxWidth).toEqual({ pt: 0.5 });
  for (const extra of [
    { width: 0 },
    { width: "-1mm" },
    { maxWidth: 1.1 },
    { maxWidth: 0 },
    { maxWidth: "0pt" },
  ])
    expect(ChatSchema.safeParse({ ...spec, ...extra }).success).toBe(false);
});

test("format preserves chat semantics and comments", () => {
  const r = formatFigureSource(
    chatSource.replace("        maxWidth:", "        # Keep bubbles narrow\n        maxWidth:"),
    { canonicalOrder: true },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  expect(r.text).toContain("# Keep bubbles narrow");
  expect(compileFigure(r.text).ok).toBe(true);
});

test("conversation nodes do not require graph edges", () => {
  const result = lintFigure(chatSource);
  expect(result.exitCode).toBe(0);
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(result.diagnostics.some((d) => d.code === "lint/no-edges")).toBe(false);
  expect(result.diagnostics.some((d) => d.code === "lint/long-label")).toBe(false);
});
