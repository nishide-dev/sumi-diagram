/**
 * Test support for the render stage: a small compiled figure and a
 * hand-written SVG in the shape D2 v0.9.0 produces for it. Not part of the
 * public API.
 */

import type { RenderArtifact } from "../backends/types";
import { type CompiledD2Figure, compileFigure, expectD2Figure } from "../compiler/compile";

export const TINY_SOURCE = `version: 1
figure: { id: tiny }
groups:
  - { id: grp, label: Group }
nodes:
  - { id: a, component: box, label: A, group: grp }
  - { id: note, component: label, label: Note }
edges:
  - { from: a, to: note, label: x }
  - { id: back, from: note, to: a }
`;

export function tinyCompiled(): CompiledD2Figure {
  const result = compileFigure(TINY_SOURCE);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return expectD2Figure(result.value);
}

const FONT_CSS = `
.d2-1 .text {
	font-family: "d2-1-font-regular";
}
@font-face {
	font-family: d2-1-font-regular;
	src: url("data:application/font-woff;base64,d09GRgABAAAAAA==");
}
.d2-1 .text-bold {
	font-family: "d2-1-font-bold";
}
@font-face {
	font-family: d2-1-font-bold;
	src: url("data:application/font-woff;base64,d09GRgABAAAAAA==");
}`;

/** Element groups of the tiny figure, keyed by a short name. */
export const TINY_PARTS = {
  grp: `<g class="Z19ncnA= sumi-k-g--grp sumi-kind-group"><g class="shape" ><rect x="10" y="10" width="120" height="80" stroke="#000000" fill="transparent" style="stroke-width:2;" /></g><text x="70" y="31" fill="#000000" class="text-bold" style="text-anchor:middle;font-size:18px">Group</text></g>`,
  a: `<g class="Z19ncnAubl9h sumi-k-n--a sumi-kind-node"><g class="shape" ><rect x="20" y="40" width="50" height="30" stroke="#000000" fill="#ffffff" style="stroke-width:2;" /></g><text x="45" y="60" fill="#000000" class="text" style="text-anchor:middle;font-size:16px">A</text></g>`,
  note: `<g class="bl9ub3Rl sumi-k-n--note sumi-kind-node"><g class="shape" ></g><text x="170" y="60" fill="#000000" class="text" style="text-anchor:middle;font-size:16px"><tspan x="170" dy="0">No</tspan><tspan x="170" dy="16">te</tspan></text></g>`,
  edge0: `<g class="ZWRnZQ== sumi-k-e--_0 sumi-kind-edge"><marker id="mk-1" markerWidth="10" markerHeight="12" refX="7" refY="6" viewBox="0 0 10 12" orient="auto" markerUnits="userSpaceOnUse"> <polygon points="0,0 10,6 0,12" fill="#000000" class="connection" stroke-width="2" /> </marker><path d="M 72 55 L 140 55 S 150 55 150 50 L 155 50" stroke="#000000" fill="none" class="connection" style="stroke-width:2;" marker-end="url(#mk-1)" mask="url(#d2-1)" /><text x="110" y="61" fill="#000000" class="text" style="text-anchor:middle;font-size:14px">x</text></g>`,
  back: `<g class="YmFjaw== sumi-k-e--back sumi-kind-edge"><path d="M 160 65 V 80 H 45 v -8" stroke="#000000" fill="none" class="connection" style="stroke-width:2;" mask="url(#d2-1)" /></g>`,
};

/** A D2-like SVG with the given element groups (all of the tiny figure by default). */
export function tinySvg(
  parts: string[] = Object.values(TINY_PARTS),
  options: { fonts?: boolean; viewBox?: string } = {},
): string {
  const { fonts = true, viewBox = "0 0 200 100" } = options;
  const [, , w = "0", h = "0"] = viewBox.split(" ");
  const style = fonts ? `<style type="text/css"><![CDATA[${FONT_CSS}]]></style>` : "";
  return `<?xml version="1.0" encoding="utf-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"  preserveAspectRatio="xMinYMin meet" viewBox="${viewBox}"><svg class="d2-1 d2-svg" width="${w}" height="${h}" viewBox="${viewBox}"><rect x="0" y="0" width="${w}" height="${h}" rx="0" fill="#FFFFFF" class=" fill-N7" stroke-width="0" />${style}${parts.join("")}<mask id="d2-1" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">
<rect x="0" y="0" width="${w}" height="${h}" fill="white"></rect>
</mask></svg></svg>`;
}

/** A render artifact for `compiled` carrying `svg`, as the D2 CLI backend would return it. */
export function artifactFor(compiled: CompiledD2Figure, svg: string): RenderArtifact {
  return {
    svg,
    d2Source: compiled.d2Source,
    backend: { name: "d2-cli", version: "0.9.0" },
    args: [],
    layout: compiled.layout.effective,
    fontSetId: compiled.fontSet.id,
  };
}
