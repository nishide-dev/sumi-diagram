/**
 * Test helper: writes a fake `d2` executable (a Bun script) whose behaviour is
 * fixed at creation time, and which records each render invocation.
 */

import { chmod, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface FakeD2Behavior {
  /** Printed by `--version`. Defaults to `v0.9.0`. */
  version?: string;
  /** Exit code of `--version`. Defaults to 0. */
  versionExitCode?: number;
  /** Written to the output path. Omitted: nothing is written. */
  svg?: string;
  /** Written to stderr; `$IN` is replaced with the input path. */
  stderr?: string;
  exitCode?: number;
  /** Sleep before doing anything else. */
  sleepMs?: number;
  /** On SIGTERM, exit successfully after this delay without writing output, like D2. */
  shutdownDelayMs?: number;
  /** Create a directory at the output path, so reading the SVG fails. */
  outputAsDirectory?: boolean;
  /** Leave a file in the render's temp dir and make that dir read-only, so cleanup fails. */
  lockWorkDir?: boolean;
}

export interface RecordedCall {
  args: string[];
  env: Record<string, string>;
  input: string;
}

export interface FakeD2 {
  path: string;
  /** Written only after the SIGTERM handler completes its graceful path. */
  shutdownFile: string;
  /** Render invocations so far, in order. */
  calls(): Promise<RecordedCall[]>;
}

/** Creates `<dir>/d2` (plus its call log) behaving as described. */
export async function createFakeD2(dir: string, behavior: FakeD2Behavior = {}): Promise<FakeD2> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, "d2");
  const log = join(dir, "calls.jsonl");
  const shutdownFile = join(dir, "shutdown");
  const config = JSON.stringify({ version: "v0.9.0", ...behavior, log, shutdownFile });
  await Bun.write(
    path,
    `#!${process.execPath}
const fs = require("node:fs");
const cfg = ${config};
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write(cfg.version + "\\n");
  process.exit(cfg.versionExitCode ?? 0);
}
const [input, output] = args.slice(-2);
if (cfg.shutdownDelayMs !== undefined) {
  process.on("SIGTERM", () => {
    setTimeout(() => {
      process.stderr.write("graceful shutdown\\n");
      fs.writeFileSync(cfg.shutdownFile, "shutdown complete");
      process.exit(0);
    }, cfg.shutdownDelayMs);
  });
}
fs.appendFileSync(cfg.log, JSON.stringify({ args, env: process.env, input: fs.readFileSync(input, "utf8") }) + "\\n");
if (cfg.outputAsDirectory) fs.mkdirSync(output);
if (cfg.lockWorkDir) {
  const dir = require("node:path").dirname(input);
  fs.writeFileSync(dir + "/leftover", "");
  fs.chmodSync(dir, 0o555);
}
setTimeout(() => {
  if (cfg.stderr !== undefined) process.stderr.write(cfg.stderr.replaceAll("$IN", input));
  if (cfg.svg !== undefined) fs.writeFileSync(output, cfg.svg);
  process.exit(cfg.exitCode ?? 0);
}, cfg.sleepMs ?? 0);
`,
  );
  await chmod(path, 0o755);
  return {
    path,
    shutdownFile,
    async calls() {
      const text = await readFile(log, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as RecordedCall);
    },
  };
}
