import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProfile, toD2LayoutArgs } from "../../core/profile";
import type { RenderInput } from "../types";
import {
  buildD2Args,
  createD2CliBackend,
  type D2CliBackendOptions,
  parseD2Stderr,
  sanitizeD2Env,
} from "./backend";
import { createFakeD2, type FakeD2Behavior } from "./fake-d2";

const profile = getProfile("paper-single");
if (profile === undefined) throw new Error("missing built-in profile");
const layout = toD2LayoutArgs(profile);

const fontSet = {
  id: "test-fonts",
  args: ["--font-regular", "/fonts/Regular.ttf", "--font-bold", "/fonts/Bold.ttf"],
};

const SVG = '<?xml version="1.0"?><svg viewBox="0 0 1 1"><svg class="d2-svg"></svg></svg>\n';

let root: string;
let renderTmp: string;
let counter = 0;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "sumi d2 backend "));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  // A fresh parent for the per-render temp dirs, with a space in its path.
  renderTmp = join(root, `render tmp ${counter++}`);
  await mkdir(renderTmp);
});

async function setup(behavior: FakeD2Behavior, options: D2CliBackendOptions = {}) {
  const fake = await createFakeD2(join(root, `fake d2 ${counter++}`), behavior);
  const backend = createD2CliBackend({
    binaryPath: fake.path,
    tmpDir: renderTmp,
    env: { PATH: process.env.PATH, D2_LAYOUT: "dagre", D2_THEME: "200", SCALE: "2", KEEP: "1" },
    ...options,
  });
  return { fake, backend };
}

const input: RenderInput = { d2Source: "a -> b\n", layout };

describe("buildD2Args", () => {
  test("orders layout, profile, font and version flags", () => {
    const result = buildD2Args({ layout, fontSet });
    expect(result).toEqual({
      ok: true,
      value: [
        "--layout",
        "elk",
        ...layout.args,
        "--font-regular",
        "/fonts/Regular.ttf",
        "--font-bold",
        "/fonts/Bold.ttf",
        "--omit-version",
      ],
      diagnostics: [],
    });
  });

  test("rejects flags outside the allowed sets", () => {
    const result = buildD2Args({
      layout: { ...layout, args: ["--layout", "dagre"] },
      fontSet: { id: "x", args: ["--font-regular", "--sketch", "--font-bold"] },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "backend/invalid-args",
      "backend/invalid-args",
    ]);
    expect(result.diagnostics[0]?.message).toContain('"--layout"');
    expect(result.diagnostics[1]?.message).toContain("pairs");
  });

  test("rejects a flag value that looks like a flag", () => {
    const result = buildD2Args({ layout, fontSet: { id: "x", args: ["--font-mono", "-x"] } });
    expect(result.diagnostics[0]?.message).toContain('invalid value "-x"');
  });
});

describe("sanitizeD2Env", () => {
  test("drops variables d2 reads as flag defaults", () => {
    expect(
      sanitizeD2Env({
        PATH: "/bin",
        HOME: "/h",
        D2_LAYOUT: "dagre",
        SCALE: "2",
        OMIT_VERSION: "0",
      }),
    ).toEqual({ PATH: "/bin", HOME: "/h" });
  });
});

describe("parseD2Stderr", () => {
  const inputPath = "/tmp/sumi-d2-x y/input.d2";

  test("keeps line and column of located compile errors", () => {
    const stderr = [
      `err: failed to compile ${inputPath}: ${inputPath}:4:25: expected "stroke-width" to be a number between 0 and 15`,
      `err: ${inputPath}:5:17: "serif" is not a valid font in our system`,
      "",
    ].join("\n");
    expect(parseD2Stderr(stderr, inputPath, "fig.d2")).toEqual([
      {
        code: "backend/d2-failed",
        severity: "error",
        message: 'D2 error in fig.d2:4:25: expected "stroke-width" to be a number between 0 and 15',
        location: { file: "fig.d2", line: 4, column: 25 },
      },
      {
        code: "backend/d2-failed",
        severity: "error",
        message: 'D2 error in fig.d2:5:17: "serif" is not a valid font in our system',
        location: { file: "fig.d2", line: 5, column: 17 },
      },
    ]);
  });

  test("passes through unlocated errors without the usage hint or colours", () => {
    const stderr =
      "\u001b[91merr\u001b[0m: bad usage: failed to load specified fonts: open /nope.ttf: no such file or directory\nerr: Run with --help to see usage.\n";
    expect(parseD2Stderr(stderr, inputPath, "fig.d2")).toEqual([
      {
        code: "backend/d2-failed",
        severity: "error",
        message:
          "D2 failed: bad usage: failed to load specified fonts: open /nope.ttf: no such file or directory",
      },
    ]);
  });
});

