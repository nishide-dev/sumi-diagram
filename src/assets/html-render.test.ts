import { expect, test } from "bun:test";
import { htmlThemeVariables } from "./html-render";

test("--sumi-muted reads on every built-in theme's canvas (#496)", async () => {
  const { BUILTIN_THEMES } = await import("../core/theme/builtin");
  const { contrastRatio } = await import("../core/theme/node-variants");
  for (const theme of BUILTIN_THEMES.values()) {
    const vars = htmlThemeVariables(theme);
    const muted = vars["--sumi-muted"] ?? "";
    expect(contrastRatio(muted, theme.canvas), theme.id).toBeGreaterThanOrEqual(4.5);
  }
});
