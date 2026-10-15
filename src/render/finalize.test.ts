import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Diagnostic } from "../core/diagnostics";
import { SUMI_VERSION } from "../core/figure/validate";
import {
  type FinalizedSvg,
  finalizeSvg,
  readSvgMetadata,
  SUMI_METADATA_NAMESPACE,
  type SumiSvgMetadata,
} from "./finalize";
import { inspectSvg } from "./inspect";
import { artifactFor, TINY_PARTS, TINY_SOURCE, tinyCompiled, tinySvg } from "./testing";
import { attribute, parseXml } from "./xml";

const compiled = tinyCompiled();
const hex = (text: string) => createHash("sha256").update(text).digest("hex");

function finalize(svg: string): FinalizedSvg {
  const result = finalizeSvg(artifactFor(compiled, svg), compiled, { source: TINY_SOURCE });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

function failure(svg: string): Diagnostic[] {
  const result = finalizeSvg(artifactFor(compiled, svg), compiled, { source: TINY_SOURCE });
  expect(result.ok).toBe(false);
  return result.diagnostics;
}

describe("finalizeSvg", () => {
  test("sets the root size in pt from the viewBox (× 0.5) and keeps the viewBox", () => {
    for (const [viewBox, width, height] of [
      ["0 0 200 100", "100pt", "50pt"],
      ["0 0 201 99", "100.5pt", "49.5pt"],
    ] as const) {
      const { svg, widthPt, heightPt } = finalize(tinySvg(undefined, { viewBox }));
      const parsed = parseXml(svg);
      if (!parsed.ok) throw new Error(parsed.message);
      expect(attribute(parsed.root, "viewBox")).toBe(viewBox);
      expect(attribute(parsed.root, "width")).toBe(width);
      expect(attribute(parsed.root, "height")).toBe(height);
      expect(`${widthPt}pt`).toBe(width);
      expect(`${heightPt}pt`).toBe(height);
    }
  });

  test("embeds deterministic, namespaced metadata", () => {
    const { svg, metadata } = finalize(tinySvg());
    const expected: SumiSvgMetadata = {
      format: 1,
      sumiVersion: SUMI_VERSION,
      backend: { name: "d2-cli", version: "0.9.0" },
      figureId: "tiny",
      theme: "minimal",
      profile: "paper-single",
      fontSet: "sumi/biz-ud-gothic",
      inputSha256: hex(TINY_SOURCE),
      d2Sha256: hex(compiled.d2Source),
    };
    expect(metadata).toEqual(expected);
    expect(readSvgMetadata(svg)).toEqual({ ok: true, value: expected, diagnostics: [] });
    expect(svg).toContain(
      `<metadata><sumi:render xmlns:sumi="${SUMI_METADATA_NAMESPACE}" format="1" sumi-version="${SUMI_VERSION}" backend="d2-cli" backend-version="0.9.0" figure-id="tiny" theme="minimal" profile="paper-single" font-set="sumi/biz-ud-gothic" input-sha256="${hex(TINY_SOURCE)}" d2-sha256="${hex(compiled.d2Source)}"/></metadata>`,
    );
  });

  test("leaves the rest of D2's output byte for byte", () => {
    const raw = tinySvg();
    const { svg } = finalize(raw);
    const rootTagEnd = raw.indexOf(">", raw.indexOf("<svg")) + 1;
    expect(svg.startsWith(raw.slice(0, raw.indexOf("<svg")))).toBe(true);
    expect(svg.endsWith(raw.slice(rootTagEnd))).toBe(true);
    expect(svg.indexOf("</metadata>") + "</metadata>".length).toBe(
      svg.length - (raw.length - rootTagEnd),
    );
    expect(finalize(raw).svg).toBe(svg);
  });

  test("the finalized SVG inspects like the raw one", () => {
    const raw = tinySvg();
    expect(inspectSvg(finalize(raw).svg, compiled.ir)).toEqual(inspectSvg(raw, compiled.ir));
  });

  test("rejects an artifact rendered from something else", () => {
    const svg = tinySvg();
    for (const artifact of [
      { ...artifactFor(compiled, svg), d2Source: "a -> b\n" },
      { ...artifactFor(compiled, svg), fontSetId: "other/fonts" },
    ]) {
      const result = finalizeSvg(artifact, compiled, { source: TINY_SOURCE });
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [{ code: "svg/artifact-mismatch", severity: "error" }],
      });
    }
  });

  test("rejects invalid and empty output", () => {
    expect(failure("")).toMatchObject([{ code: "svg/empty" }]);
    expect(failure("<svg")).toMatchObject([{ code: "svg/invalid" }]);
    expect(failure(tinySvg(undefined, { viewBox: "0 0 0 0" }))).toMatchObject([
      { code: "svg/empty" },
    ]);
    expect(failure(finalize(tinySvg()).svg)).toMatchObject([
      { code: "svg/invalid", message: expect.stringContaining("already finalized") },
    ]);
  });

  describe("svg/missing-font-face", () => {
    test("text without embedded fonts is an error", () => {
      expect(failure(tinySvg(undefined, { fonts: false }))).toMatchObject([
        {
          code: "svg/missing-font-face",
          severity: "error",
          message: expect.stringContaining('"text"'),
        },
        { code: "svg/missing-font-face", message: expect.stringContaining('"text-bold"') },
      ]);
    });

    test("every font class in use needs its own @font-face", () => {
      const mono = TINY_PARTS.a.replace('class="text"', 'class="text-mono"');
      const svg = tinySvg([
        TINY_PARTS.grp,
        mono,
        TINY_PARTS.note,
        TINY_PARTS.edge0,
        TINY_PARTS.back,
      ]);
      expect(failure(svg)).toMatchObject([
        { code: "svg/missing-font-face", message: expect.stringContaining('"text-mono"') },
      ]);
      const bare = TINY_PARTS.a.replace('class="text" ', "");
      expect(failure(tinySvg([bare]))).toMatchObject([{ code: "svg/missing-font-face" }]);
    });

    test("a figure without text needs no fonts", () => {
      const strip = (part: string) => part.replace(/<text\b.*?<\/text>/g, "");
      const parts = Object.values(TINY_PARTS).map(strip);
      expect(finalize(tinySvg(parts, { fonts: false })).svg).toContain("<metadata>");
    });
  });
});

describe("readSvgMetadata", () => {
  test("is undefined for an SVG without Sumi metadata", () => {
    expect(readSvgMetadata(tinySvg())).toEqual({ ok: true, value: undefined, diagnostics: [] });
    const foreign = tinySvg().replace(
      'viewBox="0 0 200 100">',
      'viewBox="0 0 200 100"><metadata><x:render xmlns:x="urn:other"/></metadata>',
    );
    expect(readSvgMetadata(foreign)).toMatchObject({ ok: true, value: undefined });
  });

  test("rejects incomplete or unknown-format metadata", () => {
    const { svg } = finalize(tinySvg());
    expect(readSvgMetadata(svg.replace(/ d2-sha256="[0-9a-f]+"/, ""))).toMatchObject({
      ok: false,
      diagnostics: [{ code: "svg/invalid", message: expect.stringContaining('"d2-sha256"') }],
    });
    expect(readSvgMetadata(svg.replace('format="1"', 'format="2"'))).toMatchObject({
      ok: false,
      diagnostics: [{ code: "svg/invalid" }],
    });
    expect(readSvgMetadata("<svg")).toMatchObject({ ok: false });
  });
});
