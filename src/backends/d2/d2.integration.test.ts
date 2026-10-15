/**
 * Renders with the real D2 CLI. Skipped when no pinned `d2` is installed
 * locally, but required in CI (`CI` set), where a missing binary fails.
 */

import { describe, expect, test } from "bun:test";
import { getProfile, toD2LayoutArgs } from "../../core/profile";
import { createD2CliBackend } from "./backend";
import { checkD2Version, findD2Binary } from "./binary";
import { D2_VERSION } from "./version";

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;
const inCI = Boolean(process.env.CI);

if (!available && !inCI) {
  console.warn(
    `[d2 integration] D2 v${D2_VERSION} not found; skipping. Run \`bun run d2:install\` to enable.`,
  );
}

const profile = getProfile("paper-single");
if (profile === undefined) throw new Error("missing built-in profile");
const layout = toD2LayoutArgs(profile);

const source = `a: "Start" { class: sumi-k-a }
b: "End" { class: sumi-k-b }
a -> b: "next" { class: sumi-k-e0 }
`;

describe("D2 CLI integration", () => {
  test("the pinned d2 is installed in CI", () => {
    if (inCI) expect(available).toBe(true);
  });

  test.skipIf(!available)("renders ELK layout to SVG deterministically", async () => {
    const backend = createD2CliBackend();
    const first = await backend.render({ d2Source: source, layout });
    if (!first.ok) throw new Error(JSON.stringify(first.diagnostics, null, 2));

    const { svg } = first.value;
    expect(first.value.backend).toEqual({ name: "d2-cli", version: D2_VERSION });
    expect(first.value.args).toContain("elk");
    // Root <svg> wrapping exactly one nested svg.d2-svg.
    expect(svg).toMatch(/^(<\?xml[^>]*\?>)?<svg [^>]*>\s*<svg [^>]*class="[^"]*\bd2-svg\b[^"]*"/);
    expect(svg.match(/class="[^"]*\bd2-svg\b/g)).toHaveLength(1);
    expect(svg).toMatch(/<g class="[^"]*\bsumi-k-a\b[^"]*"/);
    expect(svg).toMatch(/<g class="[^"]*\bsumi-k-e0\b[^"]*"/);
    expect(svg).not.toContain("v0.9.0");

    const second = await backend.render({ d2Source: source, layout });
    expect(second.ok && second.value.svg).toBe(svg);
  });

  test.skipIf(!available)("reports compile errors at their source position", async () => {
    const backend = createD2CliBackend();
    const result = await backend.render({
      d2Source: "a\nb: { style.stroke-width: 20 }\n",
      layout,
      sourceName: "broken.d2",
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "backend/d2-failed",
      location: { file: "broken.d2", line: 2 },
    });
  });
});
