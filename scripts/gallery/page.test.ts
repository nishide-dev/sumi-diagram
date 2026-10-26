/**
 * Escaping in the gallery pages (#17): catalog descriptions, prop
 * descriptions, example titles, diagnostics and paths are untrusted text and
 * must not inject HTML, attributes, Markdown or table cells.
 */

import { describe, expect, test } from "bun:test";
import type { CatalogEntry } from "../../src/core/registry/catalog";
import {
  escapeHtml,
  type GalleryModel,
  galleryHtml,
  galleryMarkdown,
  mdCode,
  mdFence,
  mdInline,
  mdText,
} from "./page";
import type { RenderOutcome } from "./render";

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
  tones: {
    sample: { fileName: "tones.sumi.yaml", source: "# ``` fence\nversion: 1\n", renderings: [] },
    outcomes: [outcome({ diagnostics: [{ code: "x/y", severity: "warning", message: NASTY }] })],
  },
};

describe("Markdown escaping", () => {
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
    const md = galleryMarkdown(model);
    expect(md).not.toContain("<img src=x");
    expect(md).not.toContain('" onerror="');
    expect(md).not.toContain("a | b");
    expect(md).toContain('src="components/x%22%20onerror%3D%22alert(1)%20%7C.svg"');
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
