import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./subprocess";
import { withReadyTimeout } from "./subprocess-test-helpers";

const bun = process.execPath;

describe("runCommand", () => {
  test("captures stdout, stderr and exit code", async () => {
    const result = await runCommand([
      bun,
      "-e",
      "console.log('out'); console.error('err'); process.exit(3)",
    ]);
    expect(result).toEqual({
      exitCode: 3,
      signal: null,
      stdout: "out\n",
      stderr: "err\n",
      timedOut: false,
    });
  });

  test("passes arguments verbatim without shell interpretation", async () => {
    const tricky = "$HOME; echo injected | `whoami` && *";
    const result = await runCommand([
      bun,
      "-e",
      "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
      tricky,
      "two words",
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([tricky, "two words"]);
  });

  test("respects cwd and env", async () => {
    const result = await runCommand(
      [bun, "-e", "process.stdout.write(process.cwd() + '|' + process.env.SUMI_TEST_VAR)"],
      { cwd: import.meta.dir, env: { ...process.env, SUMI_TEST_VAR: "ok" } },
    );
    expect(result.stdout).toBe(`${import.meta.dir}|ok`);
  });

  test("kills the process when the timeout elapses", async () => {
    const started = performance.now();
    const result = await runCommand([bun, "-e", "setTimeout(() => {}, 10_000)"], {
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe("SIGTERM");
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  test("escalates to SIGKILL when the process ignores SIGTERM", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sumi-subprocess-test-"));
    const pidFile = join(dir, "pid");
    const killChild = async () => {
      const pid = Number(await readFile(pidFile, "utf8").catch(() => ""));
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already exited.
        }
      }
    };
    // Independent watchdog: if escalation is broken, runCommand never resolves,
    // so kill the child ourselves and fail before Bun's test timeout fires.
    let watchdog: Timer | undefined;
    const watchdogFired = new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => {
        void killChild().finally(() =>
          reject(new Error("runCommand did not return within the watchdog period")),
        );
      }, 4_000);
    });
    try {
      const result = await Promise.race([
        runCommand(
          [
            bun,
            "-e",
            `process.on("SIGTERM", () => {});
             require("node:fs").writeFileSync(process.argv[1], String(process.pid));
             setInterval(() => {}, 1_000);`,
            pidFile,
          ],
          { timeoutMs: 1_000, killGraceMs: 200 },
        ),
        watchdogFired,
      ]);
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBeNull();
      expect(result.signal).toBe("SIGKILL");
    } finally {
      clearTimeout(watchdog);
      // Make sure the child does not outlive the test, even if assertions failed.
      await killChild();
      await rm(dir, { recursive: true, force: true });
    }
  }, 10_000);

  test("waits for graceful shutdown even when SIGTERM exits successfully", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sumi-subprocess-shutdown-"));
    const marker = join(dir, "exited");
    const ready = join(dir, "ready");
    try {
      const result = await withReadyTimeout(
        500,
        () => Bun.file(ready).exists(),
        () =>
          runCommand(
            [
              bun,
              "-e",
              `process.on("SIGTERM", () => {
            setTimeout(() => {
              require("node:fs").writeFileSync(process.argv[1], "shutdown complete");
              process.exit(0);
            }, 100);
          });
          require("node:fs").writeFileSync(process.argv[2], "ready");
          setInterval(() => {}, 1_000);`,
              marker,
              ready,
            ],
            { timeoutMs: 500 },
          ),
      );
      expect(result).toMatchObject({ timedOut: true, exitCode: 0, signal: null });
      // Callers may safely remove the working directory only after this returns.
      expect(await readFile(marker, "utf8")).toBe("shutdown complete");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects an invalid timeout or kill grace period", async () => {
    await expect(runCommand([bun, "--version"], { timeoutMs: 0 })).rejects.toThrow(RangeError);
    await expect(runCommand([bun, "--version"], { killGraceMs: -1 })).rejects.toThrow(RangeError);
  });

  test("throws when the executable does not exist", async () => {
    await expect(runCommand(["sumi-nonexistent-command-for-test"])).rejects.toThrow();
  });
});
