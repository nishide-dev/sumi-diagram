/**
 * Original synthetic point cloud in the style of a t-SNE plot (no paper data);
 * deterministic. Run: bun generate.ts from this directory.
 */
let seed = 1609;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const gaussian = () => {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
};
// Seven classes: centre, spread, elongation angle, point count, colour.
const classes = [
  { x: 40, y: 62, sx: 9, sy: 13, a: 0.3, n: 70, color: "#9b9b9b" },
  { x: 78, y: 48, sx: 12, sy: 9, a: -0.2, n: 110, color: "#e3232b" },
  { x: 128, y: 30, sx: 22, sy: 9, a: -0.5, n: 150, color: "#3d9a6e" },
  { x: 34, y: 128, sx: 13, sy: 7, a: -0.6, n: 90, color: "#f2df2a" },
  { x: 138, y: 92, sx: 24, sy: 16, a: 0.1, n: 260, color: "#a54f86" },
  { x: 92, y: 126, sx: 13, sy: 20, a: 0.2, n: 160, color: "#f5891f" },
  { x: 142, y: 150, sx: 6, sy: 12, a: 0.4, n: 60, color: "#55639a" },
];
const dots: string[] = [];
for (const c of classes) {
  for (let i = 0; i < c.n; i++) {
    const u = gaussian() * c.sx;
    const v = gaussian() * c.sy;
    // A few points of each class stray into the others, as in a real embedding.
    const stray = random() < 0.06 ? 2.2 : 1;
    const x = c.x + stray * (u * Math.cos(c.a) - v * Math.sin(c.a));
    const y = c.y + stray * (u * Math.sin(c.a) + v * Math.cos(c.a));
    if (x < 3 || x > 177 || y < 3 || y > 177) continue;
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="${c.color}"/>`);
  }
}
// Shuffle the drawing order so that no class is painted over all the others.
for (let i = dots.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [dots[i], dots[j]] = [dots[j] as string, dots[i] as string];
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
${dots.join("\n")}
</svg>
`;
await Bun.write(new URL("tsne.svg", import.meta.url), svg);
