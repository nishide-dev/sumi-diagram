/** HTML's async resource boundary, including source-mapped measurement lint. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Renderer } from "@takumi-rs/wasm/node";
import type { FigureIR } from "../compiler/ir";
import type { ElementKey } from "../core/check-state";
import type { Diagnostic } from "../core/diagnostics";
import type { Locator } from "../core/figure/yaml";
import type { Result } from "../core/result";
import { getTheme } from "../core/theme/builtin";
import { FONT_ASSETS_DIR } from "../core/theme/fonts";
import type { Theme } from "../core/theme/schema";
import { loadGlyphCoverage } from "../lint/cmap";
import { formatCodePoint, glyphCodePoints } from "../lint/text";
import { loadEngine, runEngine } from "../render/pdf/engine";
import { validateHtml } from "./html";
import { validCssValue } from "./html-css";
import { type HtmlMeasurement, htmlOverflows, locateHtmlMeasurement } from "./html-measure";

/** Fixed order, local bundled bytes only. Never use Takumi's URL resource APIs. */
function bundledFonts() {
  return [
    ["BIZ UDPGothic", "biz-ud-gothic/BIZUDPGothic-Regular.ttf", 400],
    ["BIZ UDPGothic", "biz-ud-gothic/BIZUDPGothic-Bold.ttf", 700],
    ["Inter", "inter/Inter-Regular.ttf", 400],
    ["Inter", "inter/Inter-Bold.ttf", 700],
    ["BIZ UDGothic", "biz-ud-gothic/BIZUDGothic-Regular.ttf", 400],
  ].map(([name, path, weight]) => ({
    name: String(name),
    path: join(FONT_ASSETS_DIR, String(path)),
    data: readFileSync(join(FONT_ASSETS_DIR, String(path))),
    weight: Number(weight),
  }));
}

export function htmlThemeVariables(theme: Theme): Record<string, string> {
  const color = (token: string, fallback: string) => {
    const t = theme.tokens.get(token);
    return t?.type === "color" ? String(t.value) : fallback;
  };
  const variables = {
    "--sumi-fg": color("color.fg", String(theme.base.node.fontColor ?? "#222222")),
    "--sumi-muted": color("color.muted", "#666666"),
    "--sumi-accent": String(
      theme.toneLines.get("blue")?.stroke ?? theme.base.node.stroke ?? "#333333",
    ),
    "--sumi-bg": color("color.bg", "#ffffff"),
    "--sumi-font": theme.fontSet.latin ? "'Inter','BIZ UDPGothic'" : "'BIZ UDPGothic'",
    "--sumi-mono": "'BIZ UDGothic'",
  };
  for (const [name, value] of Object.entries(variables)) {
    const property = name === "--sumi-font" || name === "--sumi-mono" ? "font-family" : "color";
    if (!validCssValue(property, value)) throw new Error(`Invalid injected HTML variable ${name}.`);
  }
  return variables;
}

export function prepareHtml(
  source: string,
  viewport: { width: number; height: number },
  theme: Theme,
): string {
  const vars = Object.entries(htmlThemeVariables(theme))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return `<div style="${vars};width:${viewport.width}px;height:${viewport.height}px;font-family:var(--sumi-font);color:var(--sumi-fg);box-sizing:border-box">${source}</div>`;
}

