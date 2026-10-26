/**
 * SVG finalization (#11): the minimal, non-destructive post-processing that
 * turns D2's SVG into Sumi's output.
 *
 * - The root `<svg>` gets `width="{W·0.5}pt" height="{H·0.5}pt"` from its
 *   viewBox (design doc §5.1). The viewBox is kept; nothing is scaled down.
 * - A `<metadata>` element with Sumi's provenance is inserted as the first
 *   child of the root (namespaced, no timestamps, so output stays
 *   byte-deterministic for the same input). A figure with icons or images
 *   (#94) also records `assets-sha256`, and one `<sumi:notice>` with the
 *   full license text per bundled icon set it uses (research #86 §6.4).
 * - Everything else is D2's output byte for byte: the root start tag is
 *   rewritten and the metadata spliced in; the rest is copied unparsed.
 *
 * Before that it checks the output: well-formed XML and D2's structure
 * (`svg/invalid`), a non-empty drawing (`svg/empty`) and embedded fonts for
 * every text style in use (`svg/missing-font-face`).
 */

import { createHash } from "node:crypto";
import type { FigureAssets, ThirdPartyNotice } from "../assets/load";
import type { RenderArtifact } from "../backends/types";
import type {
  CompiledD2Figure,
  CompiledFigure,
  CompiledStructuredFigure,
} from "../compiler/compile";
import type { Diagnostic } from "../core/diagnostics";
import { SUMI_VERSION } from "../core/figure/validate";
import type { Result } from "../core/result";
import { PT_PER_D2_UNIT } from "../core/units";
import { invalid, readD2Svg } from "./svg";
import {
  attribute,
  childElements,
  classList,
  descendants,
  escapeAttribute,
  parseXml,
  textContent,
  type XmlElement,
} from "./xml";

/** Namespace of Sumi's SVG metadata element (`<sumi:render>`). Versioned with {@link METADATA_FORMAT}. */
export const SUMI_METADATA_NAMESPACE =
  "https://github.com/nishide-dev/sumi-diagram/ns/svg-metadata/1";

/** Version of the metadata format. */
export const METADATA_FORMAT = 1;

/** Provenance embedded in every finalized SVG. Deterministic: no timestamps or paths. */
export interface SumiSvgMetadata {
  format: typeof METADATA_FORMAT;
  sumiVersion: string;
  backend: { name: string; version: string };
  figureId: string;
  theme: string;
  profile: string;
  fontSet: string;
  /** sha256 (hex) of the `*.sumi.yaml` source text (UTF-8). */
  inputSha256: string;
  /**
   * sha256 (hex) of the generated D2 source (UTF-8). Omitted for a backend
   * without D2 source (`sumi-structured`, design doc §6.23).
   */
  d2Sha256?: string;
  /**
   * sha256 (hex) of the figure's icons and images (`loadFigureAssets()`, #94).
   * Omitted for a figure without them.
   */
  assetsSha256?: string;
  /** Notices of the bundled third-party assets the figure uses (#94); omitted if none. */
  notices?: ThirdPartyNotice[];
}

/** The backend name of SVGs drawn by the structured SVG writer (#91); its version is Sumi's. */
export const STRUCTURED_BACKEND = "sumi-structured";

export interface FinalizeOptions {
  /** The `*.sumi.yaml` source text the figure was compiled from (hashed into the metadata). */
  source: string;
  /** The figure's loaded icons and images (#94), for `assets-sha256` and the notices. */
  assets?: Pick<FigureAssets, "sha256" | "notices">;
}

export interface FinalizedSvg {
  svg: string;
  metadata: SumiSvgMetadata;
  /** Output size in pt (`viewBox × 0.5`), as written on the root element. */
  widthPt: number;
  heightPt: number;
}

