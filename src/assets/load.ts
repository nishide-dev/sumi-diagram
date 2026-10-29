/**
 * Loading a figure's assets for rendering (#94, design doc §6.25): every icon
 * from the bundled archive and every image file from the figure's directory,
 * checked and turned into what the SVG embeds. Sumi never draws, decodes or
 * changes an image: PNG and JPEG bytes are embedded as they are (base64
 * `data:` URIs), and SVG is re-serialized by the allow-list importer.
 *
 * Image checks (all `asset/*` errors at `props.src`):
 * - the path resolves inside the figure's directory (`asset/outside-base`)
 *   to an existing regular file (`asset/not-found`), read from the
 *   descriptor it was checked on (`readAssetFile()`);
 * - at most {@link ASSET_LIMITS} bytes per file and per figure
 *   (`asset/too-large`), and pixels per side and in total for PNG / JPEG
 *   (`asset/too-many-pixels`); nothing is scaled down;
 * - the content is PNG, JPEG or SVG (`asset/unsupported-format`), the same
 *   format the extension names (`asset/format-mismatch`), with a readable
 *   header (`asset/invalid-image`);
 * - `props.sha256`, if written, matches (`asset/sha256-mismatch`);
 * - SVG passes the importer: `asset/unsafe-svg` (scripts, event attributes,
 *   references to other files or URLs, DTDs and entities, foreignObject, …)
 *   and `asset/unsupported-svg` / `asset/invalid-image` otherwise, each with
 *   its line and column in the SVG file as related information.
 *
 * Provenance: `assets-sha256` (the SVG metadata) is the sha256 of one line per
 * icon or image node in document order, `icon <set>/<name>@<version>
 * <sha256>` or `image <src> <sha256>` (the sha256 of the icon's original SVG
 * in the archive, or of the image file). Bundled icons also add their set's
 * third-party notice (name, version, license and its full text).
 */

import { createHash } from "node:crypto";
import type { FigureIR, NodeIR } from "../compiler/ir";
import type { ElementKey } from "../core/check-state";
import type { Diagnostic, RelatedInformation } from "../core/diagnostics";
import type { Result } from "../core/result";
import { iconLicense, iconSet, iconSvg } from "./icons";
import { readAssetFile, srcProblem } from "./paths";
import {
  formatOfExtension,
  IMAGE_MIME,
  type ImageFormat,
  jpegSize,
  type PixelSize,
  pngSize,
  sniffFormat,
} from "./raster";
import { type ImportedSvg, importSvg } from "./svg-import";

/** Size limits of user images (research #86 §6.2; the PDF input limit is 32 MiB). */
export const ASSET_LIMITS = Object.freeze({
  maxFileBytes: 16 * 1024 * 1024,
  maxFigureBytes: 32 * 1024 * 1024,
  maxPixelsPerSide: 8192,
  maxPixels: 16_777_216,
});

export interface LoadedIcon {
  kind: "icon";
  set: string;
  name: string;
  /** The icon re-serialized, `currentColor` replaced by the node's text color. */
  svg: ImportedSvg;
}

export interface LoadedImage {
  kind: "image";
  format: ImageFormat;
  /** Intrinsic size (pixels, or CSS px for SVG): the aspect ratio when only one of width / height is given. */
  intrinsic: { width: number; height: number };
  /** The `data:` URI the SVG embeds. */
  href: string;
  /** The node's box in units: the written size, completed from the aspect ratio. */
  size?: { width: number; height: number };
}

export type LoadedAsset = LoadedIcon | LoadedImage;

/** A third-party notice kept in the outputs that redistribute bundled assets (research #86 §6.4). */
export interface ThirdPartyNotice {
  name: string;
  version: string;
  /** SPDX license identifier. */
  license: string;
  source: string;
  /** The full license text (copyright and permission notice). */
  text: string;
}

export interface FigureAssets {
  /** The asset of each icon or image node. */
  nodes: ReadonlyMap<ElementKey, LoadedAsset>;
  badges?: ReadonlyMap<ElementKey, LoadedIcon>;
  /** sha256 of the asset lines (see the module comment); `undefined` for a figure without assets. */
  sha256?: string;
  notices: readonly ThirdPartyNotice[];
}

export interface LoadAssetsOptions {
  /** The directory image paths are relative to: the figure's YAML file's directory. */
  base?: string;
}

