/**
 * Locating the `d2` executable and checking it is the pinned version.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Diagnostic } from "../../core/diagnostics";
import { bundledD2Path, RELEASE_LAYOUT, RUN_MODE } from "../../core/install-layout";
import type { Result } from "../../core/result";
import { runCommand } from "../../core/subprocess";
import { D2_VERSION, MANAGED_D2_PATH } from "./version";

/** Where a `d2` binary was found, in discovery order. */
export type D2BinarySource = "option" | "env" | "bundled" | "managed" | "path";

export interface D2Binary {
  path: string;
  source: D2BinarySource;
}

export interface FindD2BinaryOptions {
  /** Explicit path to `d2`. Takes precedence over everything else. */
  binaryPath?: string;
  /** Environment to read `SUMI_D2_PATH` and `PATH` from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /**
   * The `d2` shipped next to a compiled `sumi` (`<prefix>/libexec/sumi/d2`).
   * Defaults to {@link bundledD2Path}, which is `undefined` when running from
   * source; `null` disables this step.
   */
  bundledPath?: string | null;
  /** Directory containing the managed `.sumi/bin/d2`. Defaults to the current directory. */
  projectRoot?: string;
}

export const D2_PATH_ENV = "SUMI_D2_PATH";

/** How to get the pinned D2: reinstall the release when compiled, `bun run d2:install` from source. */
export const D2_INSTALL_HINT =
  RUN_MODE === "compiled"
    ? `Reinstall the Sumi release tarball (it ships D2 v${D2_VERSION} as ${RELEASE_LAYOUT.d2}), or set ${D2_PATH_ENV} to the path of a d2 v${D2_VERSION} binary.`
    : `Install D2 v${D2_VERSION} with \`bun run d2:install\`, or set ${D2_PATH_ENV} to the path of a d2 v${D2_VERSION} binary.`;

function notFound<T>(message: string): Result<T> {
  return {
    ok: false,
    diagnostics: [
      { code: "backend/d2-not-found", severity: "error", message, hint: D2_INSTALL_HINT },
    ],
  };
}

/**
 * Finds `d2`: explicit option → `$SUMI_D2_PATH` → the `d2` shipped next to a
 * compiled `sumi` (`<prefix>/libexec/sumi/d2`) → the project's managed
 * `.sumi/bin/d2` → `d2` on `PATH`. An explicitly configured path that does not
 * exist is an error rather than falling through to the next source; a missing
 * bundled or managed binary just falls through.
 */
export function findD2Binary(options: FindD2BinaryOptions = {}): Result<D2Binary> {
  const env = options.env ?? process.env;
  const explicit: [D2BinarySource, string | undefined, string][] = [
    ["option", options.binaryPath, "The configured d2 path"],
    ["env", env[D2_PATH_ENV] || undefined, `${D2_PATH_ENV}`],
  ];
  for (const [source, path, label] of explicit) {
    if (path === undefined) continue;
    const absolute = resolve(path);
    if (!existsSync(absolute)) return notFound(`${label} "${path}" does not exist.`);
    return { ok: true, value: { path: absolute, source }, diagnostics: [] };
  }

  const bundled =
    options.bundledPath === undefined ? bundledD2Path() : (options.bundledPath ?? undefined);
  if (bundled !== undefined && existsSync(bundled)) {
    return { ok: true, value: { path: resolve(bundled), source: "bundled" }, diagnostics: [] };
  }

  const managed = resolve(options.projectRoot ?? process.cwd(), MANAGED_D2_PATH);
  if (existsSync(managed)) {
    return { ok: true, value: { path: managed, source: "managed" }, diagnostics: [] };
  }

  const onPath = Bun.which("d2", { PATH: env.PATH ?? "" });
  if (onPath !== null)
    return { ok: true, value: { path: onPath, source: "path" }, diagnostics: [] };

  return notFound("The d2 executable was not found.");
}

/**
 * Parses the output of `d2 --version` (e.g. `v0.9.0`) into a bare version
 * (`0.9.0`, keeping any pre-release suffix), or `undefined` if unrecognised.
 */
export function parseD2Version(output: string): string | undefined {
  const match = /^\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/.exec(output);
  return match?.[1];
}

export interface CheckD2VersionOptions {
  /** Accept a version other than {@link D2_VERSION}, reporting a warning instead of an error. */
  allowVersionMismatch?: boolean;
  /** Timeout for `d2 --version`. */
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

/** Runs `d2 --version` and checks it reports exactly {@link D2_VERSION}. */
export async function checkD2Version(
  binary: string,
  options: CheckD2VersionOptions = {},
): Promise<Result<string>> {
  let output: string;
  try {
    const result = await runCommand([binary, "--version"], {
      timeoutMs: options.timeoutMs ?? 10_000,
      ...(options.env !== undefined && { env: options.env }),
    });
    if (result.exitCode !== 0) {
      const reason = result.timedOut
        ? "timed out"
        : `exited with ${result.exitCode ?? result.signal}: ${result.stderr.trim()}`;
      return notFound(`"${binary} --version" ${reason}`.trim());
    }
    output = result.stdout;
  } catch (error) {
    return notFound(
      `"${binary}" could not be executed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const version = parseD2Version(output);
  if (version === D2_VERSION) return { ok: true, value: version, diagnostics: [] };

  const found =
    version === undefined
      ? `an unrecognised version string ${JSON.stringify(output.trim())}`
      : `v${version}`;
  const diagnostic: Diagnostic = {
    code: "backend/d2-version-mismatch",
    severity: options.allowVersionMismatch ? "warning" : "error",
    message: `"${binary}" reports ${found}, but Sumi requires D2 v${D2_VERSION}; output may differ from the pinned version.`,
    hint: D2_INSTALL_HINT,
  };
  return options.allowVersionMismatch
    ? { ok: true, value: version ?? output.trim(), diagnostics: [diagnostic] }
    : { ok: false, diagnostics: [diagnostic] };
}