describe("createD2CliBackend", () => {
  test("renders via argv with a sanitized environment and returns the artifact", async () => {
    const { fake, backend } = await setup({ svg: SVG });
    const result = await backend.render({ ...input, fontSet });

    expect(result).toEqual({
      ok: true,
      value: {
        svg: SVG,
        d2Source: input.d2Source,
        backend: { name: "d2-cli", version: "0.9.0" },
        args: (buildD2Args({ layout, fontSet }) as { value: string[] }).value,
        layout: layout.effective,
        fontSetId: "test-fonts",
      },
      diagnostics: [],
    });

    const [call] = await fake.calls();
    if (call === undefined) throw new Error("d2 was not called");
    // The artifact's args are exactly the argv minus the temp input/output paths.
    expect(call.args.slice(0, -2)).toEqual(result.ok ? result.value.args : []);
    const [inPath, outPath] = call.args.slice(-2);
    expect(inPath?.startsWith(join(renderTmp, "sumi-d2-"))).toBe(true);
    expect(inPath?.endsWith("input.d2")).toBe(true);
    expect(outPath?.endsWith("output.svg")).toBe(true);
    expect(call.input).toBe(input.d2Source);
    expect(call.env.KEEP).toBe("1");
    expect(call.env.D2_LAYOUT).toBeUndefined();
    expect(call.env.D2_THEME).toBeUndefined();
    expect(call.env.SCALE).toBeUndefined();

    expect(await readdir(renderTmp)).toEqual([]);
  });

  test("omits fontSetId without a font set", async () => {
    const { backend } = await setup({ svg: SVG });
    const result = await backend.render(input);
    expect(result.ok && "fontSetId" in result.value).toBe(false);
  });

  test("maps a compile error to d2-failed with the source location", async () => {
    const { backend } = await setup({
      stderr: "err: failed to compile $IN: $IN:2:3: unexpected text\n",
      exitCode: 1,
    });
    const result = await backend.render({ ...input, sourceName: "figure.d2" });
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "backend/d2-failed",
          severity: "error",
          message: "D2 error in figure.d2:2:3: unexpected text",
          location: { file: "figure.d2", line: 2, column: 3 },
        },
      ],
    });
    expect(await readdir(renderTmp)).toEqual([]);
  });

  test("reports a non-zero exit without stderr", async () => {
    const { backend } = await setup({ exitCode: 3 });
    const result = await backend.render(input);
    expect(result.diagnostics).toEqual([
      { code: "backend/d2-failed", severity: "error", message: "D2 exited with code 3." },
    ]);
  });

  test("maps a timeout to d2-timeout and cleans up", async () => {
    const { backend } = await setup({ svg: SVG, sleepMs: 10_000 }, { timeoutMs: 300 });
    const result = await backend.render(input);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("backend/d2-timeout");
    expect(await readdir(renderTmp)).toEqual([]);
  });

  test.each([
    ["no output file", undefined],
    ["an empty file", ""],
    ["a truncated SVG", "<svg><svg class="],
  ])("maps %s to empty-output", async (_, svg) => {
    const { backend } = await setup(svg === undefined ? {} : { svg });
    const result = await backend.render(input);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("backend/empty-output");
    expect(await readdir(renderTmp)).toEqual([]);
  });

  test("reports a temp dir that cannot be created as io-error instead of rejecting", async () => {
    const { fake, backend } = await setup(
      { svg: SVG },
      { tmpDir: join(root, "does not exist", "nested") },
    );
    const result = await backend.render(input);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "backend/io-error",
        severity: "error",
        message: expect.stringContaining("create a temporary directory"),
      }),
    ]);
    expect(await fake.calls()).toEqual([]);
  });

  test("reports a failed output read as io-error and cleans up", async () => {
    const { backend } = await setup({ outputAsDirectory: true });
    const result = await backend.render(input);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "backend/io-error",
        severity: "error",
        message: expect.stringContaining("read the SVG"),
      }),
    ]);
    expect(await readdir(renderTmp)).toEqual([]);
  });

  test("keeps the timeout diagnostic when cleanup also fails", async () => {
    const { backend } = await setup({ lockWorkDir: true, sleepMs: 10_000 }, { timeoutMs: 300 });
    try {
      const result = await backend.render(input);
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: "backend/d2-timeout", severity: "error" }),
        expect.objectContaining({
          code: "backend/io-error",
          severity: "warning",
          message: expect.stringContaining("remove the temporary directory"),
        }),
      ]);
    } finally {
      for (const name of await readdir(renderTmp)) await chmod(join(renderTmp, name), 0o755);
    }
  });

  test("reports invalid args before running d2", async () => {
    const { fake, backend } = await setup({ svg: SVG });
    const result = await backend.render({ ...input, fontSet: { id: "x", args: ["--theme", "1"] } });
    expect(result.diagnostics[0]?.code).toBe("backend/invalid-args");
    expect(await fake.calls()).toEqual([]);
  });

  test("reports d2-not-found", async () => {
    const backend = createD2CliBackend({
      env: { PATH: "" },
      projectRoot: join(root, "nowhere"),
      tmpDir: renderTmp,
    });
    const result = await backend.render(input);
    expect(result.diagnostics[0]?.code).toBe("backend/d2-not-found");
  });

  test("refuses a mismatched version unless allowed", async () => {
    const strict = await setup({ version: "v0.7.1", svg: SVG });
    const refused = await strict.backend.render(input);
    expect(refused.ok).toBe(false);
    expect(refused.diagnostics[0]).toMatchObject({
      code: "backend/d2-version-mismatch",
      severity: "error",
    });
    expect(await strict.fake.calls()).toEqual([]);

    const lax = await setup({ version: "v0.7.1", svg: SVG }, { allowVersionMismatch: true });
    const rendered = await lax.backend.render(input);
    expect(rendered).toMatchObject({
      ok: true,
      value: { backend: { version: "0.7.1" } },
      diagnostics: [{ code: "backend/d2-version-mismatch", severity: "warning" }],
    });
  });

  test("handles concurrent renders independently", async () => {
    const { fake, backend } = await setup({ svg: SVG, sleepMs: 50 });
    const sources = Array.from({ length: 5 }, (_, i) => `n${i}\n`);
    const results = await Promise.all(
      sources.map((d2Source) => backend.render({ ...input, d2Source })),
    );
    expect(results.map((r) => r.ok && r.value.d2Source)).toEqual(sources);
    const calls = await fake.calls();
    expect(calls.map((c) => c.input).sort()).toEqual(sources);
    expect(new Set(calls.map((c) => c.args.at(-2))).size).toBe(sources.length);
    expect(await readdir(renderTmp)).toEqual([]);
  });
});
