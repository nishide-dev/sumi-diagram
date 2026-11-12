import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { editableCorpus } from "../../../scripts/pptx-validator/editable-corpus";
import { parseLabel } from "../../core/label/math";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../../core/theme/fonts";
import { attribute, childElements, descendants, parseXml, textContent } from "../xml";
import { splitMaskedPath, svgToEditablePptx } from "./editable";
import { readPptx } from "./testing";

const root = resolve(import.meta.dir, "../../..");
const update = process.env.SUMI_UPDATE_GOLDEN === "1";
const corpus = editableCorpus();
const goldenDir = resolve(root, "tests/fixtures/pptx-editable");
const hashPath = resolve(root, "tests/fixtures/pptx-editable-sha256.json");
const hashes = JSON.parse(readFileSync(hashPath, "utf8")) as Record<string, string>;
const actual: Record<string, string> = {};
if (update) mkdirSync(goldenDir, { recursive: true });
test("editable corpus includes every current component and examples", () =>
  expect(corpus.length).toBeGreaterThanOrEqual(53));
// Glued connectors cannot keep a cubic tangent: a figure with curved edges (#420) is
// exported with freeform connectors only and refused, with a diagnostic, when glued.
const hasCurve = (item: (typeof corpus)[number]) =>
  [...item.ir.elements.values()].some((e) => e.kind === "edge" && e.route === "curve");
for (const item of corpus)
  for (const connectors of ["freeform", "glued"] as const) {
    if (connectors === "glued" && hasCurve(item)) {
      test(`${item.id}: editable glued refuses curved edges`, () => {
        const result = svgToEditablePptx(item.svg, item.ir, { connectors });
        expect(result.ok).toBe(false);
        expect(result.diagnostics.map((d) => d.code)).toContain("pptx/unsupported-geometry");
      });
      continue;
    }
    test(`${item.id}: editable ${connectors}`, () => {
      const result = svgToEditablePptx(item.svg, item.ir, { connectors });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.diagnostics.map((d) => d.code)).toContain("pptx/experimental-editable");
      const parts = readPptx(result.value);
      expect([...parts.keys()].some((p) => p.startsWith("ppt/media/"))).toBe(false);
      for (const [name, bytes] of parts)
        if (name.endsWith(".xml") || name.endsWith(".rels"))
          expect(parseXml(new TextDecoder().decode(bytes)).ok).toBe(true);
      const slide = new TextDecoder().decode(parts.get("ppt/slides/slide1.xml"));
      const parsed = parseXml(slide);
      if (!parsed.ok) throw new Error(parsed.message);
      const all = [...descendants(parsed.root)];
      expect(all.some((e) => e.name === "p:pic")).toBe(false);
      const names = new Map(
        all
          .filter((e) => e.name === "p:cNvPr")
          .map((e) => [attribute(e, "name"), attribute(e, "id")]),
      );
      const ids = all.filter((e) => e.name === "p:cNvPr").map((e) => attribute(e, "id"));
      expect(new Set(ids).size).toBe(ids.length);
      for (const element of item.ir.elements.values()) {
        expect(names.has(element.key)).toBe(true);
        const shape = all.find(
          (e) =>
            ["p:sp", "p:cxnSp"].includes(e.name) &&
            [...descendants(e)].some(
              (n) => n.name === "p:cNvPr" && attribute(n, "name") === element.key,
            ),
        );
        expect(shape).toBeDefined();
        if (!shape) continue;
        if (element.kind === "node" && element.render?.renderer === "sumi/waveform") {
          const group = all.find((e) => e.name === "p:grpSp" && childElements(e).includes(shape));
          expect(group).toBeDefined();
          if (!group) throw new Error(`Missing waveform group ${element.key}`);
          expect(childElements(group).map((e) => e.name)).toEqual([
            "p:nvGrpSpPr",
            "p:grpSpPr",
            "p:sp",
            "p:sp",
          ]);
          const children = childElements(group).filter((e) => e.name === "p:sp");
          expect(children[0]).toBe(shape);
          const signal = children[1];
          if (!signal) throw new Error("Missing waveform signal");
          const signalProperties = [...descendants(signal)].find((e) => e.name === "p:cNvPr");
          expect(signalProperties && attribute(signalProperties, "name")).toBe(
            `${element.key} signal`,
          );
          const transform = [...descendants(group)].find((e) => e.name === "a:xfrm");
          if (!transform) throw new Error("Missing waveform group transform");
          const [off, ext, chOff, chExt] = childElements(transform);
          if (!off || !ext) throw new Error("Missing waveform group bounds");
          expect(childElements(transform).map((e) => e.name)).toEqual([
            "a:off",
            "a:ext",
            "a:chOff",
            "a:chExt",
          ]);
          expect(chOff?.attributes).toEqual(off?.attributes);
          expect(chExt?.attributes).toEqual(ext?.attributes);
          for (const child of children) {
            const childTransform = [...descendants(child)].find((e) => e.name === "a:xfrm");
            expect(
              childTransform && childElements(childTransform).map((e) => e.attributes),
            ).toEqual([off.attributes, ext.attributes]);
          }
          // Glued edges must keep referring to the frame inside the group.
          expect(names.get(element.key)).toBe(
            String([...item.ir.elements.keys()].indexOf(element.key) + 2),
          );
          expect(names.get(`${element.key} waveform`)).not.toBe(names.get(element.key));
        }
        if (element.kind === "edge") {
          // A zoom edge (#176) is two lines between corners: a freeform shape in either mode.
          const glued = connectors === "glued" && element.routing !== "zoom";
          expect(shape.name).toBe(glued ? "p:cxnSp" : "p:sp");
          if (glued) {
            const refs = [...descendants(shape)].filter((e) =>
              ["a:stCxn", "a:endCxn"].includes(e.name),
            );
            expect(refs.map((e) => attribute(e, "id"))).toEqual([
              names.get(element.from),
              names.get(element.to),
            ]);
          }
        } else if (element.label.trim()) {
          // A caption below a waveform's frame (#491) is a text box of its own.
          const textShape =
            element.kind === "node" && element.labelBelow
              ? all.find(
                  (e) =>
                    e.name === "p:sp" &&
                    [...descendants(e)].some(
                      (n) =>
                        n.name === "p:cNvPr" && attribute(n, "name") === `${element.key} label`,
                    ),
                )
              : shape;
          const tx = textShape && childElements(textShape).find((e) => e.name === "p:txBody");
          expect(tx).toBeDefined();
          // Label math (#93) is written as its characters (a matrix's headers, #180).
          // A node's sublabel (#184) follows its label in the same text body, or,
          // when paragraph spacing cannot place it, is a text box of its own.
          const plain = (source: string) => {
            const parsed = parseLabel(source);
            return parsed.ok
              ? parsed.value.lines.flatMap((line) => line.map((run) => run.text)).join("")
              : source;
          };
          const squeeze = (source: string) => source.replace(/\s/g, "");
          const sublabel = "sublabel" in element ? element.sublabel : undefined;
          const label = squeeze(plain(element.label));
          const own = squeeze(sublabel ? plain(sublabel.text) : "");
          const received = tx ? squeeze(textContent(tx)) : undefined;
          if (sublabel && received === label) {
            const box = all.find(
              (e) =>
                e.name === "p:sp" &&
                [...descendants(e)].some(
                  (n) => n.name === "p:cNvPr" && attribute(n, "name") === `${element.key} sublabel`,
                ),
            );
            const boxText = box && childElements(box).find((e) => e.name === "p:txBody");
            expect(boxText && squeeze(textContent(boxText))).toBe(own);
          } else {
            expect(received).toBe(label + own);
          }
        }
      }
      const golden = resolve(goldenDir, `${item.id.replaceAll("/", "_")}.${connectors}.xml`);
      if (update) writeFileSync(golden, `${slide}\n`);
      expect(`${slide}\n`).toBe(readFileSync(golden, "utf8"));
      const again = svgToEditablePptx(item.svg, item.ir, { connectors });
      const hash = new Bun.CryptoHasher("sha256").update(result.value).digest("hex");
      expect(again.ok && new Bun.CryptoHasher("sha256").update(again.value).digest("hex")).toBe(
        hash,
      );
      const key = `${item.id}.${connectors}`;
      actual[key] = hash;
      if (!update) {
        const expected = hashes[key];
        if (!expected) throw new Error(`Missing native golden ${key}`);
        expect(hash).toBe(expected);
      }
    });
  }
