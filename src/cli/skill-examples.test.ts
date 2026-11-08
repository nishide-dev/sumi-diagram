import { describe, expect, test } from "bun:test";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { inspectPdf } from "../render/pdf/testing";
import { renderFigure } from "../render/render";

const ROOT = resolve(import.meta.dir, "../..");
const SKILL = join(ROOT, "skills/sumi");
const NAMES = [
  "transformer",
  "dit-block",
  "clip",
  "embedding-gemma",
  "gcn",
  "tricl",
  "llama4-moe",
  "chat",
  "llm-dialogue",
  "pipeline",
  "decision-flow",
  "system-architecture",
  "grouped",
];

/** Do not follow symlinks: Git archives preserve them, rather than their targets. */
function realFiles(directory: string): string[] {
  expect(lstatSync(directory).isSymbolicLink(), directory).toBe(false);
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    const stat = lstatSync(path);
    expect(stat.isSymbolicLink(), path).toBe(false);
    return stat.isDirectory() ? realFiles(path) : [path];
  });
}

/** Validate every chunk's CRC as well as the complete, decodable RGB image data. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const data: Buffer[] = [];
  let width = 0;
  let height = 0;
  let ended = false;
  for (let offset = 8; offset < bytes.length; ) {
    const size = bytes.readUInt32BE(offset);
    const end = offset + 8 + size;
    expect(end + 4).toBeLessThanOrEqual(bytes.length);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, end)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    expect((crc ^ 0xffffffff) >>> 0).toBe(bytes.readUInt32BE(end));
    if (offset === 8) {
      expect(type).toBe("IHDR");
      expect(size).toBe(13);
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      // pdftoppm produces non-interlaced 8-bit RGB PNGs.
      expect([...bytes.subarray(offset + 16, end)]).toEqual([8, 2, 0, 0, 0]);
    }
    if (type === "IDAT") data.push(bytes.subarray(offset + 8, end));
    if (type === "IEND") {
      expect(size).toBe(0);
      expect(end + 4).toBe(bytes.length);
      ended = true;
    }
    offset = end + 4;
  }
  expect(ended).toBe(true);
  expect(width).toBeGreaterThan(0);
  expect(height).toBeGreaterThan(0);
  const pixels = inflateSync(Buffer.concat(data));
  expect(pixels.length).toBe((width * 3 + 1) * height);
  for (let row = 0; row < height; row++) expect(pixels[row * (width * 3 + 1)]).toBeLessThan(5);
  return { width, height };
}

describe("bundled paper reference figures", () => {
  test("the entire distributed Skill contains real files, with no symlinks", () => {
    expect(realFiles(SKILL).length).toBeGreaterThan(0);
    expect(readdirSync(join(SKILL, "examples")).sort()).toEqual(["README.md", ...NAMES].sort());
  });

  test.each(["clip", "embedding-gemma", "gcn"])(
    "%s asset mirrors match the canonical Skill files",
    (name) => {
      const canonical = join(SKILL, "examples", name, "assets");
      const mirror = join(ROOT, "examples", name, "assets");
      const files = realFiles(canonical).map((file) => file.slice(canonical.length + 1));
      expect(realFiles(mirror).map((file) => file.slice(mirror.length + 1))).toEqual(files);
      for (const file of files) {
        expect(readFileSync(join(mirror, file))).toEqual(readFileSync(join(canonical, file)));
      }
    },
  );

  test.each(NAMES)("%s has one source and a valid PNG matching the PDF page", (name) => {
    const source = join(SKILL, "examples", name, `${name}.sumi.yaml`);
    const link = join(ROOT, "examples", name, `${name}.sumi.yaml`);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(link)).toBe(source);
    for (const extension of ["svg", "pdf"]) {
      expect(lstatSync(link.replace(/sumi\.yaml$/, extension)).isFile()).toBe(true);
    }
    const png = pngSize(readFileSync(join(dirname(source), `${name}.png`)));
    const page = inspectPdf(readFileSync(join(ROOT, "examples", name, `${name}.pdf`))).pages[0]
      ?.mediaBox;
    if (!page) throw new Error(`Missing PDF page for ${name}`);
    const width = (page[2] ?? 0) - (page[0] ?? 0);
    const height = (page[3] ?? 0) - (page[1] ?? 0);
    // Previews are rendered at 150 dpi; each PDF dimension is rounded to a whole pixel.
    expect(Math.abs(png.width - (width * 150) / 72)).toBeLessThanOrEqual(2);
    expect(Math.abs(png.height - (height * 150) / 72)).toBeLessThanOrEqual(2);
  });

  test("a standalone installed copy contains real sources, assets and previews and renders identically", async () => {
    const work = await mkdtemp(join(tmpdir(), "sumi-reference-copy-"));
    const installed = join(work, "sumi");
    try {
      // Simulate copying just the discovered Skill from a GitHub clone/archive.
      // No dereferencing: this must work without repository-side link targets.
      await cp(SKILL, installed, { recursive: true, dereference: false });
      expect(realFiles(installed).length).toBe(realFiles(SKILL).length);
      for (const name of NAMES) {
        const file = join(installed, "examples", name, `${name}.sumi.yaml`);
        pngSize(readFileSync(join(dirname(file), `${name}.png`)));
        const result = await renderFigure(readFileSync(file, "utf8"), { assetBase: dirname(file) });
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        expect(result.value.svg).toBe(
          readFileSync(join(ROOT, "examples", name, `${name}.svg`), "utf8"),
        );
      }
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
