/**
 * Icon / logo / emoji set candidates: download the pinned npm tarballs into
 * .tools/ (gitignored, integrity-checked), then measure what bundling them
 * would cost and whether a strict SVG allowlist can ingest every file.
 * Nothing here is committed or embedded in the product.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { runCommand } from "../../../src/core/subprocess";
import { parseXml, type XmlElement, type XmlNode } from "../../../src/render/xml";
import { PINNED, packageFacts } from "./packages";

const TOOLS = join(import.meta.dir, "..", ".tools");

export const ICON_SETS = [
  "lucide-static",
  "@tabler/icons",
  "@material-symbols/svg-400",
  "@phosphor-icons/core",
  "simple-icons",
  "@twemoji/svg",
] as const;

/** Icons figures A-C would use, by file basename (without .svg). */
const LOOKUPS: Record<string, string[]> = {
  "lucide-static": ["flame", "snowflake", "audio-waveform", "keyboard"],
  "@tabler/icons": ["flame", "snowflake", "wave-sine", "keyboard"],
  "@material-symbols/svg-400": ["local_fire_department", "ac_unit", "keyboard"],
  "@phosphor-icons/core": ["fire", "snowflake", "wave-sine", "keyboard"],
  "simple-icons": ["pytorch", "github", "huggingface"],
  "@twemoji/svg": ["1f525", "2744"],
};

/** Elements and attributes a geometry-only sanitizer would accept. */
const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "title",
]);