/** Attribute names of `<sumi:render>`, in output order. */
const METADATA_ATTRIBUTES = [
  ["format", (m: SumiSvgMetadata) => String(m.format)],
  ["sumi-version", (m: SumiSvgMetadata) => m.sumiVersion],
  ["backend", (m: SumiSvgMetadata) => m.backend.name],
  ["backend-version", (m: SumiSvgMetadata) => m.backend.version],
  ["figure-id", (m: SumiSvgMetadata) => m.figureId],
  ["theme", (m: SumiSvgMetadata) => m.theme],
  ["profile", (m: SumiSvgMetadata) => m.profile],
  ["font-set", (m: SumiSvgMetadata) => m.fontSet],
  ["input-sha256", (m: SumiSvgMetadata) => m.inputSha256],
  ["d2-sha256", (m: SumiSvgMetadata) => m.d2Sha256],
  ["assets-sha256", (m: SumiSvgMetadata) => m.assetsSha256],
] as const;

/** Attributes that may be absent: `d2-sha256` (structured backend) and `assets-sha256`. */
const OPTIONAL_ATTRIBUTES = new Set(["assets-sha256"]);

/** Attribute names of `<sumi:notice>`, in output order; its text is the license. */
const NOTICE_ATTRIBUTES = ["name", "version", "license", "source"] as const;

/** Escapes text for element content. */
const escapeText = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** Formats a number for an attribute: no exponent, at most 6 decimals, no trailing zeros. */
function formatNumber(n: number): string {
  return String(Number(n.toFixed(6)));
}

/** Serializes the metadata as `<metadata><sumi:render …/></metadata>`. */
export function serializeMetadata(metadata: SumiSvgMetadata): string {
  const attributes = METADATA_ATTRIBUTES.map(([name, get]) => {
    const value = get(metadata);
    return value === undefined ? "" : ` ${name}="${escapeAttribute(value)}"`;
  }).join("");
  const notices = (metadata.notices ?? [])
    .map(
      (notice) =>
        `<sumi:notice xmlns:sumi="${SUMI_METADATA_NAMESPACE}"${NOTICE_ATTRIBUTES.map((name) => ` ${name}="${escapeAttribute(notice[name])}"`).join("")}>${escapeText(notice.text)}</sumi:notice>`,
    )
    .join("");
  return `<metadata><sumi:render xmlns:sumi="${SUMI_METADATA_NAMESPACE}"${attributes}/>${notices}</metadata>`;
}

/**
 * Reads the metadata of a finalized SVG. `undefined` if the SVG has none;
 * `svg/invalid` if the SVG is malformed or the metadata incomplete.
 */
export function readSvgMetadata(svg: string): Result<SumiSvgMetadata | undefined> {
  const parsed = parseXml(svg);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: [invalid(`The SVG is not well-formed XML: ${parsed.message}`)],
    };
  }
  const ours = childElements(parsed.root)
    .filter((child) => child.name === "metadata")
    .flatMap(childElements)
    .filter(
      (child) => attribute(child, `xmlns:${child.name.split(":")[0]}`) === SUMI_METADATA_NAMESPACE,
    );
  const element = ours.find((child) => child.name.endsWith(":render"));
  const notices = ours
    .filter((child) => child.name.endsWith(":notice"))
    .map((child) => ({
      name: attribute(child, "name") ?? "",
      version: attribute(child, "version") ?? "",
      license: attribute(child, "license") ?? "",
      source: attribute(child, "source") ?? "",
      text: textContent(child),
    }));
  if (element === undefined) return { ok: true, value: undefined, diagnostics: [] };
  const get = (name: string): string | undefined => attribute(element, name);
  // Only a D2 backend has D2 source to hash (the structured writer has none).
  const optional = (name: string) =>
    OPTIONAL_ATTRIBUTES.has(name) ||
    (name === "d2-sha256" && get("backend") === STRUCTURED_BACKEND);
  const missing = METADATA_ATTRIBUTES.map(([name]) => name).filter(
    (n) => get(n) === undefined && !optional(n),
  );
  if (missing.length > 0) {
    const names = missing.map((name) => `"${name}"`).join(", ");
    return { ok: false, diagnostics: [invalid(`The Sumi metadata lacks ${names}.`)] };
  }
  if (get("format") !== String(METADATA_FORMAT)) {
    return {
      ok: false,
      diagnostics: [invalid(`Unsupported Sumi metadata format "${get("format")}".`)],
    };
  }
  const value = (name: string): string => get(name) ?? "";
  return {
    ok: true,
    value: {
      format: METADATA_FORMAT,
      sumiVersion: value("sumi-version"),
      backend: { name: value("backend"), version: value("backend-version") },
      figureId: value("figure-id"),
      theme: value("theme"),
      profile: value("profile"),
      fontSet: value("font-set"),
      inputSha256: value("input-sha256"),
      ...(get("d2-sha256") !== undefined && { d2Sha256: value("d2-sha256") }),
      ...(get("assets-sha256") !== undefined && { assetsSha256: value("assets-sha256") }),
      ...(notices.length > 0 && { notices }),
    },
    diagnostics: [],
  };
}

