/**
 * `sumi doctor`: reports whether the environment can render. stdout: the
 * report (text, or JSON with `--json`). Exit 1 if a required check fails.
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import {
  checkD2Version,
  D2_INSTALL_HINT,
  D2_PATH_ENV,
  findD2Binary,
} from "../../backends/d2/binary";
import { D2_VERSION, d2ReleaseAsset } from "../../backends/d2/version";
import { SUMI_VERSION } from "../../core/figure/validate";
import { RUN_MODE, type RunMode } from "../../core/install-layout";
import { BUILTIN_FONT_SETS, BUNDLED_FONT_SHA256, FONT_ASSETS_DIR } from "../../core/theme/fonts";
import { loadFontMetrics } from "../../lint/metrics";
import { type CliContext, EXIT, type ExitCode } from "../io";

export const DOCTOR_JSON_VERSION = 1;

export type DoctorStatus = "ok" | "warning" | "error" | "skipped";

export interface DoctorCheck {
  id: "d2" | "fonts" | "geometry-lint";
  status: DoctorStatus;
  /** A failed required check makes `sumi doctor` exit 1. */
  required: boolean;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  version: typeof DOCTOR_JSON_VERSION;
  sumi: { version: string };
  /** `mode`: `source` (run with Bun from a checkout) or `compiled` (release binary). */
  runtime: { bun: string; platform: string; arch: string; mode: RunMode };
  checks: DoctorCheck[];
  /** No required check failed. */
  ok: boolean;
}

export async function doctorCommand(
  options: { json?: boolean; color: boolean },
  context: CliContext,
): Promise<ExitCode> {
  const report = await buildDoctorReport(context);
  context.stdout.write(
    options.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatDoctorText(report, { color: options.color }),
  );
  return report.ok ? EXIT.ok : EXIT.failed;
}

export async function buildDoctorReport(context: CliContext): Promise<DoctorReport> {
  const checks = [await checkD2(context), await checkFonts(), geometryLintCheck()];
  return {
    version: DOCTOR_JSON_VERSION,
    sumi: { version: SUMI_VERSION },
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch, mode: RUN_MODE },
    checks,
    ok: checks.every((c) => !(c.required && c.status === "error")),
  };
}

async function checkD2(context: CliContext): Promise<DoctorCheck> {
  const install =
    d2ReleaseAsset() === undefined
      ? `D2 publishes no v${D2_VERSION} binary for ${process.platform}-${process.arch}; build it from source and set ${D2_PATH_ENV}.`
      : D2_INSTALL_HINT;
  const base = { id: "d2", required: true } as const;
  const found = findD2Binary({ projectRoot: context.cwd, env: context.env });
  if (!found.ok) {
    return {
      ...base,
      status: "error",
      message: found.diagnostics[0]?.message ?? "The d2 executable was not found.",
      hint: install,
      details: { pinnedVersion: D2_VERSION },
    };
  }
  const { path, source } = found.value;
  const version = await checkD2Version(path, { env: context.env, allowVersionMismatch: true });
  const details = {
    path,
    source,
    version: version.ok ? version.value : null,
    pinnedVersion: D2_VERSION,
  };
  if (!version.ok || version.diagnostics.length > 0) {
    const diagnostic = version.diagnostics[0];
    return {
      ...base,
      status: "error",
      message: diagnostic?.message ?? `"${path}" is not D2 v${D2_VERSION}.`,
      hint: install,
      details,
    };
  }
  return { ...base, status: "ok", message: `D2 v${version.value} (${source}: ${path})`, details };
}

/** Where the bundled fonts live, for hints: the release layout or the source tree. */
const FONTS_LOCATION = RUN_MODE === "compiled" ? FONT_ASSETS_DIR : "assets/fonts";

