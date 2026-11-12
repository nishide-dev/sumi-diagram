import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readmeHtml } from "./readme";

test("converts both README locations, copies pictures, and preserves escaping", async () => {
  const root = await mkdtemp(resolve(".sumi/tmp/readme-"));
  try {
    await mkdir(resolve(root, "docs"));
    await writeFile(resolve(root, "light.svg"), "light");
    await writeFile(resolve(root, "dark.svg"), "dark");
    for (const [file, prefix] of [
      ["README.md", ""],
      ["docs/README-ja.md", "../"],
    ] as const) {
      const html = await readmeHtml(
        `# Sumi\n\n[language](${prefix}README.md) | [site](https://nishide-dev.github.io/sumi-diagram/)\n\nTag & text.\n\n[doc](${prefix}docs/usage.md#install) [section](#local) [examples](https://nishide-dev.github.io/sumi-diagram/#examples)\n\n<picture><source media="(prefers-color-scheme: dark)" srcset="${prefix}dark.svg"><img src="${prefix}light.svg" alt="figure"></picture>\n\n<details><summary>More</summary>text</details>\n\n<script>alert(1)</script>`,
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
      expect(html).toContain('href="#local"');
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
  const root = await mkdtemp(resolve(".sumi/tmp/readme-"));
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