export async function renderHtmlAssets(
  ir: FigureIR,
  options: { locate?: Locator; onMeasure?: (key: ElementKey, value: HtmlMeasurement) => void } = {},
): Promise<Result<ReadonlyMap<ElementKey, string>>> {
  const svgs = new Map<ElementKey, string>();
  const diagnostics: Diagnostic[] = [];
  for (const node of ir.nodes) {
    const image = node.image;
    if (image?.html === undefined) continue;
    try {
      const issue = validateHtml(image.html)[0];
      if (issue) throw new Error(issue.message);
      if (!image.viewport) throw new Error("Missing HTML viewport.");
      const theme = getTheme(ir.meta.themeId);
      if (!theme) throw new Error("Missing HTML theme.");
      const fonts = bundledFonts();
      const renderer = new Renderer();
      // Each renderer starts fresh. Explicit families select our supplied fonts;
      // glyph lint below excludes Takumi's retained bundled Geist fallback.
      const prepared = prepareHtml(image.html, image.viewport, theme);
      let raw: string;
      let measurement: HtmlMeasurement;
      try {
        raw = await renderer.renderSvg(prepared, { ...image.viewport, fonts });
        measurement = locateHtmlMeasurement(
          image.html,
          htmlThemeVariables(theme),
          await renderer.measure(prepared, { ...image.viewport, fonts }),
        );
      } finally {
        renderer.free();
      }
      options.onMeasure?.(node.key, measurement);
      const reportedOverflow = new Set<number>();
      const report = (code: string, message: string, offset: number, hint: string) => {
        const location =
          options.locate?.(image.srcAt.path, {
            span: [offset, offset],
            literalBlock: true,
          }) ?? image.srcAt.location;
        diagnostics.push({
          code,
          severity: "warning",
          message,
          hint,
          path: [...image.srcAt.path],
          ...(location && { location }),
          subject: { kind: "node", id: node.id },
        });
      };
      for (const entry of [...measurement.boxes, ...measurement.texts]) {
        if (!htmlOverflows(entry.box, image.viewport) || reportedOverflow.has(entry.offset))
          continue;
        reportedOverflow.add(entry.offset);
        report(
          "asset/html-overflow",
          `HTML content of node "${node.id}" extends beyond its ${image.viewport.width}×${image.viewport.height} CSS px viewport.`,
          entry.offset,
          "Increase viewport, reduce CSS dimensions/spacing, or wrap/reposition the offending element. Increasing only the placed width/height does not fix clipping.",
        );
      }
      const missingByElement = new Map<number, Set<number>>();
      for (const run of measurement.texts) {
        const paths = run.families.flatMap((family) => {
          const faces = fonts.filter((f) => f.name === family);
          const face = faces.find((f) => f.weight === (run.weight > 500 ? 700 : 400)) ?? faces[0];
          return face ? [face.path] : [];
        });
        const missing = glyphCodePoints(run.text).filter(
          (cp) => !paths.some((path) => loadGlyphCoverage(path).has(cp)),
        );
        if (!missing.length) continue;
        const set = missingByElement.get(run.offset) ?? new Set<number>();
        for (const cp of missing) set.add(cp);
        missingByElement.set(run.offset, set);
      }
      for (const [offset, cps] of missingByElement) {
        const missing = [...cps];
        const listed = missing
          .slice(0, 10)
          .map((cp) => `"${String.fromCodePoint(cp)}" (${formatCodePoint(cp)})`);
        if (missing.length > 10) listed.push(`and ${missing.length - 10} more`);
        report(
          "lint/missing-glyph",
          `HTML text of node "${node.id}" has characters missing from its selected bundled fonts: ${listed.join(", ")}.`,
          offset,
          "Replace the characters or select a bundled font-family (or family list) that covers them. Takumi's built-in Geist fallback does not count as coverage.",
        );
      }
      const normalized = runEngine(
        loadEngine(),
        new TextEncoder().encode(raw),
        fonts.map((f) => f.data),
        "picture",
      );
      if (!normalized.ok) throw new Error(normalized.message);
      const pngLength = new DataView(normalized.pdf.buffer, normalized.pdf.byteOffset).getUint32(
        0,
        true,
      );
      svgs.set(node.key, new TextDecoder().decode(normalized.pdf.subarray(4 + pngLength)));
    } catch (e) {
      diagnostics.push({
        code: "asset/invalid-image",
        severity: "error",
        message: `HTML rendering failed: ${e instanceof Error ? e.message : String(e)}`,
        path: [...image.srcAt.path],
        ...(image.srcAt.location && { location: image.srcAt.location }),
        subject: { kind: "node", id: node.id },
      });
    }
  }
  return diagnostics.some((d) => d.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, value: svgs, diagnostics };
}
