/** Original synthetic illustrations; run: bun examples/embedding-gemma/generate-assets.ts. */
import { join } from "node:path";

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;
const write = (name: string, content: string) =>
  Bun.write(join(import.meta.dir, "assets", name), content);
const guitar = `<path d="M57 12C25 4 14 29 28 47C34 57 14 59 14 80C14 112 67 128 94 104C113 86 94 70 89 61C83 48 105 31 87 17Z" fill="#dba351" stroke="#f3d197" stroke-width="3"/>
<path d="M57 17C34 10 22 31 34 46M22 80C20 100 61 117 85 100" fill="none" stroke="#bd7e38" stroke-width="2"/>
<circle cx="65" cy="52" r="20" fill="#a86e30" stroke="#f2cb7e" stroke-width="2"/><circle cx="65" cy="52" r="16" fill="#241e19"/>
<path d="M53 0H75L73 43H56Z" fill="#4c3526" stroke="#b88748" stroke-width="2"/>
<path d="M55 9H74M55 18H74M56 27H74M56 36H73" stroke="#b6a58b" stroke-width="1"/>
<rect x="47" y="87" width="37" height="8" rx="2" fill="#493025"/>
${Array.from({ length: 6 }, (_, i) => `<path d="M${58 + i * 2.5} 0L${54 + i * 4} 91" stroke="#f1dfb5" stroke-width="0.7"/>`).join("")}`;

await write(
  "guitar.svg",
  svg(
    160,
    116,
    `<rect width="160" height="116" rx="3" fill="#26211c"/><path d="M0 93L160 14V116H0Z" fill="#423326"/><g transform="translate(20 -2) rotate(-24 65 58)">${guitar}</g>`,
  ),
);
const holes = Array.from(
  { length: 6 },
  (_, i) =>
    `<rect x="${10 + i * 25}" y="5" width="10" height="9" fill="white"/><rect x="${10 + i * 25}" y="102" width="10" height="9" fill="white"/>`,
).join("");
await write(
  "video.svg",
  svg(
    160,
    116,
    `<rect width="160" height="116" rx="4" fill="#29292d"/>${holes}<rect x="5" y="20" width="150" height="76" fill="#415967"/><path d="M5 20H67L92 96H5Z" fill="#202f38"/><g transform="translate(27 24) scale(.65) rotate(-68 65 58)">${guitar}</g><path d="M5 28C28 27 38 42 54 48L65 61Q64 70 55 67L38 59L5 53Z" fill="#ca916f"/><path d="M155 70L121 57L104 48Q97 46 96 53L105 67L124 78L155 91Z" fill="#e5b08b"/><path d="M73 43L73 76L98 59Z" fill="white"/>`,
  ),
);

let seed = 299;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const colors = ["#3d9df5", "#e8a20c", "#e04848"];
const points: string[] = [];
for (let i = 0; i < 63; i++) {
  const angle = i * 2.39996;
  const radius = Math.sqrt((i + 0.5) / 63);
  const x = 180 + Math.cos(angle) * radius * 92 + (random() - 0.5) * 16;
  const y = 153 + Math.sin(angle) * radius * 100;
  const r = 10 + random() * 2;
  const color = colors[i % 3];
  let body = `<circle r="${r.toFixed(2)}" fill="${color}"/>`;
  // Split every fourth point, cycling its base color independently of the split cadence.
  // Unlike every third point, this keeps blue/amber/red areas balanced across the cloud.
  if (i % 4 === 0) {
    body += `<path d="M0 0V${-r}A${r} ${r} 0 0 1 0 ${r}Z" fill="${colors[(i + 1) % 3]}"/>`;
    if (i % 8 === 0)
      body += `<path d="M0 0L${-r * 0.866} ${-r * 0.5}A${r} ${r} 0 0 1 0 ${-r}Z" fill="${colors[(i + 2) % 3]}"/>`;
  }
  points.push(
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)})" opacity="0.88">${body}</g>`,
  );
}
// Outline axis glyphs as simple strokes: the safe SVG importer forbids text.
await write(
  "scatter.svg",
  svg(
    360,
    292,
    `<g transform="translate(0 12)">${points.join("")}<path d="M180 170V33M180 170L40 239M180 170L320 239" fill="none" stroke="#555" stroke-width="3"/><path d="M180 24L173 43H187ZM32 243L45 228L50 240ZM328 243L310 240L315 228Z" fill="#555"/><path d="M174 5H186L174 19H186M10 237L22 253M22 237L10 253M339 237L345 245L351 237M345 245V253" fill="none" stroke="#505050" stroke-width="3"/></g>`,
  ),
);
