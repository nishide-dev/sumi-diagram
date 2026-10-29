import type { Point } from "../../core/geometry";

/** Merge collinear sampling/grid points before measuring a step between bends. */
export function microJogLengths(lines: readonly (readonly Point[])[]): number[] {
  const lengths: number[] = [];
  // Structured wires paint each straight piece as a separate subpath. Join
  // touching ends within this edge only; never jump a gap or a branch.
  const paths = lines.filter((line) => line.length > 1).map((line) => [...line]);
  const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.002;
  for (let i = 0; i < paths.length; i++) {
    const line = paths[i] as Point[];
    for (const reverse of [false, true]) {
      if (reverse) line.reverse();
      while (line.length > 0) {
        const end = line.at(-1) as Point;
        const matches = paths.flatMap((other, j) =>
          j === i || other.length === 0
            ? []
            : same(end, other[0] as Point)
              ? [{ j, reverse: false }]
              : same(end, other.at(-1) as Point)
                ? [{ j, reverse: true }]
                : [],
        );
        if (matches.length !== 1) break;
        const match = matches[0];
        if (!match) break;
        const other = paths[match.j] as Point[];
        if (match.reverse) other.reverse();
        line.push(...other.slice(1));
        other.length = 0;
      }
    }
  }
  for (const line of paths) {
    const points: Point[] = [];
    for (const p of line) {
      const b = points.at(-1);
      if (b && Math.hypot(p.x - b.x, p.y - b.y) < 0.002) continue;
      const a = points.at(-2);
      if (a && b) {
        const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
        const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y);
        if (Math.abs(cross) < 0.000001 && dot > 0) points.pop();
      }
      points.push(p);
    }
    const rightAngle = (a: Point, b: Point, c: Point) => {
      const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      return Math.abs(dot) < 0.000001;
    };
    for (let i = 1; i + 2 < points.length; i++) {
      const a = points[i - 1] as Point;
      const b = points[i] as Point;
      const c = points[i + 1] as Point;
      const d = points[i + 2] as Point;
      // A flattened curve's short chords are not orthogonal steps. End stubs
      // and separate painted subpaths are not segments between two bends.
      if (rightAngle(a, b, c) && rightAngle(b, c, d))
        lengths.push(Math.hypot(c.x - b.x, c.y - b.y));
    }
  }
  return lengths;
}