export interface IconSetReport {
  name: string;
  version: string;
  npmLicense: unknown;
  licenseFiles: { file: string; firstLine: string }[];
  svgDirs: { dir: string; count: number; bytes: number; gzipBytes: number }[];
  lookups: Record<string, string | null>;
  /** Element names outside the allowlist, with how many files use them. */
  disallowedElements: Record<string, number>;
  /** Attributes that are risky or need translation, with how many files use them. */
  notableAttributes: Record<string, number>;
  parseErrors: number;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

function elements(node: XmlNode, out: XmlElement[] = []): XmlElement[] {
  if (node.type === "element") {
    out.push(node);
    for (const child of node.children) elements(child, out);
  }
  return out;
}

export async function fetchPackage(name: string, version: string): Promise<string> {
  const facts = await packageFacts(name, version);
  if (facts.tarball === undefined || facts.integrity === undefined) throw new Error(name);
  const dir = join(TOOLS, `${name.replace("/", "__")}-${facts.version}`);
  const archive = `${dir}.tgz`;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(archive));
  } catch {
    const response = await fetch(facts.tarball);
    if (!response.ok) throw new Error(`${name}: ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const [algo, digest] = facts.integrity.split("-");
  if (algo !== "sha512") throw new Error(`${name}: ${algo}`);
  if (new Bun.CryptoHasher("sha512").update(bytes).digest("base64") !== digest)
    throw new Error(`${name}: integrity mismatch`);
  await mkdir(TOOLS, { recursive: true });
  await writeFile(archive, bytes);
  // Always re-extract from the verified archive: never trust an existing tree.
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const tar = await runCommand(["tar", "-xzf", archive, "--strip-components=1", "-C", dir]);
  if (tar.exitCode !== 0) throw new Error(tar.stderr);
  return dir;
}

export async function measureIconSet(name: string): Promise<IconSetReport> {
  const version = PINNED[name] ?? "";
  const facts = await packageFacts(name, version);
  const dir = await fetchPackage(name, version);
  const files = await walk(dir);
  const licenseFiles = [];
  for (const file of files.filter((f) => /\/(LICEN[SC]E|COPYING|NOTICE)[^/]*$/i.test(f))) {
    const text = await readFile(file, "utf8");
    licenseFiles.push({
      file: relative(dir, file),
      firstLine: (text.split("\n").find((l) => l.trim() !== "") ?? "").trim().slice(0, 100),
    });
  }
  const svgs = files.filter((f) => f.endsWith(".svg"));
  const byDir = new Map<string, string[]>();
  for (const f of svgs) {
    const d = relative(dir, join(f, ".."));
    byDir.set(d, [...(byDir.get(d) ?? []), f]);
  }
  const svgDirs = [];
  for (const [d, list] of [...byDir].sort((a, b) => b[1].length - a[1].length).slice(0, 4)) {
    const contents = await Promise.all(list.map((f) => readFile(f)));
    const all = Buffer.concat(contents);
    svgDirs.push({
      dir: d,
      count: list.length,
      bytes: all.length,
      gzipBytes: gzipSync(all).length,
    });
  }
  const lookups: Record<string, string | null> = {};
  for (const want of LOOKUPS[name] ?? []) {
    const matches = svgs.filter((f) => f.endsWith(`/${want}.svg`)).sort();
    // Prefer the default style directory of each set when several exist.
    const hit =
      matches.find((f) => /\/(icons\/outline|outlined|assets\/regular)\//.test(f)) ?? matches[0];
    lookups[want] = hit === undefined ? null : relative(dir, hit);
  }
  const disallowed: Record<string, number> = {};
  const notable: Record<string, number> = {};
  let parseErrors = 0;
  for (const file of svgs) {
    const parsed = parseXml(await readFile(file, "utf8"));
    if (!parsed.ok) {
      parseErrors++;
      continue;
    }
    const seenEl = new Set<string>();
    const seenAttr = new Set<string>();
    for (const el of elements(parsed.root)) {
      if (!ALLOWED_ELEMENTS.has(el.name)) seenEl.add(el.name);
      for (const attr of el.attributes) {
        const n = attr.name;
        if (
          n === "style" ||
          n === "class" ||
          n === "transform" ||
          n.startsWith("on") ||
          n.endsWith("href") ||
          n === "fill-rule" ||
          n === "clip-rule" ||
          attr.value.includes("url(") ||
          attr.value === "currentColor"
        )
          seenAttr.add(n === "fill" || n === "stroke" ? `${n}=currentColor` : n);
      }
    }
    for (const e of seenEl) disallowed[e] = (disallowed[e] ?? 0) + 1;
    for (const a of seenAttr) notable[a] = (notable[a] ?? 0) + 1;
  }
  return {
    name,
    version: facts.version,
    npmLicense: facts.license,
    licenseFiles,
    svgDirs,
    lookups,
    disallowedElements: disallowed,
    notableAttributes: notable,
    parseErrors,
  };
}

/**
 * Tabler outline without its "Brand" category (logos / trademarks), the set
 * the doc proposes to bundle. The category is read from the package's own
 * categories/outline/Brand/ directory.
 */
export async function tablerWithoutBrands(): Promise<{
  outline: number;
  brand: number;
  kept: number;
  bytes: number;
  gzipBytes: number;
  usedIconsKept: boolean;
}> {
  const dir = await fetchPackage("@tabler/icons", PINNED["@tabler/icons"] ?? "");
  const outlineDir = join(dir, "icons", "outline");
  const outline = (await readdir(outlineDir)).filter((f) => f.endsWith(".svg")).sort();
  const brand = new Set(
    (await readdir(join(dir, "categories", "outline", "Brand"))).filter((f) => f.endsWith(".svg")),
  );
  const kept = outline.filter((f) => !brand.has(f));
  const all = Buffer.concat(await Promise.all(kept.map((f) => readFile(join(outlineDir, f)))));
  return {
    outline: outline.length,
    brand: brand.size,
    kept: kept.length,
    bytes: all.length,
    gzipBytes: gzipSync(all).length,
    usedIconsKept: ["wave-sine.svg", "flame.svg", "snowflake.svg", "keyboard.svg"].every((f) =>
      kept.includes(f),
    ),
  };
}

/** Per-icon license data Simple Icons ships (data/simple-icons.json), by SPDX id. */
export async function simpleIconsLicenses(): Promise<{
  icons: number;
  withLicense: number;
  byLicense: Record<string, number>;
}> {
  const dir = await fetchPackage("simple-icons", PINNED["simple-icons"] ?? "");
  const data = JSON.parse(await readFile(join(dir, "data", "simple-icons.json"), "utf8")) as {
    license?: { type?: string };
  }[];
  const byLicense: Record<string, number> = {};
  for (const icon of data) {
    if (icon.license === undefined) continue;
    const type = icon.license.type ?? "custom";
    byLicense[type] = (byLicense[type] ?? 0) + 1;
  }
  return {
    icons: data.length,
    withLicense: data.filter((i) => i.license !== undefined).length,
    byLicense,
  };
}

/** Emoji SVGs outside npm, fetched from pinned upstream commits. */
export const EMOJI_SAMPLES: Record<string, string> = {
  "noto-emoji@e20cbc2 1f525":
    "https://raw.githubusercontent.com/googlefonts/noto-emoji/e20cbc2bbec1926686be9f9bee7d1d2cfa1fea0e/2D/svg/emoji_u1f525.svg",
  "noto-emoji@e20cbc2 2744":
    "https://raw.githubusercontent.com/googlefonts/noto-emoji/e20cbc2bbec1926686be9f9bee7d1d2cfa1fea0e/2D/svg/emoji_u2744.svg",
  "fluentui-emoji@1ffb34c fire flat":
    "https://raw.githubusercontent.com/microsoft/fluentui-emoji/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/assets/Fire/Flat/fire_flat.svg",
  "fluentui-emoji@1ffb34c snowflake flat":
    "https://raw.githubusercontent.com/microsoft/fluentui-emoji/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/assets/Snowflake/Flat/snowflake_flat.svg",
};

export async function emojiSamples(): Promise<
  { sample: string; status: number; bytes: number; elements: string[] }[]
> {
  const out = [];
  for (const [sample, url] of Object.entries(EMOJI_SAMPLES)) {
    const response = await fetch(url);
    const text = response.ok ? await response.text() : "";
    const parsed = response.ok ? parseXml(text) : undefined;
    const names = new Set<string>();
    if (parsed?.ok) for (const el of elements(parsed.root)) names.add(el.name);
    out.push({ sample, status: response.status, bytes: text.length, elements: [...names].sort() });
  }
  return out;
}

export async function measureIconSets(): Promise<IconSetReport[]> {
  const out = [];
  for (const name of ICON_SETS) out.push(await measureIconSet(name));
  return out;
}

if (import.meta.main)
  console.log(
    JSON.stringify(
      {
        sets: await measureIconSets(),
        simpleIcons: await simpleIconsLicenses(),
        emoji: await emojiSamples(),
      },
      null,
      2,
    ),
  );
