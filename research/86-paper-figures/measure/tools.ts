/** Shared helpers: strict subprocesses, locked research installs, tool versions. */
import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type CommandArgv, type RunCommandResult, runCommand } from "../../../src/core/subprocess";

const LOCKS = join(import.meta.dir, "..", "locks");

/** Runs a command and throws unless it exits 0 (a failed tool must never read as "0 images"). */
export async function mustRun(
  argv: CommandArgv,
  options: { cwd?: string } = {},
): Promise<RunCommandResult> {
  const r = await runCommand(argv, options);
  if (r.exitCode !== 0)
    throw new Error(`${argv.join(" ")} exited ${r.exitCode}: ${r.stderr.trim().slice(-400)}`);
  return r;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * `bun install` in a gitignored research project with a committed lockfile
 * (locks/<name>.bun.lock): frozen when the lock exists; the first run writes it.
 */
export async function installLocked(dir: string, name: string): Promise<"frozen" | "created"> {
  await mkdir(LOCKS, { recursive: true });
  const committed = join(LOCKS, `${name}.bun.lock`);
  if (await exists(committed)) {
    await copyFile(committed, join(dir, "bun.lock"));
    await mustRun(["bun", "install", "--ignore-scripts", "--frozen-lockfile"], { cwd: dir });
    return "frozen";
  }
  await mustRun(["bun", "install", "--ignore-scripts"], { cwd: dir });
  await copyFile(join(dir, "bun.lock"), committed);
  return "created";
}

/** Rows of `pdfimages -list` (header and rule excluded); throws on unexpected output. */
export function countPdfImages(stdout: string): number {
  const lines = stdout.trim().split("\n");
  if (!/^page\s+num\s+type/.test(lines[0] ?? "") || !/^-+/.test(lines[1] ?? ""))
    throw new Error(`unexpected pdfimages output: ${stdout.slice(0, 120)}`);
  return lines.length - 2;
}

/** Versions of the external tools the measurements use. */
export async function toolVersions(): Promise<Record<string, string>> {
  const first = async (argv: CommandArgv) => {
    const r = await runCommand(argv);
    return `${r.stdout}${r.stderr}`.trim().split("\n")[0] ?? "";
  };
  return {
    magick: await first(["magick", "-version"]),
    pdfimages: await first(["pdfimages", "-v"]),
    pdffonts: await first(["pdffonts", "-v"]),
    pdftotext: await first(["pdftotext", "-v"]),
    tar: await first(["tar", "--version"]),
  };
}