/**
 * Document properties for the assets of a figure (#94), shared by the PDF
 * information dictionary and the PPTX custom properties: `SumiAssetsSha256`,
 * and for bundled icons `SumiThirdParty` (set, version, license, source) and
 * `SumiThirdPartyNotice` (the full license text), so a PDF or PPTX keeps the
 * notice of what it redistributes. Empty for a figure without assets.
 */
export function assetProvenanceEntries(metadata: SumiSvgMetadata): [string, string][] {
  const notices = metadata.notices ?? [];
  return [
    ...(metadata.assetsSha256 === undefined
      ? []
      : [["SumiAssetsSha256", metadata.assetsSha256] as [string, string]]),
    ...(notices.length === 0
      ? []
      : ([
          [
            "SumiThirdParty",
            notices.map((n) => `${n.name} ${n.version} (${n.license}): ${n.source}`).join("; "),
          ],
          ["SumiThirdPartyNotice", notices.map((n) => `${n.name}\n\n${n.text}`).join("\n\n")],
        ] as [string, string][])),
  ];
}

/** Removes quotes and surrounding whitespace from a CSS font-family value. */
function cssFamily(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

/**
 * Checks that every font class used by a `<text>` (`text`, `text-bold`,
 * `text-mono`, …) maps to a font family embedded with `@font-face` and a
 * `data:` URL. A figure without text needs no fonts (D2 embeds none).
 */
export function checkEmbeddedFonts(drawing: XmlElement): Diagnostic[] {
  const elements = [...descendants(drawing)];
  const css = elements
    .filter((e) => e.name === "style")
    .map(textContent)
    .join("\n");
  const embedded = new Set<string>();
  for (const [, body = ""] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const family = /font-family\s*:\s*([^;]+)/.exec(body)?.[1];
    if (family !== undefined && /src\s*:[^;]*url\(\s*["']?data:/.test(body)) {
      embedded.add(cssFamily(family));
    }
  }
  const familyOf = new Map<string, string>();
  const rules = css.replace(/@font-face\s*\{[^}]*\}/g, "");
  for (const [, selector = "", body = ""] of rules.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const fontClass = /\.(text(?:-[a-z]+)*)\s*$/.exec(selector.trim())?.[1];
    const family = /font-family\s*:\s*([^;]+)/.exec(body)?.[1];
    if (fontClass !== undefined && family !== undefined) familyOf.set(fontClass, cssFamily(family));
  }

  const missing = new Set<string>();
  for (const text of elements.filter((e) => e.name === "text")) {
    const fontClasses = classList(text).filter((c) => c === "text" || c.startsWith("text-"));
    if (fontClasses.length === 0) missing.add("(none)");
    for (const fontClass of fontClasses) {
      const family = familyOf.get(fontClass);
      if (family === undefined || !embedded.has(family)) missing.add(fontClass);
    }
  }
  return [...missing].sort().map((fontClass) => ({
    code: "svg/missing-font-face",
    severity: "error",
    message:
      fontClass === "(none)"
        ? "A text element in the SVG has no font class, so its font is not embedded."
        : `Text with font class "${fontClass}" has no embedded @font-face; viewers would substitute their own fonts.`,
    hint: "Render with the theme's font set (all eight --font-* flags) so D2 embeds the fonts.",
  }));
}

/**
 * Finalizes D2's SVG for `compiled` (see the module comment). Fails with
 * `svg/artifact-mismatch` if the artifact was not rendered from `compiled`.
 */
export function finalizeSvg(
  artifact: RenderArtifact,
  compiled: CompiledD2Figure,
  options: FinalizeOptions,
): Result<FinalizedSvg> {
  const mismatch = (what: string): Result<FinalizedSvg> => ({
    ok: false,
    diagnostics: [
      {
        code: "svg/artifact-mismatch",
        severity: "error",
        message: `The render artifact does not belong to the compiled figure: ${what} differs.`,
      },
    ],
  });
  if (artifact.d2Source !== compiled.d2Source) return mismatch("the D2 source");
  if (artifact.fontSetId !== compiled.fontSet.id) return mismatch("the font set");
  return finalizeDocument(artifact.svg, {
    ...metadataBase(compiled, options),
    backend: { ...artifact.backend },
    d2Sha256: sha256(compiled.d2Source),
  });
}

/**
 * Finalizes an SVG drawn by the structured SVG writer (#91, design doc
 * §6.23) for `compiled`, exactly like D2's: the same checks, root size and
 * metadata, with backend `sumi-structured` at Sumi's version and no D2 hash.
 */
export function finalizeStructuredSvg(
  svg: string,
  compiled: CompiledStructuredFigure,
  options: FinalizeOptions,
): Result<FinalizedSvg> {
  return finalizeDocument(svg, {
    ...metadataBase(compiled, options),
    backend: { name: STRUCTURED_BACKEND, version: SUMI_VERSION },
  });
}

function metadataBase(
  compiled: CompiledFigure,
  options: FinalizeOptions,
): Omit<SumiSvgMetadata, "backend" | "d2Sha256"> {
  const { ir } = compiled;
  const { assets } = options;
  return {
    format: METADATA_FORMAT,
    sumiVersion: SUMI_VERSION,
    figureId: ir.meta.id,
    theme: ir.meta.themeId,
    profile: ir.meta.profileId,
    fontSet: compiled.fontSet.id,
    inputSha256: sha256(options.source),
    ...(assets?.sha256 !== undefined && { assetsSha256: assets.sha256 }),
    ...(assets !== undefined && assets.notices.length > 0 && { notices: [...assets.notices] }),
  };
}

/** Checks a drawing and adds the root size and the metadata (shared by both backends). */
function finalizeDocument(source: string, metadata: SumiSvgMetadata): Result<FinalizedSvg> {
  const read = readD2Svg(source);
  if (!read.ok) return { ok: false, diagnostics: [read.diagnostic] };
  const { root, viewBox, drawing } = read.doc;
  for (const name of ["width", "height"]) {
    if (attribute(root, name) !== undefined) {
      return {
        ok: false,
        diagnostics: [
          invalid(`The root <svg> already has a "${name}" attribute; is it already finalized?`),
        ],
      };
    }
  }
  const fontDiagnostics = checkEmbeddedFonts(drawing);
  if (fontDiagnostics.length > 0) return { ok: false, diagnostics: fontDiagnostics };

  const widthPt = viewBox.width * PT_PER_D2_UNIT;
  const heightPt = viewBox.height * PT_PER_D2_UNIT;
  const rootAttributes = [
    ...root.attributes,
    { name: "width", value: `${formatNumber(widthPt)}pt` },
    { name: "height", value: `${formatNumber(heightPt)}pt` },
  ]
    .map(({ name, value }) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  const svg =
    source.slice(0, root.start) +
    `<svg${rootAttributes}>` +
    serializeMetadata(metadata) +
    source.slice(root.startTagEnd);
  return { ok: true, value: { svg, metadata, widthPt, heightPt }, diagnostics: [] };
}
