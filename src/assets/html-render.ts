/** HTML's async resource boundary; measurement lint can reuse prepareHtml (#293). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Renderer } from "@takumi-rs/wasm/node";
import type { FigureIR } from "../compiler/ir";
import type { ElementKey } from "../core/check-state";
import type { Diagnostic } from "../core/diagnostics";
import type { Result } from "../core/result";
import { getTheme } from "../core/theme/builtin";
import { FONT_ASSETS_DIR } from "../core/theme/fonts";
import type { Theme } from "../core/theme/schema";
import { loadEngine, runEngine } from "../render/pdf/engine";
import { validateHtml } from "./html";
import { validCssValue } from "./html-css";

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
      // Each renderer starts fresh. Takumi retains its bundled Geist fallback;
      // explicit families select our supplied fonts. Missing-glyph lint is #293.
      const raw = await renderer.renderSvg(prepareHtml(image.html, image.viewport, theme), {
        ...image.viewport,
        fonts,
      });
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
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, value: svgs, diagnostics };
}