/** `true` if the figure has icon or image nodes (anything to load). */
export function hasAssets(ir: FigureIR): boolean {
  return ir.nodes.some(
    (n) => n.icon !== undefined || n.image !== undefined || n.badge !== undefined,
  );
}

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** Loads and checks every icon and image of `ir` (see the module comment). */
export function loadFigureAssets(
  ir: FigureIR,
  options: LoadAssetsOptions = {},
): Result<FigureAssets> {
  const diagnostics: Diagnostic[] = [];
  const nodes = new Map<ElementKey, LoadedAsset>();
  const badges = new Map<ElementKey, LoadedIcon>();
  const lines: string[] = [];
  const notices = new Map<string, ThirdPartyNotice>();
  let total = 0;

  for (const node of ir.nodes) {
    for (const [role, ref] of [
      ["badge", node.badge?.icon],
      ["icon", node.icon],
    ] as const) {
      if (ref === undefined) continue;
      const { set, name } = ref;
      const info = iconSet(set);
      const original = iconSvg(set, name);
      if (info === undefined || original === undefined) {
        throw new Error(`internal error: unknown icon ${set}/${name} passed the checks`);
      }
      const imported = importSvg(original, {
        currentColor: node.style.fontColor === "transparent" ? "none" : node.style.fontColor,
        dropInvisible: true,
      });
      if (!imported.ok) throw new Error(`internal error: bundled icon ${set}/${name} is rejected`);
      const icon: LoadedIcon = { kind: "icon", set, name, svg: imported.value };
      if (role === "badge") badges.set(node.key, icon);
      else nodes.set(node.key, icon);
      lines.push(`${role} ${set}/${name}@${info.version} ${sha256(original)}\n`);
      if (!notices.has(set)) {
        notices.set(set, {
          name: info.name,
          version: info.version,
          license: info.license,
          source: info.source,
          text: iconLicense(set) ?? "",
        });
      }
    }
    const image = node.image;
    if (image === undefined) continue;
    const fail = (code: string, message: string, hint?: string, related?: RelatedInformation[]) => {
      diagnostics.push({
        code,
        severity: "error",
        message,
        path: [...image.srcAt.path],
        ...(image.srcAt.location !== undefined && { location: image.srcAt.location }),
        subject: { kind: "node", id: node.id },
        ...(hint !== undefined && { hint }),
        ...(related !== undefined && related.length > 0 && { related }),
      });
    };
    const loaded = loadImage(image.src, options.base, fail);
    if (loaded === undefined) continue;
    total += loaded.bytes.length;
    if (total > ASSET_LIMITS.maxFigureBytes) {
      fail(
        "asset/too-large",
        `The figure's images add up to more than ${mib(ASSET_LIMITS.maxFigureBytes)}.`,
        "Use smaller files; Sumi embeds them as they are and does not scale them down.",
      );
      continue;
    }
    const digest = sha256(loaded.bytes);
    if (image.sha256 !== undefined && image.sha256 !== digest) {
      fail(
        "asset/sha256-mismatch",
        `${image.src} has sha256 ${digest}, not the ${image.sha256} written in props.sha256.`,
        "Update props.sha256 if the new file is intended.",
      );
      continue;
    }
    const size = imageSize(node, loaded.asset.intrinsic);
    if (size === undefined) {
      fail(
        "asset/invalid-image",
        `${image.src} has an extreme aspect ratio (${loaded.asset.intrinsic.width} × ${loaded.asset.intrinsic.height}); give both width and height.`,
      );
      continue;
    }
    lines.push(`image ${image.src} ${digest}\n`);
    nodes.set(node.key, { ...loaded.asset, size });
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    value: {
      nodes,
      ...(badges.size > 0 && { badges }),
      ...(lines.length > 0 && { sha256: sha256(lines.join("")) }),
      notices: [...notices.values()],
    },
    diagnostics,
  };
}

const mib = (bytes: number) => `${bytes / 1024 / 1024} MiB`;

/** Largest side, in units, an image may get from its aspect ratio (10,000pt). */
const MAX_DERIVED_UNITS = 20_000;

/**
 * The node's box in whole units: the written width and height, the missing
 * one from the image's aspect ratio (rounded, at least 1). `undefined` if
 * the derived side would be absurd (an extreme aspect ratio).
 */
function imageSize(
  node: Pick<NodeIR, "width" | "height">,
  intrinsic: { width: number; height: number },
): { width: number; height: number } | undefined {
  const { width: iw, height: ih } = intrinsic;
  const derive = (given: number, ratio: number) => Math.max(1, Math.round(given * ratio));
  const width = node.width?.units ?? (node.height ? derive(node.height.units, iw / ih) : undefined);
  const height = node.height?.units ?? (node.width ? derive(node.width.units, ih / iw) : undefined);
  if (width === undefined || height === undefined) return undefined;
  if (![width, height].every((n) => Number.isSafeInteger(n) && n <= MAX_DERIVED_UNITS)) {
    return undefined;
  }
  return { width, height };
}