test("native package manifest covers the corpus", () => {
  if (update) writeFileSync(hashPath, `${JSON.stringify(actual, null, 2)}\n`);
  else
    expect(Object.keys(hashes).sort()).toEqual(
      corpus
        .flatMap((item) =>
          hasCurve(item) ? [`${item.id}.freeform`] : [`${item.id}.freeform`, `${item.id}.glued`],
        )
        .sort(),
    );
});
test("unsupported native input is a diagnostic, not a damaged package", () => {
  const item = corpus[0];
  if (!item) throw new Error("Empty corpus");
  expect(svgToEditablePptx("<svg", item.ir).ok).toBe(false);
  expect(svgToEditablePptx(item.svg, item.ir, { connectors: "bad" as "freeform" }).ok).toBe(false);
  const fontSet = getFontSet(DEFAULT_FONT_SET_ID);
  if (!fontSet) throw new Error("Missing fonts");
  const missing = svgToEditablePptx(item.svg, item.ir, {
    fontSet: { ...fontSet, regular: "/missing/editable-font.ttf" },
  });
  expect(missing.diagnostics[0]?.code).toBe("pptx/missing-font");
});

test("D2 edge labels honor an explicit rectangle but masks never paint a fill", () => {
  const item = corpus.find((c) => c.id === "examples/decision-flow/decision-flow");
  if (!item) throw new Error("missing decision-flow");
  const fills = (svg: string) => {
    const result = svgToEditablePptx(svg, item.ir);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const slide = new TextDecoder().decode(readPptx(result.value).get("ppt/slides/slide1.xml"));
    return [
      ...slide.matchAll(
        /name="e:#\d+ label 0"\/>.*?<\/a:prstGeom>(<a:noFill\/>|<a:solidFill><a:srgbClr val="([0-9A-F]{6})">)/g,
      ),
    ].map((m) => m[2] ?? "none");
  };
  const rect =
    /<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" rx="10" fill="#ffffff" \/>(?=<text)/g;
  const boxed = item.svg.replace(
    /(?=<text[^>]*>)/g,
    '<rect x="1" y="1" width="1" height="1" rx="10" fill="#ffffff" />',
  );
  const count = fills(item.svg).length;
  expect(count).toBeGreaterThan(0);
  expect(fills(item.svg)).toEqual(Array(count).fill("none"));
  expect(fills(boxed.replace(rect, (r) => r.replace("#ffffff", "#ff0000")))).toEqual(
    Array(count).fill("FF0000"),
  );
  const unboxed = item.svg;
  expect(unboxed).toContain('mask="url(#');
  expect(fills(unboxed)).toEqual(Array(count).fill("none"));
  expect(fills(unboxed.replace(/ mask="url\(#[^"]*\)"/g, ""))).toEqual(Array(count).fill("none"));
});

test("mask rectangles split a line into separate visible segments", () => {
  const parts = splitMaskedPath(
    [
      { command: "M", to: { x: 0, y: 5 } },
      { command: "L", to: { x: 100, y: 5 } },
    ],
    [{ x: 40, y: 0, width: 20, height: 10 }],
  );
  expect(parts.map((part) => part.map((p) => p.to.x))).toEqual([
    [0, 40],
    [60, 100],
  ]);
});

test("editable freeform writes separate arrow segments around a D2 label", () => {
  const item = corpus.find((c) => c.id === "docs/gallery/components/sumi-double-arrow.minimal");
  if (!item) throw new Error("missing double arrow");
  const result = svgToEditablePptx(item.svg, item.ir);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const slide = new TextDecoder().decode(readPptx(result.value).get("ppt/slides/slide1.xml"));
  const edges = [
    ...slide.matchAll(/<p:sp><p:nvSpPr><p:cNvPr id="\d+" name="e:#0"\/>.*?<\/p:sp>/g),
  ].map((m) => m[0]);
  expect(edges).toHaveLength(2);
  expect(edges[0]).toContain("<a:headEnd ");
  expect(edges[0]).not.toContain("<a:tailEnd ");
  expect(edges[1]).toContain("<a:tailEnd ");
  expect(edges[1]).not.toContain("<a:headEnd ");
});

test("glued masked labels use a canvas patch or split transparent edges", () => {
  const item = corpus.find((c) => c.id === "docs/gallery/components/sumi-double-arrow.minimal");
  if (!item) throw new Error("missing double arrow");
  const slideFor = (transparent: boolean) => {
    const ir = { ...item.ir, meta: { ...item.ir.meta, transparentBackground: transparent } };
    const result = svgToEditablePptx(item.svg, ir, { connectors: "glued" });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    return new TextDecoder().decode(readPptx(result.value).get("ppt/slides/slide1.xml"));
  };
  const opaque = slideFor(false);
  expect(opaque).toContain("<a:stCxn ");
  expect(opaque).toContain("<a:endCxn ");
  expect(opaque).toMatch(/name="e:#0 label 0"\/>.*?<a:solidFill><a:srgbClr val="FFFFFF"/);
  const transparent = slideFor(true);
  expect(transparent).not.toContain("<a:stCxn ");
  expect(transparent.match(/name="e:#0"\/>/g)).toHaveLength(2);
  expect(transparent).toMatch(/name="e:#0 label 0"\/>.*?<a:noFill\/>/);
});

test("transparent glued exports split only edges whose route runs under a label mask", () => {
  // D2 shares one label mask between all edges: an edge without a label of its
  // own on its line has no gap to keep and stays a glued connector.
  for (const id of ["examples/pipeline/pipeline", "examples/decision-flow/decision-flow"]) {
    const item = corpus.find((c) => c.id === id);
    if (!item) throw new Error(`missing ${id}`);
    const ir = { ...item.ir, meta: { ...item.ir.meta, transparentBackground: true } };
    const result = svgToEditablePptx(item.svg, ir, { connectors: "glued" });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const slide = new TextDecoder().decode(readPptx(result.value).get("ppt/slides/slide1.xml"));
    const glued = (key: string) =>
      new RegExp(`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="\\d+" name="${key}"/>`).test(slide);
    const labelled = ir.edges.filter((e) => e.label !== "");
    const plain = ir.edges.filter((e) => e.label === "");
    expect(labelled.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);
    for (const edge of labelled) expect([edge.key, glued(edge.key)]).toEqual([edge.key, false]);
    for (const edge of plain) expect([edge.key, glued(edge.key)]).toEqual([edge.key, true]);
    // No label of a transparent export gets a canvas patch.
    expect(slide).not.toMatch(/label 0"\/>(?:(?!<\/p:sp>).)*<a:solidFill><a:srgbClr val="FFFFFF"/);
  }
});
