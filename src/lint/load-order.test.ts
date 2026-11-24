/**
 * Every lint and render module loads when it is the first one imported (#664). The geometry
 * rules and `lint/config` import each other (a rule's trial lints with every rule), so a rule
 * list built while the modules load read a rule before it was defined, and a test file that
 * imported such a module first failed on its own. Each module is imported in a fresh process.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Glob } from "bun";

const root = join(import.meta.dir, "../..");
const modules = ["src/lint", "src/render"]
  .flatMap((dir) => [...new Glob("**/*.ts").scanSync(join(root, dir))].map((f) => join(dir, f)))
  .filter((f) => !f.endsWith(".test.ts"))
  .sort();

async function loadAlone(path: string): Promise<string | undefined> {
  const proc = Bun.spawn([process.execPath, "-e", `await import(${JSON.stringify(`./${path}`)})`], {
    cwd: root,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return code === 0 ? undefined : (stderr.split("\n").find((l) => /error/i.test(l)) ?? stderr);
}

describe("module load order", () => {
  test("each lint and render module loads first in a fresh process", async () => {
    expect(modules.length).toBeGreaterThan(50);
    const failures: string[] = [];
    const queue = [...modules];
    const worker = async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        const error = await loadAlone(path);
        if (error !== undefined) failures.push(`${path}: ${error}`);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    expect(failures.sort()).toEqual([]);
  });
});