function loadImage(
  src: string,
  base: string | undefined,
  fail: (code: string, message: string, hint?: string, related?: RelatedInformation[]) => void,
): { asset: LoadedImage; bytes: Uint8Array } | undefined {
  // The check stage rejected these already; a figure built some other way is checked again.
  const problem = srcProblem(src);
  if (problem !== undefined) {
    fail("asset/invalid-path", `props.src "${src}" cannot be used: ${problem}.`);
    return undefined;
  }
  if (base === undefined) {
    fail(
      "asset/no-base-directory",
      `Image ${src} cannot be read: the figure has no file to resolve relative paths from.`,
      "Render the figure from a file.",
    );
    return undefined;
  }
  const read = readAssetFile(base, src, ASSET_LIMITS.maxFileBytes);
  if (!read.ok) {
    fail(
      `asset/${read.reason}`,
      `Image ${src} cannot be read: ${read.message}.`,
      read.reason === "outside-base"
        ? "Copy the file into the figure's directory instead of linking to it."
        : read.reason === "too-large"
          ? "Use a smaller file; Sumi embeds images as they are and does not scale them down."
          : "Check the path; it is relative to the figure's YAML file.",
    );
    return undefined;
  }
  const bytes = read.bytes;
  const format = sniffFormat(bytes);
  const named = formatOfExtension(src);
  if (format === undefined) {
    fail(
      "asset/unsupported-format",
      `Image ${src} is not a PNG, JPEG or SVG file.`,
      "Convert it to PNG, JPEG or SVG.",
    );
    return undefined;
  }
  if (named !== format) {
    fail(
      "asset/format-mismatch",
      named === undefined
        ? `Image ${src} has no .png, .jpg, .jpeg or .svg extension (its content is ${format.toUpperCase()}).`
        : `Image ${src} is named as ${named.toUpperCase()} but its content is ${format.toUpperCase()}.`,
      "Rename the file to match its content.",
    );
    return undefined;
  }

  if (format === "svg") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail("asset/invalid-image", `Image ${src} is not valid UTF-8 text.`);
      return undefined;
    }
    const imported = importSvg(text);
    if (!imported.ok) {
      const unsafe = imported.issues.filter((i) => i.kind === "unsafe");
      const shown = (unsafe.length > 0 ? unsafe : imported.issues).slice(0, 20);
      const first = shown[0];
      const code =
        unsafe.length > 0
          ? "asset/unsafe-svg"
          : first?.kind === "invalid"
            ? "asset/invalid-image"
            : "asset/unsupported-svg";
      const at = (i: { line: number; column: number }) => `${src}:${i.line}:${i.column}`;
      fail(
        code,
        `Image ${src} cannot be embedded: ${first?.message.replace(/\.$/, "")} (${first === undefined ? src : at(first)}).`,
        unsafe.length > 0
          ? "Sumi embeds only plain drawings; remove the flagged parts or export the SVG again as plain shapes."
          : "Export the SVG with basic shapes only (paths, rectangles, circles, lines; no gradients, text or filters), or use a PNG.",
        shown.map((i) => ({
          message: `${i.kind === "unsafe" ? "Unsafe" : i.kind === "invalid" ? "Invalid" : "Unsupported"}: ${i.message}`,
          location: { file: src, line: i.line, column: i.column },
        })),
      );
      return undefined;
    }
    const svg = imported.value;
    const [x, y, w, h] = svg.viewBox;
    const document = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${svg.width}" height="${svg.height}">${svg.markup}</svg>`;
    return {
      bytes,
      asset: {
        kind: "image",
        format,
        intrinsic: { width: svg.width, height: svg.height },
        href: `data:${IMAGE_MIME.svg};base64,${Buffer.from(document, "utf8").toString("base64")}`,
      },
    };
  }

  const size: PixelSize | string = format === "png" ? pngSize(bytes) : jpegSize(bytes);
  if (typeof size === "string") {
    fail("asset/invalid-image", `Image ${src} cannot be read: ${size}.`);
    return undefined;
  }
  if (
    size.width > ASSET_LIMITS.maxPixelsPerSide ||
    size.height > ASSET_LIMITS.maxPixelsPerSide ||
    size.width * size.height > ASSET_LIMITS.maxPixels
  ) {
    fail(
      "asset/too-many-pixels",
      `Image ${src} is ${size.width} × ${size.height} pixels; the limit is ${ASSET_LIMITS.maxPixelsPerSide} per side and ${ASSET_LIMITS.maxPixels} in total.`,
      "Use a smaller image; Sumi does not scale images down.",
    );
    return undefined;
  }
  return {
    bytes,
    asset: {
      kind: "image",
      format,
      intrinsic: size,
      href: `data:${IMAGE_MIME[format]};base64,${Buffer.from(bytes).toString("base64")}`,
    },
  };
}
