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
