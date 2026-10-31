import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importSvg } from "../../src/assets/svg-import";
import { base, fontFiles, satoriSvg, sourceHtml, takumi, takumiMeasure } from "./gen";

const out = join(base, "out");
mkdirSync(out, { recursive: true });
const _fonts = [fontFiles.mono, fontFiles.inter, fontFiles.interBold];
const kinds = (r: ReturnType<typeof importSvg>) =>
  r.ok
    ? []
    : [
        ...new Set(
          r.issues.map((i) => `${i.kind}: ${i.message.replace(/\s*[;:].*$/, "").slice(0, 70)}`),
        ),
      ];

import { usvg } from "./probe-lib";

const results: Record<string, unknown> = {};

// 1. importer compatibility per library / set / piece
const compat: Record<string, unknown>[] = [];
for (const [set, dir] of [
  ["full", "html"],
  ["safe", "html-safe"],
] as const) {
  for (const f of readdirSync(join(base, dir))
    .filter((x) => x.endsWith(".html"))
    .sort()) {
    const name = f.replace(".html", "");
    const src = sourceHtml(dir, name);
    for (const lib of ["takumi", "satori"] as const) {
      const raw = lib === "takumi" ? await takumi(src) : await satoriSvg(src);
      const rawImport = importSvg(raw);
      let norm = "";
      let normImport: ReturnType<typeof importSvg> | undefined;
      try {
        norm = usvg(raw);
        normImport = importSvg(norm);
      } catch (_e) {
        norm = "";
      }
      writeFileSync(join(out, `${set}-${name}.${lib}.raw.svg`), raw);
      if (norm) writeFileSync(join(out, `${set}-${name}.${lib}.norm.svg`), norm);
      compat.push({
        set,
        piece: name,
        lib,
        rawBytes: raw.length,
        rawImportOk: rawImport.ok,
        rawIssueCount: rawImport.ok ? 0 : rawImport.issues.length,
        rawIssueKinds: kinds(rawImport),
        normBytes: norm.length,
        normImportOk: normImport?.ok ?? false,
        normIssueKinds: normImport ? kinds(normImport) : ["usvg failed"],
        hasTextElement: /<text[\s>]/.test(raw),
        idsCollide: undefined,
      });
    }
  }
}
results.compat = compat;
for (const c of compat)
  console.log(
    `${c.set}/${c.piece}/${c.lib}: raw ${c.rawImportOk ? "OK" : `x${c.rawIssueCount}`}  norm ${c.normImportOk ? "OK" : `FAIL ${JSON.stringify(c.normIssueKinds)}`}`,
  );

// 2. id collisions across pieces
const ids = (svg: string) => [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!);
const a = await takumi(sourceHtml("html", "code-window"));
const b = await takumi(sourceHtml("html", "text-card"));
const sa = await satoriSvg(sourceHtml("html", "code-window"));
const sb = await satoriSvg(sourceHtml("html", "text-card"));
results.idCollisions = {
  takumi: ids(a)
    .filter((i) => ids(b).includes(i))
    .slice(0, 5),
  satori: ids(sa)
    .filter((i) => ids(sb).includes(i))
    .slice(0, 5),
};

// 3. text behaviour
const code = sourceHtml("html", "code-window");
const satoriText = await satoriSvg(code, false);
results.text = {
  takumiHasTextElement: /<text[\s>]/.test(a),
  takumiGlyphUses: (a.match(/<use /g) ?? []).length,
  satoriDefaultHasTextElement: /<text[\s>]/.test(sa),
  satoriEmbedFalseHasTextElement: /<text[\s>]/.test(satoriText),
  satoriEmbedFalseSample: satoriText.match(/<text[^>]*>[^<]*<\/text>/)?.[0],
  satoriEmbedFalseImport: kinds(importSvg(satoriText)),
};
// whitespace handling in code: are the leading spaces of "    tokens" kept?
const m = await takumiMeasure(code);
const flat: { text: string; x: number; y: number; width: number; height: number }[] = [];
(function walk(n: any) {
  for (const r of n.runs ?? []) flat.push(r);
  for (const c of n.children ?? []) walk(c);
})(m);
results.measure = { root: { width: m.width, height: m.height }, runs: flat };

