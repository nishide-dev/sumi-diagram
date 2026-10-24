/** Verify and record saved Mac PowerPoint edits. Run the AppleScript fixtures first. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = Bun.argv.slice(2);
const record = args.includes("--record");
const at = args.indexOf("--dir");
if (at < 0 || !args[at + 1])
  throw new Error(
    "Usage: bun scripts/record-editable-powerpoint.ts --dir fixture-directory [--record]",
  );
const dir = resolve(args[at + 1] ?? "");
function command(argv: string[]) {
  const r = Bun.spawnSync(argv);
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString();
}
interface Shape {
  name: string;
  kind: string;
  text: string;
  x: string;
  y: string;
  cx: string;
  cy: string;
}
interface Saved {
  file: string;
  shapes: Shape[];
}
const reports = JSON.parse(
  command([
    "dotnet",
    ".sumi/pptx-validator/bin/Validator/release/Validator.dll",
    "--inspect",
    ...["freeform", "glued"].flatMap((mode) =>
      ["roundtrip", "edited"].map((state) => resolve(dir, `japanese.${mode}.${state}.pptx`)),
    ),
  ]),
) as Saved[];
const results = [];
for (const mode of ["freeform", "glued"]) {
  const before = reports.find((r) => r.file === `japanese.${mode}.roundtrip.pptx`),
    after = reports.find((r) => r.file === `japanese.${mode}.edited.pptx`);
  if (!before || !after || before.shapes.length !== 8 || after.shapes.length !== 8)
    throw new Error("Unexpected PowerPoint shape count");
  const b = before.shapes.find((s) => s.name === "n:source"),
    a = after.shapes.find((s) => s.name === "n:source");
  const eb = before.shapes.find((s) => s.name === "e:transfer"),
    ea = after.shapes.find((s) => s.name === "e:transfer");
  if (!a || !b || !ea || !eb || a.text !== "EDITED 日本語" || Number(a.x) - Number(b.x) !== 254000)
    throw new Error("PowerPoint text/move did not persist");
  const edgeChanged = eb.x !== ea.x || eb.y !== ea.y || eb.cx !== ea.cx || eb.cy !== ea.cy;
  if (edgeChanged !== (mode === "glued")) throw new Error("Unexpected connector follow behavior");
  const text = command(["pdftotext", resolve(dir, `japanese.${mode}.before.pdf`), "-"]);
  for (const word of ["入力", "データ", "保管", "結果"])
    if (!text.includes(word)) throw new Error(`Lost native text: ${word}`);
  results.push({
    mode,
    shapeCount: before.shapes.length,
    movePt: 20,
    textEdited: a.text,
    edgeFollowed: edgeChanged,
    fonts: command(["pdffonts", resolve(dir, `japanese.${mode}.before.pdf`)])
      .trim()
      .split("\n")
      .slice(2)
      .map((l) => l.trim().split(/\s+/)[0]),
  });
}
const report = {
  powerpoint: command([
    "osascript",
    "-e",
    'tell application "Microsoft PowerPoint" to get version',
  ]).trim(),
  platform: process.platform,
  arch: process.arch,
  results,
  savedObjects: reports,
};
writeFileSync(resolve(dir, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
if (record)
  writeFileSync("docs/verification/62-powerpoint.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ powerpoint: report.powerpoint, results }));
