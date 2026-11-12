import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readmeHtml } from "./readme";

test("converts both README locations, copies pictures, and preserves escaping", async () => {
  const root = await mkdtemp(join(tmpdir(), "sumi-readme-"));
  try {
    await mkdir(resolve(root, "docs"));
    await writeFile(resolve(root, "light.svg"), "light");
    await writeFile(resolve(root, "dark.svg"), "dark");
    for (const [file, prefix, other] of [
      ["README.md", "", "docs/README-ja.md"],
      ["docs/README-ja.md", "../", "../README.md"],
    ] as const) {
      const html = await readmeHtml(
        `# Sumi\n\n[language](${other}) | [site](https://nishide-dev.github.io/sumi-diagram/)\n\nTag & text.\n\n[doc](${prefix}docs/usage.md#install) [section](#local) [examples](https://nishide-dev.github.io/sumi-diagram/#examples)\n\n<picture><source media="(prefers-color-scheme: dark)" srcset="${prefix}dark.svg"><img src="${prefix}light.svg" alt="figure"></picture>\n\n<details><summary>More</summary>text</details>\n\n<script>alert(1)</script>`,
        file,
        root,
        resolve(root, "out"),
      );
      expect(html).not.toContain("<h1>");
      expect(html).not.toContain(">language</a>");
      expect(html).toContain("Tag &amp; text");
      expect(html).toContain(
        'href="https://github.com/nishide-dev/sumi-diagram/blob/main/docs/usage.md#install"',
      );
      expect(html).toContain(
        `href="https://github.com/nishide-dev/sumi-diagram/blob/main/${file}#local"`,
      );
      expect(html).toContain('href="#examples"');
      expect(html).toContain('src="./readme/dark.svg"');
      expect(html).toContain('src="./readme/light.svg"');
      expect(html).toContain('class="readme-dark"');
      expect(html).not.toContain("<p><details>");
      expect(html).not.toContain("<script");
    }
    expect(await readFile(resolve(root, "out/readme/dark.svg"), "utf8")).toBe("dark");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("marks the tagline, drops the link line after the intro, and drops an empty table header", async () => {
  const root = await mkdtemp(join(tmpdir(), "sumi-readme-"));
  try {
    const html = await readmeHtml(
      "# Sumi\n\n**Draw, check, fix.**\n\nIntro with [a link](docs/usage.md).\n\n[Website](https://nishide-dev.github.io/sumi-diagram/) · [日本語](docs/README-ja.md)\n\n| | |\n| --- | --- |\n| **A** | b |\n",
      "README.md",
      root,
      resolve(root, "out"),
    );
    expect(html).toContain('<p class="tagline">Draw, check, fix.</p>');
    expect(html).toContain(">a link</a>");
    expect(html).not.toContain(">Website</a>");
    expect(html).not.toContain("<thead>");
    expect(html).toContain("<strong>A</strong>");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps a lone link paragraph, splits a bold lead, and rewrites single-quoted attributes", async () => {
  const root = await mkdtemp(join(tmpdir(), "sumi-readme-"));
  try {
    await writeFile(resolve(root, "a.svg"), "a");
    const html = await readmeHtml(
      "**Draw, check, fix.** Sumi is a CLI.\n\n[Read the guide](README.md)\n\n<p><img src='a.svg' alt=''><a href='docs/x.md'>x</a></p>\n",
      "README.md",
      root,
      resolve(root, "out"),
    );
    expect(html).toContain('<p class="tagline">Draw, check, fix.</p>');
    expect(html).toContain("<p>Sumi is a CLI.</p>");
    expect(html).toContain(">Read the guide</a>");
    expect(html).toContain('src="./readme/a.svg"');
    expect(html).toContain(
      'href="https://github.com/nishide-dev/sumi-diagram/blob/main/docs/x.md"',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removes a lone language link before the bold lead and keeps external image URLs intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "sumi-readme-"));
  try {
    const html = await readmeHtml(
      "# Sumi\n\n[日本語](docs/README-ja.md)\n\n**Draw, check, fix.** Sumi is a CLI.\n\n[Gallery](docs/gallery/README.md)\n\n<img src='https://example.com/a\"b.svg' alt=''>\n",
      "README.md",
      root,
      resolve(root, "out"),
    );
    expect(html).not.toContain(">日本語</a>");
    expect(html).toContain(">Gallery</a>");
    expect(html).toContain('<p class="tagline">Draw, check, fix.</p>');
    expect(html).toContain('src="https://example.com/a&quot;b.svg"');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