// 4. safety probes: does anything fetch? local server counts requests.
let hits: string[] = [];
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    hits.push(new URL(req.url).pathname);
    return new Response(
      "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect width='10' height='10' fill='red'/></svg>",
      { headers: { "content-type": "image/svg+xml" } },
    );
  },
});
const origin = `http://127.0.0.1:${server.port}`;
const probes: Record<string, string> = {
  img: `<div style="display:flex"><img src="${origin}/img.svg" width="40" height="40"/></div>`,
  bgImage: `<div style="display:flex;width:60px;height:60px;background-image:url(${origin}/bg.svg)"></div>`,
  cssImport: `<div style="display:flex"><style>@import url(${origin}/import.css); @font-face{font-family:X;src:url(${origin}/font.ttf)}</style>hi</div>`,
  script: `<div style="display:flex">hi<script>fetch("${origin}/script")</script></div>`,
  linkTag: `<div style="display:flex"><link rel="stylesheet" href="${origin}/link.css"/>hi</div>`,
  iframe: `<div style="display:flex"><iframe src="${origin}/iframe"></iframe>hi</div>`,
  onclick: `<div style="display:flex" onclick="x()">hi</div>`,
  fileImg: `<div style="display:flex"><img src="file:///etc/hosts" width="40" height="40"/></div>`,
  dataImg: `<div style="display:flex"><img src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Crect width='10' height='10' fill='red'/%3E%3C/svg%3E" width="40" height="40"/></div>`,
};
const safety: Record<string, unknown> = {};
for (const [name, src] of Object.entries(probes)) {
  for (const lib of ["takumi", "satori"] as const) {
    hits = [];
    let status = "ok";
    let svg = "";
    try {
      svg = lib === "takumi" ? await takumi(src, 100, 60) : await satoriSvg(src, true, 100, 60);
    } catch (e) {
      status = `error: ${String(e).slice(0, 110)}`;
    }
    await Bun.sleep(50);
    safety[`${name}.${lib}`] = {
      status,
      requestsToLocalServer: [...hits],
      outputHasExternalRef: /https?:\/\/127\.0\.0\.1/.test(svg),
      outputHasImageTag: /<image/.test(svg),
      outputHasScript: /<script/i.test(svg),
    };
  }
}
server.stop(true);
results.safety = safety;

// 5. unsupported / unusual CSS: error, ignored or rendered
const css: Record<string, string> = {
  grid: `<div style="display:grid;grid-template-columns:1fr 1fr;width:100px;height:40px"><div style="background:red"></div><div style="background:blue"></div></div>`,
  float: `<div style="display:flex;width:100px;height:40px"><div style="float:right;width:20px;height:20px;background:red"></div></div>`,
  position: `<div style="display:flex;position:relative;width:100px;height:40px"><div style="position:absolute;right:4px;top:4px;width:20px;height:20px;background:red"></div></div>`,
  calc: `<div style="display:flex;width:calc(100% - 20px);height:20px;background:red"></div>`,
  cssVar: `<div style="display:flex;--c:#f00;width:50px;height:20px;background:var(--c)"></div>`,
  transform: `<div style="display:flex;width:50px;height:20px;background:red;transform:rotate(10deg)"></div>`,
  boxShadow: `<div style="display:flex;width:50px;height:20px;background:red;box-shadow:0 2px 6px #000"></div>`,
  filterBlur: `<div style="display:flex;width:50px;height:20px;background:red;filter:blur(2px)"></div>`,
  textShadow: `<div style="display:flex;font-size:20px;text-shadow:1px 1px 2px #000">Hi</div>`,
  radialGradient: `<div style="display:flex;width:50px;height:20px;background:radial-gradient(#f00,#00f)"></div>`,
  unknownTag: `<div style="display:flex"><blink>x</blink><table><tr><td>cell</td></tr></table></div>`,
  inlineBlockSpan: `<p>plain <b>bold</b> <em>em</em> text with no display:flex</p>`,
  overflowText: `<div style="display:flex;width:60px;height:20px;font-size:16px;font-family:Inter">A very long unbroken sentence that overflows</div>`,
  missingGlyph: `<div style="display:flex;font-size:20px;font-family:Inter">𓀀 ★ ∇ 日本語</div>`,
  emoji: `<div style="display:flex;font-size:20px">😀</div>`,
};
const cssResults: Record<string, unknown> = {};
for (const [name, src] of Object.entries(css)) {
  for (const lib of ["takumi", "satori"] as const) {
    let status = "ok";
    let svg = "";
    try {
      svg = lib === "takumi" ? await takumi(src, 120, 60) : await satoriSvg(src, true, 120, 60);
    } catch (e) {
      status = `error: ${String(e).slice(0, 120)}`;
    }
    cssResults[`${name}.${lib}`] = {
      status,
      bytes: svg.length,
      elements: [...new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]))].join(","),
    };
  }
}
results.css = cssResults;
writeFileSync(join(out, "probe-results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log("done");
