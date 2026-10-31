/**
 * Escaping in the gallery pages (#17): catalog descriptions, prop
 * descriptions, example titles, diagnostics and paths are untrusted text and
 * must not inject HTML, attributes, Markdown or table cells.
 */

import { describe, expect, test } from "bun:test";
import type { CatalogEntry } from "../../src/core/registry/catalog";
import { ptToMm } from "../../src/core/units";
import {
  escapeHtml,
  type GalleryModel,
  galleryHtml,
  galleryMarkdownPages,
  mdCode,
  mdFence,
  mdInline,
  mdText,
} from "./page";
import { type RenderOutcome, renderOne } from "./render";

const NASTY = "a | b `c` <img src=x onerror=alert(1)> \"q\" 's' *em* [l](u)\nnext";
const PATH = 'docs/gallery/components/x" onerror="alert(1) |.svg';

function outcome(overrides: Partial<RenderOutcome> = {}): RenderOutcome {
  return {
    rendering: { output: PATH, theme: "minimal", profile: "paper-double", overrides: {} },
    svg: "<svg/>",
    theme: "minimal",
    profile: "paper-double",
    widthPt: 100,
    heightPt: 50,
    diagnostics: [],
    ...overrides,
  };
}

const entry = {
  id: "sumi/box",
  kind: "node",
  namespace: "sumi",
  name: "box",
  description: NASTY,
  variants: ["default"],
  since: "0.1.0",
  shape: "rectangle",
  sizing: "auto",
  props: {
    type: "object",
    properties: { width: { type: "string", description: NASTY } },
  },
} as unknown as CatalogEntry;

const model: GalleryModel = {
  components: [
    {
      sample: {
        entry,
        fileName: "sumi-box.sumi.yaml",
        source: "# ``` fence\nversion: 1\n",
        renderings: [],
      },
      outcomes: [outcome()],
    },
  ],
  examples: [{ source: "examples/x/x.sumi.yaml", title: NASTY, outcome: outcome() }],
  comparison: {
    source: "examples/x/x.sumi.yaml",
    outcomes: [
      (({ svg: _svg, widthPt: _w, heightPt: _h, ...rest }) => rest)(
        outcome({
          diagnostics: [{ code: "profile/font-too-small", severity: "error", message: NASTY }],
        }),
      ),
    ],
  },
  themeComparison: {
    source: "examples/x/x.sumi.yaml",
    outcomes: [outcome({ diagnostics: [{ code: "x/y", severity: "warning", message: NASTY }] })],
  },
  tones: {
    sample: { fileName: "tones.sumi.yaml", source: "# ``` fence\nversion: 1\n", renderings: [] },
    outcomes: [outcome({ diagnostics: [{ code: "x/y", severity: "warning", message: NASTY }] })],
  },
  dim: {
    sample: { fileName: "dim.sumi.yaml", source: "# ``` fence\nversion: 1\n", renderings: [] },
    outcomes: [outcome({ diagnostics: [{ code: "x/y", severity: "warning", message: NASTY }] })],
  },
  outlinedTones: {
    sample: { fileName: "outlined.sumi.yaml", source: "# ``` fence\nversion: 1\n", renderings: [] },
    outcomes: [outcome()],
  },
  filledTones: {
    sample: { fileName: "filled.sumi.yaml", source: "version: 1\n", renderings: [] },
    outcomes: [outcome()],
  },
};