async function checkFonts(): Promise<DoctorCheck> {
  const files: {
    fontSet: string;
    slot: string;
    path: string;
    /** Actual SHA-256 of the file, recorded so CI logs show the exact font environment. */
    sha256: string | null;
    ok: boolean;
    problem?: string;
  }[] = [];
  for (const set of BUILTIN_FONT_SETS.values()) {
    const slots = { regular: set.regular, bold: set.bold, italic: set.italic, mono: set.mono };
    for (const [slot, path] of Object.entries(slots)) {
      if (path === undefined) continue;
      const shown = relative(FONT_ASSETS_DIR, path);
      const expected = BUNDLED_FONT_SHA256.get(path);
      let problem: string | undefined;
      let actual: string | null = null;
      try {
        actual = new Bun.CryptoHasher("sha256").update(await readFile(path)).digest("hex");
        if (expected === undefined) problem = "no recorded checksum";
        else if (actual !== expected) problem = `sha256 ${actual} does not match ${expected}`;
      } catch {
        problem = "missing or unreadable";
      }
      files.push({
        fontSet: set.id,
        slot,
        path: shown,
        sha256: actual,
        ok: problem === undefined,
        ...(problem !== undefined && { problem }),
      });
    }
  }
  const bad = files.filter((f) => !f.ok);
  return {
    id: "fonts",
    required: true,
    status: bad.length === 0 ? "ok" : "error",
    message:
      bad.length === 0
        ? `${files.length} bundled font files present, sha256 verified`
        : `Bundled fonts are damaged: ${bad.map((f) => `${f.path} (${f.problem})`).join(", ")}`,
    ...(bad.length > 0 && {
      hint: `Restore ${FONTS_LOCATION} from the Sumi distribution; do not modify the font files.`,
    }),
    details: { directory: FONT_ASSETS_DIR, files },
  };
}

/**
 * Geometry lint (#13) re-measures labels with the font sets' metrics (`hmtx`
 * via `cmap`); it runs wherever D2 renders. Checks that every font file's
 * metrics can be read. Not required: rendering works without it.
 */
function geometryLintCheck(): DoctorCheck {
  const problems: string[] = [];
  const files: { fontSet: string; slot: string; path: string; unitsPerEm?: number }[] = [];
  for (const set of BUILTIN_FONT_SETS.values()) {
    const slots = { regular: set.regular, bold: set.bold, italic: set.italic, mono: set.mono };
    for (const [slot, path] of Object.entries(slots)) {
      if (path === undefined) continue;
      const shown = relative(FONT_ASSETS_DIR, path);
      try {
        const metrics = loadFontMetrics(path);
        files.push({ fontSet: set.id, slot, path: shown, unitsPerEm: metrics.unitsPerEm });
      } catch (error) {
        problems.push(`${shown} (${error instanceof Error ? error.message : String(error)})`);
        files.push({ fontSet: set.id, slot, path: shown });
      }
    }
  }
  return {
    id: "geometry-lint",
    required: false,
    status: problems.length === 0 ? "ok" : "error",
    message:
      problems.length === 0
        ? `font metrics readable for ${files.length} font files; geometry lint runs with render and lint --geometry (needs D2)`
        : `Cannot read font metrics for geometry lint: ${problems.join(", ")}`,
    ...(problems.length > 0 && {
      hint: `Restore ${FONTS_LOCATION} from the Sumi distribution; geometry lint measures labels with these files.`,
    }),
    details: { files },
  };
}

const STATUS_COLORS: Record<DoctorStatus, string> = {
  ok: "\u001b[32m",
  warning: "\u001b[33m",
  error: "\u001b[31m",
  skipped: "\u001b[2m",
};

export function formatDoctorText(report: DoctorReport, options: { color?: boolean } = {}): string {
  const { sumi, runtime } = report;
  const lines = [
    `Sumi ${sumi.version} (Bun ${runtime.bun}, ${runtime.platform}-${runtime.arch}${runtime.mode === "compiled" ? ", compiled" : ""})`,
    "",
  ];
  const idWidth = Math.max(...report.checks.map((c) => c.id.length));
  for (const check of report.checks) {
    const status = check.status.padEnd(7);
    const painted = options.color ? `${STATUS_COLORS[check.status]}${status}\u001b[0m` : status;
    lines.push(`${painted} ${check.id.padEnd(idWidth)}  ${check.message}`);
    if (check.hint !== undefined) lines.push(`${" ".repeat(9 + idWidth)}hint: ${check.hint}`);
  }
  lines.push("", report.ok ? "Ready to render." : "Some required checks failed.");
  return `${lines.join("\n")}\n`;
}
