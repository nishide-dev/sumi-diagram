/**
 * D2 CLI backend (#9): renders D2 source to SVG with the pinned `d2` binary
 * and the ELK layout engine.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Diagnostic } from "../../core/diagnostics";
import type { Result } from "../../core/result";
import { runCommand } from "../../core/subprocess";
import type { DiagramBackend, RenderArtifact, RenderInput } from "../types";
import { checkD2Version, type FindD2BinaryOptions, findD2Binary } from "./binary";

export interface D2CliBackendOptions extends FindD2BinaryOptions {
  /** Accept a `d2` other than the pinned version (reported as a warning). For experiments only. */
  allowVersionMismatch?: boolean;
  /** Timeout for one render, in milliseconds. Defaults to {@link DEFAULT_D2_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Parent directory for per-render temporary directories. Defaults to the OS temp dir. */
  tmpDir?: string;
}

export const DEFAULT_D2_TIMEOUT_MS = 60_000;

const DEFAULT_SOURCE_NAME = "generated.d2";

/** The only flags accepted from profile-derived layout arguments. */
const LAYOUT_FLAGS = new Set([
  "--pad",
  "--elk-algorithm",
  "--elk-nodeNodeBetweenLayers",
  "--elk-padding",
  "--elk-edgeNodeBetweenLayers",
  "--elk-nodeSelfLoop",
]);

/** The only flags accepted from a font set. */
const FONT_FLAGS = new Set([
  "--font-regular",
  "--font-italic",
  "--font-bold",
  "--font-semibold",
  "--font-mono",
  "--font-mono-bold",
  "--font-mono-italic",
  "--font-mono-semibold",
]);

/**
 * Environment variables `d2` reads as defaults for its flags (`D2_*` plus a
 * few unprefixed ones). They are removed so the caller's environment cannot
 * change the output.
 */
const D2_UNPREFIXED_ENV = new Set([
  "OMIT_VERSION",
  "SCALE",
  "DEBUG",
  "HOST",
  "PORT",
  "BROWSER",
  "IMG_CACHE",
]);

/** Returns a copy of `env` without the variables `d2` reads as flag defaults. */
export function sanitizeD2Env(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith("D2_") && !D2_UNPREFIXED_ENV.has(key)),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A failed file-system operation around the D2 invocation (temp dir, input, output, cleanup). */
function ioError(severity: "error" | "warning", action: string, error: unknown): Diagnostic {
  return {
    code: "backend/io-error",
    severity,
    message: `Could not ${action}: ${errorMessage(error)}`,
  };
}

function invalidArgs(message: string): Diagnostic {
  return { code: "backend/invalid-args", severity: "error", message };
}

/** Checks `args` is a sequence of `<allowed flag> <value>` pairs. */
function checkFlagPairs(args: readonly string[], allowed: Set<string>, what: string): Diagnostic[] {
  if (args.length % 2 !== 0) {
    return [invalidArgs(`${what} must be flag/value pairs, got ${args.length} arguments.`)];
  }
  const diagnostics: Diagnostic[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i] ?? "";
    const value = args[i + 1] ?? "";
    if (!allowed.has(flag)) {
      diagnostics.push(invalidArgs(`${what} contain unsupported flag "${flag}".`));
    } else if (value === "" || value.startsWith("-")) {
      diagnostics.push(invalidArgs(`${what} give "${flag}" an invalid value "${value}".`));
    }
  }
  return diagnostics;
}

/**
 * Builds the `d2` arguments (excluding the input/output paths):
 * `--layout elk <layout flags> <font flags> --omit-version`.
 */
export function buildD2Args(input: Pick<RenderInput, "layout" | "fontSet">): Result<string[]> {
  const fontArgs = input.fontSet?.args ?? [];
  const diagnostics = [
    ...checkFlagPairs(input.layout.args, LAYOUT_FLAGS, "Layout arguments"),
    ...checkFlagPairs(fontArgs, FONT_FLAGS, "Font arguments"),
  ];
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    value: ["--layout", "elk", ...input.layout.args, ...fontArgs, "--omit-version"],
    diagnostics: [],
  };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matches ANSI escape sequences
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

/**
 * Converts `d2` stderr into diagnostics. Errors located in the D2 source
 * (`<inputPath>:<line>:<col>: <message>`) keep their position, relative to the
 * generated source named `sourceName`.
 */
export function parseD2Stderr(stderr: string, inputPath: string, sourceName: string): Diagnostic[] {
  const lines = stderr
    .replace(ANSI_ESCAPE, "")
    .split("\n")
    .map((line) => line.trim().replace(/^err:\s*/, ""))
    .filter((line) => line !== "" && line !== "Run with --help to see usage.");

  const diagnostics: Diagnostic[] = [];
  for (const line of lines) {
    // `failed to compile <path>: <path>:<line>:<col>: <message>` → keep the located part.
    const at = line.lastIndexOf(`${inputPath}:`);
    const located =
      at === -1 ? undefined : /^(\d+):(\d+):\s*(.*)$/.exec(line.slice(at + inputPath.length + 1));
    if (located !== undefined && located !== null) {
      const [, row, column, message] = located;
      diagnostics.push({
        code: "backend/d2-failed",
        severity: "error",
        message: `D2 error in ${sourceName}:${row}:${column}: ${message}`,
        location: { file: sourceName, line: Number(row), column: Number(column) },
      });
    } else {
      diagnostics.push({
        code: "backend/d2-failed",
        severity: "error",
        message: `D2 failed: ${line.replaceAll(inputPath, sourceName)}`,
      });
    }
  }
  return diagnostics;
}

