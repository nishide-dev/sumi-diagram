/**
 * The bundled icon set (#94, design doc §6.25): Tabler Icons (MIT), every
 * outline icon except Tabler's own Brand category (logos are trademarks;
 * research #86 §6.4), at a pinned version. `bun run icons:build` makes the
 * archive from the npm package (integrity-checked) and records its sha256
 * here.
 *
 * The archive is one gzip'd JSON file with the original SVG of each icon by
 * name. It is imported as a file, so `bun build --compile` embeds it in the
 * single binary (compressed); it is read, checked against
 * {@link TABLER_ARCHIVE_SHA256} and decompressed once per process, on the
 * first use of an icon. An icon is drawn only after the allow-list importer
 * (`importSvg()`) has re-serialized it, like a user's SVG.
 */

import { readFileSync } from "node:fs";
import emojiArchivePath from "../../assets/icons/fluent-emoji-flat.json.gz" with { type: "file" };
import emojiLicensePath from "../../assets/icons/fluent-emoji-LICENSE.txt" with { type: "file" };
import licensePath from "../../assets/icons/tabler-LICENSE.txt" with { type: "file" };
import archivePath from "../../assets/icons/tabler-outline.json.gz" with { type: "file" };

/** The one bundled set, as written before the `/` of `icon: tabler/<name>`. */
export const TABLER_SET = "tabler";
export const TABLER_VERSION = "3.49.0";
/** sha256 of `assets/icons/tabler-outline.json.gz`; written by `bun run icons:build`. */
export const TABLER_ARCHIVE_SHA256 =
  "5c2dfa8c1c8c6f1b183e9b015e58467890f362838f0add6145afecad83e8eea7";

/** A bundled icon set, as listed in the catalog and in third-party notices. */
export interface IconSetInfo {
  /** The prefix in `icon: <id>/<name>`. */
  id: string;
  name: string;
  version: string;
  /** SPDX license identifier. */
  license: string;
  source: string;
  /** What of the upstream set is bundled. */
  contents: string;
  count: number;
}

/** Thrown when the bundled archive is missing or does not match its sha256 (a broken build). */
export class IconArchiveError extends Error {}

interface Archive {
  icons: ReadonlyMap<string, string>;
  names: readonly string[];
}

let loaded: Archive | undefined;
let emojiLoaded: Archive | undefined;

export const EMOJI_VERSION = "1.2.6";
export const EMOJI_ARCHIVE_SHA256 =
  "b57f5a82566da119cb40a1e5dde43a50f9d145caecbd2780ffbe69b2c2fba633";

function emojiArchive(): Archive {
  if (emojiLoaded !== undefined) return emojiLoaded;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(readFileSync(emojiArchivePath));
  } catch (error) {
    throw new IconArchiveError(`the bundled emoji archive cannot be read: ${String(error)}`);
  }
  if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== EMOJI_ARCHIVE_SHA256) {
    throw new IconArchiveError("the bundled emoji archive has an unexpected sha256");
  }
  const json = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(bytes))) as {
    format: number;
    icons: Record<string, string>;
  };
  if (json.format !== 1) throw new IconArchiveError("unsupported emoji archive format");
  const names = Object.keys(json.icons).sort();
  emojiLoaded = { names, icons: new Map(names.map((n) => [n, json.icons[n] as string])) };
  return emojiLoaded;
}

function archive(): Archive {
  if (loaded !== undefined) return loaded;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(readFileSync(archivePath));
  } catch (error) {
    throw new IconArchiveError(
      `the bundled icon archive ${archivePath} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (actual !== TABLER_ARCHIVE_SHA256) {
    throw new IconArchiveError(
      `the bundled icon archive ${archivePath} has sha256 ${actual}, expected ${TABLER_ARCHIVE_SHA256} (rebuild it with \`bun run icons:build\`)`,
    );
  }
  const json = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(bytes))) as {
    format: number;
    icons: Record<string, string>;
  };
  if (json.format !== 1) throw new IconArchiveError("unsupported icon archive format");
  const names = Object.keys(json.icons).sort();
  loaded = { icons: new Map(names.map((n) => [n, json.icons[n] as string])), names };
  return loaded;
}

/** The bundled Tabler outline and Fluent Emoji Flat sets. */
export function iconSets(): IconSetInfo[] {
  return [
    {
      id: TABLER_SET,
      name: "Tabler Icons",
      version: TABLER_VERSION,
      license: "MIT",
      source: "https://github.com/tabler/tabler-icons",
      contents: "outline icons, without the Brand category",
      count: archive().names.length,
    },
    {
      id: "emoji",
      name: "Fluent Emoji Flat",
      version: EMOJI_VERSION,
      license: "MIT",
      source: "https://github.com/microsoft/fluentui-emoji",
      contents: `curated multicolour Flat subset via Iconify JSON: ${emojiArchive().names.join(", ")}`,
      count: emojiArchive().names.length,
    },
  ];
}

/** The info of a bundled set by its id, or `undefined`. */
export function iconSet(id: string): IconSetInfo | undefined {
  return iconSets().find((s) => s.id === id);
}

/** Names of the icons of a set, sorted; empty for an unknown set. */
export function iconNames(set: string): readonly string[] {
  return set === "emoji" ? emojiArchive().names : set === TABLER_SET ? archive().names : [];
}

/** The original SVG of an icon, or `undefined` if the set or name is unknown. */
export function iconSvg(set: string, name: string): string | undefined {
  return set === "emoji"
    ? emojiArchive().icons.get(name)
    : set === TABLER_SET
      ? archive().icons.get(name)
      : undefined;
}

/** The license text of a set (shipped with the binary). */
export function iconLicense(set: string): string | undefined {
  return set === "emoji"
    ? readFileSync(emojiLicensePath, "utf8")
    : set === TABLER_SET
      ? readFileSync(licensePath, "utf8")
      : undefined;
}

export { ICON_REF_PATTERN, parseIconRef } from "./icon-ref";
