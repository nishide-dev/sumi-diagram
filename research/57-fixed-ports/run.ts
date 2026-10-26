/** #57: bun research/57-fixed-ports/run.ts [--record]. D2 + isolated elkjs + compiled smoke. */
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createD2CliBackend } from "../../src/backends/d2/backend";
import { compileFigure, expectD2Figure } from "../../src/compiler/compile";
import { type CommandArgv, runCommand } from "../../src/core/subprocess";
import { childElements, classList, descendants, parseXml } from "../../src/render/xml";
import { elkFromText } from "./load-elk";
import { probe } from "./probe";
import { BUNDLE, ELK_INTEGRITY, ELK_VERSION, PACKAGE, setup } from "./setup";

const OUT = join(import.meta.dir, "out");
async function command(argv: CommandArgv, cwd = import.meta.dir, env = process.env) {
  const r = await runCommand(argv, { cwd, env, timeoutMs: 120_000 });
  if (r.exitCode !== 0) throw new Error(`${argv[0]} failed: ${r.stdout}${r.stderr}`);
  return r.stdout.trim();
}

const d2Probes = {
  control: "a: {label: A; width: 120; height: 80}\nb: {label: B; width: 120; height: 80}\na -> b\n",
  "port-keys": "a: {label: A; ports: {out: {x: 120; y: 20}}}\nb: B\na.ports.out -> b\n",
  "elk-options-as-keys": "a: {label: A; elk.portConstraints: FIXED_POS}\nb: B\na -> b\n",
  "edge-port-keys": "a: A\nb: B\na -> b: {source-port: out; target-port: in}\n",
  "sql-column-control":
    "a: {shape: sql_table; id: int; value: text}\nb: {shape: sql_table; id: int; value: text}\na.id -> b.value\n",
};

