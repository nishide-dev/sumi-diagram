/**
 * Layout/rendering backend contract (design doc §6): D2 source in, SVG plus
 * the provenance needed for caching and golden tests out.
 */

import type { D2LayoutArgs } from "../core/profile";
import type { Result } from "../core/result";

/** A font set as D2 CLI arguments (computed by the theme stage, #6). */
export interface BackendFontSet {
  /** Stable font set identifier, recorded in the artifact. */
  id: string;
  /** `--font-*` flag / `.ttf` path pairs, one argv entry each. */
  args: readonly string[];
}

export interface RenderInput {
  /** Generated D2 source (#8). */
  d2Source: string;
  /** Profile-derived layout flags from `toD2LayoutArgs` (#7). */
  layout: D2LayoutArgs;
  /** Fonts to measure and embed. Omitted: D2's built-in fonts. */
  fontSet?: BackendFontSet;
  /**
   * Name used for the D2 source in diagnostics (D2 errors carry line:column
   * into this generated source). Defaults to `"generated.d2"`.
   */
  sourceName?: string;
}

export interface RenderArtifact {
  svg: string;
  d2Source: string;
  backend: { name: "d2-cli"; version: string };
  /** Exact CLI arguments used, excluding the binary and temporary input/output paths. */
  args: string[];
  /** Effective (rounded) layout values behind the layout flags in {@link args}. */
  layout: D2LayoutArgs["effective"];
  fontSetId?: string;
}

export interface DiagramBackend {
  readonly name: RenderArtifact["backend"]["name"];
  render(input: RenderInput): Promise<Result<RenderArtifact>>;
}
