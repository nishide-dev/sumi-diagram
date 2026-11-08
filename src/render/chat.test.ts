import { expect, test } from "bun:test";
import { chatSource } from "../compiler/chat.fixture";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { lintGeometry } from "../lint";
import { inspection, label } from "../lint/geometry/testing";
import { svgToPdf } from "./pdf";
import { inspectPdf, textLines } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

test("structured chat exports bilingual text, avatars, meta and divider to SVG/PDF/PPTX", async () => {
  const r = await renderFigure(chatSource);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  expect([...r.diagnostics, ...lintGeometry(r.value)].filter((d) => d.severity !== "info")).toEqual(
    [],
  );
  const pdf = svgToPdf(r.value.svg);
  if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
  const info = inspectPdf(pdf.value);
  expect(info.images).toBe(0);
  const text = textLines(info.glyphs)
    .map((l) => l.text)
    .join("")
    .replaceAll(" ", "");
  for (const fragment of [
    "今日",
    "23:10",
    "既読",
    "Read",
    "次いつ遊ぶ",
    "ThisEnglishmessage",
    "おけ！",
  ])
    expect(text).toContain(fragment);
  const picture = svgToPptx(r.value.svg);
  expect(picture.ok).toBe(true);
  const editable = svgToEditablePptx(r.value.svg, r.value.compiled.ir);
  if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
  const slide = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
  for (const fragment of ["今日", "23:10", "既読", "Read", "n:m1", "chat-1-6-avatar"])
    expect(slide).toContain(fragment);
  expect(slide.match(/<a:custGeom/g)).toHaveLength(7); // Six bubbles and the plain group.
});

test("all built-in themes render chat with theme-owned muted notes and no geometry warnings", async () => {
  for (const theme of BUILTIN_THEMES.keys()) {
    const source =
      theme === "slides"
        ? chatSource
            .replace("paper-single", "presentation-16x9")
            .replace("width: 72mm", "width: 144mm")
            .replaceAll("16pt", "32pt")
        : chatSource;
    const r = await renderFigure(source, { overrides: { theme } });
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    expect(
      [...r.diagnostics, ...lintGeometry(r.value)].filter((d) => d.severity !== "info"),
    ).toEqual([]);
  }
});

test("generated meta notes contribute to collision lint and page width", async () => {
  const r = await renderFigure(chatSource);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  const findings = lintGeometry({
    compiled: r.value.compiled,
    inspection: inspection(r.value.compiled, {
      canvas: { x: 0, y: 0, width: 100, height: 100 },
      elements: {
        "n:m1": { bbox: { x: 10, y: 10, width: 80, height: 50 } },
        "n:chat-1-2-meta": { labels: [label("23:10", 30, 30)] },
      },
    }),
  });
  expect(findings.some((d) => d.code === "geometry/label-collision")).toBe(true);
  const wide = await renderFigure(
    chatSource.replace(
      'meta: "23:10"',
      'meta: "A very long annotation extending well beyond this conversation column"',
    ),
  );
  if (!wide.ok) throw new Error(JSON.stringify(wide.diagnostics));
  expect(wide.diagnostics.some((d) => d.code === "layout/chat-overflow")).toBe(true);
  expect(lintGeometry(wide.value).some((d) => d.code === "geometry/exceeds-page-width")).toBe(true);
  expect(wide.value.inspection.canvas.width.pt).toBeGreaterThan(r.value.inspection.canvas.width.pt);
});