async function main() {
  if (Bun.argv.slice(2).some((a) => a !== "--record"))
    throw new Error("Usage: bun research/57-fixed-ports/run.ts [--record]");
  await mkdir(OUT, { recursive: true });
  await rm(join(OUT, "report.json"), { force: true });
  await setup();
  const baseline = compileFigure(
    "version: 1\nfigure: { id: ports }\nnodes: [{ id: a, component: box }]\n",
  );
  if (!baseline.ok) throw new Error(JSON.stringify(baseline.diagnostics));
  const backend = createD2CliBackend();
  const d2 = [];
  for (const [name, text] of Object.entries(d2Probes)) {
    await writeFile(join(OUT, `${name}.d2`), text);
    const result = await backend.render({
      d2Source: text,
      layout: expectD2Figure(baseline.value).layout,
      fontSet: baseline.value.fontSet,
    });
    const nodes: string[] = [];
    if (result.ok) {
      if (result.value.backend.version !== "0.9.0") throw new Error("unexpected D2 version");
      await writeFile(join(OUT, `${name}.svg`), result.value.svg);
      const xml = parseXml(result.value.svg);
      if (!xml.ok) throw new Error(xml.message);
      for (const element of descendants(xml.root)) {
        if (
          element.name !== "g" ||
          !childElements(element).some((child) => classList(child).includes("shape"))
        )
          continue;
        const encoded = classList(element)[0] ?? "";
        const decoded = Buffer.from(encoded, "base64").toString("utf8");
        if (Buffer.from(decoded).toString("base64") === encoded) nodes.push(decoded);
      }
    }
    d2.push({ name, success: result.ok, nodes, diagnostics: result.diagnostics });
  }
  const schema = [
    "version: 1\nfigure: { id: port-schema }\nnodes:\n  - { id: a, component: box, ports: [{ id: out }] }\n",
    "version: 1\nfigure: { id: edge-schema }\nnodes: [{ id: a, component: box }, { id: b, component: box }]\nedges: [{ from: a, to: b, fromPort: out, toPort: in }]\n",
  ].map((text) => ({ source: text, diagnostics: compileFigure(text).diagnostics }));
  const ordinaryEntry = join(OUT, "ordinary-import.js");
  await writeFile(
    ordinaryEntry,
    `import ELK from ${JSON.stringify(BUNDLE)};\ntry { new ELK(); console.log(JSON.stringify({ success: true })); } catch(error) { console.log(JSON.stringify({success:false, error: error.name, message:error.message})); }\nprocess.exit(0);\n`,
  );
  const ordinary = JSON.parse(await command([process.execPath, ordinaryEntry]));
  const source = await readFile(BUNDLE, "utf8");
  const ELK = elkFromText(source);
  const layouts = await probe(ELK);

  // Statically embed the unmodified JS as text. Shadow self lexically in the
  // adapter; no worker script lookup or .tools access is needed at runtime.
  const compiledEntry = join(OUT, "compiled-entry.js");
  const controlEntry = join(OUT, "control-entry.js");
  await writeFile(
    compiledEntry,
    `import source from ${JSON.stringify(BUNDLE)} with { type: "text" };\nimport {elkFromText} from ${JSON.stringify(join(import.meta.dir, "load-elk.ts"))};\nimport {probe} from ${JSON.stringify(join(import.meta.dir, "probe.ts"))};\nconsole.log(JSON.stringify(await probe(elkFromText(source))));\n`,
  );
  await writeFile(controlEntry, 'console.log("control");\n');
  const executable = join(OUT, "elk-compiled");
  const control = join(OUT, "control-compiled");
  for (const [entry, output] of [
    [compiledEntry, executable],
    [controlEntry, control],
  ]) {
    if (!entry || !output) throw new Error("missing build path");
    await command([process.execPath, "build", "--compile", "--minify", entry, "--outfile", output]);
  }
  const isolated = join(OUT, "isolated");
  const emptyPath = join(isolated, "empty-bin");
  await mkdir(emptyPath, { recursive: true });
  const env = { PATH: emptyPath, HOME: isolated, LANG: "C" };
  if (Bun.which("bun", { PATH: emptyPath }) || Bun.which("node", { PATH: emptyPath }))
    throw new Error("restricted PATH contains runtimes");
  const hidden = `${PACKAGE}-hidden`;
  let compiled: typeof layouts;
  await rename(PACKAGE, hidden);
  try {
    compiled = JSON.parse(await command([executable], isolated, env));
    const again = JSON.parse(await command([executable], isolated, env));
    if (
      JSON.stringify(compiled) !== JSON.stringify(layouts) ||
      JSON.stringify(again) !== JSON.stringify(layouts)
    )
      throw new Error("compiled geometry differs from source or is not repeatable");
  } finally {
    await rename(hidden, PACKAGE);
  }
  const pkg = JSON.parse(await readFile(join(PACKAGE, "package.json"), "utf8"));
  const report = {
    baselineCommit: "17c2352",
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
    d2Version: "0.9.0",
    latestD2ReleaseAtResearch: "v0.9.0",
    inspectedD2Head: "6a7b4837838a3907604a1d9eec57ee98b6f3cd01",
    d2,
    schema,
    elkjs: {
      version: ELK_VERSION,
      integrity: `sha512-${ELK_INTEGRITY}`,
      license: pkg.license,
      runtimeDependencies: pkg.dependencies ?? {},
      bundleBytes: (await stat(BUNDLE)).size,
      bundleSha256: new Bun.CryptoHasher("sha256").update(source).digest("hex"),
      ordinaryImport: ordinary,
      layouts,
    },
    compiled: {
      standalone: true,
      vendorHidden: true,
      bunAndNodeAbsentFromPath: true,
      repeatedExecutions: 2,
      sourceGeometryMatches: true,
      controlBytes: (await stat(control)).size,
      elkBytes: (await stat(executable)).size,
      deltaBytes: (await stat(executable)).size - (await stat(control)).size,
    },
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(join(OUT, "report.json"), json);
  if (Bun.argv.includes("--record")) {
    await mkdir(join(import.meta.dir, "results"), { recursive: true });
    await writeFile(join(import.meta.dir, "results", "report.json"), json);
  }
  console.log(
    JSON.stringify(
      {
        d2,
        schema,
        ordinaryImport: ordinary,
        elk: layouts.map(({ routes, portPositions, ...result }) => result),
        compiled: report.compiled,
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