describe("Markdown escaping", () => {
  test("the index preserves old page, renamed example, component and topic heading anchors", () => {
    const examples = [
      {
        source: "examples/dit-block/dit-block.sumi.yaml",
        title: "DiT block variants (structured layout, paper theme)",
        outcome: outcome(),
      },
      {
        source: "examples/transformer/transformer.sumi.yaml",
        title: "Transformer (structured layout, paper theme)",
        outcome: outcome(),
      },
    ];
    const index = galleryMarkdownPages({ ...model, examples }).get("docs/gallery/README.md");
    for (const id of [
      "sumi-component-gallery",
      "examplesdit-blockdit-blocksumiyaml",
      "examplestransformertransformersumiyaml",
      "sumibox",
      "examples",
      "themes-and-profiles",
      "tones",
      "solid-and-tinted-tones",
      "outlined-tones-and-edge-tones",
      "dimmed-groups",
      "profiles",
      "one-figure-every-theme--profile",
    ]) {
      expect(index).toContain(`<a id="${id}"></a>`);
    }
  });

  test("mdText escapes HTML, Markdown punctuation, pipes and newlines", () => {
    const text = mdText(NASTY);
    expect(text).not.toContain("<img");
    expect(text).not.toContain("|");
    expect(text).not.toContain("\n");
    expect(text).not.toMatch(/(^|[^\\])[`*[\]]/);
    expect(text).toContain("&lt;img src=x onerror=alert\\(1\\)&gt;");
    expect(text).toContain("&quot;q&quot;");
  });

  test("mdText yields exactly one escape per character (no double escaping)", () => {
    // Each output decodes, under CommonMark, back to the input character:
    // `\x` → x for ASCII punctuation, `&name;` / `&#n;` → the character.
    expect(mdText("theme's")).toBe("theme's");
    expect(mdText("a & b")).toBe("a &amp; b");
    expect(mdText("<b>")).toBe("&lt;b&gt;");
    expect(mdText("#1")).toBe("\\#1");
    expect(mdText("a|b")).toBe("a&#124;b");
    expect(mdText('"q"')).toBe("&quot;q&quot;");
    expect(mdText("\\")).toBe("\\\\");
    expect(mdText("&#39;")).toBe("&amp;\\#39;");
    expect(mdText("x\ny")).toBe("x y");
  });

  test("mdCode cannot be closed by a backtick; mdInline keeps code spans", () => {
    expect(mdCode("a`b|c")).toBe("<code>a\\`b&#124;c</code>");
    expect(mdInline("use `x|y` here")).toBe("use <code>x&#124;y</code> here");
  });

  test("mdFence outlasts backtick runs in the code", () => {
    expect(mdFence("a ``` b", "yaml")).toBe("````yaml\na ``` b\n````");
  });

  test("the page contains no injected HTML or table cells", () => {
    const pages = galleryMarkdownPages(model);
    // The index, the component's page and the five topic pages.
    expect([...pages.keys()].sort()).toEqual([
      "docs/gallery/README.md",
      "docs/gallery/compare.md",
      "docs/gallery/components/sumi-box.md",
      "docs/gallery/dim.md",
      "docs/gallery/examples.md",
      "docs/gallery/themes.md",
      "docs/gallery/tones.md",
    ]);
    const md = [...pages.values()].join("\n");
    expect(md).not.toContain("<img src=x");
    expect(md).not.toContain('" onerror="');
    expect(md).not.toContain("a | b");
    // Images are relative to the page: the component page lives in components/.
    expect(pages.get("docs/gallery/components/sumi-box.md")).toContain(
      'src="x%22%20onerror%3D%22alert(1)%20%7C.svg"',
    );
    expect(pages.get("docs/gallery/tones.md")).toContain(
      'src="components/x%22%20onerror%3D%22alert(1)%20%7C.svg"',
    );
    // Every table row has as many cells as its header.
    const rows = md.split("\n").filter((line) => line.startsWith("| "));
    const cells = (row: string) => row.split("|").length;
    for (const row of rows.filter(
      (r) => r.startsWith("| prop") || r.includes("yes |") || r.includes("no |"),
    )) {
      expect(cells(row)).toBe(6);
    }
    expect(md).toContain("````yaml\n# ``` fence");
  });
});

test("the fitted DiT size reaches both Markdown and HTML captions", async () => {
  const source = "examples/dit-block/dit-block.sumi.yaml";
  const result = await renderOne({
    file: source,
    source: await Bun.file(new URL(`../../${source}`, import.meta.url)).text(),
    rendering: {
      output: "examples/dit-block/dit-block.svg",
      theme: "paper",
      profile: "paper-double",
      overrides: {},
    },
  });
  expect(result.svg).toBeDefined();
  expect(ptToMm(result.widthPt ?? 0)).toBeCloseTo(180, 2);
  expect(ptToMm(result.heightPt ?? 0)).toBeCloseTo(84.69, 2);
  const fittedModel = { ...model, examples: [{ source, title: "DiT", outcome: result }] };
  expect(galleryMarkdownPages(fittedModel).get("docs/gallery/examples.md")).toContain(
    "180mm × 84\\.69mm",
  );
  expect(galleryHtml(fittedModel)).toContain("180mm × 84.69mm");
});

describe("HTML escaping", () => {
  test("escapeHtml covers text and both attribute quotes", () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;",
    );
  });

  test("the page contains no injected HTML or attributes", () => {
    const html = galleryHtml(model);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('" onerror="');
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain('src="components/x%22%20onerror%3D%22alert(1)%20%7C.svg"');
  });
});
