import { parseHtml } from "./html";
import { htmlFontSize } from "./html-measure";

/** Resolve the first root element's CSS corner radii in viewport pixels. */
export function htmlRadius(source: string, width: number, height: number): [number, number][] {
  const root = parseHtml(source).tokens.find((token) => token.kind === "open");
  const corners: [number, number][] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  if (root?.kind !== "open" || width <= 0 || height <= 0) return corners;
  const font = htmlFontSize(root.css["font-size"], 16);
  const length = (value: string, axis: number) => {
    const v = value.toLowerCase();
    const number = Number.parseFloat(v);
    return v.endsWith("%")
      ? (number * axis) / 100
      : v.endsWith("em")
        ? number * font
        : v.endsWith("pt")
          ? (number * 4) / 3
          : number;
  };
  const names = ["top-left", "top-right", "bottom-right", "bottom-left"];
  for (const [property, value] of Object.entries(root.css)) {
    const parts = value.trim().split(/\s+/);
    if (property === "border-radius") {
      const values = [
        parts[0],
        parts[1] ?? parts[0],
        parts[2] ?? parts[0],
        parts[3] ?? parts[1] ?? parts[0],
      ];
      values.forEach((v, i) => {
        if (v !== undefined) corners[i] = [length(v, width), length(v, height)];
      });
    } else {
      const i = names.findIndex((name) => property === `border-${name}-radius`);
      if (i >= 0 && parts[0] !== undefined)
        corners[i] = [length(parts[0], width), length(parts[1] ?? parts[0], height)];
    }
  }
  const [tl, tr, br, bl] = corners as [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  const factor = Math.min(
    1,
    width / (tl[0] + tr[0] || width),
    width / (bl[0] + br[0] || width),
    height / (tl[1] + bl[1] || height),
    height / (tr[1] + br[1] || height),
  );
  return corners.map(([x, y]) => [x * factor, y * factor]);
}
