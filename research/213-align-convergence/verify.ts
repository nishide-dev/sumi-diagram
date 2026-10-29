import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { stringify } from "yaml";
import { compileFigure } from "../../src/compiler/compile";
import { BUILTIN_THEMES } from "../../src/core/theme/builtin";
import { placeStructured } from "../../src/layout/structured/engine";
import { renderFigure } from "../../src/render/render";

// Run before and after the solver change: bun research/213-align-convergence/verify.ts before|after
// Hashes and timings stay in the ignored .sumi/review directory.
const phase = process.argv[2];
if (phase !== "before" && phase !== "after") throw new Error("Expected before or after");
const files = [...new Bun.Glob("**/*.sumi.yaml").scanSync({ cwd: process.cwd(), dot: true })]
  .filter((p) => !/^(node_modules|\.git|\.claude|\.sumi)\//.test(p))
  .sort();
const hashes: Record<string, unknown> = {};
for (const file of files) {
  const source = await Bun.file(file).text();
  for (const theme of ["own", ...BUILTIN_THEMES.keys()]) {
    const result = await renderFigure(source, {
      assetBase: resolve(dirname(file)),
      ...(theme === "own" ? {} : { overrides: { theme } }),
    });
    hashes[`${file} @ ${theme}`] = {
      sha256: result.ok ? createHash("sha256").update(result.value.svg).digest("hex") : null,
      diagnostics: result.diagnostics.map((d) => [d.code, d.severity, d.path]),
    };
  }
}
await Bun.write(`.sumi/review/${phase}-hashes.json`, JSON.stringify(hashes, null, 2));
console.log({ phase, files: files.length, cases: Object.keys(hashes).length });

// Same synthetic cases as align.test.ts, with its deterministic text measurer.
const fake = {
  lineWidth: (text: string, _font: unknown, size: number) => ([...text].length * size) / 2,
  verticalMetrics: (_font: unknown, size: number) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
};
const box = (id: string, label = "A") => ({ id, component: "box", label });
const figure = (layout: object, nodes: unknown[]) =>
  stringify({ version: 1, figure: { id: "t", layout }, nodes });
const cases: [string, string, boolean][] = [];
for (const file of files.filter((p) => /\/align[^/]*\.sumi.yaml$/.test(p))) {
  cases.push([file, await Bun.file(file).text(), false]);
}
cases.push([
  "250 impossible constraints",
  figure(
    {
      arrange: { stack: { items: ["a", "b"] } },
      align: Array.from({ length: 250 }, () => ({ y: ["a", "b"] })),
    },
    [box("a"), box("b")],
  ),
  true,
]);
cases.push([
  "100 met + 1 unmet",
  figure(
    {
      arrange: {
        row: {
          align: "start",
          items: [{ stack: { items: ["a", "b"] } }, { stack: { items: ["c", "d", "e"] } }],
        },
      },
      align: [...Array.from({ length: 100 }, () => ({ y: ["a", "c"] })), { y: ["b", "e"] }],
    },
    ["a", "b", "c", "d", "e"].map((id) => box(id)),
  ),
  true,
]);
let seed = 132;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const ids = Array.from({ length: 18 }, (_, i) => `n${i}`);
const middle = ids.slice(6, 12);
const arrange = {
  row: {
    align: "start",
    items: [
      { stack: { items: ids.slice(0, 6) } },
      {
        stack: {
          items: [0, 2, 4].map((i) => ({ stack: { gap: 0, items: middle.slice(i, i + 2) } })),
        },
      },
      { stack: { align: "end", items: ids.slice(12) } },
    ],
  },
};
for (let i = 0; i < 40; i++) {
  const align = Array.from({ length: 1 + Math.floor(random() * 4) }, () => {
    const a = ids[Math.floor(random() * ids.length)];
    let b = a;
    while (b === a) b = ids[Math.floor(random() * ids.length)];
    const at = ["center", "start", "end"][Math.floor(random() * 3)];
    return random() < 0.7 ? { y: [a, b], at } : { x: [a, b], at };
  });
  cases.push([
    `random-${i}`,
    figure(
      { arrange, align },
      ids.map((id, j) => box(id, j % 5 === 0 ? "A\nB" : "A".repeat(1 + (j % 4)))),
    ),
    true,
  ]);
}
const timings = [];
for (const [name, text, useFake] of cases) {
  const compiled = compileFigure(text);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const ir = compiled.value.ir;
  const options = useFake ? { measurer: fake } : {};
  for (let i = 0; i < 5; i++) placeStructured(ir, options);
  const samples = [];
  for (let i = 0; i < 21; i++) {
    const start = performance.now();
    placeStructured(ir, options);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const placed = placeStructured(ir, options);
  const medianMs = samples[10];
  if (medianMs === undefined) throw new Error("Missing timing samples");
  timings.push({
    name,
    medianMs,
    stats: placed.align,
    warnings: placed.diagnostics.filter((d) => d.severity === "warning").map((d) => d.code),
  });
}
await Bun.write(`.sumi/review/${phase}-timings.json`, JSON.stringify(timings, null, 2));
console.log(
  timings
    .filter((t) => !t.name.startsWith("random-"))
    .map((t) => ({ name: t.name, medianMs: t.medianMs, layouts: t.stats?.layouts })),
);
console.log({
  randomMedianTotalMs: timings
    .filter((t) => t.name.startsWith("random-"))
    .reduce((s, t) => s + t.medianMs, 0),
});
