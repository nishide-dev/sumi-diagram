import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import pkg from "../../package.json";
import { runCommand } from "../core/subprocess";

const entry = join(import.meta.dir, "index.ts");

function runCli(...args: string[]) {
  return runCommand([process.execPath, entry, ...args], { timeoutMs: 10_000 });
}

describe("sumi CLI", () => {
  test("--version prints the package version", async () => {
    const result = await runCli("--version");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  test("--help prints usage", async () => {
    const result = await runCli("--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: sumi");
    expect(result.stdout).toContain("--version");
    expect(result.stdout).toContain("--help");
  });

  test("unknown option fails with a non-zero exit code", async () => {
    const result = await runCli("--no-such-option");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown option");
  });
});