/** Creates a backend that renders with the D2 CLI. Instances hold no shared mutable state across renders. */
export function createD2CliBackend(options: D2CliBackendOptions = {}): DiagramBackend {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? DEFAULT_D2_TIMEOUT_MS;
  const childEnv = sanitizeD2Env(env);

  // Binary discovery and the version check run once per backend; a failure is retried next time.
  let ready: Promise<Result<{ path: string; version: string }>> | undefined;
  const prepare = (): Promise<Result<{ path: string; version: string }>> => {
    ready ??= (async () => {
      const binary = findD2Binary({ ...options, env });
      if (!binary.ok) return binary;
      const version = await checkD2Version(binary.value.path, {
        env: childEnv,
        ...(options.allowVersionMismatch !== undefined && {
          allowVersionMismatch: options.allowVersionMismatch,
        }),
      });
      if (!version.ok) return version;
      return {
        ok: true,
        value: { path: binary.value.path, version: version.value },
        diagnostics: version.diagnostics,
      };
    })();
    const current = ready;
    current.then((result) => {
      if (!result.ok && ready === current) ready = undefined;
    });
    return current;
  };

  /** Runs one render inside `dir`. The caller owns `dir` and its cleanup. */
  const renderIn = async (
    dir: string,
    input: RenderInput,
    args: string[],
    binary: { path: string; version: string },
    sourceName: string,
  ): Promise<Result<RenderArtifact>> => {
    const fail = (diagnostic: Diagnostic): Result<RenderArtifact> => ({
      ok: false,
      diagnostics: [diagnostic],
    });
    const inputPath = join(dir, "input.d2");
    const outputPath = join(dir, "output.svg");
    try {
      await Bun.write(inputPath, input.d2Source);
    } catch (error) {
      return fail(ioError("error", "write the D2 source", error));
    }

    let result: Awaited<ReturnType<typeof runCommand>>;
    try {
      result = await runCommand([binary.path, ...args, inputPath, outputPath], {
        env: childEnv,
        timeoutMs,
      });
    } catch (error) {
      return fail({
        code: "backend/d2-failed",
        severity: "error",
        message: `Could not run "${binary.path}": ${errorMessage(error)}`,
      });
    }

    if (result.timedOut) {
      return fail({
        code: "backend/d2-timeout",
        severity: "error",
        message: `D2 did not finish within ${timeoutMs} ms.`,
        hint: "Simplify the figure or raise the backend timeout.",
      });
    }
    if (result.exitCode !== 0) {
      const parsed = parseD2Stderr(result.stderr, inputPath, sourceName);
      if (parsed.length > 0) return { ok: false, diagnostics: parsed };
      const status =
        result.exitCode === null
          ? `was terminated by ${result.signal}`
          : `exited with code ${result.exitCode}`;
      return fail({ code: "backend/d2-failed", severity: "error", message: `D2 ${status}.` });
    }

    let svg: string;
    try {
      svg = await readFile(outputPath, "utf8");
    } catch (error) {
      // A missing file is D2 producing nothing, not an I/O failure.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") svg = "";
      else return fail(ioError("error", "read the SVG written by D2", error));
    }
    if (!/<svg[\s>]/.test(svg) || !svg.trimEnd().endsWith("</svg>")) {
      return fail({
        code: "backend/empty-output",
        severity: "error",
        message:
          svg.trim() === ""
            ? "D2 exited successfully but produced no SVG."
            : "D2 exited successfully but its output is not a complete SVG document.",
      });
    }

    return {
      ok: true,
      value: {
        svg,
        d2Source: input.d2Source,
        backend: { name: "d2-cli", version: binary.version },
        args,
        layout: input.layout.effective,
        ...(input.fontSet !== undefined && { fontSetId: input.fontSet.id }),
      },
      diagnostics: [],
    };
  };

  return {
    name: "d2-cli",
    async render(input: RenderInput): Promise<Result<RenderArtifact>> {
      const args = buildD2Args(input);
      if (!args.ok) return args;
      const binary = await prepare();
      if (!binary.ok) return binary;
      const diagnostics = [...binary.diagnostics];
      const sourceName = input.sourceName ?? DEFAULT_SOURCE_NAME;
      const fail = (more: Diagnostic[]): Result<RenderArtifact> => ({
        ok: false,
        diagnostics: [...diagnostics, ...more],
      });

      // Every file operation is caught: render() reports failures as diagnostics and never rejects.
      let dir: string;
      try {
        dir = await mkdtemp(join(options.tmpDir ?? tmpdir(), "sumi-d2-"));
      } catch (error) {
        return fail([ioError("error", "create a temporary directory", error)]);
      }

      let result: Result<RenderArtifact>;
      try {
        result = await renderIn(dir, input, args.value, binary.value, sourceName);
      } catch (error) {
        result = { ok: false, diagnostics: [ioError("error", "access the render files", error)] };
      }
      result = { ...result, diagnostics: [...diagnostics, ...result.diagnostics] };

      try {
        await rm(dir, { recursive: true, force: true });
      } catch (error) {
        // Keep the render's own outcome; only report the leftover directory.
        result.diagnostics.push(
          ioError("warning", `remove the temporary directory "${dir}"`, error),
        );
      }
      return result;
    },
  };
}
