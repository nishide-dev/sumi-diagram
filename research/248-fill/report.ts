/** Summarize and independently compare the saved compatibility manifests. */
import { createHash } from "node:crypto";

interface Entry {
  svg?: string;
  pdf?: string | string[];
  pptx?: string | string[];
  d2?: string | null;
  errors?: string[];
}
interface Manifest {
  files: string[];
  records: Record<string, Entry>;
}
const before = (await Bun.file(".sumi/248-before.json").json()) as Manifest;
const after = (await Bun.file(".sumi/248-after.json").json()) as Manifest;
const changed = Object.keys(before.records).filter(
  (key) => JSON.stringify(before.records[key]) !== JSON.stringify(after.records[key]),
);
if (JSON.stringify(before.files) !== JSON.stringify(after.files)) throw new Error("Cohort changed");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const entries = Object.values(before.records);
const report = {
  baseCommit: "61e6c20f2bcf318826962eb7ef50be2d6ae114c9",
  figures: before.files.length,
  themes: ["own", "minimal", "academic", "slides", "color", "paper"],
  cases: entries.length,
  svg: entries.filter((e) => e.svg !== undefined).length,
  pdf: entries.filter((e) => typeof e.pdf === "string").length,
  picturePptx: entries.filter((e) => typeof e.pptx === "string").length,
  d2: entries.filter((e) => typeof e.d2 === "string").length,
  notRendered: entries.filter((e) => e.errors !== undefined).length,
  beforeSha256: digest(before),
  afterSha256: digest(after),
  changed,
};
await Bun.write("research/248-fill/compatibility.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (changed.length) process.exitCode = 1;
